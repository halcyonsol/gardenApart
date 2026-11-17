# A Garden Apart

*Some things cannot grow alone.*

A quiet, two-player cooperative garden. One person plants; the other tends the rain and light. Neither can make it bloom alone.

Built with **Node.js, Express, Socket.IO, vanilla JavaScript, and p5.js**. The server owns all gameplay state; the browsers draw and request actions. No database or external artwork is required.

## Run locally

Use Node.js 24 (the version selected in `.node-version` and the Render configuration; Node 22+ is supported).

```sh
npm install
npm start
```

Open **http://localhost:3000**. Run these commands from this project's folder in VS Code. `npm run dev` automatically restarts the server after server-file edits; refresh the browser after client edits. Stop with Ctrl+C. If port 3000 is busy, use `PORT=3001 npm start`.

Use the Node server, not VS Code Live Server or a file URL: the game needs the Socket.IO backend.

## Play together

1. In the first tab, click **Enter the Garden**, choose **Gardener**, leave the room code empty, and create a garden.
2. Click **Copy invitation**, then open that link in a fresh second tab. The link selects the remaining role, **Keeper**. Enter and join.
3. The Gardener taps empty plots (or focuses a plot with Tab and presses Enter/Space) to plant seeds.
4. The Keeper adjusts the sliders. Keep rainfall at **35–75%** and sunlight at **35–80%**. The highlighted portions show these ranges.
5. Seeds become sprouts, then flowers after about **180 seconds of healthy conditions**. Rain slowly decreases and sunlight drifts, so the Keeper needs to keep tending them.
6. Unhealthy conditions pause growth. After 15 seconds plants wilt; healthy weather gradually revives them. Plants never die permanently.
7. Bloom six flowers to finish. Either player can click **Begin a new garden** to restart together in the same room.

A typical session takes about 3–5 minutes, depending on how quickly seeds are planted and how consistently the weather stays healthy. Growth, weather, and elapsed time pause when either player disconnects. A disconnected role stays reserved for 60 seconds; afterward a new player can take it. **Leave this garden** immediately releases your role.

Normal tabs have independent identities. Avoid your browser's **Duplicate tab** command, which can copy a session identity. Use a fresh tab or another browser instead. Refreshing a joined tab restores that role while its reservation is valid.

A localhost invitation works on this computer only. For two devices on the same Wi-Fi, open the host computer's LAN IP and port 3000 on both devices. For remote players, use the deployed HTTPS URL. Clipboard access may be unavailable on plain HTTP; the button then displays the room code to share manually.

## Files and responsibilities

| File | Purpose |
| --- | --- |
| `server.js` | Express routes, Socket.IO room membership, action validation, authoritative timer, reconnects, and cleanup |
| `garden.js` | Readable growth, weather, wilting/recovery, completion, and reset rules |
| `public/index.html` | Intro, role selection, controls, planting buttons, invitation, and completion screens |
| `public/client.js` | Socket connection, per-tab identity, live state rendering, role-aware controls, and player actions |
| `public/sketch.js` | p5.js hills, moon, flowers, rain, fireflies, growth interpolation, and celebration |
| `public/style.css` | Twilight palette, responsive layout, control styling, and reduced-motion support |
| `test/*.test.js` | Rule and real Socket.IO integration tests |
| `test/browser.cjs` | Full game browser checks and desktop/mobile screenshots |
| `test/remote.cjs` | Two-client smoke check against a local or deployed server |
| `render.yaml` | Render Node web-service configuration |
| `.github/workflows/checks.yml` | Automated Node tests on GitHub pushes and pull requests |
| `PROJECT.md` | Original brief, retained as historical planning context |

`package-lock.json` locks dependency versions. `.gitignore` excludes dependencies, secrets, logs, and test screenshots. p5.js, its English diagnostic messages, and the Socket.IO browser library are all served by this app.

## How multiplayer works

The browser emits `garden:join` with a room code (empty to create), role, and random session token. The server validates the request, claims the available role, joins the socket to that room, and returns an acknowledgement. It broadcasts `garden:state` only to the two players in that room. Tokens stay private and are never included in public state.

The Gardener sends `garden:plant` with a plot number. The Keeper sends `garden:weather` with a weather type and value. The server checks membership, role, round number, active connections, and input values before changing anything. Disabled controls are helpful interface feedback; server validation is the actual enforcement.

Once a seed is planted, the server runs growth updates every second. Clients cannot supply their own progress or completion state. At six healthy blooms the server freezes the completed garden and emits `garden:complete`. `garden:restart` resets plants and weather, increments the round number, and preserves the players. The round number prevents a delayed action from affecting a newly restarted garden.

Socket.IO normally upgrades to WebSockets and also supports HTTP long polling. Both use the same server and port. Membership, plants, and weather live in memory. Server restarts/deployments clear rooms. Empty rooms are removed after ten minutes. Use a single server instance for this version.

## Verification

```sh
npm test
npm run test:browser
```

The browser test uses installed Chrome at the standard macOS path. On another system, set `CHROME_PATH` to its executable. It starts and closes its own server and headless browser. Screenshots go into ignored `test-results/`.

The browser test accelerates growth to six seconds **only in its private test server**. The normal application still requires 180 healthy seconds; rule tests advance that full duration deterministically. Tests cover roles, invalid actions, room separation, weather synchronization, wilting/recovery, disconnect pauses, reconnection, completion, replay, keyboard planting, responsive layout, and page/HTTP errors.

To test a live deployment after installing dev dependencies locally:

```sh
npm run test:remote -- https://YOUR-SERVICE.onrender.com
```

This creates a temporary garden, connects two clients, checks shared planting/weather and server growth, then releases both roles. It does not touch existing gardens.

## Deployment

Play at **[a-garden-apart.onrender.com](https://a-garden-apart.onrender.com)**. The repository is [halcyonsol/gardenApart](https://github.com/halcyonsol/gardenApart). See [DEPLOYMENT.md](DEPLOYMENT.md) for hosting details and the two-device acceptance test.

The game is publicly deployed. On November 17, 2026, the live two-client smoke check passed: health endpoint, WebSocket connections, roles, shared planting/weather, and server-driven growth. Full completion and replay were tested locally in Chrome; a full three-minute session on two separate physical devices has not been verified.
