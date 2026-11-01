// YeetCode Content Script
// Handles UI modification, Monaco editor extraction, submission tracking, notes, solve timing, and messaging

let isSubmitting = false;
let githubLookupTimer = null;
let lastGitHubLookupKey = null;
let githubLookupGeneration = 0;
let autoImportAttemptedSlug = null;
let lastObservedProblemSlug = null;
let lastGitHubSolutionResult = null;

const SAVER_SVG_URL = chrome.runtime.getURL('catcodeSmall.svg');
const YEET_BUTTON_HTML = `<img src="${SAVER_SVG_URL}" style="height:14px;width:16px;margin-right:4px" alt=""> Yeet`;

// Parse problem identity from a LeetCode pathname.
// Contest problems live under /contest/<id>/problems/<slug> (also seen with the
// plural /contests/<id>/problems/<slug> variant) and should be grouped in a
// separate folder from regular /problems/<slug> pages.
function parseProblemPath(pathname) {
    const parts = pathname.split('/').filter((part) => part);

    if (parts[0] === 'problems' && parts[1]) {
        return { title: parts[1], subPath: '', isContest: false, contestFolder: null };
    }

    if ((parts[0] === 'contest' || parts[0] === 'contests') && parts[2] === 'problems' && parts[3]) {
        return {
            title: parts[3],
            subPath: `contests/${parts[1]}`,
            isContest: true,
            contestFolder: parts[1]
        };
    }

    return null;
}

// Expose functions for testing
window.LeetCodeCodeSaver = {
    parseProblemPath,
    getProblemInfoFromUrl: function(urlString) {
        const url = new URL(urlString);
        const parsed = parseProblemPath(url.pathname);

        const timestamp = new Date().toISOString();
        if (parsed) {
            return {
                title: parsed.title,
                problemSlug: parsed.title,
                subPath: parsed.subPath,
                isContest: parsed.isContest,
                contestFolder: parsed.contestFolder,
                timestamp: timestamp,
                url: url.href
            };
        }

        return {
            title: 'unknown-problem',
            problemSlug: null,
            subPath: '',
            isContest: false,
            contestFolder: null,
            timestamp: timestamp,
            url: url.href
        };
    },
    getCodeFromEditor: function() {
        // Try to get code from Monaco editor
        if (window.monaco && window.monaco.editor) {
            const editors = window.monaco.editor.getEditors();
            if (editors.length > 0) {
                return editors[0].getValue();
            }
        }
        
        // Fallback: try to get from textarea
        const textarea = document.querySelector('textarea');
        if (textarea && textarea.value) {
            return textarea.value;
        }
        
        // Last resort: get from div with contenteditable
        const contentEditable = document.querySelector('[contenteditable="true"]');
        if (contentEditable) {
            return contentEditable.innerText;
        }
        
        throw new Error('Could not find code editor');
    }
};

// Listen for keyboard shortcuts to submit code (Ctrl+Enter or Cmd+Enter)
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        isSubmitting = true;
    }
}, true);

// Wait for the DOM to be fully loaded and observe for the editor and submit button
const observer = new MutationObserver(() => {
    scanPageForSaverHooks();
});

function scanPageForSaverHooks() {
    try {
        // 0. Track SPA navigation between problems for the AI helper session timer
        updateAiSessionForUrl();
        syncSolveTimerDisplay();

        // 1. Inject our custom manual button if it doesn't exist
        if (!document.getElementById('leetcode-saver-button')) {
            const submitButton = findSubmitButton();
            const editorContainer = findEditorContainer();

            if (submitButton && editorContainer) {
                createCustomButton(submitButton);
            }
        }

        // 1b. Inject the AI Helper button if it doesn't exist
        ensureAiButton();
        // 2. Attach submit button listener if not already done
        const submitButton = findSubmitButton();
        if (submitButton && !submitButton.dataset.hasSaveListener) {
            submitButton.dataset.hasSaveListener = 'true';
            submitButton.addEventListener('click', () => {
                isSubmitting = true;
            });
        }
        
        // 3. Monitor for submission success
        if (isSubmitting) {
            const isAccepted = checkSubmissionSuccess();
            if (isAccepted) {
                isSubmitting = false;
                triggerAutoSave();
            }
        }

        scheduleGitHubSolutionCheck();
    } catch (e) {
        // Ignore errors during DOM observation (e.g. during test teardown)
    }
}

// Re-attach the cached GitHub actions if LeetCode unmounted their container
// (pane switches and SPA re-renders wipe the submit button's flex row).
function refreshGitHubSolutionActions() {
    if (!lastGitHubSolutionResult) return;
    if (!document.getElementById('leetcode-open-github')) {
        showGitHubSolutionActions(lastGitHubSolutionResult);
    }
}

function scheduleGitHubSolutionCheck() {
    // LeetCode swaps the URL between /problems/<slug>/ and
    // /problems/<slug>/description/ on every pane click. Key off the slug so
    // those variants don't look like a brand new problem.
    const parsed = parseProblemPath(window.location.pathname);
    const slug = parsed ? parsed.title : null;

    if (slug !== lastObservedProblemSlug) {
        lastObservedProblemSlug = slug;
        lastGitHubLookupKey = null;
        autoImportAttemptedSlug = null;
        lastGitHubSolutionResult = null;
        githubLookupGeneration++;
        removeGitHubSolutionActions();
    }

    // Rebuild the buttons if LeetCode unmounted their row during a pane
    // switch. This only uses the cached result, so it never triggers a lookup.
    refreshGitHubSolutionActions();

    if (!parsed) {
        clearTimeout(githubLookupTimer);
        githubLookupTimer = null;
        return;
    }

    // Automatic lookup happens once per problem; later language changes are
    // picked up from the click/keydown listeners below.
    if (lastGitHubLookupKey) {
        clearTimeout(githubLookupTimer);
        githubLookupTimer = null;
        return;
    }

    clearTimeout(githubLookupTimer);
    githubLookupTimer = setTimeout(checkGitHubSolutionForCurrentLanguage, 500);
}

// The editor can be focused (or its language swapped) long after the page
// loaded, so re-check on interaction without ever polling in a loop.
function handleEditorInteraction() {
    if (!parseProblemPath(window.location.pathname)) return;
    clearTimeout(githubLookupTimer);
    githubLookupTimer = setTimeout(checkGitHubSolutionForCurrentLanguage, 500);
}

document.addEventListener('click', (e) => {
    const target = e.target;
    if (target && target.closest && target.closest('.monaco-editor, [contenteditable="true"], #editor-container')) {
        handleEditorInteraction();
    }
}, true);

document.addEventListener('keydown', (e) => {
    const target = e.target;
    if (target && target.closest && target.closest('.monaco-editor, [contenteditable="true"], #editor-container')) {
        handleEditorInteraction();
    }
}, true);

