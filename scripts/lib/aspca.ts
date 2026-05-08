// ASPCA scraping + name-matching helpers.
//
// ASPCA's plant lists at /pet-care/animal-poison-control/toxic-and-non-toxic-plants
// are paginated server-rendered HTML. Each row contains both a common name and a
// scientific name, which lets us match our Kaggle-derived plants with reasonable
// accuracy. We fetch each page once, cache the HTML to disk, and parse with regex
// (the markup is stable Drupal Views output — cheerio would be overkill).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CACHE_DIR } from './io.ts';

const ASPCA_HTML_DIR = resolve(CACHE_DIR, 'aspca');
const USER_AGENT =
  'Mozilla/5.0 houseplant-matchmaker portfolio project (monabrahmbhatt26@gmail.com)';

// ASPCA's two filter fields:
//   field_toxicity_value     — values 01=Dogs, 02=Cats, 03=Horses (selects "Toxic to ...")
//   field_non_toxicity_value — values 01=Dogs, 02=Cats, 03=Horses (selects "Non-Toxic to ...")
// Multi-select OR's the values within a single field. We OR dogs+cats to get
// any plant that's toxic (or non-toxic) to a household pet, then resolve the
// "is it actually safe for both?" question by checking both lists.
export type ListKind = 'toxic' | 'nontoxic';

export type AspcaEntry = {
  common_name: string;
  scientific_name: string;
  detail_path: string; // relative URL for citation
};

function buildListUrl(kind: ListKind, page: number): string {
  const field = kind === 'toxic' ? 'field_toxicity_value' : 'field_non_toxicity_value';
  // 01=Dogs, 02=Cats — OR'd via repeated array params.
  return `https://www.aspca.org/pet-care/animal-poison-control/toxic-and-non-toxic-plants?${field}%5B%5D=01&${field}%5B%5D=02&page=${page}`;
}

function htmlCachePath(kind: ListKind, page: number): string {
  return resolve(ASPCA_HTML_DIR, `${kind}_p${page.toString().padStart(2, '0')}.html`);
}

async function fetchWithCache(url: string, cachePath: string): Promise<string> {
  if (existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf-8');
  }
  mkdirSync(ASPCA_HTML_DIR, { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  if (!res.ok) throw new Error(`ASPCA fetch failed: ${res.status} ${url}`);
  const html = await res.text();
  writeFileSync(cachePath, html, 'utf-8');
  return html;
}

function getTotalPages(html: string): number {
  // Pager element looks like: pager-last ... href="...&page=28"
  const m = html.match(/class="pager-last[^"]*">\s*<a[^>]*page=(\d+)/);
  if (!m || !m[1]) {
    // Single-page result set: no pager.
    return 1;
  }
  return parseInt(m[1], 10) + 1; // pages are 0-indexed in the URL
}

// Parse one listing page into AspcaEntry rows. Each row block contains:
//   <div class="views-row..."> ...
//     <div class="views-field views-field-title">...<div class="plant-title-name">CommonName</div>...
//     <div class="views-field views-field-title-1 views-field-title-scientific-name">...<div class="plant-title-name">Scientific Name</div>...
//     <a href="/pet-care/aspca-poison-control/toxic-and-non-toxic-plants/slug">...
//   </div>
function parseEntries(html: string): AspcaEntry[] {
  const out: AspcaEntry[] = [];
  // Split on row marker. First chunk before the first marker is the page preamble.
  const parts = html.split('<div class="views-row');
  const rows = parts.slice(1);

  for (const row of rows) {
    // Common name: first plant-title-name in views-field-title (without -1).
    const commonMatch = row.match(
      /views-field views-field-title[^"]*"[^>]*>[\s\S]*?<div class="plant-title-name">([^<]*)<\/div>/,
    );
    // Scientific name: plant-title-name in views-field-title-scientific-name.
    const sciMatch = row.match(
      /views-field-title-scientific-name[^"]*"[^>]*>[\s\S]*?<div class="plant-title-name">([^<]*)<\/div>/,
    );
    const detailMatch = row.match(
      /href="(\/pet-care\/aspca-poison-control\/toxic-and-non-toxic-plants\/[^"]+)"/,
    );

    if (!commonMatch?.[1] || !sciMatch?.[1]) continue;

    out.push({
      common_name: cleanText(commonMatch[1]),
      scientific_name: cleanText(sciMatch[1]),
      detail_path: detailMatch?.[1] ?? '',
    });
  }
  return out;
}

function cleanText(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export async function fetchAllEntries(kind: ListKind): Promise<AspcaEntry[]> {
  // Fetch page 0 first to learn page count.
  const firstHtml = await fetchWithCache(buildListUrl(kind, 0), htmlCachePath(kind, 0));
  const total = getTotalPages(firstHtml);
  const all: AspcaEntry[] = [...parseEntries(firstHtml)];

  for (let p = 1; p < total; p++) {
    // Light throttle: 250ms between page fetches to be polite.
    await new Promise((r) => setTimeout(r, 250));
    const html = await fetchWithCache(buildListUrl(kind, p), htmlCachePath(kind, p));
    all.push(...parseEntries(html));
  }
  return all;
}

// --- Name matching ---
// Normalize a scientific name for comparison: lowercase, strip authorities,
// cultivars, hybrid markers, and trailing var./spp./×.
export function normalizeSci(name: string): string {
  return name
    .toLowerCase()
    .replace(/['"`].*?['"`]/g, '') // strip 'Cultivar Name'
    .replace(/\s+(var\.|spp?\.|f\.|cv\.|subsp\.).*$/i, '') // strip variety/forma/etc
    .replace(/\s*[×x]\s*/g, ' ') // hybrid sign
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCommon(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function getGenus(sciName: string): string {
  return normalizeSci(sciName).split(' ')[0] ?? '';
}

// Match a candidate plant against ASPCA entries. Returns { match, basis } or null.
// Match precedence: exact species → genus → common name.
export function matchAgainst(
  candidate: { scientific_name: string; common_name: string; also_known_as: string[] },
  entries: AspcaEntry[],
): { entry: AspcaEntry; basis: string } | null {
  const candSci = normalizeSci(candidate.scientific_name);
  const candGenus = getGenus(candidate.scientific_name);
  const candCommons = [candidate.common_name, ...candidate.also_known_as].map(normalizeCommon);

  // Pass 1: exact species match
  for (const e of entries) {
    if (normalizeSci(e.scientific_name) === candSci && candSci.includes(' ')) {
      return { entry: e, basis: `scientific:${e.scientific_name}` };
    }
  }
  // Pass 2: genus match (only if candidate has a meaningful genus)
  if (candGenus.length >= 4) {
    for (const e of entries) {
      if (getGenus(e.scientific_name) === candGenus) {
        return { entry: e, basis: `genus:${candGenus}` };
      }
    }
  }
  // Pass 3: common name match
  for (const e of entries) {
    const eCommon = normalizeCommon(e.common_name);
    for (const cc of candCommons) {
      if (cc && cc === eCommon) {
        return { entry: e, basis: `common:${e.common_name}` };
      }
    }
  }
  return null;
}
