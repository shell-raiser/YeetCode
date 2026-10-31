// Background service worker for YeetCode extension
// Handles all network requests to GitHub API and the configured AI endpoint
// to bypass CORS/CSP restrictions on LeetCode.com

console.log('YeetCode background service worker started');

// ─────────────────────────────────────────────────────
// AI Helper (Socratic nudges) — see issue #4
// ─────────────────────────────────────────────────────

const AI_MODE_DIRECTIVES = {
    ask: 'Mode: ask. The user has explicitly asked for help with the current step. Follow the general rules and their request.',
    check_direction: 'Mode: check_direction. This is a silent background check — the user is NOT reading this message. Evaluate ONLY whether the user\'s current approach and progress can plausibly lead to a correct solution within a reasonable time, and whether their plan is sound for this problem\'s constraints. Reply ONLY with minified JSON in exactly this form: {"on_track": true|false, "note": "<one short sentence, at most 120 chars, e.g. what is promising or what the main gap is>"} — no other text, no markdown fences, no code.',
    nudge: 'Mode: nudge. The user just accepted a small nudge after a direction check. Respond with at most ONE Socratic question (plus at most one short sentence of framing) that steers their thinking toward a workable direction. Do NOT reveal the key insight outright.',
    guided: 'Mode: guided. The user reached their time limit and chose to learn the solution. Lead them step-by-step from their CURRENT code toward understanding and completing a solution: ask a Socratic question first, and only explain more directly when they stall. Work in small increments, one step at a time, still never pasting a finished solution.'
};

const DEFAULT_AI_SETTINGS = {
    aiEnabled: false,
    aiEndpoint: 'https://api.openai.com/v1/chat/completions',
    aiApiKey: '',
    aiModel: '',
    nudgeAtMinutes: 15,
    deadlineAtMinutes: 45,
    minHelpMinutes: 5,
    concepts: []
};

function getAiSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get([
            'aiEnabled',
            'aiEndpoint',
            'aiApiKey',
            'aiModel',
            'nudgeAtMinutes',
            'deadlineAtMinutes',
            'minHelpMinutes',
            'concepts'
        ], function(items) {
            resolve({
                aiEnabled: items.aiEnabled !== undefined ? items.aiEnabled : DEFAULT_AI_SETTINGS.aiEnabled,
                aiEndpoint: items.aiEndpoint || DEFAULT_AI_SETTINGS.aiEndpoint,
                aiApiKey: items.aiApiKey || '',
                aiModel: items.aiModel || '',
                nudgeAtMinutes: items.nudgeAtMinutes || DEFAULT_AI_SETTINGS.nudgeAtMinutes,
                deadlineAtMinutes: items.deadlineAtMinutes || DEFAULT_AI_SETTINGS.deadlineAtMinutes,
                minHelpMinutes: items.minHelpMinutes !== undefined ? items.minHelpMinutes : DEFAULT_AI_SETTINGS.minHelpMinutes,
                concepts: Array.isArray(items.concepts) ? items.concepts : []
            });
        });
    });
}

