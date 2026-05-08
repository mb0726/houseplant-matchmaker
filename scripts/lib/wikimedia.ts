// Wikimedia Commons image search.
//
// We use Commons (not Wikipedia) because Commons gives us licensed media files
// directly with proper attribution metadata. The flow is:
//   1. search files (namespace 6) by scientific name
//   2. for top hits, fetch imageinfo with extmetadata for license + artist
//   3. pick the first hit that looks like a usable photo
//   4. HEAD-verify the URL returns 200

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT =
  'houseplant-matchmaker/0.1 (https://github.com/mona/houseplant-matchmaker; portfolio project; monabrahmbhatt26@gmail.com)';

export type CommonsImage = {
  title: string;
  url: string;
  artist: string | null;
  license: string | null;
  licenseUrl: string | null;
  description: string | null;
};

type SearchResponse = {
  query?: { search?: Array<{ title: string; pageid: number }> };
};

type ImageInfoResponse = {
  query?: {
    pages?: Record<
      string,
      {
        title: string;
        imageinfo?: Array<{
          url: string;
          mime: string;
          extmetadata?: Record<string, { value: string }>;
        }>;
      }
    >;
  };
};

async function commonsApi<T>(params: Record<string, string>): Promise<T> {
  const u = new URL(COMMONS_API);
  u.search = new URLSearchParams({
    format: 'json',
    formatversion: '2',
    origin: '*',
    ...params,
  }).toString();
  const res = await fetch(u, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Commons API ${res.status}: ${u}`);
  return (await res.json()) as T;
}

// Heuristic: skip results that are clearly not what we want for a houseplant
// recommendation card.
function isLikelyPhoto(title: string): boolean {
  const lower = title.toLowerCase();
  const badWords = [
    'illustration',
    'drawing',
    'sketch',
    'painting',
    'engraving',
    'lithograph',
    'specimen',
    'herbarium',
    'diagram',
    'map',
    'distribution',
    'chart',
    'logo',
    'icon',
    'svg',
    'cross-section',
  ];
  if (badWords.some((w) => lower.includes(w))) return false;
  // Prefer JPGs (photos) but allow PNG. Skip SVGs, PDFs, GIFs.
  if (lower.endsWith('.svg') || lower.endsWith('.pdf') || lower.endsWith('.gif')) return false;
  return true;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getImageInfo(title: string): Promise<CommonsImage | null> {
  const data = await commonsApi<ImageInfoResponse>({
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '600', // get a sized thumbnail URL too
  });
  const pages = data.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  const info = page?.imageinfo?.[0];
  if (!info) return null;

  // Skip non-image MIME types as a final guard.
  if (!info.mime.startsWith('image/')) return null;
  if (info.mime === 'image/svg+xml' || info.mime === 'image/gif') return null;

  const meta = info.extmetadata ?? {};
  const artist = meta['Artist']?.value ? stripHtml(meta['Artist'].value) : null;
  const license = meta['LicenseShortName']?.value ?? null;
  const licenseUrl = meta['LicenseUrl']?.value ?? null;
  const description = meta['ImageDescription']?.value
    ? stripHtml(meta['ImageDescription'].value)
    : null;

  return {
    title: page!.title,
    url: info.url,
    artist,
    license,
    licenseUrl,
    description,
  };
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
    return res.ok;
  } catch {
    return false;
  }
}

// Build attribution string per Commons reuse guidance. Format:
// "Photo: <Artist>. <License> via Wikimedia Commons."
export function formatAttribution(img: CommonsImage): string {
  const artist = img.artist ?? 'unknown';
  const license = img.license ?? 'see source';
  return `Photo: ${artist}. ${license} via Wikimedia Commons.`;
}

export async function searchPlantImage(
  scientificName: string,
): Promise<{ image: CommonsImage; queryUsed: string } | null> {
  // Try queries in order of specificity. Many Kaggle entries have cultivar
  // suffixes ("Hoya carnosa Exotica", "Calathea ornata Rosea lineata") that
  // Wikimedia files rarely match exactly — falling back to the binomial
  // (first two words) usually finds a real photo.
  const parts = scientificName.split(/\s+/).filter(Boolean);
  const queries: string[] = [scientificName];
  if (parts.length > 2) {
    const binomial = `${parts[0]} ${parts[1]}`;
    queries.push(binomial);
  }
  const genus = parts[0];
  if (genus && genus.length >= 4 && !queries.includes(genus)) queries.push(genus);

  for (const query of queries) {
    const search = await commonsApi<SearchResponse>({
      action: 'query',
      list: 'search',
      srnamespace: '6', // File:
      srsearch: query,
      srlimit: '10',
    });
    const hits = (search.query?.search ?? []).filter((h) => isLikelyPhoto(h.title));
    for (const hit of hits.slice(0, 5)) {
      const info = await getImageInfo(hit.title);
      if (!info) continue;
      if (await headOk(info.url)) {
        return { image: info, queryUsed: query };
      }
    }
    // Light throttle between fallback queries.
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
