# Forge TD architecture (v0.6)

No build step. The server runs plain Node.js (CommonJS). The browser loads plain `<script>` tags in the order
listed in `public/index.html`. Every tuning number lives in `public/shared.js`.

## Where things live

| File | Job | Owner |
|---|---|---|
| `server.js` | HTTP static files, WebSocket rooms/lobby, rate and connection limits, the 20 Hz tick, per-player snapshots | Forge (core) |
| `wire.js` | Compact state encoding: creeps as arrays, shots as a flat `sh` array, send-lane info | Forge (core) |
| `game.js` | Entry point only: `module.exports = require('./game/index.js')` | Forge (core) |
| `game/index.js` | `createGame`, `stepGame` (income, wave timer, the per-board order spawn → sales → move → fire → shards), win / sudden-death tiebreak | Forge (core) |
| `game/core.js` | Tick length, cell keys, `addGold`/`addIncome` safety, `newBoard`, `canBuild`, distance-field rebuild | Forge (core) |
| `game/waves.js` | Neutral waves (count, HP, fast/boss/Splitter waves), sudden death multipliers, creep spawning, Splitter shards | Forge (core) |
| `game/sends.js` | Buying sends, send income with falloff, per-player send tiers | Forge (core) |
| `game/towers.js` | Build / upgrade / sell (queued sales, route check, hard cap), targeting, firing (Smelter heat), damage, slow | Forge (core) |
| `game/creeps.js` | Creep movement along the BFS field and leaking into the base | Forge (core) |
| `public/shared.js` | **All tuning constants**, BFS pathfinding, send/tier math, `decodeState` for the wire format. Loaded by server and client | Forge (core) |
| `public/client.js` | Menu/lobby/HUD DOM, network messages, input, and the canvas renderer (board cache, creeps, towers, particles) | Forge (core) for net/HUD/input; Forge Art for drawing code |
| `public/client/layout.js` | Screen fit: scales the 760×660 logical canvas to the window, fullscreen (`F`, `#fsBtn`), CSS vars for Art | Forge (core) |
| `public/client/toast.js` | Toast queue (`FTD.toast`, `FTD.toastHas`) | Forge (core) |
| `public/client/audio-bridge.js` | Guarded calls into Forge Sound's `window.forgeAudio` + mute/volume UI (`FTD.aud`) | Forge (core); hook names agreed with Forge Sound |
| `public/art.js` | Procedural sprites (`window.ART`): towers, creeps, board, icons | Forge Art |
| `public/style.css`, `public/fonts/` | Look of every screen | Forge Art |
| `public/audio.js` | Procedural Web Audio (`window.forgeAudio`), music | Forge Sound |
| `test/` | Rule checks (`sim.js`, `juggle.js`), network checks, balance sims (`balance.js`, `tune06.js`, `matrix.js`), browser smoke test | Forge (core); QA's originals stay in `/workspace/forge-td-qa` |

## Rules for working in the shared tree

- Stage only your own files, by explicit path. Commit with `git -c user.name=Forge -c user.email=forge@users.noreply.github.com commit`.
- Only Forge Deploy pushes, and only an exact reviewed hash.
- Public hooks other files depend on stay stable: `window.SHARED`, `window.ART` (`tower`, `creep`, `creepR`, `rotates`, …),
  `window.forgeAudio.play(name, opts)`, `window.FTD` (`aud`, `toast`, `layout`), and the read-only test hooks `window.__ftd*`.
- New gameplay numbers go in `public/shared.js`, never inline in game code.

## When something breaks, look here first

| Symptom | Start in |
|---|---|
| Wrong wave size, HP, timing, sudden death | `public/shared.js` `WAVE`, then `game/waves.js` |
| Gold / income looks wrong | `game/core.js` `addGold`, `game/sends.js` `sendIncomeGain`, `INCOME_EVERY` |
| Tower not firing / wrong damage | `game/towers.js` `fireTowers` and `damage` |
| Creeps stuck or path wrong | `game/creeps.js`, `S.computeDist` / `S.nextCell` in `public/shared.js` |
| Sale doesn't happen | `game/towers.js` `processSales`, `saleChangesRoute` |
| Client shows wrong creeps / shots | `wire.js` (encode) and `S.decodeState` (decode); `node test/wirebytes.js` round-trips both |
| Clicks land on the wrong cell / board size wrong | `public/client/layout.js` and `cellFromEvent` / `setupCanvas` in `public/client.js` |
| Disconnects, rooms, limits | `server.js` |
| A tick throws | The server logs it once and resets that room. Reproduce in-process with `test/sim.js`-style code against `game.js` |

## Tests to run before a commit

`npm run test:sim` (rules), the network tests against a server on a spare port (`node test/bots.js ws://localhost:PORT 4 60`,
`maze.js`, `exploits.js`, `v03.js`, `lifecycle.js`), `node test/wirebytes.js`, the smoke test, and `node test/tune06.js 3`
for any balance change. Never use port 8080 for tests while a dev server is on it.

## Next split candidates

`public/client.js` (~850 lines) still holds net, HUD, input and rendering together because they share a lot of state.
The cleanest next cut is to move the canvas drawing (from `// ---------- rendering ----------` down) into
`public/client/render.js`. That code is mostly Forge Art's, so it should be done together with Art, in a quiet moment, as a pure move.
