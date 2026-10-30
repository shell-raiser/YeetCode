/**
 * Tests for GitHub Sign-In (OAuth Device Flow) in background.js
 *
 * Uses very short device-flow intervals (interval: 0.05 => 50ms minimum sleep)
 * so the real-timer loops finish quickly.
 */

const messageListeners = [];
let storageData = {};

global.chrome = {
  storage: {
    onChanged: { addListener: jest.fn() },
    sync: {
      get: jest.fn((keys, callback) => {
        callback({ ...storageData });
      }),
      set: jest.fn((items, callback) => {
        Object.assign(storageData, items);
        if (callback) callback();
      }),
      remove: jest.fn((keys, callback) => {
        keys.forEach((key) => { delete storageData[key]; });
        if (callback) callback();
      })
    }
  },
  runtime: {
    onMessage: {
      addListener: (listener) => { messageListeners.push(listener); }
    },
    sendMessage: jest.fn((message, callback) => {
      if (callback) callback({ success: true });
    }),
    onInstalled: { addListener: jest.fn() }
  }
};

global.fetch = jest.fn();

jest.setTimeout(15000);

require('../background.js');

function resetStorage(next) {
  storageData = {};
  Object.keys(next || {}).forEach((key) => { storageData[key] = next[key]; });
}

function dispatchedMessages() {
  return chrome.runtime.sendMessage.mock.calls
    .map((call) => call[0])
    .filter(Boolean);
}

function statusBroadcasts() {
  return dispatchedMessages().filter((m) => m.action === 'deviceFlowStatus');
}

function dispatch(message) {
  return new Promise((resolve) => {
    messageListeners.forEach((listener) => {
      listener(message, {}, (response) => { resolve(response); });
    });
  });
}

async function waitFor(predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function mockGithubRoutes(options) {
  const { deviceCodeData, pollResponses, userOk = true, userStatus = 200 } = options;
  global.fetch.mockImplementation(async (url) => {
    if (url.includes('/login/device/code')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...deviceCodeData })
      };
    }
    if (url.includes('/login/oauth/access_token')) {
      const next = pollResponses.length ? pollResponses.shift() : { error: 'authorization_pending' };
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...next })
      };
    }
    if (url.includes('api.github.com/user')) {
      return {
        ok: userOk,
        status: userStatus,
        json: async () => ({ login: 'octocat', name: 'The Octocat' }),
        headers: { get: () => 'repo' }
      };
    }
    return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
  });
}

