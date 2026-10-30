/**
 * Unit tests for options.js
 */

// Define chrome mock at top level so options.js can access it during require
global.chrome = {
  storage: {
    onChanged: {
      addListener: jest.fn()
    },
    sync: {
      get: jest.fn((keys, callback) => {
        callback({
          githubToken: 'ghp_savedtoken',
          githubRepo: 'saved/repo',
          githubBranch: 'saved-branch',
          githubFolder: 'leetcode',
          saveNotesAndTimer: true,
          aiEnabled: true,
          aiEndpoint: 'https://ai.example.com/v1/chat/completions',
          aiApiKey: 'sk_savedkey',
          aiModel: 'saved-model',
          nudgeAtMinutes: 15,
          deadlineAtMinutes: 45,
          minHelpMinutes: 5,
          concepts: [
            { name: 'Graphs', level: 'low' },
            { name: 'Dynamic Programming', level: 'not studied' }
          ]
        });
      }),
      set: jest.fn((items, callback) => {
        if (callback) callback();
      })
    }
  },
  runtime: {
    sendMessage: jest.fn((message, callback) => {
      if (message && message.action === 'testConnection') {
        callback({ success: true, result: { fullName: 'saved/repo', private: false } });
      } else if (callback) {
        callback({ success: true });
      }
    })
  },
  permissions: {
    request: jest.fn((perms, callback) => callback(true))
  }
};

// Require the options script once
require('../options.js');

