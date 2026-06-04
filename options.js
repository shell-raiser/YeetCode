document.addEventListener('DOMContentLoaded', function() {
    const githubTokenInput = document.getElementById('githubToken');
    const githubRepoInput = document.getElementById('githubRepo');
    const githubBranchInput = document.getElementById('githubBranch');
    const saveNotesAndTimerInput = document.getElementById('saveNotesAndTimer');
    const toggleTokenSpan = document.getElementById('toggleToken');
    
    const testButton = document.getElementById('test');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');

    // Load saved settings
    chrome.storage.sync.get([
        'githubToken',
        'githubRepo',
        'githubBranch',
        'saveNotesAndTimer'
    ], function(items) {
        if (items.githubToken) githubTokenInput.value = items.githubToken;
        if (items.githubRepo) githubRepoInput.value = items.githubRepo;
        if (items.githubBranch) githubBranchInput.value = items.githubBranch;
        saveNotesAndTimerInput.checked = items.saveNotesAndTimer !== undefined ? items.saveNotesAndTimer : true;
    });

    // Toggle token password visibility
    toggleTokenSpan.addEventListener('click', function() {
        if (githubTokenInput.type === 'password') {
            githubTokenInput.type = 'text';
            toggleTokenSpan.textContent = 'HIDE';
        } else {
            githubTokenInput.type = 'password';
            toggleTokenSpan.textContent = 'SHOW';
        }
    });

    // Test GitHub API connection
    testButton.addEventListener('click', function() {
        const token = githubTokenInput.value.trim();
        const repo = githubRepoInput.value.trim();

        if (!token) {
            showStatus('Please enter a GitHub Personal Access Token first.', 'error');
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
        const branch = githubBranchInput.value.trim() || 'main';

        if (!token) {
            showStatus('Please enter your GitHub Personal Access Token.', 'error');
            return;
        }

        if (!repo) {
            showStatus('Please enter your GitHub repository (owner/repo).', 'error');
            return;
        }

        if (!repo.includes('/')) {
            showStatus('Repository must be in "owner/repo" format (e.g., username/leetcode-solutions).', 'error');
            return;
        }

        saveButton.disabled = true;
        
        chrome.storage.sync.set({
            githubToken: token,
            githubRepo: repo,
            githubBranch: branch,
            saveNotesAndTimer: saveNotesAndTimerInput.checked
        }, function() {
            saveButton.disabled = false;
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
