// Stage 4: LLM enrichment. ONE Sonnet 4.6 call per plant, structured tool-use
// output, resumable via cache file. Stop the run with Ctrl-C and re-run; cached
// per-plant results carry forward.
//
// CLI:
//   tsx scripts/04_enrich.ts                  # all unprocessed plants
//   tsx scripts/04_enrich.ts --limit 3        # first 3 (smoke test)
//   tsx scripts/04_enrich.ts --only spider_plant,monstera   # specific IDs

import Anthropic from '@anthropic-ai/sdk';
import { readJson, writeJson, cachePath, exists } from './lib/io.ts';
import { loadDotEnv } from './lib/env.ts';
import { makeClient, enrichPlant, MODEL } from './lib/llm.ts';
import type { FilteredPlant, EnrichedFields } from './lib/types.ts';

loadDotEnv();

const RESULTS_PATH = cachePath('04_enriched.json');

// Sonnet 4.6 pricing (USD per million tokens).
const PRICE_INPUT = 3.0;
const PRICE_OUTPUT = 15.0;
const PRICE_CACHE_WRITE = 3.75; // 1.25x base for 5-min TTL
const PRICE_CACHE_READ = 0.3; // ~0.1x base

function parseArgs(): { limit?: number; only?: Set<string> } {
  const args = process.argv.slice(2);
  const out: { limit?: number; only?: Set<string> } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--limit' && args[i + 1]) {
      out.limit = parseInt(args[++i]!, 10);
    } else if (a === '--only' && args[i + 1]) {
      out.only = new Set(args[++i]!.split(',').map((s) => s.trim()).filter(Boolean));
    }
  }
  return out;
}

async function main(): Promise<void> {
  const { limit, only } = parseArgs();
  const allPlants = readJson<FilteredPlant[]>(cachePath('01_filtered.json'));
  const existing: EnrichedFields[] = exists(RESULTS_PATH)
    ? readJson<EnrichedFields[]>(RESULTS_PATH)
    : [];
  const enrichedById = new Map(existing.map((e) => [e.id, e]));

  // Decide which plants to process this run.
  let queue = allPlants.filter((p) => !enrichedById.has(p.id));
  if (only) queue = queue.filter((p) => only.has(p.id));
  if (limit !== undefined) queue = queue.slice(0, limit);

  console.log(`Stage 4: LLM enrichment with ${MODEL}`);
  console.log(`  total plants:       ${allPlants.length}`);
  console.log(`  already enriched:   ${existing.length}`);
  console.log(`  this run:           ${queue.length}`);
  console.log();

  if (queue.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const client = makeClient();

  const results: EnrichedFields[] = [...existing];
  let totalIn = 0;
  let totalOut = 0;
  let totalCacheWrite = 0;
  let totalCacheRead = 0;
  let errors = 0;

  for (const [i, plant] of queue.entries()) {
    process.stdout.write(`  [${i + 1}/${queue.length}] ${plant.common_name}... `);
    try {
      const { fields, usage } = await enrichPlant(client, plant);
      results.push(fields);
      enrichedById.set(plant.id, fields);

      totalIn += usage.input_tokens;
      totalOut += usage.output_tokens;
      totalCacheWrite += usage.cache_creation_input_tokens;
      totalCacheRead += usage.cache_read_input_tokens;

      // Persist after every plant so a crash mid-run loses at most one call.
      writeJson(RESULTS_PATH, results);
      const cacheNote = usage.cache_read_input_tokens > 0
        ? ` (cache hit: ${usage.cache_read_input_tokens})`
        : '';
      console.log(
        `✓ ${fields.difficulty} / ${fields.light} / ${fields.water}${cacheNote}`,
      );
    } catch (e) {
      errors++;
      if (e instanceof Anthropic.RateLimitError) {
        console.log(`✗ rate limit (SDK retry exhausted): ${e.message}`);
      } else if (e instanceof Anthropic.APIError) {
        console.log(`✗ API error ${e.status}: ${e.message}`);
      } else {
        console.log(`✗ ${(e as Error).message}`);
      }
    }
  }

  // Cost estimate from per-call usage we collected.
  const cost =
    (totalIn / 1_000_000) * PRICE_INPUT +
    (totalOut / 1_000_000) * PRICE_OUTPUT +
    (totalCacheWrite / 1_000_000) * PRICE_CACHE_WRITE +
    (totalCacheRead / 1_000_000) * PRICE_CACHE_READ;

  console.log();
  console.log(`Done. enriched=${queue.length - errors}, errors=${errors}`);
  console.log(`Wrote scripts/cache/04_enriched.json (${results.length} total)`);
  console.log();
  console.log(`Token usage:`);
  console.log(`  uncached input:    ${totalIn.toLocaleString()}`);
  console.log(`  cache writes:      ${totalCacheWrite.toLocaleString()}`);
  console.log(`  cache reads:       ${totalCacheRead.toLocaleString()}`);
  console.log(`  output:            ${totalOut.toLocaleString()}`);
  console.log(`  estimated cost:    $${cost.toFixed(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
