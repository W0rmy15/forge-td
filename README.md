# Forge TD — online versus tower defense (1v1 / 2v2)

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
2. Pick **Left** or **Right** (max 2 per team). Everyone except the host clicks **Ready**; the host clicks **Start**.
3. Each team has its own 11×20 board. Creeps enter at the 🌀 portal (top) and walk to your 🏰 base (bottom).
   Every creep that reaches your base costs lives (base starts at **20**).
4. **Build towers** on your side to kill creeps and **maze** them: creeps always take the shortest route
   (BFS), so walls of towers make them walk further. You may not fully block the path.
5. **Send creeps** to the enemy team. Each send costs gold and permanently raises your income.
6. Every **10 s** every player gets their income. Every **30 s** (first at 20 s) a neutral wave hits both
   sides; waves get stronger, and every 5th wave has a boss.
7. Killing a creep gives the tower's owner bounty gold. Each player has their own gold; you can only
   upgrade/sell your own towers, but teammates' cursors and towers show up live.

### Controls

| Action | Input |
|---|---|
| Select tower type to build | `1` Arrow · `2` Cannon · `3` Frost (or click the buttons) |
| Build | Left-click an empty cell on your side (ghost turns red if invalid) |
| Select a tower | Left-click it (shows range + stats) |
| Upgrade / Sell selected tower | `U` / `X` (or the buttons) — sell refunds 70% |
| Send creeps | `Q` Runner · `W` Brute · `E` Swarm |
| Cancel | `Esc` or right-click |
| Chat | `Enter` |

### Towers (3 levels each)

| Tower | Cost | Role |
|---|---|---|
| Arrow | 50 | Fast, single target |
| Cannon | 80 | Slow, splash damage |
| Frost | 60 | Low damage, slows creeps |

Upgrade to level 2 costs 1× the base price, to level 3 costs 1.6×.

### Sends

| Send | Cost | Income | What it is |
|---|---|---|---|
| Runner (Q) | 20 | +2 | One fast, fragile creep |
| Brute (W) | 45 | +4 | One slow, very tanky creep (leaks cost 2 lives) |
| Swarm (E) | 30 | +3 | Five small creeps |

Sent creeps get stronger as the waves progress. All numbers live in `public/shared.js` for easy tuning.

## Tests

With a server running on port 8080:

```bash
npm test
# or individually:
node test/bots.js ws://localhost:8080 4 60   # 4 bots (2v2) join, start, build, upgrade, sell, send for 60 s
node test/maze.js ws://localhost:8080        # verifies path-blocking placements are rejected
```

For faster simulated games run the server with `SPEED=8 PORT=8090 node server.js` (8 sim steps per tick; testing only).

## Project layout

```
server.js          HTTP static server + WebSocket game server (rooms, lobby, simulation)
public/shared.js   Game constants (towers, sends, waves) + BFS pathfinding, shared by server & client
public/client.js   Lobby UI, canvas renderer, input
public/index.html, public/style.css
test/              Headless bot tests
```

## Known limitations (prototype)

- No accounts or persistence; rooms live in server memory (lost on restart).
- Refreshing the page rejoins your slot (a token is kept in localStorage); new players cannot join a game in progress.
- No sound, no spectators, no matchmaking; balance is first-pass.
