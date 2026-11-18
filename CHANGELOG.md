# Changelog

## 0.6.0 — 2026-11-17

The user's v0.6 requests: the game fills the screen, waves come faster, sudden death comes later and hits harder, there is a
new tower and a new enemy, and the code is easier to work on. **Protocol change:** new creep kinds and a new tower type
(appended to `S.WIRE`), and the shot code now carries the tower count and a heat stage (see `wire.js`). Clients and server must match (one deploy).

- **Screen fit:** the board scales to fill the window next to the panel (aspect kept, minimal letterbox), with resize,
  fullscreen, zoom/DPR and panel/banner size changes handled (`public/client/layout.js`). The canvas renders at
  devicePixelRatio × scale (capped at 3), so it stays sharp. Clicks are mapped through the scale and the canvas border
  (the old mapping was off by the 4 px border). Press `F` (or any `#fsBtn`) for fullscreen.
- **Waves every 22 s** (was 30; first wave at 15 s, was 20). Per-wave numbers were re-based so the pressure per minute stays
  close to v0.5: creeps per wave `min(4 + floor(0.7n), 16)` (was `min(6 + n, 22)`), HP growth ×1.118 per wave (was 1.17),
  bounty `1 + floor(n/4)` (was n/3), fast every 4th wave (was 3rd), boss every 7th wave (was 5th). Send tiers unlock at waves
  11/16/22 (was 8/12/16), the send ramp is full at wave 19 (was 14), and the 2v2 scales reach full strength at waves 19/22
  (was 14/16). All of these happen at about the same minute as before.
- **Sudden death later and harder:** it starts at wave 36, about 13.1 min (was wave 22, about 10.8 min). Every sudden-death
  wave is fast, gets ×1.38 HP per wave (was ×1.25), and leaks cost 2 lives (was 1). Stalled games end about 2.2 min after it starts.
- **New tower: Smelter** (`4`, 90g). A heat beam that locks onto one creep: 6/12/22 damage every 0.25 s, ramping to ×3/×3.5/×4
  after 2 s on the same target, and reset on a switch. It is an anti-tank pick (Brutes, bosses) and weak against groups.
- **New enemy: Slag Splitter** (`R`, 60g, +3.4 income, 2.8× HP). It bursts into 3 fast Shards (22% HP each, 4 at tier 3) when
  killed. It is a splash check that punishes single-target and ramping towers. Neutral waves 8, 13, 18, 23, 33 and 38 end with Splitters.
  New event `{k:'split', b, x, y, n, v}`.
- **2v2 send income ×0.60** (was 0.70). With the later sudden death, heavy 2v2 upgrading senders had more time to snowball
  (U swarm60 and U splitter60 beat pure defense 6/6). 1v1 is unaffected.
- **Code organization:** `game.js` is now an entry point over `game/` (core, waves, sends, towers, creeps, index; that split
  commit changed no rules, and the sims were identical). From `client.js`, the audio bridge and the toast queue moved to
  `public/client/`, next to the new `layout.js`. New `ARCHITECTURE.md` maps each file to its job and owner, with a "where to
  look when X breaks" table. Placeholder drawing for the new units is marked `v0.6 PLACEHOLDER` for Forge Art.
