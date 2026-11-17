# Changelog

## 0.3.0 — 2026-11-16

Fixes from the v0.2 QA re-review, a balance pass based on the reviewer's tested "V7" tuning, and unlimited sends.

### Gameplay / rules
- **Sell-juggling fixed:** a sale on a busy board (creeps on it, or a spawn due within 2 s) is queued and executes
  the moment the board is clear. The tower keeps firing until then; selling it again cancels. Removing a tower can
  no longer change the path under live creeps. The reviewer's `juggle.js` now gets 0 flips and identical
  leaks/time-on-board with and without juggling (it was 193 reversals and 0 leaks for 190 gold in v0.2).
- **Sends are unlimited** (the 6-per-player-per-wave cap is gone; gold is the only limit). To keep banked dumps from
  winning early, each enemy board has one send lane: a send occupies it for 0.9 s (Runner), 2.25 s (Swarm) or 3 s (Brute),
  so a big dump trickles in.
- Sudden death from wave 22 with ×1.25 extra HP per wave and normal leak cost (was wave 24, ×1.45, double leaks).
  When a base falls in sudden death, the current wave is played out (no new sends), then fewer total lives lost
  (overkill counts) wins, then more kills; a draw only if both are identical.

### Balance (all in `public/shared.js`)
- Team scaling = team size: 2v2 waves ×2 (was ×1.5), and sends are now scaled by team size too.
- Send HP ×wave HP: Runner 1.8, Swarm 0.75, Brute 9. Defender bounty: Runner 9, Swarm 3, Brute 18.
- Send income falloff 120 (was 150).
- New early-game send ramp: send HP ×0.26 at wave 1 rising to ×1 at wave 14 (bots showed 60% send rushes winning 2v2 in 3.4–3.7 min without it).

### Network / server
- Seat takeover (second tab): the old socket gets `err` code `replaced` and is closed with 4001 `replaced`; the
  client goes to the menu with a message and does not reconnect (no more ping-pong).
- Join errors carry code `joinfail` (game in progress, room full); the client treats any join failure like
  "room not found": stop retrying, back to the menu with the message.
- Per-IP cap uses the socket address unless `TRUST_PROXY` is set; then `CF-Connecting-IP` > `True-Client-IP` > last
  `X-Forwarded-For` hop. `render.yaml` sets `TRUST_PROXY=1`.
- State snapshots include a per-board `busy` flag (same rule the server uses for queued sales) and `fin` (final wave).

### Client
- Held keys no longer auto-repeat sends, upgrades or sells (`e.repeat` ignored).
- Permanent HUD banner: "sudden death soon" from wave 19, sudden death, and the final-wave tiebreak.
- Toast queue: toasts no longer overwrite each other; enemy sends coalesce into one "Incoming enemy sends: …" toast.
- Sale queued UI: 💲 marker on the tower, "Sale queued" panel with Cancel, and the sell hint follows the server's busy flag.
- Removed the sends-this-wave counter (no cap any more); queued-send counts and send feedback stay.
- Removed dead code in the build click handler.

### Tests
- New: `test/sim.js` (in-process rule checks), `test/v03.js` (takeover, join codes, proxy headers, queued sale over
  the wire), `test/matrix.js` (send-vs-defense matrix incl. "bank and dump" senders, lives lost before sudden death),
  `test/smoke.js` (headless-Chrome smoke test, needs puppeteer-core). `test/balance.js` bots gained a `burst` mode.

## 0.2.0 — 2026-11-16

Fixes from the v0.1 QA review, plus a balance pass.

### Security / stability
- Tower and send lookups use own-property checks (`hasTower` / `hasSend`), so names like `toString`,
  `constructor` or `__proto__` are rejected. Build/upgrade/sell coordinates must be integers.
- Every gold and income change goes through `addGold` / `addIncome`, which reject non-finite values;
  each tick also asserts that gold and income are finite.
- A tick exception is logged once (repeat logs are throttled) and that room is reset to the lobby with a
  message to its players; other rooms are unaffected.
- WebSocket `maxPayload` is 4096 bytes.
- Per-socket token bucket (30 msg/s, burst 60; chat 2/s, burst 4). Sockets that keep flooding are disconnected.
- Caps on total connections (400), connections per IP (24) and rooms (150); sockets that never join a room
  are closed after 30 s. All are configurable with env vars.

### Lobby / host
- Host moves to a connected player whenever the host leaves or drops, in any phase, and again on rejoin and lobby reset.
- Returning to the lobby removes disconnected players; the ready check ignores disconnected players.
- Uneven teams (e.g. 1v2) can't start.

### Balance (all constants now in `public/shared.js`)
- Neutral waves: HP ×1.17 per wave (was ×1.24), scaled ×(0.5 + 0.5 × team size); boss ×9 HP, costs 3 lives.
- Starting income 18 (was 10).
- Sudden death from wave 24: extra ×1.45 HP per wave and double leak cost, so matches end in about 10–15 minutes.
- Draws are broken by total lives lost (overkill counts), then kills.
- Sends: HP follows the neutral wave curve; payback is about 165–175 s (Runner 35g/+2, Swarm 50g/+3, Brute 70g/+4);
  income gains shrink as send income grows; limited to 6 sends per player per wave. Brute was retuned
  (5.5× wave HP, 2 lives) so it's competitive with Runner and Swarm in bot tests.
- Frost slows every creep in a small area, and slowed creeps take +25% damage from all towers.
- Cannon L1 splash 1.1 → 1.0 (L2/L3 slightly lower too); Arrow L2/L3 damage lowered so upgrading is not
  strictly better than building new towers.
- Selling with creeps on your board takes 3 s, and the tower stops firing meanwhile.

### Network
- Static tower data is only sent when it changes (plus a keyframe every 5 s, and a full state on join/rejoin).
- Enemy gold is no longer sent.

### Client
- Reconnects with exponential backoff (1–15 s, about 2 minutes total) and keeps the room code; "Room not found" returns to the menu.
- The roster DOM only updates when something visible changes.
- The build ghost turns red over creeps and when a placement would trap one.
- Feedback toast and button flash for your own sends, a sends-this-wave counter (x/6), and queued-send counts for both sides.
- Selling needs a second press to confirm; towers being sold are drawn faded.
- Frost area effect, sudden-death notice, and the tiebreak reason on the game-over screen.

### Tests
- New: `test/exploits.js`, `test/lifecycle.js`, `test/balance.js` (in-process full-match simulator), `test/lib.js`.

## 0.1.0

First playable version: 1v1/2v2 rooms, three towers, three sends, mazing.
