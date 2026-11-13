const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = process.env.PORT || 10000;
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

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function leaveRoom(ws) {
  const code = ws.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  ws.roomCode = null;

  if (!room) return;

  room.players.delete(ws);

  for (const player of room.players) {
    send(player, { type: "player_left" });
  }

  if (room.players.size === 0) {
    rooms.delete(code);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, {
      "content-type": "application/json"
    });

    res.end(JSON.stringify({
      ok: true,
      service: "undead-historic-server",
      rooms: rooms.size
    }));

    return;
  }

  res.writeHead(404, {
    "content-type": "application/json"
  });

  res.end(JSON.stringify({ error: "Not found" }));
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.roomCode = null;

  send(ws, {
    type: "connected",
    message: "Undead Historic server ready"
  });

  ws.on("message", (raw) => {
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
        message: "Mensagem sem campo type."
      });
      return;
    }

    if (msg.type === "create_room" || msg.type === "create") {
      leaveRoom(ws);

      const code = makeCode();
      const room = {
        players: new Set([ws])
      };

      rooms.set(code, room);
      ws.roomCode = code;

      send(ws, {
        type: "room_created",
        code,
        roomCode: code,
        player: 1
      });

      return;
    }

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

      if (room.players.size >= 2 && !room.players.has(ws)) {
        send(ws, {
          type: "error",
          message: "Sala cheia."
        });
        return;
      }

      leaveRoom(ws);

      room.players.add(ws);
      ws.roomCode = code;

      send(ws, {
        type: "room_joined",
        code,
        roomCode: code,
        player: 2
      });

      for (const player of room.players) {
        if (player !== ws) {
          send(player, { type: "player_joined" });
        }
      }

      return;
    }

    if (msg.type === "state" || msg.type === "player_state") {
      const room = rooms.get(ws.roomCode);

      if (!room) {
        send(ws, {
          type: "error",
          message: "Você não está em uma sala."
        });
        return;
      }

      const players = [...room.players];

      const packet = {
        type: "peer_state",
        state: msg.state !== undefined ?