// Build the system prompt that encodes the Socratic teaching rules (issue #4)
function buildAiSystemPrompt(aiSettings, mode) {
    const lines = [];
    lines.push('You are the YeetCode AI Helper, an assistant embedded in a LeetCode problem page. Your job is to TEACH, never to solve for the user. Follow these rules strictly:');
    lines.push('');
    lines.push('GENERAL RULES');
    lines.push('- Always anchor your guidance in the user\'s CURRENT code and approach: build on their conceptual path, coding style and variable names. Do not hand them a redesigned solution.');
    lines.push('- NEVER provide a complete solution (optimal or otherwise) and never fill in the remaining logic. At most show 1-3 line illustrative fragments, phrased in the user\'s own style.');
    lines.push('- Use the Socratic method: lead with questions rather than answers, one or two questions per message, and wait for the user\'s response.');
    lines.push('- Before advising, infer what kind of solution the user is attempting. If there are multiple plausible directions from their current point, ask the user which direction they intend before hinting at any of them.');
    lines.push('- Never suggest solving the problem with a concept the user has NOT studied if it can be avoided under the problem\'s constraints. If such a concept is truly necessary, say so plainly, then teach it from first principles (a short definition plus a tiny example) before using it.');
    lines.push('- Keep messages short and focused. The user is trying to solve the problem themselves.');
    lines.push('');
    lines.push('USER CONCEPT EXPERIENCE LEVELS (self-reported)');
    if (aiSettings.concepts && aiSettings.concepts.length > 0) {
        for (const concept of aiSettings.concepts) {
            lines.push(`- ${concept.name}: ${concept.level}`);
        }
    } else {
        lines.push('- (none provided; be conservative and explain any non-trivial concept you use)');
    }
    lines.push('');
    lines.push('UNSTUDIED means the user has never learned it. LOW means only vague familiarity. HIGH means confident. Calibrate hints and vocabulary accordingly.');
    lines.push('');
    lines.push(AI_MODE_DIRECTIVES[mode] || AI_MODE_DIRECTIVES.ask);
    lines.push('');
    lines.push('The problem statement, the user\'s current code, and the conversation so far are provided in the conversation.');
    return lines.join('\n');
}

// Compose the OpenAI-compatible chat/completions request body
function buildAiRequestMessages(aiSettings, request) {
    const mode = request.mode || 'ask';
    const messages = [{ role: 'system', content: buildAiSystemPrompt(aiSettings, mode) }];

    const contextParts = [];
    if (request.problemTitle) {
        contextParts.push(`Problem: ${request.problemTitle}`);
    }
    if (request.problemUrl) {
        contextParts.push(`URL: ${request.problemUrl}`);
    }
    contextParts.push('');
    contextParts.push('<problem_statement>');
    contextParts.push((request.problemStatement || '(not available — you may say you cannot find the statement and ask the user to paste any missing details)').trim());
    contextParts.push('</problem_statement>');
    contextParts.push('');
    contextParts.push('<current_code language="' + (request.languageId || 'unknown') + '">');
    contextParts.push((request.code || '') || '(editor is empty)');
    contextParts.push('</current_code>');

    messages.push({
        role: 'user',
        content: 'Here is the current context for this session:\n\n' + contextParts.join('\n')
    });
    messages.push({
        role: 'assistant',
        content: 'Understood. I will guide, not solve, and I will respect the concept levels and the mode you assign me in each turn.'
    });

    if (Array.isArray(request.history)) {
        for (const entry of request.history) {
            if (entry && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string' && entry.content.trim()) {
                messages.push({ role: entry.role, content: entry.content });
            }
        }
    }

    const userMessage = (request.userMessage || '').trim();
    if (userMessage) {
        messages.push({ role: 'user', content: userMessage });
    } else if (!messages.some(m => m.role === 'user' && m !== messages[1])) {
        // No conversation content at all; give a minimal opener
        messages.push({ role: 'user', content: 'Please begin.' });
    }

    return messages;
}

