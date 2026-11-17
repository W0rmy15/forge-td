// Forge TD - server-authoritative versus tower defense
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const S = require('./public/shared.js');

const PORT = parseInt(process.env.PORT || '8080', 10);
const TICK = 50; // ms (20 Hz)
const DT = TICK / 1000;
const SPEED = Math.max(1, parseInt(process.env.SPEED || '1', 10)); // sim steps per tick (testing only)
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime() }));
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const fp = path.normalize(path.join(PUB, p));
  if (!fp.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
let nextId = 1;
const PLAYER_COLORS = ['#4fa3ff', '#ffd166', '#ff6b6b', '#7bed9f', '#c58bff', '#ff9f43'];

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function cleanName(n) { return String(n || '').replace(/[^\w \-.!?']/g, '').trim().slice(0, 16) || 'Player'; }
function teamCount(room, team) { let n = 0; for (const p of room.players.values()) if (p.team === team) n++; return n; }
const other = (t) => (t === 'L' ? 'R' : 'L');

function lobbyMsg(room) {
  return {
    t: 'lobby', code: room.code, hostId: room.hostId, phase: room.phase,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, ready: p.ready, connected: p.connected, color: p.color })),
  };
}
function broadcast(room, msg) { const s = JSON.stringify(msg); for (const p of room.players.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(s); }
function broadcastLobby(room) { broadcast(room, lobbyMsg(room)); }

function addPlayer(room, ws, name, token) {
  const id = nextId++;
  const team = teamCount(room, 'L') <= teamCount(room, 'R') ? 'L' : 'R';
  const usedColors = new Set([...room.players.values()].map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !usedColors.has(c)) || PLAYER_COLORS[0];
  const p = { id, token: token || crypto.randomBytes(12).toString('hex'), name, team, ready: false, ws, connected: true, color, gold: 0, income: 0, cursor: null, sent: 0, kills: 0 };
  room.players.set(id, p);
  if (!room.hostId) room.hostId = id;
  return p;
}

// ---------------- game simulation ----------------
function newBoard() { return { lives: S.LIVES, towers: new Map(), creeps: [], queue: [], dist: S.computeDist(() => false), leakFlash: 0 }; }
function startGame(room) {
  room.phase = 'game';
  room.game = { time: 0, boards: { L: newBoard(), R: newBoard() }, nextIncome: S.INCOME_EVERY, nextWave: S.FIRST_WAVE, wave: 0, events: [], winner: null, nextCreepId: 1, nextTowerId: 1 };
  for (const p of room.players.values()) { p.gold = S.START_GOLD; p.income = S.START_INCOME; p.sent = 0; p.kills = 0; p.ready = false; }
  log(`room ${room.code} started with ${room.players.size} players`);
}
const key = (c, r) => c + ',' + r;

function recomputeDist(b) { b.dist = S.computeDist((c, r) => b.towers.has(key(c, r))); }

function canBuild(b, c, r) {
  if (!Number.isInteger(c) || !Number.isInteger(r) || c < 0 || r < 0 || c >= S.COLS || r >= S.ROWS) return 'Out of bounds';
  if ((c === S.SPAWN.c && r === S.SPAWN.r) || (c === S.BASE.c && r === S.BASE.r)) return 'Cannot build on spawn/base';
  if (b.towers.has(key(c, r))) return 'Occupied';
  for (const cr of b.creeps) {
    if ((cr.c === c && cr.r === r) || (cr.nc === c && cr.nr === r)) return 'A creep is in the way';
  }
  const d = S.computeDist((cc, rr) => (cc === c && rr === r) || b.towers.has(key(cc, rr)));
  if (d[S.SPAWN.c + S.SPAWN.r * S.COLS] < 0) return 'That would block the path!';
  for (const cr of b.creeps) if (d[cr.c + cr.r * S.COLS] < 0) return 'That would trap a creep';
  return null;
}

function spawnCreep(g, b, spec) {
  b.creeps.push({
    id: g.nextCreepId++, kind: spec.kind, hp: spec.hp, maxHp: spec.hp, speed: spec.speed, bounty: spec.bounty, leak: spec.leak, radius: spec.radius,
    c: S.SPAWN.c, r: S.SPAWN.r, nc: null, nr: null, x: S.SPAWN.c + 0.5, y: S.SPAWN.r + 0.5, slowUntil: 0, slowAmt: 0, from: spec.from || null,
  });
}

function queueWave(g) {
  g.wave++;
  const n = g.wave;
  const boss = n % 5 === 0;
  const hp = Math.round(25 * Math.pow(1.24, n - 1));
  for (const t of ['L', 'R']) {
    const b = g.boards[t];
    const count = Math.min(6 + n, 22);
    for (let i = 0; i < count; i++) b.queue.push({ at: g.time + i * 0.6, kind: 'neutral', hp, speed: n % 3 === 0 ? 1.7 : 1.25, bounty: 1 + Math.floor(n / 3), leak: 1, radius: 0.24 });
    if (boss) b.queue.push({ at: g.time + count * 0.6 + 0.5, kind: 'boss', hp: hp * 14, speed: 0.8, bounty: 10 + n * 2, leak: 4, radius: 0.42 });
  }
  g.events.push({ k: 'wave', n, boss });
}

function doSend(room, p, kind) {
  const g = room.game, spec = S.SENDS[kind];
  if (!spec) return 'Unknown send';
  if (p.gold < spec.cost) return 'Not enough gold';
  p.gold -= spec.cost; p.income += spec.income; p.sent++;
  const b = g.boards[other(p.team)];
  const hpMult = 1 + 0.12 * g.wave;
  const last = b.queue.reduce((m, q) => Math.max(m, q.at), g.time);
  const start = Math.max(g.time, Math.min(last, g.time + 3)); // don't wait too long behind waves
  for (let i = 0; i < spec.count; i++) {
    b.queue.push({ at: start + i * 0.25, kind, hp: Math.round(spec.hp * hpMult), speed: spec.speed, bounty: spec.bounty, leak: spec.leak, radius: spec.radius, from: p.id });
  }
  g.events.push({ k: 'send', team: p.team, kind, name: p.name });
  return null;
}

function stepBoard(room, team) {
  const g = room.game, b = g.boards[team];
  // spawn queue
  if (b.queue.length) {
    b.queue.sort((a, c) => a.at - c.at);
    while (b.queue.length && b.queue[0].at <= g.time) spawnCreep(g, b, b.queue.shift());
  }
  // move creeps
  const survivors = [];
  for (const cr of b.creeps) {
    let speed = cr.speed * (g.time < cr.slowUntil ? 1 - cr.slowAmt : 1);
    let step = speed * DT;
    let leaked = false;
    while (step > 0) {
      if (cr.c === S.BASE.c && cr.r === S.BASE.r) { leaked = true; break; }
      if (cr.nc === null) {
        const n = S.nextCell(b.dist, cr.c, cr.r);
        if (!n) break; // stuck (should not happen)
        cr.nc = n.c; cr.nr = n.r;
      }
      const tx = cr.nc + 0.5, ty = cr.nr + 0.5;
      const dx = tx - cr.x, dy = ty - cr.y, dd = Math.hypot(dx, dy);
      if (dd <= step) {
        cr.x = tx; cr.y = ty; step -= dd; cr.c = cr.nc; cr.r = cr.nr; cr.nc = null; cr.nr = null;
      } else { cr.x += (dx / dd) * step; cr.y += (dy / dd) * step; step = 0; }
    }
    if (leaked) {
      b.lives = Math.max(0, b.lives - cr.leak);
      b.leakFlash = 0.5;
      g.events.push({ k: 'leak', team, n: cr.leak });
    } else survivors.push(cr);
  }
  b.creeps = survivors;
  if (b.leakFlash > 0) b.leakFlash -= DT;
  // towers fire
  for (const t of b.towers.values()) {
    t.cd -= DT;
    if (t.cd > 0) continue;
    const st = S.TOWERS[t.type].levels[t.lvl];
    const tx = t.c + 0.5, ty = t.r + 0.5;
    let target = null, best = Infinity;
    for (const cr of b.creeps) {
      if (cr.hp <= 0) continue;
      if (Math.hypot(cr.x - tx, cr.y - ty) > st.range) continue;
      const prog = b.dist[cr.c + cr.r * S.COLS];
      const score = (prog < 0 ? 999 : prog) - (cr.hp / cr.maxHp) * 0.01;
      if (score < best) { best = score; target = cr; }
    }
    if (!target) continue;
    t.cd = st.rate;
    g.events.push({ k: 'shot', b: team, tt: t.type, x1: +tx.toFixed(2), y1: +ty.toFixed(2), x2: +target.x.toFixed(2), y2: +target.y.toFixed(2) });
    if (t.type === 'cannon') {
      for (const cr of b.creeps) if (cr.hp > 0 && Math.hypot(cr.x - target.x, cr.y - target.y) <= st.splash) damage(room, b, cr, st.dmg, t);
      g.events.push({ k: 'boom', b: team, x: +target.x.toFixed(2), y: +target.y.toFixed(2), r: st.splash });
    } else {
      if (t.type === 'frost') { const active = g.time < target.slowUntil; target.slowAmt = active ? Math.max(st.slow, target.slowAmt) : st.slow; target.slowUntil = Math.max(target.slowUntil, g.time + st.slowDur); }
      damage(room, b, target, st.dmg, t);
    }
  }
  b.creeps = b.creeps.filter((c) => c.hp > 0);
}

function damage(room, b, cr, dmg, tower) {
  if (cr.hp <= 0) return;
  cr.hp -= dmg;
  if (cr.hp <= 0) {
    const owner = room.players.get(tower.owner);
    if (owner) { owner.gold += cr.bounty; owner.kills++; }
    tower.kills = (tower.kills || 0) + 1;
  }
}

function stepGame(room) {
  const g = room.game;
  g.time += DT;
  g.nextIncome -= DT;
  if (g.nextIncome <= 0) {
    g.nextIncome += S.INCOME_EVERY;
    for (const p of room.players.values()) p.gold += p.income;
    g.events.push({ k: 'income' });
  }
  g.nextWave -= DT;
  if (g.nextWave <= 0) { g.nextWave += S.WAVE_EVERY; queueWave(g); }
  stepBoard(room, 'L');
  stepBoard(room, 'R');
  const lL = g.boards.L.lives, lR = g.boards.R.lives;
  if (lL <= 0 || lR <= 0) {
    g.winner = lL <= 0 && lR <= 0 ? 'draw' : lL <= 0 ? 'R' : 'L';
    room.phase = 'over';
    log(`room ${room.code} game over, winner ${g.winner}`);
    broadcastLobby(room);
  }
}

function stateMsg(room) {
  const g = room.game;
  const boards = {};
  for (const t of ['L', 'R']) {
    const b = g.boards[t];
    boards[t] = {
      lives: b.lives, leak: b.leakFlash > 0 ? 1 : 0,
      towers: [...b.towers.values()].map((tw) => [tw.id, tw.c, tw.r, tw.type, tw.lvl, tw.owner]),
      creeps: b.creeps.map((c) => [c.id, c.kind, +c.x.toFixed(2), +c.y.toFixed(2), Math.ceil(c.hp), c.maxHp, g.time < c.slowUntil ? 1 : 0, c.radius]),
      queued: b.queue.length,
    };
  }
  return {
    t: 's', phase: room.phase, time: +g.time.toFixed(2), wave: g.wave, nextIncome: +g.nextIncome.toFixed(1), nextWave: +g.nextWave.toFixed(1), winner: g.winner,
    boards, ev: g.events,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, gold: p.gold, income: p.income, color: p.color, cursor: p.cursor, connected: p.connected, sent: p.sent, kills: p.kills })),
  };
}

