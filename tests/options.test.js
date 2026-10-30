/**
 * Unit tests for options.js, including the GitHub Sign-In (OAuth Device Flow) UI
 */

// Define chrome mock at top level so options.js can access it during require
const runtimeMessageListeners = [];
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
          githubClientId: 'Iv1_clientid',
          githubAuthMethod: 'pat'
        });
      }),
      set: jest.fn((items, callback) => {
        if (callback) callback();
      }),
      remove: jest.fn((keys, callback) => {
        if (callback) callback();
      })
    }
  },
  runtime: {
    onMessage: {
      addListener: jest.fn((listener) => {
        runtimeMessageListeners.push(listener);
      })
    },
    sendMessage: jest.fn((message, callback) => {
      let response;
      if (message && message.action === 'testConnection') {
        response = { success: true, result: { fullName: 'saved/repo', private: false } };
      } else if (message && message.action === 'githubDeviceFlowStart') {
        response = {
          success: true,
          result: {
            userCode: 'WDJB-MJHT',
            verificationUri: 'https://github.com/login/device',
            expiresIn: 900,
            interval: 5
          }
        };
      } else if (message && message.action === 'githubSignOut') {
        response = { success: true, result: { signedOut: true } };
      } else if (message && message.action === 'githubGetUser') {
        response = { success: true, result: { login: 'octocat', name: 'The Octocat', scopes: 'repo' } };
      } else {
        response = { success: true };
      }
      if (callback) callback(response);
    })
  },
  permissions: {}
};

// Require the options script once
require('../options.js');

function lastOptionsListener() {
  return runtimeMessageListeners[runtimeMessageListeners.length - 1];
}

