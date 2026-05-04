
**Note:** This is the content that should live as `CLAUDE.md` in the root of the GitHub repo when Mona starts building. It's the file Claude Code reads to understand the project. The version here in `/portfolio_chat/` is the reference; the version in the repo is what Claude Code actually uses.

---

# CLAUDE.md - Portfolio Chat (Houseplant Matchmaker)

## Your role

You are a focused builder. Your job is to implement the houseplant matchmaker chat as specified in the project documentation. You write clean, minimal, production-ready TypeScript and React. **The target is shipping a working v1 in 24 hours of focused work**, not a polished product. You do not over-engineer. You do not add features that aren't in the PRD. When in doubt, you ask before scope-creeping.

## Source of truth (read these first)

Before doing anything, read these documents in order:

1. **`docs/00_project_context.md`** - locked decisions and project context
2. **`docs/01_build_prd.md`** - full product spec, including the v1 cuts. Pay close attention to "v1 cuts" section.
3. **`docs/02_guardrails.md`** - cost, safety, and operational protections (non-negotiable)
4. **`docs/04_agent_system_prompt.md`** - the actual prompt for the agent

If something is ambiguous, ask. Do not guess.

## Critical: this is a 24-hour ship

The PRD has explicit v1 cuts. **Do not implement these in v1**:

- ❌ Streaming responses (full response renders after agent loop completes)
- ❌ Styled observability panel (plain chronological text list, monospace font, no cards/colors/animations)
- ❌ Admin/monitoring page (`/admin` route)
- ❌ Mobile design beyond "doesn't break"
- ❌ Custom domain
- ❌ Fancy loading or error state designs

These are deferred to v1.1. Building them in v1 pushes past 24 hours.

## What you're building

A web-based agentic chat that helps users find a houseplant. Split-pane layout: chat on the left, **simple text-based observability list** on the right. The agent has access to ~120 popular houseplants and exactly four tools. Real LLM calls (Claude Sonnet via Anthropic API), real tool execution, real data, hosted on Vercel.

## Tech stack (locked)

- **Framework:** Next.js (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **LLM:** Anthropic API, Claude Sonnet
- **Data:** Static JSON file (`/lib/plants.json`)
- **Hosting:** Vercel
- **State management:** React state only. No Redux, no Zustand.

## Coding conventions

- TypeScript strict mode on
- Functional components only, no class components
- Server-side code (API routes) for any LLM calls or secret-touching logic
- No client-side calls to Anthropic - browser only ever talks to your own `/api/chat` endpoint
- Prefer composition over abstraction
- Comment the _why_, not the _what_
- Keep components under 150 lines

## What NOT to build

In addition to the v1 cuts above, do not add:

- A database of any kind
- User authentication or accounts
- Vector embeddings or semantic search
- Plant identification from photos
- Multi-language support
- Analytics or tracking pixels beyond Vercel's defaults
- Email capture, signup flows, anything that asks the user for info
- More than four tools

If you find yourself wanting any of these, stop and ask.

## The four tools (do not add more)

1. `filter_plants` - filter the dataset, return ranked matches
2. `get_plant_details` - full info on a specific plant
3. `compare_plants` - side-by-side for 2-3 plants
4. `explain_failure_modes` - common failures, optionally personalized

Full spec is in `01_build_prd.md`. Implement in `/lib/tools.ts`. Each tool has TypeScript types, validates inputs, returns errors gracefully.

## The agent system prompt

Lives in `/lib/agent.ts`. Use the prompt content from `docs/04_agent_system_prompt.md` exactly. Don't modify the prompt without asking - it's been deliberately tuned.

## The agent loop

Standard tool-use loop:

1. User message arrives at `/api/chat` (POST)
2. Server validates request (rate limits, session cap, budget cap)
3. Server constructs message history + system prompt + new user message
4. Server calls Anthropic API with tools available
5. If response has tool calls, execute them and add results to conversation
6. Loop until model returns final text response (or hits 8 iteration cap)
7. Send full response + observability data back to client (no streaming for v1)

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
  .env.local              # gitignored
  .env.example            # committed
  .gitignore
```

## Build order (recommended for 24-hour ship)

If asked "where do I start," follow this order strictly:

1. **Scaffold the project** - Next.js init, Tailwind setup, repo init, .gitignore
2. **Set up the plant dataset** - get `plants.json` with ~120 plants, all required fields populated, image URLs working
3. **Build the four tools** - pure functions in `/lib/tools.ts`, basic unit tests
4. **Build the agent loop** - `/lib/agent.ts` and `/api/chat/route.ts`, test with curl first
5. **Build the chat UI** - `ChatPanel`, `WelcomeMessage`, `ChipButton`, basic message send/receive
6. **Build the simple observability panel** - `ObservabilityPanel`, plain text list of tool calls
7. **Build the recommendation card** - `PlantCard` with image, tags, description
8. **Implement guardrails** - rate limits, session caps, budget tracking, graceful degradation
9. **Test the four canonical interactions** - all must work end-to-end
10. **Deploy to Vercel** - set env vars, verify live URL works
11. **Final verification** - run through definition-of-done checklist

If you finish early, the v1.1 priorities (in order) are: streaming, styled observability cards, mobile optimization. Don't start any of these until everything in the v1 definition-of-done is checked.

## Definition of done

The full DoD lives in `01_build_prd.md`. Before claiming the build is complete, verify all checkboxes there are met.

## When in doubt

- **Don't over-engineer.** Ship something that works, then improve.
- **Don't add scope.** If a "small addition" feels obvious, it's probably scope creep.
- **Mona is the planner; you're the builder.** Build what the docs specify.
- **Speed over polish for v1.** A rough live demo beats a polished half-built one.

## What success looks like

A live URL where someone can land, type "I have low light and a cat," and get a thoughtful recommendation with visible tool calls in the right panel - in under 5 seconds. The repo is clean, the README links to the demo. The build took ~14-18 hours of focused work. None of the canonical interactions in the PRD fail.

That's the target. Ship there.