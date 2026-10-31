/**
 * Unit tests for YeetCode extension
 * Tests the real implementations of contentScript.js and background.js
 */

// Mock chrome APIs
const messageListeners = [];
global.chrome = {
  storage: {
    onChanged: {
      addListener: jest.fn()
    },
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
      const sender = { tab: { id: 123 } };
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
  },
  scripting: {
    executeScript: jest.fn(() => Promise.resolve([{ result: { success: true } }]))
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

// Let the async lookup chain settle when fake timers are in use.
async function flushMicrotasks(times = 6) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('YeetCode Extension', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
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
      expect(info.problemSlug).toBe('two-sum');
      expect(info.subPath).toBe('');
      expect(info.isContest).toBe(false);
      expect(info.timestamp).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(info.url).toBe('https://leetcode.com/problems/two-sum/');
    });

    test('should handle unknown problem format', () => {
      const info = window.LeetCodeCodeSaver.getProblemInfoFromUrl('https://leetcode.com/some/other/page/');
      expect(info.title).toBe('unknown-problem');
      expect(info.subPath).toBe('');
      expect(info.isContest).toBe(false);
    });

    test('should detect contest problem pages and group under contests/<contest-id>', () => {
      const singular = window.LeetCodeCodeSaver.getProblemInfoFromUrl('https://leetcode.com/contest/weekly-contest-500/problems/two-sum/');
      expect(singular.title).toBe('two-sum');
      expect(singular.subPath).toBe('contests/weekly-contest-500');
      expect(singular.isContest).toBe(true);
      expect(singular.contestFolder).toBe('weekly-contest-500');

      const plural = window.LeetCodeCodeSaver.getProblemInfoFromUrl('https://leetcode.com/contests/weekly-contest-500/problems/two-sum/');
      expect(plural.title).toBe('two-sum');
      expect(plural.subPath).toBe('contests/weekly-contest-500');
      expect(plural.isContest).toBe(true);
      expect(plural.contestFolder).toBe('weekly-contest-500');
    });

    test('should not treat a contest dashboard page as a problem', () => {
      const info = window.LeetCodeCodeSaver.getProblemInfoFromUrl('https://leetcode.com/contest/weekly-contest-500/');
      expect(info.title).toBe('unknown-problem');
      expect(info.subPath).toBe('');
      expect(info.isContest).toBe(false);
    });

    test('should extract contest problem info from contest URL', () => {
      const info = window.LeetCodeCodeSaver.getProblemInfoFromUrl('https://leetcode.com/contest/weekly-contest-500/problems/two-sum/');
      expect(info.title).toBe('two-sum');
      expect(info.contestFolder).toBe('weekly-contest-500');
      expect(info.problemSlug).toBe('two-sum');
      expect(info.url).toBe('https://leetcode.com/contest/weekly-contest-500/problems/two-sum/');
    });

    test('should keep contest URL slugs when the visible heading differs', () => {
      window.history.replaceState({}, '', '/contest/weekly-contest-500/problems/two-sum/');
      document.body.innerHTML = '<h1>Visible Problem Name</h1>';

      const info = window.LeetCodeCodeSaver.getProblemInfo();

      expect(info.title).toBe('two-sum');
      expect(info.subPath).toBe('contests/weekly-contest-500');
      expect(info.isContest).toBe(true);
      expect(info.contestFolder).toBe('weekly-contest-500');

      window.history.replaceState({}, '', '/');
      document.body.innerHTML = `
        <div id="editor-container"></div>
        <button data-testid="judge-button">Submit</button>
        <textarea style="display:none;">console.log('test');</textarea>
      `;
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
        <div class="flex">
          <div class="group flex items-center">
            <div data-state="closed">
              <button data-testid="judge-button">Submit</button>
            </div>
          </div>
        </div>
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

    test('should show GitHub, open, and import actions for a saved solution', () => {
      document.body.innerHTML = `
        <div class="flex">
          <div class="group"><div><button data-testid="judge-button">Submit</button></div></div>
        </div>
      `;

      window.LeetCodeCodeSaver.showGitHubSolutionActions({
        repo: 'owner/repo',
        branch: 'main',
        codeFilePath: 'two-sum/two-sum.py'
      });

      const openLink = document.getElementById('leetcode-open-github');
      expect(openLink.textContent.trim()).toBe('Open');
      expect(openLink.target).toBe('_blank');
      expect(openLink.href).toContain('/blob/main/two-sum/two-sum.py');
      expect(openLink.querySelector('img').src).toContain('/GITHUB_LOGO.svg');
      expect(document.getElementById('leetcode-github-link')).toBeNull();
      const importButton = document.getElementById('leetcode-import-github');
      expect(importButton.textContent.trim()).toBe('Import');
      expect(importButton.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
    });

    test('should put Yeet and GitHub actions in the same row', () => {
      document.body.innerHTML = `
        <div class="flex">
          <div class="group"><div><button data-testid="judge-button">Submit</button></div></div>
        </div>
        <div class="monaco-editor"></div>
      `;

      window.LeetCodeCodeSaver.scanPageForSaverHooks();
      window.LeetCodeCodeSaver.showGitHubSolutionActions({
        repo: 'owner/repo',
        branch: 'main',
        codeFilePath: 'two-sum/two-sum.py'
      });

      const actionsRow = document.getElementById('leetcode-actions-row');
      expect(actionsRow).not.toBeNull();
      expect(actionsRow.contains(document.getElementById('leetcode-saver-button'))).toBe(true);
      expect(actionsRow.contains(document.getElementById('leetcode-open-github'))).toBe(true);
      expect(actionsRow.contains(document.getElementById('leetcode-import-github'))).toBe(true);
    });

    test('should only auto-check once when LeetCode swaps to the /description/ URL', async () => {
      jest.useFakeTimers();
      window.history.replaceState({}, '', '/problems/climbing-stairs-ii/');
      document.body.innerHTML = `
        <div class="flex">
          <div class="group"><div><button data-testid="judge-button">Submit</button></div></div>
        </div>
        <div class="monaco-editor"></div>
      `;
      window.monaco = {
        editor: {
          getEditors: () => [{
            getValue: () => 'class Solution:',
            getModel: () => ({ getLanguageId: () => 'python3', getValue: () => 'class Solution:' })
          }]
        }
      };

      const initialSendCount = chrome.runtime.sendMessage.mock.calls
        .filter(([msg]) => msg && msg.action === 'checkGitHubSolution').length;

      window.LeetCodeCodeSaver.scanPageForSaverHooks();
      jest.advanceTimersByTime(600);
      await flushMicrotasks();
      const afterFirstScan = chrome.runtime.sendMessage.mock.calls
        .filter(([msg]) => msg && msg.action === 'checkGitHubSolution').length;

      window.history.replaceState({}, '', '/problems/climbing-stairs-ii/description/');
      window.LeetCodeCodeSaver.scanPageForSaverHooks();
      jest.advanceTimersByTime(600);
      await flushMicrotasks();
      const afterUrlVariant = chrome.runtime.sendMessage.mock.calls
        .filter(([msg]) => msg && msg.action === 'checkGitHubSolution').length;

      jest.useRealTimers();

      expect(afterFirstScan).toBe(initialSendCount + 1);
      expect(afterUrlVariant).toBe(afterFirstScan);
    });

    test('should re-attach the cached GitHub actions after a pane remount', () => {
      window.history.replaceState({}, '', '/problems/two-sum/');
      document.body.innerHTML = `
        <div class="flex">
          <div class="group"><div><button data-testid="judge-button">Submit</button></div></div>
        </div>
        <div class="monaco-editor"></div>
      `;

      const result = {
        repo: 'owner/repo',
        branch: 'main',
        codeFilePath: 'two-sum/two-sum.py'
      };

      // Let the module observe this problem before caching the lookup result.
      window.LeetCodeCodeSaver.scanPageForSaverHooks();

      // Simulate the cached lookup result the content script keeps around.
      window.LeetCodeCodeSaver.showGitHubSolutionActions(result);
      expect(document.getElementById('leetcode-open-github')).not.toBeNull();

      // LeetCode wipes the submit row when the user switches panes.
      document.body.innerHTML = `
        <div class="flex">
          <div class="group"><div><button data-testid="judge-button">Submit</button></div></div>
        </div>
        <div class="monaco-editor"></div>
      `;

      const sendCountBeforeRescan = chrome.runtime.sendMessage.mock.calls
        .filter(([msg]) => msg && msg.action === 'checkGitHubSolution').length;

      window.history.replaceState({}, '', '/problems/two-sum/description/');
      window.LeetCodeCodeSaver.scanPageForSaverHooks();

      expect(document.getElementById('leetcode-open-github')).not.toBeNull();
      expect(document.getElementById('leetcode-import-github')).not.toBeNull();
      expect(document.getElementById('leetcode-actions-row').contains(document.getElementById('leetcode-saver-button'))).toBe(true);
      expect(document.getElementById('leetcode-open-github').href)
        .toContain('/blob/main/two-sum/two-sum.py');

      const sendCountAfterRescan = chrome.runtime.sendMessage.mock.calls
        .filter(([msg]) => msg && msg.action === 'checkGitHubSolution').length;
      expect(sendCountAfterRescan).toBe(sendCountBeforeRescan);
    });
  });

  // ─────────────────────────────────────────────────────
  // GitHub solution lookup and import
  // ─────────────────────────────────────────────────────
  describe('Background GitHub solution lookup and import', () => {
    const problemInfo = {
      title: 'two-sum',
      isContest: false,
      timestamp: '2026-01-01T00:00:00-000Z',
      url: 'https://leetcode.com/problems/two-sum/'
    };

    test('should check only the currently selected language path', (done) => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'Not Found' })
      });

      chrome.runtime.sendMessage({
        action: 'checkGitHubSolution',
        problemInfo,
        languageId: 'python3',
        editorCode: 'class Solution:\n    pass'
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(response.result.found).toBe(false);
          expect(fetch.mock.calls[0][0]).toContain('/contents/two-sum/two-sum.py?ref=main');
          expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
          done();
        } catch (error) { done(error); }
      });
    });

    test('should import the selected language solution into the editor', (done) => {
      const solution = '# café\nclass Solution:\n    pass\n';
      window.history.replaceState({}, '', '/problems/two-sum/');
      let editorCode = 'existing code';
      const model = {
        getLanguageId: () => 'python3',
        getValue: () => editorCode,
        setValue: (code) => { editorCode = code; }
      };
      window.monaco = {
        editor: {
          getEditors: () => [{
            getModel: () => model,
            getValue: () => editorCode,
            setValue: (code) => { editorCode = code; }
          }]
        }
      };
      chrome.scripting.executeScript.mockImplementationOnce(({ func, args }) => {
        return Promise.resolve([{ result: func(...args) }]);
      });
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          content: btoa(unescape(encodeURIComponent(solution))),
          path: 'two-sum/two-sum.py'
        })
      });

      chrome.runtime.sendMessage({
        action: 'importFromGitHub',
        problemInfo,
        languageId: 'python3'
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(response.result.found).toBe(true);
          expect(chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
            target: { tabId: 123 },
            world: 'MAIN',
            args: [solution, 'python3', null, '/problems/two-sum/']
          }));
          expect(editorCode).toBe(solution);
          window.history.replaceState({}, '', '/');
          done();
        } catch (error) { done(error); }
      });
    });

    test('should not import when the selected language solution is missing', (done) => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'Not Found' })
      });

      chrome.runtime.sendMessage({
        action: 'importFromGitHub',
        problemInfo,
        languageId: 'javascript'
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(response.result.found).toBe(false);
          expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
          expect(fetch.mock.calls[0][0]).toContain('/contents/two-sum/two-sum.js?ref=main');
          done();
        } catch (error) { done(error); }
      });
    });

    test('should check contest solutions under the configured parent and contest folders', (done) => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'Not Found' })
      });
      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({
          githubToken: 'ghp_mock',
          githubRepo: 'owner/repo',
          githubBranch: 'main',
          githubFolder: 'solutions',
          saveNotesAndTimer: true,
          autoImportFromGitHub: false
        });
      });

      chrome.runtime.sendMessage({
        action: 'checkGitHubSolution',
        problemInfo: {
          ...problemInfo,
          isContest: true,
          contestFolder: 'weekly-contest-500',
          subPath: 'contests/weekly-contest-500'
        },
        languageId: 'python3',
        editorCode: 'class Solution:\n    pass'
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(fetch.mock.calls[0][0]).toContain(
            '/contents/solutions/contests/weekly-contest-500/two-sum/two-sum.py?ref=main'
          );
          done();
        } catch (error) { done(error); }
      });
    });

    test('should auto-import only when the editor still matches the LeetCode starter', (done) => {
      const starter = 'class Solution:\n    pass';
      window.history.replaceState({}, '', '/problems/two-sum/');
      let editorCode = starter;
      const model = {
        getLanguageId: () => 'python3',
        getValue: () => editorCode,
        setValue: (code) => { editorCode = code; }
      };
      window.monaco = {
        editor: {
          getEditors: () => [{
            getModel: () => model,
            getValue: () => editorCode,
            setValue: (code) => { editorCode = code; }
          }]
        }
      };
      chrome.scripting.executeScript.mockImplementationOnce(({ func, args }) => {
        return Promise.resolve([{ result: func(...args) }]);
      });
      fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ content: btoa('saved solution'), path: 'two-sum/two-sum.py' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: { question: { codeSnippets: [{ langSlug: 'python3', code: starter }] } }
          })
        });
      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({
          githubToken: 'ghp_mock',
          githubRepo: 'owner/repo',
          githubBranch: 'main',
          githubFolder: '',
          saveNotesAndTimer: true,
          autoImportFromGitHub: true
        });
      });

      chrome.runtime.sendMessage({
        action: 'checkGitHubSolution',
        problemInfo,
        languageId: 'python3',
        editorCode: starter,
        allowAutoImport: true
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(response.result.autoImported).toBe(true);
          expect(chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
            args: ['saved solution', 'python3', starter, '/problems/two-sum/']
          }));
          expect(editorCode).toBe('saved solution');
          window.history.replaceState({}, '', '/');
          done();
        } catch (error) { done(error); }
      });
    });

    test('should not auto-import over code that differs from the LeetCode starter', (done) => {
      const starter = 'class Solution:\n    pass';
      fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ content: btoa('saved solution'), path: 'two-sum/two-sum.py' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: { question: { codeSnippets: [{ langSlug: 'python3', code: starter }] } }
          })
        });
      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({
          githubToken: 'ghp_mock',
          githubRepo: 'owner/repo',
          githubBranch: 'main',
          githubFolder: '',
          saveNotesAndTimer: true,
          autoImportFromGitHub: true
        });
      });

      chrome.runtime.sendMessage({
        action: 'checkGitHubSolution',
        problemInfo,
        languageId: 'python3',
        editorCode: `${starter}\n    # user started editing`,
        allowAutoImport: true
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(response.result.autoImported).toBe(false);
          expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
          done();
        } catch (error) { done(error); }
      });
    });

    test('should leave newly edited code unchanged if it changes during lookup', (done) => {
      const starter = 'class Solution:\n    pass';
      window.history.replaceState({}, '', '/problems/two-sum/');
      let editorCode = starter;
      const model = {
        getLanguageId: () => 'python3',
        getValue: () => editorCode,
        setValue: (code) => { editorCode = code; }
      };
      window.monaco = {
        editor: {
          getEditors: () => [{
            getModel: () => model,
            getValue: () => editorCode,
            setValue: (code) => { editorCode = code; }
          }]
        }
      };
      chrome.scripting.executeScript.mockImplementationOnce(({ func, args }) => {
        editorCode = 'new user code';
        return Promise.resolve([{ result: func(...args) }]);
      });
      fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ content: btoa('saved solution'), path: 'two-sum/two-sum.py' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            data: { question: { codeSnippets: [{ langSlug: 'python3', code: starter }] } }
          })
        });
      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({
          githubToken: 'ghp_mock',
          githubRepo: 'owner/repo',
          githubBranch: 'main',
          githubFolder: '',
          saveNotesAndTimer: true,
          autoImportFromGitHub: true
        });
      });

      chrome.runtime.sendMessage({
        action: 'checkGitHubSolution',
        problemInfo,
        languageId: 'python3',
        editorCode: starter,
        allowAutoImport: true
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(response.result.autoImported).toBe(false);
          expect(response.result.autoImportError).toContain('editor changed');
          expect(editorCode).toBe('new user code');
          window.history.replaceState({}, '', '/');
          done();
        } catch (error) { done(error); }
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
        // 1st: LeetCode GraphQL notes lookup (no note stored server-side)
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ data: { question: { questionId: '123', note: null } } }) })
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
          expect(fetch).toHaveBeenCalledTimes(5);
          const notesPutUrl = fetch.mock.calls[4][0];
          expect(notesPutUrl).toContain('/contents/two-sum/two-sum-notes.md');
          done();
        } catch (e) { done(e); }
      });
    });

    test('should fall back to LeetCode GraphQL notes when DOM scraping found none', (done) => {
      fetch
        // 1st: LeetCode GraphQL notes lookup (the user has a Stored note)
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ data: { question: { questionId: '123', note: 'API note: use dynamic programming.' } } }) })
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
        problemInfo: { title: 'two-sum', timestamp: '2026', url: 'https://leetcode.com/problems/two-sum/' },
        languageId: 'python',
        notesText: null,
        timerValue: null
      }, (response) => {
        try {
          expect(response.success).toBe(true);

          // GraphQL call: session cookies, correct operation and variable
          const [notesApiUrl, notesApiConfig] = fetch.mock.calls[0];
          expect(notesApiUrl).toContain('leetcode.com/graphql');
          expect(notesApiConfig.method).toBe('POST');
          expect(notesApiConfig.credentials).toBe('include');
          const notesApiOperation = JSON.parse(notesApiConfig.body);
          expect(notesApiOperation.operationName).toBe('questionNote');
          expect(notesApiOperation.variables).toEqual({ titleSlug: 'two-sum' });

          // The note is embedded in the committed markdown
          const notesPutBody = JSON.parse(fetch.mock.calls[4][1].body);
          const decodedNotes = decodeURIComponent(escape(atob(notesPutBody.content)));
          expect(decodedNotes).toContain('API note: use dynamic programming.');
          done();
        } catch (e) { done(e); }
      });
    });

    test('should keep saving when the LeetCode GraphQL notes lookup fails', (done) => {
      fetch
        // 1st: notes lookup fails (session expired / network) -> gracefully continue
        .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ message: 'Unauthorized' }) })
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
          expect(fetch).toHaveBeenCalledTimes(5);
          const notesPutBody = JSON.parse(fetch.mock.calls[4][1].body);
          const decodedNotes = decodeURIComponent(escape(atob(notesPutBody.content)));
          expect(decodedNotes).not.toContain('## Notes');
          done();
        } catch (e) { done(e); }
      });
    });

    test('should place contest problem files under contests/<contest-id>/', (done) => {
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
        problemInfo: {
          title: 'two-sum',
          subPath: 'contests/weekly-contest-500',
          isContest: true,
          timestamp: '2026-01-01T00:00:00-000Z',
          url: 'https://leetcode.com/contest/weekly-contest-500/problems/two-sum/'
        },
        languageId: 'python',
        notesText: 'Contest notes',
        timerValue: null
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          const codeUrl = fetch.mock.calls[1][0];
          const notesUrl = fetch.mock.calls[3][0];
          expect(codeUrl).toContain('/contents/contests/weekly-contest-500/two-sum/two-sum.py');
          expect(notesUrl).toContain('/contents/contests/weekly-contest-500/two-sum/two-sum-notes.md');
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
