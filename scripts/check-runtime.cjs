// Fail the build if the generated client or native dependencies cannot load.
// This imports every route without listening on a port or touching the database.
const assert = require('node:assert/strict');
const app = require('../dist/app.js').default;
const bcrypt = require('bcrypt');
assert.equal(typeof app, 'function');
assert.ok(bcrypt.compareSync('build-check', bcrypt.hashSync('build-check', 4)));
console.log('Runtime check passed: Express, Prisma Client and bcrypt load successfully.');
