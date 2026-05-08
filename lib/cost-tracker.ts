// Layer 4 of the guardrails (see docs/02_guardrails.md): daily and monthly
// API spend caps, tracked in Upstash Redis (Vercel KV).
//
// Spend is stored in MICROCENTS (1 μ¢ = $0.000001) so all math stays integer
// and Redis INCRBY is exact. Per-token rates are rounded UP to the nearest
// integer μ¢ to err on the side of stopping early rather than overshooting.
//
// Sonnet 4.6 pricing (as of 2026-04):
//   input         $3 / 1M tokens   →  3 μ¢/token
//   output       $15 / 1M tokens   → 15 μ¢/token
//   cache write  $3.75 / 1M tokens →  4 μ¢/token   (round up from 3.75)
//   cache read   $0.30 / 1M tokens →  1 μ¢/token   (round up from 0.30)

import { kv } from './kv.ts';
import type { AgentUsage } from './types.ts';

const MICROCENT_PER_INPUT_TOKEN = 3;
const MICROCENT_PER_OUTPUT_TOKEN = 15;
const MICROCENT_PER_CACHE_WRITE_TOKEN = 4;
const MICROCENT_PER_CACHE_READ_TOKEN = 1;
const MICROCENTS_PER_DOLLAR = 1_000_000;

// Caps are env-overridable so `BUDGET_DAILY_USD=0.50` can smoke-test the
// cap-hit UX without a code change. Default to the values in the guardrails doc.
function dollarsFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const DAILY_CAP_USD = dollarsFromEnv('BUDGET_DAILY_USD', 15);
export const MONTHLY_CAP_USD = dollarsFromEnv('BUDGET_MONTHLY_USD', 50);

const DAILY_CAP_MICROCENTS = Math.round(DAILY_CAP_USD * MICROCENTS_PER_DOLLAR);
const MONTHLY_CAP_MICROCENTS = Math.round(MONTHLY_CAP_USD * MICROCENTS_PER_DOLLAR);

// 32-hour daily TTL is a buffer past midnight in any timezone; 32-day monthly
// TTL similarly. Keeps the key around long enough that a long-running stretch
// of writes won't expire mid-day even if traffic is sparse.
const DAILY_TTL_SECONDS = 60 * 60 * 32;
const MONTHLY_TTL_SECONDS = 60 * 60 * 24 * 32;

function dateParts(now: Date = new Date()): { day: string; month: string } {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return { day: `${yyyy}-${mm}-${dd}`, month: `${yyyy}-${mm}` };
}

function dailyKey(now?: Date): string {
  return `budget:daily:${dateParts(now).day}`;
}

function monthlyKey(now?: Date): string {
  return `budget:monthly:${dateParts(now).month}`;
}

export function usageToMicrocents(u: AgentUsage): number {
  return (
    u.input_tokens * MICROCENT_PER_INPUT_TOKEN +
    u.output_tokens * MICROCENT_PER_OUTPUT_TOKEN +
    u.cache_creation_input_tokens * MICROCENT_PER_CACHE_WRITE_TOKEN +
    u.cache_read_input_tokens * MICROCENT_PER_CACHE_READ_TOKEN
  );
}

export type BudgetCap = 'daily' | 'monthly';

export type BudgetStatus =
  | { ok: true; daily_usd: number; monthly_usd: number }
  | { ok: false; cap: BudgetCap; daily_usd: number; monthly_usd: number };

// Read both counters and decide whether either cap is hit. Monthly is checked
// first — if both are blown, the monthly message is the more honest story
// (the "we're done for this billing cycle" framing).
//
// Fail-open: if KV is unconfigured or the GET fails, we let the request
// through. We'd rather serve users than block on observability infrastructure.
export async function checkBudget(): Promise<BudgetStatus> {
  if (!kv) return { ok: true, daily_usd: 0, monthly_usd: 0 };
  try {
    const [dailyRaw, monthlyRaw] = await Promise.all([
      kv.get<number>(dailyKey()),
      kv.get<number>(monthlyKey()),
    ]);
    const dailyMc = dailyRaw ?? 0;
    const monthlyMc = monthlyRaw ?? 0;
    const daily_usd = dailyMc / MICROCENTS_PER_DOLLAR;
    const monthly_usd = monthlyMc / MICROCENTS_PER_DOLLAR;
    if (monthlyMc >= MONTHLY_CAP_MICROCENTS) {
      return { ok: false, cap: 'monthly', daily_usd, monthly_usd };
    }
    if (dailyMc >= DAILY_CAP_MICROCENTS) {
      return { ok: false, cap: 'daily', daily_usd, monthly_usd };
    }
    return { ok: true, daily_usd, monthly_usd };
  } catch (e) {
    console.error('[cost-tracker] checkBudget failed; failing open:', (e as Error).message);
    return { ok: true, daily_usd: 0, monthly_usd: 0 };
  }
}

// Increment both counters by the cost of this turn. We refresh TTL on every
// write so the key sticks around for the full window even on bursty traffic;
// the TTL acts as a cleanup mechanism, not a sliding window.
export async function recordUsage(usage: AgentUsage): Promise<void> {
  if (!kv) return;
  const microcents = usageToMicrocents(usage);
  if (microcents <= 0) return;
  const dKey = dailyKey();
  const mKey = monthlyKey();
  try {
    await Promise.all([
      kv.incrby(dKey, microcents),
      kv.incrby(mKey, microcents),
      kv.expire(dKey, DAILY_TTL_SECONDS),
      kv.expire(mKey, MONTHLY_TTL_SECONDS),
    ]);
  } catch (e) {
    console.error('[cost-tracker] recordUsage failed:', (e as Error).message);
  }
}