async function checkGitHubSolutionForCurrentLanguage() {
    const parsed = parseProblemPath(window.location.pathname);
    if (!parsed) return;
    const slug = parsed.title;
    const problemInfo = getProblemInfo();
    if (problemInfo.title === 'unknown-problem') return;

    let editor;
    try {
        editor = await getCodeAndLanguageFromPage();
    } catch (error) {
        return;
    }

    const currentParsed = parseProblemPath(window.location.pathname);
    if (!currentParsed || currentParsed.title !== slug) return;
    if (!editor.languageId || editor.languageId === 'txt') return;
    const lookupKey = `${slug}:${editor.languageId}`;
    if (lookupKey === lastGitHubLookupKey) return;
    lastGitHubLookupKey = lookupKey;
    removeGitHubSolutionActions();
    lastGitHubSolutionResult = null;
    const generation = ++githubLookupGeneration;
    const allowAutoImport = autoImportAttemptedSlug !== slug;
    autoImportAttemptedSlug = slug;

    chrome.runtime.sendMessage({
        action: 'checkGitHubSolution',
        problemInfo,
        languageId: editor.languageId,
        editorCode: editor.code,
        allowAutoImport
    }, function(response) {
        if (generation !== githubLookupGeneration) return;
        if (chrome.runtime.lastError) {
            showStatusMessage(`GitHub lookup failed: ${chrome.runtime.lastError.message}`, 'error');
            return;
        }
        if (!response || !response.success) {
            const error = response && response.error ? response.error : 'Unknown background error';
            showStatusMessage(`GitHub lookup failed: ${error}`, 'error');
            return;
        }

        const result = response.result;
        if (!result.configured) return;
        if (!result.found) {
            const currentParsed = parseProblemPath(window.location.pathname);
            if (currentParsed && currentParsed.title === slug) {
                showStatusMessage(`No saved solution found for ${getLanguageLabel(editor.languageId)}.`, 'error');
            }
            return;
        }

        lastGitHubSolutionResult = result;
        showGitHubSolutionActions(result);
        if (result.autoImported) {
            showStatusMessage(`Imported the ${getLanguageLabel(result.languageId)} solution from GitHub.`, 'success');
        } else if (result.autoImportError) {
            showStatusMessage(`Automatic import skipped: ${result.autoImportError}`, 'error');
        }
    });
}

// Start observer
if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
    scanPageForSaverHooks();
} else {
    document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
        scanPageForSaverHooks();
    });
}

function findSubmitButton() {
    // 1. Selector for new LeetCode layout
    let btn = document.querySelector('button[data-testid="judge-button"]');
    if (btn) return btn;
    
    // 2. Fallback: Selector for type="submit"
    btn = document.querySelector('button[type="submit"]');
    if (btn) return btn;

    // 3. Fallback: Search all buttons for text content "Submit"
    const buttons = document.querySelectorAll('button');
    for (const button of buttons) {
        if (button.textContent.trim() === 'Submit') {
            return button;
        }
    }

    return null;
}

function findEditorContainer() {
    return document.querySelector('.monaco-editor') ||
           document.querySelector('#editor-container') ||
           document.querySelector('.editor-container-placeholder') ||
           document.querySelector('[contenteditable="true"]');
}

function checkSubmissionSuccess() {
    const successSelectors = [
        '[data-key="submission-title"]',
        '[data-e2e-locator="console-result"]',
        '.success__3Ai7',
        '.text-success',
        '.text-green-s',
        '[class*="result-success"]',
        '[class*="success"]'
    ];
    
    // 1. Check known selectors first
    for (const selector of successSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.includes('Accepted')) {
            return true;
        }
    }
    
    // 2. Fallback: Search all relevant text elements for the exact word "Accepted"
    const elements = document.querySelectorAll('span, div, p');
    for (const el of elements) {
        if (el.textContent.trim() === 'Accepted') {
            return true;
        }
    }
    
    return false;
}

function createCustomButton(submitButton) {
    // Create our custom button
    const customButton = document.createElement('button');
    customButton.id = 'leetcode-saver-button';
    customButton.innerHTML = YEET_BUTTON_HTML;
    customButton.style.marginLeft = '8px';
    customButton.style.padding = '6px 12px';
    customButton.style.backgroundColor = '#d3d3d3';
    customButton.style.color = '#333333';
    customButton.style.border = 'none';
    customButton.style.borderRadius = '4px';
    customButton.style.cursor = 'pointer';
    customButton.style.fontSize = '14px';
    customButton.style.fontWeight = 'bold';
    customButton.style.transition = 'background-color 0.2s';
    customButton.style.display = 'inline-flex';
    customButton.style.alignItems = 'center';
    customButton.style.justifyContent = 'center';
    customButton.style.alignSelf = 'center';
    customButton.style.boxSizing = 'border-box';
    customButton.style.height = '32px';
    customButton.style.lineHeight = '1';
    
    // Add hover effect
    customButton.addEventListener('mouseover', function() {
        customButton.style.backgroundColor = '#b0b0b0';
    });
    
    customButton.addEventListener('mouseout', function() {
        customButton.style.backgroundColor = '#d3d3d3';
    });
    
    const actionsRow = getOrCreateActionsRow(submitButton);
    if (!actionsRow) return;
    actionsRow.appendChild(customButton);
    
    // Add click event listener
    customButton.addEventListener('click', async function() {
        customButton.textContent = 'Saving...';
        customButton.disabled = true;
        
        try {
            // Get code and language from the main page world
            const { code, languageId } = await getCodeAndLanguageFromPage();
            
            if (!code) {
                throw new Error('Retrieved solution code is empty.');
            }
            
            const problemInfo = getProblemInfo();
            const notesText = getNotesValue();
            const timerValue = getTimerValue();
            
            // Send save message to background script
            chrome.runtime.sendMessage({
                action: 'saveToGitHub',
                code: code,
                problemInfo: problemInfo,
                languageId: languageId,
                notesText: notesText,
                timerValue: timerValue
            }, function(response) {
                customButton.disabled = false;
                customButton.innerHTML = YEET_BUTTON_HTML;
                
                if (chrome.runtime.lastError) {
                    console.error('Runtime error:', chrome.runtime.lastError);
                    showStatusMessage(`Error: ${chrome.runtime.lastError.message}`, 'error');
                    return;
                }
                
                if (response && response.success) {
                    customButton.textContent = 'Saved!';
                    setTimeout(() => {
                        customButton.innerHTML = YEET_BUTTON_HTML;
                    }, 2000);
                    showStatusMessage('Code saved to GitHub successfully!', 'success');

                    // Add "View on GitHub" button if we have file info
                    if (response.result && response.result.codeFilePath) {
                        showGitHubLink(response.result);
                    }
                } else {
                    const errorMsg = (response && response.error) ? response.error : 'Unknown background error';
                    showStatusMessage(`Error: ${errorMsg}`, 'error');
                }
            });
            
        } catch (error) {
            console.error('Error saving to GitHub:', error);
            customButton.innerHTML = YEET_BUTTON_HTML;
            customButton.disabled = false;
            showStatusMessage(`Error: ${error.message}`, 'error');
        }
    });
}

async function triggerAutoSave() {
    showStatusMessage('Auto-saving solution to GitHub...', 'success');
    
    try {
        const { code, languageId } = await getCodeAndLanguageFromPage();
        if (!code) {
            throw new Error('Solution code is empty.');
        }
        
        const problemInfo = getProblemInfo();
        const notesText = getNotesValue();
        const timerValue = getTimerValue();
        
        chrome.runtime.sendMessage({
            action: 'saveToGitHub',
            code: code,
            problemInfo: problemInfo,
            languageId: languageId,
            notesText: notesText,
            timerValue: timerValue
        }, function(response) {
            if (chrome.runtime.lastError) {
                console.error('Auto-save Runtime error:', chrome.runtime.lastError);
                showStatusMessage(`Auto-save Error: ${chrome.runtime.lastError.message}`, 'error');
                return;
            }
            
            if (response && response.success) {
                showStatusMessage('Auto-saved to GitHub successfully!', 'success');
                if (response.result && response.result.codeFilePath) {
                    showGitHubLink(response.result);
                }
                const manualButton = document.getElementById('leetcode-saver-button');
                if (manualButton) {
                    manualButton.textContent = 'Auto-Saved!';
                    setTimeout(() => {
                        manualButton.innerHTML = YEET_BUTTON_HTML;
                    }, 2000);
                }
            } else {
                const errorMsg = (response && response.error) ? response.error : 'Unknown background error';
                showStatusMessage(`Auto-save Error: ${errorMsg}`, 'error');
            }
        });
    } catch (error) {
        console.error('Auto-save Error:', error);
        showStatusMessage(`Auto-save Error: ${error.message}`, 'error');
    }
}