- **QA fixes (review of 15338a1):**
  - Killing a Splitter next to the base cost more lives than letting it leak, because every Shard carried the parent's full
    leak. The leak is now split across the Shards (the shares add up to the parent's leak, whole lives first), and a creep
    with leak 0 that reaches the base is removed silently. New sim test: a Splitter killed 0–1 cells before the base costs
    exactly what a leak costs, at tiers 0 and 3, in and out of sudden death.
  - Tower cooldowns no longer drop the leftover time of a tick (`cd += rate`, reset to 0 while there is no target). The Smelter
    fired every 0.30 s instead of 0.25 s and Arrow L1 every 0.55 s instead of 0.5 s; every tower now fires at its listed rate (new sim test).
  - NaN guards: `heatMult` clamps bad heat to 0, `damage()` ignores non-finite damage, the decoded shot heat stage is clamped
    to 0–3, and the stored Smelter heat is capped at its ramp time.
  - Balance: sudden death at wave 36 (was 39, so balanced games end around 15 min instead of 16), Runner HP 1.9× (was 2.1×).
  - The `F` fullscreen key also ignores SELECT and TEXTAREA focus.
- **Results** (`node test/tune06.js 4` after the QA fixes: wins for the first-listed team out of 8, both seatings):
  - Balanced games end at 15.3–15.6 min in 1v1 and 14.5–14.9 min in 2v2. Every D/E20/E40 row reaches sudden death and ends within 3 min of it.
  - There are 0 sender wins under 8 min against a pure defender (`matrix.js 3` and `balance.js 3`: 0 sender wins under 8 min).
  - The only early sender win in the sweep is a sender-vs-sender row where the other side collapsed to neutral waves.
  - 40% senders stay viable: E40 vs D 8/8 (1v1 and 2v2), U40 vs D 6/8 (1v1) and 7/8 (2v2), runner40/brute40/swarm40/splitter40 vs D 8/8.
  - The faster towers did not make the Smelter dominant: Smelter-only loses 0/8 in 1v1 and 2v2, Smelter-heavy vs D is 0/8 (1v1)
    and 3/8 (2v2), and Smelter-heavy E40 vs E40 is 3/8. One Smelter per five towers is an upgrade, not a must: E40+Smelter vs E40
    is 8/8 and 2v2 D+Smelter vs D is 8/8, but 1v1 D+Smelter vs D is 1/8 (4 lost, 3 draws). All of these end at sudden death.
  - The Splitter is not dominant: splitter40 vs E40 is 0/8 (1v1 and 2v2), and 2v2 U splitter60 vs D is 1/8.
  - 2v2 U runner60 vs pure defense still wins 8/8, but only at 14.2–14.9 min (after sudden death starts). Against E20 players it is 2/8.
- **Tests:** new `test/tune06.js` (every row in both seatings). `test/sim.js` gains wave timer, sudden death, Splitter, Smelter,
  Shard leak, fire rate, NaN guard and wire checks, and its wave numbers are now read from shared.js. The smoke test checks that the board fits 1600×1000 and
  900×600 windows and that clicks still land on the right cell. The exploit test reads the send kinds from shared.js.
  The server's `debug_wave` test hook now allows waves up to 79.

## 0.5.2 — 2026-11-17

2v2 economy follow-up from the v0.5.1 QA review. No protocol changes. The client also ships the Forge Sound and Forge Art follow-ups listed below.

- **2v2 send income ×0.70** (`SEND_TEAM2_INCOME`, was 0.75).
- **Send-tier income is scaled the same way in 2v2** (`SEND_TEAM2_UPINCOME`). In v0.5.1, buying a tier still paid
  unscaled income (`cost × INCOME_PER_GOLD`) in 2v2. The multiplier is 1 in 1v1.
- **1v1 is unchanged:** all 62 1v1 rows in `test/matrix.js` and all 22 in `test/balance.js` are byte-identical to v0.5.1.
- **Results:** `node test/tune51.js V52 5 mirror`, wins out of 10 across both seatings, which cancels the harness's
  Left-acts-first bias.
  - 2v2 U runner60 vs D+Da / Dx2 / U20x2 / E20x2: 2 / 2 / 8 / 2 (v0.5.1: 10 / 10 / 10 / 4).
  - U swarm60 and U mix40 lose everywhere. E40 vs E20 is 4/10 and U20 vs E20 is 2/10.
  - 2v2 E40 and E20 senders still beat pure defense 10/10 at 12.8–14.3 min. 2v2 D vs D is 5/10.
  - `test/matrix.js` shows 0 sender wins under 8 min.
- `test/tune51.js` gains a `mirror` mode and the `V52` variant. New `test/sim.js` checks cover send-tier income in
  1v1 vs 2v2.
- **Audio (Forge Sound, f0f2e61 and later):** an adaptive cheap mode driven by frame time, a per-frame sound cap, noise buffers built once at unlock, and a page's own `window.audio` is no longer overwritten.
- **Art (Forge Art, 619d1ce, c5fa6ef, ad34ae9):** tighter creep sprites, a cheap ice ring in low-detail mode, the OffscreenCanvas size guard, 2v2 income and bounty in the send buttons and tooltips, low-detail on at 80 creeps (off at 55), mute and volume inside the panel, a bigger lane-full badge, and less CSS overdraw (FPS back at v0.4 levels).

## 0.5.1 — 2026-11-16

Core balance from the v0.5 QA review (QA fix A+B for 2v2 heavy senders). No protocol changes. The deployed build also includes Forge Sound's audio hooks and fixes and Forge Art's forge-theme art.

- **2v2 send income ×0.75** (`SEND_TEAM2_INCOME`): heavy 2v2 senders reached about 100 income against 18 and won late
  on economy alone.
- **2v2 send bounty scales with the send's 2v2 HP multiplier** (`SEND_TEAM2_BOUNTY`, ×1.5 early rising to ×2.99 at
  wave 16): defenders were earning about a third of the gold per HP that they earn in 1v1.
- 1v1 is unchanged: every 1v1 row in `test/tune51.js` gives identical results before and after.
- Results (5 seeds, `node test/tune51.js`):
  - 2v2 "U swarm60" now loses everywhere: 0/5 vs D+Da, vs Dx2 and vs E20x2, from either side (was 5/5 vs D).
  - 2v2 "U runner60" still beats pure defense 5/5 (12.3–13.3 min, was 10.7–11.8) and U20x2 5/5, but now loses 3/5
    to E20x2. 2v2 E40 vs E20 evens out to 2/3 (was 5/0).
  - No sender win under 8 min in `test/matrix.js`. 2v2 E40 still beats pure defense at 12.8–14.8 min.
  - The eco bot that spends 20% on tiers still never beats defense.
