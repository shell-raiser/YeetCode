// Expose functions for testing
window.LeetCodeCodeSaver = {
    getProblemInfoFromUrl: function(urlString) {
        const url = new URL(urlString);
        const pathParts = url.pathname.split('/');
        let problemTitle = 'unknown-problem';
        
        if (pathParts.length >= 3 && pathParts[1] === 'problems') {
            problemTitle = pathParts[2];
        }
        
        // Also try to get from page title - we can't do this in a pure function, so we'll skip for now
        // In the real function, we also check the page title, but for testing we focus on URL
        
        // Get current timestamp
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
        
        // Fallback: try to get from textarea (if LeetCode uses one)
        const textarea = document.querySelector('textarea');
        if (textarea) {
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

// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Wait for the editor to be available
    const observer = new MutationObserver((mutations) => {
        // Look for the submit button (LeetCode's submit button)
        const submitButton = document.querySelector('button[data-testid="judge-button"]') || 
                            document.querySelector('button:contains("Submit")') ||
                            document.querySelector('button[type="submit"]');
        
        // Also look for the editor container
        const editorContainer = document.querySelector('.monaco-editor') ||
                               document.querySelector('#editor-container');
                               
        if (submitButton && editorContainer) {
            observer.disconnect();
            createCustomButton(submitButton);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
});

function createCustomButton(submitButton) {
    // Create our custom button
    const customButton = document.createElement('button');
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
        // Show loading state
        customButton.textContent = 'Saving...';
        customButton.disabled = true;
        
        try {
            // Get code from editor using exposed function
            const code = window.LeetCodeCodeSaver.getCodeFromEditor();
            
            // Get problem info using exposed function
            const problemInfo = window.LeetCodeCodeSaver.getProblemInfoFromUrl(window.location.href);
            
            // Get extension settings
            const settings = await getExtensionSettings();
            
            if (!settings.token || !settings.repo) {
                throw new Error('GitHub token or repository not configured. Please check extension options.');
            }
            
            // Save to GitHub
            await saveToGitHub(code, problemInfo, settings);
            
            // Show success
            customButton.textContent = 'Saved!';
            setTimeout(() => {
                customButton.textContent = 'Save to GitHub';
                customButton.disabled = false;
            }, 2000);
            
            // Show temporary success message
            showStatusMessage('Code saved to GitHub successfully!', 'success');
        } catch (error) {
            console.error('Error saving to GitHub:', error);
            customButton.textContent = 'Save to GitHub';
            customButton.disabled = false;
            showStatusMessage(`Error: ${error.message}`, 'error');
        }
    });
}

async function getExtensionSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get([
            'githubToken',
            'githubRepo',
            'githubBranch',
            'githubFolder'
        ], function(items) {
            resolve({
                token: items.githubToken || '',
                repo: items.githubRepo || '',
                branch: items.githubBranch || 'main',
                folder: items.githubFolder || 'leetcode'
            });
        });
    });
}