describe('Options Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Set up DOM including the saveNotesAndTimer checkbox and AI helper fields
    document.body.innerHTML = `
      <input type="password" id="githubToken">
      <input type="checkbox" id="toggleToken">
      <input type="text" id="githubRepo">
      <input type="text" id="githubBranch" value="main">
      <input type="text" id="githubFolder">
      <input type="checkbox" id="saveNotesAndTimer" checked>
      <button id="test">Test Connection</button>
      <button id="save">Save Settings</button>
      <div id="status"></div>
      <input type="checkbox" id="aiEnabled">
      <input type="text" id="aiEndpoint">
      <input type="password" id="aiApiKey">
      <input type="text" id="aiModel">
      <input type="number" id="nudgeAtMinutes">
      <input type="number" id="deadlineAtMinutes">
      <input type="number" id="minHelpMinutes">
      <div id="conceptsList"></div>
      <button id="addConcept">+ Add concept</button>
    `;

    // Trigger DOMContentLoaded to bind event listeners to the new DOM elements
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  // ─────────────────────────────────────────────────────
  // Settings loading
  // ─────────────────────────────────────────────────────
  test('should load saved settings including AI helper fields on DOMContentLoaded', () => {
    expect(chrome.storage.sync.get).toHaveBeenCalledWith([
      'githubToken',
      'githubRepo',
      'githubBranch',
      'githubFolder',
      'saveNotesAndTimer',
      'aiEnabled',
      'aiEndpoint',
      'aiApiKey',
      'aiModel',
      'nudgeAtMinutes',
      'deadlineAtMinutes',
      'minHelpMinutes',
      'concepts'
    ], expect.any(Function));

    expect(document.getElementById('githubToken').value).toBe('ghp_savedtoken');
    expect(document.getElementById('githubRepo').value).toBe('saved/repo');
    expect(document.getElementById('githubBranch').value).toBe('saved-branch');
    expect(document.getElementById('githubFolder').value).toBe('leetcode');
    expect(document.getElementById('saveNotesAndTimer').checked).toBe(true);

    expect(document.getElementById('aiEnabled').checked).toBe(true);
    expect(document.getElementById('aiEndpoint').value).toBe('https://ai.example.com/v1/chat/completions');
    expect(document.getElementById('aiApiKey').value).toBe('sk_savedkey');
    expect(document.getElementById('aiModel').value).toBe('saved-model');
    expect(document.getElementById('nudgeAtMinutes').value).toBe('15');
    expect(document.getElementById('deadlineAtMinutes').value).toBe('45');
    expect(document.getElementById('minHelpMinutes').value).toBe('5');

    const conceptRows = document.querySelectorAll('#conceptsList .concept-row');
    expect(conceptRows.length).toBe(2);
    expect(conceptRows[0].querySelector('.concept-name').value).toBe('Graphs');
    expect(conceptRows[0].querySelector('.concept-level').value).toBe('low');
    expect(conceptRows[1].querySelector('.concept-level').value).toBe('not studied');
  });

  test('should seed default concept rows and AI timings when nothing is stored', () => {
    chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
      callback({ githubToken: 'ghp_t', githubRepo: 'o/r', githubBranch: 'main', githubFolder: '', saveNotesAndTimer: false });
    });
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(document.getElementById('aiEnabled').checked).toBe(false);
    expect(document.getElementById('nudgeAtMinutes').value).toBe('15');
    expect(document.getElementById('deadlineAtMinutes').value).toBe('45');
    expect(document.getElementById('minHelpMinutes').value).toBe('5');

    const conceptRows = document.querySelectorAll('#conceptsList .concept-row');
    expect(conceptRows.length).toBeGreaterThanOrEqual(1);
    expect(conceptRows[0].querySelector('.concept-level').value).toBe('not studied');
  });

  test('should default saveNotesAndTimer to false when stored that way', () => {
    chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
      callback({ githubToken: 'ghp_t', githubRepo: 'o/r', githubBranch: 'main', githubFolder: '', saveNotesAndTimer: false });
    });
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(document.getElementById('saveNotesAndTimer').checked).toBe(false);
  });

  // ─────────────────────────────────────────────────────
  // Password toggle
  // ─────────────────────────────────────────────────────
  test('should toggle token visibility', () => {
    const tokenInput = document.getElementById('githubToken');
    const toggleCheckbox = document.getElementById('toggleToken');

    expect(tokenInput.type).toBe('password');
    toggleCheckbox.checked = true;
    toggleCheckbox.dispatchEvent(new Event('change'));
    expect(tokenInput.type).toBe('text');

    toggleCheckbox.checked = false;
    toggleCheckbox.dispatchEvent(new Event('change'));
    expect(tokenInput.type).toBe('password');
  });

  // ─────────────────────────────────────────────────────
  // Concept rows editing
  // ─────────────────────────────────────────────────────
  test('should add and remove concept rows', () => {
    document.getElementById('addConcept').dispatchEvent(new Event('click'));

    let rows = document.querySelectorAll('#conceptsList .concept-row');
    expect(rows.length).toBe(3);
    expect(rows[2].querySelector('.concept-name').value).toBe('');

    rows[0].querySelector('.concept-remove').dispatchEvent(new Event('click'));
    rows = document.querySelectorAll('#conceptsList .concept-row');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.concept-name').value).toBe('Dynamic Programming');
  });

  // ─────────────────────────────────────────────────────
  // Saving settings
  // ─────────────────────────────────────────────────────
  test('should save all settings including AI helper fields and concepts', () => {
    const tokenInput = document.getElementById('githubToken');
    const repoInput = document.getElementById('githubRepo');
    const branchInput = document.getElementById('githubBranch');
    const notesToggle = document.getElementById('saveNotesAndTimer');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');

    tokenInput.value = 'ghp_newtoken';
    repoInput.value = 'new/repo';
    branchInput.value = 'prod';
    document.getElementById('githubFolder').value = '';
    notesToggle.checked = false;
    document.getElementById('aiEnabled').checked = false;
    document.getElementById('aiEndpoint').value = 'https://api.mycorp.ai/v1/chat/completions';
    document.getElementById('aiModel').value = 'my-model';
    document.getElementById('nudgeAtMinutes').value = '10';
    document.getElementById('deadlineAtMinutes').value = '60';
    document.getElementById('minHelpMinutes').value = '0';

    // remove second concept, edit first concept level
    document.querySelectorAll('#conceptsList .concept-remove')[1].dispatchEvent(new Event('click'));
    const firstConcept = document.querySelector('#conceptsList .concept-row');
    firstConcept.querySelector('.concept-level').value = 'high';

    saveButton.dispatchEvent(new Event('click'));

    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      githubToken: 'ghp_newtoken',
      githubRepo: 'new/repo',
      githubBranch: 'prod',
      githubFolder: '',
      saveNotesAndTimer: false,
      aiEnabled: false,
      aiEndpoint: 'https://api.mycorp.ai/v1/chat/completions',
      aiApiKey: 'sk_savedkey',
      aiModel: 'my-model',
      nudgeAtMinutes: 10,
      deadlineAtMinutes: 60,
      minHelpMinutes: 0,
      concepts: [{ name: 'Graphs', level: 'high' }]
    }, expect.any(Function));

    expect(statusDiv.textContent).toBe('Settings saved successfully!');
    expect(statusDiv.className).toContain('success');
  });

  test('should not save values as numbers when input is invalid', () => {
    const saveButton = document.getElementById('save');

    document.getElementById('githubToken').value = 'ghp_token';
    document.getElementById('githubRepo').value = 'owner/repo';
    document.getElementById('nudgeAtMinutes').value = '999';
    document.getElementById('deadlineAtMinutes').value = 'abc';

    saveButton.dispatchEvent(new Event('click'));

    const setCall = chrome.storage.sync.set.mock.calls[0][0];
    expect(setCall.nudgeAtMinutes).toBe(180);
    expect(setCall.deadlineAtMinutes).toBe(45);
  });

  test('should request optional host permission when AI Helper is enabled', () => {
    const saveButton = document.getElementById('save');

    document.getElementById('githubToken').value = 'ghp_token';
    document.getElementById('githubRepo').value = 'owner/repo';
    document.getElementById('aiEnabled').checked = true;
    document.getElementById('aiEndpoint').value = 'https://api.mycorp.ai/v1/chat/completions';
    document.getElementById('aiApiKey').value = 'sk-live';

    saveButton.dispatchEvent(new Event('click'));

    expect(chrome.permissions.request).toHaveBeenCalledWith(
      { origins: ['https://api.mycorp.ai/*'] },
      expect.any(Function)
    );
    expect(chrome.storage.sync.set).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'settingsUpdated' }, expect.any(Function));
  });

  test('should not save when permission for the AI endpoint is denied', () => {
    chrome.permissions.request.mockImplementationOnce((perms, callback) => callback(false));
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');

    document.getElementById('githubToken').value = 'ghp_token';
    document.getElementById('githubRepo').value = 'owner/repo';
    document.getElementById('aiEnabled').checked = true;
    document.getElementById('aiEndpoint').value = 'https://api.mycorp.ai/v1/chat/completions';
    document.getElementById('aiApiKey').value = 'sk-live';

    saveButton.dispatchEvent(new Event('click'));

    expect(chrome.permissions.request).toHaveBeenCalled();
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(statusDiv.textContent).toContain('needs permission');
  });

  test('should save notes toggle as true when checkbox is checked', () => {
    const tokenInput = document.getElementById('githubToken');
    const repoInput = document.getElementById('githubRepo');
    const notesToggle = document.getElementById('saveNotesAndTimer');
    const saveButton = document.getElementById('save');

    tokenInput.value = 'ghp_token';
    repoInput.value = 'owner/repo';
    notesToggle.checked = true;

    saveButton.dispatchEvent(new Event('click'));

    const setCall = chrome.storage.sync.set.mock.calls[0][0];
    expect(setCall.saveNotesAndTimer).toBe(true);
  });

  // ─────────────────────────────────────────────────────
  // Validation errors
  // ─────────────────────────────────────────────────────
  test('should validate input errors when token or repo is missing/invalid', () => {
    const tokenInput = document.getElementById('githubToken');
    const repoInput = document.getElementById('githubRepo');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');

    tokenInput.value = '';
    saveButton.dispatchEvent(new Event('click'));
    expect(statusDiv.textContent).toBe('Please enter your GitHub Personal Access Token.');

    tokenInput.value = 'ghp_token';
    repoInput.value = '';
    saveButton.dispatchEvent(new Event('click'));
    expect(statusDiv.textContent).toBe('Please enter your GitHub repository (owner/repo).');

    repoInput.value = 'invalidformat';
    saveButton.dispatchEvent(new Event('click'));
    expect(statusDiv.textContent).toBe('Repository must be in "owner/repo" format (e.g., username/leetcode-solutions).');
  });

  test('should validate AI Helper fields when enabled', () => {
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');

    document.getElementById('githubToken').value = 'ghp_token';
    document.getElementById('githubRepo').value = 'owner/repo';
    document.getElementById('aiEnabled').checked = true;
    document.getElementById('aiEndpoint').value = '';
    document.getElementById('aiApiKey').value = '';

    // endpoint empty -> falls back to the default endpoint, so only key blocks
    saveButton.dispatchEvent(new Event('click'));
    expect(statusDiv.textContent).toBe('Please enter your AI API key or disable the AI Helper.');

    document.getElementById('aiApiKey').value = 'sk-key';
    document.getElementById('deadlineAtMinutes').value = '10';
    document.getElementById('nudgeAtMinutes').value = '10';

    saveButton.dispatchEvent(new Event('click'));
    expect(statusDiv.textContent).toBe('Time limit must be greater than the AI check-in time.');
  });

  // ─────────────────────────────────────────────────────
  // Connection testing
  // ─────────────────────────────────────────────────────
  test('should handle connection testing successfully', () => {
    const testButton = document.getElementById('test');
    const statusDiv = document.getElementById('status');

    testButton.dispatchEvent(new Event('click'));

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'testConnection',
      token: 'ghp_savedtoken',
      repo: 'saved/repo'
    }, expect.any(Function));

    expect(statusDiv.textContent).toContain('Success! Connected to public repository: "saved/repo"');
    expect(statusDiv.className).toContain('success');
  });

  test('should handle connection testing failure', () => {
    chrome.runtime.sendMessage.mockImplementationOnce((message, callback) => {
      if (message && message.action === 'testConnection') {
        callback({ success: false, error: 'Repository not found' });
      }
    });

    const testButton = document.getElementById('test');
    const statusDiv = document.getElementById('status');

    testButton.dispatchEvent(new Event('click'));

    expect(statusDiv.textContent).toContain('Connection failed: Repository not found');
    expect(statusDiv.className).toContain('error');
  });
});
