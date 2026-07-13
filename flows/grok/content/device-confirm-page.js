console.log('[MultiPage:grok-device-confirm] Content script loaded on', location.href);

const GROK_DEVICE_CONFIRM_LISTENER_SENTINEL = 'data-multipage-grok-device-confirm-listener';
const GROK_CONTINUE_TEXT_PATTERN = /继续|continue|next|下一步/i;
const GROK_EMAIL_LOGIN_TEXT_PATTERN = /使用邮箱登录|email|邮箱登录|sign\s*in\s*with\s*email/i;
const GROK_LOGIN_TEXT_PATTERN = /^登录$|^log\s*in$|^sign\s*in$/i;
const GROK_ALLOW_EXACT_TEXT = '允许';

function isVisible(element) {
  if (!element || !(element instanceof Element)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getText(element) {
  if (!element) return '';
  return String(
    element.innerText
    || element.textContent
    || element.getAttribute?.('aria-label')
    || element.getAttribute?.('title')
    || element.value
    || ''
  ).replace(/\s+/g, ' ').trim();
}

function queryVisible(selector) {
  return Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
}

function findClickableByText(pattern, exact = false) {
  const selectors = 'button, a, [role="button"], input[type="button"], input[type="submit"]';
  return Array.from(document.querySelectorAll(selectors)).find((element) => {
    if (!isVisible(element)) return false;
    const text = element instanceof HTMLInputElement ? String(element.value || '').trim() : getText(element);
    if (exact) {
      return text === pattern;
    }
    return pattern.test(text);
  }) || null;
}

function findExactAllowButton() {
  // exact text only: 允许 ≠ 全部允许
  const selectors = 'button, a, [role="button"], input[type="button"], input[type="submit"]';
  return Array.from(document.querySelectorAll(selectors)).find((element) => {
    if (!isVisible(element)) return false;
    const text = element instanceof HTMLInputElement
      ? String(element.value || '').trim()
      : getText(element);
    return text === GROK_ALLOW_EXACT_TEXT;
  }) || null;
}

function simulateRealClick(element) {
  if (!element) throw new Error('无法点击空元素。');
  const rect = element.getBoundingClientRect();
  const clientX = Math.max(0, Math.floor(rect.left + Math.min(rect.width - 1, Math.max(1, rect.width / 2))));
  const clientY = Math.max(0, Math.floor(rect.top + Math.min(rect.height - 1, Math.max(1, rect.height / 2))));
  const eventOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    screenX: window.screenX + clientX,
    screenY: window.screenY + clientY,
  };
  element.dispatchEvent(new MouseEvent('mouseover', eventOptions));
  element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
  element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
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

async function waitFor(predicate, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 30000);
  const intervalMs = Math.max(100, Number(options.intervalMs) || 300);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

function injectCookieViaDocument(cookie = {}) {
  const name = String(cookie.name || '').trim();
  const value = String(cookie.value || '').trim();
  if (!name || !value) return false;
  // best effort for non-httpOnly cookies
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    `path=${cookie.path || '/'}`,
  ];
  if (cookie.secure) parts.push('Secure');
  document.cookie = parts.join('; ');
  return true;
}

function getPagePhase() {
  const url = String(location.href || '');
  if (/device\/done|设备已授权|device authorized/i.test(`${url} ${document.body?.innerText || ''}`)) {
    return 'done';
  }
  if (/oauth2\/device\/consent|consent/i.test(url) || findExactAllowButton()) {
    return 'consent';
  }
  if (queryVisible('input[type="password"]')) {
    return 'password';
  }
  if (queryVisible('input[type="email"], input[name="email" i], input[autocomplete="email"]')) {
    return 'email';
  }
  if (queryVisible('input[name="user_code"], input[name*="user_code" i]')) {
    return 'device_code';
  }
  return 'unknown';
}

async function waitTurnstileReady(timeoutMs = 45000) {
  const ready = await waitFor(() => {
    const input = queryVisible('input[name="cf-turnstile-response"]')
      || document.querySelector('input[name="cf-turnstile-response"]');
    const value = String(input?.value || '').trim();
    return value ? input : null;
  }, { timeoutMs, intervalMs: 400 });
  return Boolean(ready);
}

async function runDeviceConfirm(payload = {}) {
  const email = String(payload.email || '').trim();
  const password = String(payload.password || '');
  const userCode = String(payload.userCode || '').trim();
  const cookies = Array.isArray(payload.browserCookies) ? payload.browserCookies : [];
  if (!email || !password) {
    throw new Error('device confirm 缺少 email/password');
  }

  // best-effort document cookie inject (httpOnly still depends on chrome.cookies from background)
  cookies.forEach((cookie) => {
    try { injectCookieViaDocument(cookie); } catch (_error) { /* ignore */ }
  });
  if (payload.ssoCookie) {
    injectCookieViaDocument({ name: 'sso', value: payload.ssoCookie, path: '/', secure: true });
    injectCookieViaDocument({ name: 'sso-rw', value: payload.ssoCookie, path: '/', secure: true });
  }

  const deadline = Date.now() + Math.max(30000, Number(payload.timeoutMs) || 240000);
  let loginAttempts = 0;

  while (Date.now() < deadline) {
    const phase = getPagePhase();
    if (phase === 'done') {
      return { ok: true, pageState: 'done', url: location.href };
    }

    if (phase === 'consent') {
      const allowBtn = findExactAllowButton();
      if (allowBtn) {
        simulateRealClick(allowBtn);
        await sleep(1200);
        continue;
      }
    }

    if (phase === 'device_code') {
      const userCodeInput = queryVisible('input[name="user_code"], input[name*="user_code" i]');
      if (userCodeInput && userCode) {
        const current = String(userCodeInput.value || '');
        if (userCode.replace(/-/g, '') && !current.replace(/-/g, '').includes(userCode.replace(/-/g, ''))) {
          fillInput(userCodeInput, userCode);
        }
      }
      const continueBtn = findClickableByText(GROK_CONTINUE_TEXT_PATTERN);
      if (continueBtn) {
        simulateRealClick(continueBtn);
        await sleep(1000);
        continue;
      }
    }

    // optional cookie banner / email login entry
    const emailLoginEntry = findClickableByText(GROK_EMAIL_LOGIN_TEXT_PATTERN);
    if (emailLoginEntry && !queryVisible('input[type="password"]')) {
      simulateRealClick(emailLoginEntry);
      await sleep(800);
    }

    if (phase === 'email' || queryVisible('input[type="email"], input[name="email" i], input[autocomplete="email"]')) {
      const emailInput = queryVisible('input[type="email"], input[name="email" i], input[autocomplete="email"]');
      if (emailInput) {
        fillInput(emailInput, email);
        const nextBtn = findClickableByText(/下一步|next|continue|继续/i);
        if (nextBtn) {
          simulateRealClick(nextBtn);
          await sleep(1000);
        }
      }
    }

    if (phase === 'password' || queryVisible('input[type="password"]')) {
      if (loginAttempts >= 5) {
        throw new Error('device confirm 登录尝试次数过多');
      }
      loginAttempts += 1;
      await waitTurnstileReady(45000);
      const passwordInput = queryVisible('input[type="password"]');
      if (passwordInput) {
        fillInput(passwordInput, password);
      }
      const loginBtn = findClickableByText(GROK_LOGIN_TEXT_PATTERN, true)
        || findClickableByText(/登录|log\s*in|sign\s*in/i);
      if (loginBtn) {
        simulateRealClick(loginBtn);
        await sleep(1500);
        continue;
      }
    }

    const continueBtn = findClickableByText(GROK_CONTINUE_TEXT_PATTERN);
    if (continueBtn) {
      simulateRealClick(continueBtn);
      await sleep(1000);
      continue;
    }

    await sleep(700);
  }

  throw new Error('device confirm 超时');
}

async function executeDeviceConfirmCommand(command, payload = {}) {
  switch (command) {
    case 'GROK_DEVICE_CONFIRM':
    case 'grok-device-confirm':
    case 'grok-mint-oidc':
      return runDeviceConfirm(payload);
    case 'GET_PAGE_STATE':
      return { state: getPagePhase(), url: location.href };
    default:
      throw new Error(`未知 Grok device confirm 命令：${command}`);
  }
}

if (!document.documentElement.hasAttribute(GROK_DEVICE_CONFIRM_LISTENER_SENTINEL)) {
  document.documentElement.setAttribute(GROK_DEVICE_CONFIRM_LISTENER_SENTINEL, '1');
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'EXECUTE_NODE' && message?.type !== 'GET_PAGE_STATE') return false;
    const command = message.command || message.nodeId || message.type;
    executeDeviceConfirmCommand(command, message.payload || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
}

window.__MULTIPAGE_GROK_DEVICE_CONFIRM_PAGE__ = {
  executeDeviceConfirmCommand,
  getPagePhase,
  findExactAllowButton,
};
