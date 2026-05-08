import type { NextConfig } from 'next';

const config: NextConfig = {
  // The agent loop reads docs/04_agent_system_prompt.md at runtime via fs.
  // Tell Next.js to include that path in the serverless function bundle so
  // the file exists in production deployments.
  outputFileTracingIncludes: {
    '/api/chat': ['./docs/04_agent_system_prompt.md'],
  },
};

export default config;
