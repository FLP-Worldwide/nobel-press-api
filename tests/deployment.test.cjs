const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test, before, after } = require('node:test');
const express = require('express');
const cors = require('cors');

// Never use a developer or production database in deployment smoke tests.
process.env.NODE_ENV = 'production';
process.env.VERCEL = '1';
process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:1/deployment_test';
process.env.JWT_SECRET = 'deployment-test-only';
// An explicit blank prevents Prisma's local .env loader from injecting localhost.
process.env.ALLOWED_ORIGIN = '';
const app = require('../dist/app.js').default;
const prisma = require('../dist/utils/prisma.js').default;
const { corsOptions } = require('../dist/config/cors.js');
const origin = 'https://nobelbooks.vercel.app';
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await prisma.$disconnect();
});

test('cold-start import serves /, /api and health without a database or cookies', async () => {
  for (const path of ['/', '/api', '/api/health']) {
    const res = await fetch(base + path, { headers: { Origin: origin } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
});

test('production website can preflight bearer-authenticated and JSON requests', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const res = await fetch(base + '/api/books/all', {
      method: 'OPTIONS', headers: {
        Origin: origin, 'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.match(res.headers.get('access-control-allow-headers'), /Authorization/);
    assert.ok(res.headers.get('access-control-allow-methods').split(',').includes(method));
  }
});

test('other sites and localhost receive no production CORS access', async () => {
  for (const denied of ['https://unrelated.vercel.app', 'https://nobelbooks.vercel.app.evil.test', 'http://localhost:3000', 'null']) {
    const res = await fetch(base + '/api/health', { headers: { Origin: denied } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    await res.text();
  }
});

test('configured origins accept surrounding whitespace/trailing slash but no wildcard or path', async () => {
  const configured = express();
  configured.use(cors(corsOptions({ ALLOWED_ORIGIN: ' https://nobelbooks.vercel.app/ , https://admin.example.test , *, https://bad.example.test/path' })));
  configured.get('/', (_req, res) => res.sendStatus(200));
  const local = configured.listen(0, '127.0.0.1');
  await once(local, 'listening');
  try {
    for (const [site, expected] of [[origin, origin], ['https://admin.example.test', 'https://admin.example.test'], ['https://bad.example.test', null], ['https://unrelated.test', null]]) {
      const res = await fetch(`http://127.0.0.1:${local.address().port}`, { headers: { Origin: site } });
      assert.equal(res.headers.get('access-control-allow-origin'), expected);
      await res.text();
    }
  } finally { await new Promise(resolve => local.close(resolve)); }
});

test('authentication failures and malformed JSON retain CORS and return JSON', async () => {
  const unauthorized = await fetch(base + '/api/auth/profile', { headers: { Origin: origin } });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('access-control-allow-origin'), origin);
  await unauthorized.json();
  const malformed = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get('access-control-allow-origin'), origin);
  assert.equal((await malformed.json()).message, 'Request body must contain valid JSON');
});

test('readiness distinguishes missing configuration, connected database, and unavailable database', async () => {
  const query = prisma.$queryRaw;
  const log = console.error;
  console.error = () => {};
  try {
    delete process.env.JWT_SECRET;
    let res = await fetch(base + '/api/health/ready', { headers: { Origin: origin } });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).message, 'API configuration is incomplete');
    process.env.JWT_SECRET = 'deployment-test-only';
    prisma.$queryRaw = async () => [{ 1: 1 }];
    res = await fetch(base + '/api/health/ready');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).database, 'connected');
    prisma.$queryRaw = async () => { throw new Error('private database details'); };
    res = await fetch(base + '/api/health/ready', { headers: { Origin: origin } });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.deepEqual(await res.json(), { status: 'unavailable', message: 'Database connection failed' });
  } finally {
    prisma.$queryRaw = query;
    console.error = log;
    process.env.JWT_SECRET = 'deployment-test-only';
  }
});

test('a database failure in the catalog preserves CORS instead of hiding the server response', async () => {
  const findMany = prisma.book.findMany;
  const log = console.error;
  prisma.book.findMany = async () => { throw new Error('private database details'); };
  console.error = () => {};
  try {
    const res = await fetch(base + '/api/books/all', { headers: { Origin: origin } });
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.deepEqual(await res.json(), { message: 'Failed to fetch books' });
  } finally { prisma.book.findMany = findMany; console.error = log; }
});
