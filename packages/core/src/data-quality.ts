/**
 * Data freshness rules. Every external datum carries collected_at / last_checked_at /
 * expires_at; the UI surfaces STALE warnings instead of silently using old numbers.
 */

export const DATA_TTL_HOURS = {
  supplier_price: 24 * 7,
  market_price: 24 * 3,
  freight_rate: 24 * 14,
  fx_rate: 24,
  tariff: 24 * 30,
  regulation: 24 * 30,
  ais_position: 6,
  image_embedding: 24 * 365,
  search_result: 24,
} as const;
export type DataKind = keyof typeof DATA_TTL_HOURS;

export type Freshness = 'FRESH' | 'AGING' | 'STALE' | 'UNKNOWN';

export function freshness(
  kind: DataKind,
  lastCheckedAt: Date | string | null | undefined,
  now = new Date(),
  expiresAt?: Date | string | null,
): { status: Freshness; ageHours: number | null; label: string } {
  if (!lastCheckedAt) return { status: 'UNKNOWN', ageHours: null, label: '확인 시점 없음' };
  const t = new Date(lastCheckedAt).getTime();
  const ageHours = Math.max(0, (now.getTime() - t) / 3_600_000);
  const ttl = DATA_TTL_HOURS[kind];
  const expired = expiresAt ? new Date(expiresAt).getTime() < now.getTime() : false;
  const status: Freshness = expired || ageHours > ttl ? 'STALE' : ageHours > ttl * 0.7 ? 'AGING' : 'FRESH';
  return { status, ageHours: Math.round(ageHours * 10) / 10, label: humanAge(ageHours) };
}

export function humanAge(hours: number): string {
  if (hours < 1) return '방금 확인';
  if (hours < 24) return `${Math.floor(hours)}시간 전 확인`;
  return `${Math.floor(hours / 24)}일 전 확인`;
}

export function expiresAtFor(kind: DataKind, from = new Date()): Date {
  return new Date(from.getTime() + DATA_TTL_HOURS[kind] * 3_600_000);
}
