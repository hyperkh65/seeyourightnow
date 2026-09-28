import { TEST_ENV } from './env.js';

export default async function setup() {
  for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
  delete process.env.REDIS_URL;
  const { resetDatabase } = await import('../src/db/reset.js');
  await resetDatabase(TEST_ENV.DATABASE_OWNER_URL);
  const { seedAll } = await import('../src/db/seed.js');
  await seedAll();
  const { closeDb } = await import('../src/db/client.js');
  await closeDb();
}
