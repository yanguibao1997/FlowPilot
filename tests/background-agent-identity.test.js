const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const crypto = require('node:crypto');

function loadAgentIdentityModule() {
  const source = fs.readFileSync('background/agent-identity.js', 'utf8');
  return new Function('self', `${source}; return self.MultiPageBackgroundAgentIdentity;`)({});
}

function loadSub2ApiApiModule() {
  const source = fs.readFileSync('background/sub2api-api.js', 'utf8');
  return new Function('self', `${source}; return self.MultiPageBackgroundSub2ApiApi;`)({});
}

function encodeBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createJwtToken(payload = {}) {
  return [
    encodeBase64UrlJson({ alg: 'HS256', typ: 'JWT' }),
    encodeBase64UrlJson(payload),
    'signature',
  ].join('.');
}

function createIdentityAccessToken(overrides = {}) {
  return createJwtToken({
    email: 'agent@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct-agent-1',
      chatgpt_user_id: 'user-agent-1',
      chatgpt_plan_type: 'free',
      chatgpt_account_is_fedramp: false,
      ...overrides,
    },
  });
}

test('agent identity builds sub2api import content in agent_identity shape', () => {
  const moduleApi = loadAgentIdentityModule();
  const content = moduleApi.buildAgentIdentityImportContent({
    agent_runtime_id: 'agent-runtime-1',
    agent_private_key: 'MC4CAQAwBQYDK2VwBCIEIP+GSbwp+rGKQ3yNu7jc4kdHVSB19W7AnVhxOFkbb57b',
    account_id: 'acct-agent-1',
    chatgpt_user_id: 'user-agent-1',
    email: 'agent@example.com',
    plan_type: 'free',
    chatgpt_account_is_fedramp: false,
  });
  const parsed = JSON.parse(content);
  assert.equal(parsed.auth_mode, 'agent_identity');
  assert.equal(parsed.agent_identity.agent_runtime_id, 'agent-runtime-1');
  assert.equal(parsed.agent_identity.account_id, 'acct-agent-1');
  assert.equal(parsed.agent_identity.plan_type, 'free');
  assert.equal(parsed.agent_identity.email, 'agent@example.com');
});

test('agent identity parses claims from access token jwt', () => {
  const moduleApi = loadAgentIdentityModule();
  const token = createIdentityAccessToken();
  const identity = moduleApi.parseIdentityClaims(token);
  assert.equal(identity.account_id, 'acct-agent-1');
  assert.equal(identity.chatgpt_user_id, 'user-agent-1');
  assert.equal(identity.plan_type, 'free');
  assert.equal(identity.email, 'agent@example.com');
});

test('agent identity registers runtime and imports through codex-session endpoint', async () => {
  const agentModule = loadAgentIdentityModule();
  const apiModule = loadSub2ApiApiModule();
  const fetchCalls = [];
  const logs = [];
  const accessToken = createIdentityAccessToken();

  // Provide WebCrypto-compatible subtle for node test env when available.
  if (!globalThis.crypto?.subtle && crypto.webcrypto?.subtle) {
    globalThis.crypto = crypto.webcrypto;
  }

  const api = apiModule.createSub2ApiApi({
    addLog: async (message, level = 'info') => {
      logs.push({ message, level });
    },
    normalizeSub2ApiUrl: (value) => value,
    DEFAULT_SUB2API_GROUP_NAME: 'codex',
    agentIdentityApi: agentModule.createAgentIdentityApi({
      fetchImpl: async (url, options = {}) => {
        fetchCalls.push({
          kind: 'openai',
          url,
          method: options.method || 'GET',
          body: options.body ? JSON.parse(options.body) : null,
        });
        if (String(url).includes('/v1/agent/register')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ agent_runtime_id: 'agent-runtime-test' }),
          };
        }
        if (String(url).includes('/task/register')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ task_id: 'task-1' }),
          };
        }
        return {
          ok: false,
          status: 404,
          text: async () => 'not found',
        };
      },
    }),
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url);
      const body = options.body ? JSON.parse(options.body) : null;
      fetchCalls.push({
        kind: 'sub2api',
        path: parsed.pathname,
        method: options.method || 'GET',
        body,
      });
      if (parsed.pathname === '/api/v1/auth/login') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ code: 0, data: { access_token: 'admin-token' } }),
        };
      }
      if (parsed.pathname === '/api/v1/admin/groups/all') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            code: 0,
            data: [{ id: 41, name: 'codex', platform: 'openai' }],
          }),
        };
      }
      if (parsed.pathname === '/api/v1/admin/accounts/import/codex-session') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            code: 0,
            data: {
              total: 1,
              created: 1,
              updated: 0,
              skipped: 0,
              failed: 0,
              items: [],
              warnings: [],
              errors: [],
            },
          }),
        };
      }
      return {
        ok: false,
        status: 404,
        text: async () => 'missing',
      };
    },
  });

  const result = await api.importAgentIdentityAccount({
    sub2apiUrl: 'http://127.0.0.1:8080/admin/accounts',
    sub2apiEmail: 'admin@example.com',
    sub2apiPassword: 'secret',
    sub2apiGroupName: 'codex',
    accessToken,
    email: 'agent@example.com',
  }, {
    logLabel: '步骤 7',
  });

  assert.match(result.verifiedStatus, /Agent Identity 导入完成/);
  assert.equal(result.sub2apiImportCreated, 1);
  assert.equal(result.agentRuntimeId, 'agent-runtime-test');

  const registerCall = fetchCalls.find((item) => item.kind === 'openai' && String(item.url).includes('/v1/agent/register'));
  assert.ok(registerCall);
  assert.match(registerCall.body.agent_public_key, /^ssh-ed25519 /);

  const importCall = fetchCalls.find((item) => item.kind === 'sub2api' && item.path === '/api/v1/admin/accounts/import/codex-session');
  assert.ok(importCall);
  const content = JSON.parse(importCall.body.content);
  assert.equal(content.auth_mode, 'agent_identity');
  assert.equal(content.agent_identity.agent_runtime_id, 'agent-runtime-test');
  assert.equal(content.agent_identity.account_id, 'acct-agent-1');
  assert.equal(importCall.body.name, 'agent@example.com');
  assert.equal(importCall.body.update_existing, true);
  assert.deepEqual(importCall.body.group_ids, [41]);
});

test('workflow includes normal agent identity variant and strategy mapping', () => {
  const workflowSource = fs.readFileSync('flows/openai/workflow.js', 'utf8');
  assert.match(workflowSource, /normalSub2apiAgentIdentity/);
  assert.match(workflowSource, /plusPaypalSub2apiAgentIdentity/);
  assert.match(workflowSource, /sub2api_agent_identity/);
  assert.match(workflowSource, /sub2api-agent-identity-import/);

  const capabilitySource = fs.readFileSync('core/flow-kernel/flow-capabilities.js', 'utf8');
  assert.match(capabilitySource, /sub2api_agent_identity/);

  const openaiIndex = fs.readFileSync('flows/openai/index.js', 'utf8');
  assert.match(openaiIndex, /sub2api_agent_identity/);

  const backgroundSource = fs.readFileSync('background.js', 'utf8');
  assert.match(backgroundSource, /background\/agent-identity\.js/);
  assert.match(backgroundSource, /sub2api-agent-identity-import\.js/);
  assert.match(backgroundSource, /'sub2api-agent-identity-import'/);
});
