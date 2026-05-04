
**Status:** v1 - source of truth for the build (24-hour ship target) **Owner:** Mona **Last updated:** May 4, 2026

---

## Ship target: 24 hours

This PRD is scoped for shipping a live, working v1 in 24 hours. Polish and the deferred features below come in v1.1 once v1 is publicly accessible.

The goal is **a real working artifact at a public URL within 24 hours**, not a polished demo.

---

## The product in one paragraph

A web-based agentic chat that helps users find a houseplant that fits their life. Left side: a conversational chat with the agent. Right side: a simple observability panel showing the agent's tool calls and reasoning. The agent has access to a curated dataset of ~120 popular houseplants and a small toolset for filtering, comparing, and explaining recommendations. Real LLM calls, real tool execution, real data.

---

## v1 cuts (deliberately deferred to v1.1)

The following are explicitly **not in v1**. Claude Code should not implement these:

- **No streaming responses.** The full agent response renders after the agent loop completes. Users see a "thinking..." state until the response arrives.
- **No styled observability cards.** The right panel is a plain chronological list of tool calls and their results. Plain text, monospace font, basic spacing. No color coding, no timing badges, no animation.
- **No admin/monitoring page.** Cost monitoring happens via the Anthropic console and Vercel logs. The `/admin` route from the guardrails doc is deferred.
- **No mobile design beyond "doesn't break."** Desktop-first. Mobile users see a stacked layout that works but isn't optimized.
- **No custom domain.** Use the default `.vercel.app` URL.
- **No fancy loading or error state designs.** Functional text-only states are fine.

These are real cuts, not "nice-to-haves we'll get to." Building them in v1 would push past 24 hours.

---

## What the user does

A visitor arrives at the URL. They see a split-pane layout: chat on the left (~60% on desktop), simple observability list on the right (~40%). The chat opens with a welcome message and four suggested chips. The user either taps a chip or types freely. The agent responds with the tool calls visible in the right panel and a recommendation in the chat - typically 2-3 plants with images, key attributes, and short reasoning. The user can ask follow-ups, change constraints, or compare plants.

---

## The opening state

### Welcome message

> Hi! I'm a houseplant matchmaker. Tell me about your space and how attentive you'll actually be, and I'll suggest plants you'll keep alive.

### Suggested chips (4)

1. "I'm a beginner, where do I start?"
2. "Show me low-light options"
3. "What's safe for pets?"
4. "I want something striking"

### Empty observability panel

On load, the right panel shows a placeholder line: "Tool calls and reasoning will appear here as you chat."

---

## The dataset

### Source approach

1. **Primary:** Try Kaggle "Indoor House Plants Dataset with Care Instructions" first - if it has lifestyle tags pre-attached, use it directly
2. **Fallback:** Perenual API for base data + images, plus a one-pass LLM enrichment for lifestyle attributes
3. **Schema reference:** Mirror PlantFinder.org's implicit schema since it's validated

### Target size

**~120 plants for v1.** PlantFinder uses ~115 - this is a validated number for the use case. Enough variety, small enough to fit in a single JSON file with no DB.

### Schema per plant

```
{
  id: "spider_plant",
  common_name: "Spider Plant",
  scientific_name: "Chlorophytum comosum",
  also_known_as: ["Airplane Plant"],
  image_url: "https://...",
  light: "low" | "medium" | "bright",
  water_tolerance: "rarely" | "weekly" | "often",
  pet_safe: true | false,
  size: "desk" | "corner" | "floor",
  difficulty: "beginner" | "some_experience" | "expert",
  vibe: ["lush", "trailing"],
  best_for: ["forgetful_waterers", "pet_owners", "low_light_homes"],
  air_purifying: true | false,
  flowering: true | false,
  short_description: "A forgiving classic with arching variegated leaves...",
  failure_modes: ["overwatering", "direct_sun_burns_tips"]
}
```

### Image strategy

Store image URLs only. Source from Perenual or Wikimedia Commons. No image hosting on your side.

---

## The six dimensions (validated by PlantFinder)

|Dimension|Values|
|---|---|
|Light|low / medium / bright|
|Water tolerance|rarely / weekly / often|
|Pets|yes-chew / yes-ignore / no|
|Space|desk / corner / floor|
|Experience|beginner / some / expert|
|Priority|looks / air-purifying / hardiness / flowers|

Plus 2 agentic-only dimensions:

- **Vibe**: sculptural, lush, trailing, statement, classic, quirky
- **Failure mode forgiveness**

---

## The toolset (4 tools, locked)

### 1. `filter_plants`

Filter the dataset by dimensions. Returns ranked matches.

```
Input: {
  light?: "low" | "medium" | "bright" | "any",
  water_tolerance?: "rarely" | "weekly" | "often" | "any",
  pet_safe?: true | false | null,
  size?: "desk" | "corner" | "floor" | "any",
  difficulty?: "beginner" | "some" | "expert" | "any",
  priority?: "looks" | "air_purifying" | "hardiness" | "flowers" | null,
  vibe?: string[] | null,
  exclude_ids?: string[]
}

Output: {
  matches: [{ plant_id, fit_score, reasons: string[] }],
  total_matches: number
}
```

