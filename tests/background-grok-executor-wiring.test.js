const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports grok mint and publishers and maps executors', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /flows\/grok\/background\/credential-schema\.js/);
  assert.match(source, /flows\/grok\/background\/oidc-minter\.js/);
  assert.match(source, /flows\/grok\/background\/publisher-cpa\.js/);
  assert.match(source, /flows\/grok\/background\/publisher-sub2api\.js/);
  assert.match(source, /'grok-mint-oidc'/);
  assert.match(source, /'grok-upload-cpa'/);
  assert.match(source, /'grok-upload-sub2api'/);
  assert.match(source, /createGrokOidcMinter/);
  assert.match(source, /createGrokCpaPublisher/);
  assert.match(source, /createGrokSub2ApiPublisher/);
});
