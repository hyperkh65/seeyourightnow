import { readFileSync } from 'node:fs';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** DEV_MODE enables clearly-labelled mock connectors. Must be false in production. */
  DEV_MODE: bool,
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().default('postgres://sos_app:sos_app@localhost:5432/sourcing_os'),
  DATABASE_SYSTEM_URL: z.string().default('postgres://sos_system:sos_system@localhost:5432/sourcing_os'),
  DATABASE_OWNER_URL: z.string().default('postgres://sos_owner:sos_owner@localhost:5432/sourcing_os'),
  DB_POOL_MAX: z.coerce.number().default(20),
  REDIS_URL: z.string().optional(),

  /** Base domain for tenant subdomains, e.g. "sourcing-os.com" → acme.sourcing-os.com. "localhost" in dev. */
  PLATFORM_BASE_DOMAIN: z.string().default('localhost'),
  /** Platform admin console host (super admin). */
  PLATFORM_ADMIN_HOST: z.string().default('platform.localhost'),
  /** Tenant slug used when a request arrives on a bare host (dev convenience). */
  DEFAULT_TENANT_SLUG: z.string().optional(),
  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),
  TRUST_PROXY: bool,

  /** 32-byte base64 master key for the built-in secret store (AES-256-GCM). */
  SECRETS_MASTER_KEY: z.string().optional(),
  SECRETS_BACKEND: z.enum(['BUILTIN', 'VAULT', 'INFISICAL']).default('BUILTIN'),
  VAULT_ADDR: z.string().optional(),
  VAULT_TOKEN: z.string().optional(),
  VAULT_MOUNT: z.string().default('secret'),
  INFISICAL_API_URL: z.string().optional(),
  INFISICAL_TOKEN: z.string().optional(),
  INFISICAL_PROJECT_ID: z.string().optional(),
  INFISICAL_ENVIRONMENT: z.string().default('prod'),
  /** HMAC key for signed download URLs, anonymous tokens, etc. */
  APP_SIGNING_KEY: z.string().optional(),

  SESSION_TTL_HOURS: z.coerce.number().default(24 * 7),
  SESSION_IDLE_HOURS: z.coerce.number().default(12),
  SESSION_ROTATE_MINUTES: z.coerce.number().default(15),
  STEP_UP_MINUTES: z.coerce.number().default(10),
  COOKIE_SECURE: z.string().optional(),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('sourcing-os'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  UPLOAD_MAX_MB: z.coerce.number().default(20),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().default(3310),

  GOTENBERG_URL: z.string().optional(),
  CHROMIUM_PATH: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool,
  EMAIL_FROM_DEFAULT: z.string().default('no-reply@localhost'),

  AI_WORKER_URL: z.string().optional(),
  AI_WORKER_TOKEN: z.string().optional(),

  WEBAUTHN_RP_NAME: z.string().default('Sourcing OS'),

  SENTRY_DSN: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().default(4),
  RUN_WORKER_IN_PROCESS: bool,
});

export type Config = z.infer<typeof envSchema> & {
  cookieSecure: boolean;
  signingKey: string;
  masterKey: Buffer | null;
};

/**
 * Docker/Kubernetes secrets convention: `FOO_FILE=/run/secrets/foo` loads FOO from a file,
 * so secrets never have to be placed in plain environment variables or compose files.
 */
function resolveFileSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const [k, v] of Object.entries(env)) {
    if (!k.endsWith('_FILE') || !v) continue;
    const name = k.slice(0, -5);
    // Only variables this service actually reads (ignore unrelated *_FILE variables).
    if (!(name in envSchema.shape) || out[name]) continue;
    try {
      out[name] = readFileSync(v, 'utf8').trim();
    } catch (e) {
      throw new Error(`Cannot read ${k} (${v}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

function load(): Config {
  const parsed = envSchema.safeParse(resolveFileSecrets(process.env));
  if (!parsed.success) {
    console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  const env = parsed.data;
  const isProd = env.NODE_ENV === 'production';
  if (isProd && env.DEV_MODE) throw new Error('DEV_MODE must not be enabled in production');
  if (isProd && !env.APP_SIGNING_KEY) throw new Error('APP_SIGNING_KEY is required in production');
  if (isProd && env.SECRETS_BACKEND === 'BUILTIN' && !env.SECRETS_MASTER_KEY)
    throw new Error('SECRETS_MASTER_KEY is required in production');
  let masterKey: Buffer | null = null;
  if (env.SECRETS_MASTER_KEY) {
    masterKey = Buffer.from(env.SECRETS_MASTER_KEY, 'base64');
    if (masterKey.length !== 32) throw new Error('SECRETS_MASTER_KEY must be 32 bytes, base64-encoded');
  } else if (!isProd) {
    // Deterministic development key. Never used in production (guarded above).
    masterKey = Buffer.alloc(32, 7);
  }
  return {
    ...env,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
    signingKey: env.APP_SIGNING_KEY ?? 'dev-only-signing-key-change-me',
    masterKey,
  };
}

export const config = load();
