const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getDatabaseUrl, assertDatabaseUrl } = require('../dist/config/database.js');

test('Vercel integration overrides the stale local database setting', () => {
  const managed = 'postgres://user:private@db.prisma.io:5432/postgres?sslmode=require';
  assert.equal(getDatabaseUrl({ nobel_book_api_DATABASE_URL: ` ${managed} `, DATABASE_URL: 'mysql://localhost:3307/app' }), managed);
  assert.equal(getDatabaseUrl({ nobel_book_api_DATABASE_URL: ' ', DATABASE_URL: managed }), managed);
  assert.equal(getDatabaseUrl({}), undefined);
});

test('deployment refuses missing, wrong-provider and loopback connections without exposing secrets', () => {
  for (const url of [undefined, 'invalid-private-secret', 'mysql://u:private@db.example/app', 'prisma+postgres://example/?api_key=private']) {
    assert.throws(() => assertDatabaseUrl(url, true), error => !error.message.includes('private'));
  }
  for (const host of ['localhost', '127.0.0.1', '0.0.0.0', '[::1]']) {
    assert.throws(() => assertDatabaseUrl(`postgresql://u:p@${host}:5432/app`, true), /local database/);
  }
  assert.doesNotThrow(() => assertDatabaseUrl('postgresql://u:p@127.0.0.1:5432/app'));
  assert.doesNotThrow(() => assertDatabaseUrl('postgres://u:p@db.prisma.io:5432/postgres?sslmode=require', true));
});
