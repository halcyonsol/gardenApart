const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resetGarden, advanceGarden, healthy, bloomCount } = require('../garden');

function roomWithSeeds(count = 6) {
  const room = { players: { gardener: { socketId: 'a' }, keeper: { socketId: 'b' } } };
  resetGarden(room);
  room.started = true;
  room.plots.slice(0, count).forEach(plot => { plot.stage = 'seed'; });
  return room;
}

test('six seeds bloom after three healthy minutes, completing once', () => {
  const room = roomWithSeeds();
  for (let second = 0; second < 179; second++) advanceGarden(room, 1, { drift: false });
  assert.equal(room.complete, false);
  assert.equal(room.plots[0].stage, 'sprout');
  advanceGarden(room, 1, { drift: false });
  assert.equal(bloomCount(room), 6);
  assert.equal(room.complete, true);
  assert.equal(room.elapsed, 180);
  assert.equal(advanceGarden(room, 10), false);
  assert.equal(room.elapsed, 180);
});

test('unhealthy conditions pause growth, wilt plants, then allow recovery', () => {
  const room = roomWithSeeds(1);
  advanceGarden(room, 40, { drift: false });
  const growth = room.plots[0].growth;
  room.rainfall = 0;
  advanceGarden(room, 15, { drift: false });
  assert.equal(room.plots[0].growth, growth);
  assert.equal(room.plots[0].wilted, true);
  room.rainfall = 55;
  advanceGarden(room, 7, { drift: false });
  assert.equal(room.plots[0].wilted, true);
  advanceGarden(room, 1, { drift: false });
  assert.equal(room.plots[0].wilted, false);
  assert.ok(room.plots[0].growth > growth);
});

test('disconnect pauses both weather and growth; reset preserves occupants', () => {
  const room = roomWithSeeds();
  room.players.keeper.socketId = null;
  const before = JSON.stringify(room);
  assert.equal(advanceGarden(room, 30), false);
  assert.equal(JSON.stringify(room), before);
  room.players.keeper.socketId = 'b';
  advanceGarden(room, 10);
  assert.ok(room.rainfall < 55);
  assert.ok(room.elapsed > 0);
  resetGarden(room);
  assert.equal(room.round, 2);
  assert.equal(room.started, false);
  assert.equal(room.elapsed, 0);
  assert.equal(room.players.keeper.socketId, 'b');
  assert.ok(room.plots.every(plot => plot.stage === 'empty'));
});

test('healthy ranges include exact boundaries, and weather stays within 0–100', () => {
  const room = roomWithSeeds();
  for (const [rainfall, sunlight] of [[35, 35], [75, 80]]) {
    Object.assign(room, { rainfall, sunlight });
    assert.equal(healthy(room), true);
  }
  room.rainfall = 34.9;
  assert.equal(healthy(room), false);
  for (let i = 0; i < 1000; i++) advanceGarden(room, 1);
  assert.ok(room.rainfall >= 0 && room.rainfall <= 100);
  assert.ok(room.sunlight >= 0 && room.sunlight <= 100);
});