// Reads the editor directly when Monaco is reachable from this context.
// Returns null when it is not, so callers can fall back to the page bridge.
function readEditorDirectly() {
    if (!window.monaco || !window.monaco.editor) return null;

    const editors = typeof window.monaco.editor.getEditors === 'function'
        ? window.monaco.editor.getEditors()
        : [];

    if (editors.length > 0) {
        const editor = editors[0];
        const model = typeof editor.getModel === 'function' ? editor.getModel() : null;
        const code = editor.getValue();
        const languageId = model && typeof model.getLanguageId === 'function'
            ? model.getLanguageId()
            : 'txt';
        if (code !== null && code !== undefined) {
            return { code, languageId };
        }
    }

    return null;
}

// Injects script to retrieve Monaco Editor value from page's MAIN world context
async function getCodeAndLanguageFromPage() {
    const direct = readEditorDirectly();
    if (direct) return direct;

    return new Promise((resolve, reject) => {
        let settled = false;
        let script = null;

        const cleanup = () => {
            document.removeEventListener('LeetCodeCodeSaver_CodeExtracted', handleEvent);
            if (script && script.parentNode) {
                script.parentNode.removeChild(script);
            }
        };

        const resolveFromDomFallback = (errorMessage) => {
            try {
                const code = window.LeetCodeCodeSaver.getCodeFromEditor();
                resolve({ code, languageId: 'txt' });
            } catch (e) {
                reject(new Error(errorMessage));
            }
        };

        // Set timeout in case injection or event does not respond
        const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            resolveFromDomFallback('Retrieval timed out: Unable to read editor.');
        }, 1000);

        const handleEvent = (event) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            cleanup();
            if (event.detail && event.detail.code !== null) {
                resolve({
                    code: event.detail.code,
                    languageId: event.detail.languageId || 'txt'
                });
            } else {
                resolveFromDomFallback('Editor is empty or could not be read.');
            }
        };

        document.addEventListener('LeetCodeCodeSaver_CodeExtracted', handleEvent);

        // Load an extension-hosted bridge script into the page context.
        // Inline script injection is blocked by LeetCode's CSP.
        script = document.createElement('script');
        script.src = chrome.runtime.getURL('pageBridge.js');
        script.onload = () => {
            if (script && script.parentNode) {
                script.parentNode.removeChild(script);
            }
        };
        script.onerror = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            cleanup();
            resolveFromDomFallback('Unable to load editor bridge script.');
        };
        (document.head || document.documentElement).appendChild(script);
    });
}

function getProblemInfo() {
    const url = new URL(window.location.href);
    const parsed = parseProblemPath(url.pathname);
    let problemTitle = parsed ? parsed.title : 'unknown-problem';
    const subPath = parsed ? parsed.subPath : '';

    if (!parsed || !parsed.isContest) {
        const titleElement = document.querySelector('.title') ||
                            document.querySelector('h1') ||
                            document.querySelector('[data-cy="problem-title"]');

        if (titleElement && titleElement.textContent.trim()) {
            const headingSlug = titleElement.textContent.trim()
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, '-')
                          .replace(/^-+|-+$/g, '');
            if (headingSlug) {
                problemTitle = headingSlug;
            }
        }
    }

    const timestamp = new Date().toISOString();

    return {
        title: problemTitle,
        problemSlug: parsed ? parsed.title : null,
        subPath: subPath,
        isContest: parsed ? parsed.isContest : false,
        contestFolder: parsed ? parsed.contestFolder : null,
        timestamp: timestamp,
        url: url.href
    };
}

function getNotesValue() {
    // Try to get notes from DOM selectors first
    const noteSelectors = [
        '[aria-label*="note" i]',
        '[aria-labelledby*="note" i]',
        '[role="textbox"][aria-label*="note" i]',
        '[contenteditable="true"][aria-label*="note" i]',
        'textarea[placeholder*="note" i]',
        'textarea[placeholder*="Write a note" i]',
        'input[placeholder*="note" i]',
        'div[data-placeholder*="note" i]',
        'div[data-placeholder*="Write a note" i]',
        '.EasyMDEContainer .CodeMirror-code',
        '.EasyMDEContainer .CodeMirror',
        '.CodeMirror-code',
        '.ProseMirror',
        '.ql-editor',
        '.note-editor textarea',
        '#note-editor textarea',
        '[class*="note-editor"] textarea',
        '[class*="note-content"]',
        '[class*="note-editor"] [contenteditable="true"]',
        '[class*="notes"] [contenteditable="true"]',
        '[class*="note"] [role="textbox"]',
        '.qd-notes-textarea',
        '[data-testid="notes-editor"] textarea',
        '[data-testid="notes-editor"] [contenteditable="true"]'
    ];
    
    for (const selector of noteSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
            const val = getElementTextValue(el);
            if (isLikelyUserNote(val)) return val;
        }
    }
    
    const noteContainers = document.querySelectorAll('[class*="note" i], [id*="note" i], [data-testid*="note" i]');
    for (const container of noteContainers) {
        const noteFields = container.querySelectorAll('[contenteditable="true"], [role="textbox"], textarea, input, .ProseMirror, .ql-editor');
        for (const field of noteFields) {
            const val = getElementTextValue(field);
            if (isLikelyUserNote(val)) return val;
        }

        const containerText = getElementTextValue(container);
        if (isLikelyUserNote(containerText)) return containerText;
    }

    // Fallback to localStorage
    return getNotesValueFromStorage();
}

function getElementTextValue(el) {
    if (!el) return '';
    const tagName = el.tagName ? el.tagName.toUpperCase() : '';
    if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
        return (el.value || '').trim();
    }

    if (el.classList && (el.classList.contains('CodeMirror') || el.classList.contains('CodeMirror-code'))) {
        return getCodeMirrorTextValue(el);
    }

    const text = (el.innerText || el.textContent || '').trim();
    return text.replace(/\n{3,}/g, '\n\n');
}

function getCodeMirrorTextValue(el) {
    const root = el.classList.contains('CodeMirror-code') ? el : el.querySelector('.CodeMirror-code');
    if (!root) return '';

    const lines = Array.from(root.querySelectorAll('.CodeMirror-line'))
        .map(line => (line.innerText || line.textContent || '').replace(/\u00a0/g, ' ').trim());

    return lines.join('\n').trim();
}

function isLikelyUserNote(value) {
    if (!value) return false;

    const normalized = value.trim();
    if (!normalized) return false;

    const ignoredValues = [
        'notes',
        'note',
        'write a note',
        'write notes',
        'add note',
        'add notes'
    ];

    return !ignoredValues.includes(normalized.toLowerCase());
}

function getNotesValueFromStorage() {
    try {
        const candidates = [];

        // Check localStorage for LeetCode-specific keys
        const leetcodeKeys = [
            'leetcode.notes',
            'leetcode.user.notes',
            'lc_notes',
            'notes',
            'note',
            'notepad',
            'notebook'
        ];

        // First check known LeetCode keys
        for (const key of leetcodeKeys) {
            const value = window.localStorage.getItem(key);
            if (value) {
                collectNoteCandidates(value, candidates);
            }
        }

        // Then check all localStorage keys that might contain notes
        for (let i = 0; i < window.localStorage.length; i += 1) {
            const key = window.localStorage.key(i);
            if (!key || !/notes?|notepad|notebook/i.test(key)) continue;

            const value = window.localStorage.getItem(key);
            collectNoteCandidates(value, candidates);
        }

        // Also check sessionStorage
        try {
            for (let i = 0; i < window.sessionStorage.length; i += 1) {
                const key = window.sessionStorage.key(i);
                if (!key || !/notes?|notepad|notebook/i.test(key)) continue;
                const value = window.sessionStorage.getItem(key);
                collectNoteCandidates(value, candidates);
            }
        } catch (e) {
            // Ignore sessionStorage errors
        }

        candidates.sort((a, b) => b.length - a.length);
        return candidates[0] || null;
    } catch (e) {
        return null;
    }
}

