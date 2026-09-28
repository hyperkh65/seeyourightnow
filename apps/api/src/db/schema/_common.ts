import { sql } from 'drizzle-orm';
import { customType, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
export const tenantId = () => uuid('tenant_id').notNull();
export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
export const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Money amounts: NUMERIC(20,4) — never float. Returned as strings. */
export const money = (name: string) => numeric(name, { precision: 20, scale: 4 });
/** Rates / percentages / FX: NUMERIC(20,8). */
export const rate = (name: string) => numeric(name, { precision: 20, scale: 8 });

/** pgvector column. Dimension fixed per embedding model family. */
export const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 768})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(',')
      .filter(Boolean)
      .map((v) => Number(v));
  },
});

export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

/**
 * Evidence columns attached to every legally or financially significant value.
 * source_type / source_id / collected_at / confidence / verification / verified_by / verified_at
 */
export type Evidence = {
  sourceType: string;
  sourceId?: string | null;
  collectedAt?: string | null;
  confidence?: number | null;
  verification: string;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  note?: string | null;
};
