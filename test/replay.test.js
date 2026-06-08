// Basic tests for replay-engine
const { extractSession, compareResults, generateReport } = require('../src/replay-engine');
const assert = require('assert');

// Test: extractSession normalizes different formats
const rawSession = {
  session: {
    id: 'test-001',
    title: 'Fix auth bug',
    model: 'gpt-5.2-codex',
    messages: [
      { role: 'user', content: 'Fix the login timeout issue' },
      { role: 'assistant', content: 'I will look at auth.js', toolCalls: [{ function: { name: 'readFile' } }] },
      { role: 'user', content: 'Now add tests' },
      { role: 'assistant', content: 'Adding test coverage', toolCalls: [{ function: { name: 'writeFile' } }] },
    ],
    filesModified: ['src/auth.js', 'test/auth.test.js'],
  }
};

const session = extractSession(rawSession);
assert.strictEqual(session.id, 'test-001');
assert.strictEqual(session.title, 'Fix auth bug');
assert.strictEqual(session.turns.length, 4);
assert.strictEqual(session.turns[0].role, 'user');
console.log('PASS: extractSession normalizes wrapped format');

// Test: compareResults calculates fidelity
const mockReplay = {
  model: 'gpt-5.5',
  turns: [
    {
      originalTurn: { index: 0, role: 'user', content: 'Fix the login timeout issue' },
      replayResponse: { content: 'Looking at auth...', tokens: 100 },
      toolCalls: [{ function: { name: 'readFile' } }],  // matches original
    },
    {
      originalTurn: { index: 2, role: 'user', content: 'Now add tests' },
      replayResponse: { content: 'Adding tests...', tokens: 150 },
      toolCalls: [],  // MISSING writeFile — regression
    },
  ],
  totalTokens: 250,
};

const comparison = compareResults(session, mockReplay, 'gpt-5.2-codex');
assert.strictEqual(comparison.completionRate, 100);
assert.strictEqual(comparison.fidelityScore, 50);  // 1/2 tools matched
assert.strictEqual(comparison.regressions.length, 1);
assert.strictEqual(comparison.regressions[0].type, 'missing-tool-call');
console.log('PASS: compareResults detects regressions');

// Test: generateReport produces markdown
const report = generateReport(
  [{ session, replay: mockReplay, comparison }],
  'gpt-5.5',
  'gpt-5.2-codex'
);
assert(report.includes('# Agent Replay Report'));
assert(report.includes('gpt-5.5'));
assert(report.includes('missing-tool-call'));
console.log('PASS: generateReport produces valid markdown');

console.log('\nAll tests passed.');