function collectNoteCandidates(value, candidates) {
    if (value === null || value === undefined) return;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return;

        try {
            collectNoteCandidates(JSON.parse(trimmed), candidates);
            return;
        } catch (e) {
            if (isLikelyUserNote(trimmed)) {
                candidates.push(trimmed);
            }
            return;
        }
    }

    if (Array.isArray(value)) {
        value.forEach(item => collectNoteCandidates(item, candidates));
        return;
    }

    if (typeof value === 'object') {
        Object.values(value).forEach(item => collectNoteCandidates(item, candidates));
    }
}

function getTimerValue() {
    if (!AI_HELPER.settingsLoaded || !AI_HELPER.settings.solveTimerEnabled || AI_HELPER.sessionStartMs === null) {
        return null;
    }

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - AI_HELPER.sessionStartMs) / 1000));
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;
    return hours > 0
        ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function syncSolveTimerDisplay() {
    const timerDisplayId = 'yc-solve-timer';
    const timerDisplay = document.getElementById(timerDisplayId);
    const timerValue = getTimerValue();
    const nativeTimer = document.querySelector('[aria-label="Timer"]');

    if (!timerValue) {
        if (timerDisplay) timerDisplay.remove();
        document.querySelectorAll('[data-yc-timer-hidden="true"]').forEach((element) => {
            element.style.display = element.dataset.ycOriginalDisplay || '';
            delete element.dataset.ycOriginalDisplay;
            delete element.dataset.ycTimerHidden;
        });
        return;
    }

    let display = timerDisplay;
    if (!display) {
        display = document.createElement('div');
        display.id = timerDisplayId;
        display.setAttribute('role', 'timer');
        display.setAttribute('aria-label', 'YeetCode elapsed solve time');
        display.title = 'Elapsed solve time tracked by YeetCode';
    }

    if (nativeTimer && nativeTimer.parentElement) {
        const nativeTimerContainer = nativeTimer.parentElement;
        if (nativeTimerContainer.dataset.ycTimerHidden !== 'true') {
            nativeTimerContainer.dataset.ycOriginalDisplay = nativeTimerContainer.style.display;
            nativeTimerContainer.dataset.ycTimerHidden = 'true';
        }
        nativeTimerContainer.style.setProperty('display', 'none', 'important');
        if (display.parentElement !== nativeTimerContainer.parentElement) {
            display.className = 'flex h-8 flex-none items-center text-sd-muted-foreground';
            display.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:0 10px;font-variant-numeric:tabular-nums;white-space:nowrap;';
            nativeTimerContainer.parentElement.insertBefore(display, nativeTimerContainer);
        }
    } else if (!display.isConnected) {
        display.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99997;padding:8px 10px;border-radius:6px;background:#1f2937;color:#fff;font:12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;';
        document.body.appendChild(display);
    }

    if (display.textContent !== timerValue) {
        display.textContent = timerValue;
    }
}

function showGitHubLink(result) {
    showGitHubSolutionActions(result);
}

function getLanguageLabel(languageId) {
    const labels = {
        cpp: 'C++',
        csharp: 'C#',
        javascript: 'JavaScript',
        python: 'Python',
        python3: 'Python 3',
        golang: 'Go'
    };
    return labels[languageId] || languageId;
}

function styleGitHubAction(element, backgroundColor) {
    element.style.padding = '6px 12px';
    element.style.backgroundColor = backgroundColor;
    element.style.color = '#ffffff';
    element.style.border = 'none';
    element.style.borderRadius = '4px';
    element.style.cursor = 'pointer';
    element.style.fontSize = '12px';
    element.style.fontWeight = 'bold';
    element.style.textDecoration = 'none';
    element.style.display = 'inline-flex';
    element.style.alignItems = 'center';
    element.style.justifyContent = 'center';
    element.style.alignSelf = 'center';
    element.style.gap = '5px';
    element.style.boxSizing = 'border-box';
    element.style.height = '32px';
    element.style.lineHeight = '1';
}

function showGitHubSolutionActions(result) {
    // Cache so the actions can be rebuilt after LeetCode unmounts their row.
    lastGitHubSolutionResult = result;
    removeGitHubSolutionActions();

    const path = result.codeFilePath.split('/').map(encodeURIComponent).join('/');
    const branch = result.branch.split('/').map(encodeURIComponent).join('/');
    const ghUrl = `https://github.com/${result.repo}/blob/${branch}/${path}`;

    const openLink = document.createElement('a');
    openLink.id = 'leetcode-open-github';
    openLink.href = ghUrl;
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    const githubIcon = document.createElement('img');
    githubIcon.src = chrome.runtime.getURL('GITHUB_LOGO.svg');
    githubIcon.alt = '';
    githubIcon.setAttribute('aria-hidden', 'true');
    githubIcon.style.width = '14px';
    githubIcon.style.height = '14px';
    openLink.append(githubIcon, document.createTextNode('Open'));
    styleGitHubAction(openLink, '#238636');

    const importButton = document.createElement('button');
    importButton.id = 'leetcode-import-github';
    importButton.type = 'button';
    const arrowIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowIcon.setAttribute('viewBox', '0 0 16 16');
    arrowIcon.setAttribute('width', '14');
    arrowIcon.setAttribute('height', '14');
    arrowIcon.setAttribute('aria-hidden', 'true');
    arrowIcon.innerHTML = '<path d="M4 12 12 4M5 4h7v7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
    importButton.append(arrowIcon, document.createTextNode('Import'));
    importButton.title = 'Replace the current LeetCode editor contents with this saved solution';
    styleGitHubAction(importButton, '#0969da');
    importButton.addEventListener('click', () => importGitHubSolution(importButton));

    const container = getOrCreateActionsRow();
    if (container) {
        container.append(openLink, importButton);
    }
}

// Keep all YeetCode actions in one row. Recreate it after LeetCode replaces
// the submit controls during a pane switch.
function getOrCreateActionsRow(submitButton = findSubmitButton()) {
    const existingRow = document.getElementById('leetcode-actions-row');
    if (existingRow && existingRow.isConnected) return existingRow;

    const row = document.createElement('div');
    row.id = 'leetcode-actions-row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.flexWrap = 'wrap';
    row.style.gap = '8px';

    if (submitButton) {
        const submitWrapper = submitButton.parentNode && submitButton.parentNode.parentNode;
        const flexContainer = submitWrapper && submitWrapper.parentNode;
        if (flexContainer) {
            flexContainer.insertBefore(row, submitWrapper.nextSibling);
            return row;
        }
    }

    return null;
}

function removeGitHubSolutionActions() {
    const actionIds = [
        'leetcode-open-github',
        'leetcode-import-github'
    ];
    for (const id of actionIds) {
        const existing = document.getElementById(id);
        if (existing) existing.remove();
    }
}

async function importGitHubSolution(importButton) {
    importButton.disabled = true;
    try {
        const { languageId } = await getCodeAndLanguageFromPage();
        if (!languageId || languageId === 'txt') {
            throw new Error('Could not detect the selected LeetCode language.');
        }

        chrome.runtime.sendMessage({
            action: 'importFromGitHub',
            problemInfo: getProblemInfo(),
            languageId
        }, function(response) {
            importButton.disabled = false;
            if (chrome.runtime.lastError) {
                showStatusMessage(`Import failed: ${chrome.runtime.lastError.message}`, 'error');
                return;
            }
            if (!response || !response.success) {
                const error = response && response.error ? response.error : 'Unknown background error';
                showStatusMessage(`Import failed: ${error}`, 'error');
                return;
            }

            if (!response.result.found) {
                showStatusMessage(`No saved solution found for ${getLanguageLabel(languageId)}.`, 'error');
                return;
            }

            showGitHubSolutionActions(response.result);
            showStatusMessage(`Imported the ${getLanguageLabel(languageId)} solution from GitHub.`, 'success');
        });
    } catch (error) {
        importButton.disabled = false;
        showStatusMessage(`Import failed: ${error.message}`, 'error');
    }
}

