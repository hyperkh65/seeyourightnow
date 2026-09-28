import { Redis } from 'ioredis';
import { config } from '../config.js';

/**
 * Cache with Redis/Valkey when configured, in-memory LRU-ish fallback otherwise.
 * The app must keep working (slower) when Redis is down.
 */

let redis: Redis | null = null;
let redisHealthy = false;

if (config.REDIS_URL) {
  redis = new Redis(config.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  redis.on('ready', () => (redisHealthy = true));
  redis.on('error', () => (redisHealthy = false));
  redis.on('end', () => (redisHealthy = false));
}

const memory = new Map<string, { value: string; expiresAt: number }>();
const MEMORY_MAX = 5000;

export function getRedis(): Redis | null {
  return redis && redisHealthy ? redis : null;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  try {
    const raw = r ? await r.get(key) : memGet(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    const raw = memGet(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const raw = JSON.stringify(value);
  const r = getRedis();
  if (r) {
    try {
      await r.set(key, raw, 'EX', ttlSeconds);
      return;
    } catch {
      /* fall through to memory */
    }
  }
  if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value!);
  memory.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheDel(key: string): Promise<void> {
  memory.delete(key);
  const r = getRedis();
  if (r) await r.del(key).catch(() => undefined);
}

function memGet(key: string): string | null {
  const e = memory.get(key);
  if (!e) return null;
  if (e.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return e.value;
}

export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const v = await fn();
  await cacheSet(key, v, ttlSeconds);
  return v;
}

export async function pingRedis(): Promise<'OK' | 'DISABLED' | 'DOWN'> {
  if (!redis) return 'DISABLED';
  try {
    await redis.ping();
    return 'OK';
  } catch {
    return 'DOWN';
  }
}

export async function closeCache(): Promise<void> {
  if (redis) redis.disconnect();
}
