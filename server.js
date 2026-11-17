// Forge TD - server-authoritative versus tower defense (HTTP static files + WebSocket game server)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const S = require('./public/shared.js');
const G = require('./game.js');
const WIRE = require('./wire.js');

const PORT = parseInt(process.env.PORT || '8080', 10);
const SPEED = Math.min(50, Math.max(1, parseInt(process.env.SPEED || '1', 10))); // sim steps per tick (testing only)
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// ---- abuse limits (override with env vars) ----
const LIMITS = {
  MAX_PAYLOAD: 4096,                                               // bytes per WebSocket message
  MAX_CONNECTIONS: parseInt(process.env.MAX_CONNECTIONS || '400', 10),
  MAX_CONN_PER_IP: parseInt(process.env.MAX_CONN_PER_IP || '24', 10),
  MAX_ROOMS: parseInt(process.env.MAX_ROOMS || '150', 10),
  JOIN_TIMEOUT_MS: parseInt(process.env.JOIN_TIMEOUT_MS || '30000', 10),                                         // sockets that never create/join a room are closed
  MSG_RATE: parseInt(process.env.MSG_RATE || '30', 10), MSG_BURST: parseInt(process.env.MSG_BURST || '60', 10),                                    // token bucket: all messages
  CHAT_RATE: 2, CHAT_BURST: 4,                                     // token bucket: chat
  DROP_LIMIT: 100,                                                 // over-limit messages (per 15 s) before disconnect
};
const KEYFRAME_TICKS = 100; // resend static tower data at least every 5 s

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, version: S.VERSION, rooms: rooms.size, clients: wss.clients.size, uptime: process.uptime() }));
  }
  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  const fp = path.normalize(path.join(PUB, p));
  if (!fp.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: LIMITS.MAX_PAYLOAD });
const rooms = new Map();
const ipCounts = new Map();
let nextId = 1;
const PLAYER_COLORS = ['#4fa3ff', '#ffd166', '#ff6b6b', '#7bed9f', '#c58bff', '#ff9f43'];

// ---- logging with flood protection: the same message key is logged at most once per 30 s ----
function log(s) { console.log(new Date().toISOString() + ' ' + s); }
const logSeen = new Map();
function logOnce(k, s) {
  const now = Date.now(), last = logSeen.get(k);
  if (last && now - last.t < 30000) { last.n++; return; }
  const extra = last && last.n ? ` (repeated ${last.n}x since last report)` : '';
  logSeen.set(k, { t: now, n: 0 });
  log(s + extra);
}

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c));
  return c;
}
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }
function cleanName(n) { return String(typeof n === 'string' ? n : '').replace(/[^\w \-.!?']/g, '').trim().slice(0, 16) || 'Player'; }
function teamCount(room, team) { let n = 0; for (const p of room.players.values()) if (p.team === team) n++; return n; }

function lobbyMsg(room) {
  return {
    t: 'lobby', code: room.code, hostId: room.hostId, phase: room.phase,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, ready: p.ready, connected: p.connected, color: p.color })),
  };
}
function broadcast(room, msg) { const s = JSON.stringify(msg); for (const p of room.players.values()) send(p.ws, s); }
function broadcastLobby(room) { broadcast(room, lobbyMsg(room)); }

// host must always be a connected player when one exists
function ensureHost(room) {
  const h = room.players.get(room.hostId);
  if (h && h.connected) return;
  const c = [...room.players.values()].find((p) => p.connected);
  if (c) room.hostId = c.id;
  else if (!h) room.hostId = room.players.size ? room.players.keys().next().value : null;
}

function addPlayer(room, ws, name) {
  const id = nextId++;
  const team = teamCount(room, 'L') <= teamCount(room, 'R') ? 'L' : 'R';
  const usedColors = new Set([...room.players.values()].map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !usedColors.has(c)) || PLAYER_COLORS[0];
  const p = { id, token: crypto.randomBytes(12).toString('hex'), name, team, ready: false, ws, connected: true, color, gold: 0, income: 0, cursor: null, sent: 0, kills: 0, sendIncome: 0, incomeFrac: 0 };
  room.players.set(id, p);
  ensureHost(room);
  return p;
}

