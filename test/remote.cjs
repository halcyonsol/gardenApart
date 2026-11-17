// Run with: npm run test:remote -- https://your-service.onrender.com
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { io } = require('socket.io-client');

(async () => {
  const url = new URL(process.argv[2]);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Supply an HTTP or HTTPS app URL.');
  const health = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(60000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  const clients = [];
  try {
    async function connect() {
      const socket = io(url.origin, { transports: ['websocket'], reconnection: false, timeout: 20000, forceNew: true });
      clients.push(socket);
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      return socket;
    }
    const send = (socket, event, payload) => socket.timeout(10000).emitWithAck(event, payload);
    const gardener = await connect();
    const keeper = await connect();
    const created = await send(gardener, 'garden:join', { code: '', role: 'gardener', token: randomUUID() });
    assert.equal(created.ok, true);
    const { code, round } = created.state;
    const joined = await send(keeper, 'garden:join', { code, role: 'keeper', token: randomUUID() });
    assert.equal(joined.ok, true);
    assert.equal(joined.state.paused, false);
    const grown = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server growth was not broadcast to the Keeper')), 10000);
      keeper.on('garden:state', state => {
        if (state.plots[0].growth > 0 && state.rainfall > 59 && state.rainfall <= 60) {
          clearTimeout(timeout); resolve(state);
        }
      });
    });
    // Attach a rejection handler immediately if a preceding assertion fails.
    grown.catch(() => {});
    assert.equal((await send(keeper, 'garden:weather', { round, kind: 'rainfall', value: 60 })).ok, true);
    assert.equal((await send(gardener, 'garden:plant', { round, plot: 0 })).ok, true);
    const shared = await grown;
    assert.equal(shared.players.gardener, 'connected');
    assert.equal(shared.players.keeper, 'connected');
    console.log(`Two-client smoke check passed at ${url.origin}: health, WebSockets, roles, shared planting/weather, and server growth.`);
  } finally {
    for (const socket of clients) {
      if (socket.connected) await socket.timeout(2000).emitWithAck('garden:leave').catch(() => {});
      socket.disconnect();
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
