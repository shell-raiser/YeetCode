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

    if (request.action === 'githubDeviceFlowStart') {
        startGithubDeviceFlow(request.clientId)
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open for async response
    }

    if (request.action === 'githubDeviceFlowCancel') {
        cancelGithubDeviceFlow();
        sendResponse({ success: true });
        return false;
    }

    if (request.action === 'githubSignOut') {
        handleGithubSignOut()
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.action === 'githubGetUser') {
        handleGithubGetUser()
            .then(result => sendResponse({ success: true, result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

// ─────────────────────────────────────────────────────
// GitHub Sign-In via the OAuth 2.0 Device Flow (no client secret, no PAT)
// Docs: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
// ─────────────────────────────────────────────────────

const DEVICE_FLOW_URLS = {
    deviceCode: 'https://github.com/login/device/code',
    accessToken: 'https://github.com/login/oauth/access_token',
    verification: 'https://github.com/login/device',
    user: 'https://api.github.com/user'
};

// module-level session so a new start cancels a poll still in flight
let deviceFlowSession = null;

function sleepDeviceFlow(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function broadcastDeviceFlowStatus(status, extra) {
    try {
        chrome.runtime.sendMessage({ action: 'deviceFlowStatus', status, ...(extra || {}) }, function() {
            // No-window errors when no page is listening; ignore on purpose
            if (chrome.runtime.lastError) { /* ignore */ }
        });
    } catch (e) { /* ignore */ }
}

async function startGithubDeviceFlow(clientId) {
    const cleanClientId = (clientId || '').trim();
    if (!cleanClientId) {
        throw new Error('An OAuth App Client ID is required for Sign-In. Create an OAuth App at github.com/settings/applications/new (callback URL can be any placeholder), enable Device Flow on it, and paste its Client ID here.');
    }

    // Cancel any in-flight flow before starting a new one
    if (deviceFlowSession) {
        deviceFlowSession.canceled = true;
    }
    const session = { canceled: false };
    deviceFlowSession = session;

    let resp;
    try {
        resp = await fetch(DEVICE_FLOW_URLS.deviceCode, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_id: cleanClientId,
                scope: 'repo'
            })
        });
    } catch (error) {
        deviceFlowSession = null;
        throw new Error('Could not reach github.com to start Device Flow.');
    }

    let data;
    try {
        data = await resp.json();
    } catch (e) {
        deviceFlowSession = null;
        throw new Error('Unexpected response from github.com (not JSON).');
    }

    if (!resp.ok || data.error || !data.device_code || !data.user_code) {
        deviceFlowSession = null;
        let msg = `Device flow request failed: ${data.error || `HTTP ${resp.status}`}`;
        if (data.error === 'device_flow_disabled') {
            msg = 'Device Flow is not enabled for this OAuth App. Enable it on the app\'s settings page on github.com, then try again.';
        } else if (data.error_description) {
            msg += ` (${data.error_description})`;
        }
        throw new Error(msg);
    }

    // Fire-and-forget polling; results flow to the options page via deviceFlowStatus broadcasts
    pollDeviceFlowToken(session, cleanClientId, data).catch((error) => {
        if (!session.canceled) {
            broadcastDeviceFlowStatus('error', { message: error.message });
            if (deviceFlowSession === session) {
                deviceFlowSession = null;
            }
        }
    });

    return {
        userCode: data.user_code,
        verificationUri: data.verification_uri || DEVICE_FLOW_URLS.verification,
        expiresIn: data.expires_in || 900,
        interval: data.interval || 5
    };
}

function cancelGithubDeviceFlow() {
    if (deviceFlowSession) {
        deviceFlowSession.canceled = true;
    }
}

async function pollDeviceFlowToken(session, clientId, deviceCodeData) {
    let intervalMs = Math.max(50, (deviceCodeData.interval || 5) * 1000);
    const expiresAt = Date.now() + (deviceCodeData.expires_in || 900) * 1000;

    broadcastDeviceFlowStatus('pending', { userCode: deviceCodeData.user_code });

    while (!session.canceled && Date.now() < expiresAt) {
        await sleepDeviceFlow(intervalMs);
        if (session.canceled) break;

        let data = null;
        try {
            const resp = await fetch(DEVICE_FLOW_URLS.accessToken, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    client_id: clientId,
                    device_code: deviceCodeData.device_code,
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
                })
            });
            data = await resp.json();
        } catch (e) {
            // Transient network error — keep polling until the code expires
            continue;
        }

        if (data && data.access_token) {
            try {
                await storeDeviceFlowToken(data.access_token);
            } catch (e) {
                if (deviceFlowSession === session) {
                    deviceFlowSession = null;
                }
                broadcastDeviceFlowStatus('error', { message: e.message });
                return;
            }
            if (deviceFlowSession === session) {
                deviceFlowSession = null;
            }
            broadcastDeviceFlowStatus('success', { userCode: deviceCodeData.user_code });
            return;
        }

        switch (data && data.error) {
            case 'authorization_pending':
                broadcastDeviceFlowStatus('pending', { userCode: deviceCodeData.user_code });
                break;
            case 'slow_down':
                intervalMs = Math.max(50, (data.interval || intervalMs + 5) * 1000);
                break;
            case 'expired_token':
            case 'token_expired':
                if (deviceFlowSession === session) {
                    deviceFlowSession = null;
                }
                broadcastDeviceFlowStatus('expired');
                return;
            case 'access_denied':
                if (deviceFlowSession === session) {
                    deviceFlowSession = null;
                }
                broadcastDeviceFlowStatus('denied');
                return;
            default:
                if (deviceFlowSession === session) {
                    deviceFlowSession = null;
                }
                broadcastDeviceFlowStatus('error', { message: (data && (data.error_description || data.error)) || 'Unknown error' });
                return;
        }
    }

    // Loop exit without a token
    if (deviceFlowSession === session) {
        deviceFlowSession = null;
    }
    if (session.canceled) {
        broadcastDeviceFlowStatus('canceled');
    } else {
        broadcastDeviceFlowStatus('expired');
    }
}