function showStatusMessage(message, type) {
    const existingStatus = document.querySelector('#leetcode-saver-status');
    if (existingStatus) {
        existingStatus.remove();
    }
    
    const statusDiv = document.createElement('div');
    statusDiv.id = 'leetcode-saver-status';
    statusDiv.textContent = message;
    statusDiv.style.position = 'fixed';
    statusDiv.style.top = '20px';
    statusDiv.style.right = '20px';
    statusDiv.style.padding = '12px 24px';
    statusDiv.style.borderRadius = '6px';
    statusDiv.style.fontSize = '14px';
    statusDiv.style.fontWeight = '500';
    statusDiv.style.zIndex = '99999';
    statusDiv.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    statusDiv.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    statusDiv.style.transition = 'all 0.3s ease';
    
    if (type === 'success') {
        statusDiv.style.backgroundColor = '#ecfdf5';
        statusDiv.style.color = '#065f46';
        statusDiv.style.border = '1px solid #a7f3d0';
    } else {
        statusDiv.style.backgroundColor = '#fef2f2';
        statusDiv.style.color = '#991b1b';
        statusDiv.style.border = '1px solid #fca5a5';
    }
    
    document.body.appendChild(statusDiv);
    
    setTimeout(() => {
        statusDiv.style.opacity = '0';
        statusDiv.style.transform = 'translateY(-10px)';
        setTimeout(() => {
            if (statusDiv.parentNode) {
                statusDiv.parentNode.removeChild(statusDiv);
            }
        }, 300);
    }, 4000);
}

Object.assign(window.LeetCodeCodeSaver, {
    findSubmitButton,
    checkSubmissionSuccess,
    getCodeAndLanguageFromPage,
    getNotesValue,
    getTimerValue,
    syncSolveTimerDisplay,
    scanPageForSaverHooks,
    showGitHubLink,
    showGitHubSolutionActions,
    checkGitHubSolutionForCurrentLanguage,
    importGitHubSolution,
    getProblemInfo
});

// ─────────────────────────────────────────────────────
// AI Helper — Socratic nudges on a user-configured timer (issue #4)
// ─────────────────────────────────────────────────────

const AI_DEFAULT_SETTINGS = {
    aiEnabled: false,
    solveTimerEnabled: true,
    nudgeAtMinutes: 15,
    deadlineAtMinutes: 45,
    minHelpMinutes: 5
};

const AI_HELPER = {
    settings: { ...AI_DEFAULT_SETTINGS },
    settingsLoaded: false,
    currentSlug: null,
    sessionStartMs: null,
    solvedOnce: false,
    nudgeCheckDone: false,
    deadlineNotified: false,
    history: [],
    busy: false,
    tickHandle: null
};

function getProblemSlug() {
    const parsed = parseProblemPath(window.location.pathname);
    return parsed ? parsed.title : null;
}

function formatMinutesLabel(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function loadAiSettings(callback) {
    chrome.storage.sync.get([
        'aiEnabled',
        'solveTimerEnabled',
        'nudgeAtMinutes',
        'deadlineAtMinutes',
        'minHelpMinutes'
    ], function(items) {
        AI_HELPER.settings = {
            aiEnabled: items.aiEnabled !== undefined ? items.aiEnabled : AI_DEFAULT_SETTINGS.aiEnabled,
            solveTimerEnabled: items.solveTimerEnabled !== undefined ? items.solveTimerEnabled : AI_DEFAULT_SETTINGS.solveTimerEnabled,
            nudgeAtMinutes: clampAiInt(items.nudgeAtMinutes, 1, 180, AI_DEFAULT_SETTINGS.nudgeAtMinutes),
            deadlineAtMinutes: clampAiInt(items.deadlineAtMinutes, 2, 360, AI_DEFAULT_SETTINGS.deadlineAtMinutes),
            minHelpMinutes: clampAiInt(items.minHelpMinutes, 0, 180, AI_DEFAULT_SETTINGS.minHelpMinutes)
        };
        AI_HELPER.settingsLoaded = true;
        if (callback) callback();
    });
}

function clampAiInt(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function aiSessionStorageKey(slug) {
    return `yc-ai-start:${slug}`;
}

// Called from the DOM scan loop: detects SPA navigation to another problem,
// resets the per-problem AI session, and starts the timer on first run.
function updateAiSessionForUrl() {
    if (!AI_HELPER.settingsLoaded) return;

    const slug = getProblemSlug();
    if (!slug) return;

    if (slug === AI_HELPER.currentSlug) return;

    AI_HELPER.currentSlug = slug;
    resetAiSession(slug);

    if (AI_HELPER.settings.solveTimerEnabled && !AI_HELPER.tickHandle) {
        AI_HELPER.tickHandle = setInterval(() => {
            aiHelperTick(Date.now());
            syncSolveTimerDisplay();
        }, 1000);
    }
}

function resetAiSession(slug) {
    if (!AI_HELPER.settings.solveTimerEnabled) {
        AI_HELPER.sessionStartMs = null;
        try {
            sessionStorage.removeItem(aiSessionStorageKey(slug));
        } catch (e) { /* sessionStorage unavailable */ }
        AI_HELPER.solvedOnce = false;
        AI_HELPER.nudgeCheckDone = false;
        AI_HELPER.deadlineNotified = false;
        AI_HELPER.history = [];
        removeAiNudgeOffer();
        setAiPanelSubtitle(slug);
        refreshAiAskButtonState();
        syncSolveTimerDisplay();
        return;
    }

    let sessionStartMs;
    try {
        const stored = sessionStorage.getItem(aiSessionStorageKey(slug));
        if (stored) {
            sessionStartMs = parseInt(stored, 10);
        }
    } catch (e) { /* sessionStorage unavailable */ }

    if (!sessionStartMs || isNaN(sessionStartMs)) {
        sessionStartMs = Date.now();
        try {
            sessionStorage.setItem(aiSessionStorageKey(slug), String(sessionStartMs));
        } catch (e) { /* sessionStorage unavailable */ }
    }

    AI_HELPER.sessionStartMs = sessionStartMs;
    AI_HELPER.solvedOnce = false;
    AI_HELPER.nudgeCheckDone = false;
    AI_HELPER.deadlineNotified = false;
    AI_HELPER.history = [];

    removeAiNudgeOffer();
    setAiPanelSubtitle(slug);
    refreshAiAskButtonState();
    syncSolveTimerDisplay();
}

function aiHelperTick(now) {
    if (!AI_HELPER.settingsLoaded) return;
    if (!AI_HELPER.settings.aiEnabled) return;
    if (!AI_HELPER.settings.solveTimerEnabled) return;

    const slug = getProblemSlug();
    if (!slug || slug !== AI_HELPER.currentSlug) {
        updateAiSessionForUrl();
        if (slug !== AI_HELPER.currentSlug) return;
    }
    if (AI_HELPER.sessionStartMs === null) return;

    const elapsedMs = now - AI_HELPER.sessionStartMs;
    const elapsedMin = elapsedMs / 60000;
    refreshAiAskButtonState();

    let checkpointPromise = null;
    if (!AI_HELPER.nudgeCheckDone && elapsedMin >= AI_HELPER.settings.nudgeAtMinutes) {
        AI_HELPER.nudgeCheckDone = true;
        checkpointPromise = runDirectionCheck(elapsedMin);
    }

    if (!AI_HELPER.deadlineNotified && elapsedMin >= AI_HELPER.settings.deadlineAtMinutes) {
        AI_HELPER.deadlineNotified = true;
        deadlineReachedNotice();
    }

    return checkpointPromise || undefined;
}

// Neutralise the tick timers in tests / teardown
function stopAiHelperTimers() {
    if (AI_HELPER.tickHandle) {
        clearInterval(AI_HELPER.tickHandle);
        AI_HELPER.tickHandle = null;
    }
}

function aiHasAcceptedSolution() {
    try {
        return window.LeetCodeCodeSaver.checkSubmissionSuccess();
    } catch (e) {
        return false;
    }
}

async function getProblemStatement() {
    const selectors = [
        '[data-track-load="description_content"]',
        'div[data-key="description-content"]',
        'div.elfjS',
        '#description-content',
        '[data-cy="question-title"]'
    ];

    for (const selector of selectors) {
        const el = document.querySelector(selector);
        const text = el ? (el.innerText || el.textContent || '').trim() : '';
        if (text && text.length > 40) {
            return text.slice(0, 6000);
        }
    }

    try {
        const meta = document.querySelector('meta[name="description"]');
        const fallback = meta ? (meta.content || '').trim() : '';
        if (fallback.length > 40) return fallback.slice(0, 3000);
    } catch (e) { /* ignore */ }

    return null;
}

async function collectAiContext() {
    let code = null;
    let languageId = null;
    try {
        const extracted = await getCodeAndLanguageFromPage();
        code = extracted.code;
        languageId = extracted.languageId;
    } catch (e) {
        code = null;
    }

    const problemStatement = await getProblemStatement();
    const slug = getProblemSlug();
    const title = slug ? slug.replace(/-/g, ' ') : 'Unknown problem';

    return {
        problemTitle: title,
        problemUrl: window.location.href,
        problemStatement: problemStatement,
        code: code,
        languageId: languageId
    };
}

function sendAiMessage(payload, callback) {
    chrome.runtime.sendMessage({
        action: 'aiChat',
        history: AI_HELPER.history.slice(),
        ...payload
    }, function(response) {
        if (chrome.runtime.lastError) {
            callback({ success: false, error: chrome.runtime.lastError.message });
            return;
        }
        if (!response) {
            callback({ success: false, error: 'No response from the AI Helper background worker.' });
            return;
        }
        callback(response);
    });
}

// ── Direction check + nudge offer ──────────────────────────────────

async function runDirectionCheck(elapsedMin) {
    if (aiHasAcceptedSolution()) {
        AI_HELPER.solvedOnce = true;
        return;
    }

    const context = await collectAiContext();
    if (AI_HELPER.solvedOnce || AI_HELPER.deadlineNotified) return;

    const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: 'aiDirection',
            problemTitle: context.problemTitle,
            problemUrl: context.problemUrl,
            problemStatement: context.problemStatement,
            code: context.code,
            languageId: context.languageId
        }, resolve);
    });

    if (AI_HELPER.solvedOnce || AI_HELPER.deadlineNotified) return;
    if (chrome.runtime.lastError || !response || !response.success) {
        // Silent failure: never nag about infrastructure errors during a session
        console.warn('AI Helper direction check failed:', response && response.error);
        return;
    }

    const direction = response.result;
    if (direction.onTrack === true) {
        showAiToast(`AI Helper: You're on the right track. Keep going!${direction.note ? ` (${direction.note})` : ''}`, 'success');
    } else {
        offerNudge(direction.note);
    }
}

