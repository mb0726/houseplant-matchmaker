// Stage 1: filter Kaggle's 209-record dataset down to a curated set of popular,
// recognizable houseplants. This is a hand-built allowlist — Kaggle has heavy
// duplication (20 generic "Aglaonema" entries, 8 "Peace lily" Spathiphyllum
// cultivars, etc.) so we pick one representative per species and skip outdoor-
// only or obscure plants.
//
// Where Kaggle's scientific or common names are bare genus, typo'd, or use stale
// taxonomy, we override them via OVERRIDES below. Everything else passes through
// untouched and downstream stages can rely on these names being usable for
// scientific-name image searches and species-level enrichment.

import { readJson, writeJson, cachePath, slugify } from './lib/io.ts';
import type { KaggleRecord, FilteredPlant } from './lib/types.ts';

const KAGGLE_SOURCE = '/tmp/kaggle-plants/house_plants.json';

// Kaggle IDs to keep. Selection rules: (a) one representative per species,
// (b) commonly stocked at retail plant stores, (c) survives indoors, (d) skip
// near-duplicate cultivars unless visually distinct enough to recommend separately.
//
// Removed:
//   166 — duplicate of 162 ('Sansevieria trifasciata' generic vs. 'Laurentii').
//         Both got identical LLM enrichment and indistinguishable common name
//         "Snake plant", so the chat would recommend the same plant twice.
const ALLOWLIST: number[] = [
  0, 1, 5, 7, 8, 9, 25, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 46,
  47, 50, 52, 54, 60, 61, 63, 64, 65, 67, 68, 69, 70, 71, 74, 76, 78, 79, 81,
  88, 89, 90, 91, 92, 93, 94, 97, 98, 99, 100, 104, 105, 115, 116, 118, 120,
  124, 126, 128, 130, 132, 133, 136, 137, 138, 143, 144, 145, 147, 148, 150,
  151, 152, 155, 156, 157, 158, 159, 160, 162, 164, 165, 167, 168, 170,
  171, 173, 175, 183, 185, 188, 189, 192, 195, 198, 202, 203, 206, 207, 208,
];

