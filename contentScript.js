// LeetCode Code Saver Content Script
// Handles UI modification, Monaco editor extraction, submission tracking, notes/timer scraping, and messaging

let isSubmitting = false;

// Expose functions for testing
window.LeetCodeCodeSaver = {
    getProblemInfoFromUrl: function(urlString) {
        const url = new URL(urlString);
        const pathParts = url.pathname.split('/');
        let problemTitle = 'unknown-problem';
        
        if (pathParts.length >= 3 && pathParts[1] === 'problems') {
            problemTitle = pathParts[2];
        }
        
        const timestamp = new Date().toISOString();
        
        return {
            title: problemTitle,
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
        // 1. Inject our custom manual button if it doesn't exist
        if (!document.getElementById('leetcode-saver-button')) {
            const submitButton = findSubmitButton();
            const editorContainer = findEditorContainer();
                           
            if (submitButton && editorContainer) {
                createCustomButton(submitButton);
            }
        }
        
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
    } catch (e) {
        // Ignore errors during DOM observation (e.g. during test teardown)
    }
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
    customButton.textContent = 'Save to GitHub';
    customButton.style.marginLeft = '8px';
    customButton.style.padding = '6px 12px';
    customButton.style.backgroundColor = '#4CAF50';
    customButton.style.color = 'white';
    customButton.style.border = 'none';
    customButton.style.borderRadius = '4px';
    customButton.style.cursor = 'pointer';
    customButton.style.fontSize = '14px';
    customButton.style.fontWeight = 'bold';
    customButton.style.transition = 'background-color 0.2s';
    
    // Add hover effect
    customButton.addEventListener('mouseover', function() {
        customButton.style.backgroundColor = '#45a049';
    });
    
    customButton.addEventListener('mouseout', function() {
        customButton.style.backgroundColor = '#4CAF50';
    });
    
    // Insert the button after the submit button
    submitButton.parentNode.insertBefore(customButton, submitButton.nextSibling);
    
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
                customButton.textContent = 'Save to GitHub';
                
                if (chrome.runtime.lastError) {
                    console.error('Runtime error:', chrome.runtime.lastError);
                    showStatusMessage(`Error: ${chrome.runtime.lastError.message}`, 'error');
                    return;
                }
                
                if (response && response.success) {
                    customButton.textContent = 'Saved!';
                    setTimeout(() => {
                        customButton.textContent = 'Save to GitHub';
                    }, 2000);
                    showStatusMessage('Code saved to GitHub successfully!', 'success');
                } else {
                    const errorMsg = (response && response.error) ? response.error : 'Unknown background error';
                    showStatusMessage(`Error: ${errorMsg}`, 'error');
                }
            });
            
        } catch (error) {
            console.error('Error saving to GitHub:', error);
            customButton.textContent = 'Save to GitHub';
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
                const manualButton = document.getElementById('leetcode-saver-button');
                if (manualButton) {
                    manualButton.textContent = 'Auto-Saved!';
                    setTimeout(() => {
                        manualButton.textContent = 'Save to GitHub';
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

// Injects script to retrieve Monaco Editor value from page's MAIN world context
async function getCodeAndLanguageFromPage() {
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
    const pathParts = url.pathname.split('/');
    let problemTitle = 'unknown-problem';
    
    if (pathParts.length >= 3 && pathParts[1] === 'problems') {
        problemTitle = pathParts[2];
    }
    
    const titleElement = document.querySelector('.title') || 
                        document.querySelector('h1') ||
                        document.querySelector('[data-cy="problem-title"]');
                        
    if (titleElement && titleElement.textContent.trim()) {
        problemTitle = titleElement.textContent.trim()
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-+|-+$/g, '');
    }
    
    const timestamp = new Date().toISOString();
    
    return {
        title: problemTitle,
        timestamp: timestamp,
        url: url.href
    };
}

function getNotesValue() {
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
        for (let i = 0; i < window.localStorage.length; i += 1) {
            const key = window.localStorage.key(i);
            if (!key || !/notes?|notepad|notebook/i.test(key)) continue;

            const value = window.localStorage.getItem(key);
            collectNoteCandidates(value, candidates);
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
    const timerSelectors = [
        '[class*="timer" i]',
        '[id*="timer" i]',
        '[class*="clock" i]',
        '[id*="clock" i]',
        '[data-testid*="timer" i]'
    ];
    
    for (const selector of timerSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
            const text = el.textContent.trim();
            if (/^\d{2}:\d{2}(:\d{2})?$/.test(text)) {
                return text;
            }
        }
    }
    
    const allTextElements = document.querySelectorAll('span, div, p, button');
    for (const el of allTextElements) {
        const text = el.textContent.trim();
        if (/^\d{2}:\d{2}(:\d{2})?$/.test(text)) {
            return text;
        }
    }
    
    return null;
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
    scanPageForSaverHooks
});
