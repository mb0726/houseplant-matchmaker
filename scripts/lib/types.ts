// Shared types for the dataset pipeline. Each stage is a pure function over JSON
// inputs/outputs in /scripts/cache, so types here describe the wire format between
// stages — not the internals of any one stage.
//
// The canonical runtime Plant type lives in /lib/types.ts. We re-export it from
// here so pipeline code has one import path for everything.

import type { Plant, Category, Light, Water, PetSafe, Difficulty, Size } from '../../lib/types.ts';
export type { Plant, Category, Light, Water, PetSafe, Difficulty, Size };

export type KaggleRecord = {
  id: number;
  latin: string;
  family: string;
  common: string[];
  category: string;
  origin: string;
  climate: string;
  tempmax: { celsius: number; fahrenheit: number };
  tempmin: { celsius: number; fahrenheit: number };
  ideallight: string;
  toleratedlight: string;
  watering: string;
  insects: string[];
  diseases: string;
  use: string[];
};

// Stage 1 output: the curated subset from Kaggle, normalized and given stable IDs.
export type FilteredPlant = {
  id: string; // slug, e.g. "spider_plant"
  scientific_name: string;
  common_name: string;
  also_known_as: string[];
  kaggle_id: number;
  kaggle_category: string;
  kaggle_ideallight: string;
  kaggle_watering: string;
};

// Stage 2 output: per-plant ASPCA pet-safety classification with provenance.
export type AspcaResult = {
  id: string;
  pet_safe: 'yes' | 'no' | 'unknown';
  match_basis: string; // e.g. "scientific:Chlorophytum comosum" or "common:Spider Plant" or "no_match"
  source_url: string | null; // ASPCA page URL when matched
};

// Stage 3 output: per-plant image with attribution and license metadata.
export type ImageResult = {
  id: string;
  image_url: string | null;
  image_attribution: string | null;
  source: 'wikimedia' | 'none';
  license: string | null;
  search_query_used: string | null;
};

// Stage 4 output: LLM-enriched fields per plant. Reuses runtime enum aliases.
export type EnrichedFields = {
  id: string;
  category: Category;
  light: Light;
  water: Water;
  difficulty: Difficulty;
  size: Size;
  vibe: string[];
  best_for: string[];
  failure_modes: string[];
  short_description: string;
};
