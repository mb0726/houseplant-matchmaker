// Stage 5: combine all cached stage outputs into the final lib/plants.json,
// stamp provenance per field, and emit two review artifacts:
//
//   scripts/output/random_10_sample.json   — 10 random plants, full record
//   scripts/output/low_confidence.json     — plants flagged for manual review
//
// "Low confidence" rules (soft):
//   - ASPCA returned 'unknown' (pet_safe could not be classified)
//   - Wikimedia returned no image (source: 'none')
//   - LLM output looks suspicious (empty arrays, very short description)
//
// Provenance format: per-field source string. e.g. "aspca", "kaggle", "llm:sonnet-4-6",
// "wikimedia". The user wants this captured for case-study credibility.

import { readJson, writeJson, cachePath, outputPath, repoPath, exists } from './lib/io.ts';
import { MODEL } from './lib/llm.ts';
import type {
  FilteredPlant,
  AspcaResult,
  ImageResult,
  EnrichedFields,
  Plant,
} from './lib/types.ts';

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
}

type Flag = { id: string; common_name: string; reasons: string[] };

function flagsFor(
  p: Plant,
  aspca: AspcaResult,
  image: ImageResult,
  enriched: EnrichedFields,
): string[] {
  const reasons: string[] = [];
  if (aspca.pet_safe === 'unknown') reasons.push('ASPCA: no match found');
  if (image.source === 'none') reasons.push('Wikimedia: no image found');
  if (!enriched.short_description || enriched.short_description.length < 30) {
    reasons.push(`description too short (${enriched.short_description?.length ?? 0} chars)`);
  }
  if (enriched.vibe.length === 0) reasons.push('empty vibe array');
  if (enriched.best_for.length === 0) reasons.push('empty best_for array');
  if (enriched.failure_modes.length === 0) reasons.push('empty failure_modes array');
  return reasons;
}

function main(): void {
  const filtered = readJson<FilteredPlant[]>(cachePath('01_filtered.json'));
  const aspca = readJson<AspcaResult[]>(cachePath('02_aspca.json'));
  const images = readJson<ImageResult[]>(cachePath('03_images.json'));

  const enrichedPath = cachePath('04_enriched.json');
  if (!exists(enrichedPath)) {
    console.error(`Missing ${enrichedPath} — run stage 4 first.`);
    process.exit(1);
  }
  const enriched = readJson<EnrichedFields[]>(enrichedPath);

  const aspcaById = new Map(aspca.map((r) => [r.id, r]));
  const imagesById = new Map(images.map((r) => [r.id, r]));
  const enrichedById = new Map(enriched.map((r) => [r.id, r]));

  const plants: Plant[] = [];
  const flagged: Flag[] = [];
  const llmSource = `llm:${MODEL}`;

  for (const f of filtered) {
    const a = aspcaById.get(f.id);
    const img = imagesById.get(f.id);
    const e = enrichedById.get(f.id);

    if (!a || !img || !e) {
      console.warn(`  [warn] ${f.id} missing stage data; skipping`);
      continue;
    }

    const plant: Plant = {
      id: f.id,
      scientific_name: f.scientific_name,
      common_name: f.common_name,
      also_known_as: f.also_known_as,
      category: e.category,
      light: e.light,
      water: e.water,
      pet_safe: a.pet_safe,
      difficulty: e.difficulty,
      size: e.size,
      vibe: e.vibe,
      best_for: e.best_for,
      failure_modes: e.failure_modes,
      short_description: e.short_description,
      image_url: img.image_url,
      image_attribution: img.image_attribution,
      provenance: {
        light: llmSource,
        // Pet safety: cite ASPCA when matched, fall back to manual cross-validation
        // notes (match_basis prefixed with "manual:") or "unknown" when neither.
        pet_safe: a.match_basis.startsWith('manual:')
          ? a.match_basis.slice('manual:'.length)
          : a.pet_safe === 'unknown'
            ? 'aspca:no_match'
            : `aspca:${a.match_basis}`,
        vibe: llmSource,
        image_url: img.source === 'wikimedia' ? 'wikimedia_commons' : 'none',
      },
    };

    const reasons = flagsFor(plant, a, img, e);
    if (reasons.length > 0) {
      flagged.push({ id: f.id, common_name: f.common_name, reasons });
    }
    plants.push(plant);
  }

  // Write final dataset to lib/plants.json (the runtime location).
  writeJson(repoPath('lib', 'plants.json'), plants);

  // Review artifacts.
  writeJson(outputPath('random_10_sample.json'), pickRandom(plants, 10));
  writeJson(outputPath('low_confidence.json'), flagged);

  // Summary.
  console.log(`Stage 5: merged ${plants.length} plants → lib/plants.json`);
  console.log();
  console.log(`Field distributions:`);
  const dist = (key: keyof Plant) => {
    const counts = new Map<string, number>();
    for (const p of plants) {
      const v = String(p[key]);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return counts;
  };
  for (const key of ['category', 'light', 'water', 'difficulty', 'size', 'pet_safe'] as const) {
    const counts = dist(key);
    console.log(
      `  ${key.padEnd(12)} ${[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([v, n]) => `${v}=${n}`)
        .join(', ')}`,
    );
  }
  console.log();
  console.log(`Flagged for review: ${flagged.length}`);
  console.log(`  → scripts/output/random_10_sample.json (10-plant sample)`);
  console.log(`  → scripts/output/low_confidence.json   (review list)`);
}

main();
