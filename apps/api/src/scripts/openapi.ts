/** Writes the OpenAPI 3 document to docs/openapi.json (generated from the zod route schemas). */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.js';
import { closeDb } from '../db/client.js';
import { closeCache } from '../lib/cache.js';

const app = await buildApp();
await app.ready();
const doc = app.swagger();
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/openapi.json');
writeFileSync(out, JSON.stringify(doc, null, 2));
console.warn(
  `OpenAPI written to ${out} (${Object.keys((doc as { paths?: object }).paths ?? {}).length} paths)`,
);
await app.close();
await closeDb();
await closeCache();
process.exit(0);