// Per-ID overrides for cleaning up Kaggle's name fields. Keys: kaggle id.
// Use this for: bare-genus Latin names, taxonomic updates, typo fixes, common-
// name corrections (e.g. Kaggle calls Monstera deliciosa "Splitleaf Philodendron").
type Override = {
  scientific_name?: string;
  common_name?: string;
  also_known_as?: string[];
};
// Deferred taxonomy decisions (kept as trade names rather than current accepted
// taxonomy because the trade names match what plant stores, ASPCA, and most
// reference docs still use):
//   - Sansevieria (vs. Dracaena trifasciata — recently moved by APG IV)
//   - Schefflera elegantissima (vs. Plerandra elegantissima)
//   - Xanthosoma lindenii (vs. Phyllotaenium lindenii)
//   - Polyscias spp. aralia synonyms
//   - Nolina recurvata (vs. Beaucarnea recurvata)
//   - Philodendron selloum (vs. Thaumatophyllum bipinnatifidum)
const OVERRIDES: Record<number, Override> = {
  0: { scientific_name: 'Aeschynanthus radicans' },
  1: { common_name: 'Maidenhair' },
  9: { scientific_name: 'Aglaonema commutatum', common_name: 'Chinese Evergreen' },
  25: { common_name: 'Imperial Alocasia', scientific_name: 'Alocasia nebula' },
  41: { scientific_name: "Calathea picturata 'Argentea'" },
  44: { common_name: 'Polly Alocasia', scientific_name: 'Alocasia × amazonica' },
  45: { common_name: 'Flamingo Flower', scientific_name: 'Anthurium andraeanum' },
  46: { common_name: "Bird's Nest Anthurium", scientific_name: 'Anthurium hookeri' },
  50: { scientific_name: 'Stromanthe sanguinea' },
  54: { scientific_name: 'Crassula ovata' },
  60: { scientific_name: "Calathea ornata 'Roseolineata'" },
  64: { common_name: 'Tree Maidenhair Fern' },
  65: { common_name: 'Dumb Cane', scientific_name: 'Dieffenbachia seguine' },
  68: { scientific_name: "Dracaena fragrans 'Massangeana'" },
  69: { common_name: 'Janet Craig', scientific_name: "Dracaena fragrans 'Janet Craig'" },
  70: { common_name: 'Earth Star', scientific_name: 'Cryptanthus bivittatus' },
  93: { scientific_name: "Epipremnum aureum 'Marble Queen'" },
  94: { common_name: 'Scarlet Star', scientific_name: 'Guzmania lingulata' },
  99: { scientific_name: 'Euphorbia ammak' },
  105: { common_name: 'Fiddleleaf Fig' },
  118: { common_name: 'Monstera', scientific_name: 'Monstera deliciosa' },
  130: { common_name: 'Red Philodendron', scientific_name: 'Philodendron erubescens' },
  137: { common_name: 'Lemon Lime Philodendron', scientific_name: "Philodendron hederaceum 'Lemon Lime'" },
  138: { common_name: 'Moth Orchid', scientific_name: 'Phalaenopsis amabilis' },
  144: { scientific_name: 'Nephrolepis exaltata' },
  147: { scientific_name: "Homalomena 'Emerald Gem'" },
  150: { common_name: 'Blushing Bromeliad', scientific_name: 'Neoregelia carolinae' },
  159: { common_name: 'Xanadu Philodendron', scientific_name: 'Philodendron xanadu' },
  162: { scientific_name: "Sansevieria trifasciata 'Laurentii'" },
  165: { common_name: "Bird's Nest Sansevieria", scientific_name: "Sansevieria trifasciata 'Hahnii'" },
  168: { common_name: 'Pygmy Date Palm', scientific_name: 'Phoenix roebelenii' },
  175: { common_name: 'Heartleaf Philodendron', scientific_name: 'Philodendron hederaceum' },
  195: { common_name: 'Satin Pothos', scientific_name: 'Scindapsus pictus' },
  198: { common_name: 'Umbrella Plant' },
  203: { scientific_name: 'Spathiphyllum wallisii' },
  207: { scientific_name: 'Zamioculcas zamiifolia' },
  // The Kaggle "category" field doesn't drive our final category — that comes
  // from LLM enrichment in stage 4 — but where Kaggle had clear errors in the
  // Latin name (e.g. typos like "roebellinii"), we fix here so image search
  // and the LLM both see canonical names.
};

function buildPlantId(commonName: string, kaggleId: number): string {
  // Slugify common name. If two plants slug to the same ID (e.g. two "Bird's
  // Nest" entries), suffix with the Kaggle ID for uniqueness.
  return slugify(commonName);
}

function main(): void {
  const raw = readJson<KaggleRecord[]>(KAGGLE_SOURCE);
  const byId = new Map(raw.map((r) => [r.id, r]));

  const seenSlugs = new Set<string>();
  const out: FilteredPlant[] = [];

  for (const kaggleId of ALLOWLIST) {
    const r = byId.get(kaggleId);
    if (!r) {
      console.warn(`  [warn] Kaggle id ${kaggleId} not found, skipping`);
      continue;
    }

    const override = OVERRIDES[kaggleId] ?? {};
    const scientific_name = override.scientific_name ?? r.latin;
    const kaggleCommon = r.common[0] && r.common[0] !== '?' ? r.common[0] : r.latin;
    const common_name = override.common_name ?? kaggleCommon;
    const also_known_as = override.also_known_as ?? r.common.slice(1).filter((n) => n !== '?');

    let id = buildPlantId(common_name, kaggleId);
    // Disambiguate slug collisions deterministically.
    if (seenSlugs.has(id)) {
      id = `${id}_${kaggleId}`;
    }
    seenSlugs.add(id);

    out.push({
      id,
      scientific_name,
      common_name,
      also_known_as,
      kaggle_id: kaggleId,
      kaggle_category: r.category,
      kaggle_ideallight: r.ideallight,
      kaggle_watering: r.watering,
    });
  }

  console.log(`Stage 1: filtered ${raw.length} Kaggle records → ${out.length} curated plants`);
  console.log(`Categories represented:`);
  const cats = new Map<string, number>();
  for (const p of out) cats.set(p.kaggle_category, (cats.get(p.kaggle_category) ?? 0) + 1);
  for (const [cat, n] of [...cats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${cat}`);
  }

  writeJson(cachePath('01_filtered.json'), out);
  console.log(`\nWrote scripts/cache/01_filtered.json`);
}

main();
