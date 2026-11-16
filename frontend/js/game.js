const SHIPS = [
  { id: "carrier", name: "Carrier", length: 5 },
  { id: "battleship", name: "Battleship", length: 4 },
  { id: "cruiser", name: "Cruiser", length: 3 },
  { id: "submarine", name: "Submarine", length: 3 },
  { id: "destroyer", name: "Destroyer", length: 2 },
];
const BOARD_SIZE = 10;
const ROW_NAMES = "ABCDEFGHIJ";

const gameSubtitle = document.getElementById("game-subtitle");
const gameMessageTitle = document.getElementById("game-message-title");
const gameMessageText = document.getElementById("game-message-text");
const placementPanel = document.getElementById("placement-panel");
const battleLayout = document.getElementById("battle-layout");
const ownBoardPanel = document.querySelector(".own-board-panel");
const resultPanel = document.getElementById("result-overlay");
const resultTitle = document.getElementById("result-title");
const resultText = document.getElementById("result-text");
const resultEmblem = document.getElementById("result-emblem");
const resultMmrChange = document.getElementById("result-mmr-change");
const resultNewMmr = document.getElementById("result-new-mmr");
const shipList = document.getElementById("ship-list");
const randomizeFleetButton = document.getElementById("randomize-fleet-button");
const readyFleetButton = document.getElementById("ready-fleet-button");
const fleetProgress = document.getElementById("fleet-progress");
const ownGrid = document.getElementById("own-grid");
const targetGrid = document.getElementById("target-grid");
const myAvatar = document.getElementById("my-avatar");
const opponentAvatar = document.getElementById("opponent-avatar");
const myName = document.getElementById("my-name");
const myMmr = document.getElementById("my-mmr");
const myRank = document.getElementById("my-rank");
const opponentName = document.getElementById("opponent-name");
const opponentMmr = document.getElementById("opponent-mmr");
const opponentRank = document.getElementById("opponent-rank");
const opponentStatus = document.getElementById("opponent-status");
const opponentDisconnectCountdown = document.getElementById("opponent-disconnect-countdown",);
const opponentCountdownValue = document.getElementById("opponent-countdown-value",);
const leaveGameButton = document.getElementById("leave-game-button");

const query = new URLSearchParams(window.location.search);
const matchId = query.get("match") || localStorage.getItem("activeMatchId");
if (matchId)
  localStorage.setItem("activeMatchId", matchId);
let socket = null;
let opponentCountdownInterval = null;
let activeOpponentReconnectDeadline = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let leavingMatch = false;
let gameState = null;
let localPlacements = [];
let orientation = "horizontal";
let selectedShipId = SHIPS[0].id;
let ownShipLayer = null;
let resultShown = false;
let matchFinished = false;
let previewOrigin = null;

const ranks = [
  { name: "Recruit", mmr: 0 },
  { name: "Seaman Recruit", mmr: 100 },
  { name: "Seaman", mmr: 250 },
  { name: "Petty Officer", mmr: 500 },
  { name: "Chief Petty Officer", mmr: 750 },
  { name: "Ensign", mmr: 1000 },
  { name: "Lieutenant", mmr: 1500 },
  { name: "Commander", mmr: 2000 },
];

function getRank(mmr) {
  let currentRank = ranks[0];

  for (const rank of ranks) {
    if (mmr >= rank.mmr) currentRank = rank;
  }

  return currentRank.name;
}

function setMessage(title, text) {
  gameMessageTitle.textContent = title;
  gameMessageText.textContent = text;
}

function clearOpponentDisconnectCountdown() 
{
  if (opponentCountdownInterval !== null) 
  {
    clearInterval(opponentCountdownInterval);
    opponentCountdownInterval = null;
  }

  activeOpponentReconnectDeadline = null;
  opponentDisconnectCountdown.hidden = true;
  opponentDisconnectCountdown.classList.remove("is-critical");
}

