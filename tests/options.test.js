/**
 * Unit tests for options.js
 */

// Define chrome mock at top level so options.js can access it during require
global.chrome = {
  storage: {
    sync: {
      get: jest.fn((keys, callback) => {
        callback({
          githubToken: 'ghp_savedtoken',
          githubRepo: 'saved/repo',
          githubBranch: 'saved-branch',
          githubFolder: 'leetcode',
          saveNotesAndTimer: true
        });
      }),
      set: jest.fn((items, callback) => {
        if (callback) callback();
      })
    }
  },
  runtime: {
    sendMessage: jest.fn((message, callback) => {
      if (callback) {
        callback({ success: true, result: { fullName: 'saved/repo', private: false } });
      }
    })
  }
};

// Require the options script once
require('../options.js');

describe('Options Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set up DOM including the saveNotesAndTimer checkbox
    document.body.innerHTML = `
      <input type="password" id="githubToken">
      <span id="toggleToken">SHOW</span>
      <input type="text" id="githubRepo">
      <input type="text" id="githubBranch" value="main">
      <input type="text" id="githubFolder">
      <input type="checkbox" id="saveNotesAndTimer" checked>
      <button id="test">Test Connection</button>
      <button id="save">Save Settings</button>
      <div id="status"></div>
    `;

    // Trigger DOMContentLoaded to bind event listeners to the new DOM elements
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  // ─────────────────────────────────────────────────────
  // Settings loading
  // ─────────────────────────────────────────────────────
  test('should load saved settings including saveNotesAndTimer on DOMContentLoaded', () => {
    expect(chrome.storage.sync.get).toHaveBeenCalledWith([
      'githubToken',
      'githubRepo',
      'githubBranch',
      'githubFolder',
      'saveNotesAndTimer'
    ], expect.any(Function));

    expect(document.getElementById('githubToken').value).toBe('ghp_savedtoken');
    expect(document.getElementById('githubRepo').value).toBe('saved/repo');
    expect(document.getElementById('githubBranch').value).toBe('saved-branch');
    expect(document.getElementById('githubFolder').value).toBe('leetcode');
    expect(document.getElementById('saveNotesAndTimer').checked).toBe(true);
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
    const toggleSpan = document.getElementById('toggleToken');

    expect(tokenInput.type).toBe('password');
    toggleSpan.dispatchEvent(new Event('click'));
    expect(tokenInput.type).toBe('text');
    expect(toggleSpan.textContent).toBe('HIDE');

    toggleSpan.dispatchEvent(new Event('click'));
    expect(tokenInput.type).toBe('password');
    expect(toggleSpan.textContent).toBe('SHOW');
  });

  // ─────────────────────────────────────────────────────
  // Saving settings
  // ─────────────────────────────────────────────────────
  test('should save settings including saveNotesAndTimer checkbox state', () => {
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

    saveButton.dispatchEvent(new Event('click'));

    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      githubToken: 'ghp_newtoken',
      githubRepo: 'new/repo',
      githubBranch: 'prod',
      githubFolder: '',
      saveNotesAndTimer: false
    }, expect.any(Function));

    expect(statusDiv.textContent).toBe('Settings saved successfully!');
    expect(statusDiv.className).toContain('success');
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
      callback({ success: false, error: 'Repository not found' });
    });

    const testButton = document.getElementById('test');
    const statusDiv = document.getElementById('status');

    testButton.dispatchEvent(new Event('click'));

    expect(statusDiv.textContent).toContain('Connection failed: Repository not found');
    expect(statusDiv.className).toContain('error');
  });
});
