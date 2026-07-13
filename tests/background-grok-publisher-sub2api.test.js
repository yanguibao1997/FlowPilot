const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadApi() {
  const state = fs.readFileSync('flows/grok/background/state.js', 'utf8');
  const source = fs.readFileSync('flows/grok/background/publisher-sub2api.js', 'utf8');
  const globalScope = {};
  new Function('self', `${state}; ${source}; return self;`)(globalScope);
  return globalScope.MultiPageBackgroundGrokPublisherSub2Api;
}

function getGrokRuntime(state = {}) {
  return state?.runtimeState?.flowState?.grok || {};
}

test('grok sub2api publisher creates xai account and completes node', async () => {
  const api = loadApi();
  const creates = [];
  const completed = [];
  const logs = [];
  let liveState = {
    sub2apiUrl: 'http://127.0.0.1:8080/admin/accounts',
    sub2apiEmail: 'admin@x.com',
    sub2apiPassword: 'pw',
    runtimeState: {
      flowState: {
        grok: {
          mint: {
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
  const publisher = api.createGrokSub2ApiPublisher({
    addLog: async (message) => logs.push(message),
    completeNodeFromBackground: async (nodeId, payload) => completed.push({ nodeId, payload }),
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
    createXaiAccount: async (state, authJson) => {
      creates.push({ state, authJson });
      return {
        verifiedStatus: 'SUB2API 已创建 xAI 账号 #1',
        accountName: 'a@b.com',
        accountId: 1,
      };
    },
  });

  await publisher.executeGrokUploadSub2Api({ nodeId: 'grok-upload-sub2api' });
  assert.equal(creates.length, 1);
  assert.equal(creates[0].authJson.access_token, 'secret-at');
  assert.equal(completed[0].nodeId, 'grok-upload-sub2api');
  assert.equal(getGrokRuntime(completed[0].payload).upload.status, 'uploaded');
  assert.equal(getGrokRuntime(completed[0].payload).upload.targetId, 'sub2api');
  assert.equal(getGrokRuntime(completed[0].payload).upload.accountName, 'a@b.com');
  assert.equal(logs.some((message) => String(message).includes('secret-at')), false);
});