function offerNudge(note) {
    removeAiNudgeOffer();

    const offer = document.createElement('div');
    offer.id = 'yc-ai-nudge-offer';
    offer.style.cssText = [
        'position:fixed', 'right:20px', 'bottom:20px', 'z-index:99999',
        'width:300px', 'padding:14px', 'border-radius:10px',
        'background:#1e1e1ee6', 'backdrop-filter:blur(12px)',
        'border:1px solid rgba(255,255,255,0.12)',
        'box-shadow:0 8px 32px rgba(0,0,0,0.4)',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
        'color:#f5f5f5', 'font-size:13px', 'line-height:1.5'
    ].join(';');

    const text = document.createElement('div');
    text.textContent = note
        ? `AI Helper: ${note} — Want a nudge in the right direction?`
        : 'AI Helper: It looks like you might be stuck. Want a nudge in the right direction?';
    offer.appendChild(text);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;margin-top:10px;';

    const acceptButton = document.createElement('button');
    acceptButton.textContent = 'Get a nudge';
    acceptButton.style.cssText = [
        'flex:1', 'padding:7px 10px', 'border:none', 'border-radius:6px',
        'background:#f39c12', 'color:#fff', 'font-size:12.5px', 'font-weight:600',
        'cursor:pointer', 'font-family:inherit'
    ].join(';');
    acceptButton.addEventListener('click', () => {
        removeAiNudgeOffer();
        openAiPanel(() => {
            startAiConversation('nudge', 'The user accepted a nudge offer. Please give them one small Socratic nudge from their current position.');
        });
    });

    const declineButton = document.createElement('button');
    declineButton.textContent = 'No thanks';
    declineButton.style.cssText = [
        'flex:1', 'padding:7px 10px', 'border:1px solid rgba(255,255,255,0.2)',
        'border-radius:6px', 'background:transparent', 'color:#b0b0b0',
        'font-size:12.5px', 'font-weight:500', 'cursor:pointer', 'font-family:inherit'
    ].join(';');
    declineButton.addEventListener('click', () => {
        removeAiNudgeOffer();
    });

    buttons.appendChild(acceptButton);
    buttons.appendChild(declineButton);
    offer.appendChild(buttons);
    document.body.appendChild(offer);
}

function removeAiNudgeOffer() {
    const existing = document.getElementById('yc-ai-nudge-offer');
    if (existing) existing.remove();
}

function showAiToast(message, type) {
    showStatusMessage(message, type === 'success' ? 'success' : 'error');
}

// ── Deadline notice ────────────────────────────────────────────────

function deadlineReachedNotice() {
    if (aiHasAcceptedSolution()) {
        AI_HELPER.solvedOnce = true;
        return;
    }

    removeAiNudgeOffer();

    const notice = document.createElement('div');
    notice.id = 'yc-ai-nudge-offer';
    notice.style.cssText = [
        'position:fixed', 'right:20px', 'bottom:20px', 'z-index:99999',
        'width:300px', 'padding:14px', 'border-radius:10px',
        'background:#1e1e1ee6', 'backdrop-filter:blur(12px)',
        'border:1px solid rgba(243,156,18,0.4)',
        'box-shadow:0 8px 32px rgba(0,0,0,0.4)',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
        'color:#f5f5f5', 'font-size:13px', 'line-height:1.5'
    ].join(';');

    const text = document.createElement('div');
    text.textContent = `AI Helper: You've reached your ${AI_HELPER.settings.deadlineAtMinutes} minute time limit. Consider learning the solution now — or keep going with guided help.`;
    notice.appendChild(text);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;margin-top:10px;';

    const guidedButton = document.createElement('button');
    guidedButton.textContent = 'Guide me (learn it)';
    guidedButton.style.cssText = 'flex:1;padding:7px 10px;border:none;border-radius:6px;background:#f39c12;color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;';
    guidedButton.addEventListener('click', () => {
        notice.remove();
        openAiPanel(() => {
            startAiConversation('guided', 'The time limit was reached and the user chose to learn the solution instead of continuing alone. Begin the guided walkthrough from their current code.');
        });
    });

    const keepButton = document.createElement('button');
    keepButton.textContent = 'Keep trying';
    keepButton.style.cssText = 'flex:1;padding:7px 10px;border:1px solid rgba(255,255,255,0.2);border-radius:6px;background:transparent;color:#b0b0b0;font-size:12.5px;font-weight:500;cursor:pointer;font-family:inherit;';
    keepButton.addEventListener('click', () => {
        notice.remove();
    });

    buttons.appendChild(guidedButton);
    buttons.appendChild(keepButton);
    notice.appendChild(buttons);
    document.body.appendChild(notice);
}

// ── Chat panel ─────────────────────────────────────────────────────

