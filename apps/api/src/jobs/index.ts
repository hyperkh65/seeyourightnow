/**
 * Importing these modules registers their job handlers with the queue.
 * Both the API process (for in-process workers / tests) and the worker process call this.
 */
import '../services/notify.js';
import '../services/sourcing/pipeline.js';
import '../services/tracking.js';
import '../services/customs.js';
import './maintenance.js';

export function registerAllJobs(): void {
  /* handlers are registered on import */
}
