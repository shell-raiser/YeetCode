document.addEventListener('DOMContentLoaded', function() {
    const githubTokenInput = document.getElementById('githubToken');
    const githubRepoInput = document.getElementById('githubRepo');
    const githubBranchInput = document.getElementById('githubBranch');
    const githubFolderInput = document.getElementById('githubFolder');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');

    // Load saved settings
    chrome.storage.sync.get([
        'githubToken',
        'githubRepo',
        'githubBranch',
        'githubFolder'
    ], function(items) {
        if (items.githubToken) {
            githubTokenInput.value = items.githubToken;
        }
        if (items.githubRepo) {
            githubRepoInput.value = items.githubRepo;
        }
        if (items.githubBranch) {
            githubBranchInput.value = items.githubBranch;
        }
        if (items.githubFolder) {
            githubFolderInput.value = items.githubFolder;
        }
    });

    // Save settings
    saveButton.addEventListener('click', function() {
        const token = githubTokenInput.value.trim();
        const repo = githubRepoInput.value.trim();
        const branch = githubBranchInput.value.trim() || 'main';
        const folder = githubFolderInput.value.trim() || 'leetcode';

        if (!token) {
            showStatus('Please enter your GitHub token', 'error');
            return;
        }

        if (!repo) {
            showStatus('Please enter your GitHub repository (owner/repo)', 'error');
            return;
        }

        // Validate repo format
        if (!repo.includes('/')) {
            showStatus('Repository must be in format: owner/repo', 'error');
            return;
        }

        chrome.storage.sync.set({
            githubToken: token,
            githubRepo: repo,
            githubBranch: branch,
            githubFolder: folder
        }, function() {
            showStatus('Settings saved successfully!', 'success');
        });
    });

    function showStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = 'status ' + type;
        // Clear status after 3 seconds
        setTimeout(function() {
            statusDiv.textContent = '';
            statusDiv.className = '';
        }, 3000);
    }
});