(function attachMultiPageGrokFlowDefinition(root, factory) {
  root.MultiPageGrokFlowDefinition = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createMultiPageGrokFlowDefinition() {
  function freezeDeep(entry) {
    if (!entry || typeof entry !== 'object' || Object.isFrozen(entry)) {
      return entry;
    }
    Object.getOwnPropertyNames(entry).forEach((key) => {
      freezeDeep(entry[key]);
    });
    return Object.freeze(entry);
  }

  const VALUE = freezeDeep({
    id: 'grok',
    label: 'Grok / xAI',
    services: [
      'account',
      'email',
      'proxy',
    ],
    capabilities: {
      supportsEmailSignup: true,
      supportsPhoneSignup: false,
      supportsPhoneVerificationSettings: false,
      supportsPlusMode: false,
      supportsContributionMode: false,
      supportsAccountContribution: false,
      supportsOpenAiOAuthContribution: false,
      contributionAdapterIds: [],
      supportedTargetIds: ['cpa', 'sub2api', 'webchat2api'],
      supportsLuckmail: false,
      canSwitchFlow: true,
      stepDefinitionMode: 'grok',
      targetSelectorLabel: '来源',
    },
    baseGroups: ['grok-runtime-status', 'shared-auto-run'],
    targets: {
      cpa: {
        id: 'cpa',
        label: 'CPA 面板',
        groups: [
          'grok-target-cpa',
        ],
        defaultState: {
          vpsUrl: '',
          vpsPassword: '',
        },
      },
      sub2api: {
        id: 'sub2api',
        label: 'SUB2API',
        groups: [
          'grok-target-sub2api',
        ],
        defaultState: {
          sub2apiUrl: '',
          sub2apiEmail: '',
          sub2apiPassword: '',
          sub2apiGroupName: 'grok',
          sub2apiAccountPriority: 1,
        },
      },
      webchat2api: {
        id: 'webchat2api',
        label: 'webchat2api',
        groups: [
          'grok-target-webchat2api',
        ],
        defaultState: {
          baseUrl: '',
          apiKey: '',
        },
      },
    },
    publicationTargets: {},
    runtimeSources: {
      'grok-register-page': {
        flowId: 'grok',
        kind: 'flow-page',
        label: 'Grok 注册页',
        readyPolicy: 'top-frame-only',
        family: 'grok-register-page-family',
        driverId: 'flows/grok/content/register-page',
        cleanupScopes: [],
        detectionMatchers: [
          {
            hostnames: [
              'accounts.x.ai',
            ],
            pathPrefixes: [
              '/sign-up',
              '/sign-in',
              '/login',
              '/verify',
              '/profile',
              '/account',
            ],
            matchMode: 'all',
          },
          {
            hostnames: [
              'x.ai',
              'grok.com',
            ],
            matchMode: 'any',
          },
        ],
        familyMatchers: [
          {
            hostnames: [
              'accounts.x.ai',
              'x.ai',
              'grok.com',
            ],
            hostnameEndsWith: [
              '.x.ai',
              '.grok.com',
            ],
            matchMode: 'any',
          },
        ],
      },
      'grok-device-confirm': {
        flowId: 'grok',
        kind: 'flow-page',
        label: 'Grok Device 确认页',
        readyPolicy: 'top-frame-only',
        family: 'grok-device-confirm-family',
        driverId: 'flows/grok/content/device-confirm-page',
        cleanupScopes: [],
        detectionMatchers: [
          {
            hostnames: [
              'auth.x.ai',
            ],
            matchMode: 'any',
          },
          {
            hostnames: [
              'accounts.x.ai',
            ],
            pathPrefixes: [
              '/oauth2/device',
              '/device',
            ],
            matchMode: 'all',
          },
        ],
        familyMatchers: [
          {
            hostnames: [
              'auth.x.ai',
            ],
            matchMode: 'any',
          },
          {
            hostnames: [
              'accounts.x.ai',
            ],
            pathPrefixes: [
              '/oauth2/device',
              '/device',
            ],
            matchMode: 'all',
          },
        ],
      },
    },
    driverDefinitions: {
      'flows/grok/content/register-page': {
        sourceId: 'grok-register-page',
        commands: [
          'grok-open-signup-page',
          'grok-submit-email',
          'grok-submit-verification-code',
          'grok-submit-profile',
          'grok-extract-sso-cookie',
        ],
      },
      'flows/grok/background/register-runner': {
        sourceId: 'grok-register-page',
        commands: [
          'grok-open-signup-page',
          'grok-submit-email',
          'grok-submit-verification-code',
          'grok-submit-profile',
          'grok-extract-sso-cookie',
        ],
      },
      'flows/grok/content/device-confirm-page': {
        sourceId: 'grok-device-confirm',
        commands: [
          'GROK_DEVICE_CONFIRM',
          'GROK_DEVICE_CONFIRM_TICK',
          'grok-device-confirm',
          'grok-device-confirm-tick',
        ],
      },
      'flows/grok/background/oidc-minter': {
        sourceId: 'grok-device-confirm',
        commands: [
          'grok-mint-oidc',
        ],
      },
      'flows/grok/background/publisher-cpa': {
        sourceId: 'grok-cpa',
        commands: [
          'grok-upload-cpa',
        ],
      },
      'flows/grok/background/publisher-sub2api': {
        sourceId: 'grok-sub2api',
        commands: [
          'grok-upload-sub2api',
        ],
      },
      'flows/grok/background/publisher-webchat2api': {
        sourceId: 'grok-webchat2api',
        commands: [
          'grok-upload-sso-to-webchat2api',
        ],
      },
    },
    defaultTargetId: 'cpa',
    settingsDefaults: {
      targets: {
        cpa: {
          vpsUrl: '',
          vpsPassword: '',
        },
        sub2api: {
          sub2apiUrl: '',
          sub2apiEmail: '',
          sub2apiPassword: '',
          sub2apiGroupName: 'grok',
          sub2apiAccountPriority: 1,
        },
        webchat2api: {
          baseUrl: '',
          apiKey: '',
        },
      },
      autoRun: {
        stepExecutionRange: {
          enabled: false,
          fromStep: 1,
          toStep: 7,
        },
      },
    },
    settingsGroups: {
      'grok-target-cpa': {
        id: 'grok-target-cpa',
        label: 'CPA',
        rowIds: [
          'row-vps-url',
          'row-vps-password',
          'row-grok-sso-settings',
        ],
      },
      'grok-target-sub2api': {
        id: 'grok-target-sub2api',
        label: 'SUB2API',
        rowIds: [
          'row-sub2api-url',
          'row-sub2api-email',
          'row-sub2api-password',
          'row-sub2api-group',
          'row-sub2api-account-priority',
          'row-grok-sso-settings',
        ],
      },
      'grok-target-webchat2api': {
        id: 'grok-target-webchat2api',
        label: 'webchat2api',
        rowIds: [
          'row-grok-webchat2api-url',
          'row-grok-webchat2api-key',
          'row-grok-sso-settings',
        ],
      },
      'grok-runtime-status': {
        id: 'grok-runtime-status',
        label: 'Grok 运行态',
        rowIds: [
          'row-grok-register-status',
          'row-grok-sso-status',
          'row-grok-mint-status',
          'row-grok-upload-status',
          'row-grok-webchat2api-upload-status',
        ],
      },
    },
    sourceAliases: {},
  });

  return VALUE;
});
