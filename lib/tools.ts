// The four tools the agent calls. Pure functions over the bundled plants.json.
// No I/O, no DI, no validation library — just typed inputs and ToolResult outputs.
//
// Hard vs. soft constraint split (see filter_plants):
//   hard_constraints  → exclude plants that don't match (filter)
//   preferences       → score-but-include (rank)
//
// The agent decides what's "hard" based on user phrasing. The tool just executes.

import plantsData from './plants.json' with { type: 'json' };
import type {
  Plant,
  Category,
  Light,
  Water,
  PetSafe,
  Difficulty,
  Size,
  ToolResult,
} from './types.ts';

const PLANTS: readonly Plant[] = plantsData as Plant[];

// =============================================================================
// filter_plants
// =============================================================================

export type FilterPlantsInput = {
  hard_constraints?: {
    pet_safe?: PetSafe;
    light?: Light[];
    water?: Water[];
    size?: Size[];
    difficulty?: Difficulty[];
    category?: Category[];
  };
  preferences?: {
    vibe?: string[];
    best_for?: string[];
    difficulty?: Difficulty;
    water?: Water;
    size?: Size;
  };
  // Fuzzy name search across common_name + scientific_name + also_known_as.
  // Use this when the user names a specific plant ("do you have a snake plant?",
  // "tell me about lipstick plant"). Combine with hard_constraints if needed.
  name_query?: string;
  exclude_ids?: string[];
  limit?: number; // default 5
};

export type FilterMatch = {
  plant_id: string;
  fit_score: number; // 0-100
  reasons: string[];
};

export type FilterPlantsOutput = {
  matches: FilterMatch[];
  total_matches: number;
  // Plants filtered out solely because pet_safe was 'unknown' when the user
  // demanded 'yes'. Surfaced separately so the agent can offer them with a
  // caveat ("plus 2 plants where toxicity is unverified — want me to include?").
  unknown_safety_excluded: { plant_id: string; common_name: string }[];
};

// --- Name-query fuzzy match ---
// Users phrase plant names in many ways: "lipstick plant" vs the dataset's
// "Lipstick"; "Mother-in-law's Tongue" vs "Snake plant"; "Hoya" (genus) vs
// "Wax plant". The match strategy:
//   1. normalize: lowercase, strip possessive 's, strip non-alphanumerics,
//      collapse whitespace
//   2. drop suffix stopwords ("plant", "tree", "vine", "flower") that users
//      append or omit interchangeably
//   3. depluralize tokens (poor man's stemming for "laws" → "law")
//   4. every remaining token must be a substring of the plant's haystack
//      (common_name + scientific_name + also_known_as, normalized)

const NAME_QUERY_STOPWORDS = new Set([
  'plant',
  'plants',
  'tree',
  'trees',
  'vine',
  'vines',
  'flower',
  'flowers',
  'the',
  'a',
  'an',
  'and',
  'or',
]);

