# Grok CPA / SUB2API Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend FlowPilot Grok flow so registration can mint xAI OIDC credentials and upload them to CPA (`auth-files`) or SUB2API (`platform:xai`) without changing the existing email/code path.

**Architecture:** Keep registration steps 1–5. Add a shared Grok OIDC minter (device-code + confirm page), then target-specific publishers. Reuse sidebar CPA/SUB2API credentials; do not reuse OpenAI OAuth/platform-verify executors. All Grok-private logic lives under `flows/grok/*`; `background.js` only wires importScripts and `stepExecutorsByKey`.

**Tech Stack:** Chrome MV3 extension, IIFE global modules (`MultiPage*`), Node built-in test runner (`node --test`), existing CPA/SUB2API management HTTP APIs.

**Spec:** `docs/superpowers/specs/2026-07-13-grok-cpa-sub2api-upload-design.md`

---

## File Map

| File | Responsibility |
|---|---|
| Create: `flows/grok/background/credential-schema.js` | Build CPA `type:xai` auth JSON and SUB2API account payload |
| Create: `flows/grok/background/oidc-minter.js` | Device-code mint orchestration + token poll |
| Create: `flows/grok/background/publisher-cpa.js` | Upload auth JSON to CPA auth-files |
| Create: `flows/grok/background/publisher-sub2api.js` | Create SUB2API xAI account |
| Create: `flows/grok/content/device-confirm-page.js` | Device confirm DOM automation |
| Modify: `flows/grok/background/state.js` | mint/upload runtime fields + cleanup |
| Modify: `flows/grok/background/register-runner.js` | Step 5 full cookie export for mint inject |
| Modify: `flows/grok/index.js` | targets `cpa`/`sub2api`, groups, drivers |
| Modify: `flows/grok/workflow.js` | steps 6–7 dynamic by target |
| Modify: `background/cpa-api.js` | `importXaiAuthFile` helper |
| Modify: `background/sub2api-api.js` | `createXaiAccount` helper |
| Modify: `background.js` | importScripts + executor map |
| Modify: `manifest.json` | content script hosts for auth/device pages |
| Modify: `sidepanel/sidepanel.html` | mint/upload status rows |
| Modify: `sidepanel/sidepanel.js` | Grok source options + status binding |
| Create: tests listed per task |

---

### Task 1: Credential schema module

**Files:**
- Create: `flows/grok/background/credential-schema.js`
- Test: `tests/background-grok-credential-schema.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/background-grok-credential-schema.test.js`  
Expected: FAIL (module file missing)

- [ ] **Step 3: Implement schema module**

Create `flows/grok/background/credential-schema.js` as an IIFE attaching `MultiPageBackgroundGrokCredentialSchema` with:

```js
// exports (conceptually)
{
  CLIENT_ID: 'b1a00492-073a-47ea-816f-4c329264a828',
  DEFAULT_BASE_URL: 'https://cli-chat-proxy.grok.com/v1',
  DEFAULT_TOKEN_ENDPOINT: 'https://auth.x.ai/oauth2/token',
  DEFAULT_REDIRECT_URI: 'http://127.0.0.1:56121/callback',
  DEFAULT_HEADERS: {
    'x-grok-client-version': '0.2.93',
    'x-xai-token-auth': 'xai-grok-cli',
    'x-authenticateresponse': 'authenticate-response',
  },
  buildCpaXaiAuthFileName(email),
  buildCpaXaiAuthJson({ email, accessToken, refreshToken, idToken, expiresIn, sub, expired, lastRefresh, headers, baseUrl }),
  buildSub2ApiXaiAccount(authJson, { priority, concurrency, groupIds, proxyId }),
  expiresAtMsFromAuth(authJson), // JWT exp*1000 or Date.parse(expired)
}
```

