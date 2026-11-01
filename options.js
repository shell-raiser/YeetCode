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
    const refreshAiModelsButton = document.getElementById('refreshAiModels');
    const aiModelStatus = document.getElementById('aiModelStatus');
    const nudgeAtMinutesInput = document.getElementById('nudgeAtMinutes');
    const deadlineAtMinutesInput = document.getElementById('deadlineAtMinutes');
    const minHelpMinutesInput = document.getElementById('minHelpMinutes');
    const solveTimerEnabledInput = document.getElementById('solveTimerEnabled');
    const conceptsList = document.getElementById('conceptsList');
    const addConceptButton = document.getElementById('addConcept');
    const aiAutoSaveStatus = document.getElementById('aiAutoSaveStatus');

    const testButton = document.getElementById('test');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');

    const DEFAULT_AI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
    const AI_SETTINGS_KEYS = [
        'aiEnabled',
        'aiEndpoint',
        'aiApiKey',
        'aiModel',
        'solveTimerEnabled',
        'nudgeAtMinutes',
        'deadlineAtMinutes',
        'minHelpMinutes',
        'concepts'
    ];

    const CONCEPT_LEVELS = ['not studied', 'low', 'medium', 'high'];
    const DEFAULT_CONCEPTS = [
        'Arrays & Hashing',
        'Two Pointers',
        'Sliding Window',
        'Stack',
        'Binary Search',
        'Linked List',
        'Trees',
        'Tries',
        'Heap / Priority Queue',
        'Backtracking',
        'Graphs',
        'Advanced Graphs',
        '1-D Dynamic Programming',
        '2-D Dynamic Programming',
        'Greedy',
        'Intervals',
        'Math & Geometry',
        'Bit Manipulation'
    ].map((name) => ({ name, level: 'not studied' }));
    let aiAutosaveTimer = null;
    let modelRefreshGeneration = 0;

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
        if (items.aiModel) setModelOptions([items.aiModel], items.aiModel);
        aiEnabledInput.checked = items.aiEnabled !== undefined ? items.aiEnabled : false;
        solveTimerEnabledInput.checked = items.solveTimerEnabled !== false;
        nudgeAtMinutesInput.value = clampInt(items.nudgeAtMinutes, 1, 180, 15);
        deadlineAtMinutesInput.value = clampInt(items.deadlineAtMinutes, 2, 360, 45);
        minHelpMinutesInput.value = clampInt(items.minHelpMinutes, 0, 180, 5);

        renderConcepts(items.concepts);
        ensureSeedConcepts();
        autoImportFromGitHubInput.checked = items.autoImportFromGitHub === true;
    });

    function setModelOptions(models, selectedModel) {
        const uniqueModels = [...new Set(models.filter(Boolean))];
        aiModelInput.replaceChildren(new Option('Select a model', ''));
        uniqueModels.forEach((model) => {
            aiModelInput.add(new Option(model, model));
        });
        if (selectedModel && !uniqueModels.includes(selectedModel)) {
            aiModelInput.add(new Option(`${selectedModel} (saved)`, selectedModel));
        }
        aiModelInput.value = selectedModel || '';
    }

    function getModelsEndpoint(endpoint) {
        const url = new URL(endpoint);
        const path = url.pathname.replace(/\/+$/, '');
        url.pathname = /\/chat\/completions$/i.test(path)
            ? path.replace(/\/chat\/completions$/i, '/models')
            : `${path}/models`;
        url.search = '';
        url.hash = '';
        return url.href;
    }

    function isGeminiEndpoint(endpoint) {
        return new URL(endpoint).hostname === 'generativelanguage.googleapis.com';
    }

    function safeEndpointForLogging(endpoint) {
        try {
            const url = new URL(endpoint);
            return `${url.origin}${url.pathname}`;
        } catch (error) {
            return '(invalid endpoint URL)';
        }
    }

    async function readProviderError(response) {
        try {
            const readableResponse = typeof response.clone === 'function' ? response.clone() : response;
            const payload = await readableResponse.json();
            return payload && payload.error && payload.error.message
                ? payload.error.message
                : (payload && payload.message) || '';
        } catch (error) {
            return '';
        }
    }

    async function refreshAiModels() {
        const generation = ++modelRefreshGeneration;
        const selectedModel = aiModelInput.value;
        const endpoint = aiEndpointInput.value.trim() || DEFAULT_AI_ENDPOINT;
        const apiKey = aiApiKeyInput.value.trim();

        if (!apiKey) {
            aiModelStatus.textContent = 'Enter an API key to load available models.';
            refreshAiModelsButton.disabled = false;
            return;
        }

        let modelsUrl;
        let originPattern;
        let isGemini;
        try {
            modelsUrl = getModelsEndpoint(endpoint);
            originPattern = originPatternForEndpoint(modelsUrl);
            if (!originPattern) throw new Error('Invalid API endpoint.');
            isGemini = isGeminiEndpoint(endpoint);
        } catch (error) {
            aiModelStatus.textContent = `Could not load models: ${error.message}`;
            refreshAiModelsButton.disabled = false;
            return;
        }

        aiModelStatus.textContent = 'Refreshing models…';
        refreshAiModelsButton.disabled = true;
        let authMethod = isGemini ? 'X-goog-api-key header' : 'Bearer authorization';
        let requestStatus = null;
        try {
            const hasPermission = await new Promise((resolve) => {
                chrome.permissions.contains({ origins: [originPattern] }, resolve);
            });
            if (!hasPermission) {
                const granted = await new Promise((resolve) => {
                    chrome.permissions.request({ origins: [originPattern] }, resolve);
                });
                if (!granted) throw new Error('Permission to access the model endpoint was denied.');
            }

            const response = await fetch(modelsUrl, {
                headers: isGemini
                    ? {
                        'Content-Type': 'application/json',
                        'X-goog-api-key': apiKey
                    }
                    : { Authorization: `Bearer ${apiKey}` }
            });
            requestStatus = response.status;
            if (!response.ok) {
                const detail = await readProviderError(response);
                throw new Error(`Model request failed (${response.status})${detail ? `: ${detail}` : '.'}`);
            }
            const payload = await response.json();
            const models = isGemini
                ? (Array.isArray(payload.models) ? payload.models
                    .filter((model) => model && typeof model.name === 'string' &&
                        (/^models\/gemini-/i.test(model.name) ||
                            (Array.isArray(model.supportedGenerationMethods) &&
                                model.supportedGenerationMethods.includes('interactions'))))
                    .map((model) => model.name && model.name.replace(/^models\//, ''))
                    .filter(Boolean) : [])
                : (Array.isArray(payload.data)
                    ? payload.data.map((model) => model && model.id).filter(Boolean)
                    : []);
            if (!models.length) throw new Error('The endpoint returned no models.');
            if (generation !== modelRefreshGeneration) return;

            setModelOptions(models, selectedModel);
            aiModelStatus.textContent = `${models.length} model${models.length === 1 ? '' : 's'} available.`;
        } catch (error) {
            if (generation === modelRefreshGeneration) {
                console.error('[YeetCode] AI model refresh failed', {
                    endpoint: safeEndpointForLogging(endpoint),
                    method: 'GET',
                    authMethod,
                    status: requestStatus,
                    error: error.message
                });
                aiModelStatus.textContent = `Could not load models: ${error.message}`;
            }
        } finally {
            if (generation === modelRefreshGeneration) {
                refreshAiModelsButton.disabled = false;
            }
        }
    }

    function getAiSettingsToSave() {
        const nudgeAtMinutes = clampInt(nudgeAtMinutesInput.value, 1, 180, 15);
        const deadlineAtMinutes = clampInt(deadlineAtMinutesInput.value, 2, 360, 45);
        return {
            aiEnabled: aiEnabledInput.checked,
            aiEndpoint: aiEndpointInput.value.trim() || DEFAULT_AI_ENDPOINT,
            aiApiKey: aiApiKeyInput.value.trim(),
            aiModel: aiModelInput.value.trim(),
            solveTimerEnabled: solveTimerEnabledInput.checked,
            nudgeAtMinutes,
            deadlineAtMinutes: Math.max(deadlineAtMinutes, Math.min(360, nudgeAtMinutes + 1)),
            minHelpMinutes: clampInt(minHelpMinutesInput.value, 0, 180, 5),
            concepts: collectConcepts()
        };
    }

    function flushAiAutosave() {
        if (aiAutosaveTimer) {
            clearTimeout(aiAutosaveTimer);
            aiAutosaveTimer = null;
        }
        chrome.storage.sync.set(getAiSettingsToSave(), function() {
            if (chrome.runtime.lastError) {
                aiAutoSaveStatus.textContent = `Auto-save failed: ${chrome.runtime.lastError.message}`;
                return;
            }
            aiAutoSaveStatus.textContent = 'AI settings saved automatically.';
        });
    }

    function scheduleAiAutosave() {
        aiAutoSaveStatus.textContent = 'Saving AI settings…';
        if (aiAutosaveTimer) clearTimeout(aiAutosaveTimer);
        aiAutosaveTimer = setTimeout(flushAiAutosave, 800);
    }

    function persistAiDraftOnExit() {
        if (aiAutosaveTimer) flushAiAutosave();
    }

    [...AI_SETTINGS_KEYS.map((key) => document.getElementById(key)), conceptsList].forEach((element) => {
        if (!element) return;
        element.addEventListener('input', scheduleAiAutosave);
        element.addEventListener('change', scheduleAiAutosave);
    });
    aiEnabledInput.addEventListener('change', function() {
        if (!aiEnabledInput.checked) {
            scheduleAiAutosave();
            return;
        }

        const originPattern = originPatternForEndpoint(aiEndpointInput.value.trim() || DEFAULT_AI_ENDPOINT);
        if (!originPattern) {
            aiEnabledInput.checked = false;
            aiAutoSaveStatus.textContent = 'AI settings not saved: enter a valid endpoint first.';
            return;
        }
        chrome.permissions.request({ origins: [originPattern] }, function(granted) {
            if (chrome.runtime.lastError || !granted) {
                aiEnabledInput.checked = false;
                aiAutoSaveStatus.textContent = 'AI Helper needs endpoint permission to be enabled.';
            }
            scheduleAiAutosave();
        });
    });
    conceptsList.addEventListener('click', (event) => {
        if (event.target.closest('.concept-remove')) scheduleAiAutosave();
    });
    addConceptButton.addEventListener('click', scheduleAiAutosave);
    aiModelInput.addEventListener('focus', refreshAiModels);
    aiModelInput.addEventListener('pointerdown', refreshAiModels);
    refreshAiModelsButton.addEventListener('click', refreshAiModels);
    window.addEventListener('pagehide', persistAiDraftOnExit);
    window.addEventListener('blur', persistAiDraftOnExit);

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
            solveTimerEnabled: solveTimerEnabledInput.checked,
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
