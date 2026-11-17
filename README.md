# Forge TD v0.5 — online versus tower defense (1v1 / 2v2)

A top-down, browser-based **versus tower defense** game. Two teams (Left vs Right), 1–2 players each.
Teammates share one maze and defend together; you spend gold to **send creeps** at the other team,
which also raises your income. First team whose base drops to 0 lives loses.

The server is authoritative (Node.js, 20 ticks/sec, WebSockets via `ws`); the client is a plain HTML5 canvas page.
All art is drawn procedurally in code (`public/art.js`): bright cartoon towers and balloon-like creeps, with no image
assets. The UI font (Fredoka, SIL Open Font License) is bundled in `public/fonts/`, so nothing loads from a CDN.

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
   (with diminishing returns). There is **no per-wave limit**: gold is the only limit. Sends enter the enemy
   board through one lane, so a big dump arrives as a steady stream rather than all at once.
   You can also **upgrade your sends** (tiers 1–3, see below): upgrades last the whole match and both teams can see them.
6. Every **10 s** every player gets their income. Every **30 s** (first at 20 s) a neutral wave hits both
   sides; wave HP grows ×1.17 per wave (2v2: ×2.0 at wave 1 easing up to ×2.3 by wave 14), and every 5th wave has a boss (×9 HP, costs 3 lives).
7. **Sudden death** starts at wave 22 (about 11 minutes in; a red banner shows it): every wave gets an extra
   ×1.25 HP on top of the last, so matches end in roughly 12–15 minutes. If a base falls during sudden death the
   game doesn't stop at once: the current wave is played out (no new sends), then the team that lost fewer lives
   in total (overkill counts) wins, then the team with more kills; a draw only if both are identical.
   Before sudden death a fallen base loses immediately (same-tick falls use the same tiebreak).
8. Killing a creep gives the tower's owner bounty gold. Each player has their own gold; you can only
   upgrade/sell your own towers, but teammates' cursors and towers show up live.

### Controls

| Action | Input |
|---|---|
| Select tower type to build | `1` Arrow · `2` Cannon · `3` Frost (or click the buttons) |
| Build | Left-click an empty cell on your side (ghost turns red if invalid) |
| Select a tower | Left-click it (shows range + stats) |
| Upgrade / Sell selected tower | `U` / `X` twice (or the buttons; the first press asks to confirm) — sell refunds 70%. While creeps are on your board (or a spawn is due within 2 s) the sale is **queued**: the tower keeps firing, shows a 💲, and is sold the moment your board is clear, or after 10 s if removing it changes no creep's route, or after 20 s no matter what (so a trickle of sends can't lock your towers in place). Press `X` on it again to cancel. Holding a key down does not auto-repeat sends, upgrades or sells. |
| Send creeps | `Q` Runner · `W` Brute · `E` Swarm |
| Upgrade a send type (next tier) | `Shift+Q` / `Shift+W` / `Shift+E`, or the ⬆ button under each send |
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

| Send | HP (× wave creep) | Defender's bounty | Lane time |
|---|---|---|---|
| Runner (Q) — 35g, +2 income, fast | 2.1× | 9g | 0.9 s |
| Brute (W) — 70g, +4 income, slow, very tanky | 10.5× | 24g | 3 s |
| Swarm (E) — 50g, +3 income, five small creeps | 0.9× each | 3g each | 2.25 s |

Sent creeps follow the neutral wave HP curve. In 2v2 they get ×1.5 HP up to wave 6, rising linearly to
×2.99 (= 2.3 team scale × 1.3 two-attacker bonus) at wave 16. On top of that an early-game ramp (×0.26 at wave 1 rising
to ×1 at wave 14) means a rush can't flatten a defense before it exists.
The income you gain per send shrinks as your send income grows (`income × 120 / (120 + income already gained from sends)`).
Sends are unlimited (there is no per-wave cap), but each enemy board has a single send lane: every send occupies it for
its lane time, so banked gold dumped at once trickles in. To protect the server, a send is refused with **"Lane full"**
when the lane is already booked more than **45 s** ahead (wait a moment and send again; you are not charged).
Each board in the state message carries `lane` (seconds its send lane is booked ahead) and `laneFull` (1 while sends to it are refused).
Sudden-death HP and leak multipliers are applied when a sent creep actually enters the board.
The panel shows how many sent creeps are queued on each side, and enemy sends show up as one combined
"Incoming enemy sends" toast.

