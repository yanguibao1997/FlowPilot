const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('flows/grok/content/device-confirm-page.js', 'utf8');

test('consent tick returns an exact allow target for a trusted browser click', async () => {
  class FakeElement {}
  class FakeInputElement extends FakeElement {}
  class FakeButtonElement extends FakeElement {}

  const allowButton = new FakeButtonElement();
  allowButton.innerText = '允许';
  allowButton.textContent = '允许';
  allowButton.disabled = false;
  allowButton.clickCount = 0;
  allowButton.getAttribute = (name) => (name === 'aria-label' ? '允许' : null);
  allowButton.getBoundingClientRect = () => ({ left: 20, top: 30, width: 120, height: 40 });
  allowButton.click = () => { allowButton.clickCount += 1; };
  allowButton.dispatchEvent = () => true;
  allowButton.focus = () => {};
  allowButton.scrollIntoView = () => {};

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
        hasAttribute(name) { return attributes.has(name); },
        setAttribute(name, value) { attributes.set(name, String(value)); },
      },
      querySelector() { return null; },
      querySelectorAll(selector) {
        return selector.includes('button') ? [allowButton] : [];
      },
    },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
      },
    },
  };
  context.window = context;
  context.window.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
  context.window.screenX = 0;
  context.window.screenY = 0;

  vm.createContext(context);
  vm.runInContext(source, context);

  const result = await context.window.__MULTIPAGE_GROK_DEVICE_CONFIRM_PAGE__.runDeviceConfirmTick({
    email: 'user@example.com',
    password: 'secret',
    verificationUriComplete: 'https://auth.x.ai/oauth2/device?user_code=ABCD',
  });

  assert.equal(allowButton.clickCount, 0);
  assert.equal(result.pageState, 'consent');
  assert.equal(result.trustedClickRequired, true);
  assert.equal(result.clickTarget, 'allow');
  assert.equal(result.clickLabel, '允许');
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.clickRect)),
    { left: 20, top: 30, width: 120, height: 40, centerX: 80, centerY: 50 }
  );
});
