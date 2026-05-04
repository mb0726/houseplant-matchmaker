
**Status:** v1 - source of truth for protective measures **Owner:** Mona **Last updated:** May 4, 2026

---

## Why this doc exists

This is a portfolio piece using real LLM API calls against a public URL. That means real money is at stake every time someone interacts with it. This doc specifies the protective measures so the demo can live online indefinitely without:

- Surprise charges from runaway usage
- Exposed API keys
- Bad actors draining the budget
- Inability to show the demo to people because of its own limits

These are the kinds of things that are trivial to add upfront and painful to retrofit. We add them now.

Inspired by the guardrails framework Mona observed from a Google PM's agent-building workflow, adapted for this specific build.

---

## API key handling

### The rule

The Anthropic API key (and any other secrets) live in **environment variables only**. They never appear in source code, in commits, or in any file that gets pushed to GitHub.

### Specifics

**Local development:**

- Key lives in `.env.local` at the repo root
- `.env.local` is in `.gitignore` (verify before first commit)
- A `.env.example` file is committed instead, showing variable names with empty values

**Production (Vercel):**

- Key lives in Vercel's Environment Variables settings (Settings → Environment Variables in the Vercel dashboard)
- Set for "Production," "Preview," and "Development" environments as needed
- Never accessed via `console.log` or exposed in any client-side code

**In code:**

- API key is only ever accessed in server-side code (Next.js API routes, never in components or client-side hooks)
- The actual call to Anthropic's API happens server-side, never client-side
- The chat UI calls _your own_ API endpoint (`/api/chat`), which then calls Anthropic - the browser never sees the key

### Verification checklist (before deploying)

- [ ] `.env.local` is in `.gitignore`
- [ ] No secrets in any committed file (run `git log --all --full-history -- .env*` to verify)
- [ ] Key is set in Vercel dashboard, not hardcoded
- [ ] Anthropic API call only happens in `/app/api/chat/route.ts` (or equivalent server-side file)
- [ ] Browser DevTools → Network tab shows no Anthropic URLs being called from the browser

### If a key ever gets exposed

- Immediately rotate the key in the Anthropic console
- Update the new key in Vercel environment variables
- Force-redeploy
- Check usage logs for any anomalous activity

---

## Usage limits

The goal is **multiple layers of protection** so no single mechanism is the only thing standing between the demo and a $400 bill.

### Layer 1: Per-message constraints

Built into the agent loop itself.

|Constraint|Limit|
|---|---|
|Max input tokens per agent call|8,000|
|Max output tokens per response|800|
|Max tool calls per user message|6|
|Max iterations of the agent loop per user message|8 (catches infinite loops)|

If any limit is hit mid-loop, the agent returns what it has and adds a brief note ("let me know if you want me to keep looking").

### Layer 2: Per-session limits

Tracked in memory or session storage on the visitor's browser. Resets when they refresh.

|Limit|Value|
|---|---|
|Max messages per session|12|
|Max conversation turns before forced reset|12|

When hit: the chat shows "We've covered a lot here - feel free to refresh to start a new conversation." The input field disables. No more API calls happen.

### Layer 3: Per-IP rate limits

Server-side, tracked via Vercel's Edge Config or a simple in-memory store with a timestamp ring buffer.

|Limit|Value|
|---|---|
|Messages per IP per hour|20|
|Messages per IP per 24 hours|60|

When hit: friendly message about rate limiting, suggests trying again later. Returns HTTP 429 from the API endpoint.

### Layer 4: Total budget cap

Daily and monthly caps tracked server-side. The simplest implementation: a counter incremented per API call (using token estimates) stored in Vercel KV or a similar lightweight store.

|Cap|Value|
|---|---|
|Daily API spend|$5|
|Monthly API spend|$50|

When approaching cap (e.g., 80%): log a warning so Mona can see it. When cap hit: the API endpoint returns a static "demo is taking a breather" message and skips the LLM call entirely. No new charges accrue.

### Layer 5: Anthropic-side spending limit

Set a hard spending limit in the Anthropic console as the final backstop. If everything else fails, this is the catastrophic-failure protection.

**Recommended:** Set Anthropic console limit to $75/month - a 50% buffer above the in-app $50 cap. If you ever hit this, something is broken in the in-app limits and you want the API to stop.

---

## The demo override (so you can show the demo without hitting your own limits)

This is the specific concern Mona raised. The standard limits would block her from doing live demos to hiring managers if she hits her own daily IP cap during testing.

### The mechanism

A special URL parameter that, when present, exempts the request from per-IP rate limits (but **not** from total budget caps - those still apply).

```
https://your-demo.vercel.app/?demo_key=SOMETHING_LONG_AND_RANDOM
```

The `demo_key` is checked against an environment variable. If it matches, the request bypasses Layer 3 (per-IP) but is still subject to Layer 4 (total budget).

### How to use it

- Mona has the demo key saved in a personal note
- For live demos, she uses the URL with the demo key
- For sharing publicly, she shares the clean URL without it
- The demo key is rotated if ever shared accidentally

### Why this is safe

- The demo key never appears in code
- It bypasses _only_ rate limiting, not budget protection
- Even with the demo key, you can't drain more than $50/month
- It's revocable at any time by changing the env var

---

## Graceful degradation: what users see when limits hit

The principle: every limit hit should produce a coherent, intentional experience, not a broken-looking error.

