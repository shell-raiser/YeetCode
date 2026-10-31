document.addEventListener('DOMContentLoaded', function() {
    const githubTokenInput = document.getElementById('githubToken');
    const githubRepoInput = document.getElementById('githubRepo');
    const githubBranchInput = document.getElementById('githubBranch');
    const githubFolderInput = document.getElementById('githubFolder');
    const saveNotesAndTimerInput = document.getElementById('saveNotesAndTimer');
    const autoImportFromGitHubInput = document.getElementById('autoImportFromGitHub');
    const toggleToken = document.getElementById('toggleToken');

    const aiEnabledInput = document.getElementById('aiEnabled');
    const aiEndpointInput = document.getElementById('aiEndpoint');
    const aiApiKeyInput = document.getElementById('aiApiKey');
    const aiModelInput = document.getElementById('aiModel');
    const nudgeAtMinutesInput = document.getElementById('nudgeAtMinutes');
    const deadlineAtMinutesInput = document.getElementById('deadlineAtMinutes');
    const minHelpMinutesInput = document.getElementById('minHelpMinutes');
    const conceptsList = document.getElementById('conceptsList');
    const addConceptButton = document.getElementById('addConcept');

    const testButton = document.getElementById('test');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');

    const DEFAULT_AI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
    const AI_SETTINGS_KEYS = [
        'aiEnabled',
        'aiEndpoint',
        'aiApiKey',
        'aiModel',
        'nudgeAtMinutes',
        'deadlineAtMinutes',
        'minHelpMinutes',
        'concepts'
    ];

    const CONCEPT_LEVELS = ['not studied', 'low', 'medium', 'high'];
    const DEFAULT_CONCEPTS = [{ name: 'Graphs', level: 'not studied' }, { name: 'Dynamic Programming', level: 'not studied' }, { name: 'Trees', level: 'not studied' }, { name: 'Greedy', level: 'not studied' }];

    function clampInt(value, min, max, fallback) {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    }

    function createConceptRow(concept) {
        const row = document.createElement('div');
        row.className = 'concept-row';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'e.g., Graphs';
        nameInput.value = concept.name || '';
        nameInput.className = 'concept-name';

        const levelSelect = document.createElement('select');
        levelSelect.className = 'concept-level';
        CONCEPT_LEVELS.forEach(function(level) {
            const option = document.createElement('option');
            option.value = level;
            option.textContent = level;
            levelSelect.appendChild(option);
        });
        levelSelect.value = concept.level || 'not studied';

        const removeButton = document.createElement('button');
        removeButton.className = 'concept-remove';
        removeButton.textContent = '×';
        removeButton.title = 'Remove concept';
        removeButton.addEventListener('click', function() {
            row.remove();
        });

        row.appendChild(nameInput);
        row.appendChild(levelSelect);
        row.appendChild(removeButton);
        return row;
    }

    function renderConcepts(concepts) {
        conceptsList.innerHTML = '';
        (concepts && concepts.length ? concepts : []).forEach(function(concept) {
            conceptsList.appendChild(createConceptRow(concept));
        });
    }

    function ensureSeedConcepts() {
        if (!conceptsList.children.length) {
            DEFAULT_CONCEPTS.forEach(function(concept) {
                conceptsList.appendChild(createConceptRow(concept));
            });
        }
    }

    function collectConcepts() {
        const concepts = [];
        conceptsList.querySelectorAll('.concept-row').forEach(function(row) {
            const name = (row.querySelector('.concept-name').value || '').trim();
            const level = row.querySelector('.concept-level').value || 'not studied';
            if (name) {
                concepts.push({ name: name, level: level });
            }
        });
        return concepts;
    }

    function originPatternForEndpoint(endpoint) {
        try {
            return new URL(endpoint).origin + '/*';
        } catch (e) {
            return null;
        }
    }

    // Load saved settings
    chrome.storage.sync.get([
        'githubToken',
        'githubRepo',
        'githubBranch',
        'githubFolder',
        'saveNotesAndTimer',
        ...AI_SETTINGS_KEYS,
        'autoImportFromGitHub'
    ], function(items) {
        if (items.githubToken) githubTokenInput.value = items.githubToken;
        if (items.githubRepo) githubRepoInput.value = items.githubRepo;
        if (items.githubBranch) githubBranchInput.value = items.githubBranch;
        if (items.githubFolder) githubFolderInput.value = items.githubFolder;
        saveNotesAndTimerInput.checked = items.saveNotesAndTimer !== undefined ? items.saveNotesAndTimer : true;
        if (items.aiEndpoint) aiEndpointInput.value = items.aiEndpoint;
        if (items.aiApiKey) aiApiKeyInput.value = items.aiApiKey;
        if (items.aiModel) aiModelInput.value = items.aiModel;
        aiEnabledInput.checked = items.aiEnabled !== undefined ? items.aiEnabled : false;
        nudgeAtMinutesInput.value = clampInt(items.nudgeAtMinutes, 1, 180, 15);
        deadlineAtMinutesInput.value = clampInt(items.deadlineAtMinutes, 2, 360, 45);
        minHelpMinutesInput.value = clampInt(items.minHelpMinutes, 0, 180, 5);

        renderConcepts(items.concepts);
        ensureSeedConcepts();
        autoImportFromGitHubInput.checked = items.autoImportFromGitHub === true;
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
        const folder = githubFolderInput.value.trim();

        const aiEnabled = aiEnabledInput.checked;
        const aiEndpoint = (aiEndpointInput.value.trim() || DEFAULT_AI_ENDPOINT);
        const aiApiKey = aiApiKeyInput.value.trim();
        const aiModel = aiModelInput.value.trim();

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

        if (aiEnabled && !aiEndpoint) {
            showStatus('Please enter an AI API endpoint or disable the AI Helper.', 'error');
            return;
        }

        if (aiEnabled && !aiApiKey) {
            showStatus('Please enter your AI API key or disable the AI Helper.', 'error');
            return;
        }

        const settingsToSave = {
            githubToken: token,
            githubRepo: repo,
            githubBranch: branch,
            githubFolder: folder,
            saveNotesAndTimer: saveNotesAndTimerInput.checked,
            aiEnabled: aiEnabled,
            aiEndpoint: aiEndpointInput.value.trim() || DEFAULT_AI_ENDPOINT,
            aiApiKey: aiApiKey,
            aiModel: aiModel,
            nudgeAtMinutes: clampInt(nudgeAtMinutesInput.value, 1, 180, 15),
            deadlineAtMinutes: clampInt(deadlineAtMinutesInput.value, 2, 360, 45),
            minHelpMinutes: clampInt(minHelpMinutesInput.value, 0, 180, 5),
            concepts: collectConcepts(),
            autoImportFromGitHub: autoImportFromGitHubInput.checked
        };

        if (settingsToSave.deadlineAtMinutes <= settingsToSave.nudgeAtMinutes) {
            showStatus('Time limit must be greater than the AI check-in time.', 'error');
            return;
        }

        saveButton.disabled = true;

        const finishSave = function(permissionError) {
            chrome.storage.sync.set(settingsToSave, function() {
                saveButton.disabled = false;

                if (permissionError) {
                    showStatus(`Settings saved, but AI Helper needs site permission: ${permissionError}`, 'error');
                } else {
                    showStatus('Settings saved successfully!', 'success');
                }

                // Let open LeetCode tabs (content scripts) pick up the new AI settings
                if (chrome.runtime.sendMessage) {
                    chrome.runtime.sendMessage({ action: 'settingsUpdated' }, function() {
                        if (chrome.runtime.lastError) {
                            // No receiving tab; ignore
                        }
                    });
                }

                // Clear success status after 3 seconds
                setTimeout(function() {
                    // If it's still showing success, clear it
                    if (statusDiv.className.includes('success')) {
                        clearStatus();
                    }
                }, 3000);
            });
        };

        if (aiEnabled) {
            const pattern = originPatternForEndpoint(aiEndpoint);
            if (!pattern) {
                saveButton.disabled = false;
                showStatus('AI API Endpoint is not a valid URL.', 'error');
                return;
            }

            chrome.permissions.request({ origins: [pattern] }, function(granted) {
                if (chrome.runtime.lastError) {
                    finishSave(chrome.runtime.lastError.message);
                    return;
                }
                if (granted) {
                    finishSave(null);
                } else {
                    saveButton.disabled = false;
                    showStatus('AI Helper needs permission to reach the AI endpoint. Grant access and save again, or disable the AI Helper.', 'error');
                }
            });
        } else {
            finishSave(null);
        }
    });

    addConceptButton.addEventListener('click', function() {
        conceptsList.appendChild(createConceptRow({ name: '', level: 'not studied' }));
        const rows = conceptsList.querySelectorAll('.concept-name');
        if (rows.length) {
            rows[rows.length - 1].focus();
        }
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