describe('Options Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Set up DOM incl. saveNotesAndTimer and the Sign-In UI elements
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
      <input type="text" id="githubClientId">
      <button id="githubSignIn">Sign in with GitHub</button>
      <button id="githubSignOut" style="display:none;">Sign Out</button>
      <p id="githubAuthStatus"></p>
      <div id="deviceFlowBox" style="display:none;">
        <code id="deviceUserCode"></code>
        <button id="copyUserCode">Copy</button>
        <button id="openGithubDevice">Open GitHub</button>
        <button id="deviceFlowCancel">Cancel</button>
        <div id="deviceFlowStatusText"></div>
      </div>
    `;

    // Trigger DOMContentLoaded to bind event listeners to the new DOM elements
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  // ─────────────────────────────────────────────────────
  // Settings loading
  // ─────────────────────────────────────────────────────
  test('should load saved settings including sign-in fields on DOMContentLoaded', () => {
    expect(chrome.storage.sync.get).toHaveBeenCalledWith([
      'githubToken',
      'githubRepo',
      'githubBranch',
      'githubFolder',
      'saveNotesAndTimer',
      'githubClientId',
      'githubAuthMethod'
    ], expect.any(Function));

    expect(document.getElementById('githubToken').value).toBe('ghp_savedtoken');
    expect(document.getElementById('githubRepo').value).toBe('saved/repo');
    expect(document.getElementById('githubBranch').value).toBe('saved-branch');
    expect(document.getElementById('githubFolder').value).toBe('leetcode');
    expect(document.getElementById('saveNotesAndTimer').checked).toBe(true);
    expect(document.getElementById('githubClientId').value).toBe('Iv1_clientid');

    // PAT session: badge text, no Sign Out button
    expect(document.getElementById('githubSignOut').style.display).toBe('none');
    expect(document.getElementById('githubAuthStatus').textContent).toContain('manually pasted token');
  });

  test('should show the Sign Out button and signed-in badge for an OAuth session', () => {
    chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
      callback({
        githubToken: 'gho_octoflowtoken',
        githubRepo: 'o/r',
        githubBranch: 'main',
        githubFolder: '',
        saveNotesAndTimer: true,
        githubClientId: 'Iv1_c',
        githubAuthMethod: 'oauth'
      });
    });
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(document.getElementById('githubSignOut').style.display).not.toBe('none');
    expect(document.getElementById('githubAuthStatus').textContent).toContain('Signed in');
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
  // GitHub Sign-In (Device Flow UI)
  // ─────────────────────────────────────────────────────
  test('should require a Client ID before starting the device flow', () => {
    document.getElementById('githubClientId').value = '';
    document.getElementById('githubSignIn').dispatchEvent(new Event('click'));

    const statusDiv = document.getElementById('status');
    expect(statusDiv.textContent).toContain('Client ID');
    expect(statusDiv.className).toContain('error');
    // "start" must not have been requested
    const startCalls = chrome.runtime.sendMessage.mock.calls.filter(
      (c) => c[0] && c[0].action === 'githubDeviceFlowStart'
    );
    expect(startCalls.length).toBe(0);
  });

  test('should start the device flow and show the one-time code', () => {
    document.getElementById('githubClientId').value = 'Iv1_testclient';
    document.getElementById('githubSignIn').dispatchEvent(new Event('click'));

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'githubDeviceFlowStart', clientId: 'Iv1_testclient' },
      expect.any(Function)
    );

    const box = document.getElementById('deviceFlowBox');
    expect(box.style.display).toBe('block');
    expect(document.getElementById('deviceUserCode').textContent).toBe('WDJB-MJHT');
    expect(document.getElementById('deviceFlowStatusText').textContent).toContain('Waiting for authorization');
    expect(document.getElementById('deviceFlowStatusText').textContent).toContain('15 minutes');
  });

  test('should surface a device flow start failure', () => {
    chrome.runtime.sendMessage.mockImplementationOnce((message, callback) => {
      if (message && message.action === 'githubDeviceFlowStart') {
        callback({ success: false, error: 'Device Flow is not enabled for this OAuth App.' });
      }
    });

    document.getElementById('githubClientId').value = 'Iv1_bad';
    document.getElementById('githubSignIn').dispatchEvent(new Event('click'));

    const statusDiv = document.getElementById('status');
    expect(statusDiv.textContent).toContain('Device Flow is not enabled');
    expect(statusDiv.className).toContain('error');
    expect(document.getElementById('deviceFlowBox').style.display).toBe('none');
  });

  test.each([
    ['pending', 'Waiting for authorization'],
    ['success', 'Signed in'],
    ['denied', 'Access denied'],
    ['expired', 'expired'],
    ['error', 'Custom failure message'],
    ['canceled', 'Sign-in canceled']
  ])('should react to deviceFlowStatus broadcast "%s"', (status, expectedText) => {
    const statusDiv = document.getElementById('status');
    const box = document.getElementById('deviceFlowBox');

    // make the flow "in flight" so we can assert visibility toggles
    box.style.display = 'block';

    const extra = {};
    if (status === 'error') {
      extra.message = 'Custom failure message';
    }
    if (status === 'pending' || status === 'success') {
      extra.userCode = 'WDJB-MJHT';
    }
    // A successful flow re-reads the token pair newly written by the background worker
    if (status === 'success') {
      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({ githubToken: 'gho_flowtoken', githubAuthMethod: 'oauth' });
      });
    }

    lastOptionsListener()({ action: 'deviceFlowStatus', status, ...extra });

    if (status === 'pending') {
      expect(box.style.display).toBe('block');
      expect(document.getElementById('deviceFlowStatusText').textContent).toContain(expectedText);
    } else if (status === 'success') {
      expect(box.style.display).toBe('none');
      expect(document.getElementById('githubSignOut').style.display).not.toBe('none');
    } else {
      expect(box.style.display).toBe('none');
      expect(statusDiv.textContent).toContain(expectedText);
    }
  });

  test('pending broadcast should reveal the box with the code when the page missed the start', () => {
    lastOptionsListener()({ action: 'deviceFlowStatus', status: 'pending', userCode: 'ABCD-1234' });

    const box = document.getElementById('deviceFlowBox');
    expect(box.style.display).toBe('block');
    expect(document.getElementById('deviceUserCode').textContent).toBe('ABCD-1234');
  });

  test('success broadcast should adopt the stored OAuth token into the UI', () => {
    chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
      callback({ githubToken: 'gho_flowtoken', githubAuthMethod: 'oauth' });
    });

    lastOptionsListener()({ action: 'deviceFlowStatus', status: 'success', userCode: 'WDJB-MJHT' });

    expect(document.getElementById('githubToken').value).toBe('gho_flowtoken');
    expect(document.getElementById('githubSignOut').style.display).not.toBe('none');
    expect(document.getElementById('status').textContent).toContain('sign-in successful');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'githubGetUser' }, expect.any(Function));
  });

  test('should sign out and clear the OAuth token from the UI', () => {
    // Arrange a signed-in session first
    chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
      callback({ githubToken: 'gho_flowtoken', githubAuthMethod: 'oauth' });
    });
    lastOptionsListener()({ action: 'deviceFlowStatus', status: 'success' });
    expect(document.getElementById('githubSignOut').style.display).not.toBe('none');

    document.getElementById('githubSignOut').dispatchEvent(new Event('click'));

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'githubSignOut' }, expect.any(Function));
    expect(document.getElementById('githubToken').value).toBe('');
    expect(document.getElementById('githubSignOut').style.display).toBe('none');
    expect(document.getElementById('status').textContent).toContain('Signed out of GitHub.');
    expect(document.getElementById('githubAuthStatus').textContent).not.toContain('Signed in as');
  });

  test('should send a cancel request and close the code box', () => {
    const box = document.getElementById('deviceFlowBox');
    box.style.display = 'block';

    document.getElementById('deviceFlowCancel').dispatchEvent(new Event('click'));

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'githubDeviceFlowCancel' }, expect.any(Function));
    expect(box.style.display).toBe('none');
    expect(document.getElementById('status').textContent).toBe('Sign-in canceled.');
  });

  test('copy button should fall back to manual selection when the clipboard is unavailable', () => {
    document.getElementById('deviceUserCode').textContent = 'WDJB-MJHT';
    document.getElementById('deviceFlowBox').style.display = 'block';

    expect(() => {
      document.getElementById('copyUserCode').dispatchEvent(new Event('click'));
    }).not.toThrow();
  });

  // ─────────────────────────────────────────────────────
  // Saving settings
  // ─────────────────────────────────────────────────────
  test('should save all settings and label a PAT token correctly', () => {
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
    document.getElementById('githubClientId').value = 'Iv1_newclient';

    saveButton.dispatchEvent(new Event('click'));

    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      githubToken: 'ghp_newtoken',
      githubRepo: 'new/repo',
      githubBranch: 'prod',
      githubFolder: '',
      saveNotesAndTimer: false,
      githubClientId: 'Iv1_newclient',
      githubAuthMethod: 'pat'
    }, expect.any(Function));

    expect(statusDiv.textContent).toBe('Settings saved successfully!');
    expect(statusDiv.className).toContain('success');
  });

  test('should label an OAuth (sign-in) token correctly when saving', () => {
    document.getElementById('githubToken').value = 'gho_signintoken';
    document.getElementById('githubRepo').value = 'owner/repo';
    document.getElementById('githubBranch').value = '';

    document.getElementById('save').dispatchEvent(new Event('click'));

    const setCall = chrome.storage.sync.set.mock.calls[0][0];
    expect(setCall.githubAuthMethod).toBe('oauth');
    expect(setCall.githubBranch).toBe('main');
  });

  test('should allow saving without a token (e.g. only the Client ID is known yet)', () => {
    document.getElementById('githubToken').value = '';
    document.getElementById('githubRepo').value = 'owner/repo';
    document.getElementById('githubClientId').value = 'Iv1_clientonly';

    document.getElementById('save').dispatchEvent(new Event('click'));

    const setCall = chrome.storage.sync.set.mock.calls[0][0];
    expect(setCall.githubToken).toBe('');
    expect(setCall.githubAuthMethod).toBe('');
    expect(setCall.githubClientId).toBe('Iv1_clientonly');
    expect(document.getElementById('status').className).toContain('success');
  });

  test('should default branch to main and show token badge refresh after save', () => {
    document.getElementById('githubToken').value = 'gho_k';
    document.getElementById('githubRepo').value = 'o/r';
    document.getElementById('githubBranch').value = '';

    document.getElementById('save').dispatchEvent(new Event('click'));

    expect(document.getElementById('githubAuthStatus').textContent).toContain('Signed in');
  });

  // ─────────────────────────────────────────────────────
  // Validation errors
  // ─────────────────────────────────────────────────────
  test('should validate input errors for missing repo or invalid format', () => {
    const tokenInput = document.getElementById('githubToken');
    const repoInput = document.getElementById('githubRepo');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');

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
  test('should tell the user to sign in when testing without a token', () => {
    document.getElementById('githubToken').value = '';
    document.getElementById('test').dispatchEvent(new Event('click'));

    const statusDiv = document.getElementById('status');
    expect(statusDiv.textContent).toContain('sign in with GitHub');
    expect(statusDiv.className).toContain('error');
  });

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
