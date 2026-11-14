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

    // Entrar em sala
    if (msg.type === 'join_room' || msg.type === 'join') {
      const code = String(msg.code || msg.roomCode || '').trim().toUpperCase();
      const room = rooms.get(code);

      if (!room) return safeSendError(ws, 'Sala não encontrada.');
      if (room.started) return safeSendError(ws, 'A partida já começou.');
      if (room.players.size >= MAX_PLAYERS) {
        return safeSendError(ws, 'Sala cheia!');
      }

      leaveRoom(ws);

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
        playerId: player.id,
        hostId: room.hostId,
        isHost: false,
        started: false,
        players: getPlayers(room),
        worldState: room.worldState,
        chipClaimed: room.chipClaimed
      });

      broadcast(room, {
        type: 'player_joined',
        playerId: player.id,
        name: player.name,
        players: getPlayers(room)
      }, ws);

      return;
    }

    const room = roomFor(ws);

    if (!room) {
      return safeSendError(ws, 'Você não está em uma sala.');
    }

    const player = room.players.get(ws);
    const isHost = player.id === room.hostId;

    // Somente o host inicia
    if (msg.type === 'start_game') {
      if (!isHost) {
        return safeSendError(ws, 'Somente o host pode iniciar.');
      }

      if (room.started) {
        return safeSendError(ws, 'A partida já começou.');
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

    // Estado dos jogadores
    if (msg.type === 'state' || msg.type === 'player_state') {
      if (!msg.state || typeof msg.state !== 'object') return;

      room.playerStates.set(player.id, msg.state);

      broadcast(room, {
        type: 'peer_state',
        playerId: player.id,
        name: player.name,
        state: msg.state
      }, ws);

      return;
    }

    // Estado compartilhado do mundo
    if (msg.type === 'world_state') {
      if (!isHost) {
        return safeSendError(ws, 'Somente o host pode sincronizar o mundo.');
      }

      if (!msg.state || typeof msg.state !== 'object') return;

      room.worldState = msg.state;

      broadcast(room, {
        type: 'world_state',
        state: room.worldState
      }, ws);

      return;
    }

    // Eventos de chefes e inimigos
    if (msg.type === 'world_event') {
      if (!isHost) {
        return safeSendError(ws, 'Somente o host pode enviar eventos do mundo.');
      }

      if (!msg.event || typeof msg.event !== 'object') return;

      broadcast(room, {
        type: 'world_event',
        event: msg.event,
        by: player.id
      }, ws);

      return;
    }

    // Coleta de itens
    if (msg.type === 'claim_item') {
      const itemId = String(msg.itemId || '').slice(0, 100);

      if (!itemId) return safeSendError(ws, 'Item inválido.');

      if (itemId === 'chip' || itemId === 'capri_chip') {
        if (room.chipClaimed) {
          return send(ws, {
            type: 'item_claim_result',
            itemId: 'chip',
            accepted: false,
            reason: 'already_claimed'
          });
        }

        room.chipClaimed = true;
        room.chipClaimedBy = player.id;

        broadcast(room, {
          type: 'chip_claimed',
          itemId: 'chip',
          playerId: player.id,
          playerName: player.name
        });

        return send(ws, {
          type: 'item_claim_result',
          itemId: 'chip',
          accepted: true
        });
      }

      let owned = room.personalItems.get(player.id);

      if (!owned) {
        owned = new Set();
        room.personalItems.set(player.id, owned);
      }

      if (owned.has(itemId)) {
        return send(ws, {
          type: 'item_claim_result',
          itemId,
          accepted: false,
          reason: 'already_owned'
        });
      }

      owned.add(itemId);

      send(ws, {
        type: 'item_claim_result',
        itemId,
        accepted: true
      });

      return;
    }

    if (msg.type === 'get_world_state') {
      send(ws, {
        type: 'world_state',
        state: room.worldState,
        hostId: room.hostId,
        chipClaimed: room.chipClaimed
      });

      return;
    }

    if (msg.type === 'leave_room') {
      leaveRoom(ws);
      send(ws, { type: 'left_room' });
      return;
    }

    safeSendError(ws, 'Comando desconhecido.');
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Undead Historic multiplayer online na porta ' + PORT);
});
