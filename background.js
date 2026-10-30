// Background service worker for YeetCode extension
// Handles all network requests to GitHub API to bypass CORS/CSP restrictions on LeetCode.com

console.log('YeetCode background service worker started');

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

function getExtensionForLanguage(langId) {
    if (!langId) return '.txt';
    const cleanLang = langId.toLowerCase().trim();
    return LANGUAGE_EXTENSIONS[cleanLang] || '.txt';
}

// Fetch extension settings from storage
async function getExtensionSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get([
            'githubToken',
            'githubRepo',
            'githubBranch',
            'githubFolder',
            'saveNotesAndTimer'
        ], function(items) {
            resolve({
                token: items.githubToken || '',
                repo: items.githubRepo || '',
                branch: items.githubBranch || 'main',
                folder: items.githubFolder || '',
                saveNotesAndTimer: items.saveNotesAndTimer !== undefined ? items.saveNotesAndTimer : true
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
    
    if (request.action === 'testConnection') {
        handleTestConnection(request.token, request.repo)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async response
    }
});

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
    const sanitizedTitle = problemInfo.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'unknown-problem';

    // Contest IDs and problem slugs are kept as separate path components.
    const contestFolder = problemInfo.isContest
        ? problemInfo.contestFolder ||
          (typeof problemInfo.subPath === 'string' ? problemInfo.subPath.split('/').filter(Boolean).pop() : '')
        : '';
    const sanitizedContestFolder = contestFolder
        ? contestFolder.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        : '';
    const problemDir = sanitizedContestFolder
        ? `contests/${sanitizedContestFolder}/${sanitizedTitle}`
        : sanitizedTitle;

    // Fetch private notes when the notes editor was not mounted on the page.
    let finalNotesText = notesText || null;
    if (settings.saveNotesAndTimer && !finalNotesText && problemInfo.title) {
        finalNotesText = await fetchLeetCodeNotes(problemInfo.title);
    }

    // --- Commit 1: Code file ---
    const ext = getExtensionForLanguage(languageId);
    const folderPrefix = settings.folder ? `${settings.folder}/` : '';
    const codeFilePath = `${folderPrefix}${problemDir}/${sanitizedTitle}${ext}`;
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
