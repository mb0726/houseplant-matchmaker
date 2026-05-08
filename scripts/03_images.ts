// Stage 3: fetch a representative photo for each plant from Wikimedia Commons.
// Per the locked plan, no Unsplash fallback in v1 — plants without a usable
// Commons image get flagged for manual review at stage 5.

import { readJson, writeJson, cachePath, exists } from './lib/io.ts';
import { searchPlantImage, formatAttribution } from './lib/wikimedia.ts';
import type { FilteredPlant, ImageResult } from './lib/types.ts';

const RESULTS_PATH = cachePath('03_images.json');

async function main(): Promise<void> {
  const plants = readJson<FilteredPlant[]>(cachePath('01_filtered.json'));
  // Resume support: if cache file exists, only fetch plants we haven't already
  // resolved. This keeps the script idempotent and lets us re-run for plants
  // that hit transient Wikimedia errors.
  const existing: ImageResult[] = exists(RESULTS_PATH)
    ? readJson<ImageResult[]>(RESULTS_PATH)
    : [];
  const byId = new Map(existing.map((r) => [r.id, r]));

  console.log(`Stage 3: fetching Wikimedia images for ${plants.length} plants`);
  if (existing.length) console.log(`  ${existing.length} already in cache, will skip those`);

  const results: ImageResult[] = [];
  let withImage = 0;
  let withoutImage = 0;

  for (const [i, p] of plants.entries()) {
    const cached = byId.get(p.id);
    if (cached && cached.image_url) {
      results.push(cached);
      withImage++;
      continue;
    }

    process.stdout.write(`  [${i + 1}/${plants.length}] ${p.common_name} (${p.scientific_name})... `);
    try {
      const found = await searchPlantImage(p.scientific_name);
      if (found) {
        const result: ImageResult = {
          id: p.id,
          image_url: found.image.url,
          image_attribution: formatAttribution(found.image),
          source: 'wikimedia',
          license: found.image.license,
          search_query_used: found.queryUsed,
        };
        results.push(result);
        withImage++;
        console.log(`✓ ${found.image.license ?? 'unknown license'}`);
      } else {
        results.push({
          id: p.id,
          image_url: null,
          image_attribution: null,
          source: 'none',
          license: null,
          search_query_used: p.scientific_name,
        });
        withoutImage++;
        console.log(`✗ no usable image`);
      }
    } catch (e) {
      // Don't crash the whole stage on a single failure — log and keep going.
      console.log(`✗ error: ${(e as Error).message}`);
      results.push({
        id: p.id,
        image_url: null,
        image_attribution: null,
        source: 'none',
        license: null,
        search_query_used: p.scientific_name,
      });
      withoutImage++;
    }

    // Throttle: 200ms between plants to be polite to Commons.
    await new Promise((r) => setTimeout(r, 200));

    // Persist progress incrementally so a crash doesn't lose hours of fetches.
    if ((i + 1) % 10 === 0) writeJson(RESULTS_PATH, results);
  }

  console.log(`\nResults:`);
  console.log(`  with image:    ${withImage}`);
  console.log(`  without image: ${withoutImage}`);

  if (withoutImage > 0) {
    console.log(`\nPlants without image (will be flagged in stage 5):`);
    for (const r of results.filter((r) => !r.image_url)) {
      const p = plants.find((p) => p.id === r.id)!;
      console.log(`  - ${p.common_name} (${p.scientific_name})`);
    }
  }

  // License breakdown for visibility.
  const licenses = new Map<string, number>();
  for (const r of results) {
    if (r.license) licenses.set(r.license, (licenses.get(r.license) ?? 0) + 1);
  }
  console.log(`\nLicense breakdown:`);
  for (const [lic, n] of [...licenses.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${lic}`);
  }

  writeJson(RESULTS_PATH, results);
  console.log(`\nWrote scripts/cache/03_images.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
