console.log('[MultiPage:grok-device-confirm] Content script loaded on', location.href);

const GROK_DEVICE_CONFIRM_LISTENER_SENTINEL = 'data-multipage-grok-device-confirm-listener';
const GROK_ALLOW_EXACT_TEXT = '允许';
const DEVICE_CONFIRM_JOB_KEY = '__multipage_grok_device_confirm_job__';

const GROK_DEVICE_CONFIRM_COMMANDS = new Set([
  'GROK_DEVICE_CONFIRM',
  'GROK_DEVICE_CONFIRM_TICK',
  'grok-device-confirm',
  'grok-device-confirm-tick',
  'grok-mint-oidc',
  'GET_PAGE_STATE',
]);

function getSerializableRect(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return null;
  let rect;
  try {
    rect = element.getBoundingClientRect();
  } catch (_error) {
    return null;
  }
  const left = Number(rect?.left);
  const top = Number(rect?.top);
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return {
    left,
    top,
    width,
    height,
    centerX: left + (width / 2),
    centerY: top + (height / 2),
  };
}

function isRectCenterInViewport(rect) {
  if (!rect) return false;
  const viewportWidth = Number(window.innerWidth || document.documentElement?.clientWidth || 0);
  const viewportHeight = Number(window.innerHeight || document.documentElement?.clientHeight || 0);
  return (
    Number.isFinite(viewportWidth)
    && Number.isFinite(viewportHeight)
    && viewportWidth > 0
    && viewportHeight > 0
    && rect.centerX >= 0
    && rect.centerX < viewportWidth
    && rect.centerY >= 0
    && rect.centerY < viewportHeight
  );
}

function scrollIntoViewInstant(element) {
  try {
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  } catch (_error) {
    try { element.scrollIntoView(); } catch (_error2) { /* ignore */ }
  }
}

