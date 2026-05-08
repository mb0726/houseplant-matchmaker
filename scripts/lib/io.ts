import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Repo root is two levels up from /scripts/lib.
export const REPO_ROOT = resolve(__dirname, '..', '..');
export const CACHE_DIR = resolve(REPO_ROOT, 'scripts', 'cache');
export const OUTPUT_DIR = resolve(REPO_ROOT, 'scripts', 'output');

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function cachePath(name: string): string {
  return resolve(CACHE_DIR, name);
}

export function outputPath(name: string): string {
  return resolve(OUTPUT_DIR, name);
}

export function repoPath(...parts: string[]): string {
  return resolve(REPO_ROOT, ...parts);
}

export function exists(path: string): boolean {
  return existsSync(path);
}

// Slugify a common name into a stable plant ID. We use this once at filter time;
// downstream stages must treat IDs as opaque.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