describe('GitHub Sign-In (device flow)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStorage({});
    global.fetch.mockReset();
  });

  test('start requires a Client ID', async () => {
    const response = await dispatch({ action: 'githubDeviceFlowStart' });

    expect(response.success).toBe(false);
    expect(response.error).toContain('Client ID');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('start requests a device code with scope=repo and returns the user code', async () => {
    mockGithubRoutes({
      deviceCodeData: {
        device_code: 'dev1',
        user_code: 'WDJB-MJHT',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 0.05
      },
      pollResponses: [{ error: 'authorization_pending' }]
    });

    const response = await dispatch({ action: 'githubDeviceFlowStart', clientId: 'Iv1_testclient' });

    expect(response.success).toBe(true);
    expect(response.result.userCode).toBe('WDJB-MJHT');
    expect(response.result.verificationUri).toBe('https://github.com/login/device');
    expect(response.result.expiresIn).toBe(900);

    const [startUrl, startConfig] = global.fetch.mock.calls[0];
    expect(startUrl).toContain('/login/device/code');
    expect(startConfig.method).toBe('POST');
    expect(startConfig.headers.Accept).toBe('application/json');
    expect(JSON.parse(startConfig.body)).toEqual({
      client_id: 'Iv1_testclient',
      scope: 'repo'
    });
  });

  test('polls until authorized, then stores the token as an OAuth sign-in', async () => {
    mockGithubRoutes({
      deviceCodeData: {
        device_code: 'dev1',
        user_code: 'WDJB-MJHT',
        expires_in: 15,
        interval: 0.05
      },
      pollResponses: [
        { error: 'authorization_pending' },
        { error: 'slow_down', interval: 0.05 },
        { access_token: 'gho_newtoken', token_type: 'bearer' }
      ]
    });

    const response = await dispatch({ action: 'githubDeviceFlowStart', clientId: 'Iv1_c' });
    expect(response.success).toBe(true);

    await waitFor(() => storageData.githubToken === 'gho_newtoken');

    expect(storageData.githubAuthMethod).toBe('oauth');
    expect(global.fetch.mock.calls.some((c) => c[0].includes('/login/oauth/access_token'))).toBe(true);

    const pollConfig = global.fetch.mock.calls.find((c) => c[0].includes('/login/oauth/access_token'))[1];
    expect(pollConfig.method).toBe('POST');
    expect(JSON.parse(pollConfig.body)).toEqual({
      client_id: 'Iv1_c',
      device_code: 'dev1',
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    });

    await waitFor(() => !!statusBroadcasts().find((m) => m.status === 'success'));
    expect(statusBroadcasts().some((m) => m.status === 'pending')).toBe(true);
  });

  test('denied authorization notifies the user and stores nothing', async () => {
    mockGithubRoutes({
      deviceCodeData: { device_code: 'dev1', user_code: 'X', expires_in: 15, interval: 0.05 },
      pollResponses: [{ error: 'access_denied' }]
    });

    await dispatch({ action: 'githubDeviceFlowStart', clientId: 'Iv1_c' });

    await waitFor(() => !!statusBroadcasts().find((m) => m.status === 'denied'));
    expect(storageData.githubToken).toBeUndefined();
    expect(statusBroadcasts().some((m) => m.status === 'success')).toBe(false);
  });

  test('expired token from the server notifies the user', async () => {
    mockGithubRoutes({
      deviceCodeData: { device_code: 'dev1', user_code: 'X', expires_in: 15, interval: 0.05 },
      pollResponses: [{ error: 'expired_token' }]
    });

    await dispatch({ action: 'githubDeviceFlowStart', clientId: 'Iv1_c' });

    await waitFor(() => !!statusBroadcasts().find((m) => m.status === 'expired'));
    expect(storageData.githubToken).toBeUndefined();
  });

  test('the device code expiring naturally notifies the user', async () => {
    mockGithubRoutes({
      deviceCodeData: { device_code: 'dev1', user_code: 'X', expires_in: 1, interval: 0.05 },
      pollResponses: Array.from({ length: 40 }, () => ({ error: 'authorization_pending' }))
    });

    await dispatch({ action: 'githubDeviceFlowStart', clientId: 'Iv1_c' });

    await waitFor(() => !!statusBroadcasts().find((m) => m.status === 'expired'), 4000);
    expect(storageData.githubToken).toBeUndefined();
  });

  test('cancel stops the flow and notifies every page', async () => {
    mockGithubRoutes({
      deviceCodeData: { device_code: 'dev1', user_code: 'X', expires_in: 30, interval: 0.05 },
      pollResponses: Array.from({ length: 50 }, () => ({ error: 'authorization_pending' }))
    });

    await dispatch({ action: 'githubDeviceFlowStart', clientId: 'Iv1_c' });
    const cancelResponse = await dispatch({ action: 'githubDeviceFlowCancel' });
    expect(cancelResponse.success).toBe(true);

    await waitFor(() => !!statusBroadcasts().find((m) => m.status === 'canceled'), 4000);
    expect(statusBroadcasts().some((m) => m.status === 'success')).toBe(false);
  });

  test('starting a new flow cancels the previous one', async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url.includes('/login/device/code')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            device_code: 'devX',
            user_code: 'CODE',
            expires_in: 30,
            interval: 0.05
          })
        };
      }
      if (url.includes('/login/oauth/access_token')) {
        return { ok: true, status: 200, json: async () => ({ error: 'authorization_pending' }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    await dispatch({ action: 'githubDeviceFlowStart', clientId: 'Iv1_c' });

    // Second start should cancel the first session
    await dispatch({ action: 'githubDeviceFlowStart', clientId: 'Iv1_c' });

    await waitFor(() => !!statusBroadcasts().find((m) => m.status === 'canceled'), 4000);
  });

  test('sign out removes only OAuth-fetched tokens', async () => {
    resetStorage({ githubToken: 'gho_authtoken', githubAuthMethod: 'oauth' });

    const response = await dispatch({ action: 'githubSignOut' });

    expect(response.success).toBe(true);
    expect(response.result.signedOut).toBe(true);
    expect(chrome.storage.sync.remove).toHaveBeenCalledWith(['githubToken', 'githubAuthMethod'], expect.any(Function));
    expect(chrome.storage.sync.remove).toHaveBeenCalledTimes(1);
    expect(storageData.githubToken).toBeUndefined();
    expect(storageData.githubAuthMethod).toBeUndefined();
    await waitFor(() => !!statusBroadcasts().find((m) => m.status === 'signed_out'));
  });

  test('sign out leaves a manually pasted PAT alone', async () => {
    resetStorage({ githubToken: 'ghp_patoken', githubAuthMethod: 'pat' });

    const response = await dispatch({ action: 'githubSignOut' });

    expect(response.success).toBe(true);
    expect(response.result.signedOut).toBe(false);
    expect(chrome.storage.sync.remove).not.toHaveBeenCalled();
    expect(storageData.githubToken).toBe('ghp_patoken');
  });

  test('githubGetUser returns the account for the stored token', async () => {
    resetStorage({ githubToken: 'gho_authtoken', githubAuthMethod: 'oauth' });
    mockGithubRoutes({ deviceCodeData: {}, pollResponses: [] });

    const response = await dispatch({ action: 'githubGetUser' });

    expect(response.success).toBe(true);
    expect(response.result.login).toBe('octocat');
    const [url, config] = global.fetch.mock.calls[0];
    expect(url).toContain('api.github.com/user');
    expect(config.headers.Authorization).toBe('token gho_authtoken');
    expect(config.headers.Accept).toBe('application/vnd.github.v3+json');
  });

  test('githubGetUser surfaces an invalid-token error', async () => {
    resetStorage({ githubToken: 'gho_revoked', githubAuthMethod: 'oauth' });
    global.fetch.mockImplementation(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Bad credentials' })
    }));

    const response = await dispatch({ action: 'githubGetUser' });

    expect(response.success).toBe(false);
    expect(response.error).toContain('revoked');
    expect(response.error).toContain('sign in again');
  });
});
