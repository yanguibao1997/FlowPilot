(function attachBackgroundGrokCredentialSchema(root, factory) {
  root.MultiPageBackgroundGrokCredentialSchema = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundGrokCredentialSchemaModule() {
  const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
  const DEFAULT_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
  const DEFAULT_TOKEN_ENDPOINT = 'https://auth.x.ai/oauth2/token';
  const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:56121/callback';
  const DEFAULT_HEADERS = Object.freeze({
    'x-grok-client-version': '0.2.93',
    'x-xai-token-auth': 'xai-grok-cli',
    'x-authenticateresponse': 'authenticate-response',
    'x-grok-client-identifier': 'grok-shell',
    'User-Agent': 'grok-shell/0.2.93 (linux; x86_64)',
  });

  function cleanString(value = '') {
    return String(value ?? '').trim();
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function cloneValue(value) {
    if (Array.isArray(value)) {
      return value.map((entry) => cloneValue(entry));
    }
    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entryValue]) => [key, cloneValue(entryValue)])
      );
    }
    return value;
  }

  function stripNulls(value) {
    if (Array.isArray(value)) {
      return value.map((entry) => stripNulls(entry));
    }
    if (!isPlainObject(value)) {
      return value;
    }
    const next = {};
    Object.entries(value).forEach(([key, entryValue]) => {
      if (entryValue === null || entryValue === undefined) {
        return;
      }
      next[key] = stripNulls(entryValue);
    });
    return next;
  }

  function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  function sanitizeFileSegment(value = '') {
    const raw = cleanString(value);
    if (!raw) {
      return '';
    }
    return raw
      .split('')
      .map((ch) => (/[a-zA-Z0-9@._-]/.test(ch) ? ch : '-'))
      .join('')
      .replace(/^-+|-+$/g, '');
  }

  function decodeJwtPayload(token = '') {
    const parts = cleanString(token).split('.');
    if (parts.length < 2) {
      return {};
    }
    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const jsonText = typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
      const payload = JSON.parse(jsonText);
      return isPlainObject(payload) ? payload : {};
    } catch (_error) {
      return {};
    }
  }

  function expiredFromAccessToken(accessToken = '') {
    const payload = decodeJwtPayload(accessToken);
    const exp = Number(payload.exp);
    if (!Number.isFinite(exp) || exp <= 0) {
      return { expired: '', expiresIn: 21600, sub: cleanString(payload.sub || payload.principal_id) };
    }
    const iat = Number(payload.iat);
    const expiresIn = Number.isFinite(iat) && iat > 0
      ? Math.max(Math.floor(exp - iat), 0)
      : 21600;
    return {
      expired: new Date(exp * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      expiresIn: expiresIn || 21600,
      sub: cleanString(payload.sub || payload.principal_id),
    };
  }

  function normalizeBaseUrl(value = '') {
    let baseUrl = cleanString(value) || DEFAULT_BASE_URL;
    baseUrl = baseUrl.replace(/\/+$/, '');
    if (!/\/v1$/i.test(baseUrl) && /cli-chat-proxy\.grok\.com$/i.test(baseUrl)) {
      baseUrl = `${baseUrl}/v1`;
    }
    return baseUrl || DEFAULT_BASE_URL;
  }

  function buildCpaXaiAuthFileName(email = '', sub = '') {
    const emailSegment = sanitizeFileSegment(email);
    if (emailSegment) {
      return `xai-${emailSegment}.json`;
    }
    const subSegment = sanitizeFileSegment(sub);
    if (subSegment) {
      return `xai-${subSegment}.json`;
    }
    return 'xai-unknown.json';
  }

  function buildCpaXaiAuthJson(input = {}) {
    const accessToken = cleanString(input.accessToken || input.access_token);
    const refreshToken = cleanString(input.refreshToken || input.refresh_token);
    if (!accessToken) {
      throw new Error('access_token is required');
    }
    if (!refreshToken) {
      throw new Error('refresh_token is required (CPA cannot renew without it)');
    }

    const jwtMeta = expiredFromAccessToken(accessToken);
    const email = cleanString(input.email).toLowerCase();
    const sub = cleanString(input.sub) || jwtMeta.sub;
    const expiresInRaw = input.expiresIn ?? input.expires_in;
    const expiresIn = Number.isFinite(Number(expiresInRaw))
      ? Math.max(0, Math.floor(Number(expiresInRaw)))
      : (jwtMeta.expiresIn || 21600);
    const expired = cleanString(input.expired || input.expiredAt) || jwtMeta.expired;
    const lastRefresh = cleanString(input.lastRefresh || input.last_refresh) || nowIso();
    const idToken = cleanString(input.idToken || input.id_token);
    const headers = isPlainObject(input.headers)
      ? cloneValue(input.headers)
      : cloneValue(DEFAULT_HEADERS);

    const payload = {
      type: 'xai',
      auth_kind: 'oauth',
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: cleanString(input.tokenType || input.token_type) || 'Bearer',
      expires_in: expiresIn,
      expired,
      last_refresh: lastRefresh,
      email,
      sub,
      base_url: normalizeBaseUrl(input.baseUrl || input.base_url || DEFAULT_BASE_URL),
      token_endpoint: cleanString(input.tokenEndpoint || input.token_endpoint) || DEFAULT_TOKEN_ENDPOINT,
      redirect_uri: cleanString(input.redirectUri || input.redirect_uri) || DEFAULT_REDIRECT_URI,
      disabled: Boolean(input.disabled),
      headers,
    };
    if (idToken) {
      payload.id_token = idToken;
    }
    if (isPlainObject(input.extra)) {
      Object.entries(input.extra).forEach(([key, value]) => {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) {
          payload[key] = cloneValue(value);
        }
      });
    }
    return stripNulls(payload);
  }

  function emailKey(email = '') {
    return cleanString(email).toLowerCase().replace(/@/g, '_').replace(/\./g, '_');
  }

  function expiresAtMsFromAuth(authJson = {}) {
    const accessToken = cleanString(authJson?.access_token || authJson?.accessToken);
    if (accessToken) {
      const payload = decodeJwtPayload(accessToken);
      const exp = Number(payload.exp);
      if (Number.isFinite(exp) && exp > 0) {
        return exp * 1000;
      }
    }
    const expired = cleanString(authJson?.expired || authJson?.expiredAt);
    if (expired) {
      const ms = Date.parse(expired);
      if (Number.isFinite(ms)) {
        return ms;
      }
    }
    return null;
  }

  function buildSub2ApiXaiAccount(authJson = {}, options = {}) {
    const auth = isPlainObject(authJson) ? authJson : {};
    const accessToken = cleanString(auth.access_token || auth.accessToken);
    const refreshToken = cleanString(auth.refresh_token || auth.refreshToken);
    const email = cleanString(auth.email).toLowerCase();
    const sub = cleanString(auth.sub);
    const baseUrl = normalizeBaseUrl(auth.base_url || auth.baseUrl || DEFAULT_BASE_URL);
    const expired = cleanString(auth.expired);
    const expiresAt = expiresAtMsFromAuth(auth);
    const name = email || sub || 'xAI Account';
    const priority = Number.isFinite(Number(options.priority))
      ? Math.floor(Number(options.priority))
      : 1;
    const concurrency = Number.isFinite(Number(options.concurrency))
      ? Math.floor(Number(options.concurrency))
      : 10;
    const groupIds = Array.isArray(options.groupIds || options.group_ids)
      ? (options.groupIds || options.group_ids).map((entry) => cleanString(entry)).filter(Boolean)
      : [];
    const proxyId = cleanString(options.proxyId || options.proxy_id);

    const account = {
      name,
      platform: 'xai',
      type: 'oauth',
      auto_pause_on_expired: expiresAt ? true : null,
      expires_at: expiresAt,
      concurrency,
      priority,
      credentials: {
        access_token: accessToken,
        refresh_token: refreshToken,
        id_token: cleanString(auth.id_token || auth.idToken),
        token_type: cleanString(auth.token_type || auth.tokenType) || 'Bearer',
        expires_in: auth.expires_in ?? auth.expiresIn ?? null,
        expired,
        email,
        sub,
        base_url: baseUrl,
        token_endpoint: cleanString(auth.token_endpoint || auth.tokenEndpoint) || DEFAULT_TOKEN_ENDPOINT,
        redirect_uri: cleanString(auth.redirect_uri || auth.redirectUri) || DEFAULT_REDIRECT_URI,
        headers: isPlainObject(auth.headers) ? cloneValue(auth.headers) : {},
      },
      extra: {
        email,
        email_key: emailKey(email),
        name,
        auth_provider: 'xai',
        source: cleanString(options.source) || 'flowpilot-grok',
        last_refresh: cleanString(auth.last_refresh || auth.lastRefresh) || nowIso(),
      },
    };

    if (groupIds.length) {
      account.group_ids = groupIds;
    }
    if (proxyId) {
      account.proxy_id = proxyId;
    }

    return stripNulls(account);
  }

  return {
    CLIENT_ID,
    DEFAULT_BASE_URL,
    DEFAULT_TOKEN_ENDPOINT,
    DEFAULT_REDIRECT_URI,
    DEFAULT_HEADERS,
    buildCpaXaiAuthFileName,
    buildCpaXaiAuthJson,
    buildSub2ApiXaiAccount,
    expiresAtMsFromAuth,
  };
});
