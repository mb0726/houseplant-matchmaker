# Houseplant Matchmaker

A small agentic chat that helps people pick a houseplant that fits their life.

**[Live demo →](https://your-demo-url.vercel.app/)** _(replace with actual URL after deploying)_

## What this is

A portfolio piece exploring agentic chat patterns. The interface is split: chat on the left, observability panel on the right. As the agent reasons through a recommendation, you can watch it plan, call its tools, and synthesize an answer.

It's intentionally narrow. The agent only knows about ~120 popular houseplants and has exactly four tools for working with them. Real LLM, real tool execution, real plant data - just kept tight on purpose.

## Why I built it

I wanted a working artifact that demonstrates how I think about scoping, building, and shipping agentic experiences - not just talking about them. The constraints (small dataset, focused use case, visible reasoning) are part of the point.

## How it works

The user describes their situation in plain language. The agent organizes its reasoning around six dimensions (light, water tolerance, pets, space, experience, priority) plus two qualitative ones (vibe and failure-mode forgiveness). It uses four tools to filter the dataset, compare options, and explain tradeoffs. Recommendations come back as cards with images, key attributes, and short reasoning.

The observability panel shows what the agent is doing in real time: which tools it calls, what comes back, how long it took, how many tokens were used. The point is to make agentic behavior legible rather than opaque.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Anthropic API (Claude Sonnet)
- Static JSON dataset (no database)
- Hosted on Vercel

## Try it

The live demo is linked above. A few things to try if you want to see the agent work hardest:

- A compound query: "I have a north-facing window, two cats, I travel a lot, and I want something that looks impressive"
- A constraint change: ask for low-light plants, then "what if I had more light"
- A comparison: pick two plants from a recommendation and ask the agent to compare them

## Limitations

Deliberate scope:

- ~120 plants only - this isn't a comprehensive plant database
- No accounts or persistence - every session is fresh
- No image analysis or care scheduling - just choosing a plant
- Rate limits exist to keep costs sane - if the demo seems slow or unavailable, that's likely why

## Local development

```bash
git clone [your-repo-url]
cd portfolio-chat
npm install
cp .env.example .env.local
# Add your ANTHROPIC_API_KEY to .env.local
npm run dev
```

## License

MIT