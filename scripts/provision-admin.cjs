// Trusted operator command; never expose this through a public API or build hook.
// ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/provision-admin.cjs
// Supply the intended PostgreSQL connection through the environment.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { getDatabaseUrl, assertDatabaseUrl } = require('../dist/config/database.js');

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  delete process.env.ADMIN_PASSWORD;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set ADMIN_EMAIL to the authorized administrator email.');
  }
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('ADMIN_PASSWORD must contain at least 8 characters and at most 72 UTF-8 bytes.');
  }
  const url = getDatabaseUrl();
  assertDatabaseUrl(url);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, name: 'Admin', password: hashedPassword, role: 'admin' },
      update: { password: hashedPassword, role: 'admin' },
      select: { id: true, email: true, role: true },
    });
    console.log(JSON.stringify({ status: 'provisioned', ...user }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  // Database errors may contain connection details; keep credentials out of logs.
  console.error('Admin provisioning failed. Check the supplied email, password, PostgreSQL connection and schema.');
  process.exitCode = 1;
});