function isVisible(element) {
  if (!element || !(element instanceof Element)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  return Boolean(getSerializableRect(element));
}

function isEnabled(element) {
  if (!element || !(element instanceof Element)) return false;
  if (element.disabled === true || element.hasAttribute?.('disabled')) return false;
  return String(element.getAttribute?.('aria-disabled') || '').toLowerCase() !== 'true';
}

function normalizeVisibleText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getText(element) {
  if (!element) return '';
  return normalizeVisibleText(
    element.innerText
    || element.textContent
    || element.getAttribute?.('aria-label')
    || element.getAttribute?.('title')
    || element.value
    || ''
  );
}

function getClickableLabel(element) {
  if (!element) return '';
  if (element instanceof HTMLInputElement) {
    return normalizeVisibleText(element.value || element.getAttribute('aria-label') || '');
  }
  return normalizeVisibleText(
    element.getAttribute?.('aria-label')
    || element.innerText
    || element.textContent
    || element.getAttribute?.('title')
    || ''
  );
}

function queryVisible(selector) {
  return Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
}

function listClickableCandidates() {
  return Array.from(document.querySelectorAll(
    'button, a, [role="button"], input[type="button"], input[type="submit"], [data-testid*="submit" i], [data-testid*="continue" i], [data-testid*="allow" i]'
  ));
}

function findExactButtonByLabels(labels = [], options = {}) {
  const wanted = (Array.isArray(labels) ? labels : [labels])
    .map((label) => normalizeVisibleText(label))
    .filter(Boolean);
  if (!wanted.length) return null;
  const allowPartial = Boolean(options.allowPartial);
  const requireVisible = options.requireVisible !== false;
  const requireEnabled = Boolean(options.requireEnabled);
  const candidates = listClickableCandidates();
  for (const element of candidates) {
    if (requireVisible && !isVisible(element)) continue;
    if (requireEnabled && !isEnabled(element)) continue;
    const text = getClickableLabel(element);
    if (!text) continue;
    if (wanted.includes(text)) return element;
  }
  if (!allowPartial) return null;
  for (const element of candidates) {
    if (requireVisible && !isVisible(element)) continue;
    if (requireEnabled && !isEnabled(element)) continue;
    const text = getClickableLabel(element);
    if (!text) continue;
    if (wanted.some((label) => text === label || text.includes(label))) return element;
  }
  return null;
}

function findExactAllowButton(options = {}) {
  // exact text only: 允许 ≠ 全部允许
  return findExactButtonByLabels(
    [GROK_ALLOW_EXACT_TEXT, 'Allow', 'Authorize', 'Approve'],
    options
  );
}

function listExactAllowButtons() {
  const labels = new Set([
    GROK_ALLOW_EXACT_TEXT,
    'Allow',
    'Authorize',
    'Approve',
  ].map((label) => normalizeVisibleText(label)));
  return listClickableCandidates().filter((element) => labels.has(getClickableLabel(element)));
}

function collectVisibleButtonLabels(limit = 16) {
  const labels = [];
  for (const element of listClickableCandidates()) {
    if (!isVisible(element)) continue;
    const text = getClickableLabel(element);
    if (!text || labels.includes(text)) continue;
    labels.push(text);
    if (labels.length >= limit) break;
  }
  return labels;
}

function simulateRealClick(element, options = {}) {
  if (!element) throw new Error('无法点击空元素。');
  try {
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  } catch (_error) {
    try { element.scrollIntoView(); } catch (_error2) { /* ignore */ }
  }

  const rect = element.getBoundingClientRect();
  const clientX = Math.max(0, Math.floor(rect.left + Math.min(rect.width - 1, Math.max(1, rect.width / 2))));
  const clientY = Math.max(0, Math.floor(rect.top + Math.min(rect.height - 1, Math.max(1, rect.height / 2))));
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX,
    clientY,
    screenX: window.screenX + clientX,
    screenY: window.screenY + clientY,
    button: 0,
    buttons: 1,
  };

  try { element.focus?.({ preventScroll: true }); } catch (_error) { /* ignore */ }

  const isFormButton = (
    element instanceof HTMLButtonElement
    || element instanceof HTMLInputElement
    || element.getAttribute?.('role') === 'button'
  );
  if (options.preferNative !== false && isFormButton && typeof element.click === 'function') {
    try {
      if (typeof PointerEvent === 'function') {
        element.dispatchEvent(new PointerEvent('pointerdown', { ...eventOptions, pointerType: 'mouse' }));
      }
    } catch (_error) { /* ignore */ }
    element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    try {
      if (typeof PointerEvent === 'function') {
        element.dispatchEvent(new PointerEvent('pointerup', { ...eventOptions, pointerType: 'mouse', buttons: 0 }));
      }
    } catch (_error) { /* ignore */ }
    element.dispatchEvent(new MouseEvent('mouseup', { ...eventOptions, buttons: 0 }));
    element.click();
    return;
  }

  element.dispatchEvent(new MouseEvent('mouseover', eventOptions));
  element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
  element.dispatchEvent(new MouseEvent('mouseup', { ...eventOptions, buttons: 0 }));
  if (typeof element.click === 'function') {
    element.click();
    return;
  }
  element.dispatchEvent(new MouseEvent('click', eventOptions));
}

function fillInput(element, value) {
  if (!element) return;
  element.focus();
  element.value = '';
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.value = String(value ?? '');
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function injectCookieViaDocument(cookie = {}) {
  const name = String(cookie.name || '').trim();
  const value = String(cookie.value || '').trim();
  if (!name || !value) return false;
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    `path=${cookie.path || '/'}`,
  ];
  if (cookie.secure) parts.push('Secure');
  document.cookie = parts.join('; ');
  return true;
}

function getPageBodyText() {
  return normalizeVisibleText(document.body?.innerText || document.body?.textContent || '');
}

