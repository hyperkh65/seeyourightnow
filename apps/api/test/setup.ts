import { TEST_ENV } from './env.js';
for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
delete process.env.REDIS_URL;