// Call the configured OpenAI-compatible chat completion endpoint
async function callAiChatCompletion(aiSettings, request) {
    const body = {
        model: aiSettings.aiModel || 'gpt-4o-mini',
        messages: buildAiRequestMessages(aiSettings, request),
        temperature: 0.4
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    let response;
    try {
        response = await fetch(aiSettings.aiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aiSettings.aiApiKey}`
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });
    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error('AI request timed out after 60 seconds.');
        }
        throw new Error(`Could not reach the AI endpoint (${error.message}).`);
    } finally {
        clearTimeout(timeoutId);
    }

    if (!response.ok) {
        let errMsg = `HTTP Error ${response.status}`;
        try {
            const errorData = await response.json();
            errMsg = errorData.error && errorData.error.message ? errorData.error.message : (errorData.message || errMsg);
        } catch (e) {
            // Ignore parse failure, use generic message
        }
        if (response.status === 401) {
            throw new Error(`Unauthorized: Check your AI API key (${errMsg}).`);
        } else if (response.status === 404) {
            throw new Error(`AI endpoint or model not found: Check the endpoint URL and model name (${errMsg}).`);
        } else if (response.status === 429) {
            throw new Error(`Rate limited by the AI provider (${errMsg}).`);
        }
        throw new Error(`AI API Error: ${errMsg}`);
    }

    let data;
    try {
        data = await response.json();
    } catch (e) {
        throw new Error('AI endpoint returned a non-JSON response. Check the endpoint URL.');
    }

    const choices = Array.isArray(data.choices) ? data.choices : [];
    const content = choices[0] && choices[0].message && typeof choices[0].message.content === 'string'
        ? choices[0].message.content
        : null;

    if (!content) {
        throw new Error('AI response did not contain any message content.');
    }

    return content;
}

// Parse a one-shot direction check response: expect {"on_track": bool, "note": "..."}
function parseDirectionResponse(raw) {
    const text = (raw || '').replace(/```(?:json)?/g, '');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            const onTrackValue = parsed.on_track !== undefined ? parsed.on_track : parsed.onTrack;
            if (typeof onTrackValue === 'boolean') {
                return {
                    onTrack: onTrackValue,
                    note: typeof parsed.note === 'string' ? parsed.note : '',
                    raw: raw || ''
                };
            }
        } catch (e) {
            // Fall through to looser parsing
        }
    }

    const boolMatch = text.match(/on_track"?\s*[:=]?\s*"(true|false)"|on_track"?\s*[:=]?\s*(true|false)/i);
    if (boolMatch) {
        return { onTrack: /true/i.test(boolMatch[0]), note: '', raw: raw || '' };
    }

    return { onTrack: null, note: '', raw: raw || '' };
}

async function handleAiChat(request) {
    const aiSettings = await getAiSettings();
    if (!aiSettings.aiEnabled) {
        throw new Error('AI Helper is disabled in the extension options.');
    }
    if (!aiSettings.aiApiKey) {
        throw new Error('AI API key is not configured in the extension options.');
    }

    const reply = await callAiChatCompletion(aiSettings, request);
    return { reply: reply };
}

async function handleAiDirection(request) {
    const aiSettings = await getAiSettings();
    if (!aiSettings.aiEnabled) {
        throw new Error('AI Helper is disabled in the extension options.');
    }
    if (!aiSettings.aiApiKey) {
        throw new Error('AI API key is not configured in the extension options.');
    }

    const raw = await callAiChatCompletion(aiSettings, {
        mode: 'check_direction',
        problemTitle: request.problemTitle,
        problemUrl: request.problemUrl,
        problemStatement: request.problemStatement,
        code: request.code,
        languageId: request.languageId
    });

    return parseDirectionResponse(raw);
}

// Mapping of Monaco language IDs to file extensions
const LANGUAGE_EXTENSIONS = {
    'cpp': '.cpp',
    'c': '.c',
    'csharp': '.cs',
    'java': '.java',
    'python': '.py',
    'python3': '.py',
    'javascript': '.js',
    'typescript': '.ts',
    'go': '.go',
    'golang': '.go',
    'ruby': '.rb',
    'swift': '.swift',
    'kotlin': '.kt',
    'scala': '.scala',
    'rust': '.rs',
    'php': '.php',
    'sql': '.sql',
    'mysql': '.sql',
    'mssql': '.sql',
    'oraclesql': '.sql',
    'postgresql': '.sql',
    'bash': '.sh',
    'shell': '.sh',
    'r': '.r',
    'erlang': '.erl',
    'elixir': '.ex',
    'dart': '.dart'
};

const LEETCODE_LANGUAGE_SLUGS = {
    'python': ['python', 'python3'],
    'python3': ['python3', 'python'],
    'go': ['go', 'golang'],
    'golang': ['golang', 'go'],
    'shell': ['shell', 'bash'],
    'bash': ['bash', 'shell']
};

