const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Server } = require('socket.io');
const { resetGarden, healthy, bloomCount, advanceGarden, HEALTHY } = require('./garden');

// A factory lets the tests start their own server without using port 3000.
function createGardenServer({ reconnectMs = 60_000, cleanupMs = 5_000, tickMs = 1000, gameOptions = {} } = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 4096 });
  const rooms = new Map();
  const roles = ['gardener', 'keeper'];

  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/vendor/p5.min.js', (_req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules/p5/lib/p5.min.js'));
  });
  // p5 asks for a browser-locale JSON file. Serve its bundled English messages
  // locally (the app's language), including for regional locales such as en-US.
  app.get(/^\/[a-z]{2,3}(?:-[a-z0-9]{2,8})*\.json$/i, (_req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules/p5/translations/en/extracted.json'));
  });

  function newRoom() {
    let code;
    do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
    const room = {
      code,
      players: { gardener: null, keeper: null },
      touchedAt: Date.now()
    };
    resetGarden(room);
    rooms.set(code, room);
    return room;
  }

  // Only send public state. Reconnection tokens never leave the server.
  function snapshot(room) {
    const players = {};
    for (const role of roles) {
      const player = room.players[role];
      players[role] = player?.socketId ? 'connected' : player ? 'reconnecting' : 'available';
    }
    return {
      code: room.code, players, plots: room.plots,
      rainfall: room.rainfall, sunlight: room.sunlight, complete: room.complete,
      round: room.round, elapsed: Math.floor(room.elapsed), started: room.started,
      healthy: healthy(room), healthyRanges: HEALTHY, blooms: bloomCount(room),
      paused: !roles.every(role => players[role] === 'connected')
    };
  }

  function broadcast(room) {
    io.to(room.code).emit('garden:state', snapshot(room));
  }

  function expireReservations(room) {
    let changed = false;
    for (const role of roles) {
      const player = room.players[role];
      if (player && !player.socketId && player.reservedUntil <= Date.now()) {
        room.players[role] = null;
        changed = true;
      }
    }
    return changed;
  }

  io.on('connection', socket => {
    socket.on('garden:join', (input, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      const fail = message => acknowledge({ ok: false, message });
      if (!input || typeof input !== 'object') return fail('Please choose a role and try again.');
      const { role, token } = input;
      if (!roles.includes(role)) return fail('Choose Gardener or Keeper.');
      if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/i.test(token)) {
        return fail('Your session is invalid. Reload this page to try again.');
      }
      if (typeof input.code !== 'string') return fail('Enter a valid six-character room code.');
      const code = input.code.trim().toUpperCase();
      if (code && !/^[A-F0-9]{6}$/.test(code)) return fail('Room codes contain six letters (A–F) or numbers.');
      if (socket.data.roomCode) return fail('You have already joined a garden.');
      // Repeated requests cannot create unbounded rooms from one connection.
      if (socket.data.lastJoin && Date.now() - socket.data.lastJoin < 300) return fail('Please wait a moment and try again.');
      socket.data.lastJoin = Date.now();
      const room = code ? rooms.get(code) : newRoom();
      if (!room) return fail('That garden was not found. Check the code or create a new garden.');
      expireReservations(room);

      // A disconnected player can reclaim their own role for one minute.
      const previousRole = roles.find(name => room.players[name]?.token === token);
      const assignedRole = previousRole || role;
      const player = room.players[assignedRole];
      if (player?.socketId) return fail('That role is already occupied. Choose the other role, or another garden.');
      if (player && player.token !== token) return fail('That role is reserved for a reconnecting player. Try the other role or wait one minute.');

      room.players[assignedRole] = { token, socketId: socket.id, reservedUntil: 0 };
      room.touchedAt = Date.now();
      socket.data.roomCode = room.code;
      socket.data.role = assignedRole;
      socket.join(room.code);
      acknowledge({ ok: true, role: assignedRole, state: snapshot(room) });
      broadcast(room);
    });

    // Every game action must come from the current occupant, in the current round.
    function actionRoom(input, acknowledge, role) {
      if (typeof acknowledge !== 'function') return null;
      const room = rooms.get(socket.data.roomCode);
      let message;
      if (!room || room.players[socket.data.role]?.socketId !== socket.id) message = 'Join a garden first.';
      else if (!input || input.round !== room.round) message = 'The garden has changed. Please try again.';
      else if (role && socket.data.role !== role) message = `Only the ${role === 'gardener' ? 'Gardener' : 'Keeper'} can do that.`;
      else if (!roles.every(name => room.players[name]?.socketId)) message = 'Wait for both players to return.';
      if (message) { acknowledge({ ok: false, message }); return null; }
      return room;
    }

    socket.on('garden:plant', (input, acknowledge) => {
      const room = actionRoom(input, acknowledge, 'gardener');
      if (!room) return;
      const id = input.plot;
      if (room.complete || !Number.isInteger(id) || id < 0 || id >= 9 || room.plots[id].stage !== 'empty') {
        return acknowledge({ ok: false, message: 'Choose an empty plot in a growing garden.' });
      }
      room.plots[id].stage = 'seed';
      room.started = true;
      acknowledge({ ok: true });
      broadcast(room);
    });

    socket.on('garden:weather', (input, acknowledge) => {
      const room = actionRoom(input, acknowledge, 'keeper');
      if (!room) return;
      if (room.complete || !['rainfall', 'sunlight'].includes(input.kind) || typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0 || input.value > 100) {
        return acknowledge({ ok: false, message: 'Weather must be a number between 0 and 100.' });
      }
      room[input.kind] = input.value;
      acknowledge({ ok: true });
      broadcast(room);
    });

    socket.on('garden:restart', (input, acknowledge) => {
      const room = actionRoom(input, acknowledge);
      if (!room) return;
      if (!room.complete) return acknowledge({ ok: false, message: 'Let this garden bloom before beginning again.' });
      resetGarden(room);
      acknowledge({ ok: true });
      broadcast(room);
    });

    socket.on('garden:leave', acknowledge => {
      const room = rooms.get(socket.data.roomCode);
      if (room && room.players[socket.data.role]?.socketId === socket.id) {
        room.players[socket.data.role] = null;
        room.touchedAt = Date.now();
        socket.leave(room.code);
        socket.data.roomCode = null;
        socket.data.role = null;
        broadcast(room);
      }
      if (typeof acknowledge === 'function') acknowledge({ ok: true });
    });

    socket.on('disconnect', () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return;
      const player = room.players[socket.data.role];
      if (!player || player.socketId !== socket.id) return;
      player.socketId = null;
      player.reservedUntil = Date.now() + reconnectMs;
      room.touchedAt = Date.now();
      broadcast(room);
    });
  });

  const growth = setInterval(() => {
    for (const room of rooms.values()) {
      if (advanceGarden(room, tickMs / 1000, gameOptions)) {
        broadcast(room);
        if (room.complete) io.to(room.code).emit('garden:complete', { round: room.round });
      }
    }
  }, tickMs);
  growth.unref();
  const cleanup = setInterval(() => {
    for (const [code, room] of rooms) {
      if (expireReservations(room)) broadcast(room);
      const empty = roles.every(role => !room.players[role]);
      if (empty && Date.now() - room.touchedAt > 10 * 60_000) rooms.delete(code);
    }
  }, cleanupMs);
  cleanup.unref();
  server.on('close', () => { clearInterval(cleanup); clearInterval(growth); });
  return { app, server, io };
}

if (require.main === module) {
  const { server, io } = createGardenServer();
  const port = process.env.PORT || 3000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`A Garden Apart is growing at http://localhost:${port}`);
  });
  server.on('error', error => {
    console.error(`Could not start the garden: ${error.message}`);
    process.exitCode = 1;
  });
  // Hosting providers send SIGTERM before replacing a process during deployment.
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    io.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

module.exports = { createGardenServer };
