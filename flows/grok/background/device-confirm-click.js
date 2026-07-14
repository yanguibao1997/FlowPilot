(function attachBackgroundGrokDeviceConfirmClick(root, factory) {
  root.MultiPageBackgroundGrokDeviceConfirmClick = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundGrokDeviceConfirmClickModule() {
  const trustedDeviceClickErrors = new WeakSet();

  function isTrustedDeviceClickError(error) {
    return Boolean(error && (typeof error === 'object' || typeof error === 'function')
      && trustedDeviceClickErrors.has(error));
  }

  function normalizeTrustedClickRequest(tick) {
    if (!tick?.trustedClickRequired) {
      return null;
    }
    if (tick.clickTarget !== 'allow') {
      throw new Error('Grok device 可信点击只允许 allow 目标。');
    }

    const centerX = tick.clickRect?.centerX;
    const centerY = tick.clickRect?.centerY;
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
      throw new Error('Grok device 可信点击需要有效的按钮中心坐标。');
    }

    return {
      target: 'allow',
      label: String(tick.clickLabel ?? '').trim() || 'allow',
      rect: { centerX, centerY },
    };
  }

  async function performTrustedDeviceClick({ tabId, tick, clickWithDebugger } = {}) {
    const request = normalizeTrustedClickRequest(tick);
    if (!request) {
      return tick;
    }
    if (!Number.isInteger(tabId)) {
      throw new Error('Grok device 可信点击需要有效的标签页 ID。');
    }
    if (typeof clickWithDebugger !== 'function') {
      throw new Error('Grok device 可信点击依赖不可用。');
    }

    try {
      await clickWithDebugger(tabId, request.rect, { visibleStep: 6 });
    } catch (error) {
      const trustedClickError = error && (typeof error === 'object' || typeof error === 'function')
        ? error
        : new Error(String(error || 'Grok device Debugger 可信点击失败。'));
      trustedDeviceClickErrors.add(trustedClickError);
      throw trustedClickError;
    }
    return {
      ...tick,
      clickLabel: request.label,
      clicked: request.target,
      trustedClickPerformed: true,
      navigatingLikely: true,
    };
  }

  return {
    isTrustedDeviceClickError,
    normalizeTrustedClickRequest,
    performTrustedDeviceClick,
  };
});