function ensureAiPanel() {
    if (document.getElementById('yc-ai-panel')) {
        return document.getElementById('yc-ai-panel');
    }

    const panel = document.createElement('div');
    panel.id = 'yc-ai-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', 'yc-ai-button');
    panel.style.cssText = [
        'position:fixed', 'right:16px', 'top:50%', 'transform:translateY(-50%)', 'z-index:99998',
        'width:360px', 'max-width:calc(100vw - 32px)', 'height:min(620px, calc(100vh - 32px))',
        'display:none', 'flex-direction:column',
        'background:#181818f2', 'backdrop-filter:blur(16px)',
        'border:1px solid rgba(255,255,255,0.12)', 'border-radius:12px',
        'box-shadow:0 12px 48px rgba(0,0,0,0.5)',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
        'color:#f5f5f5', 'overflow:hidden'
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);';
    const titleWrap = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = 'AI Helper';
    title.style.cssText = 'font-weight:700;font-size:13px;';
    titleWrap.appendChild(title);
    const subtitle = document.createElement('div');
    subtitle.id = 'yc-ai-panel-subtitle';
    subtitle.style.cssText = 'font-size:10.5px;color:#9ca3af;margin-top:1px;';
    titleWrap.appendChild(subtitle);
    const closeButton = document.createElement('button');
    closeButton.id = 'yc-ai-panel-close';
    closeButton.textContent = '×';
    closeButton.style.cssText = 'background:transparent;border:none;color:#9ca3af;font-size:20px;cursor:pointer;line-height:1;padding:0 4px;font-family:inherit;';
    closeButton.addEventListener('click', () => toggleAiPanel(false));
    header.appendChild(titleWrap);
    header.appendChild(closeButton);

    const messages = document.createElement('div');
    messages.id = 'yc-ai-messages';
    messages.style.cssText = 'flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;font-size:12.5px;line-height:1.55;';

    const notice = document.createElement('div');
    notice.id = 'yc-ai-hint';
    notice.textContent = 'The AI guides you with questions — it will never hand you a full solution.';
    notice.style.cssText = 'padding:6px 14px;font-size:10.5px;color:#9ca3af;border-bottom:1px solid rgba(255,255,255,0.05);';

    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,0.08);';

    const input = document.createElement('input');
    input.id = 'yc-ai-input';
    input.type = 'text';
    input.placeholder = 'Ask a question…';
    input.style.cssText = 'flex:1;padding:8px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#f5f5f5;font-size:12.5px;font-family:inherit;outline:none;';

    const sendButton = document.createElement('button');
    sendButton.id = 'yc-ai-send';
    sendButton.textContent = 'Send';
    sendButton.style.cssText = 'padding:8px 14px;border:none;border-radius:8px;background:#f39c12;color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;';

    inputRow.appendChild(input);
    inputRow.appendChild(sendButton);

    panel.appendChild(header);
    panel.appendChild(notice);
    panel.appendChild(messages);
    panel.appendChild(inputRow);
    document.body.appendChild(panel);

    sendButton.addEventListener('click', () => submitAiMessage());
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitAiMessage();
        }
    });

    return panel;
}

function setAiPanelSubtitle(slug) {
    const subtitle = document.getElementById('yc-ai-panel-subtitle');
    if (subtitle) subtitle.textContent = slug || '';
}

function toggleAiPanel(forceOpen) {
    const panel = ensureAiPanel();
    const shouldOpen = forceOpen !== undefined ? forceOpen : panel.style.display !== 'flex';
    panel.style.display = shouldOpen ? 'flex' : 'none';
    const tab = document.getElementById('yc-ai-button');
    if (tab) {
        tab.setAttribute('aria-selected', shouldOpen ? 'true' : 'false');
        tab.classList.toggle('flexlayout__tab_button--selected', shouldOpen);
        tab.classList.toggle('flexlayout__tab_button--unselected', !shouldOpen);
    }
    if (shouldOpen) {
        setAiPanelSubtitle(AI_HELPER.currentSlug);
        refreshAiAskButtonState();
        const messages = document.getElementById('yc-ai-messages');
        if (messages && !messages.childElementCount) {
            appendAiMessage('system', 'Hi! I\'ll guide you without spoiling solutions. Tell me where you\'re stuck, or wait for a timed check-in.');
        }
        const input = document.getElementById('yc-ai-input');
        if (input) input.focus();
    }
}

function openAiPanel(onOpened) {
    toggleAiPanel(true);
    if (onOpened) onOpened();
}

function appendAiMessage(role, content) {
    const messages = document.getElementById('yc-ai-messages');
    if (!messages) return;

    const bubble = document.createElement('div');
    bubble.className = `yc-ai-msg yc-ai-${role}`;
    bubble.textContent = content;

    if (role === 'user') {
        bubble.style.cssText = 'align-self:flex-end;background:#f39c12;color:#fff;border-radius:10px 10px 2px 10px;padding:7px 10px;max-width:85%;white-space:pre-wrap;';
    } else if (role === 'assistant') {
        bubble.style.cssText = 'align-self:flex-start;background:rgba(255,255,255,0.07);color:#f5f5f5;border-radius:10px 10px 10px 2px;padding:7px 10px;max-width:88%;white-space:pre-wrap;';
    } else {
        bubble.style.cssText = 'align-self:center;background:transparent;color:#9ca3af;font-size:10.5px;text-align:center;max-width:90%;';
    }

    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
}

function setAiBusy(busy) {
    AI_HELPER.busy = busy;
    const sendButton = document.getElementById('yc-ai-send');
    const input = document.getElementById('yc-ai-input');
    if (sendButton) {
        sendButton.disabled = busy;
        sendButton.textContent = busy ? '…' : 'Send';
    }
    if (input) input.disabled = busy;
    if (busy) {
        appendAiMessage('system', 'Thinking…');
    } else {
        const messages = document.getElementById('yc-ai-messages');
        if (messages) {
            const last = messages.lastElementChild;
            if (last && last.textContent === 'Thinking…') last.remove();
        }
    }
}

function pushAiHistory(role, content) {
    AI_HELPER.history.push({ role, content });
    if (AI_HELPER.history.length > 16) {
        AI_HELPER.history.splice(0, AI_HELPER.history.length - 16);
    }
}

async function startAiConversation(mode, syntheticUserMessage) {
    if (AI_HELPER.busy) return;
    setAiBusy(true);

    if (mode === 'guided') {
        appendAiMessage('system', 'Time limit reached — switching to guided mode.');
    }

    const context = await collectAiContext();

    sendAiMessage({
        mode,
        userMessage: syntheticUserMessage,
        ...context
    }, function(response) {
        setAiBusy(false);
        if (response.success) {
            pushAiHistory('user', syntheticUserMessage);
            pushAiHistory('assistant', response.result.reply);
            appendAiMessage('assistant', response.result.reply);
        } else {
            appendAiMessage('system', `AI error: ${response.error}`);
        }
    });
}

async function submitAiMessage() {
    if (AI_HELPER.busy) return;
    const input = document.getElementById('yc-ai-input');
    if (!input) return;
    const message = (input.value || '').trim();
    if (!message) return;

    input.value = '';
    appendAiMessage('user', message);
    pushAiHistory('user', message);
    setAiBusy(true);

    const context = await collectAiContext();
    sendAiMessage({
        mode: 'ask',
        userMessage: '',
        ...context,
        lastUserMessage: message
    }, function(response) {
        setAiBusy(false);
        if (response.success) {
            pushAiHistory('assistant', response.result.reply);
            appendAiMessage('assistant', response.result.reply);
        } else {
            appendAiMessage('system', `AI error: ${response.error}`);
        }
    });
}

// ── AI Helper button (always-available "ask for help" entry point) ──

