// Upstash Redis client. Vercel's "KV" integration is white-labeled Upstash, so
// we use @upstash/redis directly. Env vars come from `vercel env pull` into
// .env.development.local for dev; Vercel injects them automatically in deploys.
//
// Server-only — never import from a client component.

import { Redis } from '@upstash/redis';

const url = process.env['KV_REST_API_URL'];
const token = process.env['KV_REST_API_TOKEN'];

if (!url || !token) {
  // Don't throw at import time; route handlers can detect this and degrade.
  // (Useful so unit tests of pure libs don't need KV creds.)
  console.warn(
    '[kv] KV_REST_API_URL or KV_REST_API_TOKEN missing. Budget tracking will fail open.',
  );
}

export const kv: Redis | null =
  url && token ? new Redis({ url, token }) : null;
