const crypto = require("crypto");
const config = require("./config");
const prisma = require("./db");
const { getCurrentUser } = require("./auth");
const { validateFleet } = require("./game_rules");

const RECONNECT_GRACE_MS = 30_000;
const FINISHED_MATCH_TTL_MS = 30 * 60 * 1000;

function createGameService() {
  const waitingPlayers = [];
  const matches = new Map();
  const activeClients = new Map();

  function send(client, message) {
    if (client && client.ws && client.ws.readyState === 1) {
      client.ws.send(JSON.stringify(message));
    }
  }

  function findPlayer(match, userId) {
    return match.players.find((player) => player.userId === userId);
  }

  function findOpponent(match, userId) {
    return match.players.find((player) => player.userId !== userId);
  }

  function removeFromQueue(client) {
    for (let index = waitingPlayers.length - 1; index >= 0; index -= 1) {
      if (
        waitingPlayers[index] === client ||
        waitingPlayers[index].userId === client.userId
      ) {
        waitingPlayers.splice(index, 1);
      }
    }
    client.queueMode = null;
  }

  function playerSummary(player) {
    return {
      userId: player.userId,
      username: player.username,
      avatarUrl: player.avatarUrl,
      mmr: player.mmr,
      ready: Boolean(player.ships),
      connected: Boolean(player.connected),
    };
  }

  function sendState(match) {
    for (const player of match.players) {
      const opponent = findOpponent(match, player.userId);
      const client = player.client;

      send(client, {
        type: "state",
        match: {
          id: match.id,
          mode: match.mode,
          status: match.status,
          currentTurnUserId: match.currentTurnUserId,
          winnerUserId: match.winnerUserId,
          finishReason: match.finishReason,
          mmrChanges: match.mmrChanges || null,
          players: match.players.map(playerSummary),
        },
        opponentReconnectDeadline:
          match.reconnectDeadlines.get(opponent.userId) || null,
        me: {
          userId: player.userId,
          username: player.username,
          avatarUrl: player.avatarUrl,
          mmr: player.mmr,
        },
        opponent: {
          userId: opponent.userId,
          username: opponent.username,
          avatarUrl: opponent.avatarUrl,
          mmr: opponent.mmr,
        },
        myShips: player.ships,
        myShots: player.shots,
        incomingShots: opponent.shots,
      });
    }
  }

  async function finishMatch(match, winnerUserId, reason) {
    if (match.status === "finished") return;

    // Mark the match finished before the database call so concurrent shots or
    // disconnect timers cannot award rating more than once.
    match.status = "finished";
    match.winnerUserId = winnerUserId;
    match.finishReason = reason;

    if (match.reconnectTimers) {
      for (const timer of match.reconnectTimers.values()) clearTimeout(timer);
      match.reconnectTimers.clear();
    }

    const changeByUserId = new Map(
      match.players.map((player) => [
        player.userId,
        player.userId === winnerUserId ? 25 : -25,
      ]),
    );

    try {
      const updatedUsers = await prisma.$transaction(async (transaction) => {
        const users = await Promise.all(
          match.players.map((player) =>
            transaction.user.findUniqueOrThrow({
              where: { id: player.userId },
              select: { id: true, mmr: true },
            }),
          ),
        );

        return Promise.all(
          users.map((user) =>
            transaction.user.update({
              where: { id: user.id },
              data: {
                mmr: Math.max(0, user.mmr + changeByUserId.get(user.id)),
              },
              select: { id: true, mmr: true },
            }),
          ),
        );
      });

      for (const updatedUser of updatedUsers) {
        const player = findPlayer(match, updatedUser.id);
        if (player) player.mmr = updatedUser.mmr;
      }

      match.mmrChanges = Object.fromEntries(
        match.players.map((player) => [
          String(player.userId),
          {
            change: changeByUserId.get(player.userId),
            newMmr: player.mmr,
          },
        ]),
      );
    } catch (error) {
      console.error("Could not update player MMR after match:", error);
      // Do not tell the browser rating changed if the transaction failed.
      match.mmrChanges = Object.fromEntries(
        match.players.map((player) => [
          String(player.userId),
          {
            change: 0,
            newMmr: player.mmr,
          },
        ]),
      );
    }

    sendState(match);
    for (const player of match.players) {
      const rating = match.mmrChanges[String(player.userId)];
      send(player.client, {
        type: "gameOver",
        winnerUserId,
        reason,
        mmrChange: rating.change,
        newMmr: rating.newMmr,
        message:
          player.userId === winnerUserId
            ? "Victory! The enemy fleet has been destroyed."
            : "Defeat. Your fleet has been destroyed.",
      });
    }

    const cleanupTimer = setTimeout(
      () => matches.delete(match.id),
      FINISHED_MATCH_TTL_MS,
    );
    if (cleanupTimer.unref) cleanupTimer.unref();
  }

  function createMatch(firstClient, secondClient) {
    const match = {
      id: crypto.randomUUID(),
      mode: "classic",
      status: "placing",
      currentTurnUserId: null,
      winnerUserId: null,
      finishReason: null,
      players: [firstClient, secondClient].map((client) => ({
        userId: client.userId,
        username: client.username,
        avatarUrl: client.avatarUrl,
        mmr: client.mmr,
        client,
        connected: true,
        ships: null,
        shots: [],
      })),
      reconnectTimers: new Map(),
      reconnectDeadlines: new Map(),
    };

    matches.set(match.id, match);
    for (const client of [firstClient, secondClient]) {
      client.matchId = match.id;
      client.queueMode = null;
      send(client, {
        type: "matched",
        matchId: match.id,
        mode: "classic",
        opponent: {
          username: (client.userId === firstClient.userId
            ? secondClient
            : firstClient
          ).username,
          avatarUrl: (client.userId === firstClient.userId
            ? secondClient
            : firstClient
          ).avatarUrl,
        },
      });
    }
  }

  function joinQueue(client, mode) {
    if (mode !== "classic") {
      send(client, {
        type: "error",
        message:
          "Enhanced mode is not available yet. Classic mode is ready to play.",
      });
      return;
    }

    if (client.matchId && matches.has(client.matchId)) {
      send(client, { type: "error", message: "You are already in a match." });
      return;
    }

    const existingActiveMatch = Array.from(matches.values()).find(
      (match) =>
        match.status !== "finished" &&
        match.players.some((player) => player.userId === client.userId),
    );
    if (existingActiveMatch) {
      send(client, {
        type: "error",
        message:
          "You already have an active match. Reopen that match instead of starting another search.",
      });
      return;
    }

    if (waitingPlayers.some((player) => player.userId === client.userId)) {
      send(client, {
        type: "searching",
        mode: "classic",
        message: "Searching for an opponent…",
      });
      return;
    }

    const opponentIndex = waitingPlayers.findIndex(
      (waiting) =>
        waiting.userId !== client.userId && waiting.ws.readyState === 1,
    );

    if (opponentIndex === -1) {
      client.queueMode = "classic";
      waitingPlayers.push(client);
      send(client, {
        type: "searching",
        mode: "classic",
        message: "Searching for an opponent… Keep this page open.",
      });
      return;
    }

    const opponent = waitingPlayers.splice(opponentIndex, 1)[0];
    opponent.queueMode = null;
    createMatch(opponent, client);
  }

  function resumeMatch(client, matchId) {
    const match = matches.get(String(matchId || ""));
    if (
      !match ||
      !match.players.some((player) => player.userId === client.userId)
    ) {
      send(client, {
        type: "error",
        message:
          "This match could not be found. Return to the lobby and search again.",
      });
      return;
    }

    const player = findPlayer(match, client.userId);
    player.client = client;
    player.connected = true;
    client.matchId = match.id;

    const timer = match.reconnectTimers.get(client.userId);
    if (timer) {
      clearTimeout(timer);
      match.reconnectTimers.delete(client.userId);
    }
    match.reconnectDeadlines.delete(client.userId);

    send(client, { type: "resumed", matchId: match.id });
    sendState(match);
  }

  function placeFleet(client, message) {
    const match = matches.get(client.matchId);
    if (!match || match.status !== "placing") {
      send(client, {
        type: "error",
        message: "Ship placement is no longer available.",
      });
      return;
    }

    const player = findPlayer(match, client.userId);
    if (!player || player.ships) {
      send(client, {
        type: "error",
        message: "Your fleet has already been submitted.",
      });
      return;
    }

    const result = validateFleet(message.ships);
    if (!result.valid) {
      send(client, { type: "error", message: result.error });
      return;
    }

    player.ships = result.ships;

    const bothReady = match.players.every((entry) =>
      Array.isArray(entry.ships),
    );
    if (bothReady) {
      match.status = "battle";
      match.currentTurnUserId =
        match.players[Math.floor(Math.random() * match.players.length)].userId;
    }

    sendState(match);
  }

  function fireShot(client, message) {
    const match = matches.get(client.matchId);
    if (!match || match.status !== "battle") {
      send(client, { type: "error", message: "The battle has not started." });
      return;
    }

    if (match.currentTurnUserId !== client.userId) {
      send(client, { type: "error", message: "It is not your turn." });
      return;
    }

    const x = message.x;
    const y = message.y;
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      x > 9 ||
      y < 0 ||
      y > 9
    ) {
      send(client, {
        type: "error",
        message: "Choose a cell inside the board.",
      });
      return;
    }

    const player = findPlayer(match, client.userId);
    const opponent = findOpponent(match, client.userId);
    if (player.shots.some((shot) => shot.x === x && shot.y === y)) {
      send(client, {
        type: "error",
        message: "You have already fired at that cell.",
      });
      return;
    }

    const targetShip = opponent.ships.find((ship) =>
      ship.cells.some((cell) => cell.x === x && cell.y === y),
    );
    const shot = { x, y, result: targetShip ? "hit" : "miss", shipSunk: null };
    player.shots.push(shot);

    if (targetShip) {
      const allCellsHit = targetShip.cells.every((cell) =>
        player.shots.some(
          (entry) =>
            entry.x === cell.x && entry.y === cell.y && entry.result === "hit",
        ),
      );
      if (allCellsHit) shot.shipSunk = targetShip.name;
    }

    const allEnemyCellsHit = opponent.ships.every((ship) =>
      ship.cells.every((cell) =>
        player.shots.some(
          (entry) =>
            entry.x === cell.x && entry.y === cell.y && entry.result === "hit",
        ),
      ),
    );

    if (allEnemyCellsHit) {
      finishMatch(match, client.userId, "fleet-destroyed");
      return;
    }

    match.currentTurnUserId = targetShip ? client.userId : opponent.userId;
    sendState(match);
  }

  function forfeit(client) {
    const match = matches.get(client.matchId);
    if (!match || match.status === "finished") return;
    const opponent = findOpponent(match, client.userId);
    finishMatch(match, opponent.userId, "forfeit");
  }

  function handleMessage(client, rawMessage) {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch (error) {
      send(client, { type: "error", message: "Invalid message format." });
      return;
    }

    if (!message || typeof message.type !== "string") {
      send(client, { type: "error", message: "Invalid message format." });
      return;
    }

    switch (message.type) {
      case "search":
        joinQueue(client, message.mode);
        break;
      case "cancelSearch":
        removeFromQueue(client);
        send(client, { type: "searchCancelled" });
        break;
      case "resume":
        resumeMatch(client, message.matchId);
        break;
      case "placeFleet":
        placeFleet(client, message);
        break;
      case "fire":
        fireShot(client, message);
        break;
      case "forfeit":
        forfeit(client);
        break;
      default:
        send(client, { type: "error", message: "Unknown game action." });
    }
  }

  function handleDisconnect(client) {
    // Always remove stale queue entries, even if this socket was replaced by another tab.
    removeFromQueue(client);
    if (activeClients.get(client.userId) !== client) return;
    activeClients.delete(client.userId);

    const match = matches.get(client.matchId);
    if (!match || match.status === "finished") return;

    const player = findPlayer(match, client.userId);
    if (!player) return;
    player.connected = false;
    const previousTimer = match.reconnectTimers.get(client.userId);
    if (previousTimer) 
      clearTimeout(previousTimer);
    const reconnectDeadline = Date.now() + RECONNECT_GRACE_MS;
    match.reconnectDeadlines.set(client.userId, reconnectDeadline);
    sendState(match);
    const timer = setTimeout(() => {
      const currentPlayer = findPlayer(match, client.userId);
      if (
        currentPlayer &&
        !currentPlayer.connected &&
        match.status !== "finished"
      ) {
        finishMatch(
          match,
          findOpponent(match, client.userId).userId,
          "disconnect-timeout",
        );
      }
    }, RECONNECT_GRACE_MS);
    if (timer.unref) 
      timer.unref();
    match.reconnectTimers.set(client.userId, timer);
  }

  async function handleConnection(ws, req) {
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).origin !== new URL(config.frontendUrl).origin) {
          ws.close(1008, "Origin not allowed");
          return;
        }
      } catch (error) {
        ws.close(1008, "Invalid origin");
        return;
      }
    }

    // Attach listeners before the database lookup so the first browser message
    // (search/resume) cannot arrive before a message listener exists.
    let client = null;
    let authenticationFinished = false;
    const pendingMessages = [];

    ws.on("message", (rawMessage) => {
      if (!authenticationFinished) {
        pendingMessages.push(rawMessage);
        return;
      }
      if (!client) return;
      try {
        handleMessage(client, rawMessage);
      } catch (error) {
        console.error("Game message failed:", error);
        send(client, {
          type: "error",
          message: "The game could not process that action.",
        });
      }
    });

    ws.on("close", () => {
      if (client) handleDisconnect(client);
    });
    ws.on("error", (error) =>
      console.error("Game WebSocket error:", error.message),
    );

    let user;
    try {
      user = await getCurrentUser(req);
    } catch (error) {
      authenticationFinished = true;
      ws.close(1011, "Could not verify session");
      console.error("Could not authenticate game WebSocket:", error);
      return;
    }

    authenticationFinished = true;
    if (!user) {
      ws.close(1008, "Authentication required");
      return;
    }

    if (ws.readyState !== 1) return;

    client = {
      ws,
      userId: user.id,
      username: user.username || `Captain ${user.id}`,
      avatarUrl: user.avatarUrl ? `/api/users/${user.id}/avatar` : null,
      mmr: user.mmr ?? 0,
      queueMode: null,
      matchId: null,
    };

    const previousClient = activeClients.get(client.userId);
    activeClients.set(client.userId, client);
    if (previousClient && previousClient.ws.readyState === 1) {
      previousClient.ws.close(4001, "Session opened in another tab");
    }

    send(client, {
      type: "connected",
      userId: client.userId,
      username: client.username,
    });

    for (const rawMessage of pendingMessages) {
      try {
        handleMessage(client, rawMessage);
      } catch (error) {
        console.error("Queued game message failed:", error);
        send(client, {
          type: "error",
          message: "The game could not process that action.",
        });
      }
    }
  }

  return { handleConnection };
}

module.exports = { createGameService };
