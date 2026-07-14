const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('flows/grok/content/device-confirm-page.js', 'utf8');

async function runConsentTick(buttonSpecs, viewport = { width: 200, height: 100 }) {
  class FakeElement {}
  class FakeInputElement extends FakeElement {}
  class FakeButtonElement extends FakeElement {}

  const buttons = buttonSpecs.map((spec = {}) => {
    const button = new FakeButtonElement();
    button.innerText = spec.label || '允许';
    button.textContent = spec.label || '允许';
    button.disabled = Boolean(spec.disabled);
    button.clickCount = 0;
    button.dispatchCount = 0;
    button.scrollCalls = [];
    button.style = {
      display: spec.display || 'block',
      visibility: spec.visibility || 'visible',
      opacity: spec.opacity ?? '1',
    };
    let scrolled = false;
    const initialRect = spec.rect || { left: 20, top: 30, width: 120, height: 40 };
    const scrolledRect = spec.scrolledRect || initialRect;
    button.getAttribute = (name) => {
      if (name === 'aria-label') return button.innerText;
      if (name === 'aria-disabled') return spec.ariaDisabled ?? null;
      return null;
    };
    button.hasAttribute = (name) => name === 'disabled' && Boolean(spec.disabledAttribute);
    button.getBoundingClientRect = () => (scrolled ? scrolledRect : initialRect);
    button.click = () => { button.clickCount += 1; };
    button.dispatchEvent = () => {
      button.dispatchCount += 1;
      return true;
    };
    button.focus = () => {};
    button.scrollIntoView = (options) => {
      button.scrollCalls.push(options);
      scrolled = true;
    };
    return button;
  });

  const attributes = new Map();
  const sessionValues = new Map();
  const context = {
    console: { log() {}, warn() {}, error() {} },
    Element: FakeElement,
    HTMLInputElement: FakeInputElement,
    HTMLButtonElement: FakeButtonElement,
    Event: class {},
    MouseEvent: class {},
    PointerEvent: class {},
    URL,
    setTimeout,
    clearTimeout,
    location: {
      href: 'https://auth.x.ai/oauth2/device/consent',
      assign(url) { this.href = url; },
    },
    sessionStorage: {
      getItem(key) { return sessionValues.get(key) ?? null; },
      setItem(key, value) { sessionValues.set(key, String(value)); },
      removeItem(key) { sessionValues.delete(key); },
    },
    document: {
      body: { innerText: '授权 Grok 允许', textContent: '授权 Grok 允许' },
      documentElement: {
        clientWidth: viewport.width,
        clientHeight: viewport.height,
        hasAttribute(name) { return attributes.has(name); },
        setAttribute(name, value) { attributes.set(name, String(value)); },
      },
      querySelector() { return null; },
      querySelectorAll(selector) {
        return selector.includes('button') ? buttons : [];
      },
    },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
      },
    },
  };
  context.window = context;
  context.window.innerWidth = viewport.width;
  context.window.innerHeight = viewport.height;
  context.window.getComputedStyle = (element) => element.style;
  context.window.screenX = 0;
  context.window.screenY = 0;

  vm.createContext(context);
  vm.runInContext(source, context);

  const result = await context.window.__MULTIPAGE_GROK_DEVICE_CONFIRM_PAGE__.runDeviceConfirmTick({
    email: 'user@example.com',
    password: 'secret',
    verificationUriComplete: 'https://auth.x.ai/oauth2/device?user_code=ABCD',
  });
  return { buttons, result };
}

test('consent tick returns an exact allow target for a trusted browser click', async () => {
  const { buttons: [allowButton], result } = await runConsentTick([{}]);

  assert.equal(allowButton.clickCount, 0);
  assert.equal(allowButton.dispatchCount, 0);
  assert.equal(result.pageState, 'consent');
  assert.equal(result.trustedClickRequired, true);
  assert.equal(result.clickTarget, 'allow');
  assert.equal(result.clickLabel, '允许');
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.clickRect)),
    { left: 20, top: 30, width: 120, height: 40, centerX: 80, centerY: 50 }
  );
});

test('consent tick scrolls an offscreen allow target before returning viewport coordinates', async () => {
  const { buttons: [allowButton], result } = await runConsentTick([{
    rect: { left: 20, top: 500, width: 120, height: 40 },
    scrolledRect: { left: 20, top: 30, width: 120, height: 40 },
  }]);

  assert.deepEqual(
    JSON.parse(JSON.stringify(allowButton.scrollCalls)),
    [{ block: 'center', inline: 'center', behavior: 'instant' }]
  );
  assert.equal(result.trustedClickRequired, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.clickRect)),
    { left: 20, top: 30, width: 120, height: 40, centerX: 80, centerY: 50 }
  );
});