function getPagePhase() {
  const url = String(location.href || '');
  const bodyText = getPageBodyText();
  if (/Invalid action/i.test(bodyText) || (/\/(?:oauth2\/)?device\/approve(?:[/?#]|$)/i.test(url) && /invalid/i.test(bodyText))) {
    return 'invalid_action';
  }
  if (
    /\/(?:oauth2\/)?device\/done(?:[/?#]|$)/i.test(url)
    || /设备已授权|device\s*(?:authorization\s*)?(?:complete|completed|successful|succeeded)/i.test(bodyText)
  ) {
    return 'done';
  }
  if (
    findExactAllowButton()
    || /\/(?:oauth2\/)?device\/consent(?:[/?#]|$)/i.test(url)
    || /授权\s*Grok|Authorize\s*Grok/i.test(bodyText)
  ) {
    return 'consent';
  }
  if (queryVisible('input[type="password"]')) return 'password';
  if (
    queryVisible('input[type="email"], input[name="email" i], input[autocomplete="email"]')
    && !queryVisible('input[type="password"]')
  ) {
    return 'email';
  }
  if (queryVisible('input[name="user_code"], input[name*="user_code" i], input[id*="user_code" i]')) {
    return 'device_code';
  }
  if (/\/(?:oauth2\/)?device(?:[/?#]|$)/i.test(url) || /user_code=/i.test(url)) {
    return 'device_code';
  }
  if (/正在重定向|redirecting/i.test(bodyText) || (/\/account(?:[/?#]|$)/i.test(url) && !/sign-in|sign-up|login/i.test(url))) {
    return 'redirect';
  }
  if (/全部允许|隐私偏好/i.test(bodyText)) return 'cookie_banner';
  if (/使用邮箱登录|continue with email|sign in with email/i.test(bodyText)) return 'email_chooser';
  return 'unknown';
}

async function waitTurnstileReady(timeoutMs = 45000) {
  const deadline = Date.now() + Math.max(3000, Number(timeoutMs) || 45000);
  let clicked = false;
  while (Date.now() < deadline) {
    const input = document.querySelector('input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]');
    const value = String(input?.value || '').trim();
    if (value.length > 20) return true;
    if (!clicked) {
      try {
        const nodes = Array.from(document.querySelectorAll('div,span,iframe,button')).filter((node) => {
          const txt = `${node.className || ''} ${node.id || ''} ${node.getAttribute?.('src') || ''}`;
          return String(txt).toLowerCase().includes('turnstile');
        });
        if (nodes[0] && typeof nodes[0].click === 'function') {
          nodes[0].click();
          clicked = true;
        }
      } catch (_error) { /* ignore */ }
    }
    await sleep(400);
  }
  return false;
}

async function clickExactLabels(labels, options = {}) {
  const button = findExactButtonByLabels(labels, { allowPartial: Boolean(options.allowPartial) });
  if (!button) return null;
  const label = getClickableLabel(button);
  console.log('[MultiPage:grok-device-confirm] click exact', label, options.real === false ? 'JS' : 'REAL');
  if (options.real === false) {
    try { button.focus?.({ preventScroll: true }); } catch (_error) { /* ignore */ }
    if (typeof button.click === 'function') button.click();
    else simulateRealClick(button, { preferNative: true });
  } else {
    simulateRealClick(button, { preferNative: true });
  }
  return label;
}

function readDeviceConfirmJob() {
  try {
    const raw = sessionStorage.getItem(DEVICE_CONFIRM_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function writeDeviceConfirmJob(job) {
  try {
    if (!job) {
      sessionStorage.removeItem(DEVICE_CONFIRM_JOB_KEY);
      return;
    }
    sessionStorage.setItem(DEVICE_CONFIRM_JOB_KEY, JSON.stringify(job));
  } catch (_error) { /* ignore */ }
}

function mergeDeviceConfirmJob(payload = {}) {
  const existing = readDeviceConfirmJob() || {};
  const next = {
    email: String(payload.email || existing.email || '').trim(),
    password: String(payload.password || existing.password || ''),
    userCode: String(payload.userCode || existing.userCode || '').trim(),
    verificationUriComplete: String(
      payload.verificationUriComplete
      || payload.verification_uri_complete
      || payload.verificationUri
      || existing.verificationUriComplete
      || ''
    ).trim(),
    ssoCookie: String(payload.ssoCookie || existing.ssoCookie || ''),
    browserCookies: Array.isArray(payload.browserCookies)
      ? payload.browserCookies
      : (Array.isArray(existing.browserCookies) ? existing.browserCookies : []),
    timeoutMs: Math.max(30000, Number(payload.timeoutMs || existing.timeoutMs) || 240000),
    startedAt: Number(existing.startedAt) || Date.now(),
    allowClicks: Number(existing.allowClicks) || 0,
    continueClicks: Number(existing.continueClicks) || 0,
    loginAttempts: Number(existing.loginAttempts) || 0,
    lastPhase: String(existing.lastPhase || ''),
    status: 'running',
  };
  if (!next.userCode && next.verificationUriComplete) {
    try {
      next.userCode = String(new URL(next.verificationUriComplete).searchParams.get('user_code') || '').trim();
    } catch (_error) { /* ignore */ }
  }
  if (!next.userCode) {
    try {
      next.userCode = String(new URL(location.href).searchParams.get('user_code') || '').trim();
    } catch (_error) { /* ignore */ }
  }
  writeDeviceConfirmJob(next);
  return next;
}

function buildTickResult(job, pageState, extra = {}) {
  return {
    ok: true,
    pageState,
    url: location.href,
    allowClicks: Number(job?.allowClicks) || 0,
    continueClicks: Number(job?.continueClicks) || 0,
    loginAttempts: Number(job?.loginAttempts) || 0,
    done: pageState === 'done',
    ...extra,
  };
}

/**
 * One short automation tick. Aligned with cpa_xai/browser_confirm.py approve_device_code.
 */
async function runDeviceConfirmTick(payload = {}) {
  const job = mergeDeviceConfirmJob(payload);
  if (!job.email || !job.password) {
    throw new Error('device confirm 缺少 email/password');
  }
  if (Date.now() - Number(job.startedAt || Date.now()) > Number(job.timeoutMs || 240000)) {
    writeDeviceConfirmJob(null);
    throw new Error(`device confirm 超时（lastPhase=${job.lastPhase || 'unknown'}, url=${location.href})`);
  }

  (job.browserCookies || []).forEach((cookie) => {
    try { injectCookieViaDocument(cookie); } catch (_error) { /* ignore */ }
  });
  if (job.ssoCookie) {
    injectCookieViaDocument({ name: 'sso', value: job.ssoCookie, path: '/', secure: true });
    injectCookieViaDocument({ name: 'sso-rw', value: job.ssoCookie, path: '/', secure: true });
  }

  const url = String(location.href || '');
  const text = getPageBodyText();
  const buttons = collectVisibleButtonLabels(16);
  const phase = getPagePhase();
  job.lastPhase = phase;
  console.log('[MultiPage:grok-device-confirm] tick', { phase, url, buttons });

  // 1) done
  if (phase === 'done' || /device\/done/i.test(url) || /设备已授权|device authorized/i.test(text)) {
    job.status = 'done';
    writeDeviceConfirmJob(job);
    return buildTickResult(job, 'done', { buttons });
  }

  // 2) Invalid action → reopen
  if (phase === 'invalid_action' || /Invalid action/i.test(text)) {
    job.allowClicks = Number(job.allowClicks || 0) + 1;
    writeDeviceConfirmJob(job);
    if (job.allowClicks >= 8) {
      writeDeviceConfirmJob(null);
      throw new Error(`device confirm 多次 Invalid action（allowClicks=${job.allowClicks}）url=${url}`);
    }
    const reopenUrl = job.verificationUriComplete
      || (job.userCode ? `https://accounts.x.ai/oauth2/device?user_code=${encodeURIComponent(job.userCode)}` : '');
    if (!reopenUrl) throw new Error('device confirm 遇到 Invalid action，且缺少 verificationUriComplete 无法重开。');
    setTimeout(() => {
      try { location.assign(reopenUrl); } catch (_error) { location.href = reopenUrl; }
    }, 30);
    return buildTickResult(job, 'invalid_action', { navigating: true, reopenUrl, buttons });
  }

  // 3) consent → delegate exact 允许 to a browser-level trusted click
  if (
    phase === 'consent'
    || /\/(?:oauth2\/)?device\/consent/i.test(url)
    || /授权\s*Grok|Authorize\s*Grok/i.test(text)
    || findExactAllowButton()
  ) {
    const exactAllowButtons = listExactAllowButtons();
    if (!exactAllowButtons.length) {
      writeDeviceConfirmJob(job);
      return buildTickResult(job, 'consent', { waiting: true, buttons, reason: 'allow_button_not_found' });
    }

    const clickableAllowButtons = exactAllowButtons.filter((element) => (
      isVisible(element) && isEnabled(element)
    ));
    let clickTarget = null;
    for (const element of clickableAllowButtons) {
      const rect = getSerializableRect(element);
      if (isRectCenterInViewport(rect)) {
        clickTarget = { element, rect };
        break;
      }
    }

    if (!clickTarget) {
      for (const element of clickableAllowButtons) {
        scrollIntoViewInstant(element);
        const rect = getSerializableRect(element);
        if (isRectCenterInViewport(rect)) {
          clickTarget = { element, rect };
          break;
        }
      }
    }

    if (!clickTarget) {
      writeDeviceConfirmJob(job);
      return buildTickResult(job, 'consent', { waiting: true, buttons, reason: 'allow_button_not_clickable' });
    }

    writeDeviceConfirmJob(job);
    return buildTickResult(job, 'consent', {
      trustedClickRequired: true,
      clickTarget: 'allow',
      clickLabel: getClickableLabel(clickTarget.element),
      clickRect: clickTarget.rect,
      buttons,
    });
  }

  // 4) device code page → fill user_code + click 继续 (reference uses by_js for continue)
  const userCodeInput = queryVisible('input[name="user_code"], input[name*="user_code" i], input[id*="user_code" i]');
  const onDeviceUrl = /\/(?:oauth2\/)?device(?:[/?#]|$)/i.test(url) || /user_code=/i.test(url);
  if ((userCodeInput && !/consent/i.test(url)) || (onDeviceUrl && !/consent|done|approve/i.test(url))) {
    if (userCodeInput && job.userCode) {
      const current = String(userCodeInput.value || '');
      if (job.userCode.replace(/-/g, '') && !current.replace(/-/g, '').includes(job.userCode.replace(/-/g, ''))) {
        fillInput(userCodeInput, job.userCode);
        console.log('[MultiPage:grok-device-confirm] filled user_code');
      }
    }

    let clicked = await clickExactLabels(['继续', 'Continue'], { real: false });
    if (!clicked) {
      clicked = await clickExactLabels(['继续', 'Continue', '下一步', 'Next', 'Confirm', '确认'], {
        real: false,
        allowPartial: true,
      });
    }
    if (clicked) {
      job.continueClicks = Number(job.continueClicks || 0) + 1;
      writeDeviceConfirmJob(job);
      return buildTickResult(job, 'device_code', {
        clicked: 'continue',
        continueLabel: clicked,
        navigatingLikely: true,
        buttons,
      });
    }

    const submitBtn = queryVisible('button[type="submit"], input[type="submit"]');
    if (submitBtn) {
      job.continueClicks = Number(job.continueClicks || 0) + 1;
      writeDeviceConfirmJob(job);
      if (typeof submitBtn.click === 'function') submitBtn.click();
      else simulateRealClick(submitBtn, { preferNative: true });
      return buildTickResult(job, 'device_code', { clicked: 'submit', navigatingLikely: true, buttons });
    }

    writeDeviceConfirmJob(job);
    return buildTickResult(job, 'device_code', {
      waiting: true,
      buttons,
      reason: 'continue_button_not_found',
      hasUserCodeInput: Boolean(userCodeInput),
    });
  }

  // 5) account redirect
  if (/正在重定向|redirecting/i.test(text) || (/\/account(?:[/?#]|$)/i.test(url) && !/sign-in|sign-up|login/i.test(url))) {
    const clicked = await clickExactLabels(['继续', 'Continue'], { real: false });
    if (clicked) {
      job.continueClicks = Number(job.continueClicks || 0) + 1;
      writeDeviceConfirmJob(job);
      return buildTickResult(job, 'redirect', { clicked: 'continue', continueLabel: clicked, navigatingLikely: true, buttons });
    }
  }

  // 6) cookie banner
  if (/全部允许|隐私偏好/i.test(text)) {
    const clicked = await clickExactLabels(['全部允许', '全部拒绝', 'Allow all', 'Reject all'], { real: false });
    writeDeviceConfirmJob(job);
    return buildTickResult(job, 'cookie_banner', { clicked: clicked || '', buttons });
  }

  // 7) email chooser
  if (/使用邮箱登录|Continue with email|Sign in with email/i.test(text)) {
    const clicked = await clickExactLabels(['使用邮箱登录', 'Continue with email', 'Sign in with email'], { real: false });
    if (clicked) {
      writeDeviceConfirmJob(job);
      return buildTickResult(job, 'email_chooser', { clicked, navigatingLikely: true, buttons });
    }
  }

  // 8) email only
  if (
    queryVisible('input[type="email"], input[name="email" i], input[autocomplete="email"]')
    && !queryVisible('input[type="password"]')
  ) {
    const emailInput = queryVisible('input[type="email"], input[name="email" i], input[autocomplete="email"]');
    if (emailInput) fillInput(emailInput, job.email);
    const clicked = await clickExactLabels(['下一步', 'Next', 'Continue', '继续'], { real: false });
    writeDeviceConfirmJob(job);
    return buildTickResult(job, 'email', { clicked: clicked || '', navigatingLikely: Boolean(clicked), buttons });
  }

  // 9) password
  if (queryVisible('input[type="password"]')) {
    if (Number(job.loginAttempts || 0) >= 5) {
      writeDeviceConfirmJob(null);
      throw new Error('device confirm 登录尝试次数过多');
    }
    job.loginAttempts = Number(job.loginAttempts || 0) + 1;
    writeDeviceConfirmJob(job);
    const emailInput = queryVisible('input[type="email"], input[name="email" i], input[autocomplete="email"]');
    if (emailInput) fillInput(emailInput, job.email);
    await waitTurnstileReady(20000);
    const passwordInput = queryVisible('input[type="password"]');
    if (passwordInput) fillInput(passwordInput, job.password);
    await waitTurnstileReady(8000);
    let loginClicked = await clickExactLabels(['登录', 'Sign in', 'Log in'], { real: true });
    if (!loginClicked) {
      const submitBtn = queryVisible('button[type="submit"], button[data-testid="sign-in-submit"]');
      if (submitBtn) {
        simulateRealClick(submitBtn, { preferNative: true });
        loginClicked = 'submit';
      }
    }
    writeDeviceConfirmJob(job);
    return buildTickResult(job, 'password', { clicked: loginClicked || '', navigatingLikely: true, buttons });
  }

  // generic continue fallback
  const genericContinue = await clickExactLabels(['继续', 'Continue'], { real: false, allowPartial: true });
  if (genericContinue) {
    job.continueClicks = Number(job.continueClicks || 0) + 1;
    writeDeviceConfirmJob(job);
    return buildTickResult(job, phase || 'unknown', {
      clicked: 'continue',
      continueLabel: genericContinue,
      navigatingLikely: true,
      buttons,
    });
  }

  writeDeviceConfirmJob(job);
  return buildTickResult(job, phase || 'unknown', {
    waiting: true,
    buttons,
    reason: 'no_actionable_control',
  });
}

function isDeviceConfirmCommand(command = '') {
  return GROK_DEVICE_CONFIRM_COMMANDS.has(String(command || '').trim());
}

async function executeDeviceConfirmCommand(command, payload = {}) {
  switch (command) {
    case 'GROK_DEVICE_CONFIRM_TICK':
    case 'grok-device-confirm-tick':
    case 'GROK_DEVICE_CONFIRM':
    case 'grok-device-confirm':
    case 'grok-mint-oidc':
      return runDeviceConfirmTick(payload);
    case 'GET_PAGE_STATE':
      return {
        state: getPagePhase(),
        url: location.href,
        job: readDeviceConfirmJob(),
        buttons: collectVisibleButtonLabels(16),
      };
    default:
      throw new Error(`未知 Grok device confirm 命令：${command}`);
  }
}

if (!document.documentElement.hasAttribute(GROK_DEVICE_CONFIRM_LISTENER_SENTINEL)) {
  document.documentElement.setAttribute(GROK_DEVICE_CONFIRM_LISTENER_SENTINEL, '1');
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'EXECUTE_NODE' && message?.type !== 'GET_PAGE_STATE') return false;
    const command = message.command || message.nodeId || message.type;
    // Do not claim register-page commands when both content scripts share accounts.x.ai.
    if (!isDeviceConfirmCommand(command)) {
      return false;
    }
    executeDeviceConfirmCommand(command, message.payload || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
}

window.__MULTIPAGE_GROK_DEVICE_CONFIRM_PAGE__ = {
  executeDeviceConfirmCommand,
  runDeviceConfirmTick,
  getPagePhase,
  findExactAllowButton,
  getSerializableRect,
  collectVisibleButtonLabels,
};
