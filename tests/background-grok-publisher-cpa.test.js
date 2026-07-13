const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadApi() {
  const state = fs.readFileSync('flows/grok/background/state.js', 'utf8');
  const schema = fs.readFileSync('flows/grok/background/credential-schema.js', 'utf8');
  const source = fs.readFileSync('flows/grok/background/publisher-cpa.js', 'utf8');
  const globalScope = {};
  new Function('self', `${state}; ${schema}; ${source}; return self;`)(globalScope);
  return globalScope.MultiPageBackgroundGrokPublisherCpa;
}

function getGrokRuntime(state = {}) {
  return state?.runtimeState?.flowState?.grok || {};
}

test('grok cpa publisher uploads mint authJson and completes node', async () => {
  const api = loadApi();
  const logs = [];
  const completed = [];
  const imports = [];
  let liveState = {
    vpsUrl: 'http://127.0.0.1:8317/management.html',
    vpsPassword: 'secret',
    runtimeState: {
      flowState: {
        grok: {
          mint: {
            status: 'authorized',
            authJson: {
              type: 'xai',
              email: 'a@b.com',
              access_token: 'secret-at',
              refresh_token: 'secret-rt',
            },
          },
        },
      },
    },
  };
  const publisher = api.createGrokCpaPublisher({
    addLog: async (message) => { logs.push(message); },
    completeNodeFromBackground: async (nodeId, payload) => { completed.push({ nodeId, payload }); },
    getState: async () => ({ ...liveState }),
    setState: async (updates = {}) => {
      liveState = {
        ...liveState,
        ...updates,
        runtimeState: {
          ...(liveState.runtimeState || {}),
          ...(updates.runtimeState || {}),
          flowState: {
            ...(liveState.runtimeState?.flowState || {}),
            ...(updates.runtimeState?.flowState || {}),
          },
        },
      };
    },
    importXaiAuthFile: async (state, authJson, options = {}) => {
      imports.push({ state, authJson, options });
      return {
        verifiedStatus: 'CPA xAI 凭证导入完成：a@b.com',
        cpaImportedFileName: options.fileName || 'xai-a@b.com.json',
        cpaImportedEmail: 'a@b.com',
      };
    },
  });

  await publisher.executeGrokUploadCpa({ nodeId: 'grok-upload-cpa' });
  assert.equal(imports.length, 1);
  assert.equal(imports[0].authJson.access_token, 'secret-at');
  assert.equal(completed[0].nodeId, 'grok-upload-cpa');
  assert.equal(getGrokRuntime(completed[0].payload).upload.status, 'uploaded');
  assert.equal(getGrokRuntime(completed[0].payload).upload.targetId, 'cpa');
  assert.equal(getGrokRuntime(completed[0].payload).upload.fileName, 'xai-a@b.com.json');
  assert.equal(logs.some((message) => String(message).includes('secret-at')), false);
});

test('grok cpa publisher persists failure without completing', async () => {
  const api = loadApi();
  const completed = [];
  let liveState = {
    vpsUrl: 'http://127.0.0.1:8317/management.html',
    vpsPassword: 'secret',
    runtimeState: {
      flowState: {
        grok: {
          mint: {
            authJson: { type: 'xai', email: 'a@b.com', access_token: 'secret-at', refresh_token: 'rt' },
          },
        },
      },
    },
  };
  const publisher = api.createGrokCpaPublisher({
    addLog: async () => {},
    completeNodeFromBackground: async (...args) => completed.push(args),
    getState: async () => ({ ...liveState }),
    setState: async (updates = {}) => {
      liveState = { ...liveState, ...updates, runtimeState: { ...(liveState.runtimeState || {}), ...(updates.runtimeState || {}) } };
    },
    importXaiAuthFile: async () => {
      throw new Error('unauthorized');
    },
  });
  await assert.rejects(() => publisher.executeGrokUploadCpa({ nodeId: 'grok-upload-cpa' }), /unauthorized/);
  assert.equal(completed.length, 0);
  assert.equal(getGrokRuntime(liveState).upload.status, 'failed');
});
