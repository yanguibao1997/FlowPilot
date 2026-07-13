const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify({ code: 0, data: payload }),
    json: async () => ({ code: 0, data: payload }),
  };
}

function loadSub2ApiModule() {
  const schema = fs.readFileSync('flows/grok/background/credential-schema.js', 'utf8');
  const source = fs.readFileSync('background/sub2api-api.js', 'utf8');
  const globalScope = {};
  new Function('self', `${schema}; ${source}; return self;`)(globalScope);
  return globalScope.MultiPageBackgroundSub2ApiApi;
}

test('sub2api createXaiAccount posts platform xai oauth account', async () => {
  const apiModule = loadSub2ApiModule();
  const calls = [];
  const api = apiModule.createSub2ApiApi({
    normalizeSub2ApiUrl: (value) => value,
    DEFAULT_SUB2API_GROUP_NAME: 'codex',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/api/v1/auth/login')) {
        return createJsonResponse({ access_token: 'admin-token' });
      }
      if (String(url).includes('/api/v1/admin/groups/all')) {
        return createJsonResponse([{ id: 11, name: 'codex' }]);
      }
      if (String(url).endsWith('/api/v1/admin/accounts')) {
        return createJsonResponse({ id: 'acc1', name: 'a@b.com' });
      }
      throw new Error(`unexpected ${url}`);
    },
  });

  const result = await api.createXaiAccount({
    sub2apiUrl: 'http://127.0.0.1:8080/admin/accounts',
    sub2apiEmail: 'admin@x.com',
    sub2apiPassword: 'pw',
    sub2apiGroupName: 'codex',
    sub2apiAccountPriority: 3,
  }, {
    type: 'xai',
    email: 'a@b.com',
    access_token: 'at',
    refresh_token: 'rt',
    sub: 'sub-1',
  });

  assert.equal(result.accountName, 'a@b.com');
  const createCall = calls.find((entry) => String(entry.url).endsWith('/api/v1/admin/accounts'));
  assert.ok(createCall);
  const body = JSON.parse(createCall.options.body);
  assert.equal(body.platform, 'xai');
  assert.equal(body.type, 'oauth');
  assert.equal(body.credentials.access_token, 'at');
  assert.equal(body.priority, 3);
  assert.deepEqual(body.group_ids, [11]);
  assert.equal(calls.some((entry) => String(entry.url).includes('openai/generate-auth-url')), false);
});
