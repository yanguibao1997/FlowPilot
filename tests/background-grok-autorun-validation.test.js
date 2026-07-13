const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadCapabilities() {
  const flowIndex = fs.readFileSync('flows/index.js', 'utf8');
  const openaiIndex = fs.readFileSync('flows/openai/index.js', 'utf8');
  const kiroIndex = fs.readFileSync('flows/kiro/index.js', 'utf8');
  const grokIndex = fs.readFileSync('flows/grok/index.js', 'utf8');
  const flowRegistry = fs.readFileSync('core/flow-kernel/flow-registry.js', 'utf8');
  const caps = fs.readFileSync('core/flow-kernel/flow-capabilities.js', 'utf8');
  const globalScope = {};
  new Function('self', `
    ${openaiIndex}
    ${kiroIndex}
    ${grokIndex}
    ${flowIndex}
    ${flowRegistry}
    ${caps}
    return self;
  `)(globalScope);
  return globalScope.MultiPageFlowCapabilities;
}

function validate(options) {
  const api = loadCapabilities();
  const registry = api.createFlowCapabilityRegistry({});
  return registry.validateAutoRunStart(options);
}

test('grok cpa auto-run requires vpsUrl and vpsPassword', () => {
  const result = validate({
    activeFlowId: 'grok',
    targetId: 'cpa',
    state: {
      activeFlowId: 'grok',
      targetId: 'cpa',
      vpsUrl: '',
      vpsPassword: '',
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.map((e) => e.message).join('\n'), /CPA/);
});

test('grok sub2api auto-run requires sub2api credentials', () => {
  const result = validate({
    activeFlowId: 'grok',
    targetId: 'sub2api',
    state: {
      activeFlowId: 'grok',
      targetId: 'sub2api',
      sub2apiUrl: '',
      sub2apiEmail: '',
      sub2apiPassword: '',
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.map((e) => e.message).join('\n'), /SUB2API/);
});

test('grok cpa auto-run passes when credentials exist', () => {
  const result = validate({
    activeFlowId: 'grok',
    targetId: 'cpa',
    state: {
      activeFlowId: 'grok',
      targetId: 'cpa',
      vpsUrl: 'http://127.0.0.1:8317/management.html',
      vpsPassword: 'secret',
    },
  });
  assert.equal(result.ok, true);
});
