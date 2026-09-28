import { buildApp } from './app.js';
import { config } from './config.js';
import { closeDb } from './db/client.js';
import { closeCache } from './lib/cache.js';
import { logger } from './lib/logger.js';
import { registerAllJobs } from './jobs/index.js';
import { startWorker } from './services/jobs.js';

const app = await buildApp();
registerAllJobs();
let stopWorker: (() => Promise<void>) | null = null;
if (config.RUN_WORKER_IN_PROCESS) stopWorker = startWorker(config.WORKER_CONCURRENCY);

await app.listen({ port: config.PORT, host: config.HOST });
logger.info({ port: config.PORT, devMode: config.DEV_MODE }, 'Sourcing OS API listening');

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  await app.close();
  if (stopWorker) await stopWorker();
  await closeCache();
  await closeDb();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
