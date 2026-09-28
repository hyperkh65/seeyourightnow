import type { App } from '../http/types.js';
import { authRoutes } from './auth.js';
import { healthRoutes } from './health.js';

export async function registerRoutes(app: App): Promise<void> {
  await healthRoutes(app);
  await authRoutes(app);
}
