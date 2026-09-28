/** Test environment: isolated database `sourcing_os_test`. */
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DEV_MODE: 'true',
  DATABASE_URL: 'postgres://sos_app:sos_app@localhost:5432/sourcing_os_test',
  DATABASE_SYSTEM_URL: 'postgres://sos_system:sos_system@localhost:5432/sourcing_os_test',
  DATABASE_OWNER_URL: 'postgres://sos_owner:sos_owner@localhost:5432/sourcing_os_test',
  PLATFORM_BASE_DOMAIN: 'localhost',
  PLATFORM_ADMIN_HOST: 'platform.localhost',
  PUBLIC_WEB_URL: 'http://localhost:3000',
  STORAGE_LOCAL_DIR: './storage-test',
  SEED_PASSWORD: 'Test-Pass-2026!',
  LOG_LEVEL: 'silent',
  REDIS_URL: '',
};
