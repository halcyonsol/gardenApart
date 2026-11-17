// All game rules live on the server. Browsers only request actions and draw state.
const HEALTHY = { rainfall: [35, 75], sunlight: [35, 80] };
const GROW_SECONDS = 180;
const WILT_AFTER = 15;

function resetGarden(room) {
  room.plots = Array.from({ length: 9 }, (_, id) => ({ id, stage: 'empty', growth: 0, stress: 0, wilted: false }));
  room.rainfall = 55;
  room.sunlight = 55;
  room.complete = false;
  room.started = false;
  room.elapsed = 0;
  room.round = (room.round || 0) + 1;
}

function healthy(room) {
  return Object.entries(HEALTHY).every(([key, [min, max]]) => room[key] >= min && room[key] <= max);
}

function bloomCount(room) {
  return room.plots.filter(plot => plot.stage === 'bloom' && !plot.wilted).length;
}

// A one-second server tick advances only while both players are present.
// The optional settings are injected by tests, never controlled by clients.
function advanceGarden(room, seconds, { growSeconds = GROW_SECONDS, drift = true } = {}) {
  if (room.complete || !room.started || !room.players.gardener?.socketId || !room.players.keeper?.socketId) return false;
  room.elapsed += seconds;
  if (drift) {
    room.rainfall = Math.max(0, room.rainfall - seconds * .18);
    room.sunlight = Math.min(100, Math.max(0, room.sunlight + Math.cos(room.elapsed / 70) * seconds * .22));
  }
  const good = healthy(room);
  for (const plot of room.plots) {
    if (plot.stage === 'empty') continue;
    plot.stress = good ? Math.max(0, plot.stress - seconds * 2) : Math.min(30, plot.stress + seconds);
    if (plot.stress >= WILT_AFTER) plot.wilted = true;
    if (plot.stress === 0) plot.wilted = false;
    if (good && !plot.wilted) plot.growth = Math.min(1, plot.growth + seconds / growSeconds);
    // A tiny tolerance avoids an extra tick from floating-point rounding.
    if (plot.growth >= 1 - 1e-9) plot.growth = 1;
    plot.stage = plot.growth >= 1 ? 'bloom' : plot.growth >= .18 ? 'sprout' : 'seed';
  }
  room.complete = bloomCount(room) >= 6;
  return true;
}

module.exports = { resetGarden, healthy, bloomCount, advanceGarden, HEALTHY };