function getExtensionForLanguage(langId) {
    if (!langId) return '.txt';
    const cleanLang = langId.toLowerCase().trim();
    return LANGUAGE_EXTENSIONS[cleanLang] || '.txt';
}

function getProblemDirectory(problemInfo) {
    const sanitizedTitle = problemInfo.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'unknown-problem';

    const contestFolder = problemInfo.isContest
        ? problemInfo.contestFolder ||
          (typeof problemInfo.subPath === 'string' ? problemInfo.subPath.split('/').filter(Boolean).pop() : '')
        : '';
    const sanitizedContestFolder = contestFolder
        ? contestFolder.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        : '';

    return {
        sanitizedTitle,
        directory: sanitizedContestFolder
            ? `contests/${sanitizedContestFolder}/${sanitizedTitle}`
            : sanitizedTitle
    };
}

function getProblemFilePath(problemInfo, languageId, settings) {
    const { sanitizedTitle, directory } = getProblemDirectory(problemInfo);
    const folder = settings.folder.trim().replace(/^\/+|\/+$/g, '');
    const folderPrefix = folder ? `${folder}/` : '';
    return `${folderPrefix}${directory}/${sanitizedTitle}${getExtensionForLanguage(languageId)}`;
}

function getParentFolderPrefix(settings) {
    const folder = settings.folder.trim().replace(/^\/+|\/+$/g, '');
    return folder ? `${folder}/` : '';
}

function decodeGitHubFileContent(content) {
    if (typeof content !== 'string') {
        throw new Error('GitHub returned a file without content.');
    }

    const binary = atob(content.replace(/\s/g, ''));
    const encoded = Array.from(binary, (character) => {
        return `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`;
    }).join('');
    return decodeURIComponent(encoded);
}

