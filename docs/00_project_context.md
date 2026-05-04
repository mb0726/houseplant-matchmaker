
**Status:** Topic locked, moving to build PRD **Owner:** Mona **Last updated:** May 4, 2026

---

## The idea in one sentence

Build a lean, agentic plant-matchmaking chat - chat panel on the left, observability panel on the right - hosted as a live, clickable artifact that proves I can compress idea-to-launch on agentic experiences.

## All locked decisions

|#|Decision|Rationale|
|---|---|---|
|1|Audience: builder signal for builder audiences|Leadership signal already covered by GrowthDay case studies|
|2|Headline claim: "I can scope and prototype agentic experiences"|Artifact is the proof|
|3|Greenfield use case, not GrowthDay rebuild|Onboarding quizzes are deterministic; would undermine agentic claim|
|4|**Topic: houseplant matchmaker**|Wholesome, universally legible, real constraint-matching, aligns with personal interests, agentic differentiation is clear|
|5|Build tier: Tier C (real LLM + real tool calls + real data)|The 30% who matter most for builder roles can tell. Agentic chat is the differentiator from existing quiz competitors|
|6|Build philosophy: lean, tight, fast MVP|Ship working before polishing. Iterate after|
|7|Hosting: Vercel + GitHub repo, both linked from portfolio|Standard pattern for shipped builder artifacts|
|8|Workflow: Claude (chat) = planner; Claude Code (CLI) = builder|Specialization without seven-agent overhead|
|9|Tooling stack: 6 things only|This Claude chat, Claude Code CLI, GitHub, Vercel, Anthropic API, plant data source|
|10|Observability mode is day-one, not polish|The actual differentiator|
|11|Value shape: performance + delight + quasi-useful|Not pure theater, not a real product. A polished demo-toy|
|12|Bounded dataset, not open internet|Predictable latency, predictable quality, lower cost, reliable demo|
|13|Leverage PlantFinder.org's validated structure|Saves a weekend of fundamental design wandering. Six dimensions are validated, schema is implicit, result format is proven|
|14|Differentiation lives in agentic capability, not topic novelty|Compound queries, follow-ups, constraint changes, visible reasoning, open-ended entry - things PlantFinder's quiz cannot do|

## Active scope guardrails

- MVP shippable in 2-3 weekends max
- No auth, no user accounts, no persistence
- Functional and clean UI, not designed
- ~100-150 plants in the dataset (not 500+)
- 4-6 tools max
- Show, don't tell, when prompting Claude Code
- API keys in Vercel env vars only

## What this artifact is NOT trying to be

- A real product, SaaS, or monetizable thing
- A polished startup demo
- A comprehensive plant care app
- A competitor to PlantFinder.org or The Sill

It's a portfolio piece. Its job is to make a hiring manager think "yes, she can do this."

## Workflow architecture

**Claude (this chat) = planner / system analyst:** PRD, architectural decisions, pushing back on scope creep, capturing decisions in `/portfolio_chat/` markdown files.

**Claude Code (CLI) = builder:** Code generation, file scaffolding, running and testing locally, git commits, Vercel deploys. Reads the planning docs as source of truth via a `CLAUDE.md` file in the repo.

## Decisions log

|Date|Decision|Rationale|
|---|---|---|
|2026-05-04|Project initiated|Workshopping with Claude as co-pilot|
|2026-05-04|Locked decisions 1-10 (workflow, tier, hosting, etc.)|See rationale column|
|2026-05-04|Locked decisions 11-14 (value shape, topic, leverage strategy)|Houseplants chosen after brainstorming, competitive analysis, and direct evaluation of PlantFinder.org|