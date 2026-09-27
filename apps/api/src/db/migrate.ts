import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** Applies migrations as the schema owner. Never edit the schema manually — generate a migration. */
export async function runMigrations(url = process.env.DATABASE_OWNER_URL ?? 'postgres://sos_owner:sos_owner@localhost:5432/sourcing_os') {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const folder = path.resolve(here, '../../drizzle');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.warn('migrations applied');
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