|Scenario|What happens|What user sees|
|---|---|---|
|Token limit per response|Agent truncates and offers to continue|"...want me to keep going?"|
|Tool call cap per message|Agent returns what it has|Note in response: "I looked at the top matches; let me know if you want me to dig further"|
|Session message cap|Input disables|"We've covered a lot here. Refresh to start fresh."|
|Per-IP rate limit|API returns 429|"Rate limited - try again in an hour. Or you saw enough?"|
|Daily budget cap|API returns static response|"The demo's taking a breather - try again tomorrow."|
|Monthly budget cap|API returns static response|Same as above with "next month" wording|
|Anthropic API outage|API returns error|"Something's off on the AI side. Try refreshing in a minute."|

None of these should look like crashes. All should feel intentional.

---

## Cost monitoring (so you know if something's wrong before the bill arrives)

### Daily check-in

Mona should be able to see, at a glance:

- How many messages were sent today
- Estimated spend today and this month
- Whether any rate limits or caps have been hit

### Implementation: simplest possible

A `/admin` page (protected by the same demo key mechanism) that shows:

```
Today: 47 messages, $1.23 estimated
This month: 312 messages, $8.74 estimated
Daily cap: $5 (24% used)
Monthly cap: $50 (17% used)
Last 7 days of usage: [simple list]
Top IPs by usage today: [simple list]
```

This page reads from the same Vercel KV store as the budget tracker. No DB needed.

### Anthropic dashboard

The Anthropic console also shows real-time usage. Mona should bookmark this and check it the first few days the demo is live to catch any miscalibration.

### Anomaly heuristics

Worth flagging if:

- A single IP makes >30 messages in an hour (likely scraping/scripting)
- Daily spend exceeds expected by 3x for two consecutive days
- Token counts per message average suddenly increase (could indicate a prompt injection attempt or runaway loop)

For an MVP, manual checking of the admin page is fine. Automated alerting is v2.

---

## Data source hierarchy (for the agent's responses)

The agent uses **only** the bundled plant dataset. It does not call the web, does not search externally, does not fall through to general knowledge for plant facts.

### Why this matters

1. Predictable responses - same questions get same answers
2. No risk of the agent hallucinating plant care info that's wrong
3. No risk of fetching from a site that goes down
4. Token efficiency - bounded context

### What the agent does when asked about something not in the dataset

- For unknown plants: "I don't have that one in my dataset. Want me to suggest similar plants I do have?"
- For unrelated questions ("what's the weather?"): "I'm specifically a houseplant matchmaker - want help finding a plant?"

This is actually a _feature_, not a limitation. It signals the agent has clear scope, which reads as competent rather than restrictive.

### Staleness handling

Plant care info changes slowly (decades, not months). The dataset doesn't need staleness caveats for plant facts.

What _can_ go stale:

- Image URLs (if the source site moves things)
- Whether a plant is "trendy" or "popular"

Mitigation: the description copy should avoid time-sensitive claims ("this is having a moment in 2026"). Stick to durable attributes.

---

## Prompt injection resilience

Real risk for any public-facing LLM app: a user types something designed to make the agent ignore its instructions, leak its system prompt, or behave in unintended ways.

### Defenses (light, appropriate to scope)

1. **The agent's system prompt is firm about scope.** It refuses to discuss anything but houseplants, refuses to reveal its system prompt, refuses to roleplay as a different agent.
    
2. **Output validation.** Before sending the agent's response to the chat, server-side code checks that it's reasonable in length and structure. If the agent tries to dump its system prompt, the response is replaced with a generic "I can only help with houseplant questions."
    
3. **Tool input validation.** The four tools accept only specific structured inputs. The agent can't sneak arbitrary commands through tool calls because the tools' inputs are strictly typed.
    
4. **Token output cap (Layer 1) acts as a safety net.** Even if a prompt injection somehow worked, the 800-token output cap limits the damage.
    

For a portfolio piece, this is sufficient. Production-grade prompt injection defenses (output filtering, classifier-based detection, etc.) are not needed.

---

## What's deliberately not in scope

The following protections would matter for a real product but are overkill for a portfolio piece. Listed here so future-Mona doesn't forget _why_ they're absent.

- User authentication (no accounts, no PII concern)
- GDPR/CCPA compliance (no user data stored beyond session)
- Penetration testing
- DDoS protection beyond what Vercel provides by default
- Audit logging
- Backups (the dataset is in git; nothing else needs backing up)
- Disaster recovery
- SLA monitoring

If the demo somehow becomes a real product later, revisit this list.

---

## Pre-launch checklist

Before flipping the demo public:

### Security

- [ ] `.env.local` is gitignored, no keys in repo history
- [ ] Vercel env vars set for all environments
- [ ] All API calls happen server-side only
- [ ] Demo key is set and saved somewhere personal

### Limits

- [ ] All five layers of usage limits are implemented
- [ ] Anthropic console hard limit is set ($75/mo)
- [ ] Graceful degradation tested for each limit
- [ ] Demo override works and bypasses only what it should

### Monitoring

- [ ] `/admin` page works and is protected
- [ ] Anthropic dashboard bookmarked
- [ ] First-week monitoring plan: check daily for the first 7 days

### Failure modes

- [ ] Tested: what happens at session cap?
- [ ] Tested: what happens at rate limit?
- [ ] Tested: what happens at budget cap?
- [ ] Tested: what happens during Anthropic API outage?
- [ ] Tested: what happens with a clear prompt injection attempt?

If any of these aren't true, don't ship publicly.