function ensureAiButton() {
    if (!AI_HELPER.settingsLoaded || !AI_HELPER.settings.aiEnabled) return;

    const nativeTabBar = document.querySelector(
        '#description_tabbar_outer .flexlayout__tabset_tabbar_inner_tab_container_top'
    ) || document.querySelector(
        '#description_tabbar_outer .flexlayout__tabset_tabbar_inner_tab_container'
    );
    let aiButton = document.getElementById('yc-ai-button');
    if (!aiButton) aiButton = buildAiButton();

    if (nativeTabBar) {
        aiButton.className = 'flexlayout__tab_button flexlayout__tab_button_top flexlayout__tab_button--unselected';
        aiButton.style.cssText = 'height:100%;padding:0 12px;border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;';
        const content = aiButton.firstElementChild;
        if (content) {
            content.className = 'flexlayout__tab_button_content';
            const label = content.firstElementChild;
            if (label) label.className = 'relative flex items-center gap-1 overflow-hidden text-sm capitalize';
        }
        aiButton.setAttribute('role', 'tab');
        aiButton.setAttribute('aria-label', 'AI Chat');

        const divider = document.createElement('div');
        divider.id = 'yc-ai-tab-divider';
        divider.className = 'flexlayout__tabset_tab_divider';
        if (aiButton.parentElement !== nativeTabBar) {
            const oldParent = aiButton.parentElement;
            aiButton.remove();
            const oldDivider = document.getElementById('yc-ai-tab-divider');
            if (oldDivider) oldDivider.remove();
            if (oldParent && oldParent.id === 'yc-ai-tab-list') oldParent.remove();
            const descriptionTab = nativeTabBar.querySelector('#description_tab')
                ?.closest('.flexlayout__tab_button');
            let reference = descriptionTab && descriptionTab.nextElementSibling;
            if (reference && reference.classList.contains('flexlayout__tabset_tab_divider')) {
                reference = reference.nextElementSibling;
            }
            if (reference) {
                nativeTabBar.insertBefore(divider, reference);
                nativeTabBar.insertBefore(aiButton, divider);
            } else {
                nativeTabBar.append(aiButton, divider);
            }
        }
    } else {
        aiButton.className = '';
        aiButton.style.cssText = [
            'padding:12px 9px',
            'background:#2d2d2d', 'color:#f5f5f5',
            'border:1px solid rgba(255,255,255,0.15)', 'border-right:none', 'border-radius:8px 0 0 8px',
            'cursor:pointer', 'font-size:14px', 'font-weight:bold',
            'transition:background-color 0.2s',
            'display:inline-flex', 'align-items:center', 'justify-content:center',
            'writing-mode:vertical-rl',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
        ].join(';');
        let tabList = document.getElementById('yc-ai-tab-list');
        if (!tabList) {
            tabList = document.createElement('div');
            tabList.id = 'yc-ai-tab-list';
            tabList.setAttribute('role', 'tablist');
            tabList.setAttribute('aria-label', 'YeetCode tools');
            tabList.style.cssText = 'position:fixed;right:0;top:42%;z-index:99997;';
            tabList.appendChild(aiButton);
            document.body.appendChild(tabList);
        }
    }
    refreshAiAskButtonState();
}

function buildAiButton() {
    const aiButton = document.createElement('button');
    aiButton.id = 'yc-ai-button';
    aiButton.type = 'button';
    const content = document.createElement('div');
    content.className = 'flexlayout__tab_button_content';
    const label = document.createElement('div');
    label.className = 'relative flex items-center gap-1 overflow-hidden text-sm capitalize';
    label.textContent = 'AI Chat';
    content.appendChild(label);
    aiButton.appendChild(content);
    aiButton.setAttribute('role', 'tab');
    aiButton.setAttribute('aria-selected', 'false');
    aiButton.setAttribute('aria-controls', 'yc-ai-panel');

    aiButton.addEventListener('mouseover', function() {
        if (!aiButton.classList.contains('flexlayout__tab_button')) {
            aiButton.style.backgroundColor = '#3d3d3d';
        }
    });
    aiButton.addEventListener('mouseout', function() {
        if (!aiButton.classList.contains('flexlayout__tab_button')) {
            aiButton.style.backgroundColor = '#2d2d2d';
        }
    });

    aiButton.addEventListener('click', function() {
        const elapsedMs = AI_HELPER.sessionStartMs !== null ? Date.now() - AI_HELPER.sessionStartMs : 0;
        if (AI_HELPER.settings.solveTimerEnabled && AI_HELPER.sessionStartMs !== null &&
            elapsedMs < AI_HELPER.settings.minHelpMinutes * 60000 && !aiHasAcceptedSolution()) {
            showAiToast(`AI Helper: asking is locked for the first ${AI_HELPER.settings.minHelpMinutes} minutes — ${formatMinutesLabel(AI_HELPER.settings.minHelpMinutes * 60000 - elapsedMs)} left.`, 'error');
            return;
        }
        const panel = ensureAiPanel();
        toggleAiPanel(panel.style.display !== 'flex');
    });

    return aiButton;
}

// Reflect the "min minutes before asking for help" setting on the button
function refreshAiAskButtonState() {
    const aiButton = document.getElementById('yc-ai-button');
    if (!aiButton) return;

    const elapsedMs = AI_HELPER.settings.solveTimerEnabled && AI_HELPER.sessionStartMs !== null && AI_HELPER.currentSlug
        ? Date.now() - AI_HELPER.sessionStartMs
        : null;
    const minHelpMs = AI_HELPER.settings.minHelpMinutes * 60000;

    if (elapsedMs !== null && elapsedMs < minHelpMs) {
        aiButton.title = `Ask for help unlocks in ${formatMinutesLabel(minHelpMs - elapsedMs)} (setting: "Ask-after")`;
        aiButton.style.opacity = '0.65';
    } else {
        aiButton.title = 'Ask the AI Helper for a nudge anytime';
        aiButton.style.opacity = '1';
    }
}

// ── Init & wiring ──────────────────────────────────────────────────

loadAiSettings(() => {
    updateAiSessionForUrl();
    ensureAiButton();
});

// Settings changed in the options page: storage.onChanged reaches content
// scripts without any extra permission, so use it as the primary signal.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const AI_KEYS = ['aiEnabled', 'solveTimerEnabled', 'nudgeAtMinutes', 'deadlineAtMinutes', 'minHelpMinutes'];
    const relevant = AI_KEYS.some((key) => Object.prototype.hasOwnProperty.call(changes, key));
    if (!relevant) return;

    const restartSession = ['aiEnabled', 'solveTimerEnabled'].some((key) =>
        Object.prototype.hasOwnProperty.call(changes, key)
    );
    reloadAiSessionSettings(restartSession);
});

function reloadAiSessionSettings(restartSession = true) {
    loadAiSettings(() => {
        removeAiNudgeOffer();
        if (restartSession) {
            stopAiHelperTimers();
            AI_HELPER.currentSlug = null;
            updateAiSessionForUrl();
        } else {
            refreshAiAskButtonState();
        }
        const panel = document.getElementById('yc-ai-panel');
        if (panel && panel.style.display === 'flex') {
            appendAiMessage('system', 'Settings updated — AI Helper timing refreshed.');
        }
        if (!AI_HELPER.settings.aiEnabled) {
            if (panel) toggleAiPanel(false);
            const aiButton = document.getElementById('yc-ai-button');
            if (aiButton) aiButton.remove();
            const divider = document.getElementById('yc-ai-tab-divider');
            if (divider) divider.remove();
            const tabList = document.getElementById('yc-ai-tab-list');
            if (tabList) tabList.remove();
        } else {
            ensureAiButton();
        }
        syncSolveTimerDisplay();
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === 'settingsUpdated') {
        reloadAiSessionSettings();
        sendResponse({ success: true });
        return false;
    }
});

Object.assign(window.LeetCodeCodeSaver, {
    aiHelper: {
        state: AI_HELPER,
        updateAiSessionForUrl,
        resetAiSession,
        aiHelperTick,
        stopAiHelperTimers,
        ensureAiButton,
        ensureAiPanel,
        appendAiMessage,
        refreshAiAskButtonState,
        reloadAiSessionSettings,
        removeAiNudgeOffer,
        getProblemStatement,
        collectAiContext
    }
});