async function fetchGitHubFile(settings, filePath) {
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const apiUrl = `https://api.github.com/repos/${settings.repo}/contents/${encodedPath}?ref=${encodeURIComponent(settings.branch)}`;
    const response = await fetch(apiUrl, {
        headers: {
            'Authorization': `token ${settings.token}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });

    if (response.status === 404) return null;
    if (!response.ok) {
        let errMsg = `HTTP Error ${response.status}`;
        try {
            const data = await response.json();
            errMsg = data.message || errMsg;
        } catch (e) {
            // Keep the HTTP status when GitHub does not return JSON.
        }
        throw new Error(`GitHub API Error: ${errMsg}`);
    }

    const file = await response.json();
    return {
        content: decodeGitHubFileContent(file.content),
        path: file.path || filePath
    };
}

async function isLeetCodeStarterCode(titleSlug, languageId, editorCode) {
    const response = await fetch('https://leetcode.com/graphql/', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            operationName: 'questionEditorData',
            query: 'query questionEditorData($titleSlug: String!) {\n  question(titleSlug: $titleSlug) {\n    codeSnippets {\n      langSlug\n      code\n    }\n  }\n}',
            variables: { titleSlug }
        })
    });

    if (!response.ok) {
        throw new Error(`LeetCode returned HTTP ${response.status} while checking the starter code.`);
    }

    const data = await response.json();
    const languageSlug = languageId.toLowerCase().trim();
    const languageSlugs = LEETCODE_LANGUAGE_SLUGS[languageSlug] || [languageSlug];
    const snippets = data && data.data && data.data.question && data.data.question.codeSnippets;
    const snippet = Array.isArray(snippets)
        ? snippets.find((item) => languageSlugs.includes(item.langSlug))
        : null;

    if (!snippet || typeof snippet.code !== 'string') {
        throw new Error(`LeetCode did not provide a starter template for ${languageId}.`);
    }

    const normalize = (code) => code.replace(/\r\n/g, '\n').trim();
    return normalize(editorCode) === normalize(snippet.code);
}

function setEditorCodeInPage(code, expectedLanguageId, expectedEditorCode, expectedPathname) {
    if (expectedPathname && window.location.pathname !== expectedPathname) {
        return { success: false, error: 'The LeetCode problem changed before import.' };
    }

    const editors = window.monaco && window.monaco.editor &&
        typeof window.monaco.editor.getEditors === 'function'
        ? window.monaco.editor.getEditors()
        : [];
    const editor = editors[0];
    if (!editor) return { success: false, error: 'LeetCode editor is not available.' };

    const model = typeof editor.getModel === 'function' ? editor.getModel() : null;
    const currentLanguageId = model && typeof model.getLanguageId === 'function'
        ? model.getLanguageId()
        : null;
    if (!currentLanguageId || currentLanguageId !== expectedLanguageId) {
        return { success: false, error: 'The selected LeetCode language changed before import.' };
    }

    if (typeof expectedEditorCode === 'string') {
        const currentCode = typeof editor.getValue === 'function'
            ? editor.getValue()
            : model && typeof model.getValue === 'function'
                ? model.getValue()
                : null;
        if (currentCode !== expectedEditorCode) {
            return { success: false, error: 'The editor changed before automatic import.' };
        }
    }

    if (typeof editor.setValue === 'function') {
        editor.setValue(code);
    } else if (model && typeof model.setValue === 'function') {
        model.setValue(code);
    } else {
        return { success: false, error: 'LeetCode editor cannot accept imported code.' };
    }

    return { success: true };
}

function getProblemPathname(problemInfo) {
    return typeof problemInfo.url === 'string' && problemInfo.url
        ? new URL(problemInfo.url).pathname
        : null;
}

async function replaceEditorCode(tabId, code, languageId, expectedEditorCode, expectedPathname) {
    if (typeof tabId !== 'number') {
        throw new Error('Could not identify the LeetCode tab for import.');
    }

    const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: setEditorCodeInPage,
        args: [
            code,
            languageId,
            typeof expectedEditorCode === 'string' ? expectedEditorCode : null,
            expectedPathname
        ]
    });
    const result = results && results[0] && results[0].result;
    if (!result || !result.success) {
        throw new Error((result && result.error) || 'Unable to import code into the LeetCode editor.');
    }
}

// Fetch extension settings from storage
async function getExtensionSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get([
            'githubToken',
            'githubRepo',
            'githubBranch',
            'githubFolder',
            'saveNotesAndTimer',
            'autoImportFromGitHub'
        ], function(items) {
            resolve({
                token: items.githubToken || '',
                repo: items.githubRepo || '',
                branch: items.githubBranch || 'main',
                folder: items.githubFolder || '',
                saveNotesAndTimer: items.saveNotesAndTimer !== undefined ? items.saveNotesAndTimer : true,
                autoImportFromGitHub: items.autoImportFromGitHub === true
            });
        });
    });
}

// Listen for messages from content script or options page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'saveToGitHub') {
        handleSaveToGitHub(
            request.code,
            request.problemInfo,
            request.languageId,
            request.notesText || null,
            request.timerValue || null
        )
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async response
    }

    if (request.action === 'checkGitHubSolution') {
        handleCheckGitHubSolution(
            request.problemInfo,
            request.languageId,
            request.editorCode,
            request.allowAutoImport === true,
            sender.tab && sender.tab.id
        )
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === 'importFromGitHub') {
        handleImportFromGitHub(
            request.problemInfo,
            request.languageId,
            sender.tab && sender.tab.id
        )
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    
    if (request.action === 'testConnection') {
        handleTestConnection(request.token, request.repo)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async response
    }

    if (request.action === 'aiChat') {
        handleAiChat(request)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async response
    }

    if (request.action === 'aiDirection') {
        handleAiDirection(request)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async response
    }

    if (request.action === 'settingsUpdated') {
        // Sent from the options page; nothing to do in the worker, but ack it so
        // the options page does not surface a runtime.lastError for a lone message.
        sendResponse({ success: true });
        return false;
    }
});

async function handleCheckGitHubSolution(problemInfo, languageId, editorCode, allowAutoImport, tabId) {
    const settings = await getExtensionSettings();
    if (!settings.token || !settings.repo) {
        return { configured: false };
    }

    const codeFilePath = getProblemFilePath(problemInfo, languageId, settings);
    const solution = await fetchGitHubFile(settings, codeFilePath);
    if (!solution) {
        return {
            configured: true,
            found: false,
            languageId
        };
    }

    let autoImported = false;
    let autoImportError = null;
    if (settings.autoImportFromGitHub && allowAutoImport && typeof editorCode === 'string') {
        let editorIsStarter = editorCode.trim() === '';
        if (!editorIsStarter) {
            try {
                editorIsStarter = await isLeetCodeStarterCode(
                    problemInfo.problemSlug || problemInfo.title,
                    languageId,
                    editorCode
                );
            } catch (error) {
                autoImportError = error.message;
            }
        }

        if (editorIsStarter) {
            try {
                await replaceEditorCode(
                    tabId,
                    solution.content,
                    languageId,
                    editorCode,
                    getProblemPathname(problemInfo)
                );
                autoImported = true;
            } catch (error) {
                autoImportError = error.message;
            }
        }
    }

    return {
        configured: true,
        found: true,
        autoImported,
        autoImportError,
        languageId,
        codeFilePath,
        repo: settings.repo,
        branch: settings.branch
    };
}

async function handleImportFromGitHub(problemInfo, languageId, tabId) {
    const settings = await getExtensionSettings();
    if (!settings.token || !settings.repo) {
        throw new Error('GitHub token or repository not configured in settings.');
    }

    const codeFilePath = getProblemFilePath(problemInfo, languageId, settings);
    const solution = await fetchGitHubFile(settings, codeFilePath);
    if (!solution) {
        return { found: false, languageId };
    }

    await replaceEditorCode(tabId, solution.content, languageId, undefined, getProblemPathname(problemInfo));
    return {
        found: true,
        languageId,
        codeFilePath,
        repo: settings.repo,
        branch: settings.branch
    };
}

// Test connection to GitHub repository
async function handleTestConnection(token, repo) {
    if (!token || !repo) {
        throw new Error('Token and repository owner/name are required.');
    }

    const apiUrl = `https://api.github.com/repos/${repo}`;
    
    const response = await fetch(apiUrl, {
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });

    if (!response.ok) {
        let errMsg = `HTTP Error ${response.status}`;
        try {
            const data = await response.json();
            errMsg = data.message || errMsg;
        } catch (e) {
            // Use generic error if parsing fails
        }
        
        if (response.status === 401) {
            throw new Error(`Unauthorized: Invalid Personal Access Token (${errMsg}).`);
        } else if (response.status === 404) {
            throw new Error(`Repository not found: Please verify that '${repo}' exists and your token has permission to access it.`);
        } else {
            throw new Error(`GitHub API Error: ${errMsg}`);
        }
    }

    // Verify token scopes
    const scopes = response.headers.get('X-OAuth-Scopes');
    if (scopes !== null) {
        const scopesArray = scopes.split(',').map(s => s.trim());
        if (!scopesArray.includes('repo')) {
            throw new Error("Missing Permission: Your token does not have the 'repo' scope. Please create a token with 'repo' scope.");
        }
    }

    const data = await response.json();
    return {
        private: data.private,
        description: data.description,
        fullName: data.full_name
    };
}

// Commit a single file to GitHub using the Contents API (PUT = create or update)
async function commitFileToGitHub(settings, filePath, content, commitMessage) {
    const apiUrl = `https://api.github.com/repos/${settings.repo}/contents/${filePath}`;
    
    // Check if file already exists so we can include its SHA for updates
    let existingSha = null;
    try {
        const checkResponse = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${settings.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        if (checkResponse.ok) {
            const existing = await checkResponse.json();
            existingSha = existing.sha || null;
        }
    } catch (error) {
        console.warn('Error checking existing file, assuming new file:', error);
    }
    
    const requestBody = {
        message: commitMessage,
        content: btoa(unescape(encodeURIComponent(content))),
        branch: settings.branch
    };
    
    if (existingSha) {
        requestBody.sha = existingSha;
    }
    
    const response = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${settings.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
        let errMsg = `HTTP Error ${response.status}`;
        try {
            const errorData = await response.json();
            errMsg = errorData.message || errMsg;
        } catch (e) {
            // Ignore parse error
        }
        throw new Error(`GitHub API Commit failed: ${errMsg}`);
    }
    
    return await response.json();
}

// Build the notes markdown content
function buildNotesMarkdown(problemInfo, notesText, timerValue, languageId) {
    const lines = [];
    lines.push(`# ${problemInfo.title}`);
    lines.push('');
    lines.push(`**Problem URL:** ${problemInfo.url || 'N/A'}`);
    lines.push(`**Language:** ${languageId || 'N/A'}`);
    lines.push(`**Saved At:** ${problemInfo.timestamp || new Date().toISOString()}`);
    
    if (timerValue) {
        lines.push(`**Time Taken:** ${timerValue}`);
    }
    
    if (notesText) {
        lines.push('');
        lines.push('## Notes');
        lines.push('');
        lines.push(notesText);
    }
    
    return lines.join('\n');
}

// Fetch the user's private LeetCode notes via the GraphQL API as a fallback,
// because the notes editor is not always mounted (e.g. when the Notes pane was
// never opened the DOM scraping finds nothing).
async function fetchLeetCodeNotes(titleSlug) {
    try {
        const response = await fetch('https://leetcode.com/graphql/', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                operationName: 'questionNote',
                query: 'query questionNote($titleSlug: String!) {\n  question(titleSlug: $titleSlug) {\n    questionId\n    note\n  }\n}' +
                    '\n    ',
                variables: { titleSlug: titleSlug }
            })
        });
        if (!response.ok) return null;
        const data = await response.json();
        const note = data && data.data && data.data.question && data.data.question.note;
        return (typeof note === 'string' && note.trim()) ? note.trim() : null;
    } catch (e) {
        return null;
    }
}

// Save solution to GitHub
async function handleSaveToGitHub(code, problemInfo, languageId, notesText, timerValue) {
    const settings = await getExtensionSettings();

    if (!settings.token || !settings.repo) {
        throw new Error('GitHub token or repository not configured in settings.');
    }

    // Format stable per-problem paths so repeated submissions update the same files.
    const { sanitizedTitle, directory: problemDir } = getProblemDirectory(problemInfo);

    // Fetch private notes when the notes editor was not mounted on the page.
    let finalNotesText = notesText || null;
    if (settings.saveNotesAndTimer && !finalNotesText && problemInfo.title) {
        finalNotesText = await fetchLeetCodeNotes(problemInfo.title);
    }

    // --- Commit 1: Code file ---
    const folderPrefix = getParentFolderPrefix(settings);
    const codeFilePath = getProblemFilePath(problemInfo, languageId, settings);
    const codeCommitMessage = `Save LeetCode solution: ${problemInfo.title} (${problemInfo.timestamp || new Date().toISOString()})`;

    const codeResult = await commitFileToGitHub(settings, codeFilePath, code, codeCommitMessage);

    // --- Commit 2: Notes/Timer markdown file (optional) ---
    let notesResult = null;
    let notesFilePath = null;
    if (settings.saveNotesAndTimer) {
        const notesMarkdown = buildNotesMarkdown(problemInfo, finalNotesText, timerValue, languageId);
        notesFilePath = `${folderPrefix}${problemDir}/${sanitizedTitle}-notes.md`;
        const notesCommitMessage = `Save notes for: ${problemInfo.title} (${problemInfo.timestamp || new Date().toISOString()})`;

        notesResult = await commitFileToGitHub(settings, notesFilePath, notesMarkdown, notesCommitMessage);
    }
    
    return {
        code: codeResult,
        notes: notesResult,
        repo: settings.repo,
        branch: settings.branch,
        codeFilePath,
        notesFilePath
    };
}
