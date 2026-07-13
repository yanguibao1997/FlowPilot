const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('device confirm content script exposes command handler and exact allow click rule', () => {
  const source = fs.readFileSync('flows/grok/content/device-confirm-page.js', 'utf8');
  assert.match(source, /GROK_DEVICE_CONFIRM|grok-device-confirm/);
  assert.match(source, /允许/);
  assert.match(source, /cf-turnstile-response/);
  assert.match(source, /password/);
  assert.match(source, /exact|精确|textContent|innerText/);
});

test('manifest includes auth.x.ai device confirm content script', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const scripts = manifest.content_scripts || [];
  const matched = scripts.some((entry) => (
    Array.isArray(entry.matches)
    && entry.matches.some((m) => String(m).includes('auth.x.ai'))
    && Array.isArray(entry.js)
    && entry.js.some((file) => String(file).includes('device-confirm-page.js'))
  ));
  assert.equal(matched, true);
});

test('device confirm content script ignores non-device commands', () => {
  const source = fs.readFileSync('flows/grok/content/device-confirm-page.js', 'utf8');
  assert.match(source, /isDeviceConfirmCommand|GROK_DEVICE_CONFIRM_COMMANDS/);
  assert.match(source, /return false;/);
  assert.match(source, /Do not claim register-page commands|不要抢占|Do not claim/);
});

test('manifest keeps register page on accounts.x.ai and device confirm on auth/device paths', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const scripts = manifest.content_scripts || [];
  const registerEntry = scripts.find((entry) => (
    Array.isArray(entry.js)
    && entry.js.some((file) => String(file).includes('flows/grok/content/register-page.js'))
  ));
  const deviceEntry = scripts.find((entry) => (
    Array.isArray(entry.js)
    && entry.js.some((file) => String(file).includes('flows/grok/content/device-confirm-page.js'))
  ));
  assert.ok(registerEntry, 'register-page content_scripts entry missing');
  assert.ok(deviceEntry, 'device-confirm content_scripts entry missing');
  assert.deepEqual(registerEntry.matches, ['https://accounts.x.ai/*']);
  assert.ok(deviceEntry.matches.includes('https://auth.x.ai/*'));
  assert.ok(
    deviceEntry.matches.some((m) => /accounts\.x\.ai\/(oauth2\/)?device/.test(String(m))),
    'device-confirm should also cover accounts.x.ai device paths'
  );
  // Must not inject device-confirm for the whole accounts.x.ai origin (register page conflict).
  assert.equal(
    scripts.some((entry) => (
      Array.isArray(entry.matches)
      && entry.matches.includes('https://accounts.x.ai/*')
      && Array.isArray(entry.js)
      && entry.js.some((file) => String(file).includes('device-confirm-page.js'))
    )),
    false,
    'device-confirm must not be statically injected on all accounts.x.ai pages'
  );
});


test('device confirm automation includes continue/allow exact flow from reference', () => {
  const source = fs.readFileSync('flows/grok/content/device-confirm-page.js', 'utf8');
  assert.match(source, /继续/);
  assert.match(source, /全部允许/);
  assert.match(source, /使用邮箱登录/);
  assert.match(source, /允许/);
  assert.match(source, /设备已授权|device\/done/);
  assert.match(source, /clickExactLabels|findExactButtonByLabels/);
});

test('device confirm recovers from Invalid action by reopening verification uri', () => {
  const source = fs.readFileSync('flows/grok/content/device-confirm-page.js', 'utf8');
  assert.match(source, /Invalid action/);
  assert.match(source, /verificationUriComplete/);
  assert.match(source, /location\.assign|location\.href/);
  assert.match(source, /requestSubmit/);
  assert.match(source, /preferNative/);
});

test('device confirm content supports short tick commands for navigation-safe automation', () => {
  const source = fs.readFileSync('flows/grok/content/device-confirm-page.js', 'utf8');
  assert.match(source, /GROK_DEVICE_CONFIRM_TICK/);
  assert.match(source, /runDeviceConfirmTick/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /navigatingLikely|navigating/);
});

