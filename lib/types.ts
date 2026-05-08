// Runtime types for the houseplant matchmaker. The Plant shape here is the
// canonical definition — the dataset pipeline writes to lib/plants.json against
// this shape, and the API/UI both read against it.

export type Category =
  | 'tropical'
  | 'succulent'
  | 'trailing'
  | 'tree-floor'
  | 'fern'
  | 'palm'
  | 'flowering';

export type Light = 'low' | 'medium' | 'bright' | 'direct';
export type Water = 'low' | 'moderate' | 'high';
export type PetSafe = 'yes' | 'no' | 'unknown';
export type Difficulty = 'easy' | 'medium' | 'expert';
export type Size = 'small' | 'medium' | 'large';

export type Plant = {
  id: string;
  scientific_name: string;
  common_name: string;
  also_known_as: string[];
  category: Category;
  light: Light;
  water: Water;
  pet_safe: PetSafe;
  difficulty: Difficulty;
  size: Size;
  vibe: string[];
  best_for: string[];
  failure_modes: string[];
  short_description: string;
  image_url: string | null;
  image_attribution: string | null;
  provenance: {
    light: string;
    pet_safe: string;
    vibe: string;
    image_url: string;
  };
};

// Discriminated result type used by every tool. ok=true means data is
// populated; ok=false means error is populated. This pattern lets the agent
// loop handle errors as data without try/catch and lets us return informative
// error strings back through the tool_result block.
export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Per-tool-call entry rendered in the observability panel.
export type TraceEntry = {
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  ok: boolean;
};

// Token usage tallied per turn (or accumulated across a session).
export type AgentUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};
