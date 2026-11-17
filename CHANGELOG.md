# Changelog

## 0.4.0 — 2026-11-16

New cartoon look, upgradable sends, and the v0.3 QA findings (proxy headers, lane limit, sale wait, T10 balance base).

### Graphics (all procedural, no image assets)
- New `public/art.js` draws every sprite in code with thick dark outlines and soft shadows. Sprites are cached per size
  at 3× supersampling.
  - The board is grass with a dirt trail along the current path (chevrons show the direction), a portal and a castle.
  - Tower pads are round bases in the owner's colour, with level stars.
  - **Arrow** is an archer whose hood colour, quiver and cape change with level. **Cannon** is a chunky cannon that
    gets bigger, with bands and a fuse. **Frost** is a snowman with a scarf, hat or crown and an ice wand.
    Archers and cannons turn to face their target and recoil when they fire.
  - Creeps are round, bouncy balloon blobs with faces. Neutral waves cycle through balloon colours; bosses have horns.
    Runner, Swarm and Brute each have their own colour and gear by tier: bronze, silver or gold rings, helmets,
    spikes and crowns.
- Effects come from a fixed pool of 900 particles, so there's no per-frame garbage:
  - pop stars and confetti on kills, plus a floating +gold for your own kills
  - arrow and ice-shard projectiles with trails, and cannonballs on an arc
  - muzzle flash, splash puffs and rings, frost rings (throttled per tower so busy boards stay readable)
  - white hit flashes, an ice overlay on slowed creeps, and a −♥ on leaks.
- Static board layers are drawn once to an offscreen canvas and redrawn only when towers change. The canvas is sharp on
  HiDPI screens. In the screenshot run (2v2, wave 17, 100 towers, about 180 creeps, about 600–800 live particles,
  headless Chrome) one frame took 2.3 ms on average and 12–13 ms at most.
- Readability is kept: animated dashed range circles, HP bars, path preview, a build ghost with a red ✕ when blocked,
  a 💲 coin on towers queued for sale, and the sudden-death banner.
- New UI: chunky 3D buttons and cream cards, a sky/hill background, an animated scene on the menu, a VS lobby, tower
  and send buttons with sprite icons, and the bundled **Fredoka** font (SIL OFL, `public/fonts/`, no CDN).

### Send upgrades
- Each player can buy tiers 1–3 for Runner, Brute and Swarm (`Shift+Q/W/E` or the ⬆ buttons). Tiers last the whole
  match. Tier 1 unlocks at wave 8, tier 2 at wave 12, tier 3 at wave 16.
- Upgrade price is ×2 / ×3.5 / ×5.5 the send's base price.
- Effects by tier:
  - HP ×1.2 / 1.5 / 1.85.
  - Send price and income ×1.1 / 1.2 / 1.3.
  - Defender bounty grows with HP.
  - Runner gets +20% / +35% speed. Brute gets armour (−40% / −50% Arrow damage), and tier 3 halves the slow.
    Swarm sends 6 / 7 creeps.
- Buying a tier also adds a little income (5% of the price, with the send falloff).
- The server checks everything: kind via own-property lookup, tier map without a prototype, stored tier clamped,
  unlock wave, finite cost, enough gold, max tier, and no upgrades during the final wave. Messages use the normal rate limits.
- Tiers are public. Both teams see them in the roster and in a new **Enemy send tiers** panel, and get toasts when
  anyone upgrades. Sent creeps carry their tier, so the enemy sees what is coming.

### QA findings from v0.3
- **Proxy headers:** `CF-Connecting-IP` and `True-Client-IP` are trusted only with `TRUST_CF=1`. With `TRUST_PROXY=1`
  alone, the per-IP key is the last `X-Forwarded-For` hop. `render.yaml` now sets `TRUST_CF=1`; existing Render
  services need it added in the dashboard.
- **Lane limit:** a send is refused with "Lane full" (no charge, and a toast tells you why) when the enemy lane is
  already booked more than 45 s ahead. This protects the server; there is still no per-wave cap.
- Sudden-death HP and leak multipliers apply when a sent creep **spawns**, not when it was sent.
- **Queued sales:** after 10 s a queued sale goes through as soon as no creep is within 3 cells of the tower. A steady
  trickle of sends can no longer lock towers in place. QA's `juggle.js`, re-run against v0.4, gets at most 3 flips per
  wave at 15g per flip, with no real gain in creep time on the board.
- The send tooltip reads the full-strength wave from the constants (wave 14) instead of saying "before wave 10".

### Balance (QA T10 base, then retuned with upgrader bots)
- Send HP ×wave HP: Runner 2.1, Swarm 0.9, Brute 10.5. Brute bounty is 24 (QA's fallback). In 1v1, brute20 beat
  runner20 at 6.3 min without it.
- 2v2 neutral waves ×2.0 at wave 1, easing to ×2.3 by wave 14.
- 2v2 send HP ×1.8 up to wave 6, rising to ×2.99 (2.3 × 1.3) by wave 16. With the full ×2.99 from the start, 2v2
  bank-and-dump bots beat two defenders at about 4.3 min in 11 matrix rows.
- `test/balance.js` and `test/matrix.js` have upgrader bots: U(f) spends the same share as E(f), split 65% sends and
  35% tiers. Results are in the 0.4.0 report.

### Tests
- `test/sim.js` covers:
  - lane limit, no charge on refusal, and the lane freeing up again
  - sudden-death multipliers applied at spawn
  - sale max wait, including the creep-nearby case
  - send-tier validation (prototype keys, unlock waves, gold, max tier, clamping) and per-tier specs
  - armour and slow resist.
- `test/exploits.js` sends junk and prototype-name `sendup` kinds.
- `test/v03.js` has modes for `trustproxy` (forged CF headers are ignored) and `trustcf`.
- `test/smoke.js` checks locked upgrade buttons, the Shift+Q refusal reason and the enemy tiers panel. With
  `FORGE_TEST_HOOKS=1` it also buys a real tier and checks that the enemy sees it and that a T1 Runner spawns.
- New `test/shots.js` takes screenshots plus frame-time stats.
- New test-only hooks `debug_gold` and `debug_wave`, which work only with `FORGE_TEST_HOOKS=1`.

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
