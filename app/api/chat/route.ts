// POST /api/chat — the only endpoint the browser talks to. The Anthropic API
// key never leaves the server. Per-IP rate limits, session caps, and budget
// caps land here in step 8 (guardrails); for now this is the minimum surface
// needed to test the agent loop.
//
// Request body:
//   { messages?: Anthropic.MessageParam[], message: string }
//
// Response body (200):
//   { ok: true, data: AgentResult }
// Response body (4xx / 5xx):
//   { ok: false, error: string }

import Anthropic from '@anthropic-ai/sdk';
import { runAgent, type AgentResult } from '@/lib/agent';
import { checkBudget, recordUsage } from '@/lib/cost-tracker';
import { checkRateLimit } from '@/lib/rate-limiter';
import { CAP_MESSAGE } from '@/lib/cap-messages';

// Server-side caps only — session cap is client-only and never reaches here.
type ServerCapHit = 'daily' | 'monthly' | 'rate_limit';

// agent.ts uses fs.readFileSync to load the system prompt; force Node runtime.
export const runtime = 'nodejs';

// Vercel sets x-forwarded-for; behind any proxy chain the client IP is the
// first entry. Local dev usually has no headers, so we tag those as "unknown"
// (the rate limiter fails open on that value so dev iteration isn't blocked).
//
// RATE_LIMIT_DEV_IP override (dev only): honored only when NODE_ENV !==
// 'production', so an accidentally-set Vercel env var can't pin every visitor
// to the same fake IP. Useful for exercising the rate cap locally without
// editing code.
function getClientIp(req: Request): string {
  if (process.env['NODE_ENV'] !== 'production') {
    const devIp = process.env['RATE_LIMIT_DEV_IP'];
    if (devIp) return devIp;
  }
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) return first.trim();
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

// Demo override: a URL query param (?demo_key=…) that bypasses Layer 3 (per-IP
// rate limits) but NOT Layer 4 (budget caps). Mona uses this for live demos
// to recruiters so a session can't hit her own daily IP cap mid-conversation.
function hasDemoKey(req: Request): boolean {
  const expected = process.env['DEMO_KEY'];
  if (!expected) return false;
  try {
    return new URL(req.url).searchParams.get('demo_key') === expected;
  } catch {
    return false;
  }
}

// Build a synthetic AgentResult that reuses the existing chat rendering path
// for cap-hit copy. Same shape as a real turn, but no tool calls, no plants,
// no chips, and a `cap_hit` flag the client uses to disable the input.
function capHitResult(
  cap: ServerCapHit,
  priorMessages: Anthropic.MessageParam[],
  userMessage: string,
): AgentResult {
  const text = CAP_MESSAGE[cap];
  // Persist the synthetic exchange in messages so a refresh-less retry would
  // still see the cap copy in history (relevant for session cap; harmless for
  // budget caps where the page is effectively frozen).
  const messages: Anthropic.MessageParam[] = [
    ...priorMessages,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: [{ type: 'text', text }] },
  ];
  return {
    response: text,
    trace: [],
    cards: [],
    suggested_chips: [],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    messages,
    stop_reason: 'end_turn',
    cap_hit: cap,
  };
}

type ChatRequestBody = {
  messages?: Anthropic.MessageParam[];
  message?: string;
};

function badRequest(error: string): Response {
  return Response.json({ ok: false, error }, { status: 400 });
}

export async function POST(req: Request): Promise<Response> {
  if (!process.env['ANTHROPIC_API_KEY']) {
    return Response.json(
      { ok: false, error: 'ANTHROPIC_API_KEY is not set on the server.' },
      { status: 500 },
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return badRequest('Body must be JSON.');
  }

  if (!body.message || typeof body.message !== 'string') {
    return badRequest('Field `message` is required (string).');
  }
  if (body.messages !== undefined && !Array.isArray(body.messages)) {
    return badRequest('Field `messages` must be an array if provided.');
  }

  // Layer 4: budget cap (global). Checked first — if the demo as a whole is
  // out of budget, no individual visitor's rate-limit status matters.
  const budget = await checkBudget();
  if (!budget.ok) {
    const result = capHitResult(budget.cap, body.messages ?? [], body.message);
    return Response.json({ ok: true, data: result });
  }

  // Layer 3: per-IP rate limit. Demo key bypasses this (but not budget).
  if (!hasDemoKey(req)) {
    const ip = getClientIp(req);
    const rate = await checkRateLimit(ip);
    if (!rate.ok) {
      const result = capHitResult('rate_limit', body.messages ?? [], body.message);
      return Response.json({ ok: true, data: result });
    }
  }

  const client = new Anthropic({ maxRetries: 3 });

  try {
    const result: AgentResult = await runAgent(client, body.messages ?? [], body.message);
    // Record AFTER success so failed calls don't count against the budget.
    // Fire-and-forget — KV failure shouldn't block the response.
    void recordUsage(result.usage);
    return Response.json({ ok: true, data: result });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return Response.json(
        { ok: false, error: 'Rate limited by the AI provider. Try again in a moment.' },
        { status: 429 },
      );
    }
    if (e instanceof Anthropic.APIError) {
      return Response.json(
        { ok: false, error: `AI provider error: ${e.message}` },
        { status: 502 },
      );
    }
    return Response.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