function resetToLobby(room) {
  room.phase = 'lobby'; room.game = null; room.tick = 0; room.sentTv = null;
  for (const [id, p] of room.players) if (!p.connected) room.players.delete(id);
  for (const p of room.players.values()) { p.ready = false; p.cursor = null; }
  ensureHost(room);
}

function startGame(room) {
  room.phase = 'game'; room.tick = 0; room.sentTv = { L: -1, R: -1 };
  G.createGame(room);
  log(`room ${room.code} started with ${room.players.size} players (team size ${room.game.teamSize})`);
}

// ---------------- state snapshots ----------------
// Static tower data is only included when it changed (or every KEYFRAME_TICKS, or for a fresh socket).
// Enemy gold is never sent.
function boardsMsg(room, full) {
  const g = room.game, out = {};
  for (const t of ['L', 'R']) {
    const b = g.boards[t];
    const ln = WIRE.laneInfo(g, b);
    const o = {
      lives: b.lives, leak: b.leakFlash > 0 ? 1 : 0, tv: b.towerVer, busy: G.boardBusy(g, b) ? 1 : 0, // busy = sales are queued (same rule as the server)
      creeps: WIRE.encodeCreeps(g, b), // compact: decoded by S.decodeState
      queued: b.queue.length, queuedSends: b.queue.reduce((n, q) => n + (q.from ? 1 : 0), 0),
      lane: ln.lane, laneFull: ln.laneFull, // send lane INTO this board: seconds booked ahead, and 1 when sends to it are refused
    };
    if (full || room.sentTv[t] !== b.towerVer) {
      o.towers = [...b.towers.values()].map((tw) => [tw.id, tw.c, tw.r, tw.type, tw.lvl, tw.owner, tw.sellAt !== null ? 1 : 0]);
    }
    out[t] = o;
  }
  return out;
}
function tiersOf(p) { const o = {}; for (const k of Object.keys(S.SENDS)) o[k] = G.tierOf(p, k); return o; }
function playersFor(room, team) {
  return [...room.players.values()].map((p) => {
    const o = { id: p.id, name: p.name, team: p.team, income: p.income, color: p.color, cursor: p.cursor, connected: p.connected, sent: p.sent, kills: p.kills, tiers: tiersOf(p) }; // send tiers are public (defenders must read incoming threats)
    if (p.team === team || room.phase === 'over') { o.gold = Math.floor(p.gold); }
    return o;
  });
}
function stateFor(room, team, boards, split) {
  const g = room.game;
  if (!split) split = WIRE.splitEvents(g.events);
  return JSON.stringify({
    t: 's', phase: room.phase, time: +g.time.toFixed(2), wave: g.wave, nextIncome: +g.nextIncome.toFixed(1), nextWave: +g.nextWave.toFixed(1),
    winner: g.winner, winReason: g.winReason, sd: g.suddenDeath ? 1 : 0, fin: g.finishing, teamSize: g.teamSize,
    boards, sh: split.sh, ev: split.ev, players: playersFor(room, team),
  });
}
function broadcastState(room, forceFull) {
  const full = forceFull || room.tick % KEYFRAME_TICKS === 0;
  const boards = boardsMsg(room, full);
  const split = WIRE.splitEvents(room.game.events);
  const msgs = { L: stateFor(room, 'L', boards, split), R: stateFor(room, 'R', boards, split) };
  for (const p of room.players.values()) send(p.ws, msgs[p.team]);
  room.sentTv = { L: room.game.boards.L.towerVer, R: room.game.boards.R.towerVer };
}
function sendFullState(room, p) {
  if (!room.game) return;
  send(p.ws, stateFor(room, p.team, boardsMsg(room, true)));
}

