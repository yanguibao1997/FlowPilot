const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('sidepanel supports grok cpa/sub2api targets and mint status rows', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
  const js = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');
  assert.match(html, /row-grok-mint-status|display-grok-mint-status/);
  assert.match(html, /row-grok-upload-status|display-grok-upload-status/);
  assert.match(js, /rowGrokMintStatus|displayGrokMintStatus/);
  assert.match(js, /cpa/);
  assert.match(js, /sub2api/);
  assert.match(js, /webchat2api/);
});