test('consent tick prefers a visible enabled allow target over an earlier hidden duplicate', async () => {
  const { buttons: [hiddenButton, visibleButton], result } = await runConsentTick([
    { display: 'none', rect: { left: 0, top: 0, width: 120, height: 40 } },
    { rect: { left: 40, top: 20, width: 80, height: 30 } },
  ]);

  assert.equal(hiddenButton.scrollCalls.length, 0);
  assert.equal(visibleButton.scrollCalls.length, 0);
  assert.equal(result.trustedClickRequired, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.clickRect)),
    { left: 40, top: 20, width: 80, height: 30, centerX: 80, centerY: 35 }
  );
});

test('consent tick skips an offscreen allow duplicate that remains offscreen after scrolling', async () => {
  const { buttons: [offscreenButton, viewportButton], result } = await runConsentTick([
    {
      rect: { left: 20, top: 500, width: 120, height: 40 },
      scrolledRect: { left: 20, top: 400, width: 120, height: 40 },
    },
    { rect: { left: 40, top: 20, width: 80, height: 30 } },
  ]);

  assert.equal(offscreenButton.clickCount, 0);
  assert.equal(viewportButton.clickCount, 0);
  assert.equal(offscreenButton.scrollCalls.length, 0);
  assert.equal(viewportButton.scrollCalls.length, 0);
  assert.equal(result.trustedClickRequired, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.clickRect)),
    { left: 40, top: 20, width: 80, height: 30, centerX: 80, centerY: 35 }
  );
});

test('consent tick keeps scrolling allow candidates until one reaches the viewport', async () => {
  const { buttons: [stuckButton, scrollableButton], result } = await runConsentTick([
    {
      rect: { left: 20, top: 500, width: 120, height: 40 },
      scrolledRect: { left: 20, top: 400, width: 120, height: 40 },
    },
    {
      rect: { left: 40, top: 600, width: 80, height: 30 },
      scrolledRect: { left: 40, top: 20, width: 80, height: 30 },
    },
  ]);

  assert.equal(stuckButton.scrollCalls.length, 1);
  assert.equal(scrollableButton.scrollCalls.length, 1);
  assert.equal(result.trustedClickRequired, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.clickRect)),
    { left: 40, top: 20, width: 80, height: 30, centerX: 80, centerY: 35 }
  );
});

test('consent tick rejects an allow target that remains outside the viewport after scrolling', async () => {
  const { buttons: [allowButton], result } = await runConsentTick([{
    rect: { left: 20, top: 500, width: 120, height: 40 },
    scrolledRect: { left: 20, top: 400, width: 120, height: 40 },
  }]);

  assert.equal(allowButton.scrollCalls.length, 1);
  assert.equal(result.trustedClickRequired, undefined);
  assert.equal(result.reason, 'allow_button_not_clickable');
});

test('consent tick reports not found when no exact allow label exists', async () => {
  const { buttons: [continueButton], result } = await runConsentTick([{ label: '继续' }]);

  assert.equal(continueButton.scrollCalls.length, 0);
  assert.equal(continueButton.clickCount, 0);
  assert.equal(continueButton.dispatchCount, 0);
  assert.equal(result.trustedClickRequired, undefined);
  assert.equal(result.reason, 'allow_button_not_found');
});

test('consent tick rejects a disabled allow target', async () => {
  const { buttons: [allowButton], result } = await runConsentTick([{ disabled: true }]);

  assert.equal(allowButton.scrollCalls.length, 0);
  assert.equal(result.trustedClickRequired, undefined);
  assert.equal(result.reason, 'allow_button_not_clickable');
});

test('consent tick skips a disabled-attribute allow duplicate for an enabled target', async () => {
  const { buttons: [disabledButton, enabledButton], result } = await runConsentTick([
    { disabledAttribute: true, rect: { left: 10, top: 10, width: 60, height: 30 } },
    { rect: { left: 90, top: 20, width: 80, height: 30 } },
  ]);

  assert.equal(disabledButton.scrollCalls.length, 0);
  assert.equal(enabledButton.clickCount, 0);
  assert.equal(result.trustedClickRequired, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.clickRect)),
    { left: 90, top: 20, width: 80, height: 30, centerX: 130, centerY: 35 }
  );
});

test('consent tick skips an aria-disabled allow duplicate for an enabled target', async () => {
  const { buttons: [ariaDisabledButton, enabledButton], result } = await runConsentTick([
    { ariaDisabled: 'true', rect: { left: 10, top: 10, width: 60, height: 30 } },
    { rect: { left: 100, top: 40, width: 70, height: 20 } },
  ]);

  assert.equal(ariaDisabledButton.scrollCalls.length, 0);
  assert.equal(enabledButton.clickCount, 0);
  assert.equal(result.trustedClickRequired, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.clickRect)),
    { left: 100, top: 40, width: 70, height: 20, centerX: 135, centerY: 50 }
  );
});
