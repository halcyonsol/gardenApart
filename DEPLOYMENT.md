# Deploy A Garden Apart

The app must run as a **Node web service**, not a static site. Express and Socket.IO share one HTTP server. It binds to `0.0.0.0` and listens on `process.env.PORT || 3000`.

## Render Blueprint

1. Sign in to Render and connect the GitHub account that can access [halcyonsol/gardenApart](https://github.com/halcyonsol/gardenApart).
2. Choose **New → Blueprint** and select the repository's `main` branch.
3. Review `render.yaml` and deploy the `a-garden-apart` web service. The blueprint requests a free instance; review the account's available plans before confirming any charge.
4. Wait for a successful deployment and use the exact HTTPS URL returned by Render. The service name alone does not establish its URL.

The configuration uses Node 24, `npm ci --omit=dev`, `npm start`, and the `/health` endpoint. No API keys or environment secrets are needed. Render supplies `PORT`. Keep one instance because rooms are stored in memory.

Alternatively, create a Node **Web Service** manually with those same build/start commands and health-check path. Do not set a separate WebSocket port: browser connections use the site's origin.

References: [Render Express deployment](https://render.com/docs/deploy-node-express-app), [Blueprint fields](https://render.com/docs/blueprint-spec), [WebSocket hosting](https://render.com/docs/websocket).

## Verify the actual deployed service

From the project folder on your computer:

```sh
npm install
npm run test:remote -- https://YOUR-ACTUAL-SERVICE.onrender.com
```

This verifies the live health endpoint, two WebSocket connections, room membership, shared planting and weather, and at least one real server growth tick. It creates its own room and releases its players afterward.

Then do the human acceptance test on **two different devices/networks**:

1. Create a garden on the live URL as Gardener.
2. Send the invitation to a second device; join as Keeper.
3. Plant six seeds and adjust rain/light. Confirm both devices show the same plants and readings.
4. Keep conditions healthy for about three minutes. Confirm both see “Look what grew between us.”
5. Restart, then disconnect one device. Confirm the other pauses; reconnect within one minute and confirm the role and plants recover.
6. Try joining from a third fresh browser. Confirm occupied roles cannot be taken.

Record the actual URL, deployed commit, and verification result after deployment. **No public URL or remote test result is assumed by the local checks.**

## Operational behavior

- A server restart, deployment, or hosting suspension clears all in-memory gardens. Reconnecting players then get a helpful room-not-found message and can create a new garden.
- The free instance can take time to wake; allow the page to load before retrying. See [Render free-instance behavior](https://render.com/docs/free).
- Do not scale to multiple instances without adding shared state and a Socket.IO adapter; clients could otherwise land in different processes.
- HTTPS enables clipboard invitations. Plain HTTP falls back to displaying the room code.
- Socket.IO handles keepalives and automatic reconnects. Shutdown signals close connections cleanly before the server exits.
- This is a classroom prototype with room-code access, not a persistent account system.