// ---------------- message handling ----------------
function handle(ws, msg) {
  const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
  const p = room ? room.players.get(ws.playerId) : null;
  switch (msg.t) {
    case 'create': {
      if (room) return;
      const code = makeCode();
      const r = { code, hostId: null, players: new Map(), phase: 'lobby', game: null, emptySince: null };
      rooms.set(code, r);
      const np = addPlayer(r, ws, cleanName(msg.name), null);
      ws.roomCode = code; ws.playerId = np.id;
      send(ws, { t: 'joined', code, you: np.id, token: np.token });
      broadcastLobby(r);
      log(`room ${code} created by ${np.name}`);
      return;
    }
    case 'join': {
      if (room) return;
      const code = String(msg.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) return send(ws, { t: 'err', msg: `Room ${code || '?'} not found` });
      // reconnect by token
      if (msg.token) {
        for (const ep of r.players.values()) {
          if (ep.token === msg.token) {
            if (ep.ws && ep.ws !== ws) try { ep.ws.close(); } catch (e) {}
            ep.ws = ws; ep.connected = true; if (msg.name) ep.name = cleanName(msg.name);
            ws.roomCode = code; ws.playerId = ep.id; r.emptySince = null;
            send(ws, { t: 'joined', code, you: ep.id, token: ep.token, rejoined: true });
            broadcastLobby(r);
            return;
          }
        }
      }
      if (r.phase !== 'lobby') return send(ws, { t: 'err', msg: 'Game already in progress' });
      if (r.players.size >= S.MAX_PER_TEAM * 2) return send(ws, { t: 'err', msg: 'Room is full' });
      const np = addPlayer(r, ws, cleanName(msg.name), null);
      ws.roomCode = code; ws.playerId = np.id; r.emptySince = null;
      send(ws, { t: 'joined', code, you: np.id, token: np.token });
      broadcastLobby(r);
      return;
    }
  }
  if (!room || !p) return;
  switch (msg.t) {
    case 'team':
      if (room.phase !== 'lobby' || (msg.team !== 'L' && msg.team !== 'R') || p.team === msg.team) return;
      if (teamCount(room, msg.team) >= S.MAX_PER_TEAM) return send(ws, { t: 'err', msg: 'Team is full' });
      p.team = msg.team; p.ready = false; broadcastLobby(room); return;
    case 'ready':
      if (room.phase !== 'lobby') return;
      p.ready = !!msg.ready; broadcastLobby(room); return;
    case 'start': {
      if (room.phase !== 'lobby') return;
      if (p.id !== room.hostId) return send(ws, { t: 'err', msg: 'Only the host can start' });
      if (!teamCount(room, 'L') || !teamCount(room, 'R')) return send(ws, { t: 'err', msg: 'Each team needs at least one player' });
      const notReady = [...room.players.values()].filter((x) => !x.ready && x.id !== room.hostId);
      if (notReady.length) return send(ws, { t: 'err', msg: 'Waiting for: ' + notReady.map((x) => x.name).join(', ') });
      startGame(room); broadcastLobby(room); return;
    }
    case 'lobby':
      if (room.phase !== 'over' || p.id !== room.hostId) return;
      room.phase = 'lobby'; room.game = null; for (const x of room.players.values()) x.ready = false;
      broadcastLobby(room); return;
    case 'cursor':
      if (msg.c === null || msg.c === undefined) p.cursor = null;
      else if (Number.isFinite(msg.c) && Number.isFinite(msg.r) && (msg.b === 'L' || msg.b === 'R')) p.cursor = { b: msg.b, c: +(+msg.c).toFixed(2), r: +(+msg.r).toFixed(2) };
      return;
    case 'chat': {
      const text = String(msg.text || '').slice(0, 120).trim();
      if (text) broadcast(room, { t: 'chat', name: p.name, color: p.color, text });
      return;
    }
  }
  if (room.phase !== 'game') return;
  const g = room.game, b = g.boards[p.team];
  switch (msg.t) {
    case 'build': {
      const spec = S.TOWERS[msg.type];
      if (!spec) return;
      const c = msg.c, r = msg.r;
      const err = canBuild(b, c, r);
      if (err) return send(ws, { t: 'err', msg: err });
      if (p.gold < spec.cost) return send(ws, { t: 'err', msg: 'Not enough gold' });
      p.gold -= spec.cost;
      b.towers.set(key(c, r), { id: g.nextTowerId++, c, r, type: msg.type, lvl: 0, owner: p.id, cd: 0 });
      recomputeDist(b);
      return;
    }
    case 'upgrade': {
      const t = b.towers.get(key(msg.c, msg.r));
      if (!t) return;
      if (t.owner !== p.id) return send(ws, { t: 'err', msg: "That's your teammate's tower" });
      const cost = S.upgradeCost(t.type, t.lvl);
      if (cost === null) return send(ws, { t: 'err', msg: 'Already max level' });
      if (p.gold < cost) return send(ws, { t: 'err', msg: 'Not enough gold' });
      p.gold -= cost; t.lvl++;
      return;
    }
    case 'sell': {
      const t = b.towers.get(key(msg.c, msg.r));
      if (!t) return;
      if (t.owner !== p.id) return send(ws, { t: 'err', msg: "That's your teammate's tower" });
      p.gold += Math.floor(S.towerSpent(t.type, t.lvl) * S.SELL_REFUND);
      b.towers.delete(key(t.c, t.r));
      recomputeDist(b);
      return;
    }
    case 'send': {
      const err = doSend(room, p, msg.kind);
      if (err) send(ws, { t: 'err', msg: err });
      return;
    }
  }
}

