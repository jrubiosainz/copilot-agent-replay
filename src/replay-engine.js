// replay-engine.js — Core logic for session extraction, replay, and comparison

/**
 * Extract a normalized session from a VS Code Session Sync export
 */
function extractSession(raw) {
  // Support both direct format and wrapped Session Sync format
  const data = raw.session || raw;

  return {
    id: data.id || data.sessionId || 'unknown',
    title: data.title || data.name || 'Untitled session',
    model: data.model || data.metadata?.model || 'unknown',
    timestamp: data.timestamp || data.createdAt || null,
    repo: data.repository || data.metadata?.repo || null,
    branch: data.branch || data.metadata?.branch || null,
    turns: normalizeTurns(data.turns || data.messages || data.conversation || []),
    toolCalls: extractToolCalls(data),
    filesModified: data.filesModified || data.metadata?.files || [],
  };
}

function normalizeTurns(turns) {
  return turns.map((t, i) => ({
    index: i,
    role: t.role || (t.type === 'user' ? 'user' : 'assistant'),
    content: t.content || t.text || t.message || '',
    toolCalls: t.toolCalls || t.tool_calls || [],
    timestamp: t.timestamp || null,
  }));
}

function extractToolCalls(data) {
  const calls = [];
  const turns = data.turns || data.messages || data.conversation || [];
  for (const t of turns) {
    if (t.toolCalls) calls.push(...t.toolCalls);
    if (t.tool_calls) calls.push(...t.tool_calls);
  }
  return calls;
}

/**
 * Replay a session against a target model
 * Uses the Copilot API (or compatible endpoint) to send user turns
 * and collect assistant responses
 */
async function replaySession(session, targetModel, opts = {}) {
  const endpoint = process.env.COPILOT_API_URL || 'https://api.github.com/copilot/chat/completions';
  const token = process.env.GITHUB_TOKEN || process.env.COPILOT_TOKEN;

  if (!token) {
    throw new Error('GITHUB_TOKEN or COPILOT_TOKEN required for replay');
  }

  const replayTurns = [];
  const conversationHistory = [];

  for (const turn of session.turns) {
    if (turn.role === 'user') {
      conversationHistory.push({ role: 'user', content: turn.content });

      const response = await callModel(endpoint, token, targetModel, conversationHistory);
      
      replayTurns.push({
        originalTurn: turn,
        replayResponse: response,
        toolCalls: response.toolCalls || [],
      });

      conversationHistory.push({ role: 'assistant', content: response.content });

      if (opts.verbose) {
        console.log(`    Turn ${turn.index}: ${response.content.substring(0, 80)}...`);
      }
    }
  }

  return {
    model: targetModel,
    turns: replayTurns,
    totalTokens: replayTurns.reduce((sum, t) => sum + (t.replayResponse.tokens || 0), 0),
  };
}

async function callModel(endpoint, token, model, messages) {
  const body = {
    model,
    messages,
    temperature: 0,
    max_tokens: 4096,
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text.substring(0, 200)}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0] || {};

  return {
    content: choice.message?.content || '',
    toolCalls: choice.message?.tool_calls || [],
    tokens: data.usage?.total_tokens || 0,
  };
}

/**
 * Compare original session results with replay results
 */
function compareResults(session, replay, baselineModel) {
  const totalUserTurns = session.turns.filter(t => t.role === 'user').length;
  const replayedTurns = replay.turns.length;
  const completionRate = Math.round((replayedTurns / totalUserTurns) * 100);

  // Fidelity: compare tool calls and response patterns
  let matchedTools = 0;
  let totalTools = 0;
  const regressions = [];

  for (const rt of replay.turns) {
    const originalTurn = rt.originalTurn;
    const originalNextAssistant = findNextAssistant(session.turns, originalTurn.index);

    if (originalNextAssistant) {
      const origTools = originalNextAssistant.toolCalls || [];
      const replayTools = rt.toolCalls || [];
      totalTools += origTools.length;

      for (const ot of origTools) {
        const toolName = ot.function?.name || ot.name || '';
        const found = replayTools.some(rt2 =>
          (rt2.function?.name || rt2.name || '') === toolName
        );
        if (found) matchedTools++;
        else {
          regressions.push({
            turn: originalTurn.index,
            type: 'missing-tool-call',
            expected: toolName,
            detail: `Model ${replay.model} did not call ${toolName}`,
          });
        }
      }

      // Check for hallucinated tool calls
      for (const rt2 of replayTools) {
        const name = rt2.function?.name || rt2.name || '';
        const wasOriginal = origTools.some(o => (o.function?.name || o.name || '') === name);
        if (!wasOriginal) {
          regressions.push({
            turn: originalTurn.index,
            type: 'unexpected-tool-call',
            tool: name,
            detail: `Model ${replay.model} called ${name} (not in original)`,
          });
        }
      }
    }
  }

  const fidelityScore = totalTools > 0
    ? Math.round((matchedTools / totalTools) * 100)
    : 100;

  return {
    baselineModel,
    targetModel: replay.model,
    completionRate,
    fidelityScore,
    totalTokens: replay.totalTokens,
    regressions,
    summary: buildSummary(completionRate, fidelityScore, regressions),
  };
}

function findNextAssistant(turns, afterIndex) {
  return turns.find(t => t.index > afterIndex && t.role === 'assistant');
}

function buildSummary(completionRate, fidelityScore, regressions) {
  if (fidelityScore >= 90 && regressions.length === 0) return 'PASS — Model produces equivalent behavior';
  if (fidelityScore >= 70) return 'WARN — Minor differences in tool usage';
  return 'FAIL — Significant behavioral regressions detected';
}

/**
 * Generate a Markdown report from replay results
 */
function generateReport(results, targetModel, baselineOverride) {
  let md = `# Agent Replay Report\n\n`;
  md += `**Target model:** ${targetModel}\n`;
  md += `**Date:** ${new Date().toISOString().split('T')[0]}\n`;
  md += `**Sessions replayed:** ${results.length}\n\n`;

  md += `## Summary\n\n`;
  md += `| Session | Baseline | Completion | Fidelity | Verdict |\n`;
  md += `|---------|----------|------------|----------|--------|\n`;

  for (const r of results) {
    if (r.status === 'dry-run') {
      md += `| ${r.session.title} | ${r.session.model} | — | — | dry-run |\n`;
    } else {
      md += `| ${r.session.title} | ${r.comparison.baselineModel} | ${r.comparison.completionRate}% | ${r.comparison.fidelityScore}/100 | ${r.comparison.summary.split('—')[0].trim()} |\n`;
    }
  }

  md += `\n## Regressions\n\n`;

  let hasRegressions = false;
  for (const r of results) {
    if (r.comparison?.regressions?.length > 0) {
      hasRegressions = true;
      md += `### ${r.session.title}\n\n`;
      for (const reg of r.comparison.regressions) {
        md += `- **Turn ${reg.turn}** [${reg.type}]: ${reg.detail}\n`;
      }
      md += '\n';
    }
  }

  if (!hasRegressions) md += 'No regressions detected.\n';

  md += `\n## Methodology\n\n`;
  md += `Each session is replayed turn-by-turn: user messages are sent in order to the target model,\n`;
  md += `and assistant responses (including tool calls) are compared against the original session.\n\n`;
  md += `- **Completion rate**: percentage of user turns successfully replayed\n`;
  md += `- **Fidelity score**: percentage of original tool calls reproduced by the target model\n`;
  md += `- **Regressions**: tool calls missing or unexpectedly added\n`;

  return md;
}

module.exports = { extractSession, replaySession, compareResults, generateReport };
