const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadWorkflow() {
  const source = fs.readFileSync('flows/grok/workflow.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageGrokWorkflow;`)(globalScope);
}

function loadDefinition() {
  const source = fs.readFileSync('flows/grok/index.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageGrokFlowDefinition;`)(globalScope);
}

test('grok workflow ends with mint + cpa upload for cpa target', () => {
  const wf = loadWorkflow();
  const steps = wf.getModeStepDefinitions({ targetId: 'cpa' });
  const keys = steps.map((s) => s.key);
  assert.deepEqual(keys.slice(0, 5), [
    'grok-open-signup-page',
    'grok-submit-email',
    'grok-submit-verification-code',
    'grok-submit-profile',
    'grok-extract-sso-cookie',
  ]);
  assert.equal(keys.includes('grok-mint-oidc'), true);
  assert.equal(keys.includes('grok-upload-cpa'), true);
  assert.equal(keys.includes('grok-upload-sub2api'), false);
  assert.equal(keys.includes('grok-upload-sso-to-webchat2api'), false);
});

test('grok workflow ends with mint + sub2api upload for sub2api target', () => {
  const wf = loadWorkflow();
  const keys = wf.getModeStepDefinitions({ targetId: 'sub2api' }).map((s) => s.key);
  assert.equal(keys.includes('grok-mint-oidc'), true);
  assert.equal(keys.includes('grok-upload-sub2api'), true);
  assert.equal(keys.includes('grok-upload-cpa'), false);
});

test('grok definition supports cpa and sub2api targets', () => {
  const def = loadDefinition();
  assert.equal(def.targets.cpa.id, 'cpa');
  assert.equal(def.targets.sub2api.id, 'sub2api');
  assert.equal(def.capabilities.supportedTargetIds.includes('cpa'), true);
  assert.equal(def.capabilities.supportedTargetIds.includes('sub2api'), true);
});
