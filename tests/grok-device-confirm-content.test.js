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
