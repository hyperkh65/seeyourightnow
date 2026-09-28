import pg from 'pg';
import { runMigrations } from './migrate.js';

/** Development/test only: drops all application tables and re-runs migrations. */
export async function resetDatabase(
  url = process.env.DATABASE_OWNER_URL ?? 'postgres://sos_owner:sos_owner@localhost:5432/sourcing_os',
) {
  if (process.env.NODE_ENV === 'production') throw new Error('refusing to reset a production database');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await pool.query(`DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
      END LOOP;
    END $$;`);
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  } finally {
    await pool.end();
  }
  await runMigrations(url);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resetDatabase()
    .then(() => console.warn('database reset'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
