const socket = io();
const byId = id => document.getElementById(id);
let membership = null;
let state = null;
let hasCanvas = false;
let joining = false;
let completionRound = null;
const weatherTimers = {};
const editingWeather = new Set();

// A random per-tab identity works on localhost, HTTPS, and a local-network HTTP URL.
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
let token = newToken();
try {
  const saved = sessionStorage.getItem('garden-token');
  if (/^[a-f0-9-]{36}$/i.test(saved || '')) token = saved;
  sessionStorage.setItem('garden-token', token);
  const savedMembership = JSON.parse(sessionStorage.getItem('garden-membership') || 'null');
  if (savedMembership && /^[A-F0-9]{6}$/.test(savedMembership.code) && ['gardener', 'keeper'].includes(savedMembership.role)) membership = savedMembership;
} catch { /* Storage is optional; this tab can still play. */ }

const params = new URLSearchParams(location.search);
const inviteCode = params.get('room');
if (inviteCode) byId('room-code').value = inviteCode.toUpperCase();
if (membership && inviteCode && membership.code !== inviteCode.toUpperCase()) membership = null;
if (['gardener', 'keeper'].includes(params.get('role'))) document.querySelector(`input[value="${params.get('role')}"]`).checked = true;

function showScreen(name) {
  for (const screen of ['intro', 'lobby', 'garden']) byId(screen).hidden = screen !== name;
}

// Real HTML buttons overlay the canvas, making every plot keyboard accessible.
const plotButtons = Array.from({ length: 9 }, (_, id) => {
  const button = document.createElement('button');
  button.className = 'plot-button';
  button.style.left = `${23 + id % 3 * 27}%`;
  button.style.top = `${61 + Math.floor(id / 3) * 13}%`;
  button.innerHTML = `<span class="plot-number">${id + 1}</span><span class="plot-tip"></span>`;
  button.addEventListener('click', () => sendAction('garden:plant', { plot: id }));
  byId('plot-targets').append(button);
  return button;
});
byId('bloom-dots').innerHTML = '<span>✳</span>'.repeat(6);

function clearWeatherTimers() {
  for (const timer of Object.values(weatherTimers)) clearTimeout(timer);
  editingWeather.clear();
}

function render(nextState) {
  const changedRound = state && state.round !== nextState.round;
  state = nextState;
  if (changedRound) { clearWeatherTimers(); byId('action-error').textContent = ''; }
  showScreen('garden');
  byId('current-code').textContent = state.code;
  for (const role of ['gardener', 'keeper']) {
    const status = state.players[role];
    byId(`${role}-status`).textContent = { connected: 'Connected', reconnecting: 'Reconnecting · place held for 1 min', available: 'Waiting for another hand' }[status];
    byId(`${role}-status`).className = `player-status ${status}`;
    byId(`${role}-you`).textContent = membership.role === role ? '(you)' : '';
  }
  const available = socket.connected && !state.paused;
  byId('presence').textContent = !socket.connected ? 'Connection lost. Finding our way back…' : state.paused ? 'The garden is waiting for another hand.' : state.complete ? 'Look what you made together.' : 'You’re both here. Let something grow.';
  for (const [kind, output] of [['rainfall', 'rain'], ['sunlight', 'sun']]) {
    if (!editingWeather.has(kind)) {
      byId(kind).value = Math.round(state[kind]);
      byId(output).textContent = `${Math.round(state[kind])}%`;
    }
    byId(kind).disabled = !available || state.complete || membership.role !== 'keeper';
  }
  const wilted = state.plots.filter(plot => plot.wilted).length;
  let health = 'The conditions are gentle. Keep them here.';
  if (!state.healthy) health = 'Growth is resting. Bring rain and light into their happy ranges.';
  else if (wilted) health = 'A little patience. Your plants are recovering.';
  if (state.paused) health = 'Growth and weather pause while you’re apart.';
  if (state.complete) health = 'A little world in bloom. Yours, together.';
  byId('weather-health').textContent = health;
  byId('weather-health').classList.toggle('unhealthy', !state.healthy && !state.paused);
  byId('blooms').innerHTML = `${state.blooms} <small>/ 6</small>`;
  [...byId('bloom-dots').children].forEach((dot, index) => dot.classList.toggle('bloomed', index < state.blooms));
  byId('role-help').textContent = membership.role === 'gardener' ? 'You are the Gardener. Tap an empty plot to plant a seed; your partner tends the weather.' : 'You are the Keeper. Adjust rain and sunlight to keep them within their happy ranges.';
  byId('scene-message').textContent = state.complete ? 'LOOK WHAT GREW BETWEEN US' : state.paused ? 'WAITING FOR ANOTHER HAND' : !state.started ? 'PLANT A BEGINNING' : wilted ? 'EVEN NOW, THERE IS TIME TO RECOVER' : 'A LITTLE PATIENCE, A LITTLE CARE';
  byId('elapsed').textContent = `${String(Math.floor(state.elapsed / 60)).padStart(2, '0')}:${String(state.elapsed % 60).padStart(2, '0')}`;
  state.plots.forEach((plot, id) => {
    const button = plotButtons[id];
    const description = plot.stage === 'empty' ? 'empty' : `${plot.stage}${plot.wilted ? ', recovering care needed' : ''}, ${Math.round(plot.growth * 100)}% grown`;
    button.setAttribute('aria-label', `Plot ${id + 1}: ${description}${membership.role === 'gardener' && plot.stage === 'empty' ? '. Plant a seed' : ''}`);
    button.disabled = !available || state.complete || membership.role !== 'gardener' || plot.stage !== 'empty';
    button.dataset.stage = plot.stage;
    button.querySelector('.plot-tip').textContent = plot.stage === 'empty' ? 'Plant a seed' : plot.wilted ? 'Needs gentle weather' : plot.stage;
  });
  byId('completion').hidden = !state.complete;
  byId('restart').disabled = !available;
  byId('restart-help').textContent = available ? 'Both of you will begin again, in this same room.' : 'Your partner needs to return before you begin again.';
  if (state.complete && completionRound !== `${state.code}-${state.round}`) {
    completionRound = `${state.code}-${state.round}`;
    byId('completion').focus({ preventScroll: true });
  }
  if (!hasCanvas) { window.createGardenSketch(); hasCanvas = true; }
  window.gardenScene = { state, role: membership.role, connected: socket.connected };
}