function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/'s\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function depluralize(token: string): string {
  if (token.length >= 4 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

function plantHaystack(p: Plant): string {
  const parts = [p.common_name, p.scientific_name, ...(p.also_known_as ?? [])];
  return normalizeForSearch(parts.join(' '));
}

function plantMatchesNameQuery(p: Plant, query: string): boolean {
  const normalized = normalizeForSearch(query);
  if (!normalized) return true;
  const haystack = plantHaystack(p);
  const allTokens = normalized.split(' ').filter((t) => t.length >= 2);
  if (allTokens.length === 0) return false;
  // Try meaningful tokens first; if everything was a stopword, fall back to
  // the raw tokens (so "Plant" alone doesn't match every plant — it falls
  // back and matches against "plant" appearing in the haystack).
  const meaningful = allTokens.filter((t) => !NAME_QUERY_STOPWORDS.has(t));
  const searchTokens = (meaningful.length > 0 ? meaningful : allTokens).map(depluralize);
  return searchTokens.every((t) => haystack.includes(t));
}

function passesHardConstraints(
  p: Plant,
  hard: NonNullable<FilterPlantsInput['hard_constraints']>,
): { passes: boolean; safetyUnknownBlocked: boolean } {
  if (hard.light && hard.light.length > 0 && !hard.light.includes(p.light)) {
    return { passes: false, safetyUnknownBlocked: false };
  }
  if (hard.water && hard.water.length > 0 && !hard.water.includes(p.water)) {
    return { passes: false, safetyUnknownBlocked: false };
  }
  if (hard.size && hard.size.length > 0 && !hard.size.includes(p.size)) {
    return { passes: false, safetyUnknownBlocked: false };
  }
  if (hard.difficulty && hard.difficulty.length > 0 && !hard.difficulty.includes(p.difficulty)) {
    return { passes: false, safetyUnknownBlocked: false };
  }
  if (hard.category && hard.category.length > 0 && !hard.category.includes(p.category)) {
    return { passes: false, safetyUnknownBlocked: false };
  }
  // Pet safety has special handling: when the user demands 'yes', plants with
  // 'unknown' safety are filtered out but tracked separately so the agent can
  // offer them with a caveat. 'no' is a hard exclusion either way.
  if (hard.pet_safe === 'yes') {
    if (p.pet_safe === 'no') return { passes: false, safetyUnknownBlocked: false };
    if (p.pet_safe === 'unknown') return { passes: false, safetyUnknownBlocked: true };
  } else if (hard.pet_safe === 'no') {
    if (p.pet_safe !== 'no') return { passes: false, safetyUnknownBlocked: false };
  }
  return { passes: true, safetyUnknownBlocked: false };
}

// Distance between difficulty/water/size on a 0-2 ordinal scale.
const ORDINAL_INDEX = {
  difficulty: { easy: 0, medium: 1, expert: 2 } as const,
  water: { low: 0, moderate: 1, high: 2 } as const,
  size: { small: 0, medium: 1, large: 2 } as const,
};

function ordinalDistance<K extends keyof typeof ORDINAL_INDEX>(
  field: K,
  a: keyof (typeof ORDINAL_INDEX)[K],
  b: keyof (typeof ORDINAL_INDEX)[K],
): number {
  const idx = ORDINAL_INDEX[field] as Record<string, number>;
  return Math.abs(idx[a as string]! - idx[b as string]!);
}

function scorePreferences(
  p: Plant,
  prefs: NonNullable<FilterPlantsInput['preferences']>,
): { score: number; reasons: string[] } {
  // Base of 70 lets a "passing but no preferences match" plant land mid-pack;
  // perfect preference alignment caps at 100, complete misalignment floors at 0.
  let score = 70;
  const reasons: string[] = [];

  if (prefs.vibe && prefs.vibe.length > 0) {
    const matches = prefs.vibe.filter((v) => p.vibe.includes(v));
    if (matches.length > 0) {
      score += Math.min(15, matches.length * 6);
      reasons.push(`matches vibe: ${matches.join(', ')}`);
    }
  }

  if (prefs.best_for && prefs.best_for.length > 0) {
    const matches = prefs.best_for.filter((b) => p.best_for.includes(b));
    if (matches.length > 0) {
      score += Math.min(15, matches.length * 6);
      reasons.push(`good for: ${matches.join(', ')}`);
    }
  }

  if (prefs.difficulty) {
    const d = ordinalDistance('difficulty', prefs.difficulty, p.difficulty);
    if (d === 0) {
      score += 10;
      reasons.push(`exact difficulty match (${p.difficulty})`);
    } else if (d === 1) {
      // No score change — close enough.
    } else {
      score -= 10;
    }
  }

  if (prefs.water) {
    const d = ordinalDistance('water', prefs.water, p.water);
    if (d === 0) {
      score += 8;
      reasons.push(`watering rhythm matches (${p.water})`);
    } else if (d === 2) {
      score -= 8;
    }
  }

  if (prefs.size) {
    const d = ordinalDistance('size', prefs.size, p.size);
    if (d === 0) {
      score += 5;
      reasons.push(`size matches (${p.size})`);
    } else if (d === 2) {
      score -= 5;
    }
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function buildBaseReasons(p: Plant, hard: FilterPlantsInput['hard_constraints']): string[] {
  // Reasons cover *why* a plant fits. Hard constraint matches go in here —
  // they're the most user-relevant facts.
  const reasons: string[] = [];
  if (hard?.pet_safe === 'yes' && p.pet_safe === 'yes') {
    reasons.push('pet-safe');
  }
  if (hard?.light && hard.light.length > 0 && hard.light.includes(p.light)) {
    reasons.push(`tolerates ${p.light} light`);
  }
  return reasons;
}

export function filter_plants(input: FilterPlantsInput): ToolResult<FilterPlantsOutput> {
  const hard = input.hard_constraints ?? {};
  const prefs = input.preferences ?? {};
  const exclude = new Set(input.exclude_ids ?? []);
  const limit = input.limit ?? 5;

  const matches: FilterMatch[] = [];
  const safetyUnknown: { plant_id: string; common_name: string }[] = [];

  const nameQuery = input.name_query?.trim() ?? '';

  for (const p of PLANTS) {
    if (exclude.has(p.id)) continue;
    if (nameQuery && !plantMatchesNameQuery(p, nameQuery)) continue;
    const { passes, safetyUnknownBlocked } = passesHardConstraints(p, hard);
    if (!passes) {
      if (safetyUnknownBlocked) {
        safetyUnknown.push({ plant_id: p.id, common_name: p.common_name });
      }
      continue;
    }
    const { score, reasons: prefReasons } = scorePreferences(p, prefs);
    const reasons = [...buildBaseReasons(p, hard), ...prefReasons];
    matches.push({ plant_id: p.id, fit_score: score, reasons });
  }

  // Sort by fit_score desc, then id asc for deterministic tie-breaking.
  matches.sort((a, b) => b.fit_score - a.fit_score || a.plant_id.localeCompare(b.plant_id));

  return {
    ok: true,
    data: {
      matches: matches.slice(0, limit),
      total_matches: matches.length,
      unknown_safety_excluded: safetyUnknown,
    },
  };
}

// =============================================================================
// get_plant_details
// =============================================================================

export type GetPlantDetailsInput = { plant_id: string };
export type GetPlantDetailsOutput = { plant: Plant };

export function get_plant_details(
  input: GetPlantDetailsInput,
): ToolResult<GetPlantDetailsOutput> {
  const plant = PLANTS.find((p) => p.id === input.plant_id);
  if (!plant) {
    return { ok: false, error: `No plant found with id "${input.plant_id}".` };
  }
  return { ok: true, data: { plant } };
}

// =============================================================================
// compare_plants
// =============================================================================

export type ComparePlantsInput = { plant_ids: string[] };
export type ComparePlantsOutput = {
  plants: Plant[];
  // Per-dimension comparison rows. `same: true` when every plant has the
  // same value on that dimension — useful for the agent to highlight points
  // of difference rather than listing identical attributes 3 times.
  dimensions: {
    field: keyof Plant;
    values: { plant_id: string; value: string }[];
    all_same: boolean;
  }[];
};

const COMPARE_FIELDS: (keyof Plant)[] = [
  'category',
  'light',
  'water',
  'pet_safe',
  'difficulty',
  'size',
];

export function compare_plants(input: ComparePlantsInput): ToolResult<ComparePlantsOutput> {
  if (input.plant_ids.length < 2 || input.plant_ids.length > 3) {
    return {
      ok: false,
      error: `compare_plants accepts 2 or 3 plant ids (got ${input.plant_ids.length}).`,
    };
  }
  const plants: Plant[] = [];
  const missing: string[] = [];
  for (const id of input.plant_ids) {
    const p = PLANTS.find((q) => q.id === id);
    if (!p) missing.push(id);
    else plants.push(p);
  }
  if (missing.length > 0) {
    return { ok: false, error: `Unknown plant id(s): ${missing.join(', ')}.` };
  }

  const dimensions = COMPARE_FIELDS.map((field) => {
    const values = plants.map((p) => ({
      plant_id: p.id,
      value: String(p[field]),
    }));
    const all_same = values.every((v) => v.value === values[0]!.value);
    return { field, values, all_same };
  });

  return { ok: true, data: { plants, dimensions } };
}

// =============================================================================
// explain_failure_modes
// =============================================================================

export type ExplainFailureModesInput = {
  plant_id: string;
  user_situation?: string; // free text, e.g. "I forget to water" or "north window"
};

export type ExplainFailureModesOutput = {
  plant_id: string;
  common_name: string;
  failure_modes: string[];
  // Personalized observations triggered by user_situation keywords.
  contextual_warnings: string[];
};

// Pattern → warning rules. Each rule fires when both the user's situation
// matches the regex AND the plant has the relevant attribute. Order matters:
// the more specific patterns appear first.
type WarningRule = {
  pattern: RegExp;
  predicate: (p: Plant) => boolean;
  warning: (p: Plant) => string;
};

const WARNING_RULES: WarningRule[] = [
  {
    pattern: /\b(forget|busy|travel|away|neglect)\b/i,
    predicate: (p) => p.water === 'high',
    warning: (p) =>
      `${p.common_name} wants consistent moisture — likely to suffer if you forget for more than a few days.`,
  },
  {
    pattern: /\b(overwater|too\s+much\s+water|heavy\s+water)\b/i,
    predicate: (p) =>
      p.failure_modes.includes('overwatering') || p.failure_modes.includes('root rot'),
    warning: (p) =>
      `${p.common_name} is sensitive to overwatering — let the soil dry between waterings.`,
  },
  {
    pattern: /\b(low\s*light|north\s*window|dim|interior\s*room|dark)\b/i,
    predicate: (p) => p.light === 'bright' || p.light === 'direct',
    warning: (p) =>
      `${p.common_name} needs ${p.light} light — it'll likely struggle in low-light conditions and may stretch or drop leaves.`,
  },
  {
    pattern: /\b(dry\s*air|heater|radiator|winter|low\s*humidity)\b/i,
    predicate: (p) => p.failure_modes.includes('low humidity damage'),
    warning: (p) =>
      `${p.common_name} dislikes dry air — expect crispy leaf edges if humidity stays low.`,
  },
  {
    pattern: /\b(draft|cold|near\s*window|chilly)\b/i,
    predicate: (p) => p.failure_modes.includes('cold draft sensitivity'),
    warning: (p) => `${p.common_name} is cold-sensitive — keep it away from drafty windows.`,
  },
  {
    pattern: /\b(cat|dog|pet|chew)\b/i,
    predicate: (p) => p.pet_safe === 'no',
    warning: (p) => `${p.common_name} is toxic to pets — not a fit if your pet chews plants.`,
  },
  {
    pattern: /\b(cat|dog|pet|chew)\b/i,
    predicate: (p) => p.pet_safe === 'unknown',
    warning: (p) =>
      `Pet-safety for ${p.common_name} is not verified in our reference data — check with a vet before bringing it into a pet household.`,
  },
];

export function explain_failure_modes(
  input: ExplainFailureModesInput,
): ToolResult<ExplainFailureModesOutput> {
  const plant = PLANTS.find((p) => p.id === input.plant_id);
  if (!plant) {
    return { ok: false, error: `No plant found with id "${input.plant_id}".` };
  }
  const contextual: string[] = [];
  if (input.user_situation && input.user_situation.trim().length > 0) {
    for (const rule of WARNING_RULES) {
      if (rule.pattern.test(input.user_situation) && rule.predicate(plant)) {
        contextual.push(rule.warning(plant));
      }
    }
  }
  return {
    ok: true,
    data: {
      plant_id: plant.id,
      common_name: plant.common_name,
      failure_modes: plant.failure_modes,
      contextual_warnings: contextual,
    },
  };
}
