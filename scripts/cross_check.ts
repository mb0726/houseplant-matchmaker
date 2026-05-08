// Cross-check artifact generator. Sits between stage 4 (LLM enrichment) and
// stage 5 (merge to lib/plants.json) — gives a compact human-validatable view
// of the enriched data before it commits to the runtime dataset.
//
// Outputs two formats with the same columns:
//   scripts/output/cross_check_table.csv   — for spreadsheet / human reading
//   scripts/output/cross_check_table.md    — for pasting into Perplexity / GPT
//
// Columns are deliberately limited to fields a third-party validator can fact-
// check from species name alone. vibe / best_for / failure_modes / descriptions
// are intentionally omitted — those are subjective and don't validate well in
// table form.

import { writeFileSync } from 'node:fs';
import { readJson, cachePath, outputPath, exists } from './lib/io.ts';
import type { FilteredPlant, AspcaResult, EnrichedFields } from './lib/types.ts';

const COLUMNS = [
  'id',
  'common_name',
  'scientific_name',
  'category',
  'light',
  'water',
  'difficulty',
  'pet_safe',
] as const;

type Row = Record<(typeof COLUMNS)[number], string>;

// CSV escape: quote the value if it contains comma, quote, or newline; double internal quotes.
function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

// Markdown table escape: pipes break the table; backslash-escape them.
function mdEscape(v: string): string {
  return v.replace(/\|/g, '\\|');
}

function main(): void {
  const filteredPath = cachePath('01_filtered.json');
  const aspcaPath = cachePath('02_aspca.json');
  const enrichedPath = cachePath('04_enriched.json');

  for (const p of [filteredPath, aspcaPath, enrichedPath]) {
    if (!exists(p)) {
      console.error(`Missing ${p}. Run earlier stages first.`);
      process.exit(1);
    }
  }

  const filtered = readJson<FilteredPlant[]>(filteredPath);
  const aspca = readJson<AspcaResult[]>(aspcaPath);
  const enriched = readJson<EnrichedFields[]>(enrichedPath);

  const aspcaById = new Map(aspca.map((r) => [r.id, r]));
  const enrichedById = new Map(enriched.map((r) => [r.id, r]));

  const rows: Row[] = [];
  let skipped = 0;

  for (const f of filtered) {
    const a = aspcaById.get(f.id);
    const e = enrichedById.get(f.id);
    if (!a || !e) {
      skipped++;
      continue;
    }
    rows.push({
      id: f.id,
      common_name: f.common_name,
      scientific_name: f.scientific_name,
      category: e.category,
      light: e.light,
      water: e.water,
      difficulty: e.difficulty,
      pet_safe: a.pet_safe,
    });
  }

  // CSV
  const csvLines: string[] = [];
  csvLines.push(COLUMNS.join(','));
  for (const row of rows) {
    csvLines.push(COLUMNS.map((c) => csvEscape(row[c])).join(','));
  }
  const csvPath = outputPath('cross_check_table.csv');
  writeFileSync(csvPath, csvLines.join('\n') + '\n', 'utf-8');

  // Markdown
  const mdLines: string[] = [];
  mdLines.push(`| ${COLUMNS.join(' | ')} |`);
  mdLines.push(`| ${COLUMNS.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    mdLines.push(`| ${COLUMNS.map((c) => mdEscape(row[c])).join(' | ')} |`);
  }
  const mdPath = outputPath('cross_check_table.md');
  writeFileSync(mdPath, mdLines.join('\n') + '\n', 'utf-8');

  console.log(`Cross-check artifacts written:`);
  console.log(`  rows:           ${rows.length}`);
  if (skipped > 0) {
    console.log(`  skipped:        ${skipped} (missing ASPCA or enrichment data)`);
  }
  console.log(`  CSV:            ${csvPath}`);
  console.log(`  Markdown:       ${mdPath}`);
}

main();
