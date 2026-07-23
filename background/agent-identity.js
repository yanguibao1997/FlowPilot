(function attachBackgroundAgentIdentity(root, factory) {
  root.MultiPageBackgroundAgentIdentity = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundAgentIdentityModule() {
  const DEFAULT_AUTH_API_BASE_URL = 'https://auth.openai.com/api/accounts';
  const DEFAULT_USER_AGENT = 'codex-agent-identity/1';
  const ED25519_PKCS8_PREFIX = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);

  class AgentIdentityError extends Error {
    constructor(message) {
      super(message);
      this.name = 'AgentIdentityError';
    }
  }

  function normalizeString(value = '') {
    return String(value || '').trim();
  }

  function bytesToBase64(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(source).toString('base64');
    }
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < source.length; index += chunkSize) {
      binary += String.fromCharCode(...source.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  function base64UrlToBytes(value = '') {
    const normalized = normalizeString(value).replace(/-/g, '+').replace(/_/g, '/');
    if (!normalized) {
      return new Uint8Array();
    }
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    if (typeof Buffer !== 'undefined') {
      return new Uint8Array(Buffer.from(padded, 'base64'));
    }
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function writeU32Be(value) {
    return Uint8Array.from([
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]);
  }

  function concatBytes(parts = []) {
    const total = parts.reduce((sum, part) => sum + (part?.length || 0), 0);
    const output = new Uint8Array(total);
    let offset = 0;
    parts.forEach((part) => {
      if (!part?.length) {
        return;
      }
      output.set(part, offset);
      offset += part.length;
    });
    return output;
  }

  function encodeSshString(value) {
    const bytes = typeof value === 'string'
      ? new TextEncoder().encode(value)
      : (value instanceof Uint8Array ? value : new Uint8Array(value || []));
    return concatBytes([writeU32Be(bytes.length), bytes]);
  }

  function utcTimestamp() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  function decodeJwtPayload(jwt = '') {
    const parts = normalizeString(jwt).split('.');
    if (parts.length !== 3 || !parts.every(Boolean)) {
      throw new AgentIdentityError('token 不是三段式 JWT');
    }
    try {
      const json = new TextDecoder().decode(base64UrlToBytes(parts[1]));
      const value = JSON.parse(json);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AgentIdentityError('JWT payload 必须是对象');
      }
      return value;
    } catch (error) {
      if (error instanceof AgentIdentityError) {
        throw error;
      }
      throw new AgentIdentityError('JWT payload 无效');
    }
  }

  function parseIdentityClaims(token = '') {
    const claims = decodeJwtPayload(token);
    const auth = claims?.['https://api.openai.com/auth'];
    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
      throw new AgentIdentityError('token 缺少 OpenAI auth claims');
    }
    const accountId = normalizeString(auth.chatgpt_account_id);
    const userId = normalizeString(
      auth.chatgpt_user_id
      || auth.chatgpt_account_user_id
      || auth.user_id
    );
    if (!accountId) {
      throw new AgentIdentityError('token 缺少 chatgpt_account_id');
    }
    if (!userId) {
      throw new AgentIdentityError('token 缺少 chatgpt_user_id');
    }
    let email = claims.email;
    const profile = claims?.['https://api.openai.com/profile'];
    if (typeof email !== 'string' && profile && typeof profile === 'object') {
      email = profile.email;
    }
    return {
      account_id: accountId,
      chatgpt_user_id: userId,
      email: typeof email === 'string' && email.trim() ? email.trim() : null,
      plan_type: typeof auth.chatgpt_plan_type === 'string' && auth.chatgpt_plan_type.trim()
        ? auth.chatgpt_plan_type.trim()
        : 'unknown',
      chatgpt_account_is_fedramp: Boolean(auth.chatgpt_account_is_fedramp),
    };
  }

  function resolveIdentityToken(tokens = {}) {
    const accessToken = normalizeString(tokens.access_token || tokens.accessToken);
    const idToken = normalizeString(tokens.id_token || tokens.idToken);
    if (!accessToken) {
      throw new AgentIdentityError('缺少 access_token，无法注册 Agent Identity');
    }
    const candidates = [idToken, accessToken].filter(Boolean);
    let lastError = null;
    for (const candidate of candidates) {
      try {
        return {
          accessToken,
          identityToken: candidate,
          identity: parseIdentityClaims(candidate),
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new AgentIdentityError('OAuth token 缺少 Agent Identity 所需账户 claims');
  }

  function sshEd25519PublicKey(rawPublicKey) {
    const publicKey = rawPublicKey instanceof Uint8Array ? rawPublicKey : new Uint8Array(rawPublicKey || []);
    if (publicKey.length !== 32) {
      throw new AgentIdentityError('Ed25519 公钥长度无效');
    }
    const blob = concatBytes([
      encodeSshString('ssh-ed25519'),
      encodeSshString(publicKey),
    ]);
    return `ssh-ed25519 ${bytesToBase64(blob)}`;
  }

  function seedToPkcs8Base64(seed) {
    const seedBytes = seed instanceof Uint8Array ? seed : new Uint8Array(seed || []);
    if (seedBytes.length !== 32) {
      throw new AgentIdentityError('Ed25519 私钥 seed 必须是 32 字节');
    }
    return bytesToBase64(concatBytes([ED25519_PKCS8_PREFIX, seedBytes]));
  }

  function extractSeedFromPkcs8(pkcs8) {
    const bytes = pkcs8 instanceof Uint8Array ? pkcs8 : new Uint8Array(pkcs8 || []);
    if (bytes.length === 48) {
      const prefix = bytes.subarray(0, 16);
      const matched = prefix.every((value, index) => value === ED25519_PKCS8_PREFIX[index]);
      if (matched) {
        return bytes.subarray(16);
      }
    }
    if (bytes.length === 32) {
      return bytes;
    }
    // Some runtimes export longer PKCS#8 envelopes; keep trailing 32 bytes as seed.
    if (bytes.length > 32) {
      return bytes.subarray(bytes.length - 32);
    }
    throw new AgentIdentityError('无法从 PKCS#8 导出 Ed25519 seed');
  }

  async function generateEd25519KeyMaterial() {
    if (!globalThis.crypto?.subtle?.generateKey) {
      throw new AgentIdentityError('当前环境不支持 Web Crypto，无法生成 Ed25519 密钥');
    }
    let keyPair;
    try {
      keyPair = await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    } catch (error) {
      throw new AgentIdentityError(`生成 Ed25519 密钥失败：${error?.message || error}`);
    }
    const [pkcs8, rawPublicKey] = await Promise.all([
      globalThis.crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
      globalThis.crypto.subtle.exportKey('raw', keyPair.publicKey),
    ]);
    const seed = extractSeedFromPkcs8(new Uint8Array(pkcs8));
    const publicKey = new Uint8Array(rawPublicKey);
    return {
      privateKey: keyPair.privateKey,
      seed,
      publicKey,
      agentPrivateKey: seedToPkcs8Base64(seed),
      agentPublicKey: sshEd25519PublicKey(publicKey),
    };
  }

  async function signTaskRegistration(privateKey, agentRuntimeId, timestamp) {
    const payload = new TextEncoder().encode(`${agentRuntimeId}:${timestamp}`);
    const signature = await globalThis.crypto.subtle.sign({ name: 'Ed25519' }, privateKey, payload);
    return bytesToBase64(new Uint8Array(signature));
  }

  async function httpJson(method, url, {
    headers = {},
    body = null,
    timeoutMs = 60000,
    fetchImpl = null,
  } = {}) {
    const fetchFn = fetchImpl
      || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchFn) {
      throw new AgentIdentityError('当前环境缺少 fetch，无法调用 Agent Identity API');
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 60000))
      : null;
    try {
      const response = await fetchFn(url, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': DEFAULT_USER_AGENT,
          ...headers,
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      });
      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
      if (!response.ok) {
        const detail = typeof payload?.detail === 'string'
          ? payload.detail
          : (typeof payload?.message === 'string' ? payload.message : text.slice(0, 500));
        throw new AgentIdentityError(`${method} ${url} 返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`);
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new AgentIdentityError(`${method} ${url} 返回的内容不是 JSON 对象`);
      }
      return payload;
    } catch (error) {
      if (error instanceof AgentIdentityError) {
        throw error;
      }
      if (error?.name === 'AbortError') {
        throw new AgentIdentityError(`${method} ${url} 请求超时`);
      }
      throw new AgentIdentityError(`${method} ${url} 请求失败：${error?.message || error}`);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function registerAgentIdentity(tokens = {}, options = {}) {
    const {
      authApiBaseUrl = DEFAULT_AUTH_API_BASE_URL,
      fetchImpl = null,
      timeoutMs = 60000,
      registerTask = true,
    } = options;
    const resolved = resolveIdentityToken(tokens);
    const keyMaterial = await generateEd25519KeyMaterial();
    const registrationHeaders = {
      Authorization: `Bearer ${resolved.accessToken}`,
    };
    if (resolved.identity.chatgpt_account_is_fedramp) {
      registrationHeaders['X-OpenAI-Fedramp'] = 'true';
    }

    const registration = await httpJson(
      'POST',
      `${normalizeString(authApiBaseUrl).replace(/\/+$/, '')}/v1/agent/register`,
      {
        headers: registrationHeaders,
        body: {
          abom: {
            agent_version: 'flowpilot-1',
            agent_harness_id: 'codex-cli',
            running_location: `custom-${normalizeString(globalThis?.navigator?.userAgentData?.platform || globalThis?.navigator?.platform || 'browser').toLowerCase() || 'browser'}`,
          },
          agent_public_key: keyMaterial.agentPublicKey,
          capabilities: ['responsesapi'],
          ttl: null,
        },
        timeoutMs,
        fetchImpl,
      }
    );

    const runtimeId = normalizeString(registration.agent_runtime_id || registration.agentRuntimeId);
    if (!runtimeId) {
      throw new AgentIdentityError('Agent 注册响应缺少 agent_runtime_id');
    }

    let taskId = '';
    if (registerTask) {
      try {
        const timestamp = utcTimestamp();
        const signature = await signTaskRegistration(keyMaterial.privateKey, runtimeId, timestamp);
        const task = await httpJson(
          'POST',
          `${normalizeString(authApiBaseUrl).replace(/\/+$/, '')}/v1/agent/${encodeURIComponent(runtimeId)}/task/register`,
          {
            body: {
              timestamp,
              signature,
            },
            timeoutMs,
            fetchImpl,
          }
        );
        taskId = normalizeString(task.task_id || task.taskId);
      } catch {
        // Sub2API Agent Identity 导入不强制 task_id；注册失败时忽略。
        taskId = '';
      }
    }

    return {
      agent_runtime_id: runtimeId,
      agent_private_key: keyMaterial.agentPrivateKey,
      account_id: resolved.identity.account_id,
      chatgpt_user_id: resolved.identity.chatgpt_user_id,
      email: resolved.identity.email,
      plan_type: resolved.identity.plan_type,
      chatgpt_account_is_fedramp: resolved.identity.chatgpt_account_is_fedramp,
      ...(taskId ? { task_id: taskId } : {}),
    };
  }

  function buildAgentIdentityImportContent(identity = {}) {
    const agentRuntimeId = normalizeString(identity.agent_runtime_id || identity.agentRuntimeId);
    const agentPrivateKey = normalizeString(identity.agent_private_key || identity.agentPrivateKey);
    const accountId = normalizeString(identity.account_id || identity.accountId || identity.chatgpt_account_id);
    const chatgptUserId = normalizeString(identity.chatgpt_user_id || identity.chatgptUserId);
    if (!agentRuntimeId || !agentPrivateKey || !accountId || !chatgptUserId) {
      throw new AgentIdentityError('Agent Identity 缺少 agent_runtime_id / agent_private_key / account_id / chatgpt_user_id');
    }
    const payload = {
      auth_mode: 'agent_identity',
      agent_identity: {
        agent_runtime_id: agentRuntimeId,
        agent_private_key: agentPrivateKey,
        account_id: accountId,
        chatgpt_user_id: chatgptUserId,
        email: normalizeString(identity.email) || null,
        plan_type: normalizeString(identity.plan_type || identity.planType) || 'unknown',
        chatgpt_account_is_fedramp: Boolean(identity.chatgpt_account_is_fedramp),
      },
    };
    const taskId = normalizeString(identity.task_id || identity.taskId);
    if (taskId) {
      payload.agent_identity.task_id = taskId;
    }
    return JSON.stringify(payload);
  }

  function createAgentIdentityApi(deps = {}) {
    const {
      fetchImpl = null,
      authApiBaseUrl = DEFAULT_AUTH_API_BASE_URL,
    } = deps;

    return {
      registerAgentIdentity: (tokens, options = {}) => registerAgentIdentity(tokens, {
        authApiBaseUrl,
        fetchImpl,
        ...options,
      }),
      buildAgentIdentityImportContent,
      parseIdentityClaims,
      resolveIdentityToken,
      sshEd25519PublicKey,
      seedToPkcs8Base64,
    };
  }

  return {
    AgentIdentityError,
    DEFAULT_AUTH_API_BASE_URL,
    buildAgentIdentityImportContent,
    createAgentIdentityApi,
    parseIdentityClaims,
    registerAgentIdentity,
    resolveIdentityToken,
    seedToPkcs8Base64,
    sshEd25519PublicKey,
  };
});