function updateOpponentDisconnectCountdown(isDisconnected, deadline) 
{
  const numericDeadline = Number(deadline);

  if (!isDisconnected || !Number.isFinite(numericDeadline) 
    || numericDeadline <= 0 || matchFinished) 
  {
    clearOpponentDisconnectCountdown();
    return;
  }

  opponentDisconnectCountdown.hidden = false;

  // Reset the countdown if the server provides a new deadline.
  if (activeOpponentReconnectDeadline !== numericDeadline) {
    if (opponentCountdownInterval !== null) 
    {
      clearInterval(opponentCountdownInterval);
      opponentCountdownInterval = null;
    }
    activeOpponentReconnectDeadline = numericDeadline;
  }

  const updateCountdownValue = () => 
  {
    const secondsRemaining = Math.max(0, Math.ceil( (activeOpponentReconnectDeadline - Date.now()) / 1000, ),
    );

    opponentCountdownValue.textContent = String(secondsRemaining);
    opponentDisconnectCountdown.classList.toggle("is-critical", secondsRemaining <= 10,);

    if (secondsRemaining === 0 && opponentCountdownInterval !== null) {
      clearInterval(opponentCountdownInterval);
      opponentCountdownInterval = null;
    }
  };

  updateCountdownValue();

  if (opponentCountdownInterval === null && Number(opponentCountdownValue.textContent) > 0)
    opponentCountdownInterval = setInterval(updateCountdownValue, 250);
}

function sendMessage(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return true;
  }
  return false;
}