### Send upgrades (v0.4)

Each player can upgrade each send type up to **tier 3** with gold (`Shift+Q/W/E` or the ⬆ buttons). Tiers last for the
whole match and apply to every later send of that type. Tier 1 unlocks at **wave 8**, tier 2 at **wave 12** and tier 3 at
**wave 16**. Your tiers show as badges in the player list, and the **Enemy send tiers** panel shows the other team's.
Higher tiers look different: a bronze, silver or gold ring, and extra gear (helmets, spikes, crowns).

| Tier | Unlocks | Upgrade price | HP | Send price / income | Defender's bounty | Extra trait |
|---|---|---|---|---|---|---|
| 1 | wave 8 | Runner 61 · Brute 123 · Swarm 88 | ×1.2 | ×1.1 | ×1.2 | — |
| 2 | wave 12 | Runner 105 · Brute 210 · Swarm 150 | ×1.5 | ×1.2 | ×1.5 | Runner +20% speed · Brute armor (−40% Arrow damage) · Swarm 6 per send |
| 3 | wave 16 | Runner 175 · Brute 350 · Swarm 250 | ×1.85 | ×1.3 | ×1.85 | Runner +35% speed · Brute −50% Arrow damage and half slow · Swarm still 6 per send |

Buying a tier also adds a little income (3% of its price, with the same falloff as sends). The bounty grows with the HP,
so defenders earn the same gold per HP killed. All numbers live in `public/shared.js` (`SEND_UP`, `SEND_TRAITS`) for easy tuning.

## Server limits

The server protects itself from abusive clients. Defaults can be changed with env vars:

| Limit | Default | Env var |
|---|---|---|
| Max WebSocket message size | 4096 bytes (bigger messages close the socket) | — |
| Messages per socket | 30/s, burst 60; over 100 dropped messages in 15 s disconnects | `MSG_RATE`, `MSG_BURST` |
| Chat per socket | 2/s, burst 4 | — |
| Connections total / per IP | 400 / 24 | `MAX_CONNECTIONS`, `MAX_CONN_PER_IP` |
| Trust the last `X-Forwarded-For` hop for the per-IP key | off: the socket address is used | `TRUST_PROXY=1` |
| Trust `CF-Connecting-IP` (Cloudflare) | off | `TRUST_CF=1` |
| Send lane booked ahead | 45 s ("Lane full") | — (`LANE_MAX_AHEAD` in shared.js) |
| Rooms | 150 | `MAX_ROOMS` |
| Socket that never creates/joins a room | closed after 30 s | `JOIN_TIMEOUT_MS` |

**Behind a proxy:** set `TRUST_PROXY=1`; the per-IP cap then keys on the *last* `X-Forwarded-For` hop (the one your
proxy appended). `CF-Connecting-IP` and `True-Client-IP` are **ignored** unless `TRUST_CF=1`, because any client can
send them and a plain reverse proxy passes them through.
**Render (behind Cloudflare):** set **both** `TRUST_PROXY=1` and `TRUST_CF=1` (both are in `render.yaml`; on an existing
service, add `TRUST_CF=1` in the dashboard). With `TRUST_CF=1` the key is `CF-Connecting-IP`, then
the last `X-Forwarded-For` hop. `True-Client-IP` is never trusted (Cloudflare only sets it on Enterprise plans). Only set `TRUST_CF=1` when every request really comes through Cloudflare. Don't set either
when the server is reachable directly, or the cap can be dodged.

If a game tick ever throws, the error is logged once and that room is reset to the lobby (other rooms keep running).

