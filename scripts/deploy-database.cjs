const { spawnSync } = require('node:child_process');
const { getDatabaseUrl, assertDatabaseUrl } = require('../dist/config/database.js');

// The integration is also attached to Preview. Never migrate production data
// from a preview build; a separate preview database must be managed explicitly.
if (process.argv.includes('--vercel') && process.env.VERCEL_ENV !== 'production') {
  console.log('Skipping database migrations outside the production Vercel build.');
  process.exit(0);
}

try {
  if (!process.env.VERCEL) {
    try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const databaseUrl = process.env.DIRECT_URL?.trim() || getDatabaseUrl();
  assertDatabaseUrl(databaseUrl, Boolean(process.env.VERCEL));
  console.log('Applying checked-in PostgreSQL migrations. No reset or data import will be performed.');
  const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
