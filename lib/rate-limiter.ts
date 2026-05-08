// Layer 3 of the guardrails (see docs/02_guardrails.md): per-IP rate limits
// over a 1-hour sliding window and a 24-hour sliding window.
//
// Implementation: Upstash sorted set per IP per window. Each request adds an
// entry scored by current timestamp (ms); we trim entries older than the
// window before counting. True sliding window — no boundary-spike pathologies.
//
// There's a benign race between the count and the insert: under bursty
// concurrent traffic, two requests can both see "count = N-1" and both insert,
// giving count = N+1. Acceptable for a portfolio-scale demo. Tightening it
// would require a Lua script.

import { kv } from './kv.ts';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const RATE_HOURLY_LIMIT = intFromEnv('RATE_HOURLY_LIMIT', 20);
export const RATE_DAILY_LIMIT = intFromEnv('RATE_DAILY_LIMIT', 60);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type RateWindow = 'hourly' | 'daily';

export type RateCheckResult =
  | { ok: true; hourly_count: number; daily_count: number }
  | { ok: false; window: RateWindow; hourly_count: number; daily_count: number };

export async function checkRateLimit(ip: string): Promise<RateCheckResult> {
  // Fail open if we can't identify the caller or KV is unavailable. Better
  // to serve users than to block on observability infra.
  if (!kv) return { ok: true, hourly_count: 0, daily_count: 0 };
  if (!ip || ip === 'unknown') return { ok: true, hourly_count: 0, daily_count: 0 };

  const now = Date.now();
  const hourKey = `rl:hour:${ip}`;
  const dayKey = `rl:day:${ip}`;

  try {
    // Trim entries that fell out of the window before counting.
    await Promise.all([
      kv.zremrangebyscore(hourKey, 0, now - HOUR_MS),
      kv.zremrangebyscore(dayKey, 0, now - DAY_MS),
    ]);

    const [hourCount, dayCount] = await Promise.all([
      kv.zcard(hourKey),
      kv.zcard(dayKey),
    ]);

    // Daily checked first so a long-running abuser sees the more honest cap
    // message rather than getting unblocked at the hour boundary.
    if (dayCount >= RATE_DAILY_LIMIT) {
      return { ok: false, window: 'daily', hourly_count: hourCount, daily_count: dayCount };
    }
    if (hourCount >= RATE_HOURLY_LIMIT) {
      return { ok: false, window: 'hourly', hourly_count: hourCount, daily_count: dayCount };
    }

    // Record this request. Member must be unique (sorted-set add with a
    // duplicate member updates the score, not inserts) — append a random
    // suffix to handle same-ms concurrent calls.
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
    await Promise.all([
      kv.zadd(hourKey, { score: now, member }),
      kv.zadd(dayKey, { score: now, member }),
      // TTL ~2x window so abandoned IPs eventually clean themselves up even
      // if no further trim is triggered.
      kv.expire(hourKey, 60 * 60 * 2),
      kv.expire(dayKey, 60 * 60 * 25),
    ]);

    return { ok: true, hourly_count: hourCount + 1, daily_count: dayCount + 1 };
  } catch (e) {
    console.error('[rate-limiter] check failed; failing open:', (e as Error).message);
    return { ok: true, hourly_count: 0, daily_count: 0 };
  }
}
