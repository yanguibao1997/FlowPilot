(function attachBackgroundGrokState(root, factory) {
  root.MultiPageBackgroundGrokState = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundGrokStateModule() {
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

  function deepMerge(baseValue, patchValue) {
    if (Array.isArray(patchValue)) {
      return patchValue.map((entry) => cloneValue(entry));
    }
    if (!isPlainObject(patchValue)) {
      return patchValue === undefined ? cloneValue(baseValue) : patchValue;
    }

    const baseObject = isPlainObject(baseValue) ? baseValue : {};
    const next = {
      ...cloneValue(baseObject),
    };
    Object.entries(patchValue).forEach(([key, value]) => {
      next[key] = deepMerge(baseObject[key], value);
    });
    return next;
  }

  function cleanString(value = '') {
    return String(value ?? '').trim();
  }

  function assignCleanString(target = {}, key = '', value = '') {
    const normalized = cleanString(value);
    if (normalized) {
      target[key] = normalized;
    }
  }

  function assignPositiveInteger(target = {}, key = '', value) {
    const numeric = Math.floor(Number(value));
    if (Number.isInteger(numeric) && numeric > 0) {
      target[key] = numeric;
    }
  }

  function assignNonEmptyArray(target = {}, key = '', value) {
    if (Array.isArray(value) && value.length) {
      target[key] = value;
    }
  }

  function normalizeInteger(value, fallback = 0) {
    const numeric = Math.floor(Number(value));
    return Number.isInteger(numeric) ? numeric : fallback;
  }

  function normalizeNullableInteger(value, fallback = null) {
    if (value === null || value === undefined || value === '') {
      return fallback;
    }
    const numeric = Math.floor(Number(value));
    return Number.isInteger(numeric) ? numeric : fallback;
  }

  function normalizeSsoCookies(values = []) {
    if (!Array.isArray(values)) {
      return [];
    }
    return Array.from(new Set(
      values
        .map((entry) => cleanString(entry))
        .filter(Boolean)
    ));
  }


  function normalizeBrowserCookies(values = []) {
    if (!Array.isArray(values)) {
      return [];
    }
    return values
      .map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null;
        }
        const name = cleanString(entry.name);
        const value = cleanString(entry.value);
        if (!name || !value) {
          return null;
        }
        return {
          name,
          value,
          domain: cleanString(entry.domain),
          path: cleanString(entry.path) || '/',
          secure: Boolean(entry.secure),
          httpOnly: Boolean(entry.httpOnly),
        };
      })
      .filter(Boolean);
  }

  function normalizeAuthJson(value) {
    if (!isPlainObject(value)) {
      return null;
    }
    return cloneValue(value);
  }

  function buildDefaultRuntimeState() {
    return {
      session: {
        registerTabId: null,
        startedAt: 0,
        pageState: '',
        pageUrl: '',
        lastError: '',
      },
      register: {
        email: '',
        firstName: '',
        lastName: '',
        password: '',
        verificationRequestedAt: 0,
        verificationCode: '',
        status: '',
        completedAt: 0,
      },
      sso: {
        currentCookie: '',
        cookies: [],
        extractedAt: 0,
        browserCookies: [],
      },
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
    };
  }

  function normalizeRuntimeState(runtimeState = {}) {
    const merged = deepMerge(buildDefaultRuntimeState(), runtimeState);
    return {
      session: {
        registerTabId: normalizeNullableInteger(merged.session?.registerTabId),
        startedAt: Math.max(0, normalizeInteger(merged.session?.startedAt)),
        pageState: cleanString(merged.session?.pageState),
        pageUrl: cleanString(merged.session?.pageUrl),
        lastError: cleanString(merged.session?.lastError),
      },
      register: {
        email: cleanString(merged.register?.email).toLowerCase(),
        firstName: cleanString(merged.register?.firstName),
        lastName: cleanString(merged.register?.lastName),
        password: cleanString(merged.register?.password),
        verificationRequestedAt: Math.max(0, normalizeInteger(merged.register?.verificationRequestedAt)),
        verificationCode: cleanString(merged.register?.verificationCode),
        status: cleanString(merged.register?.status),
        completedAt: Math.max(0, normalizeInteger(merged.register?.completedAt)),
      },
      sso: {
        currentCookie: cleanString(merged.sso?.currentCookie || merged.ssoCookie),
        cookies: normalizeSsoCookies(merged.sso?.cookies || merged.ssoCookies),
        extractedAt: Math.max(0, normalizeInteger(merged.sso?.extractedAt)),
        browserCookies: normalizeBrowserCookies(merged.sso?.browserCookies),
      },
      mint: {
        status: cleanString(merged.mint?.status),
        userCode: cleanString(merged.mint?.userCode),
        verificationUri: cleanString(merged.mint?.verificationUri),
        deviceCode: cleanString(merged.mint?.deviceCode),
        accessToken: cleanString(merged.mint?.accessToken),
        refreshToken: cleanString(merged.mint?.refreshToken),
        idToken: cleanString(merged.mint?.idToken),
        expiresIn: Math.max(0, normalizeInteger(merged.mint?.expiresIn)),
        expiredAt: cleanString(merged.mint?.expiredAt),
        sub: cleanString(merged.mint?.sub),
        authJson: normalizeAuthJson(merged.mint?.authJson),
        mintedAt: Math.max(0, normalizeInteger(merged.mint?.mintedAt)),
        message: cleanString(merged.mint?.message),
      },
      upload: {
        status: cleanString(merged.upload?.status),
        uploadedAt: Math.max(0, normalizeInteger(merged.upload?.uploadedAt)),
        message: cleanString(merged.upload?.message),
        targetUrl: cleanString(merged.upload?.targetUrl),
        targetId: cleanString(merged.upload?.targetId).toLowerCase(),
        fileName: cleanString(merged.upload?.fileName),
        accountName: cleanString(merged.upload?.accountName),
      },
    };
  }

  function buildCanonicalRuntimeStatePatch(state = {}, runtimeState = {}) {
    const normalizedRuntimeState = normalizeRuntimeState(runtimeState);
    const baseRuntimeState = isPlainObject(state?.runtimeState)
      ? cloneValue(state.runtimeState)
      : {};
    const baseFlowState = isPlainObject(baseRuntimeState.flowState)
      ? cloneValue(baseRuntimeState.flowState)
      : {};
    return {
      ...baseRuntimeState,
      flowState: {
        ...baseFlowState,
        grok: normalizedRuntimeState,
      },
    };
  }

  function projectRuntimeFields(runtimeState = {}) {
    const normalizedRuntimeState = normalizeRuntimeState(runtimeState);
    return {
      grokRegisterTabId: normalizedRuntimeState.session.registerTabId,
      grokPageState: normalizedRuntimeState.session.pageState,
      grokPageUrl: normalizedRuntimeState.session.pageUrl,
      grokEmail: normalizedRuntimeState.register.email,
      grokFirstName: normalizedRuntimeState.register.firstName,
      grokLastName: normalizedRuntimeState.register.lastName,
      grokPassword: normalizedRuntimeState.register.password,
      grokVerificationRequestedAt: normalizedRuntimeState.register.verificationRequestedAt,
      grokVerificationCode: normalizedRuntimeState.register.verificationCode,
      grokRegisterStatus: normalizedRuntimeState.register.status,
      grokCompletedAt: normalizedRuntimeState.register.completedAt,
      grokSsoCookie: normalizedRuntimeState.sso.currentCookie,
      grokSsoCookies: normalizedRuntimeState.sso.cookies,
      grokSsoExtractedAt: normalizedRuntimeState.sso.extractedAt,
      grokSsoBrowserCookies: normalizedRuntimeState.sso.browserCookies,
      grokMintStatus: normalizedRuntimeState.mint.status,
      grokMintUserCode: normalizedRuntimeState.mint.userCode,
      grokMintMessage: normalizedRuntimeState.mint.message,
      grokMintedAt: normalizedRuntimeState.mint.mintedAt,
      grokUploadTargetId: normalizedRuntimeState.upload.targetId,
      grokUploadFileName: normalizedRuntimeState.upload.fileName,
      grokUploadAccountName: normalizedRuntimeState.upload.accountName,
      grokWebchat2ApiUploadStatus: normalizedRuntimeState.upload.status,
      grokWebchat2ApiUploadedAt: normalizedRuntimeState.upload.uploadedAt,
      grokWebchat2ApiUploadMessage: normalizedRuntimeState.upload.message,
      grokWebchat2ApiTargetUrl: normalizedRuntimeState.upload.targetUrl,
    };
  }

  function ensureRuntimeState(state = {}) {
    const runtimeFlowState = isPlainObject(state?.runtimeState?.flowState)
      ? state.runtimeState.flowState
      : {};
    const legacyFlowState = isPlainObject(state?.flowState?.grok)
      ? state.flowState.grok
      : {};
    const flatRuntime = {
      session: {},
      register: {},
      sso: {},
      mint: {},
      upload: {},
    };
    assignPositiveInteger(flatRuntime.session, 'registerTabId', state.grokRegisterTabId);
    assignCleanString(flatRuntime.session, 'pageState', state.grokPageState);
    assignCleanString(flatRuntime.session, 'pageUrl', state.grokPageUrl || state.grokPostVerificationUrl);
    assignCleanString(flatRuntime.register, 'email', state.grokEmail || state.email);
    assignCleanString(flatRuntime.register, 'firstName', state.grokFirstName);
    assignCleanString(flatRuntime.register, 'lastName', state.grokLastName);
    assignCleanString(flatRuntime.register, 'password', state.grokPassword);
    assignPositiveInteger(flatRuntime.register, 'verificationRequestedAt', state.grokVerificationRequestedAt);
    assignCleanString(flatRuntime.register, 'verificationCode', state.grokVerificationCode);
    assignCleanString(flatRuntime.register, 'status', state.grokRegisterStatus);
    assignPositiveInteger(flatRuntime.register, 'completedAt', state.grokCompletedAt);
    assignCleanString(flatRuntime.sso, 'currentCookie', state.grokSsoCookie);
    assignNonEmptyArray(flatRuntime.sso, 'cookies', state.grokSsoCookies);
    assignPositiveInteger(flatRuntime.sso, 'extractedAt', state.grokSsoExtractedAt || state.grokCompletedAt);
    assignCleanString(flatRuntime.upload, 'status', state.grokWebchat2ApiUploadStatus);
    assignPositiveInteger(flatRuntime.upload, 'uploadedAt', state.grokWebchat2ApiUploadedAt);
    assignCleanString(flatRuntime.upload, 'message', state.grokWebchat2ApiUploadMessage);
    assignCleanString(flatRuntime.upload, 'targetUrl', state.grokWebchat2ApiTargetUrl);
    assignCleanString(flatRuntime.upload, 'targetId', state.grokUploadTargetId);
    assignCleanString(flatRuntime.upload, 'fileName', state.grokUploadFileName);
    assignCleanString(flatRuntime.upload, 'accountName', state.grokUploadAccountName);
    assignCleanString(flatRuntime.mint, 'status', state.grokMintStatus);
    assignCleanString(flatRuntime.mint, 'userCode', state.grokMintUserCode);
    assignCleanString(flatRuntime.mint, 'message', state.grokMintMessage);
    assignPositiveInteger(flatRuntime.mint, 'mintedAt', state.grokMintedAt);
    if (Array.isArray(state.grokSsoBrowserCookies) && state.grokSsoBrowserCookies.length) {
      flatRuntime.sso.browserCookies = state.grokSsoBrowserCookies;
    }
    return normalizeRuntimeState(deepMerge(deepMerge(runtimeFlowState.grok || {}, legacyFlowState), flatRuntime));
  }

  function buildStateView(state = {}) {
    const runtimeState = ensureRuntimeState(state);
    const canonicalRuntimeState = buildCanonicalRuntimeStatePatch(state, runtimeState);
    return {
      ...state,
      ...projectRuntimeFields(runtimeState),
      runtimeState: canonicalRuntimeState,
      flowState: {
        ...(isPlainObject(state?.flowState) ? state.flowState : {}),
        grok: runtimeState,
      },
      flows: {
        ...(isPlainObject(state?.flows) ? state.flows : {}),
        grok: runtimeState,
      },
    };
  }

  function buildRuntimeStatePatch(currentState = {}, patch = {}) {
    if (!isPlainObject(patch)) {
      return {};
    }
    const nextRuntimeState = normalizeRuntimeState(
      deepMerge(ensureRuntimeState(currentState), patch)
    );
    return {
      ...projectRuntimeFields(nextRuntimeState),
      runtimeState: buildCanonicalRuntimeStatePatch(currentState, nextRuntimeState),
    };
  }

  function buildSessionStatePatch(currentState = {}, updates = {}) {
    const runtimePatch = isPlainObject(updates?.runtimeState?.flowState?.grok)
      ? updates.runtimeState.flowState.grok
      : (isPlainObject(updates?.flowState?.grok) ? updates.flowState.grok : null);
    if (!runtimePatch) {
      return {};
    }
    return buildRuntimeStatePatch(currentState, runtimePatch);
  }

  function buildRuntimeResetPatch(currentState = {}, patch = {}) {
    return buildRuntimeStatePatch(currentState, patch);
  }

  function buildStartRegisterResetPatch(currentState = {}) {
    return buildRuntimeStatePatch(currentState, buildDefaultRuntimeState());
  }

  function buildRegisterOnlyResetPatch(currentState = {}, registerPatch = {}) {
    const currentRuntimeState = ensureRuntimeState(currentState);
    return buildRuntimeStatePatch(currentState, {
      ...currentRuntimeState,
      session: {
        ...currentRuntimeState.session,
        pageState: '',
        pageUrl: '',
        lastError: '',
      },
      register: {
        ...buildDefaultRuntimeState().register,
        email: currentRuntimeState.register?.email || '',
        ...registerPatch,
      },
    });
  }

  function buildSsoResetPatch(currentState = {}) {
    const currentRuntimeState = ensureRuntimeState(currentState);
    return buildRuntimeStatePatch(currentState, {
      ...currentRuntimeState,
      sso: buildDefaultRuntimeState().sso,
    });
  }

  function buildDownstreamResetPatch(stepKey = '', currentState = {}) {
    switch (cleanString(stepKey)) {
      case 'grok-open-signup-page':
        return {
          flowStartTime: null,
          ...buildStartRegisterResetPatch(currentState),
        };
      case 'grok-submit-email':
        return buildRegisterOnlyResetPatch(currentState, {
          email: '',
        });
      case 'grok-submit-verification-code':
        return buildRegisterOnlyResetPatch(currentState, {});
      case 'grok-submit-profile':
      case 'grok-extract-sso-cookie': {
        const currentRuntimeState = ensureRuntimeState(currentState);
        return buildRuntimeStatePatch(currentState, {
          ...currentRuntimeState,
          sso: buildDefaultRuntimeState().sso,
          mint: buildDefaultRuntimeState().mint,
          upload: buildDefaultRuntimeState().upload,
        });
      }
      case 'grok-mint-oidc': {
        const currentRuntimeState = ensureRuntimeState(currentState);
        return buildRuntimeStatePatch(currentState, {
          ...currentRuntimeState,
          mint: buildDefaultRuntimeState().mint,
          upload: buildDefaultRuntimeState().upload,
        });
      }
      case 'grok-upload-cpa':
      case 'grok-upload-sub2api':
      case 'grok-upload-sso-to-webchat2api': {
        const currentRuntimeState = ensureRuntimeState(currentState);
        return buildRuntimeStatePatch(currentState, {
          ...currentRuntimeState,
          upload: buildDefaultRuntimeState().upload,
        });
      }
      default:
        return {};
    }
  }

  function applyNodeCompletionPayload(currentState = {}, payload = {}) {
    const runtimePatch = isPlainObject(payload?.runtimeState?.flowState?.grok)
      ? payload.runtimeState.flowState.grok
      : (isPlainObject(payload?.flowState?.grok) ? payload.flowState.grok : null);
    if (runtimePatch) {
      return buildRuntimeStatePatch(currentState, runtimePatch);
    }

    const patch = {};
    if (Object.prototype.hasOwnProperty.call(payload, 'grokRegisterTabId')) {
      patch.session = { ...(patch.session || {}), registerTabId: payload.grokRegisterTabId };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokPageState')) {
      patch.session = { ...(patch.session || {}), pageState: payload.grokPageState };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokPageUrl') || Object.prototype.hasOwnProperty.call(payload, 'grokSignupUrl') || Object.prototype.hasOwnProperty.call(payload, 'grokPostVerificationUrl')) {
      patch.session = {
        ...(patch.session || {}),
        pageUrl: payload.grokPageUrl || payload.grokPostVerificationUrl || payload.grokSignupUrl || '',
      };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokEmail') || Object.prototype.hasOwnProperty.call(payload, 'email')) {
      patch.register = {
        ...(patch.register || {}),
        email: payload.grokEmail || payload.email || '',
      };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokFirstName')) {
      patch.register = { ...(patch.register || {}), firstName: payload.grokFirstName };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokLastName')) {
      patch.register = { ...(patch.register || {}), lastName: payload.grokLastName };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokPassword')) {
      patch.register = { ...(patch.register || {}), password: payload.grokPassword };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokVerificationRequestedAt')) {
      patch.register = {
        ...(patch.register || {}),
        verificationRequestedAt: payload.grokVerificationRequestedAt,
      };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokVerificationCode')) {
      patch.register = { ...(patch.register || {}), verificationCode: payload.grokVerificationCode };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokRegisterStatus')) {
      patch.register = { ...(patch.register || {}), status: payload.grokRegisterStatus };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokCompletedAt')) {
      patch.register = { ...(patch.register || {}), completedAt: payload.grokCompletedAt };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokSsoCookie')) {
      patch.sso = { ...(patch.sso || {}), currentCookie: payload.grokSsoCookie };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokSsoCookies')) {
      patch.sso = { ...(patch.sso || {}), cookies: payload.grokSsoCookies };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokSsoExtractedAt') || Object.prototype.hasOwnProperty.call(payload, 'grokCompletedAt')) {
      patch.sso = {
        ...(patch.sso || {}),
        extractedAt: payload.grokSsoExtractedAt || payload.grokCompletedAt || 0,
      };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokWebchat2ApiUploadStatus')) {
      patch.upload = { ...(patch.upload || {}), status: payload.grokWebchat2ApiUploadStatus };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokWebchat2ApiUploadedAt')) {
      patch.upload = { ...(patch.upload || {}), uploadedAt: payload.grokWebchat2ApiUploadedAt };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokWebchat2ApiUploadMessage')) {
      patch.upload = { ...(patch.upload || {}), message: payload.grokWebchat2ApiUploadMessage };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokWebchat2ApiTargetUrl')) {
      patch.upload = { ...(patch.upload || {}), targetUrl: payload.grokWebchat2ApiTargetUrl };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokUploadTargetId')) {
      patch.upload = { ...(patch.upload || {}), targetId: payload.grokUploadTargetId };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokUploadFileName')) {
      patch.upload = { ...(patch.upload || {}), fileName: payload.grokUploadFileName };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokUploadAccountName')) {
      patch.upload = { ...(patch.upload || {}), accountName: payload.grokUploadAccountName };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokMintStatus')) {
      patch.mint = { ...(patch.mint || {}), status: payload.grokMintStatus };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokMintUserCode')) {
      patch.mint = { ...(patch.mint || {}), userCode: payload.grokMintUserCode };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokMintMessage')) {
      patch.mint = { ...(patch.mint || {}), message: payload.grokMintMessage };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokMintedAt')) {
      patch.mint = { ...(patch.mint || {}), mintedAt: payload.grokMintedAt };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'grokSsoBrowserCookies')) {
      patch.sso = { ...(patch.sso || {}), browserCookies: payload.grokSsoBrowserCookies };
    }
    if (!Object.keys(patch).length) {
      return {};
    }
    return buildRuntimeStatePatch(currentState, patch);
  }

  function buildFreshKeepState(currentState = {}) {
    return buildRuntimeStatePatch(currentState, buildDefaultRuntimeState());
  }

  return {
    applyNodeCompletionPayload,
    buildDefaultRuntimeState,
    buildDownstreamResetPatch,
    buildFreshKeepState,
    buildRuntimeStatePatch,
    buildSessionStatePatch,
    buildStateView,
    ensureRuntimeState,
    normalizeRuntimeState,
    normalizeSsoCookies,
    projectRuntimeFields,
  };
});
