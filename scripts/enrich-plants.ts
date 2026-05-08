// Top-level orchestrator. Runs all five pipeline stages in order.
// Each stage is resumable via its own cache file, so re-running this orchestrator
// is safe — completed stages skip their work and unfinished plants pick up where
// they left off.
//
// Usage:
//   tsx scripts/enrich-plants.ts             # run everything through cross-check, stop before merge
//   tsx scripts/enrich-plants.ts --no-llm    # stop before stage 4 (LLM enrichment)
//   tsx scripts/enrich-plants.ts --merge     # also run the final merge after cross-check
//
// The orchestrator deliberately stops at the cross-check by default. Inspect
// scripts/output/cross_check_table.{csv,md} before running stage 5 so the
// final lib/plants.json reflects validated values.
//
// For more granular control, run each stage script directly:
//   tsx scripts/01_filter.ts
//   tsx scripts/02_aspca.ts
//   tsx scripts/03_images.ts
//   tsx scripts/04_enrich.ts [--limit N | --only id1,id2]
//   tsx scripts/cross_check.ts
//   tsx scripts/05_merge.ts

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

type Stage = {
  name: string;
  script: string;
  requiresKey: boolean;
  // If true, stage runs only when --merge is passed (i.e. the user has reviewed
  // the cross-check artifacts and explicitly approved writing lib/plants.json).
  postValidation?: boolean;
};

const STAGES: Stage[] = [
  { name: '01_filter', script: '01_filter.ts', requiresKey: false },
  { name: '02_aspca', script: '02_aspca.ts', requiresKey: false },
  { name: '03_images', script: '03_images.ts', requiresKey: false },
  { name: '04_enrich', script: '04_enrich.ts', requiresKey: true },
  { name: 'cross_check', script: 'cross_check.ts', requiresKey: false },
  { name: '05_merge', script: '05_merge.ts', requiresKey: false, postValidation: true },
];

function runStage(scriptName: string): void {
  const path = resolve(__dirname, scriptName);
  console.log(`\n========== ${scriptName} ==========`);
  const result = spawnSync('npx', ['tsx', path], { stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error(`\nStage ${scriptName} exited with status ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

function main(): void {
  const noLlm = process.argv.includes('--no-llm');
  const allowMerge = process.argv.includes('--merge');

  for (const stage of STAGES) {
    if (stage.requiresKey && noLlm) {
      console.log(`\nSkipping ${stage.name} (--no-llm flag set)`);
      console.log('Final merge will fail without enriched data; run stage 4 separately.');
      break;
    }
    if (stage.postValidation && !allowMerge) {
      console.log(`\nStopping before ${stage.name}.`);
      console.log('Review scripts/output/cross_check_table.{csv,md}, then re-run with --merge to write lib/plants.json.');
      break;
    }
    runStage(stage.script);
  }

  console.log('\nAll stages completed.');
}

main();
