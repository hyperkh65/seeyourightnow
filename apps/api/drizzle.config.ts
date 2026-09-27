import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? 'postgres://sos_owner:sos_owner@localhost:5432/sourcing_os' },
  strict: true,
});
