import { config } from './config.js';
import { closeDb } from './db/client.js';
import { closeCache } from './lib/cache.js';
import { logger } from './lib/logger.js';
import { registerAllJobs } from './jobs/index.js';
import { startWorker } from './services/jobs.js';
import { startSchedulers } from './jobs/scheduler.js';

registerAllJobs();
const stop = startWorker(config.WORKER_CONCURRENCY);
const stopSchedulers = startSchedulers();
logger.info({ concurrency: config.WORKER_CONCURRENCY }, 'Sourcing OS worker started');

const shutdown = async () => {
  stopSchedulers();
  await stop();
  await closeCache();
  await closeDb();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
