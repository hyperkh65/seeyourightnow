import type { App } from '../http/types.js';
import { adminRoutes } from './admin.js';
import { authRoutes } from './auth.js';
import { crmRoutes } from './crm.js';
import { fulfillmentRoutes } from './fulfillment.js';
import { healthRoutes } from './health.js';
import { importExportRoutes } from './importexport.js';
import { insightRoutes } from './insights.js';
import { partnerRoutes } from './partner.js';
import { platformRoutes } from './platform.js';
import { portalRoutes } from './portal.js';
import { publicRoutes } from './public.js';
import { quoteRoutes } from './quotes.js';
import { shipmentRoutes } from './shipments.js';
import { sourcingRoutes } from './sourcing.js';
import { tradeRoutes } from './trade.js';

export async function registerRoutes(app: App): Promise<void> {
  await healthRoutes(app);
  await authRoutes(app);
  await publicRoutes(app);
  await sourcingRoutes(app);
  await tradeRoutes(app);
  await quoteRoutes(app);
  await fulfillmentRoutes(app);
  await shipmentRoutes(app);
  await crmRoutes(app);
  await portalRoutes(app);
  await partnerRoutes(app);
  await adminRoutes(app);
  await insightRoutes(app);
  await importExportRoutes(app);
  await platformRoutes(app);
}