// ---------------- message handling ----------------
const isInt = (v) => Number.isInteger(v);
function handle(ws, msg) {
  if (typeof msg.t !== 'string') return;
  const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
  const p = room ? room.players.get(ws.playerId) : null;
  switch (msg.t) {
    case 'create': {
      if (room) return;
      if (rooms.size >= LIMITS.MAX_ROOMS) return send(ws, { t: 'err', msg: 'Server is full, try again later' });
      const code = makeCode();
      const r = { code, hostId: null, players: new Map(), phase: 'lobby', game: null, emptySince: null, tick: 0, sentTv: null };
      rooms.set(code, r);
      const np = addPlayer(r, ws, cleanName(msg.name));
      ws.roomCode = code; ws.playerId = np.id;
      send(ws, { t: 'joined', code, you: np.id, token: np.token });
      broadcastLobby(r);
      log(`room ${code} created by ${np.name}`);
      return;
    }
    case 'join': {
      if (room) return;
      const code = String(typeof msg.code === 'string' ? msg.code : '').toUpperCase().trim().slice(0, 8);
      const r = rooms.get(code);
      if (!r) return send(ws, { t: 'err', code: 'noroom', msg: `Room ${code || '?'} not found` });
      if (typeof msg.token === 'string' && msg.token) {
        for (const ep of r.players.values()) {
          if (ep.token === msg.token) {
            if (ep.ws && ep.ws !== ws) { // seat opened elsewhere (e.g. a second tab): tell the old socket why, and it must not reconnect
              const old = ep.ws; ep.ws = null; old.playerId = null; old.roomCode = null;
              send(old, { t: 'err', code: 'replaced', msg: 'This seat was opened in another tab or window.' });
              try { old.close(4001, 'replaced'); } catch (e) {}
            }
            ep.ws = ws; ep.connected = true; if (msg.name) ep.name = cleanName(msg.name);
            ws.roomCode = code; ws.playerId = ep.id; r.emptySince = null;
            ensureHost(r);
            send(ws, { t: 'joined', code, you: ep.id, token: ep.token, rejoined: true });
            broadcastLobby(r);
            sendFullState(r, ep);
            return;
          }
        }
      }
      if (r.phase !== 'lobby') return send(ws, { t: 'err', code: 'joinfail', msg: 'Game already in progress' });
      if (r.players.size >= S.MAX_PER_TEAM * 2) return send(ws, { t: 'err', code: 'joinfail', msg: 'Room is full' });
      const np = addPlayer(r, ws, cleanName(msg.name));
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
      const nl = teamCount(room, 'L'), nr = teamCount(room, 'R');
      if (!nl || !nr) return send(ws, { t: 'err', msg: 'Each team needs at least one player' });
      if (nl !== nr) return send(ws, { t: 'err', msg: `Teams must be even (${nl}v${nr}) — play 1v1 or 2v2` });
      const notReady = [...room.players.values()].filter((x) => x.connected && !x.ready && x.id !== room.hostId);
      if (notReady.length) return send(ws, { t: 'err', msg: 'Waiting for: ' + notReady.map((x) => x.name).join(', ') });
      if ([...room.players.values()].some((x) => !x.connected)) { resetToLobby(room); broadcastLobby(room); return send(ws, { t: 'err', msg: 'A disconnected player was removed; check the teams' }); }
      startGame(room); broadcastLobby(room); return;
    }
    case 'lobby':
      if (room.phase !== 'over' || p.id !== room.hostId) return;
      resetToLobby(room);
      broadcastLobby(room); return;
    case 'cursor':
      if (msg.c === null || msg.c === undefined) p.cursor = null;
      else if (Number.isFinite(msg.c) && Number.isFinite(msg.r) && (msg.b === 'L' || msg.b === 'R')) {
        p.cursor = { b: msg.b, c: Math.max(0, Math.min(S.COLS, +msg.c.toFixed(2))), r: Math.max(0, Math.min(S.ROWS, +msg.r.toFixed(2))) };
      }
      return;
    case 'chat': {
      if (!take(ws.chatBucket, LIMITS.CHAT_RATE, LIMITS.CHAT_BURST)) return send(ws, { t: 'err', msg: 'Slow down on the chat' });
      if (typeof msg.text !== 'string') return;
      const text = msg.text.slice(0, 120).trim();
      if (text) broadcast(room, { t: 'chat', name: p.name, color: p.color, text });
      return;
    }
  }
  if (room.phase !== 'game') return;
  // test-only: corrupt the game state so the next tick throws (enabled only with FORGE_TEST_HOOKS=1)
  // test-only: top up gold for screenshot/perf scripts (enabled only with FORGE_TEST_HOOKS=1)
  if (msg.t === 'debug_gold' && process.env.FORGE_TEST_HOOKS === '1') { G.addGold(p, 5000); return; }
  // test-only: jump the wave counter forward (so smoke tests can reach send-tier unlocks quickly)
  if (msg.t === 'debug_wave' && process.env.FORGE_TEST_HOOKS === '1') { const n = Math.floor(+msg.wave); if (Number.isFinite(n) && n > room.game.wave && n < 40) room.game.wave = n; return; }
  if (msg.t === 'debug_crash' && process.env.FORGE_TEST_HOOKS === '1') { room.game.boards.L.towers.set('0,0', { c: 0, r: 0, type: 'bogus', lvl: 0, cd: 0, sellAt: null }); return; }
  let err = null;
  switch (msg.t) {
    case 'build':
      if (!S.hasTower(msg.type)) return;
      if (!isInt(msg.c) || !isInt(msg.r)) return;
      err = G.build(room, p, msg.type, msg.c, msg.r); break;
    case 'upgrade':
      if (!isInt(msg.c) || !isInt(msg.r)) return;
      err = G.upgrade(room, p, msg.c, msg.r); break;
    case 'sell':
      if (!isInt(msg.c) || !isInt(msg.r)) return;
      err = G.sell(room, p, msg.c, msg.r); break;
    case 'send':
      if (!S.hasSend(msg.kind)) return send(ws, { t: 'err', msg: 'Unknown send' });
      err = G.doSend(room, p, msg.kind); break;
    case 'sendup':
      if (!S.hasSend(msg.kind)) return send(ws, { t: 'err', msg: 'Unknown send' });
      err = G.upgradeSend(room, p, msg.kind); break;
    default: return;
  }
  if (err) send(ws, { t: 'err', msg: err });
}