function connectSocket() {
  if (leavingMatch) return;
  if (!matchId) {
    setMessage(
      "No match selected",
      "Return to the lobby and search for a Classic match.",
    );
    gameSubtitle.textContent = "No active match";
    leaveGameButton.textContent = "Return to lobby";
    return;
  }
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  )
    return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}/ws/game`);
  setMessage("Connecting…", "Restoring your secure connection to the match.");

  socket.addEventListener("open", () => {
    reconnectAttempts = 0;
    sendMessage({ type: "resume", matchId });
  });

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      setMessage(
        "Connection message error",
        "The server sent a message that could not be read.",
      );
      return;
    }
    handleServerMessage(message);
  });

  socket.addEventListener("close", (event) => {
    if (leavingMatch || matchFinished) return;
    if (event.code === 1008) {
      window.location.href = "/login.html";
      return;
    }
    setMessage(
      "Connection lost",
      "Attempting to reconnect. Your match is held for a short time.",
    );
    reconnectAttempts += 1;
    if (reconnectAttempts <= 8) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(
        connectSocket,
        Math.min(1000 * reconnectAttempts, 5000),
      );
    } else {
      setMessage(
        "Unable to reconnect",
        "Return to the lobby and start a new search.",
      );
    }
  });

  socket.addEventListener("error", () => {
    setMessage("Connection problem", "Trying to reconnect to the game server…");
  });
}

function handleServerMessage(message) {
  if (message.type === "connected") return;
  if (message.type === "resumed") {
    gameSubtitle.textContent = "Classic match • reconnected";
    return;
  }
  if (message.type === "error") 
  {
    if (matchId && /match could not be found/i.test(message.message || "")) 
    {
      localStorage.removeItem("activeMatchId");
      window.location.replace("/main_page.html");
      return;
    }
    setMessage("Action not completed", message.message || "Please try again.", );
    return;
  }
  if (message.type === "state") {
    gameState = message;
    if (
      Array.isArray(message.myShips) &&
      message.myShips.length === SHIPS.length
    ) {
      localPlacements = message.myShips.map((ship) => ({
        ...ship,
        cells: ship.cells.map((cell) => ({ ...cell })),
      }));
    }
    if (!leavingMatch) renderGame();
    return;
  }
  if (message.type === "gameOver") {
    if (leavingMatch) return;
    const won = message.winnerUserId === gameState?.me?.userId;
    showResult(won, message.reason, message.mmrChange, message.newMmr);
  }
}

function makeCoordinateLabels() {
  document.querySelectorAll(".column-labels").forEach((container) => {
    container.innerHTML = "";
    for (let index = 1; index <= BOARD_SIZE; index += 1) {
      const label = document.createElement("span");
      label.textContent = String(index);
      container.appendChild(label);
    }
  });

  document.querySelectorAll(".row-labels").forEach((container) => {
    container.innerHTML = "";
    for (const letter of ROW_NAMES) {
      const label = document.createElement("span");
      label.textContent = letter;
      container.appendChild(label);
    }
  });
}

function makeBoardCells(container, boardName) {
  container.innerHTML = "";
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "board-cell";
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      cell.dataset.board = boardName;
      cell.setAttribute("aria-label", `${ROW_NAMES[y]}${x + 1}`);
      cell.title = `${ROW_NAMES[y]}${x + 1}`;
      container.appendChild(cell);
    }
  }
}

function keyOf(cell) {
  return `${cell.x},${cell.y}`;
}

function isMeReady() {
  if (!gameState?.match?.players || !gameState?.me) return false;
  return Boolean(
    gameState.match.players.find(
      (player) => player.userId === gameState.me.userId,
    )?.ready,
  );
}

function placementPhaseActive() {
  return Boolean(gameState?.match?.status === "placing" && !isMeReady());
}

function setCellClass(cellElement, className) {
  cellElement.classList.remove(
    "cell-ship",
    "cell-pending",
    "cell-hit",
    "cell-miss",
    "cell-ship-hit",
  );
  if (className) cellElement.classList.add(className);
}

function getPlacementCells(x, y, definition = selectedShipDefinition()) {
  if (!definition) return [];

  return Array.from({ length: definition.length }, (_, offset) => ({
    x: x + (orientation === "horizontal" ? offset : 0),
    y: y + (orientation === "vertical" ? offset : 0),
  }));
}

function canPlaceCells(cells, shipId = selectedShipId) {
  if (
    cells.length === 0 ||
    cells.some(
      (cell) =>
        cell.x < 0 ||
        cell.x >= BOARD_SIZE ||
        cell.y < 0 ||
        cell.y >= BOARD_SIZE,
    )
  )
    return false;

  const occupied = new Set(
    localPlacements
      .filter((ship) => ship.id !== shipId)
      .flatMap((ship) => ship.cells.map(keyOf)),
  );

  return cells.every((cell) => !occupied.has(keyOf(cell)));
}

function renderPlacementPreview() {
  if (!ownShipLayer) return;
  ownShipLayer.querySelector(".ship-preview")?.remove();

  if (!placementPhaseActive() || !previewOrigin) return;
  const definition = selectedShipDefinition();
  const cells = getPlacementCells(previewOrigin.x, previewOrigin.y, definition);
  const valid = canPlaceCells(cells);
  if (!definition || cells.length === 0) return;

  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  const horizontal = orientation === "horizontal";
  const marker = document.createElement("div");
  marker.className = `ship-marker ship-preview${horizontal ? "" : " vertical"}${valid ? "" : " invalid"}`;
  marker.setAttribute("aria-hidden", "true");
  marker.style.left = `calc(${Math.min(...xs) * 10}% + 1.2%)`;
  marker.style.top = `calc(${Math.min(...ys) * 10}% + 1.8%)`;
  marker.style.width = horizontal
    ? `calc(${definition.length * 10}% - 2.4%)`
    : "6.4%";
  marker.style.height = horizontal
    ? "6.4%"
    : `calc(${definition.length * 10}% - 2.4%)`;
  ownShipLayer.appendChild(marker);
}

function renderShipMarkers(ships, incomingHits) {
  if (!ownShipLayer) return;
  ownShipLayer.innerHTML = "";

  for (const ship of ships || []) {
    if (!Array.isArray(ship.cells) || ship.cells.length === 0) continue;
    const xs = ship.cells.map((cell) => cell.x);
    const ys = ship.cells.map((cell) => cell.y);
    const horizontal = ys.every((y) => y === ys[0]);
    const startX = Math.min(...xs);
    const startY = Math.min(...ys);
    const length = ship.cells.length;
    const marker = document.createElement("div");
    marker.className = `ship-marker${horizontal ? "" : " vertical"}`;
    marker.dataset.shipId = ship.id;
    marker.title = `${ship.name} — click to select`;
    marker.draggable = false;
    marker.setAttribute("role", "img");
    marker.setAttribute("aria-label", ship.name);

    if (ship.cells.some((cell) => incomingHits.has(keyOf(cell)))) {
      marker.classList.add("damaged");
    }

    if (horizontal) {
      marker.style.left = `calc(${startX * 10}% + 1.2%)`;
      marker.style.top = `calc(${startY * 10}% + 1.8%)`;
      marker.style.width = `calc(${length * 10}% - 2.4%)`;
      marker.style.height = "6.4%";
    } else {
      marker.style.left = `calc(${startX * 10}% + 1.8%)`;
      marker.style.top = `calc(${startY * 10}% + 1.2%)`;
      marker.style.width = "6.4%";
      marker.style.height = `calc(${length * 10}% - 2.4%)`;
    }
    ownShipLayer.appendChild(marker);
  }
}

function renderOwnBoard() {
  if (!gameState) return;
  const myShips = Array.isArray(gameState.myShips)
    ? gameState.myShips
    : localPlacements;
  const shipCells = new Set(
    (myShips || []).flatMap((ship) => ship.cells.map(keyOf)),
  );
  const incomingHits = new Set(
    (gameState.incomingShots || [])
      .filter((shot) => shot.result === "hit")
      .map(keyOf),
  );
  const incomingMisses = new Set(
    (gameState.incomingShots || [])
      .filter((shot) => shot.result === "miss")
      .map(keyOf),
  );

  ownGrid.querySelectorAll(".board-cell").forEach((cell) => {
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    const key = `${x},${y}`;
    setCellClass(cell, null);

    if (incomingHits.has(key)) {
      cell.classList.add(shipCells.has(key) ? "cell-ship-hit" : "cell-hit");
      cell.textContent = "×";
      cell.setAttribute("aria-label", `${cell.title}: hit`);
    } else if (incomingMisses.has(key)) {
      cell.classList.add("cell-miss");
      cell.textContent = "•";
      cell.setAttribute("aria-label", `${cell.title}: miss`);
    } else if (shipCells.has(key)) {
      cell.classList.add(gameState.myShips ? "cell-ship" : "cell-pending");
      cell.textContent = "";
      cell.setAttribute("aria-label", `${cell.title}: your ship`);
    } else {
      cell.textContent = "";
      cell.setAttribute("aria-label", cell.title);
    }

    const canPlace = placementPhaseActive();
    cell.disabled = !canPlace;
    cell.classList.toggle("placeable", canPlace);
  });

  renderShipMarkers(myShips, incomingHits);
  renderPlacementPreview();
}

function renderTargetBoard() {
  if (!gameState) return;
  const myShots = gameState.myShots || [];
  const shotByCell = new Map(myShots.map((shot) => [keyOf(shot), shot]));
  const isMyTurn =
    gameState.match.status === "battle" &&
    gameState.match.currentTurnUserId === gameState.me.userId;

  targetGrid.querySelectorAll(".board-cell").forEach((cell) => {
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    const shot = shotByCell.get(`${x},${y}`);
    setCellClass(cell, null);
    cell.textContent = "";
    cell.disabled = true;

    if (shot?.result === "hit") {
      cell.classList.add("cell-hit");
      cell.textContent = "×";
      cell.setAttribute("aria-label", `${cell.title}: hit`);
    } else if (shot?.result === "miss") {
      cell.classList.add("cell-miss");
      cell.textContent = "•";
      cell.setAttribute("aria-label", `${cell.title}: miss`);
    } else {
      cell.setAttribute("aria-label", `${cell.title}: untried`);
      cell.disabled = !isMyTurn;
    }
    cell.classList.toggle("targetable", isMyTurn && !shot);
  });
}

function selectedShipDefinition() {
  return SHIPS.find((ship) => ship.id === selectedShipId);
}

function renderShipList() {
  shipList.innerHTML = "";
  const placedIds = new Set(localPlacements.map((ship) => ship.id));
  const locked = !placementPhaseActive();

  SHIPS.forEach((ship) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ship-choice";
    button.dataset.shipId = ship.id;
    button.disabled = locked;
    button.classList.toggle("selected", selectedShipId === ship.id);
    button.classList.toggle("placed", placedIds.has(ship.id));
    button.innerHTML =
      '<span class="ship-choice-name"></span><span class="ship-hull-preview" aria-hidden="true"></span><span class="ship-choice-status"></span>';
    button.querySelector(".ship-choice-name").textContent = ship.name;
    button
      .querySelector(".ship-hull-preview")
      .style.setProperty("--length", String(ship.length));
    button.querySelector(".ship-choice-status").textContent = placedIds.has(
      ship.id,
    )
      ? "Placed"
      : `${ship.length} cells`;
    button.setAttribute("aria-pressed", String(selectedShipId === ship.id));
    shipList.appendChild(button);
  });

  fleetProgress.textContent = `${localPlacements.length} / ${SHIPS.length}`;
  readyFleetButton.disabled = localPlacements.length !== SHIPS.length || locked;
  randomizeFleetButton.disabled = locked;
}

function updateAvatarImage(element, source) {
  const nextSource = source || "/icons/avatar-placeholder.png";
  if (element.dataset.avatarSource === nextSource) return;
  element.dataset.avatarSource = nextSource;
  element.onerror = () => {
    element.onerror = null;
    element.src = "/icons/avatar-placeholder.png";
  };
  element.src = nextSource;
}

function renderGame() 
{
  if (!gameState?.match || !gameState.me || !gameState.opponent) 
    return;
  const match = gameState.match;
  const me = gameState.me;
  const opponent = gameState.opponent;
  const myTurn = match.status === "battle" && match.currentTurnUserId === me.userId;
  const selfStatus = match.players.find((player) => player.userId === me.userId, );
  const otherStatus = match.players.find((player) => player.userId === opponent.userId, );
  ownBoardPanel.classList.toggle("is-my-turn", myTurn && Boolean(otherStatus?.connected), );
  gameSubtitle.textContent = `Classic match • ${match.id.slice(0, 8).toUpperCase()}`;
  myName.textContent = me.username;
  myMmr.textContent = `${me.mmr ?? 0} MMR`;
  myRank.textContent = getRank(me.mmr ?? 0);
  opponentName.textContent = opponent.username;
  opponentMmr.textContent = `${opponent.mmr ?? 0} MMR`;
  opponentRank.textContent = getRank(opponent.mmr ?? 0);
  updateAvatarImage(myAvatar, me.avatarUrl);
  updateAvatarImage(opponentAvatar, opponent.avatarUrl);

  const opponentReady = Boolean(otherStatus?.connected && otherStatus.ready);
  opponentStatus.textContent = otherStatus?.connected
    ? opponentReady
      ? "Fleet ready"
      : "Preparing"
    : "Disconnected";
  opponentStatus.classList.toggle("status-ready", opponentReady);
  opponentStatus.classList.toggle("status-not-ready", !opponentReady);
  opponentStatus.classList.toggle("status-offline", !otherStatus?.connected);
  opponentAvatar.classList.toggle("avatar-offline", !otherStatus?.connected);
  updateOpponentDisconnectCountdown(!otherStatus?.connected && match.status !== "finished", 
    gameState.opponentReconnectDeadline, );

  placementPanel.hidden = !(match.status === "placing" && !selfStatus?.ready);
  battleLayout.hidden = !["placing", "battle", "finished"].includes(
    match.status,
  );

  if (match.status === "placing") {
    if (selfStatus?.ready) {
      setMessage(
        "Fleet submitted",
        otherStatus?.connected
          ? "Your ships are deployed. Waiting for your opponent to finish placing their fleet."
          : "Your opponent is reconnecting. Stay ready.",
      );
    } else {
      setMessage(
        "Deploy your fleet",
        "Select a ship below, then click a cell to place it. Press R to rotate the selected ship.",
      );
    }
  } else if (match.status === "battle") {
    if (!otherStatus?.connected) {
      setMessage(
        "Opponent disconnected",
        `Waiting for ${opponent.username} to reconnect. The match is held temporarily.`,
      );
    } else if (myTurn) {
      setMessage("Your turn", "Choose a cell on the targeting board to fire.");
    } else {
      const lastShot = (gameState.myShots || []).at(-1);
      if (lastShot?.shipSunk) {
        setMessage(
          `${lastShot.shipSunk} sunk!`,
          `You destroyed the enemy ${lastShot.shipSunk}. Now wait for ${opponent.username} to take their turn.`,
        );
      } else if (lastShot?.result === "hit") {
        setMessage(
          "Direct hit!",
          `You hit an enemy ship. Now wait for ${opponent.username} to take their turn.`,
        );
      } else if (lastShot?.result === "miss") {
        setMessage(
          "Shot missed",
          `Your shot landed in open water. Now wait for ${opponent.username}.`,
        );
      } else {
        setMessage(
          "Opponent’s turn",
          `Waiting for ${opponent.username} to fire.`,
        );
      }
    }
    opponentStatus.textContent = otherStatus?.connected
      ? "In battle"
      : "Reconnecting";
  } else if (match.status === "finished") {
    const mmrResult = match.mmrChanges?.[String(me.userId)];
    showResult(
      match.winnerUserId === me.userId,
      match.finishReason,
      mmrResult?.change,
      mmrResult?.newMmr ?? me.mmr,
    );
  }

  renderShipList();
  renderOwnBoard();
  renderTargetBoard();
}

function showResult(won, reason, mmrChange, newMmr) 
{
  matchFinished = true;
  localStorage.removeItem("activeMatchId");
  clearOpponentDisconnectCountdown();
  resultPanel.hidden = false;
  resultPanel.removeAttribute("hidden");
  resultPanel.dataset.visible = "true";
  resultTitle.textContent = won ? "Victory!" : "Defeat";
  resultEmblem.textContent = won ? "✦" : "×";
  resultEmblem.classList.toggle("defeat", !won);

  if (reason === "forfeit") {
    resultText.textContent = won
      ? "Your opponent left the match. The win is yours."
      : "You left the match before it ended.";
  } else if (reason === "disconnect-timeout") {
    resultText.textContent = won
      ? "Your opponent did not reconnect in time. The win is yours."
      : "You did not reconnect in time.";
  } else {
    resultText.textContent = won
      ? "You destroyed the enemy fleet."
      : "Your fleet has been destroyed.";
  }

  const change = Number.isFinite(Number(mmrChange)) ? Number(mmrChange) : 0;
  const changeText = `${change > 0 ? "+" : ""}${change} MMR`;
  resultMmrChange.textContent = changeText;
  resultMmrChange.classList.toggle("negative", change < 0);
  resultNewMmr.textContent = `New MMR: ${Number.isFinite(Number(newMmr)) ? Number(newMmr) : (gameState?.me?.mmr ?? 0)}`;
  gameMessageTitle.textContent = won ? "Battle won" : "Battle lost";
  gameMessageText.textContent = resultText.textContent;

  if (!resultShown) {
    resultShown = true;
    const returnButton = document.getElementById("return-lobby-button");
    if (returnButton) returnButton.focus({ preventScroll: true });
  }
}

function tryPlaceShip(x, y) {
  if (!gameState || !placementPhaseActive()) return;
  const definition = selectedShipDefinition();
  if (!definition) return;

  const cells = getPlacementCells(x, y, definition);
  if (
    cells.some(
      (cell) =>
        cell.x < 0 ||
        cell.x >= BOARD_SIZE ||
        cell.y < 0 ||
        cell.y >= BOARD_SIZE,
    )
  ) {
    setMessage(
      "Not enough space",
      `${definition.name} would extend beyond the board. Try another starting cell or rotate it with R.`,
    );
    return;
  }

  const existingIndex = localPlacements.findIndex(
    (ship) => ship.id === definition.id,
  );
  if (!canPlaceCells(cells, definition.id)) {
    setMessage(
      "Ships overlap",
      "That position overlaps another ship. Choose empty cells.",
    );
    return;
  }

  const newShip = { ...definition, cells };
  if (existingIndex >= 0) localPlacements[existingIndex] = newShip;
  else localPlacements.push(newShip);

  selectedShipId = null;
  previewOrigin = null;
  setMessage(
    existingIndex >= 0 ? "Ship repositioned" : "Ship placed",
    `${definition.name} ${existingIndex >= 0 ? "has been moved" : "is in position"}. Select another ship or drag this hull to adjust it.`,
  );
  renderShipList();
  renderOwnBoard();
}

function selectShip(shipId) {
  const ship = SHIPS.find((entry) => entry.id === shipId);
  if (!ship || !placementPhaseActive()) return;
  selectedShipId = shipId;
  const placed = localPlacements.find((entry) => entry.id === shipId);
  previewOrigin = placed?.cells?.[0] || null;
  if (placed?.cells?.length > 1) {
    orientation = placed.cells.every((cell) => cell.y === placed.cells[0].y)
      ? "horizontal"
      : "vertical";
  }
  renderShipList();
  renderOwnBoard();
}

function pickPlacedShip(shipId, event) {
  if (!placementPhaseActive()) return;
  const index = localPlacements.findIndex((ship) => ship.id === shipId);
  if (index === -1) return;

  const [ship] = localPlacements.splice(index, 1);
  selectedShipId = ship.id;
  orientation = ship.cells.every((cell) => cell.y === ship.cells[0].y)
    ? "horizontal"
    : "vertical";
  previewOrigin =
    boardCoordinatesAt(event.clientX, event.clientY) || ship.cells[0];
  setMessage("Ship selected", `${ship.name} is ready to place again.`);
  renderShipList();
  renderOwnBoard();
}

function rotateSelectedShip() {
  if (!placementPhaseActive()) return;
  const definition = selectedShipDefinition();
  if (!definition) return;

  const existingIndex = localPlacements.findIndex(
    (ship) => ship.id === selectedShipId,
  );
  if (existingIndex === -1) {
    orientation = orientation === "horizontal" ? "vertical" : "horizontal";
    renderShipList();
    renderPlacementPreview();
    setMessage(
      "Ship rotated",
      `The selected ${definition.name.toLowerCase()} will be placed ${orientation}.`,
    );
    return;
  }

  const existing = localPlacements[existingIndex];
  const isHorizontal = existing.cells.every(
    (cell) => cell.y === existing.cells[0].y,
  );
  const nextOrientation = isHorizontal ? "vertical" : "horizontal";
  const anchorX = Math.min(...existing.cells.map((cell) => cell.x));
  const anchorY = Math.min(...existing.cells.map((cell) => cell.y));
  const rotatedCells = Array.from(
    { length: definition.length },
    (_, offset) => ({
      x: anchorX + (nextOrientation === "horizontal" ? offset : 0),
      y: anchorY + (nextOrientation === "vertical" ? offset : 0),
    }),
  );

  if (
    rotatedCells.some((cell) => cell.x >= BOARD_SIZE || cell.y >= BOARD_SIZE)
  ) {
    setMessage(
      "Cannot rotate here",
      "The ship would extend beyond the board. Select another cell, then rotate it.",
    );
    renderShipList();
    return;
  }

  const occupied = new Set(
    localPlacements
      .filter((ship) => ship.id !== definition.id)
      .flatMap((ship) => ship.cells.map(keyOf)),
  );
  if (rotatedCells.some((cell) => occupied.has(keyOf(cell)))) {
    setMessage(
      "Cannot rotate here",
      "The rotated ship would overlap another ship. Move it to an open area first.",
    );
    renderShipList();
    return;
  }

  orientation = nextOrientation;
  localPlacements[existingIndex] = { ...definition, cells: rotatedCells };
  setMessage("Ship rotated", `${definition.name} is now ${orientation}.`);
  renderShipList();
  renderOwnBoard();
}

function randomizeFleet() {
  if (!placementPhaseActive()) return;
  const newFleet = [];
  for (const ship of SHIPS) {
    let placed = false;
    for (let attempt = 0; attempt < 1000 && !placed; attempt += 1) {
      const isHorizontal = Math.random() < 0.5;
      const startX = Math.floor(
        Math.random() *
          (isHorizontal ? BOARD_SIZE - ship.length + 1 : BOARD_SIZE),
      );
      const startY = Math.floor(
        Math.random() *
          (isHorizontal ? BOARD_SIZE : BOARD_SIZE - ship.length + 1),
      );
      const cells = Array.from({ length: ship.length }, (_, offset) => ({
        x: startX + (isHorizontal ? offset : 0),
        y: startY + (isHorizontal ? 0 : offset),
      }));
      const occupied = new Set(
        newFleet.flatMap((entry) => entry.cells.map(keyOf)),
      );
      if (!cells.some((cell) => occupied.has(keyOf(cell)))) {
        newFleet.push({ ...ship, cells });
        placed = true;
      }
    }
    if (!placed) {
      setMessage("Could not randomize fleet", "Please try again.");
      return;
    }
  }
  localPlacements = newFleet;
  selectedShipId = SHIPS[0].id;
  previewOrigin = null;
  const first = localPlacements[0];
  orientation = first.cells.every((cell) => cell.y === first.cells[0].y)
    ? "horizontal"
    : "vertical";
  setMessage(
    "Fleet randomized",
    "Review your fleet, reposition any ship, then select “Ready for battle”.",
  );
  renderShipList();
  renderOwnBoard();
}

function boardCoordinatesAt(clientX, clientY) {
  const rect = ownGrid.getBoundingClientRect();
  const x = Math.floor(((clientX - rect.left) / rect.width) * BOARD_SIZE);
  const y = Math.floor(((clientY - rect.top) / rect.height) * BOARD_SIZE);
  if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return null;
  return { x, y };
}

ownGrid.addEventListener("click", (event) => {
  const marker = event.target.closest(".ship-marker");
  if (marker) {
    if (marker.classList.contains("ship-preview")) return;
    pickPlacedShip(marker.dataset.shipId, event);
    return;
  }
  const cell = event.target.closest(".board-cell");
  if (!cell) return;
  tryPlaceShip(Number(cell.dataset.x), Number(cell.dataset.y));
});

shipList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-ship-id]");
  if (!button || button.disabled) return;
  selectShip(button.dataset.shipId);
});

ownGrid.addEventListener("pointermove", (event) => {
  if (!placementPhaseActive()) return;
  const coords = boardCoordinatesAt(event.clientX, event.clientY);
  if (!coords) return;
  previewOrigin = coords;
  renderPlacementPreview();
});

ownGrid.addEventListener("pointerleave", () => {
  previewOrigin = null;
  renderPlacementPreview();
});

targetGrid.addEventListener("click", (event) => {
  const cell = event.target.closest(".board-cell");
  if (!cell || !gameState || cell.disabled) return;
  const sent = sendMessage({
    type: "fire",
    x: Number(cell.dataset.x),
    y: Number(cell.dataset.y),
  });
  if (sent)
    setMessage("Shot fired", "Waiting for the server to resolve your shot…");
});

randomizeFleetButton.addEventListener("click", randomizeFleet);

document.addEventListener("keydown", (event) => {
  if (
    event.key.toLowerCase() !== "r" ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return;
  const targetTag = event.target?.tagName?.toLowerCase();
  if (
    targetTag === "input" ||
    targetTag === "textarea" ||
    event.target?.isContentEditable
  )
    return;
  if (!placementPhaseActive()) return;
  event.preventDefault();
  rotateSelectedShip();
});

readyFleetButton.addEventListener("click", () => {
  if (localPlacements.length !== SHIPS.length) {
    setMessage("Fleet incomplete", "Place all five ships before readying up.");
    return;
  }
  readyFleetButton.disabled = true;
  if (!sendMessage({ type: "placeFleet", ships: localPlacements })) {
    readyFleetButton.disabled = false;
    setMessage("Not connected", "Please wait while the game reconnects.");
  }
});

leaveGameButton.addEventListener("click", () => 
{
  leavingMatch = true;
  localStorage.removeItem("activeMatchId");
  resultPanel.hidden = true;
  resultPanel.dataset.visible = "false";
  clearTimeout(reconnectTimer);
  if (
    socket &&
    socket.readyState === WebSocket.OPEN &&
    gameState?.match?.status !== "finished"
  ) {
    sendMessage({ type: "forfeit" });
    setTimeout(() => {
      window.location.href = "/main_page.html";
    }, 150);
  } else {
    window.location.href = "/main_page.html";
  }
});

makeCoordinateLabels();
makeBoardCells(ownGrid, "own");
makeBoardCells(targetGrid, "target");
ownShipLayer = document.createElement("div");
ownShipLayer.className = "ship-overlay-layer";
ownShipLayer.setAttribute("aria-hidden", "true");
ownGrid.appendChild(ownShipLayer);
connectSocket();