Match CLI shapes from `cpa_xai/schema.py` and `cpa_to_sub2api.py`. Strip `null` fields, keep empty strings for optional tokens only when needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/background-grok-credential-schema.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flows/grok/background/credential-schema.js tests/background-grok-credential-schema.test.js
git commit -m "feat(grok): add xAI credential schema helpers"
```

---

### Task 2: Grok runtime state for mint/upload

**Files:**
- Modify: `flows/grok/background/state.js`
- Test: `tests/background-grok-state-module.test.js` (extend)

- [ ] **Step 1: Write failing tests for mint fields**

Append to `tests/background-grok-state-module.test.js`:

```js
test('grok state normalizes mint and upload runtime fields', () => {
  const api = loadGrokStateApi();
  const runtime = api.normalizeRuntimeState({
    mint: {
      status: 'authorized',
      userCode: 'ABCD-EFGH',
      accessToken: 'at',
      refreshToken: 'rt',
      authJson: { type: 'xai', email: 'a@b.com' },
      mintedAt: 10,
    },
    upload: {
      status: 'uploaded',
      targetId: 'cpa',
      fileName: 'xai-a@b.com.json',
      uploadedAt: 20,
    },
  });
  assert.equal(runtime.mint.status, 'authorized');
  assert.equal(runtime.mint.userCode, 'ABCD-EFGH');
  assert.equal(runtime.mint.accessToken, 'at');
  assert.equal(runtime.upload.targetId, 'cpa');
  assert.equal(runtime.upload.fileName, 'xai-a@b.com.json');

  const projected = api.projectRuntimeFields(runtime);
  assert.equal(projected.grokMintStatus, 'authorized');
  assert.equal(projected.grokUploadTargetId, 'cpa');
});

test('buildFreshRuntimeReset clears mint tokens and upload result', () => {
  const api = loadGrokStateApi();
  // use existing reset helper if present; otherwise assert normalize of empty mint/upload defaults
  const defaults = api.normalizeRuntimeState({});
  assert.equal(defaults.mint.status, '');
  assert.equal(defaults.mint.accessToken, '');
  assert.equal(defaults.mint.authJson, null);
  assert.equal(defaults.upload.status, '');
  assert.equal(defaults.upload.targetId, '');
});
```

If `loadGrokStateApi` / helper names differ, match existing test file helpers.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/background-grok-state-module.test.js`  
Expected: FAIL on missing mint defaults/fields

- [ ] **Step 3: Extend `buildDefaultRuntimeState` / `normalizeRuntimeState` / `projectRuntimeFields` / `ensureRuntimeState`**

Add:

```js
mint: {
  status: '',
  userCode: '',
  verificationUri: '',
  deviceCode: '',
  accessToken: '',
  refreshToken: '',
  idToken: '',
  expiresIn: 0,
  expiredAt: '',
  sub: '',
  authJson: null,
  mintedAt: 0,
  message: '',
},
upload: {
  status: '',
  uploadedAt: 0,
  message: '',
  targetUrl: '',
  targetId: '',
  fileName: '',
  accountName: '',
},
```

Keep existing webchat projection fields working (`grokWebchat2ApiUploadStatus` can continue mapping from `upload.*` when target is webchat2api). Add flat projections:

- `grokMintStatus`, `grokMintMessage`, `grokMintedAt`
- `grokUploadTargetId`, `grokUploadFileName`, `grokUploadAccountName`

Ensure any fresh-reset helper clears mint/upload secrets.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/background-grok-state-module.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flows/grok/background/state.js tests/background-grok-state-module.test.js
git commit -m "feat(grok): extend runtime state for mint and upload"
```

---

### Task 3: Workflow + flow definition targets

**Files:**
- Modify: `flows/grok/workflow.js`
- Modify: `flows/grok/index.js`
- Test: `tests/background-grok-workflow-targets.test.js`

- [ ] **Step 1: Write failing workflow tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadWorkflow() {
  const source = fs.readFileSync('flows/grok/workflow.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageGrokWorkflow;`)(globalScope);
}

