const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadApi() {
  const source = fs.readFileSync('flows/grok/background/credential-schema.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundGrokCredentialSchema;`)(globalScope);
}

test('builds CPA xai auth json and sub2api account payload', () => {
  const api = loadApi();
  const auth = api.buildCpaXaiAuthJson({
    email: 'a@b.com',
    accessToken: 'at.payload.sig',
    refreshToken: 'rt',
    idToken: 'idt',
    expiresIn: 21600,
    sub: 'sub-1',
  });
  assert.equal(auth.type, 'xai');
  assert.equal(auth.auth_kind, 'oauth');
  assert.equal(auth.email, 'a@b.com');
  assert.equal(auth.base_url, 'https://cli-chat-proxy.grok.com/v1');
  assert.equal(auth.token_endpoint, 'https://auth.x.ai/oauth2/token');
  assert.equal(api.buildCpaXaiAuthFileName('a@b.com'), 'xai-a@b.com.json');

  const account = api.buildSub2ApiXaiAccount(auth, { priority: 2, groupIds: ['g1'] });
  assert.equal(account.platform, 'xai');
  assert.equal(account.type, 'oauth');
  assert.equal(account.name, 'a@b.com');
  assert.equal(account.priority, 2);
  assert.deepEqual(account.group_ids, ['g1']);
  assert.equal(account.credentials.access_token, 'at.payload.sig');
  assert.equal(account.credentials.refresh_token, 'rt');
  assert.equal(account.extra.auth_provider, 'xai');
});

test('expiresAtMsFromAuth prefers jwt exp then expired string', () => {
  const api = loadApi();
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: 1783952254 })).toString('base64url');
  const token = `${header}.${payload}.sig`;
  assert.equal(api.expiresAtMsFromAuth({ access_token: token }), 1783952254000);
  assert.equal(
    api.expiresAtMsFromAuth({ expired: '2026-07-13T14:17:34Z' }),
    Date.parse('2026-07-13T14:17:34Z')
  );
});
