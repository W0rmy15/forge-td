// Small headless client helpers for tests (merges delta tower updates like the browser client does).
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(url, name) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    const c = { ws, name, id: null, code: null, token: null, lobby: null, state: null, errs: [], chats: [], msgs: 0, bytes: 0, closed: false, closeCode: null,
      send(m) { if (ws.readyState === 1) ws.send(typeof m === 'string' ? m : JSON.stringify(m)); },
      me() { return c.state && c.state.players.find((p) => p.id === c.id); } };
    ws.on('open', () => res(c)); ws.on('error', (e) => { c.lastErr = e.message; rej(e); });
    ws.on('close', (code) => { c.closed = true; c.closeCode = code; });
    ws.on('message', (d) => {
      c.msgs++; c.bytes += d.length;
      const m = JSON.parse(d);
      if (m.t === 'joined') { c.id = m.you; c.code = m.code; c.token = m.token; c.rejoined = m.rejoined; }
      else if (m.t === 'lobby') c.lobby = m;
      else if (m.t === 's') { for (const b of ['L', 'R']) if (!m.boards[b].towers) m.boards[b].towers = c.state ? c.state.boards[b].towers : []; c.state = m; }
      else if (m.t === 'err') c.errs.push(m.msg);
      else if (m.t === 'chat') c.chats.push(m);
    });
  });
}
// n players; teams: array like ['L','R','L','R']
async function game(url, n, teams, start = true) {
  const cs = [];
  const h = await client(url, 'P0'); cs.push(h); h.send({ t: 'create', name: 'P0' }); await sleep(150);
  for (let i = 1; i < n; i++) { const c = await client(url, 'P' + i); c.send({ t: 'join', code: h.code, name: 'P' + i }); cs.push(c); }
  await sleep(250);
  teams = teams || (n === 2 ? ['L', 'R'] : ['L', 'R', 'L', 'R']);
  for (let i = 0; i < n; i++) { const me = cs[i].lobby.players.find((p) => p.id === cs[i].id); if (me.team !== teams[i]) { cs[i].send({ t: 'team', team: teams[i] }); await sleep(60); } }
  for (const c of cs.slice(1)) c.send({ t: 'ready', ready: true });
  await sleep(150);
  if (start) { h.send({ t: 'start' }); await sleep(300); }
  return cs;
}
module.exports = { client, game, sleep, WebSocket };
