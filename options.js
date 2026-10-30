document.addEventListener('DOMContentLoaded', function() {
    const githubTokenInput = document.getElementById('githubToken');
    const githubRepoInput = document.getElementById('githubRepo');
    const githubBranchInput = document.getElementById('githubBranch');
    const githubFolderInput = document.getElementById('githubFolder');
    const saveNotesAndTimerInput = document.getElementById('saveNotesAndTimer');
    const toggleToken = document.getElementById('toggleToken');

    const githubClientIdInput = document.getElementById('githubClientId');
    const githubSignInButton = document.getElementById('githubSignIn');
    const githubSignOutButton = document.getElementById('githubSignOut');
    const githubAuthStatus = document.getElementById('githubAuthStatus');
    const deviceFlowBox = document.getElementById('deviceFlowBox');
    const deviceUserCodeEl = document.getElementById('deviceUserCode');
    const copyUserCodeEl = document.getElementById('copyUserCode');
    const openGithubDeviceEl = document.getElementById('openGithubDevice');
    const deviceFlowCancelEl = document.getElementById('deviceFlowCancel');
    const deviceFlowStatusTextEl = document.getElementById('deviceFlowStatusText');

    const testButton = document.getElementById('test');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');

    const TOKEN_KEYS_SYNC_COMPAT = ['gho_', 'ghu_', 'ghs_'];

    // Locally tracked sign-in state so Save does not mislabel an OAuth token as a PAT
    let githubAuthMethodState = '';
    let signedInLogin = '';

    function isOAuthFetchedToken(token) {
        return TOKEN_KEYS_SYNC_COMPAT.some(function(prefix) {
            return typeof token === 'string' && token.startsWith(prefix);
        });
    }

    // Load saved settings
    chrome.storage.sync.get([
        'githubToken',
        'githubRepo',
        'githubBranch',
        'githubFolder',
        'saveNotesAndTimer',
        'githubClientId',
        'githubAuthMethod'
    ], function(items) {
        if (items.githubToken) githubTokenInput.value = items.githubToken;
        if (items.githubRepo) githubRepoInput.value = items.githubRepo;
        if (items.githubBranch) githubBranchInput.value = items.githubBranch;
        if (items.githubFolder) githubFolderInput.value = items.githubFolder;
        if (items.githubClientId) githubClientIdInput.value = items.githubClientId;
        saveNotesAndTimerInput.checked = items.saveNotesAndTimer !== undefined ? items.saveNotesAndTimer : true;
        githubAuthMethodState = items.githubToken
            ? (items.githubAuthMethod || (isOAuthFetchedToken(items.githubToken) ? 'oauth' : 'pat'))
            : '';
        refreshGithubAuthUi();
    });

    // ── GitHub Sign-In (OAuth Device Flow) ───────────────────────────
    function setDeviceFlowBoxVisible(visible) {
        deviceFlowBox.style.display = visible ? 'block' : 'none';
    }

    function setDeviceFlowStatus(text) {
        deviceFlowStatusTextEl.textContent = text;
    }

    function refreshGithubAuthUi() {
        const token = githubTokenInput.value.trim();
        const signedIn = !!token && githubAuthMethodState === 'oauth';

        githubSignOutButton.style.display = signedIn ? 'block' : 'none';
        if (signedIn) {
            githubAuthStatus.textContent = signedInLogin
                ? `Signed in as ${signedInLogin} — a GitHub token is saved automatically for this extension only.`
                : 'Signed in — a GitHub token is saved automatically for this extension only.';
        } else if (token) {
            githubAuthStatus.textContent = 'Using a manually pasted token (PAT).';
        } else {
            githubAuthStatus.textContent = 'Not signed in. Paste a PAT below or use "Sign in with GitHub".';
        }
    }

    function showSignedInState() {
        chrome.storage.sync.get(['githubToken', 'githubAuthMethod'], function(items) {
            if (items.githubToken) {
                githubTokenInput.value = items.githubToken;
                githubAuthMethodState = items.githubAuthMethod || 'oauth';
                refreshGithubAuthUi();
                showStatus('GitHub sign-in successful!', 'success');
                // Fetch identity for a friendlier badge (best effort)
                chrome.runtime.sendMessage({ action: 'githubGetUser' }, function(response) {
                    if (chrome.runtime.lastError || !response || !response.success) {
                        return;
                    }
                    signedInLogin = (response.result && response.result.login) ? '@' + response.result.login : '';
                    refreshGithubAuthUi();
                });
            }
        });
    }

    githubSignInButton.addEventListener('click', function() {
        const clientId = (githubClientIdInput.value || '').trim();
        if (!clientId) {
            showStatus('An OAuth App Client ID is required. Create one at github.com/settings/applications/new and enable "Device Flow".', 'error');
            return;
        }

        setDeviceFlowBoxVisible(false);
        githubSignInButton.disabled = true;
        showStatus('Requesting a device code from github.com…', 'loading');

        chrome.runtime.sendMessage({ action: 'githubDeviceFlowStart', clientId: clientId }, function(response) {
            githubSignInButton.disabled = false;
            if (chrome.runtime.lastError) {
                showStatus(`Sign-in failed: ${chrome.runtime.lastError.message}`, 'error');
                return;
            }
            if (!response || !response.success) {
                showStatus(`Sign-in failed: ${(response && response.error) || 'Unknown error'}`, 'error');
                return;
            }

            const result = response.result;
            deviceUserCodeEl.textContent = result.userCode;
            setDeviceFlowBoxVisible(true);
            setDeviceFlowStatus(`Waiting for authorization — the code is valid for about ${Math.round((result.expiresIn || 900) / 60)} minutes.`);
        });
    });

    githubSignOutButton.addEventListener('click', function() {
        chrome.runtime.sendMessage({ action: 'githubSignOut' }, function(response) {
            if (chrome.runtime.lastError) {
                showStatus(`Sign out failed: ${chrome.runtime.lastError.message}`, 'error');
                return;
            }
            githubTokenInput.value = '';
            githubAuthMethodState = '';
            signedInLogin = '';
            setDeviceFlowBoxVisible(false);
            refreshGithubAuthUi();
            showStatus('Signed out of GitHub.', 'success');
        });
    });

    copyUserCodeEl.addEventListener('click', function() {
        const code = deviceUserCodeEl.textContent || '';
        const fallbackSelect = function() {
            // Fallback: select the code so the user can copy manually
            const range = document.createRange();
            range.selectNodeContents(deviceUserCodeEl);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code)
                .then(function() {
                    setDeviceFlowStatus('Code copied — paste it on the GitHub page.');
                })
                .catch(fallbackSelect);
        } else {
            fallbackSelect();
        }
    });

    openGithubDeviceEl.addEventListener('click', function() {
        window.open('https://github.com/login/device', '_blank');
    });

    deviceFlowCancelEl.addEventListener('click', function() {
        chrome.runtime.sendMessage({ action: 'githubDeviceFlowCancel' }, function() {
            if (chrome.runtime.lastError) { /* no listener; the background may still cancel */ }
        });
        setDeviceFlowBoxVisible(false);
        statusDiv.textContent = 'Sign-in canceled.';
        statusDiv.className = 'status';
    });

    // Listen for device flow status broadcasts from the background worker
    chrome.runtime.onMessage.addListener(function(request) {
        if (!request || request.action !== 'deviceFlowStatus') {
            return;
        }
        switch (request.status) {
            case 'pending':
                if (deviceFlowBox.style.display === 'none') {
                    if (request.userCode) {
                        deviceUserCodeEl.textContent = request.userCode;
                    }
                    setDeviceFlowBoxVisible(true);
                }
                setDeviceFlowStatus('Waiting for authorization…');
                break;
            case 'success':
                setDeviceFlowBoxVisible(false);
                showSignedInState();
                break;
            case 'denied':
                setDeviceFlowBoxVisible(false);
                showStatus('Access denied: you cancelled the authorization on GitHub. Sign in again to retry.', 'error');
                break;
            case 'expired':
                setDeviceFlowBoxVisible(false);
                showStatus('The one-time device code expired. Sign in again to get a new one.', 'error');
                break;
            case 'canceled':
                setDeviceFlowBoxVisible(false);
                statusDiv.textContent = 'Sign-in canceled.';
                statusDiv.className = 'status';
                break;
            case 'error':
                setDeviceFlowBoxVisible(false);
                showStatus(`Sign-in failed: ${request.message || 'Unknown error'}`, 'error');
                break;
            case 'signed_out':
                setDeviceFlowBoxVisible(false);
                break;
            default:
                break;
        }
    });

    // Toggle token password visibility
    toggleToken.addEventListener('change', function() {
        githubTokenInput.type = this.checked ? 'text' : 'password';
    });

    // Test GitHub API connection
    testButton.addEventListener('click', function() {
        const token = githubTokenInput.value.trim();
        const repo = githubRepoInput.value.trim();

        if (!token) {
            showStatus('Please sign in with GitHub, or paste a Personal Access Token first.', 'error');
            return;
        }

        if (!repo || !repo.includes('/')) {
            showStatus('Please enter a repository in "owner/repo" format.', 'error');
            return;
        }

        // Set loading status
        showStatus('Testing connection to GitHub repository...', 'loading');
        testButton.disabled = true;
        saveButton.disabled = true;

        chrome.runtime.sendMessage({
            action: 'testConnection',
            token: token,
            repo: repo
        }, function(response) {
            testButton.disabled = false;
            saveButton.disabled = false;

            if (chrome.runtime.lastError) {
                showStatus(`Connection failed: ${chrome.runtime.lastError.message}`, 'error');
                return;
            }

            if (response && response.success) {
                const details = response.result;
                const repoType = details.private ? 'private' : 'public';
                showStatus(`Success! Connected to ${repoType} repository: "${details.fullName}"`, 'success');
            } else {
                const errMsg = (response && response.error) ? response.error : 'Unknown error';
                showStatus(`Connection failed: ${errMsg}`, 'error');
            }
        });
    });

    // Save settings
    saveButton.addEventListener('click', function() {
        const token = githubTokenInput.value.trim();
        const repo = githubRepoInput.value.trim();
        const branch = githubBranchInput.value.trim();
        const folder = githubFolderInput.value.trim();
        const clientId = githubClientIdInput.value.trim();

        if (token && !repo) {
            showStatus('Please enter your GitHub repository (owner/repo).', 'error');
            return;
        }

        if (repo && !repo.includes('/')) {
            showStatus('Repository must be in "owner/repo" format (e.g., username/leetcode-solutions).', 'error');
            return;
        }

        const effectiveBranch = branch || 'main';

        saveButton.disabled = true;

        chrome.storage.sync.set({
            githubToken: token,
            githubRepo: repo,
            githubBranch: effectiveBranch,
            githubFolder: folder,
            saveNotesAndTimer: saveNotesAndTimerInput.checked,
            githubClientId: clientId,
            githubAuthMethod: token ? (isOAuthFetchedToken(token) ? 'oauth' : 'pat') : ''
        }, function() {
            saveButton.disabled = false;
            githubAuthMethodState = token ? (isOAuthFetchedToken(token) ? 'oauth' : 'pat') : '';
            refreshGithubAuthUi();
            showStatus('Settings saved successfully!', 'success');

            // Clear success status after 3 seconds
            setTimeout(function() {
                // If it's still showing success, clear it
                if (statusDiv.className.includes('success')) {
                    clearStatus();
                }
            }, 3000);
        });
    });

    function showStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = 'status ' + type;
    }

    function clearStatus() {
        statusDiv.textContent = '';
        statusDiv.className = 'status';
    }
});
