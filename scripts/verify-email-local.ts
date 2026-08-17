/**
 * Complete an email verification locally, without an inbox.
 *
 * Signup stores a token in Redis under `email-verify:<token>` and emails the
 * link. Locally that email either goes nowhere useful or — with
 * `EMAIL_PROVIDER=resend` and a live key — is genuinely delivered to whatever
 * address was typed, which is not something a test signup should do to a real
 * mailbox.
 *
 * This reads the pending token straight out of Redis and prints the
 * verification URL, so walking the real signup flow needs no email at all.
 * It reads only; `POST /auth/verify-email` still does the actual work, so the
 * flow being exercised is the real one rather than a shortcut around it.
 *
 *   npx nest build
 *   node dist/scripts/verify-email-local.js            # list pending tokens
 *   node dist/scripts/verify-email-local.js <email>    # link for one user
 */
import 'dotenv/config';

import Redis from 'ioredis';

import AppDataSource from '../src/config/data-source.js';

const PREFIX = 'email-verify:';

async function main() {
  const wanted = process.argv[2]?.toLowerCase();

  const redis = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 2,
  });

  const keys = await redis.keys(`${PREFIX}*`);
  if (keys.length === 0) {
    console.log(
      'No pending verification tokens.\n' +
        'Either nothing has signed up, or the address is already verified.',
    );
    await redis.quit();
    return;
  }

  const ds = await AppDataSource.initialize();

  const rows: { email: string; token: string }[] = [];
  for (const key of keys) {
    const userId = await redis.get(key);
    if (!userId) continue;
    const [user] = await ds.query<{ email: string }[]>(
      `SELECT email FROM users WHERE id = $1`,
      [userId],
    );
    if (!user) continue;
    rows.push({ email: user.email, token: key.slice(PREFIX.length) });
  }

  const base = process.env.FRONTEND_BASE_URL ?? 'http://localhost:3001';
  const matches = wanted
    ? rows.filter((r) => r.email.toLowerCase() === wanted)
    : rows;

  if (matches.length === 0) {
    console.log(`No pending token for "${wanted}".`);
    console.log(`Pending: ${rows.map((r) => r.email).join(', ') || '(none)'}`);
  } else {
    console.log('Pending email verifications:\n');
    for (const r of matches) {
      console.log(`  ${r.email}`);
      console.log(`    ${base}/verify-email?token=${r.token}\n`);
    }
    console.log(
      'Open the link in the portal you signed up on, or POST the token to\n' +
        '/api/v1/auth/verify-email.',
    );
  }

  await ds.destroy();
  await redis.quit();
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
