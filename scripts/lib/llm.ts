// LLM enrichment for houseplant attributes.
//
// Uses Claude Sonnet 4.6 with tool use to extract a fixed schema of fields per
// plant. Tool use is the structured-output path: we define a single tool with
// strictly-typed inputs, force tool_choice to that tool, and read the validated
// arguments off the resulting tool_use block.
//
// Caching: the system prompt and tool definition are byte-identical across all
// ~100 plants, so we mark both for caching. Sonnet 4.6 has a 2048-token minimum
// cacheable prefix — the verbose schema + vocab below pushes us past that.

import Anthropic from '@anthropic-ai/sdk';
import type { FilteredPlant, EnrichedFields } from './types.ts';

export const MODEL = 'claude-sonnet-4-6';

// --- Controlled vocabularies ---
// Per the user's locked schema. Everything an enriched plant gets is drawn from
// these lists — the LLM can't invent new vibe/best_for/failure_mode strings.

export const CATEGORY_VALUES = [
  'tropical',
  'succulent',
  'trailing',
  'tree-floor',
  'fern',
  'palm',
  'flowering',
] as const;

export const LIGHT_VALUES = ['low', 'medium', 'bright', 'direct'] as const;
export const WATER_VALUES = ['low', 'moderate', 'high'] as const;
export const DIFFICULTY_VALUES = ['easy', 'medium', 'expert'] as const;
export const SIZE_VALUES = ['small', 'medium', 'large'] as const;

export const VIBE_VALUES = [
  'sculptural',
  'lush',
  'trailing',
  'minimalist',
  'statement',
  'delicate',
  'classic',
  'quirky',
  'tropical',
  'graphic',
  'soft',
  'structural',
] as const;

export const BEST_FOR_VALUES = [
  'beginners',
  'low-light homes',
  'busy people',
  'pet households',
  'bright sunny rooms',
  'bright indirect rooms',
  'small spaces',
  'statement floor plants',
  'hanging baskets',
  'trailing displays',
  'shelf or elevated planters',
  'humidity lovers',
  'low-effort decor',
  'office spaces',
  'bathrooms',
  'bedrooms',
] as const;

export const FAILURE_MODE_VALUES = [
  'overwatering',
  'underwatering',
  'root rot',
  'light burn',
  'low humidity damage',
  'cold draft sensitivity',
  'leaf scorch',
  'fungal issues',
  'spider mites',
  'mealybugs',
  'leaf drop from stress',
  'yellowing leaves',
  'brown crispy leaf tips',
] as const;

// --- Prompt + tool ---

const SYSTEM_PROMPT = `You are enriching a houseplant dataset that powers a recommendation chat for plant beginners. For each plant, you'll be given its scientific name, common name, also-known-as names, and three raw fields from a plant-care dataset: a coarse category, a short ideal-light description, and a watering instruction sentence.

Your job is to call set_plant_attributes with normalized values that match how a knowledgeable, honest plant-store employee would describe the plant to a customer.

GUIDELINES:

- Be honest about difficulty. Many plants marketed as "easy" are actually fussy about humidity, light, or watering rhythm. If a plant has notable failure modes for beginners, lean toward "medium" rather than "easy".
- Light: "low" means tolerates north-facing or interior rooms with no direct sun. "medium" means thrives in bright indirect light (a few feet from a sunny window). "bright" means very bright indirect light all day; tolerates a few hours of gentle morning sun. NOT full afternoon direct sun. "direct" means tolerates or wants several hours of full direct sun. Reserve "direct" for plants that genuinely want full direct sun (succulents, cacti, some euphorbias). When the Kaggle source says "Bright light," default to "bright" (indirect-leaning) unless the plant is a known direct-sun species. Don't take "Bright" to mean "direct sun" just because the words match.
- Water: "low" = drought-tolerant, weeks between waterings (succulents, ZZ, snake plant). "moderate" = water when top inch dry, roughly weekly. "high" = wants consistent moisture, ferns and humidity-lovers.
- Size: "small" = tabletop or shelf (under ~18in). "medium" = side table or stand (~18-36in). "large" = floor plant (3ft+).
- Category: pick the single best fit. "tree-floor" for medium-to-large plants with a trunk-like structure that go on the floor (Ficus, Dracaena, Yucca, Schefflera). "trailing" for vining plants (Pothos, Hoya, Philodendron hederaceum). "tropical" is the catch-all for broadleaf tropicals that aren't ferns/palms/trailers.
- Vibe: pick 1-3 from the enum. Think aesthetic, not function. "sculptural" for architectural plants, "lush" for full leafy ones, "delicate" for ferns and fine foliage, "statement" for big-leaf showstoppers.
- best_for: pick 1-3 from the enum. Match real strengths, and match the plant's growth habit. For trailing/vining plants (category: "trailing"), prefer "hanging baskets" or "trailing displays" over "statement floor plants." Reserve "statement floor plants" for upright plants with a trunk-like or sculptural floor presence (Ficus, Dracaena, Yucca, large palms). "beginners" only if genuinely forgiving. "pet households" only if safe (you'll be told if pet-safe info is available).
- failure_modes: pick 1-3 from the enum. The most common ways this plant dies for a typical owner.
- short_description: 1-2 sentences in the voice of a plant-knowledgeable friend. Lead with what's true about the plant, not adjectives. No filler. No "this beautiful plant" openings. Use plain, direct language — "fussy," "tough," "forgiving" rather than "particular," "robust," "tolerant." Sound like a friend, not a horticulture textbook.

Don't infer beyond what's reasonable from the inputs. If the Kaggle category and watering text disagree with general species knowledge, use general knowledge.`;

