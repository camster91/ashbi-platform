#!/usr/bin/env node
// Generate docs/openapi.json (OpenAPI 3.1) from the application's routes (#412).
//
// Builds the Fastify app without runtime side effects, reads every registered
// route, its auth guard and its Zod validators, and writes a deterministic
// document with sorted keys (src/tests/helpers/openapi.js). Run with `--check`
// to exit 1 when the committed file no longer matches the code.
//
//   npm run docs:openapi     # rewrite docs/openapi.json
//   npm run check:openapi    # fail if it is stale
//
// See docs/api-contract.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The route table must not depend on the shell: test mode mocks Redis/BullMQ
// (so no connection is attempted) and the production-only SPA fallback routes
// stay unregistered, matching the unit test that checks this file.
process.env.NODE_ENV = 'test';
delete process.env.SERVE_BUILT_SPA;

async function main() {
  const check = process.argv.includes('--check');
  const { OPENAPI_URL, generateOpenApiJson } = await import('../src/tests/helpers/openapi.js');
  const outputPath = fileURLToPath(OPENAPI_URL);
  const relative = path.relative(ROOT, outputPath);
  const output = await generateOpenApiJson();

  if (check) {
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (current !== output) {
      console.error(`${relative} is stale. Run \`npm run docs:openapi\` and commit the result.`);
      return 1;
    }
    console.log(`${relative} is up to date (${Object.keys(JSON.parse(output).paths).length} paths).`);
    return 0;
  }
  fs.writeFileSync(outputPath, output);
  console.log(`Wrote ${relative}.`);
  return 0;
}

// Importing the app opens handles (Prisma pool, timers) that app.close() does
// not own, so exit explicitly once the work is done.
main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
