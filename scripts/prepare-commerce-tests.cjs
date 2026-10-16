const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8').replace(
  'provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  previewFeatures = ["driverAdapters"]\n  output = "./.commerce-test-client"');
const target = path.join(root, 'node_modules/.commerce-test.prisma');
fs.writeFileSync(target, schema);
try { execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'generate', '--schema', target], { cwd: root, stdio: 'pipe' }); }
finally { fs.unlinkSync(target); }