function storeDeviceFlowToken(token) {
    return new Promise((resolve, reject) => {
        if (!token) {
            reject(new Error('GitHub did not return an access token.'));
            return;
        }
        chrome.storage.sync.set({ githubToken: token, githubAuthMethod: 'oauth' }, function() {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve({ stored: true });
        });
    });
}

// Sign out only clears tokens created by GitHub sign-in; a pasted PAT is kept
// untouched, tracked by githubAuthMethod.
async function handleGithubSignOut() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['githubAuthMethod'], function(items) {
            if (items.githubAuthMethod !== 'oauth') {
                resolve({ signedOut: false, reason: 'no OAuth sign-in session' });
                return;
            }
            chrome.storage.sync.remove(['githubToken', 'githubAuthMethod'], function() {
                broadcastDeviceFlowStatus('signed_out');
                resolve({ signedOut: true });
            });
        });
    });
}

async function handleGithubGetUser() {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get(['githubToken'], function(items) {
            const token = items.githubToken || '';
            if (!token) {
                reject(new Error('Not signed in.'));
                return;
            }
            fetch(DEVICE_FLOW_URLS.user, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }).then(async (resp) => {
                if (!resp.ok) {
                    let msg = `GitHub API Error: HTTP ${resp.status}`;
                    try {
                        const errData = await resp.json();
                        if (errData.message) msg = `GitHub API Error: ${errData.message}`;
                    } catch (e) { /* ignore */ }
                    if (resp.status === 401) {
                        msg = 'GitHub rejected the saved token (401). It may have been revoked — sign in again.';
                    }
                    reject(new Error(msg));
                    return;
                }
                const user = await resp.json();
                resolve({
                    login: user.login || '',
                    name: user.name || '',
                    scopes: resp.headers && resp.headers.get ? (resp.headers.get('X-OAuth-Scopes') || '') : ''
                });
            }).catch((e) => reject(new Error(`Could not reach GitHub API (${e.message}).`)));
        });
    });
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
            throw new Error(`Unauthorized: GitHub rejected the token (may be invalid, expired or revoked) (${errMsg}).`);
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
    
    // --- Commit 1: Code file ---
    const ext = getExtensionForLanguage(languageId);
    const folderPrefix = settings.folder ? `${settings.folder}/` : '';
    const codeFilePath = `${folderPrefix}${sanitizedTitle}/${sanitizedTitle}${ext}`;
    const codeCommitMessage = `Save LeetCode solution: ${problemInfo.title} (${problemInfo.timestamp || new Date().toISOString()})`;
    
    const codeResult = await commitFileToGitHub(settings, codeFilePath, code, codeCommitMessage);
    
    // --- Commit 2: Notes/Timer markdown file (optional) ---
    let notesResult = null;
    if (settings.saveNotesAndTimer) {
        const notesMarkdown = buildNotesMarkdown(problemInfo, notesText, timerValue, languageId);
        const notesFilePath = `${folderPrefix}${sanitizedTitle}/${sanitizedTitle}-notes.md`;
        const notesCommitMessage = `Save notes for: ${problemInfo.title} (${problemInfo.timestamp || new Date().toISOString()})`;
        
        notesResult = await commitFileToGitHub(settings, notesFilePath, notesMarkdown, notesCommitMessage);
    }
    
    return { code: codeResult, notes: notesResult };
}
