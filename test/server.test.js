const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { io: connect } = require('socket.io-client');
const { createGardenServer } = require('../server');

test('room membership, validation, isolation, and reconnection', async t => {
  const { server, io } = createGardenServer({ reconnectMs: 180, cleanupMs: 20 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.disconnect();
    await new Promise(resolve => io.close(resolve));
  });
  async function client() {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  function join(socket, code, role, token = randomUUID()) {
    return socket.timeout(2000).emitWithAck('garden:join', { code, role, token });
  }
  function stateMatching(socket, match) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off('garden:state', handler); reject(new Error('Missing state update')); }, 2000);
      function handler(state) {
        if (match(state)) { clearTimeout(timer); socket.off('garden:state', handler); resolve(state); }
      }
      socket.on('garden:state', handler);
    });
  }

  for (const [route, status] of [['/', 200], ['/health', 200], ['/en-US.json', 200], ['/vendor/p5.min.js', 200], ['/server.js', 404]]) {
    const response = await fetch(`${url}${route}`);
    assert.equal(response.status, status);
    await response.arrayBuffer();
  }
  const gardener = await client();
  const token = randomUUID();
  const created = await join(gardener, '', 'gardener', token);
  assert.equal(created.ok, true);
  assert.equal(created.state.paused, true);
  assert.equal(created.state.plots.length, 9);
  assert.equal(JSON.stringify(created).includes(token), false);
  const code = created.state.code;
  const keeper = await client();
  const ready = stateMatching(gardener, state => !state.paused);
  assert.equal((await join(keeper, code.toLowerCase(), 'keeper')).ok, true);
  assert.equal((await ready).players.keeper, 'connected');

  const third = await client();
  assert.equal((await join(third, code, 'gardener')).ok, false);
  const badRole = await client();
  assert.equal((await join(badRole, code, 'wizard')).ok, false);
  assert.equal((await badRole.timeout(2000).emitWithAck('garden:join', null)).ok, false);
  assert.equal((await join(badRole, 'bad!', 'keeper')).ok, false);
  assert.equal((await join(badRole, 'FFFFFF', 'keeper')).ok, false);
  const outsider = await client();
  const other = await join(outsider, '', 'keeper');
  assert.notEqual(other.state.code, code);
  let leaked = false;
  outsider.on('garden:state', state => { if (state.code === code) leaked = true; });

  const waiting = stateMatching(keeper, state => state.players.gardener === 'reconnecting');
  gardener.disconnect();
  assert.equal((await waiting).paused, true);
  const intruder = await client();
  assert.match((await join(intruder, code, 'gardener')).message, /reserved/);
  const reconnected = await client();
  const resumed = await join(reconnected, code, 'gardener', token);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.state.paused, false);
  const available = stateMatching(keeper, state => state.players.gardener === 'available');
  reconnected.disconnect();
  await available;
  const replacement = await client();
  assert.equal((await join(replacement, code, 'gardener')).ok, true);
  assert.equal(leaked, false);
});
