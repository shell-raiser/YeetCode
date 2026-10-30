/**
 * Unit tests for the AI Helper feature (issue #4)
 * Covers background.js aiChat/aiDirection handlers and the content script timer/nudge/chat UI
 *
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://leetcode.com/problems/two-sum/"}
 */

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
          saveNotesAndTimer: true,
          aiEnabled: true,
          aiEndpoint: 'https://ai.example.com/v1/chat/completions',
          aiApiKey: 'sk-test',
          aiModel: 'test-model',
          nudgeAtMinutes: 15,
          deadlineAtMinutes: 45,
          minHelpMinutes: 5,
          concepts: [
            { name: 'Graphs', level: 'high' },
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
    onInstalled: { addListener: jest.fn() }
  }
};

global.fetch = jest.fn();

function flushAsync(times = 12) {
  let p = Promise.resolve();
  for (let i = 0; i < times; i++) {
    p = p.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  return p;
}

function setProblemLocation(slug) {
  window.history.pushState({}, '', `/problems/${slug}/`);
}

require('../background.js');
require('../contentScript.js');

const helper = window.LeetCodeCodeSaver.aiHelper;

describe('AI Helper (background)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetch.mockClear();
  });

  describe('aiChat handler', () => {
    test('should call the configured endpoint with system prompt, context and history', (done) => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'What does your current loop invariant assume?' } }]
        })
      });

      chrome.runtime.sendMessage({
        action: 'aiChat',
        mode: 'nudge',
        problemTitle: 'two sum',
        problemUrl: 'https://leetcode.com/problems/two-sum/',
        problemStatement: 'Given an array of integers, return indices of the two numbers that add to a target.',
        code: 'for (int i = 0; i < n; i++) { }',
        languageId: 'cpp',
        userMessage: 'I think brute force is too slow, what should I think about?',
        history: [
          { role: 'user', content: 'What does your current loop invariant assume?', junk: 'drop' },
          { role: '', content: 'invalid entry gets dropped' }
        ]
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(response.result.reply).toContain('invariant');

          expect(fetch).toHaveBeenCalledTimes(1);
          expect(fetch.mock.calls[0][0]).toBe('https://ai.example.com/v1/chat/completions');

          const config = fetch.mock.calls[0][1];
          expect(config.headers.Authorization).toBe('Bearer sk-test');

          const body = JSON.parse(config.body);
          expect(body.model).toBe('test-model');

          const system = body.messages[0].content;
          expect(system).toContain('TEACH, never to solve');
          expect(system).toContain('NEVER provide a complete solution');
          expect(system).toContain('- Graphs: high');
          expect(system).toContain('- Dynamic Programming: not studied');
          expect(system).toContain('Mode: nudge');

          const context = body.messages.find((m) => m.role === 'user' && m.content.includes('<problem_statement>'));
          expect(context.content).toContain('return indices of the two numbers');
          expect(context.content).toContain('for (int i = 0; i < n; i++)');

          const historyUser = body.messages.find((m) => m.role === 'user' && m.content === 'What does your current loop invariant assume?');
          expect(historyUser).toBeTruthy();
          expect(body.messages.some((m) => m.content === 'invalid entry gets dropped')).toBe(false);

          const lastUser = body.messages[body.messages.length - 1];
          expect(lastUser.role).toBe('user');
          expect(lastUser.content).toContain('brute force');
          done();
        } catch (e) { done(e); }
      });
    });

    test('should fail when AI Helper is disabled', (done) => {
      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({ aiEnabled: false, aiApiKey: 'sk-test' });
      });

      chrome.runtime.sendMessage({ action: 'aiChat', mode: 'ask' }, (response) => {
        try {
          expect(response.success).toBe(false);
          expect(response.error).toContain('AI Helper is disabled');
          expect(fetch).not.toHaveBeenCalled();
          done();
        } catch (e) { done(e); }
      });
    });

    test('should fail when API key is missing', (done) => {
      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({ aiEnabled: true });
      });

      chrome.runtime.sendMessage({ action: 'aiChat', mode: 'ask' }, (response) => {
        try {
          expect(response.success).toBe(false);
          expect(response.error).toContain('AI API key is not configured');
          done();
        } catch (e) { done(e); }
      });
    });

    test('should surface 401 error messages clearly', (done) => {
      chrome.storage.sync.get.mockImplementationOnce((keys, callback) => {
        callback({ aiEnabled: true, aiApiKey: 'sk-bad' });
      });
      fetch.mockResolvedValueOnce({
        ok: false, status: 401,
        json: () => Promise.resolve({ error: { message: 'Incorrect API key provided' } })
      });

      chrome.runtime.sendMessage({ action: 'aiChat', mode: 'ask' }, (response) => {
        try {
          expect(response.success).toBe(false);
          expect(response.error).toContain('Unauthorized');
          expect(response.error).toContain('Incorrect API key provided');
          done();
        } catch (e) { done(e); }
      });
    });
  });

  describe('aiDirection handler (silent check_direction mode)', () => {
    function mockAiResponse(content) {
      fetch.mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content } }] })
      });
    }

    test('should parse a JSON on_track response', (done) => {
      mockAiResponse('{"on_track": false, "note": "Nested loops will hit n^2; think about the constraints."}');

      chrome.runtime.sendMessage({
        action: 'aiDirection',
        problemTitle: 'two sum',
        problemStatement: 'Given an array of integers, return indices of the two numbers that add to a target.',
        code: 'for (int i = 0; i < n; i++) for (int j = 0; j < n; j++) {}',
        languageId: 'cpp'
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(response.result.onTrack).toBe(false);
          expect(response.result.note).toContain('constraints');

          const body = JSON.parse(JSON.stringify(fetch.mock.calls[0][1].body));
          const parsed = JSON.parse(body);
          expect(parsed.messages[0].content).toContain('Reply ONLY with minified JSON');
          expect(parsed.messages[0].content).toContain('check_direction');
          done();
        } catch (e) { done(e); }
      });
    });

    test('should parse a fenced JSON response and trim fences', (done) => {
      mockAiResponse('```json\n{"on_track": true, "note": "Hash map plan is sound."}\n```');

      chrome.runtime.sendMessage({
        action: 'aiDirection',
        problemStatement: 'Given an array of integers, return indices of the two numbers that add to a target.',
        code: 'map = {}'
      }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(response.result.onTrack).toBe(true);
          expect(response.result.note).toContain('Hash map plan is sound');
          done();
        } catch (e) { done(e); }
      });
    });

    test('should return onTrack null when the response is unparseable', (done) => {
      mockAiResponse('The user is clearly going in circles.');

      chrome.runtime.sendMessage({ action: 'aiDirection', code: 'x = 1' }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(response.result.onTrack).toBeNull();
          done();
        } catch (e) { done(e); }
      });
    });

    test('should parse alternate onTrack key spelling', (done) => {
      mockAiResponse('{"onTrack": false, "note": "Off track."}');

      chrome.runtime.sendMessage({ action: 'aiDirection', code: 'x = 1' }, (response) => {
        try {
          expect(response.success).toBe(true);
          expect(response.result.onTrack).toBe(false);
          done();
        } catch (e) { done(e); }
      });
    });
  });
});

