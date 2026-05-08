// The agent loop. Wires the four tools to Anthropic's tool-use API and runs
// the standard agentic loop until the model returns a text response or hits
// one of the safety caps from CLAUDE.md / docs/02_guardrails.md.
//
// Caps enforced here:
//   - MAX_ITERATIONS         catches infinite tool-use loops
//   - MAX_TOOL_CALLS         caps total tool calls per user turn
//   - MAX_OUTPUT_TOKENS      per-response output cap
// Per-IP and per-budget caps live in the route handler, not here.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import {
  filter_plants,
  get_plant_details,
  compare_plants,
  explain_failure_modes,
} from './tools.ts';
import type { Plant, ToolResult, TraceEntry, AgentUsage } from './types.ts';

// --- Constants ---

export const MODEL = 'claude-sonnet-4-6';
export const MAX_ITERATIONS = 8;
export const MAX_TOOL_CALLS_PER_TURN = 6;
export const MAX_OUTPUT_TOKENS = 800;

// --- System prompt ---
// Loaded from docs/04_agent_system_prompt.md so the markdown file remains the
// source of truth. We extract the first triple-backtick code block.

function loadSystemPrompt(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const promptPath = resolve(__dirname, '..', 'docs', '04_agent_system_prompt.md');
  const md = readFileSync(promptPath, 'utf-8');
  // Match the first ```\n...\n``` block. The doc places explanatory prose
  // before the prompt, so the first code block is always the prompt.
  const match = md.match(/```\n([\s\S]*?)\n```/);
  if (!match || !match[1]) {
    throw new Error(`Could not extract prompt from ${promptPath}`);
  }
  return match[1];
}

export const SYSTEM_PROMPT = loadSystemPrompt();

// --- Tool definitions for the Anthropic API ---
// Mirrors the input shapes in lib/tools.ts. The agent sees these definitions
// and emits tool_use blocks; we dispatch them in callTool below.

const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'filter_plants',
    description:
      'Filter the plant dataset by hard constraints and rank the survivors by soft preferences. ' +
      'Returns up to `limit` matches sorted by fit_score, plus plants filtered out only because ' +
      'their pet_safety is unverified (so you can offer them with a caveat).',
    input_schema: {
      type: 'object',
      properties: {
        hard_constraints: {
          type: 'object',
          description:
            'Constraints that filter plants out. Use these for "must-have" attributes the user signaled clearly.',
          properties: {
            pet_safe: {
              type: 'string',
              enum: ['yes', 'no', 'unknown'],
              description:
                'Set to "yes" if the user has pets and needs safe plants. Plants with pet_safe="unknown" will be filtered out but surfaced separately.',
            },
            light: {
              type: 'array',
              items: { type: 'string', enum: ['low', 'medium', 'bright', 'direct'] },
              description: 'Allowed light levels. e.g. ["low", "medium"] for low-light apartment.',
            },
            water: {
              type: 'array',
              items: { type: 'string', enum: ['low', 'moderate', 'high'] },
              description:
                'Use as hard only when user explicitly signals (e.g. "I forget to water" → ["low"]).',
            },
            size: {
              type: 'array',
              items: { type: 'string', enum: ['small', 'medium', 'large'] },
            },
            difficulty: {
              type: 'array',
              items: { type: 'string', enum: ['easy', 'medium', 'expert'] },
              description: 'Use as hard only when user explicitly says they are new to plants.',
            },
            category: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['tropical', 'succulent', 'trailing', 'tree-floor', 'fern', 'palm', 'flowering'],
              },
            },
          },
        },
        preferences: {
          type: 'object',
          description: 'Soft preferences that score-but-include. Use for nice-to-have signals.',
          properties: {
            vibe: { type: 'array', items: { type: 'string' } },
            best_for: { type: 'array', items: { type: 'string' } },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'expert'] },
            water: { type: 'string', enum: ['low', 'moderate', 'high'] },
            size: { type: 'string', enum: ['small', 'medium', 'large'] },
          },
        },
        name_query: {
          type: 'string',
          description:
            'Free-text plant name search. Fuzzy-matches against common name, scientific name, and aliases. Use whenever the user names a specific plant (e.g. "do you have a snake plant?", "tell me about the Lipstick Plant", "is Hoya in your dataset?") — this is how you check whether a named plant is in the catalog.',
        },
        exclude_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Plant ids to exclude (e.g. ones already recommended in this conversation).',
        },
        limit: {
          type: 'integer',
          description: 'Max matches to return. Default 5.',
        },
      },
    },
  },
  {
    name: 'get_plant_details',
    description: 'Get the full record for one plant by id. Use after filter_plants returns matches.',
    input_schema: {
      type: 'object',
      properties: {
        plant_id: { type: 'string' },
      },
      required: ['plant_id'],
    },
  },
  {
    name: 'compare_plants',
    description:
      'Compare 2 or 3 plants side-by-side. Returns full plant records and a per-dimension comparison ' +
      'highlighting where they agree (all_same: true) vs differ.',
    input_schema: {
      type: 'object',
      properties: {
        plant_ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 3,
        },
      },
      required: ['plant_ids'],
    },
  },
  {
    name: 'explain_failure_modes',
    description:
      "Get the common ways a plant fails, plus context-specific warnings if you pass user_situation. " +
      "Use when the user has killed plants before, asks about risks, or you want to flag a fit issue.",
    input_schema: {
      type: 'object',
      properties: {
        plant_id: { type: 'string' },
        user_situation: {
          type: 'string',
          description:
            'Free-text describing the user\'s situation, e.g. "I travel a lot" or "north window, dry winter air".',
        },
      },
      required: ['plant_id'],
    },
  },
  {
    name: 'set_followups',
    description:
      'Declare the follow-up chip suggestions for this turn. Call exactly once per turn, near the end, ' +
      'with 3-5 chip strings. Chips appear as clickable buttons under your response — use common plant ' +
      "names, never scientific. The final chip should be a meaningful 'other' answer or an exploration " +
      "hook, never a generic free-form prompt (the text input handles that). This tool doesn't count " +
      'against the per-turn tool-call cap.',
    input_schema: {
      type: 'object',
      properties: {
        chips: {
          type: 'array',
          items: { type: 'string', maxLength: 60 },
          minItems: 3,
          maxItems: 5,
          description: 'Chip strings, each ≤ 60 characters.',
        },
      },
      required: ['chips'],
    },
  },
];

