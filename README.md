# Forge TD v0.2 — online versus tower defense (1v1 / 2v2)

A top-down, browser-based **versus tower defense** game. Two teams (Left vs Right), 1–2 players each.
Teammates share one maze and defend together; you spend gold to **send creeps** at the other team,
which also raises your income. First team whose base drops to 0 lives loses.

The server is authoritative (Node.js, 20 ticks/sec, WebSockets via `ws`); the client is a plain HTML5 canvas page.

## Run it

Requires Node.js 18+.

```bash
cd forge-td
npm install        # only needed if node_modules is missing
npm start          # serves http://localhost:8080  (set PORT=xxxx to change)
```

Open http://localhost:8080, enter a name, **Create room**, then share the invite link.

### Letting friends join from their own computers

Players on the same Wi-Fi/LAN can open `http://YOUR-LAN-IP:8080`.
For friends over the internet, expose the port with a free tunnel, for example
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/):

```bash
cloudflared tunnel --url http://localhost:8080
```

It prints a `https://something.trycloudflare.com` URL. Send that (or the in-game invite link, which
includes `?room=CODE`) to your friends. WebSockets work through it automatically (`wss://`).
The quick-tunnel URL changes each time cloudflared restarts.

## How to play

1. Enter a name and **Create room** (you are the host 👑) or **Join** with a 4-letter code / invite link.
2. Pick **Left** or **Right** (max 2 per team; teams must be even: 1v1 or 2v2). Everyone except the host clicks **Ready**; the host clicks **Start**.
3. Each team has its own 11×20 board. Creeps enter at the 🌀 portal (top) and walk to your 🏰 base (bottom).
   Every creep that reaches your base costs lives (base starts at **20**).
4. **Build towers** on your side to kill creeps and **maze** them: creeps always take the shortest route
   (BFS), so walls of towers make them walk further. You may not fully block the path.
5. **Send creeps** to the enemy team. Each send costs gold and permanently raises your income
   (with diminishing returns), up to **6 sends per player per wave**.
6. Every **10 s** every player gets their income. Every **30 s** (first at 20 s) a neutral wave hits both
   sides; wave HP grows ×1.17 per wave (×1.5 in 2v2), and every 5th wave has a boss (×9 HP, costs 3 lives).
7. **Sudden death** starts at wave 24 (about 12 minutes in): waves get an extra ×1.45 HP per wave and every
   leak costs double, so matches end in roughly 10–15 minutes. If both bases fall on the same tick, the team
   that lost fewer lives in total (overkill counts) wins, then the team with more kills; otherwise it's a draw.
8. Killing a creep gives the tower's owner bounty gold. Each player has their own gold; you can only
   upgrade/sell your own towers, but teammates' cursors and towers show up live.

### Controls

| Action | Input |
|---|---|
| Select tower type to build | `1` Arrow · `2` Cannon · `3` Frost (or click the buttons) |
| Build | Left-click an empty cell on your side (ghost turns red if invalid) |
| Select a tower | Left-click it (shows range + stats) |
| Upgrade / Sell selected tower | `U` / `X` twice (or the buttons; the first press asks to confirm) — sell refunds 70%. With creeps on your board the sale takes 3 s and the tower stops firing. |
| Send creeps | `Q` Runner · `W` Brute · `E` Swarm |
| Cancel | `Esc` or right-click |
| Chat | `Enter` |

### Towers (3 levels each)

| Tower | Cost | Role |
|---|---|---|
| Arrow | 50 | Fast, single target |
| Cannon | 80 | Slow, splash damage |
| Frost | 60 | Low damage, slows every creep in a small area; slowed creeps take **+25% damage** from all towers |

Upgrade to level 2 costs 1× the base price, to level 3 costs 1.6×. Upgrades give only slightly more damage per gold
than new towers (new towers also lengthen your maze).

### Sends

| Send | Cost | Income | What it is |
|---|---|---|---|
| Runner (Q) | 35 | +2 | One fast creep with 1× a wave creep's HP |
| Brute (W) | 70 | +4 | One slow, very tanky creep (5.5× HP, leaks cost 2 lives) |
| Swarm (E) | 50 | +3 | Five small creeps (0.4× HP each) |

Sent creeps scale with the same HP curve as the neutral waves. Payback is about 165–175 s, and the income you gain
per send shrinks as your send income grows (`income × 150 / (150 + income already gained from sends)`).
The panel shows your sends this wave and how many sent creeps are queued on each side.
All numbers live in `public/shared.js` for easy tuning.

## Server limits

The server protects itself from abusive clients. Defaults can be changed with env vars:

| Limit | Default | Env var |
|---|---|---|
| Max WebSocket message size | 4096 bytes (bigger messages close the socket) | — |
| Messages per socket | 30/s, burst 60; over 100 dropped messages in 15 s disconnects | `MSG_RATE`, `MSG_BURST` |
| Chat per socket | 2/s, burst 4 | — |
| Connections total / per IP | 400 / 24 | `MAX_CONNECTIONS`, `MAX_CONN_PER_IP` |
| Rooms | 150 | `MAX_ROOMS` |
| Socket that never creates/joins a room | closed after 30 s | `JOIN_TIMEOUT_MS` |

If a game tick ever throws, the error is logged once and that room is reset to the lobby (other rooms keep running).

## Tests

```bash
npm run test:balance                          # in-process balance sim: full matches for 17 matchups x 5 seeds in ~20 s
# with a server running on port 8080:
npm test                                      # bots + maze + exploit checks
node test/bots.js ws://localhost:8080 4 60    # 4 bots (2v2) join, start, build, upgrade, sell, send for 60 s
node test/maze.js ws://localhost:8080         # path-blocking placements are rejected
node test/exploits.js ws://localhost:8080     # prototype-name lookups, huge payloads, message floods, chat spam, uneven teams, host drop
# lobby/host/rematch/limit checks need a fast test server with hooks enabled:
PORT=8723 SPEED=20 JOIN_TIMEOUT_MS=2000 MAX_ROOMS=6 FORGE_TEST_HOOKS=1 node server.js &
npm run test:lifecycle
```

For faster simulated games run the server with `SPEED=20 PORT=8090 node server.js` (20 sim steps per tick; testing only).
`FORGE_TEST_HOOKS=1` enables a debug message that deliberately breaks a room; never set it in production.

## Project layout

```
server.js          HTTP static server + WebSocket server (rooms, lobby, limits, snapshots)
game.js            Pure game simulation (waves, towers, sends, win/tiebreak), used by server.js and test/balance.js
public/shared.js   All tuning constants (economy, towers, sends, waves, sudden death) + BFS pathfinding, shared by server & client
public/client.js   Lobby UI, canvas renderer, input
public/index.html, public/style.css
test/              Headless tests: bots, maze, exploits, lifecycle, balance sim (test/lib.js = client helper)
CHANGELOG.md       Version history
```

## Known limitations (prototype)

- No accounts or persistence; rooms live in server memory (lost on restart).
- Refreshing the page rejoins your slot (a token is kept in localStorage); new players cannot join a game in progress.
- No sound, no spectators, no matchmaking. Balance was tuned with scripted bots, not human playtests.
