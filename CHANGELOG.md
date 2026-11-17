# Changelog

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