### 2. `get_plant_details`

Full info on a specific plant.

### 3. `compare_plants`

Side-by-side for 2-3 plants.

### 4. `explain_failure_modes`

Common failures, optionally personalized to user situation.

**Out of scope for v1 (and v1.1):** plant identification from photos, care scheduling, pest diagnosis, real-time weather/season awareness, multi-plant collection planning.

---

## The simplified observability panel (v1)

### What it shows

A chronological list. Each entry is one of:

```
> Calling filter_plants
  light: low, pet_safe: true, difficulty: beginner
  → 8 matches

> Calling get_plant_details  
  plant_id: spider_plant
  → returned details

> Generating response...
```

That's it. Plain monospace text, basic indentation, no styling beyond that. New entries append at the bottom; the panel auto-scrolls.

### Token usage

A small footer at the bottom of the panel shows running totals:

```
Input tokens: 1,234 | Output: 456 | ~$0.02 this session
```

---

## The recommendation card

When the agent recommends plants, it returns them as cards inline in chat:

```
[Plant image, ~120px square, rounded corners]
Spider Plant
Chlorophytum Comosum

Easy care · Pet safe · Low-light tolerant

A forgiving classic. Arching leaves with white stripes,
tolerates neglect and low light. Almost impossible to kill.
```

Always 2-3 cards per recommendation, never just one. End with a brief follow-up question.

---

## Constraints

|Constraint|Limit|
|---|---|
|Max tool calls per user turn|6|
|Max conversation turns|12|
|Max input tokens per agent call|8K|
|Max output tokens per response|800|
|Rate limit per visitor|20 messages / hour|
|Total API budget cap|$50/month|

When limits hit: graceful degradation per the guardrails doc.

---

## Canonical interactions (test cases)

These four interactions must work end-to-end before shipping.

### Happy path #1: Beginner with constraints

User: "I have low-light apartment and a cat that chews everything" → Agent filters, returns 3 cards (Spider Plant, Parlor Palm, Boston Fern), follow-up question.

### Happy path #2: Comparison flow

User: "Yes, compare them on attention" → Agent compares, returns inline comparison, follow-up.

### Happy path #3: Open-ended messy query (the differentiator)

User: "I'm moving into a new place with a partner who's allergic to everything, north-facing windows, we want it to feel grown-up but not boring, and I will absolutely forget to water things" → Agent handles compound query, returns 2-3 cards with reasoning, follow-up.

### Edge case: "Just one plant"

User: "Just give me one plant to start with" → Agent returns a single recommendation (acceptable exception to the always-2-3 rule when explicitly asked).

---

## Tech stack (locked)

|Layer|Choice|
|---|---|
|Frontend|Next.js (App Router)|
|Language|TypeScript|
|Styling|Tailwind CSS|
|Backend|Next.js API routes (serverless)|
|LLM|Anthropic API (Claude Sonnet)|
|Data|Static JSON file in repo|
|Hosting|Vercel|
|Repo|GitHub (public)|

**Explicitly NOT using:** database, authentication, vector embeddings, streaming, image hosting on our side.

---

## File structure (target)

```
/portfolio-chat
  /app
    /api
      /chat
        route.ts
    layout.tsx
    page.tsx
  /components
    ChatPanel.tsx
    ObservabilityPanel.tsx
    PlantCard.tsx
    ChipButton.tsx
    WelcomeMessage.tsx
  /lib
    plants.json
    tools.ts
    agent.ts
    constraints.ts
    cost-tracker.ts
  /scripts
    enrich-plants.ts
  /docs
    00_project_context.md
    01_build_prd.md
    02_guardrails.md
    04_agent_system_prompt.md
  CLAUDE.md
  README.md
  .env.local
  .env.example
  .gitignore
```

---

## Definition of done

The build is **done** when all of these are true:

### Functional

- [ ] All four canonical interactions work end-to-end
- [ ] Recommendation cards render with images, tags, descriptions
- [ ] Observability panel updates after each turn (plain list format)
- [ ] All four tools work and produce sensible results
- [ ] Rate limit and budget caps work and degrade gracefully

### Quality

- [ ] No console errors in production
- [ ] Page loads in under 3 seconds
- [ ] First message response in under 5 seconds (no streaming, so this is harder)
- [ ] Images load reliably
- [ ] Doesn't break on mobile (stacked layout, functional)

### Deployment

- [ ] Live at a public Vercel URL (`.vercel.app` is fine for v1)
- [ ] GitHub repo is public, README explains what it is and links to live demo
- [ ] API key is in Vercel env vars, never in source code

### Portfolio integration

- [ ] Demo URL ready to share
- [ ] Repo URL ready to share

**Don't ship if:** any canonical interaction fails, the observability panel is broken, or the demo crashes on basic inputs.

---

## v1.1 priorities (after shipping)

In order of impact:

1. **Streaming responses** - biggest perceived-quality improvement
2. **Styled observability cards** - elevates the differentiator
3. **Mobile-optimized layout** - accessibility for half your viewers
4. **Admin/monitoring page** - operational visibility
5. **Custom domain** - polish for portfolio

Ship v1 first. Don't touch v1.1 until v1 is live and shareable.