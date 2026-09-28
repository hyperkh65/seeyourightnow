// Generates per-installation secrets once (idempotent) into /secrets for docker compose.
// Services read them via *_FILE variables, so no secret is ever written to compose files or env.
import { chmodSync, chownSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const dir = process.env.SECRETS_DIR ?? '/secrets';
mkdirSync(dir, { recursive: true });
const files = {
  app_signing_key: () => randomBytes(48).toString('base64url'),
  secrets_master_key: () => randomBytes(32).toString('base64'),
  worker_token: () => randomBytes(32).toString('base64url'),
  // One-time password for the production bootstrap super admin (SEED_MODE=base); MFA is forced on first login.
  initial_admin_password: () => randomBytes(18).toString('base64url'),
};
let uid = 0;
let gid = 0;
try {
  uid = Number(execSync('id -u node').toString().trim());
  gid = Number(execSync('id -g node').toString().trim());
} catch {
  /* running outside the API image */
}
for (const [name, gen] of Object.entries(files)) {
  const p = `${dir}/${name}`;
  if (!existsSync(p)) {
    writeFileSync(p, gen(), { mode: 0o440 });
    console.log(`generated ${name}`);
  }
  try {
    chownSync(p, uid, gid);
    chmodSync(p, 0o444);
  } catch {
    /* best effort */
  }
}
console.log('secrets ready');