function loadDefinition() {
  const source = fs.readFileSync('flows/grok/index.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageGrokFlowDefinition;`)(globalScope);
}

test('grok workflow ends with mint + cpa upload for cpa target', () => {
  const wf = loadWorkflow();
  const steps = wf.getModeStepDefinitions({ targetId: 'cpa' });
  const keys = steps.map((s) => s.key);
  assert.deepEqual(keys.slice(0, 5), [
    'grok-open-signup-page',
    'grok-submit-email',
    'grok-submit-verification-code',
    'grok-submit-profile',
    'grok-extract-sso-cookie',
  ]);
  assert.equal(keys.includes('grok-mint-oidc'), true);
  assert.equal(keys.includes('grok-upload-cpa'), true);
  assert.equal(keys.includes('grok-upload-sub2api'), false);
  assert.equal(keys.includes('grok-upload-sso-to-webchat2api'), false);
});

test('grok workflow ends with mint + sub2api upload for sub2api target', () => {
  const wf = loadWorkflow();
  const keys = wf.getModeStepDefinitions({ targetId: 'sub2api' }).map((s) => s.key);
  assert.equal(keys.includes('grok-mint-oidc'), true);
  assert.equal(keys.includes('grok-upload-sub2api'), true);
  assert.equal(keys.includes('grok-upload-cpa'), false);
});

test('grok definition supports cpa and sub2api targets', () => {
  const def = loadDefinition();
  assert.equal(def.targets.cpa.id, 'cpa');
  assert.equal(def.targets.sub2api.id, 'sub2api');
  assert.equal(def.capabilities.supportedTargetIds.includes('cpa'), true);
  assert.equal(def.capabilities.supportedTargetIds.includes('sub2api'), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/background-grok-workflow-targets.test.js`  
Expected: FAIL

- [ ] **Step 3: Update workflow definitions**

In `flows/grok/workflow.js`:

```js
function normalizeTargetId(options = {}) {
  const raw = String(options?.targetId || options?.panelMode || 'cpa').trim().toLowerCase();
  if (raw === 'sub2api') return 'sub2api';
  if (raw === 'webchat2api') return 'webchat2api';
  return 'cpa';
}

function getModeStepDefinitions(options = {}) {
  const base = [/* steps 1-5 unchanged */ , mintStep];
  const targetId = normalizeTargetId(options);
  if (targetId === 'sub2api') return base.concat([uploadSub2ApiStep]);
  if (targetId === 'webchat2api') return [/* optional: steps 1-5 + old webchat upload without mint, or 1-6 mint+webchat; first version: 1-5 + webchat upload */];
  return base.concat([uploadCpaStep]);
}
```

Step objects:

```js
{
  id: 6, order: 60, key: 'grok-mint-oidc', title: 'Mint xAI OIDC',
  sourceId: 'grok-device-confirm',
  driverId: 'flows/grok/background/oidc-minter',
  command: 'grok-mint-oidc', flowId: 'grok',
}
{
  id: 7, order: 70, key: 'grok-upload-cpa', title: '上传凭证到 CPA',
  sourceId: 'grok-cpa', driverId: 'flows/grok/background/publisher-cpa',
  command: 'grok-upload-cpa', flowId: 'grok',
}
{
  id: 7, order: 70, key: 'grok-upload-sub2api', title: '上传账号到 SUB2API',
  sourceId: 'grok-sub2api', driverId: 'flows/grok/background/publisher-sub2api',
  command: 'grok-upload-sub2api', flowId: 'grok',
}
```

`getAllSteps()` returns union of all variant steps for registry.

In `flows/grok/index.js`:

- `supportedTargetIds: ['cpa', 'sub2api', 'webchat2api']`
- `defaultTargetId: 'cpa'`
- targets:
  - `cpa`: groups include existing CPA rows (`row-vps-url`, `row-vps-password`) + grok mint/upload status
  - `sub2api`: groups include existing SUB2API rows + status
  - keep `webchat2api`
- driverDefinitions for minter + publishers
- runtimeSources for `grok-device-confirm` (auth.x.ai / accounts.x.ai device paths)

Settings autoRun range default to 1–7.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/background-grok-workflow-targets.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flows/grok/workflow.js flows/grok/index.js tests/background-grok-workflow-targets.test.js
git commit -m "feat(grok): add cpa/sub2api workflow targets and mint steps"
```

---

### Task 4: CPA API helper for xAI auth-files

**Files:**
- Modify: `background/cpa-api.js`
- Test: `tests/background-cpa-api.test.js` (extend)

- [ ] **Step 1: Write failing test**

```js
test('cpa api imports xai auth json through auth-files endpoint', async () => {
  const fetchCalls = [];
  const api = createApiWithFetch(async (url, options) => {
    const parsed = new URL(url);
    fetchCalls.push({ path: parsed.pathname + parsed.search, method: options.method, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
  const result = await api.importXaiAuthFile({
    vpsUrl: 'http://127.0.0.1:8317/management.html',
    vpsPassword: 'secret',
  }, {
    type: 'xai',
    email: 'a@b.com',
    access_token: 'at',
    refresh_token: 'rt',
  });
  assert.equal(result.cpaImportedFileName, 'xai-a@b.com.json');
  const call = fetchCalls.find((c) => c.path.startsWith('/v0/management/auth-files'));
  assert.ok(call);
  assert.equal(call.method, 'POST');
  assert.match(call.path, /name=xai-a%40b\.com\.json|name=xai-a@b.com.json/);
  assert.equal(call.body.type, 'xai');
  assert.equal(call.body.email, 'a@b.com');
});
```

Adapt to existing test harness for `createCpaApi`.

- [ ] **Step 2: Run targeted test fail**

Run: `node --test tests/background-cpa-api.test.js`  
Expected: FAIL (`importXaiAuthFile` missing)

- [ ] **Step 3: Implement `importXaiAuthFile` in `createCpaApi`**

```js
async function importXaiAuthFile(state = {}, authJson = {}, options = {}) {
  const managementKey = normalizeString(state?.vpsPassword);
  if (!managementKey) throw new Error('尚未配置 CPA 管理密钥，请先在侧边栏填写。');
  const origin = deriveCpaManagementOrigin(state?.vpsUrl);
  const email = normalizeEmailValue(authJson?.email) || 'unknown';
  const fileName = normalizeString(options.fileName) || `xai-${email}.json`;
  if (!authJson || authJson.type !== 'xai' || !normalizeString(authJson.access_token)) {
    throw new Error('缺少有效的 xAI auth JSON（type=xai + access_token）。');
  }
  await fetchCpaManagementJson(origin, `/v0/management/auth-files?name=${encodeURIComponent(fileName)}`, {
    method: 'POST',
    managementKey,
    timeoutMs: options.timeoutMs,
    body: authJson,
  });
  return {
    verifiedStatus: `CPA xAI 凭证导入完成：${fileName}`,
    cpaImportedFileName: fileName,
    cpaImportedEmail: email,
  };
}
```

Export it from the returned API object.

- [ ] **Step 4: Run tests pass**

Run: `node --test tests/background-cpa-api.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add background/cpa-api.js tests/background-cpa-api.test.js
git commit -m "feat(cpa): support importing xAI auth-files"
```

---

### Task 5: SUB2API helper for xAI accounts

**Files:**
- Modify: `background/sub2api-api.js`
- Test: `tests/background-sub2api-api-xai.test.js`

- [ ] **Step 1: Write failing test**

```js
test('sub2api createXaiAccount posts platform xai oauth account', async () => {
  const calls = [];
  const api = createSub2ApiWithMockFetch(async (url, options) => {
    calls.push({ url, options });
    if (String(url).endsWith('/api/v1/auth/login')) {
      return jsonOk({ access_token: 'admin-token' });
    }
    if (String(url).includes('/api/v1/admin/groups/all')) {
      return jsonOk([{ id: 'g1', name: 'codex' }]);
    }
    if (String(url).endsWith('/api/v1/admin/accounts')) {
      return jsonOk({ id: 'acc1', name: 'a@b.com' });
    }
    throw new Error(`unexpected ${url}`);
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
  const createCall = calls.find((c) => String(c.url).endsWith('/api/v1/admin/accounts'));
  const body = JSON.parse(createCall.options.body);
  assert.equal(body.platform, 'xai');
  assert.equal(body.type, 'oauth');
  assert.equal(body.credentials.access_token, 'at');
  assert.equal(body.priority, 3);
  assert.equal(calls.some((c) => String(c.url).includes('openai/generate-auth-url')), false);
});
```

- [ ] **Step 2: Run fail**

Run: `node --test tests/background-sub2api-api-xai.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement `createXaiAccount`**

Inside `createSub2ApiApi`:

1. `loginSub2Api(state)`
2. resolve groups by `sub2apiGroupName` (reuse existing group helpers)
3. resolve optional proxy
4. build account via `MultiPageBackgroundGrokCredentialSchema.buildSub2ApiXaiAccount` if available, else local equivalent
5. `POST /api/v1/admin/accounts`
6. return `{ accountName, accountId, verifiedStatus }`

Do not call openai auth-url endpoints.

- [ ] **Step 4: Run pass**

Run: `node --test tests/background-sub2api-api-xai.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add background/sub2api-api.js tests/background-sub2api-api-xai.test.js
git commit -m "feat(sub2api): create xAI oauth accounts"
```

---

### Task 6: OIDC minter background module (API + orchestration skeleton)

**Files:**
- Create: `flows/grok/background/oidc-minter.js`
- Test: `tests/background-grok-oidc-minter.test.js`

- [ ] **Step 1: Write failing tests for device/token helpers and executor success path**

```js
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
});

test('executeGrokMintOidc stores authJson and completes node', async () => {
  const api = loadMinterApi();
  const completed = [];
  const states = [];
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
    setState: async (patch) => { states.push(patch); },
    completeNodeFromBackground: async (nodeId, patch) => { completed.push({ nodeId, patch }); },
    requestDeviceCode: async () => ({
      deviceCode: 'dc', userCode: 'UC',
      verificationUriComplete: 'https://auth.x.ai/device?user_code=UC',
      interval: 1, expiresIn: 30,
    }),
    runDeviceConfirmInTab: async () => ({ ok: true }),
    pollDeviceToken: async () => ({
      accessToken: 'at', refreshToken: 'rt', idToken: '', expiresIn: 21600, tokenType: 'Bearer',
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
});
```

- [ ] **Step 2: Run fail**

Run: `node --test tests/background-grok-oidc-minter.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement minter**

`flows/grok/background/oidc-minter.js` exposes:

```js
MultiPageBackgroundGrokOidcMinter = {
  requestDeviceCode,
  pollDeviceToken,
  createGrokOidcMinter(deps),
}
```

`createGrokOidcMinter` methods:

- `executeGrokMintOidc(state)`
  1. read email/password/sso from grok runtime (fail clear errors if missing)
  2. set mint.status=running
  3. requestDeviceCode
  4. open/reuse tab for verification_uri_complete; inject device-confirm content script
  5. send command to content: `GROK_DEVICE_CONFIRM` with email/password/cookies/userCode
  6. pollDeviceToken until authorized/expired/stopped
  7. build authJson via credential-schema
  8. persist mint fields + complete node
  9. on failure: mint.status=failed, mint.message=..., rethrow

Constants from CLI. Use `application/x-www-form-urlencoded` bodies. Never log tokens/password/sso.

For this task, `runDeviceConfirmInTab` can be a deps-injected function; real tab wiring lands in Task 7/8.

- [ ] **Step 4: Run pass**

Run: `node --test tests/background-grok-oidc-minter.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flows/grok/background/oidc-minter.js tests/background-grok-oidc-minter.test.js
git commit -m "feat(grok): add OIDC device-code minter module"
```

---

### Task 7: Device confirm content script

**Files:**
- Create: `flows/grok/content/device-confirm-page.js`
- Modify: `manifest.json`
- Test: `tests/grok-device-confirm-content.test.js` (source/structure + pure helpers if extracted)

- [ ] **Step 1: Write failing structure test**

```js
test('device confirm content script exposes command handler and exact allow click rule', () => {
  const source = fs.readFileSync('flows/grok/content/device-confirm-page.js', 'utf8');
  assert.match(source, /GROK_DEVICE_CONFIRM|grok-device-confirm/);
  assert.match(source, /允许/);
  assert.match(source, /cf-turnstile-response/);
  assert.match(source, /password/);
  assert.doesNotMatch(source, /全部允许.*clickAllow|clickAllow.*全部允许/);
});
```

- [ ] **Step 2: Run fail**

Run: `node --test tests/grok-device-confirm-content.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement content automation**

Follow CLI proven order in `cpa_xai/browser_confirm.py` comments:

1. optional cookie banner (not “允许” consent)
2. continue on device page
3. email login path if needed
4. wait for turnstile response field non-empty (timeout ~45s)
5. fill password, real click login
6. consent page: exact text match `允许` only (not `全部允许`)
7. return `{ ok:true, pageState }` when done page or consent accepted

Wire via existing content message pattern used by Grok register page (`EXECUTE_NODE` / command dispatch). Prefer same activation utils.

Update `manifest.json` content_scripts matches to include:

- `https://auth.x.ai/*`
- `https://accounts.x.ai/*`

and load `flows/grok/content/device-confirm-page.js` (plus shared activation/utils as needed). Keep injection list tight.

- [ ] **Step 4: Run pass**

Run: `node --test tests/grok-device-confirm-content.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flows/grok/content/device-confirm-page.js manifest.json tests/grok-device-confirm-content.test.js
git commit -m "feat(grok): add device confirm content automation"
```

---

### Task 8: Step 5 cookie export enhancement

**Files:**
- Modify: `flows/grok/background/register-runner.js`
- Test: `tests/grok-runner.test.js` (extend existing extract sso test)

- [ ] **Step 1: Extend failing assertion in extract SSO test**

In existing `executeGrokExtractSsoCookie` test, assert completed payload includes structured cookie objects or at least multi-domain inject list usable by mint:

```js
// after extract success
const sso = getGrokRuntime(completedPayload).sso;
assert.equal(sso.currentCookie, 'new-cookie');
assert.ok(Array.isArray(sso.cookies));
assert.ok(sso.cookies.length >= 1);
// if structured cookies stored separately:
// assert.ok(Array.isArray(sso.browserCookies));
```

If current storage only keeps string values, add `sso.browserCookies` array of `{name,value,domain,path,secure,httpOnly}` while keeping `sso.cookies` string list for backward compatibility.

- [ ] **Step 2: Run fail if field missing**

Run: `node --test tests/grok-runner.test.js`  
Expected: FAIL or identify gap

- [ ] **Step 3: Implement chrome.cookies export for x.ai domains**

In extract step, after finding sso value:

```js
const domains = ['.x.ai', 'accounts.x.ai', 'auth.x.ai', '.accounts.x.ai', 'grok.com', '.grok.com'];
// chrome.cookies.getAll per domain; merge unique
// clone sso/sso-rw onto key domains for mint inject list
```

Persist on runtime sso fields. Do not log cookie values.

- [ ] **Step 4: Run pass**

Run: `node --test tests/grok-runner.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flows/grok/background/register-runner.js tests/grok-runner.test.js
git commit -m "feat(grok): export browser cookies for OIDC mint inject"
```

---

### Task 9: CPA publisher module

**Files:**
- Create: `flows/grok/background/publisher-cpa.js`
- Test: `tests/background-grok-publisher-cpa.test.js`

- [ ] **Step 1: Write failing publisher tests**

Mirror style of `tests/background-grok-publisher-webchat2api.test.js`:

- requires mint.authJson
- calls cpa import helper
- completes node `grok-upload-cpa`
- sets upload.status=uploaded, targetId=cpa, fileName
- failure persists upload.failed without complete
- logs do not contain access_token

- [ ] **Step 2: Run fail**

Run: `node --test tests/background-grok-publisher-cpa.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement publisher**

```js
createGrokCpaPublisher(deps) => {
  executeGrokUploadCpa(state)
}
```

Flow:

1. getState latest
2. authJson from runtime mint (fallback error)
3. import via `deps.importXaiAuthFile(state, authJson)` or `MultiPageBackgroundCpaApi`
4. patch upload runtime + complete node

- [ ] **Step 4: Run pass**

Run: `node --test tests/background-grok-publisher-cpa.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flows/grok/background/publisher-cpa.js tests/background-grok-publisher-cpa.test.js
git commit -m "feat(grok): add CPA xAI auth publisher"
```

---

### Task 10: SUB2API publisher module

**Files:**
- Create: `flows/grok/background/publisher-sub2api.js`
- Test: `tests/background-grok-publisher-sub2api.test.js`

- [ ] **Step 1: Write failing tests**

- requires mint.authJson
- calls createXaiAccount
- completes `grok-upload-sub2api`
- upload.targetId=sub2api, accountName set
- no openai auth-url usage
- secret redaction in logs

- [ ] **Step 2: Run fail**

Run: `node --test tests/background-grok-publisher-sub2api.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement publisher**

Same pattern as CPA publisher, deps inject `createXaiAccount`.

- [ ] **Step 4: Run pass**

Run: `node --test tests/background-grok-publisher-sub2api.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flows/grok/background/publisher-sub2api.js tests/background-grok-publisher-sub2api.test.js
git commit -m "feat(grok): add SUB2API xAI account publisher"
```

---

### Task 11: background.js wiring

**Files:**
- Modify: `background.js`
- Test: `tests/background-grok-executor-wiring.test.js`

- [ ] **Step 1: Write wiring tests**

```js
test('background imports grok mint and publishers and maps executors', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /flows\/grok\/background\/credential-schema\.js/);
  assert.match(source, /flows\/grok\/background\/oidc-minter\.js/);
  assert.match(source, /flows\/grok\/background\/publisher-cpa\.js/);
  assert.match(source, /flows\/grok\/background\/publisher-sub2api\.js/);
  assert.match(source, /'grok-mint-oidc'/);
  assert.match(source, /'grok-upload-cpa'/);
  assert.match(source, /'grok-upload-sub2api'/);
});
```

- [ ] **Step 2: Run fail**

Run: `node --test tests/background-grok-executor-wiring.test.js`  
Expected: FAIL

- [ ] **Step 3: Wire modules**

In `importScripts` list (near other grok files), add the four modules.

Create instances near `grokWebchat2ApiPublisher`:

```js
const grokOidcMinter = self.MultiPageBackgroundGrokOidcMinter?.createGrokOidcMinter({ /* deps */ });
const grokCpaPublisher = self.MultiPageBackgroundGrokPublisherCpa?.createGrokCpaPublisher({ /* deps */ });
const grokSub2ApiPublisher = self.MultiPageBackgroundGrokPublisherSub2Api?.createGrokSub2ApiPublisher({ /* deps */ });
```

Map:

```js
'grok-mint-oidc': (state) => grokOidcMinter.executeGrokMintOidc(state),
'grok-upload-cpa': (state) => grokCpaPublisher.executeGrokUploadCpa(state),
'grok-upload-sub2api': (state) => grokSub2ApiPublisher.executeGrokUploadSub2Api(state),
```

Also add keys to any grok command allow-lists (search existing `grok-upload-sso-to-webchat2api` occurrences around lines 11157+ and update).

Provide minter deps for tab open/inject/send similar to register-runner.

- [ ] **Step 4: Run pass**

Run: `node --test tests/background-grok-executor-wiring.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add background.js tests/background-grok-executor-wiring.test.js
git commit -m "feat(grok): wire mint and upload executors in background"
```

---

### Task 12: Sidepanel source switching + status

**Files:**
- Modify: `sidepanel/sidepanel.html`
- Modify: `sidepanel/sidepanel.js`
- Test: `tests/sidepanel-grok-targets.test.js` (source-level)

- [ ] **Step 1: Write failing source tests**

```js
test('sidepanel supports grok cpa/sub2api targets and mint status rows', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  const js = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');
  assert.match(html, /row-grok-mint-status|display-grok-mint-status/);
  assert.match(html, /row-grok-upload-status|display-grok-upload-status/);
  assert.match(js, /cpa/);
  assert.match(js, /sub2api/);
  // when flow is grok, panel mode options should include cpa/sub2api
  assert.match(js, /webchat2api/);
});
```

- [ ] **Step 2: Run fail**

Run: `node --test tests/sidepanel-grok-targets.test.js`  
Expected: FAIL

- [ ] **Step 3: UI + binding changes**

HTML:

- Add rows for mint status / upload status (and optionally hide old webchat-only status unless target webchat2api)

JS:

- When `activeFlowId === 'grok'`, populate `select-panel-mode` options from flow targets: CPA / SUB2API / webchat2api
- Reuse existing CPA rows (`row-vps-url`, `row-vps-password`) for target cpa
- Reuse existing SUB2API rows for target sub2api
- Keep webchat rows for webchat2api
- Bind mint/upload displays from runtime projections
- Ensure SAVE_SETTING / target switch rebuilds step list (existing flow already uses targetId in step definitions; verify `refreshStepDefinitions` passes targetId)

Do not invent a second set of CPA credential inputs.

- [ ] **Step 4: Run pass**

Run: `node --test tests/sidepanel-grok-targets.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sidepanel/sidepanel.html sidepanel/sidepanel.js tests/sidepanel-grok-targets.test.js
git commit -m "feat(grok): sidepanel CPA/SUB2API targets and mint status"
```

---

### Task 13: Auto-run config validation for Grok targets

**Files:**
- Modify: `core/flow-kernel/flow-capabilities.js` and/or Grok capability hooks used by message-router validateAutoRunStart
- Test: `tests/background-grok-autorun-validation.test.js`

- [ ] **Step 1: Write failing validation tests**

```js
test('grok cpa auto-run requires vpsUrl and vpsPassword', () => {
  const result = validate({
    activeFlowId: 'grok',
    targetId: 'cpa',
    state: { vpsUrl: '', vpsPassword: '' },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /CPA/);
});

test('grok sub2api auto-run requires sub2api credentials', () => {
  const result = validate({
    activeFlowId: 'grok',
    targetId: 'sub2api',
    state: { sub2apiUrl: '', sub2apiEmail: '', sub2apiPassword: '' },
  });
  assert.equal(result.ok, false);
});
```

Use the project’s actual capability validation API surface.

- [ ] **Step 2: Run fail**

Run: `node --test tests/background-grok-autorun-validation.test.js`  
Expected: FAIL

- [ ] **Step 3: Implement validation**

If Grok currently has no custom validator, add flow capability validation for target prerequisites. Keep OpenAI validation unchanged.

- [ ] **Step 4: Run pass**

Run: `node --test tests/background-grok-autorun-validation.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/flow-kernel/flow-capabilities.js flows/grok/index.js tests/background-grok-autorun-validation.test.js
git commit -m "feat(grok): validate CPA/SUB2API config before auto-run"
```

---

### Task 14: Integration regression suite + manual checklist

**Files:**
- Test only / docs note in plan execution log
- Optionally update `docs/superpowers/specs/2026-07-13-grok-cpa-sub2api-upload-design.md` acceptance checkboxes after real runs

- [ ] **Step 1: Run full related tests**

```bash
node --test \
  tests/background-grok-credential-schema.test.js \
  tests/background-grok-state-module.test.js \
  tests/background-grok-workflow-targets.test.js \
  tests/background-cpa-api.test.js \
  tests/background-sub2api-api-xai.test.js \
  tests/background-grok-oidc-minter.test.js \
  tests/grok-device-confirm-content.test.js \
  tests/grok-runner.test.js \
  tests/background-grok-publisher-cpa.test.js \
  tests/background-grok-publisher-sub2api.test.js \
  tests/background-grok-publisher-webchat2api.test.js \
  tests/background-grok-executor-wiring.test.js \
  tests/sidepanel-grok-targets.test.js \
  tests/background-grok-autorun-validation.test.js
```

Expected: all PASS

- [ ] **Step 2: Manual verification checklist (Chrome load unpacked)**

1. Reload extension
2. Flow=Grok, target=CPA, fill CPA URL/key, email provider, Auto once
3. Confirm steps 1–7 and CPA auth-files shows `xai-*.json`
4. Flow=Grok, target=SUB2API, Auto once
5. Confirm SUB2API account platform xai created
6. Flow=OpenAI CPA smoke: existing oauth path still works
7. Confirm logs have no password/token/sso dumps

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "test(grok): harden CPA/SUB2API upload regression coverage"
```

---

## Spec Coverage Self-Review

| Spec requirement | Task |
|---|---|
| Keep email/code path | Task 3/8 (no mail changes) |
| Shared OIDC mint | Task 6, 7 |
| CPA upload auth-files | Task 4, 9, 11 |
| SUB2API platform=xai | Task 5, 10, 11 |
| Dynamic workflow by target | Task 3 |
| Runtime mint/upload state | Task 2 |
| Cookie export for mint | Task 8 |
| Sidepanel CPA/SUB2API for Grok | Task 12 |
| Auto validation | Task 13 |
| Secret redaction tests | Tasks 6/9/10 |
| OpenAI isolation | Tasks 4/5/11 (no oauth reuse) |
| webchat optional retain | Task 3 keeps webchat2api target |

## Placeholder Scan

No TBD/TODO left in tasks. Commands, file paths, and expected outcomes are explicit.

## Type/Name Consistency

Canonical names used throughout:

- Nodes: `grok-mint-oidc`, `grok-upload-cpa`, `grok-upload-sub2api`
- Globals: `MultiPageBackgroundGrokCredentialSchema`, `MultiPageBackgroundGrokOidcMinter`, `MultiPageBackgroundGrokPublisherCpa`, `MultiPageBackgroundGrokPublisherSub2Api`
- Executors: `executeGrokMintOidc`, `executeGrokUploadCpa`, `executeGrokUploadSub2Api`
- Runtime: `runtimeState.flowState.grok.mint|upload`

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-13-grok-cpa-sub2api-upload.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks
2. **Inline Execution** — execute tasks in this session with checkpoints

Which approach?