function leave(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  const p = room.players.get(ws.playerId);
  if (!p || p.ws !== ws) return;
  if (room.phase === 'lobby') room.players.delete(p.id);
  else { p.connected = false; p.ws = null; p.cursor = null; }
  ensureHost(room);
  if (![...room.players.values()].some((x) => x.connected)) room.emptySince = Date.now();
  broadcastLobby(room);
}

// ---------------- rate limiting ----------------
function bucket(burst) { return { tokens: burst, last: Date.now() }; }
function take(b, rate, burst) {
  const now = Date.now();
  b.tokens = Math.min(burst, b.tokens + ((now - b.last) / 1000) * rate); b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1; return true;
}

// Per-IP limits key on the socket address. Proxy headers can be forged by any client, so they are only
// trusted when told to:
//   TRUST_PROXY=1 -> the LAST X-Forwarded-For hop (the one appended by the proxy in front of us).
//   TRUST_CF=1    -> CF-Connecting-IP first. Only set this when the edge really is Cloudflare (Cloudflare overwrites
//                    client-supplied values; any other edge passes them through). True-Client-IP is never trusted:
//                    Cloudflare only sets it on Enterprise plans, so elsewhere it is client-controlled.
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const TRUST_CF = /^(1|true|yes)$/i.test(process.env.TRUST_CF || '');
function clientIp(req) {
  const h = req.headers;
  if (TRUST_CF) {
    const cf = h['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
  }
  if (TRUST_PROXY || TRUST_CF) {
    const xf = h['x-forwarded-for'];
    if (typeof xf === 'string' && xf.trim()) {
      const parts = xf.split(',').map((x) => x.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
  }
  return req.socket.remoteAddress || '?';
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  if (wss.clients.size > LIMITS.MAX_CONNECTIONS) { logOnce('maxconn', 'connection refused: server full'); ws.close(1013, 'Server full'); return; }
  const n = (ipCounts.get(ip) || 0) + 1;
  if (n > LIMITS.MAX_CONN_PER_IP) { logOnce('ipcap:' + ip, `connection refused: too many from ${ip}`); ws.close(1008, 'Too many connections'); return; }
  ipCounts.set(ip, n); ws.ip = ip;
  ws.isAlive = true;
  ws.msgBucket = bucket(LIMITS.MSG_BURST); ws.chatBucket = bucket(LIMITS.CHAT_BURST); ws.dropped = 0;
  ws.joinTimer = setTimeout(() => { if (!ws.roomCode) ws.close(1000, 'Join timeout'); }, LIMITS.JOIN_TIMEOUT_MS);
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (data, isBinary) => {
    if (!take(ws.msgBucket, LIMITS.MSG_RATE, LIMITS.MSG_BURST)) {
      if (++ws.dropped > LIMITS.DROP_LIMIT) { logOnce('flood:' + ip, `disconnecting ${ip}: message flood`); ws.terminate(); }
      return;
    }
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    try { handle(ws, msg); } catch (e) { logOnce('handle:' + (e && e.message), 'ERROR handling message: ' + (e.stack || e)); }
  });
  ws.on('close', () => {
    clearTimeout(ws.joinTimer);
    const c = (ipCounts.get(ip) || 1) - 1; if (c > 0) ipCounts.set(ip, c); else ipCounts.delete(ip);
    try { leave(ws); } catch (e) { logOnce('close', 'ERROR on close: ' + (e.stack || e)); }
  });
  ws.on('error', () => {});
});

// main loop
function crashRoom(room, e) {
  logOnce('tick:' + room.code, `ERROR in tick for room ${room.code}, resetting it to the lobby: ` + (e && e.stack || e));
  try {
    broadcast(room, { t: 'err', msg: 'The game hit a server error and was reset to the lobby. Sorry!' });
    resetToLobby(room); broadcastLobby(room);
  } catch (e2) { log('ERROR resetting room ' + room.code + ', removing it: ' + (e2.stack || e2)); rooms.delete(room.code); }
}
setInterval(() => {
  for (const room of rooms.values()) {
    try {
      if (room.phase === 'game') {
        let ended = false;
        for (let i = 0; i < SPEED && !ended; i++) ended = G.stepGame(room);
        room.tick++;
        broadcastState(room, ended);
        room.game.events = [];
        if (ended) { log(`room ${room.code} game over, winner ${room.game.winner} after ${room.game.time.toFixed(0)}s`); broadcastLobby(room); }
      }
    } catch (e) { crashRoom(room, e); }
  }
}, G.TICK);

// housekeeping: heartbeat + empty room cleanup
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.dropped = 0; try { ws.ping(); } catch (e) {} }
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.players.size || (room.emptySince && now - room.emptySince > 5 * 60 * 1000)) { rooms.delete(code); log(`room ${code} removed`); }
  }
}, 15000);

process.on('uncaughtException', (e) => logOnce('uncaught:' + (e && e.message), 'UNCAUGHT ' + (e.stack || e)));
server.listen(PORT, () => log(`Forge TD v${S.VERSION} listening on http://localhost:${PORT}${TRUST_PROXY ? ' (TRUST_PROXY on)' : ''}${TRUST_CF ? ' (TRUST_CF on)' : ''}${SPEED > 1 ? ` (SPEED=${SPEED}, testing only)` : ''}`));