async function saveToGitHub(code, problemInfo, settings) {
    // Validate inputs
    if (!settings.token || !settings.repo) {
        throw new Error('GitHub token or repository not configured');
    }
    
    // Format filename: problem-title-timestamp.txt
    const sanitizedTitle = problemInfo.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${sanitizedTitle}-${timestamp}.txt`;
    
    // Construct file path
    const filePath = `${settings.folder}/${filename}`.replace(/\/+/g, '/');
    
    // GitHub API URL
    const apiUrl = `https://api.github.com/repos/${settings.repo}/contents/${filePath}`;
    
    // Check if file already exists
    let existingFile = null;
    try {
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${settings.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (response.ok) {
            existingFile = await response.json();
        }
    } catch (error) {
        // Ignore error - file doesn't exist
    }
    
    // Prepare request body
    const content = btoa(unescape(encodeURIComponent(code)));
    const commitMessage = `Save LeetCode solution: ${problemInfo.title} (${problemInfo.timestamp})`;
    
    const requestBody = {
        message: commitMessage,
        content: content,
        branch: settings.branch
    };
    
    if (existingFile) {
        // Update existing file
        requestBody.sha = existingFile.sha;
    }
    
    // Send request to GitHub
    const response = await fetch(apiUrl, {
        method: existingFile ? 'PUT' : 'POST',
        headers: {
            'Authorization': `token ${settings.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`GitHub API error: ${errorData.message || response.statusText}`);
    }
    
    return await response.json();
}

function showStatusMessage(message, type) {
    // Remove any existing status message
    const existingStatus = document.querySelector('#leetcode-saver-status');
    if (existingStatus) {
        existingStatus.remove();
    }
    
    // Create status element
    const statusDiv = document.createElement('div');
    statusDiv.id = 'leetcode-saver-status';
    statusDiv.textContent = message;
    statusDiv.style.position = 'fixed';
    statusDiv.style.top = '20px';
    statusDiv.style.right = '20px';
    statusDiv.style.padding = '10px 20px';
    statusDiv.style.borderRadius = '4px';
    statusDiv.style.fontSize = '14px';
    statusDiv.style.zIndex = '9999';
    statusDiv.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    
    if (type === 'success') {
        statusDiv.style.backgroundColor = '#d4edda';
        statusDiv.style.color = '#155724';
        statusDiv.style.border = '1px solid #c3e6cb';
    } else {
        statusDiv.style.backgroundColor = '#f8d7da';
        statusDiv.style.color = '#721c24';
        statusDiv.style.border = '1px solid #f5c6cb';
    }
    
    document.body.appendChild(statusDiv);
    
    // Remove after 5 seconds
    setTimeout(() => {
        if (statusDiv.parentNode) {
            statusDiv.parentNode.removeChild(statusDiv);
        }
    }, 5000);
}
    });

    observer.observe(document.body, { childList: true, subtree: true });
});

function createCustomButton(submitButton) {
    // Create our custom button
    const customButton = document.createElement('button');
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
        // Show loading state
        customButton.textContent = 'Saving...';
        customButton.disabled = true;
        
        try {
            // Get code from editor
            const code = await getCodeFromEditor();
            
            // Get problem info
            const problemInfo = getProblemInfo();
            
            // Get extension settings
            const settings = await getExtensionSettings();
            
            if (!settings.token || !settings.repo) {
                throw new Error('GitHub token or repository not configured. Please check extension options.');
            }
            
            // Save to GitHub
            await saveToGitHub(code, problemInfo, settings);
            
            // Show success
            customButton.textContent = 'Saved!';
            setTimeout(() => {
                customButton.textContent = 'Save to GitHub';
                customButton.disabled = false;
            }, 2000);
            
            // Show temporary success message
            showStatusMessage('Code saved to GitHub successfully!', 'success');
        } catch (error) {
            console.error('Error saving to GitHub:', error);
            customButton.textContent = 'Save to GitHub';
            customButton.disabled = false;
            showStatusMessage(`Error: ${error.message}`, 'error');
        }
    });
}

async function getCodeFromEditor() {
    // Try to get code from Monaco editor
    if (window.monaco && window.monaco.editor) {
        const editors = window.monaco.editor.getEditors();
        if (editors.length > 0) {
            return editors[0].getValue();
        }
    }
    
    // Fallback: try to get from textarea (if LeetCode uses one)
    const textarea = document.querySelector('textarea');
    if (textarea) {
        return textarea.value;
    }
    
    // Last resort: get from div with contenteditable
    const contentEditable = document.querySelector('[contenteditable="true"]');
    if (contentEditable) {
        return contentEditable.innerText;
    }
    
    throw new Error('Could not find code editor');
}

function getProblemInfo() {
    // Get problem title from URL or page
    const url = new URL(window.location.href);
    const pathParts = url.pathname.split('/');
    // LeetCode URL format: /problems/problem-title/
    let problemTitle = 'unknown-problem';
    
    if (pathParts.length >= 3 && pathParts[1] === 'problems') {
        problemTitle = pathParts[2];
    }
    
    // Also try to get from page title
    const titleElement = document.querySelector('.title') || 
                        document.querySelector('h1') ||
                        document.querySelector('[data-cy="problem-title"]');
    if (titleElement && titleElement.textContent.trim()) {
        problemTitle = titleElement.textContent.trim()
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')
                      .replace(/^-+|-+$/g, '');
    }
    
    // Get current timestamp
    const timestamp = new Date().toISOString();
    
    return {
        title: problemTitle,
        timestamp: timestamp,
        url: url.href
    };
}

async function getExtensionSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get([
            'githubToken',
            'githubRepo',
            'githubBranch',
            'githubFolder'
        ], function(items) {
            resolve({
                token: items.githubToken || '',
                repo: items.githubRepo || '',
                branch: items.githubBranch || 'main',
                folder: items.githubFolder || 'leetcode'
            });
        });
    });
}

async function saveToGitHub(code, problemInfo, settings) {
    // Validate inputs
    if (!settings.token || !settings.repo) {
        throw new Error('GitHub token or repository not configured');
    }
    
    // Format filename: problem-title-timestamp.txt
    const sanitizedTitle = problemInfo.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${sanitizedTitle}-${timestamp}.txt`;
    
    // Construct file path
    const filePath = `${settings.folder}/${filename}`.replace(/\/+/g, '/');
    
    // GitHub API URL
    const apiUrl = `https://api.github.com/repos/${settings.repo}/contents/${filePath}`;
    
    // Check if file already exists
    let existingFile = null;
    try {
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${settings.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (response.ok) {
            existingFile = await response.json();
        }
    } catch (error) {
        // Ignore error - file doesn't exist
    }
    
    // Prepare request body
    const content = btoa(unescape(encodeURIComponent(code)));
    const commitMessage = `Save LeetCode solution: ${problemInfo.title} (${problemInfo.timestamp})`;
    
    const requestBody = {
        message: commitMessage,
        content: content,
        branch: settings.branch
    };
    
    if (existingFile) {
        // Update existing file
        requestBody.sha = existingFile.sha;
    }
    
    // Send request to GitHub
    const response = await fetch(apiUrl, {
        method: existingFile ? 'PUT' : 'POST',
        headers: {
            'Authorization': `token ${settings.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`GitHub API error: ${errorData.message || response.statusText}`);
    }
    
    return await response.json();
}

function showStatusMessage(message, type) {
    // Remove any existing status message
    const existingStatus = document.querySelector('#leetcode-saver-status');
    if (existingStatus) {
        existingStatus.remove();
    }
    
    // Create status element
    const statusDiv = document.createElement('div');
    statusDiv.id = 'leetcode-saver-status';
    statusDiv.textContent = message;
    statusDiv.style.position = 'fixed';
    statusDiv.style.top = '20px';
    statusDiv.style.right = '20px';
    statusDiv.style.padding = '10px 20px';
    statusDiv.style.borderRadius = '4px';
    statusDiv.style.fontSize = '14px';
    statusDiv.style.zIndex = '9999';
    statusDiv.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    
    if (type === 'success') {
        statusDiv.style.backgroundColor = '#d4edda';
        statusDiv.style.color = '#155724';
        statusDiv.style.border = '1px solid #c3e6cb';
    } else {
        statusDiv.style.backgroundColor = '#f8d7da';
        statusDiv.style.color = '#721c24';
        statusDiv.style.border = '1px solid #f5c6cb';
    }
    
    document.body.appendChild(statusDiv);
    
    // Remove after 5 seconds
    setTimeout(() => {
        if (statusDiv.parentNode) {
            statusDiv.parentNode.removeChild(statusDiv);
        }
    }, 5000);
}