function leave(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const p = room.players.get(ws.playerId);
  if (!p || p.ws !== ws) return;
  if (room.phase === 'lobby') {
    room.players.delete(p.id);
    if (room.hostId === p.id) room.hostId = room.players.size ? room.players.keys().next().value : null;
  } else { p.connected = false; p.ws = null; p.cursor = null; }
  if (![...room.players.values()].some((x) => x.connected)) room.emptySince = Date.now();
  broadcastLobby(room);
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    try { handle(ws, msg); } catch (e) { log('ERROR handling message: ' + (e.stack || e)); }
  });
  ws.on('close', () => { try { leave(ws); } catch (e) { log('ERROR on close: ' + (e.stack || e)); } });
  ws.on('error', () => {});
});

// main loop
setInterval(() => {
  for (const room of rooms.values()) {
    try {
      if (room.phase === 'game') { for (let i = 0; i < SPEED && room.phase === 'game'; i++) stepGame(room); broadcast(room, stateMsg(room)); room.game.events = []; }
      else if (room.phase === 'over' && room.game && room.game.time !== room._lastOverSent) { broadcast(room, stateMsg(room)); room._lastOverSent = room.game.time; room.game.events = []; }
    } catch (e) { log('ERROR in tick for room ' + room.code + ': ' + (e.stack || e)); }
  }
}, TICK);

// housekeeping: heartbeat + empty room cleanup
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch (e) {} }
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.players.size || (room.emptySince && now - room.emptySince > 5 * 60 * 1000)) { rooms.delete(code); log(`room ${code} removed`); }
  }
}, 15000);

function log(s) { console.log(new Date().toISOString() + ' ' + s); }
process.on('uncaughtException', (e) => log('UNCAUGHT ' + (e.stack || e)));
server.listen(PORT, () => log(`Forge TD listening on http://localhost:${PORT}`));