## Tests

```bash
npm run test:balance                          # in-process balance sim incl. send-tier upgrader bots, 5 seeds each, ~30 s
# with a server running on port 8080:
npm run test:sim                              # in-process rule checks: queued sales (max wait, route check, hard cap, trickle), send scaling/lane limit, send tiers, sudden death
node test/juggle.js                           # sell/rebuild juggling regression (v0.5)
node test/wirebytes.js                        # state message size v0.4 vs v0.5 encoding + decode round trip
node test/tune.js [variant]                   # balance variant sweep (QA's tune4 rows; ~1 min per variant)
npm run test:matrix                           # send-vs-defense matrix incl. 'bank and dump' senders and upgraders (~1 min)
npm test                                      # bots + maze + exploit + v0.3 checks (takeover, join errors, proxy headers, queued sale)
node test/bots.js ws://localhost:8080 4 60    # 4 bots (2v2) join, start, build, upgrade, sell, send for 60 s
node test/maze.js ws://localhost:8080         # path-blocking placements are rejected
node test/exploits.js ws://localhost:8080     # prototype-name lookups, huge payloads, message floods, chat spam, uneven teams, host drop
# lobby/host/rematch/limit checks need a fast test server with hooks enabled:
PORT=8723 SPEED=20 JOIN_TIMEOUT_MS=2000 MAX_ROOMS=6 FORGE_TEST_HOOKS=1 node server.js &
npm run test:lifecycle
# proxy-header mode:
PORT=8732 TRUST_PROXY=1 node server.js &  node test/v03.js ws://localhost:8732 trustproxy
PORT=8733 TRUST_CF=1 node server.js &     node test/v03.js ws://localhost:8733 trustcf
# headless-browser smoke test (needs puppeteer-core + Chrome; run first on a fresh server). With FORGE_TEST_HOOKS=1 it
# also buys a real send tier (jumps to wave 8 via a test hook); without hooks that part is skipped:
PORT=8742 FORGE_TEST_HOOKS=1 node server.js &  node test/smoke.js http://localhost:8742
# screenshots of the menu, lobby and a busy 2v2 at wave 17 with tiered sends + render-time stats:
PORT=8741 SPEED=12 FORGE_TEST_HOOKS=1 node server.js &  node test/shots.js http://localhost:8741 ./shots
```

For faster simulated games run the server with `SPEED=20 PORT=8090 node server.js` (20 sim steps per tick; testing only).
`FORGE_TEST_HOOKS=1` enables debug messages (break a room, add gold, jump the wave counter); never set it in production.

## Project layout

```
server.js          HTTP static server + WebSocket server (rooms, lobby, limits, snapshots)
game.js            Pure game simulation (waves, towers, sends, win/tiebreak), used by server.js and test/balance.js
wire.js            Compact state encoding (creeps, shots, lane info); decoded by SHARED.decodeState in public/shared.js
public/shared.js   All tuning constants (economy, towers, sends, waves, sudden death) + BFS pathfinding, shared by server & client
public/client.js   Lobby UI, canvas renderer (cached board layer, particle pool), input
public/art.js      Procedural cartoon sprites (towers, creeps, board, icons), cached per size
public/fonts/      Fredoka (SIL OFL 1.1, see OFL.txt)
public/index.html, public/style.css
test/              Headless tests: bots, maze, exploits, lifecycle, balance sim, smoke + screenshots (test/lib.js = client helper)
CHANGELOG.md       Version history
```

## Known limitations (prototype)

- No accounts or persistence; rooms live in server memory (lost on restart).
- Refreshing the page rejoins your slot (a token is kept in localStorage); new players cannot join a game in progress.
- Opening your seat in a second tab moves it there; the first tab returns to the menu with a message and doesn't reconnect.
  Any failed join (room gone, game in progress, room full) returns to the menu with the reason.
- No sound, no spectators, no matchmaking. Balance was tuned with scripted bots, not human playtests.
