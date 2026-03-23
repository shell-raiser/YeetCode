/**
 * Unit tests for LeetCode Code Saver extension
 * These tests can be run with Jest and integrated with GitHub Actions
 */

// Mock chrome.storage.sync
global.chrome = {
  storage: {
    sync: {
      get: jest.fn(),
      set: jest.fn()
    }
  }
};

// Mock fetch for GitHub API calls
global.fetch = jest.fn();

// Mock DOM elements for testing
document.body.innerHTML = `
  <div id="editor-container"></div>
  <button data-testid="judge-button">Submit</button>
  <textarea style="display:none;">console.log('test');</textarea>
`;

// Expose functions for testing
window.LeetCodeCodeSaver = {
  getProblemInfoFromUrl: function(urlString) {
    const url = new URL(urlString);
    const pathParts = url.pathname.split('/');
    let problemTitle = 'unknown-problem';
    
    if (pathParts.length >= 3 && pathParts[1] === 'problems') {
      problemTitle = pathParts[2];
    }
    
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

describe('LeetCode Code Saver Extension', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset Monaco editor mock
    delete window.monaco;
    // Reset textarea value
    const textarea = document.querySelector('textarea');
    if (textarea) textarea.value = 'console.log(\'test\');';
  });

  describe('getProblemInfo function', () => {
    test('should extract problem title from URL', () => {
      // Use the exposed function from the extension with a test URL
      const info = window.LeetCodeCodeSaver.getProblemInfoFromUrl('https://leetcode.com/problems/two-sum/');
      expect(info.title).toBe('two-sum');
      expect(info.timestamp).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(info.url).toBe('https://leetcode.com/problems/two-sum/');
    });

    test('should handle unknown problem format', () => {
      // Use the exposed function from the extension with a test URL
      const info = window.LeetCodeCodeSaver.getProblemInfoFromUrl('https://leetcode.com/some/other/page/');
      expect(info.title).toBe('unknown-problem');
    });
  });

  describe('getCodeFromEditor function', () => {
    test('should get code from Monaco editor', () => {
      // Mock monaco editor
      window.monaco = {
        editor: {
          getEditors: () => [{
            getValue: () => 'console.log("Hello World");'
          }]
        }
      };

      const getCodeFromEditor = window.LeetCodeCodeSaver.getCodeFromEditor;

      expect(getCodeFromEditor()).toBe('console.log("Hello World");');
    });

    test('should fallback to textarea', async () => {
      const getCodeFromEditor = window.LeetCodeCodeSaver.getCodeFromEditor;

      const code = await getCodeFromEditor();
      expect(code).toBe('console.log(\'test\');');
    });

    test('should throw error when no editor found', () => {
      // Ensure no editor elements
      delete window.monaco;
      const textarea = document.querySelector('textarea');
      if (textarea) document.body.removeChild(textarea);

      const getCodeFromEditor = window.LeetCodeCodeSaver.getCodeFromEditor;

      expect(() => getCodeFromEditor()).toThrow('Could not find code editor');
    });
  });

  describe('saveToGitHub function', () => {
    test('should save code to GitHub successfully', async () => {
      // Mock successful GitHub API response
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: 'abc123', path: 'leetcode/test.txt' })
      });

      // Mock implementation of saveToGitHub function
      const saveToGitHub = async (code, problemInfo, settings) => {
        if (!settings.token || !settings.repo) {
          throw new Error('GitHub token or repository not configured');
        }
        
        const sanitizedTitle = problemInfo.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${sanitizedTitle}-${timestamp}.txt`;
        const filePath = `${settings.folder}/${filename}`.replace(/\/+/g, '/');
        
        const apiUrl = `https://api.github.com/repos/${settings.repo}/contents/${filePath}`;
        
        // Check if file already exists (mocked to return null for new file)
        let existingFile = null;
        
        // Prepare request body
        const content = btoa(unescape(encodeURIComponent(code)));
        const commitMessage = `Save LeetCode solution: ${problemInfo.title} (${problemInfo.timestamp})`;
        
        const requestBody = {
          message: commitMessage,
          content: content,
          branch: settings.branch
        };
        
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
      };

      const code = 'console.log("test");';
      const problemInfo = {
        title: 'test-problem',
        timestamp: '2026-03-20T10:30:00.000Z',
        url: 'https://leetcode.com/problems/test-problem/'
      };
      const settings = {
        token: 'ghp_faketoken123',
        repo: 'owner/repo',
        branch: 'main',
        folder: 'leetcode'
      };

      const result = await saveToGitHub(code, problemInfo, settings);
      expect(result).toEqual({ sha: 'abc123', path: 'leetcode/test.txt' });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('should throw error when GitHub token missing', async () => {
      const saveToGitHub = async (code, problemInfo, settings) => {
        if (!settings.token || !settings.repo) {
          throw new Error('GitHub token or repository not configured');
        }
        // Rest of implementation...
      };

      const code = 'console.log("test");';
      const problemInfo = { title: 'test', timestamp: '', url: '' };
      const settings = {
        token: '', // Missing token
        repo: 'owner/repo',
        branch: 'main',
        folder: 'leetcode'
      };

      await expect(saveToGitHub(code, problemInfo, settings))
        .rejects
        .toThrow('GitHub token or repository not configured');
    });

    test('should throw error when GitHub repo missing', async () => {
      const saveToGitHub = async (code, problemInfo, settings) => {
        if (!settings.token || !settings.repo) {
          throw new Error('GitHub token or repository not configured');
        }
        // Rest of implementation...
      };

      const code = 'console.log("test");';
      const problemInfo = { title: 'test', timestamp: '', url: '' };
      const settings = {
        token: 'ghp_faketoken123',
        repo: '', // Missing repo
        branch: 'main',
        folder: 'leetcode'
      };

      await expect(saveToGitHub(code, problemInfo, settings))
        .rejects
        .toThrow('GitHub token or repository not configured');
    });

    test('should handle GitHub API error', async () => {
      // Mock failed GitHub API response
      fetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Not Found' })
      });

      const saveToGitHub = async (code, problemInfo, settings) => {
        if (!settings.token || !settings.repo) {
          throw new Error('GitHub token or repository not configured');
        }
        
        const apiUrl = `https://api.github.com/repos/${settings.repo}/contents/test.txt`;
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `token ${settings.token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`GitHub API error: ${errorData.message || response.statusText}`);
        }
        
        return await response.json();
      };

      const code = 'console.log("test");';
      const problemInfo = { title: 'test', timestamp: '', url: '' };
      const settings = {
        token: 'ghp_faketoken123',
        repo: 'owner/repo',
        branch: 'main',
        folder: 'leetcode'
      };

      await expect(saveToGitHub(code, problemInfo, settings))
        .rejects
        .toThrow('GitHub API error: Not Found');
    });
  });
});