describe('AI Helper (content script)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    helper.stopAiHelperTimers();
    window.monaco = undefined;

    document.body.innerHTML = `
      <div id="editor-container"></div>
      <div class="flex">
        <div class="group flex items-center">
          <div data-state="closed">
            <button data-testid="judge-button">Submit</button>
          </div>
        </div>
      </div>
      <textarea>int main() { return 0; }</textarea>
    `;
  });

  afterEach(() => {
    helper.stopAiHelperTimers();
    document.getElementById('yc-ai-panel')?.remove();
    document.getElementById('yc-ai-button')?.remove();
  });

  function resetSessionAt(elapsedMinutes) {
    setProblemLocation('two-sum');
    helper.state.currentSlug = null;
    helper.updateAiSessionForUrl();
    helper.state.sessionStartMs = Date.now() - elapsedMinutes * 60000;
    return helper.state.sessionStartMs;
  }

  test('should initialise a per-problem session with a start time', () => {
    setProblemLocation('two-sum');
    helper.updateAiSessionForUrl();

    expect(helper.state.currentSlug).toBe('two-sum');
    expect(typeof helper.state.sessionStartMs).toBe('number');
    expect(sessionStorage.getItem(`yc-ai-start:two-sum`)).toBe(String(helper.state.sessionStartMs));
  });

  test('should keep the session timer across a page reload', () => {
    const start = resetSessionAt(2);

    const fresh = helper.updateAiSessionForUrl();
    expect(fresh).toBeUndefined();
    expect(helper.state.sessionStartMs).toBe(start);
  });

  test('should skip checkpoint logic when AI Helper is disabled', async () => {
    helper.state.settings.aiEnabled = false;
    resetSessionAt(30);

    const result = helper.aiHelperTick(Date.now());
    expect(result).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();

    helper.state.settings.aiEnabled = true;
  });

  test('should show an on-track toast and never a nudge when direction is fine', async () => {
    resetSessionAt(16);
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: '{"on_track": true, "note": "Hash map plan is sound."}' } }] })
    });

    const tickPromise = helper.aiHelperTick(Date.now());

    document.dispatchEvent(new CustomEvent('LeetCodeCodeSaver_CodeExtracted', {
      detail: { code: 'map = {}', languageId: 'python' }
    }));

    await tickPromise;
    await flushAsync();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(document.getElementById('yc-ai-nudge-offer')).toBeNull();
  });

  test('should offer a nudge with accept/decline when off track', async () => {
    resetSessionAt(16);
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"on_track": false, "note": "Nested loops will be n^2."}' } }]
      })
    });

    const tickPromise = helper.aiHelperTick(Date.now());

    document.dispatchEvent(new CustomEvent('LeetCodeCodeSaver_CodeExtracted', {
      detail: { code: 'for i in range(len(nums)): # ...', languageId: 'python' }
    }));

    await tickPromise;
    await flushAsync();

    const offer = document.getElementById('yc-ai-nudge-offer');
    expect(offer).not.toBeNull();
    expect(offer.textContent).toContain('n^2');
    expect(offer.textContent).toContain('nudge');
    expect(offer.textContent).toContain('No thanks');
  });

  test('should only run the check-in once per problem', async () => {
    resetSessionAt(16);
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: '{"on_track": false, "note": "Stuck."}' } }] })
    });

    const tickPromise = helper.aiHelperTick(Date.now());
    document.dispatchEvent(new CustomEvent('LeetCodeCodeSaver_CodeExtracted', {
      detail: { code: 'x', languageId: 'python' }
    }));
    await tickPromise;
    await flushAsync();

    // More ticks at the same session: no additional AI calls
    helper.aiHelperTick(Date.now());
    helper.aiHelperTick(Date.now());
    await flushAsync();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('should show the time-limit notice at the deadline', async () => {
    resetSessionAt(46);
    helper.state.deadlineNotified = false;
    // Also queue whatever the background direction check needs so the in-flight
    // checkpoint settles inside this test
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: '{"on_track": false, "note": "Stuck."}' } }] })
    });
    helper.aiHelperTick(Date.now());

    document.dispatchEvent(new CustomEvent('LeetCodeCodeSaver_CodeExtracted', {
      detail: { code: 'x', languageId: 'python' }
    }));
    await flushAsync();

    const notice = document.getElementById('yc-ai-nudge-offer');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain('time limit');
    expect(notice.textContent).toContain('45');
    // The direction-check offer must be suppressed once the deadline fired
    expect(notice.textContent).toContain('Guide me');
  });

  test('should block asking for help before minHelpMinutes with a countdown toast', () => {
    resetSessionAt(1);
    helper.state.settings.minHelpMinutes = 5;

    helper.ensureAiButton();

    const aiButton = document.getElementById('yc-ai-button');
    expect(aiButton).not.toBeNull();
    expect(aiButton.style.opacity).toBe('0.65');

    aiButton.click();

    const panel = document.getElementById('yc-ai-panel');
    expect(panel).toBeNull();

    const toast = document.getElementById('leetcode-saver-status');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain('locked for the first 5 minutes');

    helper.state.settings.minHelpMinutes = 5;
  });

  test('should open the panel when asking for help after minHelpMinutes', () => {
    resetSessionAt(6);
    helper.state.settings.minHelpMinutes = 5;

    helper.ensureAiButton();
    const aiButton = document.getElementById('yc-ai-button');
    expect(aiButton.style.opacity).toBe('1');

    aiButton.click();

    const panel = document.getElementById('yc-ai-panel');
    expect(panel).not.toBeNull();
    expect(panel.style.display).toBe('flex');
  });

  test('nudge offer should be removable', async () => {
    resetSessionAt(16);
    fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"on_track": false, "note": "Stuck."}' } }]
      })
    });

    const tickPromise = helper.aiHelperTick(Date.now());
    document.dispatchEvent(new CustomEvent('LeetCodeCodeSaver_CodeExtracted', {
      detail: { code: 'x', languageId: 'python' }
    }));
    await tickPromise;
    await flushAsync();

    expect(document.getElementById('yc-ai-nudge-offer')).not.toBeNull();
    helper.removeAiNudgeOffer();
    expect(document.getElementById('yc-ai-nudge-offer')).toBeNull();
  });

  test('should render chat messages inside the panel', async () => {
    resetSessionAt(6);
    helper.state.settings.minHelpMinutes = 0;

    helper.ensureAiPanel();
    helper.appendAiMessage('user', 'I am stuck at the loop bounds.');
    helper.appendAiMessage('assistant', 'What do you expect the bounds to be if the array is empty?');

    const messages = document.getElementById('yc-ai-messages');
    expect(messages.childElementCount).toBe(2);
    expect(messages.children[0].textContent).toContain('loop bounds');
    expect(messages.children[1].textContent).toContain('if the array is empty');
  });

  test('getProblemStatement should scrape the description block', async () => {
    setProblemLocation('two-sum');
    document.body.innerHTML = `
      <div data-track-load="description_content">
        Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.
      </div>
    `;

    const statement = await helper.getProblemStatement();
    expect(statement).toContain('return indices of the two numbers');
  });
});
