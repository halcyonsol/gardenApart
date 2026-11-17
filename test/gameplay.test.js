const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { io: connect } = require('socket.io-client');
const { createGardenServer } = require('../server');

test('real sockets enforce gameplay roles, synchronize a complete round, and restart safely', async t => {
  const { server, io } = createGardenServer({ tickMs: 20, gameOptions: { growSeconds: .4, drift: false } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const sockets = [];
  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await new Promise(resolve => io.close(resolve));
  });
  async function connectClient() {
    const socket = connect(`http://127.0.0.1:${server.address().port}`, { forceNew: true, transports: ['websocket'] });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  const send = (socket, event, payload) => socket.timeout(2000).emitWithAck(event, payload);
  const join = (socket, code, role) => send(socket, 'garden:join', { code, role, token: randomUUID() });
  function waitState(socket, predicate) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off('garden:state', handler); reject(new Error('Expected game state was not received')); }, 3000);
      function handler(state) { if (predicate(state)) { clearTimeout(timeout); socket.off('garden:state', handler); resolve(state); } }
      socket.on('garden:state', handler);
    });
  }
  const gardener = await connectClient();
  const created = await join(gardener, '', 'gardener');
  const { code, round } = created.state;
  assert.equal((await send(gardener, 'garden:plant', { round, plot: 0 })).ok, false);
  const keeper = await connectClient();
  await join(keeper, code, 'keeper');
  const stranger = await connectClient();
  assert.equal((await send(stranger, 'garden:plant', { round, plot: 0 })).ok, false);
  assert.equal((await send(keeper, 'garden:plant', { round, plot: 0 })).ok, false);
  assert.equal((await send(gardener, 'garden:weather', { round, kind: 'rainfall', value: 60 })).ok, false);
  for (const plot of [-1, 9, 1.5, '1', null]) assert.equal((await send(gardener, 'garden:plant', { round, plot })).ok, false);
  for (const value of [-1, 101, null, '50']) assert.equal((await send(keeper, 'garden:weather', { round, kind: 'rainfall', value })).ok, false);
  assert.equal((await send(keeper, 'garden:weather', { round, kind: 'complete', value: 100 })).ok, false);
  assert.equal((await send(keeper, 'garden:weather', null)).ok, false);
  const badWeather = waitState(gardener, state => state.rainfall === 0);
  assert.equal((await send(keeper, 'garden:weather', { round, kind: 'rainfall', value: 0 })).ok, true);
  assert.equal((await badWeather).healthy, false);
  const planted = waitState(keeper, state => state.plots[0].stage === 'seed');
  assert.equal((await send(gardener, 'garden:plant', { round, plot: 0 })).ok, true);
  await planted;
  assert.equal((await send(gardener, 'garden:plant', { round, plot: 0 })).ok, false);
  assert.equal((await send(gardener, 'garden:restart', { round })).ok, false);
  for (let plot = 1; plot < 6; plot++) await send(gardener, 'garden:plant', { round, plot });
  const completionA = waitState(gardener, state => state.complete);
  const completionB = waitState(keeper, state => state.complete);
  await send(keeper, 'garden:weather', { round, kind: 'rainfall', value: 55 });
  const [a, b] = await Promise.all([completionA, completionB]);
  assert.deepEqual(a, b);
  assert.equal(a.blooms, 6);
  assert.equal((await send(gardener, 'garden:plant', { round, plot: 7 })).ok, false);
  const restarted = waitState(keeper, state => state.round === round + 1);
  assert.equal((await send(gardener, 'garden:restart', { round })).ok, true);
  assert.ok((await restarted).plots.every(plot => plot.stage === 'empty'));
  assert.equal((await send(keeper, 'garden:weather', { round, kind: 'sunlight', value: 10 })).ok, false);
  const left = waitState(gardener, state => state.players.keeper === 'available');
  await keeper.timeout(2000).emitWithAck('garden:leave');
  assert.equal((await left).paused, true);
  assert.equal((await send(keeper, 'garden:weather', { round: round + 1, kind: 'sunlight', value: 10 })).ok, false);
});
