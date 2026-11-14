'use strict';

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 10000);
const MAX_PLAYERS = 4;
const MAX_NAME_LENGTH = 16;
const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  if (typeof name !== 'string') return 'Jogador';
  return name.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, MAX_NAME_LENGTH) || 'Jogador';
}

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(room, payload, except = null) {
  for (const ws of room.players.keys()) if (ws !== except) send(ws, payload);
}

function getPlayers(room) {
  return [...room.players.values()].map(p => ({ playerId: p.id, name: p.name, isHost: p.id === room.hostId }));
}

function roomFor(ws) {
  const room = rooms.get(ws.roomCode);
  return room && room.players.has(ws) ? room : null;
}

function leaveRoom(ws) {
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  ws.roomCode = null;
  if (!room) return;

  const player = room.players.get(ws);
  room.players.delete(ws);
  room.personalItems.delete(player?.id);
  room.playerStates.delete(player?.id);

  if (!room.players.size) {
    rooms.delete(code);
    return;
  }

  if (player?.id === room.hostId) {
    room.hostId = room.players.values().next().value.id;
    broadcast(room, { type: 'host_changed', hostId: room.hostId, players: getPlayers(room) });
  }

  broadcast(room, { type: 'player_left', playerId: player?.id, players: getPlayers(room) });
}

function safeSendError(ws, message) {
  send(ws, { type: 'error', message });
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      service: 'undead-historic-server',
      rooms: rooms.size,
      maxPlayers: MAX_PLAYERS
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });

wss.on('connection', ws => {
  ws.roomCode = null;

  send(ws, {
    type: 'connected',
    message: 'Undead Historic server ready'
  });

  ws.on('message', raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return safeSendError(ws, 'Mensagem JSON inválida.');
    }

    if (!msg || typeof msg.type !== 'string') {
      return safeSendError(ws, 'Mensagem inválida.');
    }

    // Criar sala
    if (msg.type === 'create_room' || msg.type === 'create') {
      leaveRoom(ws);

      const code = makeCode();
      const player = {
        id: crypto.randomUUID(),
        name: cleanName(msg.name)
      };

      const room = {
        players: new Map(),
        hostId: player.id,
        started: false,
        startAt: 0,
        worldState: null,
        playerStates: new Map(),
        personalItems: new Map(),
        chipClaimed: false,
        chipClaimedBy: null
      };

      room.players.set(ws, player);
      room.personalItems.set(player
