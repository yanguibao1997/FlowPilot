(function attachBackgroundGrokPublisherSub2Api(root, factory) {
  root.MultiPageBackgroundGrokPublisherSub2Api = factory(root);
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundGrokPublisherSub2ApiModule(root) {
  const grokStateApi = root?.MultiPageBackgroundGrokState || null;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanString(value = '') {
    return String(value ?? '').trim();
  }

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : cleanString(error) || '未知错误';
  }

  function readGrokRuntime(state = {}) {
    return grokStateApi?.ensureRuntimeState
      ? grokStateApi.ensureRuntimeState(state)
      : (isPlainObject(state?.runtimeState?.flowState?.grok) ? state.runtimeState.flowState.grok : {});
  }

  function mergeRuntimePatch(currentState = {}, patch = {}) {
    if (typeof grokStateApi?.buildRuntimeStatePatch === 'function') {
      return grokStateApi.buildRuntimeStatePatch(currentState, patch);
    }
    return {
      runtimeState: {
        ...(isPlainObject(currentState?.runtimeState) ? currentState.runtimeState : {}),
        flowState: {
          ...(isPlainObject(currentState?.runtimeState?.flowState) ? currentState.runtimeState.flowState : {}),
          grok: {
            ...readGrokRuntime(currentState),
            ...patch,
          },
        },
      },
    };
  }

  function resolveMintAuthJson(state = {}) {
    const runtime = readGrokRuntime(state);
    const nested = isPlainObject(state?.runtimeState?.flowState?.grok)
      ? state.runtimeState.flowState.grok
      : {};
    const authJson = nested?.mint?.authJson || runtime?.mint?.authJson || null;
    if (!isPlainObject(authJson) || cleanString(authJson.type) !== 'xai' || !cleanString(authJson.access_token)) {
      throw new Error('缺少有效的 xAI mint 凭证，请先完成步骤 6。');
    }
    return authJson;
  }

  function createGrokSub2ApiPublisher(deps = {}) {
    const {
      addLog = async () => {},
      completeNodeFromBackground,
      getState = async () => ({}),
      setState = async () => {},
      createXaiAccount = null,
      createSub2ApiApi = null,
      normalizeSub2ApiUrl = (value) => value,
      DEFAULT_SUB2API_GROUP_NAME = 'codex',
    } = deps;

    if (typeof completeNodeFromBackground !== 'function') {
      throw new Error('Grok SUB2API publisher requires completeNodeFromBackground.');
    }

    async function log(message, level = 'info', nodeId = '') {
      await addLog(message, level, nodeId ? { nodeId } : {});
    }

    function resolveCreator() {
      if (typeof createXaiAccount === 'function') {
        return createXaiAccount;
      }
      const factory = createSub2ApiApi
        || root?.MultiPageBackgroundSub2ApiApi?.createSub2ApiApi
        || (typeof self !== 'undefined' ? self.MultiPageBackgroundSub2ApiApi?.createSub2ApiApi : null);
      if (typeof factory !== 'function') {
        throw new Error('SUB2API 模块未加载。');
      }
      const api = factory({
        addLog,
        normalizeSub2ApiUrl,
        DEFAULT_SUB2API_GROUP_NAME,
      });
      if (typeof api?.createXaiAccount !== 'function') {
        throw new Error('SUB2API API 不支持 createXaiAccount。');
      }
      return (state, authJson, options) => api.createXaiAccount(state, authJson, options);
    }

    async function applyRuntimeState(currentState = {}, patch = {}) {
      const nextPatch = mergeRuntimePatch(currentState, patch);
      await setState(nextPatch);
      return nextPatch;
    }

    async function executeGrokUploadSub2Api(state = {}) {
      const nodeId = cleanString(state?.nodeId) || 'grok-upload-sub2api';
      const currentState = await getState();
      try {
        const authJson = resolveMintAuthJson(currentState);
        await applyRuntimeState(currentState, {
          session: { lastError: '' },
          upload: {
            status: 'uploading',
            uploadedAt: 0,
            message: '',
            targetId: 'sub2api',
            accountName: cleanString(authJson.email),
            fileName: '',
            targetUrl: cleanString(currentState.sub2apiUrl),
          },
        });

        await log('步骤 7：正在创建 SUB2API xAI 账号...', 'info', nodeId);
        const creator = resolveCreator();
        const result = await creator(currentState, authJson, {
          logLabel: '步骤 7',
          logOptions: { nodeId, stepKey: 'grok-upload-sub2api' },
        });
        const uploadedAt = Date.now();
        const accountName = cleanString(result?.accountName || result?.sub2apiAccountName || authJson.email);
        const payload = await applyRuntimeState(currentState, {
          session: { lastError: '' },
          upload: {
            status: 'uploaded',
            uploadedAt,
            message: cleanString(result?.verifiedStatus) || 'uploaded',
            targetId: 'sub2api',
            accountName,
            fileName: '',
            targetUrl: cleanString(currentState.sub2apiUrl),
          },
        });
        await log('步骤 7：SUB2API 上传成功。', 'ok', nodeId);
        await completeNodeFromBackground(nodeId, payload);
        return payload;
      } catch (error) {
        const message = getErrorMessage(error);
        await applyRuntimeState(currentState, {
          session: { lastError: message },
          upload: {
            status: 'failed',
            uploadedAt: 0,
            message,
            targetId: 'sub2api',
          },
        });
        await log(`步骤 7：${message}`, 'error', nodeId);
        throw error;
      }
    }

    return {
      executeGrokUploadSub2Api,
    };
  }

  return {
    createGrokSub2ApiPublisher,
    resolveMintAuthJson,
  };
});
