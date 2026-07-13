const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadMinterApi() {
  const schema = fs.readFileSync('flows/grok/background/credential-schema.js', 'utf8');
  const state = fs.readFileSync('flows/grok/background/state.js', 'utf8');
  const source = fs.readFileSync('flows/grok/background/oidc-minter.js', 'utf8');
  const globalScope = {};
  new Function('self', `${schema}; ${state}; ${source}; return self;`)(globalScope);
  return globalScope.MultiPageBackgroundGrokOidcMinter;
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  };
}

test('requestDeviceCode posts client_id and scope', async () => {
  const api = loadMinterApi();
  const calls = [];
  const session = await api.requestDeviceCode({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        device_code: 'dc',
        user_code: 'UC',
        verification_uri: 'https://auth.x.ai/device',
        verification_uri_complete: 'https://auth.x.ai/device?user_code=UC',
        expires_in: 600,
        interval: 1,
      });
    },
  });
  assert.equal(session.deviceCode, 'dc');
  assert.equal(session.userCode, 'UC');
  assert.match(calls[0].url, /oauth2\/device\/code/);
  assert.match(String(calls[0].options.body), /client_id=/);
  assert.match(String(calls[0].options.body), /scope=/);
});

test('executeGrokMintOidc stores authJson and completes node', async () => {
  const api = loadMinterApi();
  const completed = [];
  const minter = api.createGrokOidcMinter({
    addLog: async () => {},
    getState: async () => ({
      runtimeState: {
        flowState: {
          grok: {
            register: { email: 'a@b.com', password: 'P@ssw0rd!' },
            sso: { currentCookie: 'sso-cookie', cookies: ['sso-cookie'] },
          },
        },
      },
    }),
    setState: async () => {},
    completeNodeFromBackground: async (nodeId, patch) => { completed.push({ nodeId, patch }); },
    requestDeviceCode: async () => ({
      deviceCode: 'dc',
      userCode: 'UC',
      verificationUri: 'https://auth.x.ai/device',
      verificationUriComplete: 'https://auth.x.ai/device?user_code=UC',
      interval: 1,
      expiresIn: 30,
    }),
    runDeviceConfirmInTab: async () => ({ ok: true }),
    pollDeviceToken: async () => ({
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: '',
      expiresIn: 21600,
      tokenType: 'Bearer',
    }),
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });
  await minter.executeGrokMintOidc({ nodeId: 'grok-mint-oidc' });
  assert.equal(completed[0].nodeId, 'grok-mint-oidc');
  const mint = completed[0].patch.runtimeState.flowState.grok.mint;
  assert.equal(mint.status, 'authorized');
  assert.equal(mint.authJson.type, 'xai');
  assert.equal(mint.authJson.email, 'a@b.com');
  assert.equal(mint.authJson.access_token, 'at');
  assert.equal(mint.authJson.refresh_token, 'rt');
});
