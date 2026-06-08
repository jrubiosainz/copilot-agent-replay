# copilot-agent-replay

Replay recorded GitHub Copilot agent sessions against different models to regression-test behavior before switching.

## Why

VS Code 1.123 introduced Session Sync, which stores your full agent conversation history. When GitHub adds a new model or you consider switching from GPT-5.2 to GPT-5.5 (or Claude), you want to know: will my workflows still work the same?

This CLI takes exported sessions and replays them turn-by-turn against a target model, comparing tool call patterns and detecting regressions.

## Install

```bash
git clone https://github.com/jrubiosainz/copilot-agent-replay.git
cd copilot-agent-replay
npm link
```

## Usage

```bash
# Replay a single session
agent-replay --session exported-session.json --model gpt-5.5

# Batch replay a directory of sessions
agent-replay --dir ./my-sessions --model claude-opus-4

# Dry run (validate format only)
agent-replay --session session.json --model gpt-5.5 --dry-run
```

## How it works

1. **Extract** — Parses the Session Sync JSON export into normalized turns
2. **Replay** — Sends each user turn to the target model, collecting responses
3. **Compare** — Checks if the target model uses the same tool calls as the original
4. **Report** — Generates a Markdown report with completion rate, fidelity score, and regressions

## Metrics

- **Completion rate**: Did the target model handle all user turns without errors?
- **Fidelity score**: What percentage of original tool calls were reproduced?
- **Regressions**: Which tools were missed or unexpectedly added?

## Example output

```
Replaying: "Refactor database connection pool" (6 turns)
  Original model: gpt-5.2-codex
  Target model:   gpt-5.5
  Completion: 100%
  Fidelity:   83/100
  Regressions: 1

Report saved to replay-report.md
```

## Session export

Export sessions from VS Code using the Session Sync feature (1.123+):
1. Open Command Palette > "Sessions: Export Session"
2. Save the JSON file
3. Pass it to `agent-replay`

See `examples/session-export.json` for the expected format.

## Environment

```bash
export GITHUB_TOKEN=ghp_xxxxx   # or COPILOT_TOKEN
export COPILOT_API_URL=https://api.github.com/copilot/chat/completions  # optional
```

## Use cases

- Validate model migrations before switching your team
- CI gate: replay critical sessions on new model versions
- Compare cost/quality tradeoffs between models
- Detect behavioral drift after model updates

## License

MIT
