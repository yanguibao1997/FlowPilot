(function attachBackgroundGrokPublisherCpa(root, factory) {
  root.MultiPageBackgroundGrokPublisherCpa = factory(root);
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundGrokPublisherCpaModule(root) {
  const grokStateApi = root?.MultiPageBackgroundGrokState || null;
  const credentialSchemaApi = root?.MultiPageBackgroundGrokCredentialSchema || null;

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

  function createGrokCpaPublisher(deps = {}) {
    const {
      addLog = async () => {},
      completeNodeFromBackground,
      getState = async () => ({}),
      setState = async () => {},
      importXaiAuthFile = null,
      createCpaApi = null,
    } = deps;

    if (typeof completeNodeFromBackground !== 'function') {
      throw new Error('Grok CPA publisher requires completeNodeFromBackground.');
    }

    async function log(message, level = 'info', nodeId = '') {
      await addLog(message, level, nodeId ? { nodeId } : {});
    }

    function resolveImporter() {
      if (typeof importXaiAuthFile === 'function') {
        return importXaiAuthFile;
      }
      const factory = createCpaApi
        || root?.MultiPageBackgroundCpaApi?.createCpaApi
        || (typeof self !== 'undefined' ? self.MultiPageBackgroundCpaApi?.createCpaApi : null);
      if (typeof factory !== 'function') {
        throw new Error('CPA API 模块未加载。');
      }
      const api = factory({ addLog });
      if (typeof api?.importXaiAuthFile !== 'function') {
        throw new Error('CPA API 不支持 importXaiAuthFile。');
      }
      return (state, authJson, options) => api.importXaiAuthFile(state, authJson, options);
    }

    async function applyRuntimeState(currentState = {}, patch = {}) {
      const nextPatch = mergeRuntimePatch(currentState, patch);
      await setState(nextPatch);
      return nextPatch;
    }

    async function executeGrokUploadCpa(state = {}) {
      const nodeId = cleanString(state?.nodeId) || 'grok-upload-cpa';
      const currentState = await getState();
      try {
        const authJson = resolveMintAuthJson(currentState);
        const fileName = credentialSchemaApi?.buildCpaXaiAuthFileName
          ? credentialSchemaApi.buildCpaXaiAuthFileName(authJson.email, authJson.sub)
          : `xai-${cleanString(authJson.email) || 'unknown'}.json`;

        await applyRuntimeState(currentState, {
          session: { lastError: '' },
          upload: {
            status: 'uploading',
            uploadedAt: 0,
            message: '',
            targetId: 'cpa',
            fileName,
            accountName: cleanString(authJson.email),
            targetUrl: cleanString(currentState.vpsUrl),
          },
        });

        await log('步骤 7：正在上传 xAI 凭证到 CPA...', 'info', nodeId);
        const importer = resolveImporter();
        const result = await importer(currentState, authJson, {
          fileName,
          logLabel: '步骤 7',
          logOptions: { nodeId, stepKey: 'grok-upload-cpa' },
        });
        const uploadedAt = Date.now();
        const payload = await applyRuntimeState(currentState, {
          session: { lastError: '' },
          upload: {
            status: 'uploaded',
            uploadedAt,
            message: cleanString(result?.verifiedStatus) || 'uploaded',
            targetId: 'cpa',
            fileName: cleanString(result?.cpaImportedFileName) || fileName,
            accountName: cleanString(result?.cpaImportedEmail || authJson.email),
            targetUrl: cleanString(currentState.vpsUrl),
          },
        });
        await log('步骤 7：CPA 上传成功。', 'ok', nodeId);
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
            targetId: 'cpa',
          },
        });
        await log(`步骤 7：${message}`, 'error', nodeId);
        throw error;
      }
    }

    return {
      executeGrokUploadCpa,
    };
  }

  return {
    createGrokCpaPublisher,
    resolveMintAuthJson,
  };
});
