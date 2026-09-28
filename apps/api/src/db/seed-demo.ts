import { and, eq } from 'drizzle-orm';
import { systemDb } from './client.js';
import { companies, userRoles, users } from './schema/index.js';
import { hashPassword } from '../services/auth.js';

/** Demo business data (clearly labelled DEMO). Extended as modules are implemented. */
export async function seedDemoData(demoId: string, acmeId: string, password: string): Promise<void> {
  const customer = async (tenantId: string, companyName: string, email: string, name: string) => {
    const [existing] = await systemDb.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.email, email))).limit(1);
    if (existing) return existing;
    const [c] = await systemDb.insert(companies).values({ tenantId, name: companyName, industry: '온라인 유통', tier: 'STANDARD' }).returning();
    const [u] = await systemDb.insert(users).values({ tenantId, email, name, passwordHash: await hashPassword(password), companyId: c!.id, emailVerifiedAt: new Date() }).returning();
    await systemDb.insert(userRoles).values({ tenantId, userId: u!.id, role: 'CUSTOMER_ADMIN' });
    await systemDb.update(companies).set({ ownerUserId: u!.id }).where(eq(companies.id, c!.id));
    return u!;
  };
  await customer(demoId, '(DEMO) 한빛리빙', 'buyer@demo.local', '홍구매');
  await customer(acmeId, 'ACME 고객사', 'buyer@acme.local', 'ACME 구매담당');
}
