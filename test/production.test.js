const { test } = require('node:test');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createGardenServer } = require('../server');

test('deployment smoke script works against normal production timing', async t => {
  const { server, io } = createGardenServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => io.close(resolve)));
  const { stdout } = await promisify(execFile)(process.execPath, [
    path.join(__dirname, 'remote.cjs'), `http://127.0.0.1:${server.address().port}`
  ], { timeout: 15000 });
  assert.match(stdout, /Two-client smoke check passed/);
});
