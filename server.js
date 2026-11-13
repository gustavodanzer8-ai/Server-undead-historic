const http = require("http");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = process.env.PORT || 10000;
const MAX_PLAYERS = 4;
const MAX_NAME_LENGTH = 16;

const rooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;

  do {
    code = Array.from(
      { length: 6 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(code));

  return code;
}

function cleanName(name) {
  if (typeof name !== "string") return "Jogador";

  const cleaned = name
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);

  return cleaned || "Jogador";
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function getPlayers(room) {
  return [...room.players.values()].map(player => ({
    playerId: player.id,
    name: player.name
  }));
}

function leaveRoom(ws) {
  const code = ws.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  ws.roomCode = null;

  if (!room) return;

  const player = room.players.get(ws);
  room.players.delete(ws);

  for (const other of room.players.keys()) {
    send(other, {
      type: "player_left",
      playerId: player?.id
    });
  }

  if (room.players.size === 0) {
    rooms.delete(code);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, {
      "content-type": "application/json"
    });

    res.end(JSON.stringify({
      ok: true,
      service: "undead-historic-server",
      rooms: rooms.size,
      maxPlayers: MAX_PLAYERS
    }));

    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({
  server,
  maxPayload: 64 * 1024
});

wss.on("connection", ws => {
  ws.roomCode = null;

  send(ws, {
    type: "connected",
    message: "Undead Historic server ready"
  });

  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, {
        type: "error",
        message: "Mensagem JSON inválida."
      });
      return;
    }

    if (!msg || typeof msg.type !== "string") {
      send(ws, {
        type: "error",
        message: "Mensagem inválida."
      });
      return;
    }

    // CRIAR SALA
    if (msg.type === "create_room" || msg.type === "create") {
      leaveRoom(ws);

      const code = makeCode();

      const player = {
        id: crypto.randomUUID(),
        name: cleanName(msg.name)
      };

      const room = {
        players: new Map()
      };

      room.players.set(ws, player);

      rooms.set(code, room);
      ws.roomCode = code;

      send(ws, {
        type: "room_created",
        code,
        roomCode: code,
        player: 1,
        playerId: player.id,
        name: player.name,
        players: getPlayers(room)
      });

      return;
    }

    // ENTRAR EM SALA
    if (msg.type === "join_room" || msg.type === "join") {
      const code = String(
        msg.code || msg.roomCode || ""
      ).trim().toUpperCase();

      const room = rooms.get(code);

      if (!room) {
        send(ws, {
          type: "error",
          message: "Sala não encontrada."
        });
        return;
      }

      if (room.players.size >= MAX_PLAYERS && !room.players.has(ws)) {
        send(ws, {
          type: "error",
          message: "Sala cheia! Máximo de 4 jogadores."
        });
        return;
      }

      leaveRoom(ws);

      const player = {
        id: crypto.randomUUID(),
        name: cleanName(msg.name)
      };

      room.players.set(ws, player);
      ws.roomCode = code;

      send(ws, {
        type: "room_joined",
        code,
        roomCode: code,
        player: room.players.size,
        playerId: player.id,
        name: player.name,
        players: getPlayers(room)
      });

      for (const other of room.players.keys()) {
        if (other !== ws) {
          send(other, {
            type: "player_joined",
            playerId: player.id,
            name: player.name,
            players: getPlayers(room)
          });
        }
      }

      return;
    }

    // SINCRONIZAR ESTADO DOS JOGADORES
    if (msg.type === "state" || msg.type === "player_state") {
      const room = rooms.get(ws.roomCode);

      if (!room) {
        send(ws, {
          type: "error",
          message: "Você não está em uma sala."
        });
        return;
      }

      const player = room.players.get(ws);

      if (!player) return;

      for (const other of room.players.keys()) {
        if (other !== ws) {
          send(other, {
            type: "peer_state",
            playerId: player.id,
            name: player.name,
            state: msg.state
          });
        }
      }

      return;
    }

    // SAIR DA SALA
    if (msg.type === "leave_room") {
      leaveRoom(ws);

      send(ws, {
        type: "left_room"
      });

      return;
    }

    send(ws, {
      type: "error",
      message: "Comando desconhecido."
    });
  });

  ws.on("close", () => {
    leaveRoom(ws);
  });

  ws.on("error", () => {
    leaveRoom(ws);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Undead Historic multiplayer online na porta ${PORT}`
  );
});