function sendAction(event, payload = {}) {
  if (!membership || !state || !socket.connected) return;
  byId('action-error').textContent = '';
  socket.timeout(5000).emit(event, { ...payload, round: state.round }, (error, result) => {
    if (error || !result?.ok) byId('action-error').textContent = error ? 'The garden did not respond. Check your connection and try again.' : result.message;
  });
}

function joinGarden(code, role, restoring = false) {
  if (joining || !socket.connected) return;
  joining = true;
  byId('join').disabled = true;
  byId('join-error').textContent = '';
  socket.timeout(5000).emit('garden:join', { code, role, token }, (error, result) => {
    joining = false;
    byId('join').disabled = !socket.connected;
    if (error || !result?.ok) {
      if (restoring) {
        membership = null;
        try { sessionStorage.removeItem('garden-membership'); } catch { /* Optional storage. */ }
      }
      if (error) socket.disconnect().connect();
      showScreen('lobby');
      byId('room-code').value = code;
      byId('join-error').textContent = error ? 'The garden did not respond. Please try again.' : result.message;
      return;
    }
    membership = { code: result.state.code, role: result.role };
    try { sessionStorage.setItem('garden-membership', JSON.stringify(membership)); } catch { /* Optional storage. */ }
    history.replaceState(null, '', `?room=${membership.code}`);
    render(result.state);
  });
}

byId('enter').addEventListener('click', () => {
  showScreen('lobby');
  byId('lobby-title').setAttribute('tabindex', '-1');
  byId('lobby-title').focus();
});
byId('join-form').addEventListener('submit', event => {
  event.preventDefault();
  joinGarden(byId('room-code').value.trim().toUpperCase(), new FormData(event.currentTarget).get('role'));
});
for (const [kind, output] of [['rainfall', 'rain'], ['sunlight', 'sun']]) {
  byId(kind).addEventListener('input', event => {
    const value = Number(event.target.value);
    editingWeather.add(kind);
    byId(output).textContent = `${value}%`;
    clearTimeout(weatherTimers[kind]);
    // Send a short burst's last value, rather than flooding the room with events.
    weatherTimers[kind] = setTimeout(() => {
      editingWeather.delete(kind);
      sendAction('garden:weather', { kind, value });
    }, 80);
  });
}
byId('restart').addEventListener('click', () => sendAction('garden:restart'));
byId('leave').addEventListener('click', () => {
  clearWeatherTimers();
  socket.emit('garden:leave');
  membership = null;
  state = null;
  window.gardenScene = null;
  try { sessionStorage.removeItem('garden-membership'); } catch { /* Optional storage. */ }
  history.replaceState(null, '', '/');
  byId('room-code').value = '';
  byId('join-error').textContent = '';
  showScreen('lobby');
});

socket.on('connect', () => {
  byId('connection').textContent = 'Connected';
  byId('connection').classList.add('online');
  byId('join').disabled = false;
  if (membership) joinGarden(membership.code, membership.role, true);
});
socket.on('disconnect', () => {
  clearWeatherTimers();
  byId('connection').textContent = 'Reconnecting…';
  byId('connection').classList.remove('online');
  byId('join').disabled = true;
  if (membership && state) render(state);
});
socket.on('connect_error', () => {
  byId('connection').textContent = 'Server unavailable · retrying';
  byId('connection').classList.remove('online');
  byId('join').disabled = true;
});
socket.on('garden:state', nextState => { if (membership && nextState.code === membership.code) render(nextState); });

byId('copy').addEventListener('click', async () => {
  const otherRole = membership.role === 'gardener' ? 'keeper' : 'gardener';
  const url = `${location.origin}/?room=${membership.code}&role=${otherRole}`;
  try {
    await navigator.clipboard.writeText(url);
    byId('copy-status').textContent = 'Invitation copied';
  } catch {
    byId('copy-status').textContent = `Share room code: ${membership.code}`;
  }
});
