(function attachBackgroundGrokOidcMinter(root, factory) {
  root.MultiPageBackgroundGrokOidcMinter = factory(root);
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundGrokOidcMinterModule(root) {
  const grokStateApi = root?.MultiPageBackgroundGrokState || null;
  const credentialSchemaApi = root?.MultiPageBackgroundGrokCredentialSchema || null;

  const CLIENT_ID = credentialSchemaApi?.CLIENT_ID || 'b1a00492-073a-47ea-816f-4c329264a828';
  const DEVICE_CODE_URL = 'https://auth.x.ai/oauth2/device/code';
  const TOKEN_URL = 'https://auth.x.ai/oauth2/token';
  const SCOPE = 'openid profile email offline_access grok-cli:access api:access';
  const GROK_DEVICE_CONFIRM_SOURCE_ID = 'grok-device-confirm';
  const DEFAULT_MINT_TIMEOUT_MS = 240 * 1000;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanString(value = '') {
    return String(value ?? '').trim();
  }

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : cleanString(error) || '未知错误';
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

  function readGrokRuntime(state = {}) {
    return grokStateApi?.ensureRuntimeState
      ? grokStateApi.ensureRuntimeState(state)
      : (isPlainObject(state?.runtimeState?.flowState?.grok)
        ? state.runtimeState.flowState.grok
        : {});
  }

  function buildRuntimePatch(currentState = {}, nextRuntime = {}) {
    if (typeof grokStateApi?.buildRuntimeStatePatch === 'function') {
      return grokStateApi.buildRuntimeStatePatch(currentState, nextRuntime);
    }
    return {
      runtimeState: {
        ...(isPlainObject(currentState?.runtimeState) ? currentState.runtimeState : {}),
        flowState: {
          ...(isPlainObject(currentState?.runtimeState?.flowState) ? currentState.runtimeState.flowState : {}),
          grok: nextRuntime,
        },
      },
    };
  }

  async function parseJsonResponse(response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch (_error) {
      return { raw: text };
    }
  }

  async function postForm(url, form = {}, options = {}) {
    const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
    const body = new URLSearchParams();
    Object.entries(form).forEach(([key, value]) => {
      body.set(key, String(value ?? ''));
    });
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'flowpilot-grok-oidc-minter/1.0',
      },
      body: body.toString(),
    });
    const payload = await parseJsonResponse(response);
    return {
      status: Number(response.status) || 0,
      ok: Boolean(response.ok),
      body: payload,
    };
  }

  async function requestDeviceCode(options = {}) {
    const result = await postForm(DEVICE_CODE_URL, {
      client_id: options.clientId || CLIENT_ID,
      scope: options.scope || SCOPE,
    }, options);
    if (!result.ok || !isPlainObject(result.body)) {
      throw new Error(`device code request failed HTTP ${result.status}`);
    }
    const deviceCode = cleanString(result.body.device_code);
    const userCode = cleanString(result.body.user_code);
    if (!deviceCode || !userCode) {
      throw new Error('device code response missing fields');
    }
    const verificationUri = cleanString(result.body.verification_uri) || 'https://accounts.x.ai/oauth2/device';
    const verificationUriComplete = cleanString(result.body.verification_uri_complete)
      || `${verificationUri}?user_code=${encodeURIComponent(userCode)}`;
    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete,
      expiresIn: Math.max(30, Math.floor(Number(result.body.expires_in) || 1800)),
      interval: Math.max(1, Math.floor(Number(result.body.interval) || 5)),
      raw: result.body,
    };
  }

  async function pollDeviceToken(deviceCode, options = {}) {
    const fetchImpl = options.fetchImpl;
    const throwIfStopped = typeof options.throwIfStopped === 'function' ? options.throwIfStopped : () => {};
    const sleepWithStop = typeof options.sleepWithStop === 'function'
      ? options.sleepWithStop
      : async (ms) => { await new Promise((resolve) => setTimeout(resolve, ms)); };
    const log = typeof options.log === 'function' ? options.log : async () => {};
    let sleepFor = Math.max(1, Math.floor(Number(options.interval) || 5));
    const expiresIn = Math.max(30, Math.floor(Number(options.expiresIn) || 1800));
    const deadline = Date.now() + Math.max(expiresIn - 5, 30) * 1000;
    const code = cleanString(deviceCode);
    if (!code) {
      throw new Error('缺少 device_code');
    }

    while (Date.now() < deadline) {
      throwIfStopped();
      const result = await postForm(TOKEN_URL, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: code,
        client_id: options.clientId || CLIENT_ID,
      }, { fetchImpl });

      if (result.ok && isPlainObject(result.body) && cleanString(result.body.access_token)) {
        const accessToken = cleanString(result.body.access_token);
        const refreshToken = cleanString(result.body.refresh_token);
        if (!refreshToken) {
          throw new Error('token response missing refresh_token');
        }
        return {
          accessToken,
          refreshToken,
          idToken: cleanString(result.body.id_token),
          tokenType: cleanString(result.body.token_type) || 'Bearer',
          expiresIn: Math.max(0, Math.floor(Number(result.body.expires_in) || 21600)),
          raw: result.body,
        };
      }

      const err = isPlainObject(result.body) ? cleanString(result.body.error) : '';
      const desc = isPlainObject(result.body) ? cleanString(result.body.error_description) : '';
      if (err === 'authorization_pending' || err === 'slow_down') {
        if (err === 'slow_down') {
          sleepFor = Math.min(sleepFor + 5, 30);
        }
        await log(`oauth poll: ${err}`);
        await sleepWithStop(sleepFor * 1000);
        continue;
      }
      if (err === 'expired_token' || err === 'access_denied') {
        throw new Error(`device auth failed: ${err}${desc ? `: ${desc}` : ''}`);
      }
      if (result.status === 400 && err) {
        throw new Error(`device auth token error: ${err}${desc ? `: ${desc}` : ''}`);
      }
      await log(`oauth poll unexpected HTTP ${result.status}`);
      await sleepWithStop(sleepFor * 1000);
    }
    throw new Error('device token poll timed out');
  }

  function createGrokOidcMinter(deps = {}) {
    const {
      addLog = async () => {},
      getState = async () => ({}),
      setState = async () => {},
      completeNodeFromBackground = null,
      requestDeviceCode: requestDeviceCodeDep = null,
      pollDeviceToken: pollDeviceTokenDep = null,
      runDeviceConfirmInTab = null,
      sleepWithStop = async (ms) => { await new Promise((resolve) => setTimeout(resolve, ms)); },
      throwIfStopped = () => {},
      fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
      mintTimeoutMs = DEFAULT_MINT_TIMEOUT_MS,
    } = deps;

    if (typeof completeNodeFromBackground !== 'function') {
      throw new Error('Grok OIDC minter requires completeNodeFromBackground.');
    }

    async function log(message, level = 'info', nodeId = '') {
      await addLog(message, level, nodeId ? { nodeId } : {});
    }

    async function persistMintPatch(currentState, mintPatch) {
      const currentRuntime = readGrokRuntime(currentState);
      const nextRuntime = {
        ...currentRuntime,
        mint: {
          ...(isPlainObject(currentRuntime.mint) ? currentRuntime.mint : {}),
          ...mintPatch,
        },
      };
      const patch = buildRuntimePatch(currentState, nextRuntime);
      await setState(patch);
      return patch;
    }

    async function executeGrokMintOidc(state = {}) {
      const nodeId = cleanString(state?.nodeId) || 'grok-mint-oidc';
      const latestState = await getState();
      const currentState = {
        ...(isPlainObject(latestState) ? latestState : {}),
        ...(isPlainObject(state) ? state : {}),
      };
      const nestedRuntime = isPlainObject(currentState?.runtimeState?.flowState?.grok)
        ? currentState.runtimeState.flowState.grok
        : (isPlainObject(currentState?.flowState?.grok) ? currentState.flowState.grok : {});
      const runtime = readGrokRuntime(currentState);
      const email = cleanString(
        nestedRuntime?.register?.email
        || runtime?.register?.email
        || currentState.grokEmail
        || currentState.email
      ).toLowerCase();
      const password = cleanString(
        nestedRuntime?.register?.password
        || runtime?.register?.password
        || currentState.grokPassword
        || currentState.password
      );
      const ssoCookie = cleanString(
        nestedRuntime?.sso?.currentCookie
        || runtime?.sso?.currentCookie
        || currentState.grokSsoCookie
      );
      const browserCookies = Array.isArray(nestedRuntime?.sso?.browserCookies)
        ? nestedRuntime.sso.browserCookies
        : (Array.isArray(runtime?.sso?.browserCookies)
          ? runtime.sso.browserCookies
          : (Array.isArray(currentState.grokSsoBrowserCookies) ? currentState.grokSsoBrowserCookies : []));

      if (!email || !password) {
        throw new Error('缺少注册邮箱或密码，请先完成 Grok 资料步骤。');
      }
      if (!ssoCookie) {
        throw new Error('缺少 Grok SSO Cookie，请先完成步骤 5。');
      }

      try {
        await log('步骤 6：开始 mint xAI OIDC...', 'info', nodeId);
        await persistMintPatch(currentState, {
          status: 'running',
          message: 'requesting device code',
          userCode: '',
          verificationUri: '',
          deviceCode: '',
          accessToken: '',
          refreshToken: '',
          idToken: '',
          authJson: null,
          mintedAt: 0,
        });

        const requestFn = typeof requestDeviceCodeDep === 'function' ? requestDeviceCodeDep : requestDeviceCode;
        const pollFn = typeof pollDeviceTokenDep === 'function' ? pollDeviceTokenDep : pollDeviceToken;
        const session = await requestFn({ fetchImpl });
        throwIfStopped();

        await persistMintPatch(currentState, {
          status: 'running',
          message: 'waiting device confirm',
          userCode: session.userCode,
          verificationUri: session.verificationUriComplete || session.verificationUri,
          deviceCode: session.deviceCode,
        });
        await log('步骤 6：已申请 device code，打开确认页并并行轮询 token...', 'info', nodeId);

        // Match reference cpa_xai flow: browser confirm and token poll run together.
        // Token poll is the source of truth; browser automation only drives the page to "允许".
        let confirmError = null;
        const confirmPromise = (typeof runDeviceConfirmInTab === 'function'
          ? runDeviceConfirmInTab({
            nodeId,
            email,
            password,
            ssoCookie,
            browserCookies,
            userCode: session.userCode,
            verificationUriComplete: session.verificationUriComplete,
            timeoutMs: mintTimeoutMs,
          })
          : Promise.resolve({ ok: true, pageState: 'skipped' })
        ).then((result) => {
          if (result?.error) {
            throw new Error(result.error);
          }
          return result || { ok: true };
        }).catch((error) => {
          confirmError = error;
          return null;
        });

        await log('步骤 6：正在轮询 token（与 device 确认并行）...', 'info', nodeId);
        let tokens = null;
        try {
          tokens = await pollFn(session.deviceCode, {
            fetchImpl,
            interval: session.interval,
            expiresIn: Math.min(session.expiresIn, Math.ceil(mintTimeoutMs / 1000) + 60),
            sleepWithStop,
            throwIfStopped,
            log: async (message) => log(`步骤 6：${message}`, 'info', nodeId),
          });
        } catch (pollError) {
          // If poll failed, wait confirm error for a more actionable message.
          await confirmPromise;
          if (confirmError) {
            throw new Error(`${getErrorMessage(pollError)}；device 确认：${getErrorMessage(confirmError)}`);
          }
          throw pollError;
        }

        // Poll success is enough; confirm may still be finishing/navigating.
        const confirmResult = await Promise.race([
          confirmPromise,
          (async () => {
            await sleepWithStop(1500);
            return { ok: true, pageState: 'poll_authorized' };
          })(),
        ]);
        if (confirmError) {
          await log(`步骤 6：token 已拿到，device 页收尾警告：${getErrorMessage(confirmError)}`, 'warn', nodeId);
        } else if (confirmResult?.pageState) {
          await log(`步骤 6：device 确认状态 ${confirmResult.pageState}`, 'info', nodeId);
        }
        throwIfStopped();

        if (!credentialSchemaApi?.buildCpaXaiAuthJson) {
          throw new Error('Grok credential schema 未加载。');
        }
        const authJson = credentialSchemaApi.buildCpaXaiAuthJson({
          email,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          idToken: tokens.idToken,
          expiresIn: tokens.expiresIn,
        });
        const mintedAt = Date.now();
        const completionRuntime = {
          ...readGrokRuntime(currentState),
          mint: {
            status: 'authorized',
            userCode: session.userCode,
            verificationUri: session.verificationUriComplete || session.verificationUri,
            deviceCode: '',
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            idToken: tokens.idToken || '',
            expiresIn: tokens.expiresIn,
            expiredAt: cleanString(authJson.expired),
            sub: cleanString(authJson.sub),
            authJson,
            mintedAt,
            message: 'authorized',
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
        };
        const completionPatch = buildRuntimePatch(currentState, completionRuntime);
        await log('步骤 6：OIDC mint 成功。', 'ok', nodeId);
        await completeNodeFromBackground(nodeId, completionPatch);
        return completionPatch;
      } catch (error) {
        const message = getErrorMessage(error);
        const failurePatch = await persistMintPatch(currentState, {
          status: 'failed',
          message,
        });
        await log(`步骤 6：${message}`, 'error', nodeId);
        throw error;
      }
    }

    return {
      executeGrokMintOidc,
    };
  }

  return {
    CLIENT_ID,
    DEVICE_CODE_URL,
    TOKEN_URL,
    SCOPE,
    GROK_DEVICE_CONFIRM_SOURCE_ID,
    requestDeviceCode,
    pollDeviceToken,
    createGrokOidcMinter,
  };
});
