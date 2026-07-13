(function attachMultiPageGrokWorkflow(root, factory) {
  root.MultiPageGrokWorkflow = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createMultiPageGrokWorkflow() {
  function freezeDeep(entry) {
    if (!entry || typeof entry !== 'object' || Object.isFrozen(entry)) {
      return entry;
    }
    Object.getOwnPropertyNames(entry).forEach((key) => {
      freezeDeep(entry[key]);
    });
    return Object.freeze(entry);
  }

  function cloneSteps(steps = []) {
    return steps.map((step) => ({ ...step }));
  }

  const BASE_REGISTER_STEPS = freezeDeep([
    {
      id: 1,
      order: 10,
      key: 'grok-open-signup-page',
      title: '打开 Grok 注册页',
      sourceId: 'grok-register-page',
      driverId: 'flows/grok/background/register-runner',
      command: 'grok-open-signup-page',
      flowId: 'grok',
    },
    {
      id: 2,
      order: 20,
      key: 'grok-submit-email',
      title: '获取邮箱并继续',
      sourceId: 'grok-register-page',
      driverId: 'flows/grok/background/register-runner',
      command: 'grok-submit-email',
      flowId: 'grok',
    },
    {
      id: 3,
      order: 30,
      key: 'grok-submit-verification-code',
      title: '获取验证码并继续',
      sourceId: 'grok-register-page',
      driverId: 'flows/grok/background/register-runner',
      command: 'grok-submit-verification-code',
      mailRuleId: 'grok-submit-verification-code',
      flowId: 'grok',
    },
    {
      id: 4,
      order: 40,
      key: 'grok-submit-profile',
      title: '填写资料并继续',
      sourceId: 'grok-register-page',
      driverId: 'flows/grok/background/register-runner',
      command: 'grok-submit-profile',
      flowId: 'grok',
    },
    {
      id: 5,
      order: 50,
      key: 'grok-extract-sso-cookie',
      title: '提取 SSO Cookie',
      sourceId: 'grok-register-page',
      driverId: 'flows/grok/background/register-runner',
      command: 'grok-extract-sso-cookie',
      flowId: 'grok',
    },
  ]);

  const MINT_STEP = freezeDeep({
    id: 6,
    order: 60,
    key: 'grok-mint-oidc',
    title: 'Mint xAI OIDC',
    sourceId: 'grok-device-confirm',
    driverId: 'flows/grok/background/oidc-minter',
    command: 'grok-mint-oidc',
    flowId: 'grok',
  });

  const UPLOAD_CPA_STEP = freezeDeep({
    id: 7,
    order: 70,
    key: 'grok-upload-cpa',
    title: '上传凭证到 CPA',
    sourceId: 'grok-cpa',
    driverId: 'flows/grok/background/publisher-cpa',
    command: 'grok-upload-cpa',
    flowId: 'grok',
  });

  const UPLOAD_SUB2API_STEP = freezeDeep({
    id: 7,
    order: 70,
    key: 'grok-upload-sub2api',
    title: '上传账号到 SUB2API',
    sourceId: 'grok-sub2api',
    driverId: 'flows/grok/background/publisher-sub2api',
    command: 'grok-upload-sub2api',
    flowId: 'grok',
  });

  const UPLOAD_WEBCHAT_STEP = freezeDeep({
    id: 6,
    order: 60,
    key: 'grok-upload-sso-to-webchat2api',
    title: '上传 SSO 到 webchat2api',
    sourceId: 'grok-webchat2api',
    driverId: 'flows/grok/background/publisher-webchat2api',
    command: 'grok-upload-sso-to-webchat2api',
    flowId: 'grok',
  });

  function normalizeTargetId(options = {}) {
    const raw = String(
      options?.targetId
      || options?.panelMode
      || options?.source
      || ''
    ).trim().toLowerCase();
    if (raw === 'sub2api') {
      return 'sub2api';
    }
    if (raw === 'webchat2api' || raw === 'webchat') {
      return 'webchat2api';
    }
    return 'cpa';
  }

  function getModeStepDefinitions(options = {}) {
    const targetId = normalizeTargetId(options);
    const base = cloneSteps(BASE_REGISTER_STEPS);
    if (targetId === 'webchat2api') {
      return base.concat([cloneSteps([UPLOAD_WEBCHAT_STEP])[0]]);
    }
    if (targetId === 'sub2api') {
      return base.concat([
        cloneSteps([MINT_STEP])[0],
        cloneSteps([UPLOAD_SUB2API_STEP])[0],
      ]);
    }
    return base.concat([
      cloneSteps([MINT_STEP])[0],
      cloneSteps([UPLOAD_CPA_STEP])[0],
    ]);
  }

  function getAllSteps() {
    const byKey = new Map();
    [
      ...BASE_REGISTER_STEPS,
      MINT_STEP,
      UPLOAD_CPA_STEP,
      UPLOAD_SUB2API_STEP,
      UPLOAD_WEBCHAT_STEP,
    ].forEach((step) => {
      byKey.set(step.key, step);
    });
    return Array.from(byKey.values()).map((step) => ({ ...step }));
  }

  function getPlusPaymentStepTitle() {
    return '';
  }

  function resolveStepTitle(step = {}) {
    return step?.title || '';
  }

  return {
    flowId: 'grok',
    getAllSteps,
    getModeStepDefinitions,
    getPlusPaymentStepTitle,
    normalizeTargetId,
    resolveStepTitle,
  };
});