// JSON schema for the tool's input. Shape matches EnrichedFields exactly.
const ENRICH_TOOL: Anthropic.Tool = {
  name: 'set_plant_attributes',
  description:
    'Record the normalized attributes for one houseplant. Call exactly once per plant.',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: [...CATEGORY_VALUES] },
      light: { type: 'string', enum: [...LIGHT_VALUES] },
      water: { type: 'string', enum: [...WATER_VALUES] },
      difficulty: { type: 'string', enum: [...DIFFICULTY_VALUES] },
      size: { type: 'string', enum: [...SIZE_VALUES] },
      vibe: {
        type: 'array',
        items: { type: 'string', enum: [...VIBE_VALUES] },
        minItems: 1,
        maxItems: 3,
      },
      best_for: {
        type: 'array',
        items: { type: 'string', enum: [...BEST_FOR_VALUES] },
        minItems: 1,
        maxItems: 3,
      },
      failure_modes: {
        type: 'array',
        items: { type: 'string', enum: [...FAILURE_MODE_VALUES] },
        minItems: 1,
        maxItems: 3,
      },
      short_description: { type: 'string' },
    },
    required: [
      'category',
      'light',
      'water',
      'difficulty',
      'size',
      'vibe',
      'best_for',
      'failure_modes',
      'short_description',
    ],
  },
};

function buildUserMessage(p: FilteredPlant): string {
  const aka = p.also_known_as.length ? p.also_known_as.join(', ') : '(none)';
  return [
    `Common name: ${p.common_name}`,
    `Scientific name: ${p.scientific_name}`,
    `Also known as: ${aka}`,
    `Kaggle category: ${p.kaggle_category}`,
    `Kaggle ideal light: ${p.kaggle_ideallight}`,
    `Kaggle watering: ${p.kaggle_watering}`,
  ].join('\n');
}

export function makeClient(): Anthropic {
  if (!process.env['ANTHROPIC_API_KEY']) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env.local.');
  }
  // The SDK retries 429 / 5xx automatically; bump the default to handle bursty
  // rate limits during a 100-plant run.
  return new Anthropic({ maxRetries: 5 });
}

export type UsageStats = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export type EnrichResult = {
  fields: EnrichedFields;
  usage: UsageStats;
};

export async function enrichPlant(
  client: Anthropic,
  plant: FilteredPlant,
): Promise<EnrichResult> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [{ ...ENRICH_TOOL, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: ENRICH_TOOL.name },
    messages: [{ role: 'user', content: buildUserMessage(plant) }],
  });

  const toolUse = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === ENRICH_TOOL.name,
  );
  if (!toolUse) {
    throw new Error(
      `No tool_use block in response for ${plant.id}; stop_reason=${res.stop_reason}`,
    );
  }

  const input = toolUse.input as Record<string, unknown>;
  const fields: EnrichedFields = {
    id: plant.id,
    category: input['category'] as EnrichedFields['category'],
    light: input['light'] as EnrichedFields['light'],
    water: input['water'] as EnrichedFields['water'],
    difficulty: input['difficulty'] as EnrichedFields['difficulty'],
    size: input['size'] as EnrichedFields['size'],
    vibe: input['vibe'] as string[],
    best_for: input['best_for'] as string[],
    failure_modes: input['failure_modes'] as string[],
    short_description: input['short_description'] as string,
  };

  return {
    fields,
    usage: {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      cache_creation_input_tokens: res.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
    },
  };
}
