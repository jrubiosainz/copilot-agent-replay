#!/usr/bin/env node
// copilot-agent-replay — Replay Copilot agent sessions against different models

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');

const { extractSession, replaySession, compareResults, generateReport } = require('./replay-engine');

const args = parseArgs({
  options: {
    session: { type: 'string', short: 's' },
    model: { type: 'string', short: 'm' },
    baseline: { type: 'string', short: 'b' },
    output: { type: 'string', short: 'o', default: 'replay-report.md' },
    dir: { type: 'string', short: 'd' },
    'dry-run': { type: 'boolean', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: false,
});

if (args.values.help) {
  console.log(`
copilot-agent-replay — Replay agent sessions against different models

USAGE:
  agent-replay --session <path|id> --model <target-model> [options]
  agent-replay --dir <sessions-dir> --model <target-model> [options]

OPTIONS:
  -s, --session   Path to session JSON (exported from Session Sync)
  -d, --dir       Directory with multiple session JSONs for batch replay
  -m, --model     Target model to replay against (e.g. gpt-5.5, claude-opus-4)
  -b, --baseline  Baseline model name (defaults to session's original model)
  -o, --output    Output report path (default: replay-report.md)
      --dry-run   Parse and validate without calling the model
  -v, --verbose   Show detailed step-by-step output
  -h, --help      Show this help

EXAMPLES:
  # Replay a single session with GPT-5.5
  agent-replay -s session-abc123.json -m gpt-5.5

  # Batch replay all sessions in a directory
  agent-replay -d ./exported-sessions -m claude-opus-4

  # Dry run to validate session format
  agent-replay -s session.json -m gpt-5.5 --dry-run
`);
  process.exit(0);
}

async function main() {
  const { session: sessionPath, model, baseline, output, dir, verbose } = args.values;
  const dryRun = args.values['dry-run'];

  if (!model) {
    console.error('Error: --model is required');
    process.exit(1);
  }

  if (!sessionPath && !dir) {
    console.error('Error: --session or --dir is required');
    process.exit(1);
  }

  const sessions = [];

  if (dir) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      sessions.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    }
    console.log(`Loaded ${sessions.length} sessions from ${dir}`);
  } else {
    sessions.push(JSON.parse(fs.readFileSync(sessionPath, 'utf8')));
  }

  const results = [];

  for (const raw of sessions) {
    const session = extractSession(raw);
    console.log(`\nReplaying: "${session.title}" (${session.turns.length} turns)`);
    console.log(`  Original model: ${session.model}`);
    console.log(`  Target model:   ${model}`);

    if (dryRun) {
      console.log('  [dry-run] Session valid, skipping replay');
      results.push({ session, status: 'dry-run', score: null });
      continue;
    }

    const replay = await replaySession(session, model, { verbose });
    const comparison = compareResults(session, replay, baseline || session.model);
    results.push({ session, replay, comparison });

    console.log(`  Completion: ${comparison.completionRate}%`);
    console.log(`  Fidelity:   ${comparison.fidelityScore}/100`);
    console.log(`  Regressions: ${comparison.regressions.length}`);
  }

  const report = generateReport(results, model, baseline);
  fs.writeFileSync(output, report);
  console.log(`\nReport saved to ${output}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