- **Tested, not adopted:** T3 Runner speed ×1.35 → ×1.2. U runner60 still beats pure D and U20x2 5/5; games are
  only about 0.5 min longer.
- `test/v03.js`: the queued-sale check is now a 20 s hard-cap test. It sells a tower on the route while the board is
  busy (with `FORGE_TEST_HOOKS=1` the enemy floods brutes to keep it busy) and expects the sale at `SELL_HARD_CAP`.
- New `test/tune51.js` (QA's tune5c rows plus side-swapped, eco, burst and 1v1 checks). New `test/sim.js` checks
  cover the 1v1 vs 2v2 send income and bounty.

## 0.5.0 — 2026-11-16

Core fixes from the v0.4 QA review: trickle-proof tower sales, upgrade economy, a leaner wire format, and small server fixes.

### Gameplay
- **Queued sales can't be locked by trickle sends.** The old fallback (sell after 10 s once no creep is within 3 cells)
  almost never fired for maze towers. Now a queued sale on a busy board executes:
  - as soon as the board is clear (unchanged);
  - after `SELL_MAX_WAIT` (10 s) if removing the tower changes no creep's route (every creep's route and the spawn route
    are walked cell by cell with and without the tower);
  - after `SELL_HARD_CAP` (20 s) no matter what.
  QA's trickle case (one runner per second forever) now sells a tower beside the path after 10 s (was > 115 s).
  Sell/rebuild juggling on a two-gap wall drops from 2–4 flips per wave to 1–2, and gains nothing measurable
  (wave 10: leaks 6 → 5 with juggling, was 6 → 3). Regression tests: `test/sim.js`, `test/juggle.js`.
- **Balance (QA's V7, with T1 at 1.75):** send-tier income `INCOME_PER_GOLD` 0.05 → 0.03; tier prices `UP_COST`
  [2, 3.5, 5.5] → [1.75, 3, 5] (QA proposed 1.5 for T1, but that let 1v1 heavy upgraders win at 5.8 min in the matrix);
  Swarm T3 is 6 per send (was 7); 2v2 early send multiplier `SEND_TEAM2.START` 1.8 → 1.5; Brute leaks cost 1 life (was 2).
  - A bot that never sends and puts 20% into tiers no longer beats pure defense (1v1 0/5, five draws; 2v2 0/5, was 5/5 in both).
  - No sender win under 8 min anywhere in `test/matrix.js` (5 seeds; v0.4 had 3, the 2v2 Brute bank-and-dump).
  - 40% senders still beat pure defense at 12.3–13.8 min. Balanced games run 13.3–14.8 min.
  - Swarm T3 HP 1.85 → 1.6 (QA's next lever) was tested and **not adopted**: 2v2 "U swarm60" still wins 5/5 even at
    1.2, so those wins come from send volume, not T3 HP. `SEND_TRAITS[kind].hp` now allows per-kind tier HP if needed.

### Network and server
- **Compact state messages** (decoded by `SHARED.decodeState`, so the client and tests see the old shapes):
  - creeps: `[id, kindIndex, x*10, y*10, hp, maxHp, slowed, v]` (positions to 0.1 cell; radius comes from the kind);
  - shots move out of `ev` into a flat `sh` array of 5 numbers per shot.
  At about 113 creeps a message goes from 6.65 KB to 4.58 KB (−31%), and from 11.8 to 8.0 KB at about 230 creeps.
- Each board in the state carries `lane` (seconds its send lane is booked ahead) and `laneFull` (1 while sends to it are
  refused), so the client can show a lane-full state on the send buttons.
- `TRUST_CF=1` trusts only `CF-Connecting-IP`; `True-Client-IP` is ignored (Cloudflare only sets it on Enterprise plans).
- Static files: `.ttf` is served as `font/ttf` (plus `font/otf`, `font/woff`, `font/woff2`, `.txt`, `.json`, `.jpg`, `.webp`).

### Client (logic only; visuals are Forge Art's)
- The particle pool uses a free list: spawning is O(1), and a full pool no longer scans 900 slots per effect.
- Error toasts (e.g. "Lane full") jump ahead of queued info toasts such as "Sent …" and cut a showing info toast short.
  "Lane full" collapses into a single toast.

### Tests and tools
- New: `test/juggle.js`, `test/wirebytes.js` (bytes per message before/after plus a decode round trip), `test/tune.js`
  (QA's tune4 sweep). `test/balance.js` gains QA's eco/free/upE bots and an `onTick` hook. Tests read tuning values
  from `shared.js` instead of hard-coding them.

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
