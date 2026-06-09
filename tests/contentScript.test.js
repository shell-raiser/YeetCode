/**
 * Unit tests for YeetCode extension
 * Tests the real implementations of contentScript.js and background.js
 */

// Mock chrome APIs
const messageListeners = [];
global.chrome = {
  storage: {
    sync: {
      get: jest.fn((keys, callback) => {
        callback({
          githubToken: 'ghp_mocktoken123',
          githubRepo: 'owner/repo',
          githubBranch: 'main',
          githubFolder: '',
          saveNotesAndTimer: true
        });
      }),
      set: jest.fn((items, callback) => {
        if (callback) callback();
      })
    }
  },
  runtime: {
    onMessage: {
      addListener: jest.fn((listener) => {
        messageListeners.push(listener);
      })
    },
    sendMessage: jest.fn((message, callback) => {
      const sender = {};
      const sendResponse = (response) => {
        if (callback) callback(response);
      };
      for (const listener of messageListeners) {
        listener(message, sender, sendResponse);
      }
    }),
    getURL: jest.fn((path) => `chrome-extension://mock-extension/${path}`),
    onInstalled: { addListener: jest.fn() },
    onUpdateAvailable: { addListener: jest.fn() }
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

// Require the actual source files
require('../background.js');
require('../contentScript.js');

describe('YeetCode Extension', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    delete window.monaco;
    const textarea = document.querySelector('textarea');
    if (textarea) textarea.value = "console.log('test');";
  });

  // ─────────────────────────────────────────────────────
  // getProblemInfo
  // ─────────────────────────────────────────────────────
  describe('getProblemInfo function', () => {
    test('should extract problem title from URL', () => {
      const info = window.LeetCodeCodeSaver.getProblemInfoFromUrl('https://leetcode.com/problems/two-sum/');
      expect(info.title).toBe('two-sum');
      expect(info.timestamp).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(info.url).toBe('https://leetcode.com/problems/two-sum/');
    });

    test('should handle unknown problem format', () => {
      const info = window.LeetCodeCodeSaver.getProblemInfoFromUrl('https://leetcode.com/some/other/page/');
      expect(info.title).toBe('unknown-problem');
    });
  });

  // ─────────────────────────────────────────────────────
  // getCodeFromEditor
  // ─────────────────────────────────────────────────────
  describe('getCodeFromEditor function', () => {
    test('should get code from Monaco editor', () => {
      window.monaco = {
        editor: {
          getEditors: () => [{ getValue: () => 'console.log("Hello World");' }]
        }
      };
      expect(window.LeetCodeCodeSaver.getCodeFromEditor()).toBe('console.log("Hello World");');
    });

    test('should fallback to textarea', () => {
      expect(window.LeetCodeCodeSaver.getCodeFromEditor()).toBe("console.log('test');");
    });

    test('should throw error when no editor found', () => {
      delete window.monaco;
      const textarea = document.querySelector('textarea');
      if (textarea) textarea.parentNode.removeChild(textarea);
      expect(() => window.LeetCodeCodeSaver.getCodeFromEditor()).toThrow('Could not find code editor');
      // Restore textarea
      const newTextarea = document.createElement('textarea');
      newTextarea.style.display = 'none';
      newTextarea.value = "console.log('test');";
      document.body.appendChild(newTextarea);
    });
  });

  // ─────────────────────────────────────────────────────
  // Content script DOM integration helpers
  // ─────────────────────────────────────────────────────
  describe('content script DOM integration', () => {
    test('should attach the manual save button during startup scan', () => {
      document.body.innerHTML = `
        <div id="editor-container"></div>
        <button data-testid="judge-button">Submit</button>
        <textarea>console.log('test');</textarea>
      `;

      window.LeetCodeCodeSaver.scanPageForSaverHooks();

      const saveButton = document.getElementById('leetcode-saver-button');
      expect(saveButton).not.toBeNull();
      expect(saveButton.textContent).toContain('Yeet');
    });

    test('should detect Accepted submission status from the DOM', () => {
      document.body.innerHTML = '<div data-e2e-locator="console-result">Accepted</div>';

      expect(window.LeetCodeCodeSaver.checkSubmissionSuccess()).toBe(true);
    });

    test('should scrape notes from textareas and timer values from timer elements', () => {
      document.body.innerHTML = `
        <textarea placeholder="Write a note">Use prefix sums.</textarea>
        <span class="session-timer">01:23:45</span>
      `;

      expect(window.LeetCodeCodeSaver.getNotesValue()).toBe('Use prefix sums.');
      expect(window.LeetCodeCodeSaver.getTimerValue()).toBe('01:23:45');
    });

    test('should scrape notes from rich text note editors', () => {
      document.body.innerHTML = `
        <section class="question-notes-panel">
          <div class="ProseMirror" contenteditable="true">
            Remember to use two pointers after sorting.
          </div>
        </section>
      `;

      expect(window.LeetCodeCodeSaver.getNotesValue()).toBe('Remember to use two pointers after sorting.');
    });

    test('should scrape notes from LeetCode EasyMDE CodeMirror editor', () => {
      document.body.innerHTML = `
        <div id="note_tabbar_outer"></div>
        <div id="simplemde-editor-2-wrapper" class="mde-editor no-background">
          <textarea id="simplemde-editor-2" style="display: none;"></textarea>
          <div class="EasyMDEContainer" role="application">
            <div class="CodeMirror cm-s-easymde CodeMirror-wrap">
              <div class="CodeMirror-code" role="presentation">
                <pre class=" CodeMirror-line " role="presentation">
                  <span role="presentation">
                    <span class="cm-formatting cm-formatting-header cm-header"># </span><span class="cm-header">test</span>
                  </span>
                </pre>
                <pre class=" CodeMirror-line " role="presentation">
                  <span role="presentation">These are the notes that needs to be uploaded to github</span>
                </pre>
              </div>
            </div>
          </div>
        </div>
      `;

      expect(window.LeetCodeCodeSaver.getNotesValue()).toBe(
        '# test\nThese are the notes that needs to be uploaded to github'
      );
    });

    test('should fallback to note-like localStorage values', () => {
      document.body.innerHTML = '<main></main>';
      window.localStorage.setItem('leetcode-note-two-sum', JSON.stringify({
        content: 'Stored note from LeetCode notes panel.'
      }));

      expect(window.LeetCodeCodeSaver.getNotesValue()).toBe('Stored note from LeetCode notes panel.');
    });

    test('should return null when notes and timer are unavailable', () => {
      document.body.innerHTML = '<main><p>No notes here</p></main>';

      expect(window.LeetCodeCodeSaver.getNotesValue()).toBeNull();
      expect(window.LeetCodeCodeSaver.getTimerValue()).toBeNull();
    });

    test('should load the page bridge as an extension script instead of inline script', async () => {
      document.body.innerHTML = '';

      const extraction = window.LeetCodeCodeSaver.getCodeAndLanguageFromPage();
      const bridgeScript = document.querySelector('script[src="chrome-extension://mock-extension/pageBridge.js"]');

      expect(bridgeScript).not.toBeNull();
      expect(bridgeScript.textContent).toBe('');

      document.dispatchEvent(new CustomEvent('LeetCodeCodeSaver_CodeExtracted', {
        detail: { code: 'return true;', languageId: 'javascript' }
      }));

      await expect(extraction).resolves.toEqual({
        code: 'return true;',
        languageId: 'javascript'
      });
    });
  });

  // ─────────────────────────────────────────────────────
  // saveToGitHub – code file only (no notes)
  // ─────────────────────────────────────────────────────
  describe('Background saveToGitHub – code only', () => {
    test('should save code inside a stable problem folder at repo root', (done) => {
      fetch
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ message: 'Not Found' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'abc123' } }) });

      // Override storage to return saveNotesAndTimer: false
      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({ githubToken: 'ghp_mock', githubRepo: 'owner/repo', githubBranch: 'main', githubFolder: '', saveNotesAndTimer: false });
      });

      chrome.runtime.sendMessage({
        action: 'saveToGitHub',
        code: 'print("hi")',
        problemInfo: { title: 'two-sum', timestamp: '2026-01-01T00:00:00-000Z', url: 'https://leetcode.com/problems/two-sum/' },
        languageId: 'python'
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          // Only 2 fetch calls: 1 GET check + 1 PUT (no notes)
          expect(fetch).toHaveBeenCalledTimes(2);
          const putUrl = fetch.mock.calls[1][0];
          expect(putUrl).toMatch(/\/contents\/two-sum\/two-sum\.py$/);
          done();
        } catch (e) { done(e); }
      });
    });

    test('should save code with correct file extension for javascript', (done) => {
      fetch
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ message: 'Not Found' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'def456' } }) });

      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({ githubToken: 'ghp_mock', githubRepo: 'owner/repo', githubBranch: 'main', githubFolder: '', saveNotesAndTimer: false });
      });

      chrome.runtime.sendMessage({
        action: 'saveToGitHub',
        code: 'console.log("hi");',
        problemInfo: { title: 'two-sum', timestamp: '2026-01-01T00:00:00-000Z', url: '' },
        languageId: 'javascript'
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          const putUrl = fetch.mock.calls[1][0];
          expect(putUrl).toContain('/contents/two-sum/two-sum.js');
          done();
        } catch (e) { done(e); }
      });
    });

    test('should handle GitHub API failure during commit', (done) => {
      fetch
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ message: 'Not Found' }) })
        .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ message: 'Bad credentials' }) });

      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({ githubToken: 'ghp_mock', githubRepo: 'owner/repo', githubBranch: 'main', githubFolder: '', saveNotesAndTimer: false });
      });

      chrome.runtime.sendMessage({
        action: 'saveToGitHub',
        code: 'print("hello")',
        problemInfo: { title: 'error-test', timestamp: '2026', url: '' },
        languageId: 'python'
      }, (response) => {
        try {
          expect(response.success).toBe(false);
          expect(response.error).toContain('Bad credentials');
          done();
        } catch (e) { done(e); }
      });
    });

    test('should update existing file by including SHA', (done) => {
      fetch
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ sha: 'existingSha123' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'newSha456' } }) });

      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({ githubToken: 'ghp_mock', githubRepo: 'owner/repo', githubBranch: 'main', githubFolder: '', saveNotesAndTimer: false });
      });

      chrome.runtime.sendMessage({
        action: 'saveToGitHub',
        code: 'console.log("update");',
        problemInfo: { title: 'two-sum', timestamp: '2026', url: '' },
        languageId: 'javascript'
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          const putConfig = fetch.mock.calls[1][1];
          const body = JSON.parse(putConfig.body);
          expect(body.sha).toBe('existingSha123');
          done();
        } catch (e) { done(e); }
      });
    });
  });

  // ─────────────────────────────────────────────────────
  // saveToGitHub – with notes and timer
  // ─────────────────────────────────────────────────────
  describe('Background saveToGitHub – with notes and timer', () => {
    test('should commit notes markdown file as second commit when notes present', (done) => {
      // 4 fetch calls: GET code, PUT code, GET notes, PUT notes
      fetch
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ message: 'Not Found' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'code-sha' } }) })
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ message: 'Not Found' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'notes-sha' } }) });

      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({ githubToken: 'ghp_mock', githubRepo: 'owner/repo', githubBranch: 'main', githubFolder: '', saveNotesAndTimer: true });
      });

      chrome.runtime.sendMessage({
        action: 'saveToGitHub',
        code: 'print("hi")',
        problemInfo: { title: 'two-sum', timestamp: '2026-01-01T00:00:00-000Z', url: 'https://leetcode.com/problems/two-sum/' },
        languageId: 'python',
        notesText: 'Use a hash map for O(n) solution.',
        timerValue: '15:32'
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          // Should have made 4 fetch calls total
          expect(fetch).toHaveBeenCalledTimes(4);

          // Third PUT is the notes file
          const notesPutUrl = fetch.mock.calls[3][0];
          expect(notesPutUrl).toContain('/contents/two-sum/two-sum-notes.md');

          // Notes file content should be base64-encoded markdown
          const notesPutBody = JSON.parse(fetch.mock.calls[3][1].body);
          const decodedNotes = decodeURIComponent(escape(atob(notesPutBody.content)));
          expect(decodedNotes).toContain('Use a hash map for O(n) solution.');
          expect(decodedNotes).toContain('15:32');
          expect(decodedNotes).toContain('two-sum');
          done();
        } catch (e) { done(e); }
      });
    });

    test('should NOT commit notes file when saveNotesAndTimer is false', (done) => {
      fetch
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ message: 'Not Found' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'code-sha' } }) });

      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({ githubToken: 'ghp_mock', githubRepo: 'owner/repo', githubBranch: 'main', githubFolder: '', saveNotesAndTimer: false });
      });

      chrome.runtime.sendMessage({
        action: 'saveToGitHub',
        code: 'print("hi")',
        problemInfo: { title: 'two-sum', timestamp: '2026', url: '' },
        languageId: 'python',
        notesText: 'Some notes',
        timerValue: '10:00'
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          // Only 2 fetch calls (no notes commit)
          expect(fetch).toHaveBeenCalledTimes(2);
          done();
        } catch (e) { done(e); }
      });
    });

    test('should commit an empty notes file when saveNotesAndTimer is enabled', (done) => {
      fetch
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ message: 'Not Found' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'code-sha' } }) })
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ message: 'Not Found' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'notes-sha' } }) });

      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({ githubToken: 'ghp_mock', githubRepo: 'owner/repo', githubBranch: 'main', githubFolder: '', saveNotesAndTimer: true });
      });

      chrome.runtime.sendMessage({
        action: 'saveToGitHub',
        code: 'print("hi")',
        problemInfo: { title: 'two-sum', timestamp: '2026', url: '' },
        languageId: 'python',
        notesText: null,
        timerValue: null
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(fetch).toHaveBeenCalledTimes(4);
          const notesPutUrl = fetch.mock.calls[3][0];
          expect(notesPutUrl).toContain('/contents/two-sum/two-sum-notes.md');
          done();
        } catch (e) { done(e); }
      });
    });

    test('should prepend parent folder when githubFolder is set', (done) => {
      fetch
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ message: 'Not Found' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'code-sha' } }) })
        .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ message: 'Not Found' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'notes-sha' } }) });

      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({ githubToken: 'ghp_mock', githubRepo: 'owner/repo', githubBranch: 'main', githubFolder: 'solutions', saveNotesAndTimer: true });
      });

      chrome.runtime.sendMessage({
        action: 'saveToGitHub',
        code: 'print("hi")',
        problemInfo: { title: 'two-sum', timestamp: '2026', url: '' },
        languageId: 'python',
        notesText: 'Important insight',
        timerValue: null
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          const codeUrl = fetch.mock.calls[1][0];
          const notesUrl = fetch.mock.calls[3][0];
          expect(codeUrl).toContain('/contents/solutions/two-sum/two-sum.py');
          expect(notesUrl).toContain('/contents/solutions/two-sum/two-sum-notes.md');
          done();
        } catch (e) { done(e); }
      });
    });
  });

  // ─────────────────────────────────────────────────────
  // testConnection
  // ─────────────────────────────────────────────────────
  describe('Background testConnection message handling', () => {
    test('should successfully test connection and verify repo scope', (done) => {
      const headers = new Map([['X-OAuth-Scopes', 'repo, user']]);
      fetch.mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: (h) => headers.get(h) },
        json: () => Promise.resolve({ private: true, description: 'A test repo', full_name: 'owner/repo' })
      });

      chrome.runtime.sendMessage({ action: 'testConnection', token: 'ghp_valid', repo: 'owner/repo' }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(response.result.fullName).toBe('owner/repo');
          done();
        } catch (e) { done(e); }
      });
    });

    test('should fail if repo scope is missing', (done) => {
      const headers = new Map([['X-OAuth-Scopes', 'user']]);
      fetch.mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: (h) => headers.get(h) },
        json: () => Promise.resolve({ private: true, full_name: 'owner/repo' })
      });

      chrome.runtime.sendMessage({ action: 'testConnection', token: 'ghp_norepo', repo: 'owner/repo' }, (response) => {
        try {
          expect(response.success).toBe(false);
          expect(response.error).toContain("Missing Permission");
          done();
        } catch (e) { done(e); }
      });
    });

    test('should fail if repository does not exist (404)', (done) => {
      fetch.mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ message: 'Not Found' }) });

      chrome.runtime.sendMessage({ action: 'testConnection', token: 'ghp_valid', repo: 'owner/nonexistent' }, (response) => {
        try {
          expect(response.success).toBe(false);
          expect(response.error).toContain("Repository not found");
          done();
        } catch (e) { done(e); }
      });
    });
  });
});
