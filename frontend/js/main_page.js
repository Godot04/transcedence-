const homeAvatar = document.getElementById("home-avatar");
const homeUsername = document.getElementById("home-username");
const homeMmr = document.getElementById("home-mmr");
const homeRank = document.getElementById("home-rank");
const logoutButton = document.getElementById("logout-button");
const searchStatusBadge = document.getElementById("search-status-badge");
const searchProgress = document.getElementById("search-progress");
const searchProgressTitle = document.getElementById("search-progress-title");
const searchProgressMode = document.getElementById("search-progress-mode");
const searchProgressText = document.getElementById("search-progress-text");
const cancelSearchButton = document.getElementById("cancel-search-button");
const searchButtons = document.querySelectorAll(".search-mode-button");

let currentSearchMode = null;
let lobbySocket = null;

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

async function loadCurrentUser() {
  try {
    const response = await fetch("/api/me");

    if (response.status === 401) {
      window.location.href = "/login.html";
      return;
    }

    const data = await response.json();

    if (!response.ok || !data.user)
      throw new Error(data.error || "Could not load your profile.");

    const user = data.user;
    const mmr = user.mmr ?? 0;

    homeUsername.textContent = user.username || "Captain";
    homeRank.textContent = getRank(mmr);
    homeMmr.textContent = mmr;

    if (user.avatarUrl) {
      homeAvatar.src = `${user.avatarUrl}?t=${Date.now()}`;
    }
  } catch (error) {
    console.error("Failed to load current user:", error);
    homeUsername.textContent = "Captain";
  }
}

function setSearchButtonsDisabled(disabled) {
  searchButtons.forEach((button) => {
    button.disabled = disabled;
  });
}

function setSearchStatus(title, text) {
  searchProgressTitle.textContent = title;
  searchProgressText.textContent = text;
}

function closeLobbySocket() {
  if (!lobbySocket) return;
  lobbySocket.close();
  lobbySocket = null;
}

function connectLobbySocket(mode) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  lobbySocket = new WebSocket(`${protocol}//${window.location.host}/ws/game`);

  lobbySocket.addEventListener("open", () => {
    lobbySocket.send(JSON.stringify({ type: "search", mode }));
  });

  lobbySocket.addEventListener("message", (event) => {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch (error) {
      setSearchStatus(
        "Connection error",
        "The lobby sent an unreadable message.",
      );
      return;
    }

    if (message.type === "searching") {
      setSearchStatus(
        "Searching for an opponent",
        message.message || "Keep this page open while we find an opponent.",
      );
      return;
    }

    if (message.type === "matched") 
    {
      localStorage.setItem("activeMatchId", message.matchId);
      window.location.href = `/game.html?match=${encodeURIComponent(message.matchId)}`;
      return;
    }

    if (message.type === "error") {
      setSearchStatus(
        "Search unavailable",
        message.message || "Please try again.",
      );
      setSearchButtonsDisabled(false);
      currentSearchMode = null;
      closeLobbySocket();
    }
  });

  lobbySocket.addEventListener("close", () => {
    if (currentSearchMode) {
      setSearchStatus("Search stopped", "The lobby connection was closed.");
      setSearchButtonsDisabled(false);
      currentSearchMode = null;
    }
    lobbySocket = null;
  });

  lobbySocket.addEventListener("error", () => {
    setSearchStatus("Connection problem", "Could not connect to matchmaking.");
    setSearchButtonsDisabled(false);
    currentSearchMode = null;
  });
}

function startSearch(mode) {
  currentSearchMode = mode;

  setSearchButtonsDisabled(true);

  if (searchStatusBadge) {
    searchStatusBadge.textContent = "Searching";
    searchStatusBadge.classList.add("searching");
  }

  searchProgress.classList.remove("hidden");
  setSearchStatus(
    "Connecting to matchmaking",
    "Opening a secure lobby connection.",
  );
  searchProgressMode.textContent = mode === "classic" ? "Classic" : "Enhanced";

  connectLobbySocket(mode);
}

function cancelSearch() {
  currentSearchMode = null;

  setSearchButtonsDisabled(false);

  if (searchStatusBadge) {
    searchStatusBadge.textContent = "Ready";
    searchStatusBadge.classList.remove("searching");
  }
  if (lobbySocket?.readyState === WebSocket.OPEN) {
    lobbySocket.send(JSON.stringify({ type: "cancelSearch" }));
  }
  closeLobbySocket();
  searchProgress.classList.add("hidden");
}

searchButtons.forEach((button) => {
  button.addEventListener("click", () => {
    startSearch(button.dataset.mode);
  });
});

cancelSearchButton.addEventListener("click", cancelSearch);

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;

  try {
    await fetch("/api/logout", {
      method: "POST",
    });
  } finally {
    window.location.href = "/login.html";
  }
});

const activeMatchId = localStorage.getItem("activeMatchId");

if (activeMatchId) 
  window.location.replace(`/game.html?match=${encodeURIComponent(activeMatchId)}`, );
else
  loadCurrentUser();
