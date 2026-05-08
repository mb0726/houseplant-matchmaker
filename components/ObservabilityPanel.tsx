'use client';

import type { TraceEntry, AgentUsage } from '@/lib/types';

// Sonnet 4.6 pricing per 1M tokens, used for the running cost estimate in the
// footer. Updated alongside lib/llm.ts when the model or rates change.
const PRICE_INPUT = 3.0;
const PRICE_OUTPUT = 15.0;
const PRICE_CACHE_WRITE = 3.75;
const PRICE_CACHE_READ = 0.3;

type Props = {
  trace: TraceEntry[];
  usage: AgentUsage;
};

function estimateCost(u: AgentUsage): number {
  return (
    (u.input_tokens * PRICE_INPUT +
      u.output_tokens * PRICE_OUTPUT +
      u.cache_creation_input_tokens * PRICE_CACHE_WRITE +
      u.cache_read_input_tokens * PRICE_CACHE_READ) /
    1_000_000
  );
}

function formatInput(input: Record<string, unknown>): string {
  // PRD asks for plain monospace, no styling. Render each field on its own
  // indented line, JSON-stringifying non-strings for compactness.
  return Object.entries(input)
    .map(([k, v]) => `  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
}

export function ObservabilityPanel({ trace, usage }: Props) {
  const totalInput =
    usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens;
  const cost = estimateCost(usage);
  return (
    <aside className="flex flex-col h-full bg-stone-100 border-l border-stone-200">
      <header className="px-4 py-3 border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500 font-mono">
        Tool calls and reasoning
      </header>
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed text-stone-700">
        {trace.length === 0 ? (
          <p className="text-stone-400">
            Tool calls and reasoning will appear here as you chat.
          </p>
        ) : (
          <ul className="space-y-3">
            {trace.map((t, i) => (
              <li key={i}>
                <div className={t.ok ? 'text-stone-900' : 'text-rose-700'}>
                  &gt; Calling {t.tool}
                </div>
                <pre className="text-stone-600 whitespace-pre-wrap break-words">
                  {formatInput(t.input)}
                </pre>
                <div className="ml-2 text-stone-700">→ {t.summary}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="px-4 py-2 border-t border-stone-200 font-mono text-[11px] text-stone-500">
        Input: {totalInput.toLocaleString()} | Output: {usage.output_tokens.toLocaleString()} | ~${cost.toFixed(3)} this session
      </footer>
    </aside>
  );
}