// Tools that count toward MAX_TOOL_CALLS_PER_TURN. set_followups is excluded
// because it's a UI delivery mechanism, not "doing work" — capping it would
// punish well-behaved responses.
const COUNTABLE_TOOLS = new Set([
  'filter_plants',
  'get_plant_details',
  'compare_plants',
  'explain_failure_modes',
]);

// --- Tool dispatch ---

type AnyToolResult = ToolResult<unknown>;

function callTool(name: string, input: unknown): AnyToolResult {
  switch (name) {
    case 'filter_plants':
      return filter_plants(input as Parameters<typeof filter_plants>[0]);
    case 'get_plant_details':
      return get_plant_details(input as Parameters<typeof get_plant_details>[0]);
    case 'compare_plants':
      return compare_plants(input as Parameters<typeof compare_plants>[0]);
    case 'explain_failure_modes':
      return explain_failure_modes(input as Parameters<typeof explain_failure_modes>[0]);
    case 'set_followups':
      // No-op tool — the agent loop captures the chips out of the input. We
      // return ok so the loop continues to the agent's text turn.
      return { ok: true, data: { recorded: true } };
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

// --- Result type ---
// (TraceEntry and AgentUsage live in lib/types.ts because the client renders
// them too — agent.ts uses node:fs at load and isn't safe to import from a
// client component.)

export type AgentResult = {
  // Final assistant text the chat panel should render.
  response: string;
  // Tool-call trace for the observability panel.
  trace: TraceEntry[];
  // Plants the agent surfaced this turn (from get_plant_details / compare_plants).
  // Deduped by id, in the order they were fetched. Rendered as cards inline in
  // the assistant's message at {{card:id}} marker positions.
  cards: Plant[];
  // Follow-up chip suggestions from the agent's set_followups call. Empty when
  // the agent didn't call set_followups (treat as "no chips this turn").
  suggested_chips: string[];
  // Token usage for this turn (sum across all loop iterations).
  usage: AgentUsage;
  // Updated message history including this turn. Client persists and sends back next turn.
  messages: Anthropic.MessageParam[];
  // Why the loop stopped. Useful for the UI when a cap was hit.
  stop_reason: 'end_turn' | 'iteration_cap' | 'tool_call_cap' | 'unexpected';
  // When a guardrail trips before the agent can run, the route handler returns
  // a synthetic AgentResult with `cap_hit` set. The client uses this to disable
  // the input. Absent on normal turns.
  cap_hit?: 'daily' | 'monthly' | 'rate_limit';
};

// --- Helpers ---

function summarizeToolOutput(name: string, result: AnyToolResult): string {
  if (!result.ok) return `error: ${result.error}`;
  const data = result.data as Record<string, unknown>;
  switch (name) {
    case 'filter_plants': {
      const matches = (data['matches'] as { plant_id: string; fit_score: number }[]) ?? [];
      const total = (data['total_matches'] as number) ?? 0;
      const unknownCount = ((data['unknown_safety_excluded'] as unknown[]) ?? []).length;
      const top = matches[0];
      const topNote = top ? `, top: ${top.plant_id} (${top.fit_score})` : '';
      const unknownNote = unknownCount > 0 ? `, ${unknownCount} unverified-safety` : '';
      return `${total} match${total === 1 ? '' : 'es'}${topNote}${unknownNote}`;
    }
    case 'get_plant_details': {
      const plant = data['plant'] as { id: string } | undefined;
      return plant ? `returned details for ${plant.id}` : 'returned details';
    }
    case 'compare_plants': {
      const plants = (data['plants'] as { id: string }[]) ?? [];
      return `compared ${plants.length} plants: ${plants.map((p) => p.id).join(', ')}`;
    }
    case 'explain_failure_modes': {
      const failures = (data['failure_modes'] as string[]) ?? [];
      const warnings = (data['contextual_warnings'] as string[]) ?? [];
      return `${failures.length} failure modes, ${warnings.length} contextual warning${warnings.length === 1 ? '' : 's'}`;
    }
    default:
      return 'ok';
  }
}

// Extract the text portion of a single assistant turn. The model can mix text
// blocks and tool_use blocks in the same response; we only want the prose.
function textFromContent(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// Plants the agent surfaced via get_plant_details / compare_plants. We deduplicate
// in case the agent fetched the same plant twice (rare but cheap to guard).
function extractCards(toolName: string, result: AnyToolResult): Plant[] {
  if (!result.ok) return [];
  if (toolName === 'get_plant_details') {
    return [(result.data as { plant: Plant }).plant];
  }
  if (toolName === 'compare_plants') {
    return (result.data as { plants: Plant[] }).plants;
  }
  return [];
}

// The Anthropic API rejects future requests where a tool_use block has no
// matching tool_result. Our cap-hit / iteration-cap / unexpected return paths
// can leave the last assistant turn with unresolved tool_use blocks, since we
// short-circuit before executing the tools. Strip them out so the next turn
// doesn't 400. The agent loses some tool intent, but the conversation history
// stays valid and the user can retry.
function sanitizeMessages(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (last?.role !== 'assistant' || !Array.isArray(last.content)) return messages;
  const cleaned = last.content.filter((b) => b.type !== 'tool_use');
  if (cleaned.length === last.content.length) return messages; // no-op
  // If stripping leaves empty content, drop a placeholder so the API doesn't
  // reject an empty assistant turn either.
  const finalContent =
    cleaned.length > 0
      ? cleaned
      : ([{ type: 'text', text: '[response truncated]' }] as Anthropic.ContentBlockParam[]);
  return [
    ...messages.slice(0, -1),
    { role: 'assistant', content: finalContent },
  ];
}

// --- The loop ---

export async function runAgent(
  client: Anthropic,
  priorMessages: Anthropic.MessageParam[],
  userMessage: string,
): Promise<AgentResult> {
  const messages: Anthropic.MessageParam[] = [
    ...priorMessages,
    { role: 'user', content: userMessage },
  ];
  const trace: TraceEntry[] = [];
  const cards: Plant[] = [];
  let suggestedChips: string[] = [];
  // Accumulate text across iterations. The model often emits its prose in the
  // SAME response as a tool_use block (e.g. text + set_followups), then the
  // next iteration is just an end_turn with no further text. Reading only the
  // final iteration would silently drop the actual response.
  const responseChunks: string[] = [];
  const usage: AgentUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let totalToolCalls = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      // cache_control on system caches tools+system together. Below the 2048
      // Sonnet 4.6 threshold today, but harmless if it doesn't trigger.
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      tools: TOOL_DEFS,
      messages,
    });

    usage.input_tokens += res.usage.input_tokens;
    usage.output_tokens += res.usage.output_tokens;
    usage.cache_creation_input_tokens += res.usage.cache_creation_input_tokens ?? 0;
    usage.cache_read_input_tokens += res.usage.cache_read_input_tokens ?? 0;

    // Append the assistant turn (full content, including any tool_use blocks)
    // so the next API call has the complete history.
    messages.push({ role: 'assistant', content: res.content });

    // Capture any text emitted in this iteration before deciding what's next.
    const iterText = textFromContent(res.content);
    if (iterText) responseChunks.push(iterText);

    if (res.stop_reason === 'end_turn') {
      // Reliability backstop: if the agent finished without calling set_followups,
      // make a single forced call so the UI always has chips. Sonnet sometimes
      // prefers to embed answer options as markdown bullets in prose despite
      // the prompt — forcing the tool fixes this deterministically.
      if (suggestedChips.length === 0) {
        // Sonnet 4.6 rejects API calls that end on an assistant message, so
        // append a synthetic user nudge. We do NOT save this nudge to the
        // returned `messages` history — it's local to this side query.
        const nudgedMessages: Anthropic.MessageParam[] = [
          ...messages,
          {
            role: 'user',
            content: 'Now call set_followups with chips for your last response.',
          },
        ];
        try {
          const forced = await client.messages.create({
            model: MODEL,
            max_tokens: 256,
            system: [
              { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
            ],
            tools: TOOL_DEFS,
            tool_choice: { type: 'tool', name: 'set_followups' },
            messages: nudgedMessages,
          });
          usage.input_tokens += forced.usage.input_tokens;
          usage.output_tokens += forced.usage.output_tokens;
          usage.cache_creation_input_tokens += forced.usage.cache_creation_input_tokens ?? 0;
          usage.cache_read_input_tokens += forced.usage.cache_read_input_tokens ?? 0;
          for (const block of forced.content) {
            if (block.type === 'tool_use' && block.name === 'set_followups') {
              const input = block.input as { chips?: unknown };
              if (Array.isArray(input.chips)) {
                suggestedChips = input.chips.filter((c): c is string => typeof c === 'string');
                trace.push({
                  tool: 'set_followups',
                  input: { chips: suggestedChips },
                  summary: 'ok (forced fallback)',
                  ok: true,
                });
              }
            }
          }
        } catch (e) {
          // Best-effort: ship the response without chips if the forced call fails.
          console.error('[agent] forced fallback failed:', (e as Error).message);
        }
      }
      return {
        response: responseChunks.join('\n\n'),
        trace,
        cards,
        suggested_chips: suggestedChips,
        usage,
        messages,
        stop_reason: 'end_turn',
      };
    }

    if (res.stop_reason === 'tool_use') {
      const toolUses = res.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      // Hard cap on tool calls per user turn — but only counting "real" tools.
      // set_followups doesn't pull data so it doesn't count.
      const newCountable = toolUses.filter((t) => COUNTABLE_TOOLS.has(t.name)).length;
      if (totalToolCalls + newCountable > MAX_TOOL_CALLS_PER_TURN) {
        return {
          response:
            responseChunks.join('\n\n') ||
            "I've gathered enough to answer — let me know if you want me to dig further.",
          trace,
          cards,
          suggested_chips: suggestedChips,
          usage,
          messages: sanitizeMessages(messages),
          stop_reason: 'tool_call_cap',
        };
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const result = callTool(tu.name, tu.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
          is_error: !result.ok,
        });
        trace.push({
          tool: tu.name,
          input: tu.input as Record<string, unknown>,
          summary: summarizeToolOutput(tu.name, result),
          ok: result.ok,
        });
        // Collect card-worthy plants. Dedup by id so the chat doesn't show
        // the same plant twice if the agent fetches it more than once.
        for (const plant of extractCards(tu.name, result)) {
          if (!cards.some((c) => c.id === plant.id)) cards.push(plant);
        }
        // Capture follow-up chips. If set_followups is called more than once,
        // the latest call wins — the agent has had a chance to revise.
        if (tu.name === 'set_followups' && result.ok) {
          const input = tu.input as { chips?: unknown };
          if (Array.isArray(input.chips)) {
            suggestedChips = input.chips.filter((c): c is string => typeof c === 'string');
          }
        }
        if (COUNTABLE_TOOLS.has(tu.name)) totalToolCalls++;
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Any other stop_reason (max_tokens, refusal, etc.) — return what we have.
    return {
      response:
        responseChunks.join('\n\n') ||
        "Something went sideways on my end — try rephrasing?",
      trace,
      cards,
      suggested_chips: suggestedChips,
      usage,
      messages: sanitizeMessages(messages),
      stop_reason: 'unexpected',
    };
  }

  // Fell off the iteration cap. Return a graceful response, prefixed with any
  // text the agent did accumulate so we don't lose its work.
  return {
    response:
      responseChunks.join('\n\n') ||
      "I'm running long on this one — let me know if you'd like to refine the search or pick from what I've found.",
    trace,
    cards,
    suggested_chips: suggestedChips,
    usage,
    messages: sanitizeMessages(messages),
    stop_reason: 'iteration_cap',
  };
}
