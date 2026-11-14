'use strict';

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 10000);
const MAX_PLAYERS = 4;
const MAX_NAME_LENGTH = 16;
const MAX_STATE_BYTES = 200 * 1024;
const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  if (typeof name !== 'string') return 'Jogador';
  const value = name
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return value || 'Jogador';
}

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(room, payload, except = null) {
  for (const client of room.players.keys()) {
    if (client !== except) send(client, payload);
  }
}

function getPlayers(room) {
  return Array.from(room.players.values()).map(player => ({
    playerId: player.id,
    name: player.name,
    isHost: player.id === room.hostId
  }));
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
  if (!player) return;

  room.players.delete(ws);
  room.personalItems.delete(player.id);
  room.playerStates.delete(player.id);

  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }

  if (player.id === room.hostId) {
    const nextHost = room.players.values().next().value;
    room.hostId = nextHost.id;

    broadcast(room, {
      type: 'host_changed',
      hostId: room.hostId,
      players: getPlayers(room)
    });
  }

  broadcast(room, {
    type: 'player_left',
    playerId: player.id,
    players: getPlayers(room)
  });
}

function
