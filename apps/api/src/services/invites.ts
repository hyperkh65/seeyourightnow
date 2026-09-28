import { systemDb } from '../db/client.js';
import { authChallenges } from '../db/schema/index.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';

/** Creates a single-use invite token (valid 7 days). Only the hash is stored. */
export async function createInvite(tenantId: string, userId: string): Promise<string> {
  const token = randomToken(24);
  await systemDb.insert(authChallenges).values({ tenantId, userId, purpose: 'INVITE', challenge: sha256Hex(token), expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000) });
  return token;
}
