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

function sendError(ws, message) {
  send(ws, { type: 'error', message });
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8'
    });

    res.end(JSON.stringify({
      ok: true,
      service: 'undead-historic-server',
      rooms: rooms.size,
      maxPlayers: MAX_PLAYERS
    }));
    return;
  }

  res.writeHead(404, {
    'content-type': 'text/plain; charset=utf-8'
  });
  res.end('Not found');
});

const wss = new WebSocketServer({
  server,
  maxPayload: 256 * 1024
});

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
    } catch (error) {
      sendError(ws, 'Mensagem JSON inválida.');
      return;
    }

    if (!msg || typeof msg.type !== 'string') {
      sendError(ws, 'Mensagem inválida.');
      return;
    }

    // CRIAR SALA
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
      room.personalItems.set(player.id, new Set());

      rooms.set(code, room);
      ws.roomCode = code;

      send(ws, {
        type: 'room_created',
        code,
        roomCode: code,
        player: 1,
        playerId: player.id,
        hostId: room.hostId,
        isHost: true,
        started: false,
        players: getPlayers(room)
      });

      return;
    }

    // ENTRAR EM SALA
    if (msg.type === 'join_room' || msg.type === 'join') {
      const code = String(
        msg.code || msg.roomCode || ''
      ).trim().toUpperCase();

      const room = rooms.get(code);

      if (!room) {
        sendError(ws, 'Sala não encontrada.');
        return;
      }

      if (room.started) {
        sendError(ws, 'A partida desta sala já começou.');
        return;
      }

      if (room.players.size >= MAX_PLAYERS) {
        sendError(ws, 'Sala cheia! Máximo de 4 jogadores.');
        return;
      }

      if (ws.roomCode && ws.roomCode !== code) {
        leaveRoom(ws);
      }

      if (ws.roomCode === code && room.players.has(ws)) {
        sendError(ws, 'Você já está nesta sala.');
        return;
      }

      const player = {
        id: crypto.randomUUID(),
        name: cleanName(msg.name)
      };

      room.players.set(ws, player);
      room.personalItems.set(player.id, new Set());
      ws.roomCode = code;

      send(ws, {
        type: 'room_joined',
        code,
        roomCode: code,
        player: room.players.size,
        playerId: player.id,
        hostId: room.hostId,
        isHost: player.id === room.hostId,
        started: room.started,
        players: getPlayers(room),
        worldState: room.worldState,
        chipClaimed: room.chipClaimed,
        playerStates: Object.fromEntries(room.playerStates)
      });

      // ENVIAR ESTADOS DOS JOGADORES EXISTENTES
      for (const [peerId, peerState] of room.playerStates) {
        if (peerId === player.id) continue;

        const peer = Array.from(room.players.values())
          .find(p => p.id === peerId);

        send(ws, {
          type: 'peer_state',
          playerId: peerId,
          name: peer ? peer.name : 'Jogador',
          state: peerState
        });
      }

      broadcast(room, {
        type: 'player_joined',
        playerId: player.id,
        name: player.name,
        players: getPlayers(room)
      }, ws);

      return;
    }

    // SAIR DA SALA
    if (msg.type === 'leave_room') {
      leaveRoom(ws);
      send(ws, { type: 'left_room' });
      return;
    }

    const room = roomFor(ws);

    if (!room) {
      sendError(ws, 'Você não está em uma sala.');
      return;
    }

    const player = room.players.get(ws);
    const isHost = player.id === room.hostId;

    // INICIAR PARTIDA: SOMENTE HOST
    if (msg.type === 'start_game') {
      if (!isHost) {
        sendError(ws, 'Somente o host pode iniciar a partida.');
        return;
      }

      if (room.started) {
        sendError(ws, 'A partida já foi iniciada.');
        return;
      }

      room.started = true;
      room.startAt = Date.now() + 3000;

      broadcast(room, {
        type: 'game_started',
        startAt: room.startAt,
        hostId: room.hostId
      });

      return;
    }

    // ESTADO INDIVIDUAL DOS JOGADORES
    if (msg.type === 'state' || msg.type === 'player_state') {
      if (
        !msg.state ||
        typeof msg.state !== 'object' ||
        Array.isArray(msg.state)
      ) return;

      const serialized = JSON.stringify(msg.state);

      if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) {
        sendError(ws, 'Estado do jogador muito grande.');
        return;
      }

      room.playerStates.set(player.id, msg.state);

      broadcast(room, {
        type: 'peer_state',
        playerId: player.id,
        name: player.name,
        state: msg.state
      }, ws);

      return;
    }

    // ESTADO COMPARTILHADO DO MUNDO: SOMENTE HOST
    if (msg.type === 'world_state') {
      if (!isHost) {
        sendError(ws, 'Somente o host pode sincronizar o mundo.');
        return;
      }

      if (
        !msg.state ||
        typeof msg.state !== 'object' ||
        Array.isArray(msg.state)
      ) return;

      const serialized = JSON.stringify(msg.state);

      if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) {
        sendError(ws, 'Estado do mundo muito grande.');
        return;
      }

      room.worldState = msg.state;

      broadcast(room, {
        type: 'world_state',
        state: room.worldState,
        hostId: room.hostId
      }, ws);

      return;
    }

    // EVENTOS DE CHEFES E INIMIGOS
    // TODOS OS JOGADORES PODEM ENVIAR EVENTOS.
    if (msg.type === 'world_event') {
      if (
        !msg.event ||
        typeof msg.event !== 'object' ||
        Array.isArray(msg.event)
      ) return;

      const serialized = JSON.stringify(msg.event);

      if (Buffer.byteLength(serialized, 'utf8') > 16 * 1024) {
        sendError(ws, 'Evento do mundo muito grande.');
        return;
      }

      broadcast(room, {
        type: 'world_event',
        event: msg.event,
        by: player.id
      }, ws);

      return;
    }

    // COLETA DE ITENS
    if (msg.type === 'claim_item') {
      const itemId = String(msg.itemId || '')
        .trim()
        .slice(0, 100);

      if (!itemId) {
        sendError(ws, 'Item inválido.');
        return;
      }

      // CHIP DA CAPRI: ÚNICO POR SALA
      if (itemId === 'chip' || itemId === 'capri_chip') {
        if (room.chipClaimed) {
          send(ws, {
            type: 'item_claim_result',
            itemId: 'chip',
            accepted: false,
            reason: 'already_claimed',
            chipClaimed: true
          });
          return;
        }

        room.chipClaimed = true;
        room.chipClaimedBy = player.id;

        broadcast(room, {
          type: 'chip_claimed',
          itemId: 'chip',
          playerId: player.id,
          playerName: player.name
        });

        send(ws, {
          type: 'item_claim_result',
          itemId: 'chip',
          accepted: true,
          chipClaimed: true
        });

        return;
      }

      // ITENS COMUNS: UMA CÓPIA POR JOGADOR
      let owned = room.personalItems.get(player.id);

      if (!owned) {
        owned = new Set();
        room.personalItems.set(player.id, owned);
      }

      if (owned.has(itemId)) {
        send(ws, {
          type: 'item_claim_result',
          itemId,
          accepted: false,
          reason: 'already_owned'
        });
        return;
      }

      owned.add(itemId);

      send(ws, {
        type: 'item_claim_result',
        itemId,
        accepted: true
      });

      return;
    }

    // SOLICITAR ESTADO ATUAL DO MUNDO
    if (msg.type === 'get_world_state') {
      send(ws, {
        type: 'world_state',
        state: room.worldState,
        hostId: room.hostId,
        chipClaimed: room.chipClaimed,
        chipClaimedBy: room.chipClaimedBy,
        started: room.started,
        startAt: room.startAt
      });

      return;
    }

    sendError(ws, 'Comando desconhecido.');
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    'Undead Historic multiplayer online na porta ' + PORT
  );
});
