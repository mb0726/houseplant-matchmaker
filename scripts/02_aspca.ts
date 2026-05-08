// Stage 2: cross-check each filtered plant against ASPCA's toxic + non-toxic
// plant lists. Pet-safety classification is one of the few fields where we
// strongly prefer an authoritative source over LLM judgment, since wrong
// answers here have real consequences for cats and dogs.

import { readJson, writeJson, cachePath } from './lib/io.ts';
import { fetchAllEntries, matchAgainst } from './lib/aspca.ts';
import type { FilteredPlant, AspcaResult } from './lib/types.ts';

async function main(): Promise<void> {
  const plants = readJson<FilteredPlant[]>(cachePath('01_filtered.json'));
  console.log(`Stage 2: cross-checking ${plants.length} plants against ASPCA...`);

  console.log(`  Fetching ASPCA toxic list (toxic to dogs OR cats)...`);
  const toxic = await fetchAllEntries('toxic');
  console.log(`    → ${toxic.length} entries`);

  console.log(`  Fetching ASPCA non-toxic list (non-toxic to dogs OR cats)...`);
  const nontoxic = await fetchAllEntries('nontoxic');
  console.log(`    → ${nontoxic.length} entries`);

  // Cache the parsed entries for inspection / re-use.
  writeJson(cachePath('02_aspca_toxic_entries.json'), toxic);
  writeJson(cachePath('02_aspca_nontoxic_entries.json'), nontoxic);

  const results: AspcaResult[] = [];
  let yes = 0,
    no = 0,
    unknown = 0;

  for (const p of plants) {
    // Toxic match wins over non-toxic if both fire (conservative).
    const toxicHit = matchAgainst(p, toxic);
    const nontoxicHit = matchAgainst(p, nontoxic);

    let result: AspcaResult;
    if (toxicHit) {
      result = {
        id: p.id,
        pet_safe: 'no',
        match_basis: toxicHit.basis,
        source_url: `https://www.aspca.org${toxicHit.entry.detail_path}`,
      };
      no++;
    } else if (nontoxicHit) {
      result = {
        id: p.id,
        pet_safe: 'yes',
        match_basis: nontoxicHit.basis,
        source_url: `https://www.aspca.org${nontoxicHit.entry.detail_path}`,
      };
      yes++;
    } else {
      result = {
        id: p.id,
        pet_safe: 'unknown',
        match_basis: 'no_match',
        source_url: null,
      };
      unknown++;
    }
    results.push(result);
  }

  console.log(`\nClassifications:`);
  console.log(`  pet_safe=yes: ${yes}`);
  console.log(`  pet_safe=no:  ${no}`);
  console.log(`  unknown:      ${unknown}`);

  if (unknown > 0) {
    console.log(`\nUnmatched plants (will be reviewed in stage 5):`);
    for (const r of results.filter((r) => r.pet_safe === 'unknown')) {
      const p = plants.find((p) => p.id === r.id)!;
      console.log(`  - ${p.common_name} (${p.scientific_name})`);
    }
  }

  writeJson(cachePath('02_aspca.json'), results);
  console.log(`\nWrote scripts/cache/02_aspca.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
