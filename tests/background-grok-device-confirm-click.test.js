const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadApi() {
  const source = fs.readFileSync('flows/grok/background/device-confirm-click.js', 'utf8');
  const globalScope = {};
  new Function('self', `${source}; return self;`)(globalScope);
  return globalScope.MultiPageBackgroundGrokDeviceConfirmClick;
}

test('performTrustedDeviceClick uses debugger with normalized allow coordinates', async () => {
  const api = loadApi();
  const calls = [];
  const tick = {
    ok: true,
    pageState: 'consent',
    trustedClickRequired: true,
    clickTarget: 'allow',
    clickLabel: '  Allow everything  ',
    clickRect: {
      left: 100,
      top: 200,
      width: 80,
      height: 32,
      centerX: 140.5,
      centerY: 216.25,
    },
  };

  const result = await api.performTrustedDeviceClick({
    tabId: 42,
    tick,
    clickWithDebugger: async (...args) => {
      calls.push(args);
    },
  });

  assert.deepEqual(calls, [[
    42,
    { centerX: 140.5, centerY: 216.25 },
    { visibleStep: 6 },
  ]]);
  assert.notStrictEqual(result, tick);
  assert.deepEqual(result, {
    ...tick,
    clickLabel: 'Allow everything',
    clicked: 'allow',
    trustedClickPerformed: true,
    navigatingLikely: true,
  });
});

test('performTrustedDeviceClick rejects NaN coordinates before debugger call', async () => {
  const api = loadApi();
  let calls = 0;

  await assert.rejects(
    api.performTrustedDeviceClick({
      tabId: 42,
      tick: {
        trustedClickRequired: true,
        clickTarget: 'allow',
        clickRect: { centerX: Number.NaN, centerY: 20 },
      },
      clickWithDebugger: async () => {
        calls += 1;
      },
    }),
    /坐标|coordinate/i
  );
  assert.equal(calls, 0);
});

test('performTrustedDeviceClick rejects non-allow trusted click target', async () => {
  const api = loadApi();
  let calls = 0;

  await assert.rejects(
    api.performTrustedDeviceClick({
      tabId: 42,
      tick: {
        trustedClickRequired: true,
        clickTarget: 'deny',
        clickRect: { centerX: 10, centerY: 20 },
      },
      clickWithDebugger: async () => {
        calls += 1;
      },
    }),
    /allow/i
  );
  assert.equal(calls, 0);
});

test('performTrustedDeviceClick marks and propagates retryable-looking debugger failure', async () => {
  const api = loadApi();
  const debuggerError = new Error('failed to fetch while debugger attached');
  let result;
  let caught;

  try {
    result = await api.performTrustedDeviceClick({
      tabId: 42,
      tick: {
        trustedClickRequired: true,
        clickTarget: 'allow',
        clickLabel: 'Allow',
        clickRect: { centerX: 10, centerY: 20 },
      },
      clickWithDebugger: async () => {
        throw debuggerError;
      },
    });
  } catch (error) {
    caught = error;
  }

  assert.strictEqual(caught, debuggerError);
  assert.equal(api.isTrustedDeviceClickError(caught), true);
  assert.equal(result, undefined);
});

test('performTrustedDeviceClick returns an ordinary tick unchanged', async () => {
  const api = loadApi();
  const tick = { ok: true, pageState: 'email', waiting: true };
  let calls = 0;

  const result = await api.performTrustedDeviceClick({
    tabId: null,
    tick,
    clickWithDebugger: null,
  });

  assert.strictEqual(result, tick);
  assert.equal(calls, 0);
});

test('background wires trusted device consent through debugger before navigation handling', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  const helperImport = source.indexOf("'flows/grok/background/device-confirm-click.js'");
  const minterImport = source.indexOf("'flows/grok/background/oidc-minter.js'");
  assert.ok(helperImport >= 0, 'device confirm click helper import missing');
  assert.ok(helperImport < minterImport, 'device confirm click helper must load before oidc-minter');

  const runnerStart = source.indexOf('runDeviceConfirmInTab: async');
  const runnerEnd = source.indexOf('const grokCpaPublisher', runnerStart);
  const runner = source.slice(runnerStart, runnerEnd);
  assert.match(runner, /let\s+tick\s*=\s*await\s+sendToContentScriptResilient/);
  assert.match(runner, /if\s*\(tick\.trustedClickRequired\)/);
  assert.match(runner, /performTrustedDeviceClick\s*\(\s*\{[\s\S]*?tabId[\s\S]*?tick[\s\S]*?clickWithDebugger[\s\S]*?\}\s*\)/);
  assert.match(runner, /Debugger 可信点击「\$\{tick\.clickLabel\}」/);
  assert.match(runner, /tick\.clicked\s*&&\s*!tick\.trustedClickPerformed/);
  assert.match(runner, /tick\.navigating\s*\|\|\s*tick\.navigatingLikely/);
  assert.match(
    runner,
    /const\s+trustedClickError\s*=\s*self\.MultiPageBackgroundGrokDeviceConfirmClick\?\.isTrustedDeviceClickError\?\.\(error\)\s*===\s*true/
  );
  assert.match(runner, /const\s+retryable\s*=\s*!trustedClickError\s*&&/);
});
