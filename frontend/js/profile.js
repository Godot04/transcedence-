const usernameElement = document.getElementById("username");
const emailElement = document.getElementById("email");
const avatarElement = document.getElementById("avatar");
const avatarButton = document.getElementById("avatar-button");
const avatarInput = document.getElementById("avatar-input");
const avatarPlaceholder = document.getElementById("avatar-placeholder");
const infoUsername = document.getElementById("info-username");
const infoEmail = document.getElementById("info-email");
const infoId = document.getElementById("info-id");
const infoOauth = document.getElementById("info-oauth");
const infoCreated = document.getElementById("info-created");
const logoutButton = document.getElementById("logout-button");
const rankElement = document.getElementById("rank-name");
const mmrElement = document.getElementById("mmr");
const mmrModal = document.getElementById("mmr-modal");
const closeMmr = document.getElementById("close-mmr");
const rankList = document.getElementById("rank-list");
const achievementsList = document.getElementById("achievements-list");
const allAchievementsButton = document.getElementById(
  "all-achievements-button",
);
const rankButton = document.getElementById("rank-button");
const profileViewModal = document.getElementById("profile-view-modal");
const profileViewClose = document.getElementById("profile-view-close");
const profileViewAvatarButton = document.getElementById(
  "profile-view-avatar-button",
);
const profileViewDeleteAvatarButton = document.getElementById(
  "profile-view-delete-avatar-button",
);
const profileViewAvatar = document.getElementById("profile-view-avatar");
const profileViewAvatarPlaceholder = document.getElementById(
  "profile-view-avatar-placeholder",
);
const profileViewTitle = document.getElementById("profile-view-title");
const profileViewMmr = document.getElementById("profile-view-mmr");
const profileViewCreated = document.getElementById("profile-view-created");
const profileViewDescription = document.getElementById(
  "profile-view-description",
);
const profileUploadDescriptionButton = document.getElementById(
  "profile-upload-description-button",
);
const profileDeleteDescriptionButton = document.getElementById(
  "profile-delete-description-button",
);
const descriptionInput = document.getElementById("description-input");
const uploadProgress = document.getElementById("upload-progress");
const uploadProgressBar = document.getElementById("upload-progress-bar");
const uploadProgressText = document.getElementById("upload-progress-text");
const profileDescriptionActions = document.getElementById(
  "profile-description-actions",
);
let currentUserId = null;

profileViewClose.addEventListener("click", closeProfileModal);

profileViewModal.addEventListener("click", (event) => {
  if (event.target === profileViewModal) closeProfileModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileViewModal.classList.contains("hidden"))
    closeProfileModal();
});

logoutButton.addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST" });
  } finally {
    window.location.href = "/login.html";
  }
});

async function openProfile(userId, isOwnProfile) {
  try {
    const response = await fetch(`/api/users/${userId}/profile`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load profile");

    const user = data.user;
    const hasDescription = Boolean(user.description);
    profileDescriptionActions.classList.toggle("hidden", !isOwnProfile);
    profileDeleteDescriptionButton.disabled = !hasDescription;
    profileViewAvatarButton.classList.toggle(
      "has-custom-avatar",
      isOwnProfile && avatarButton.classList.contains("has-custom-avatar"),
    );
    profileViewTitle.textContent = user.username || "Unknown User";
    profileViewMmr.textContent = user.mmr ?? 0;
    const createdDate = new Date(user.createdAt);
    const day = String(createdDate.getDate()).padStart(2, "0");
    const month = String(createdDate.getMonth() + 1).padStart(2, "0");
    const year = createdDate.getFullYear();
    profileViewCreated.textContent = `${day}.${month}.${year}`;
    profileViewDescription.textContent =
      user.description || "No description yet.";
    const avatarUrl =
      isOwnProfile && avatarElement.classList.contains("visible")
        ? avatarElement.src
        : user.avatarUrl;

    if (avatarUrl) {
      profileViewAvatar.src = avatarUrl;
      profileViewAvatar.classList.add("visible");
      profileViewAvatarPlaceholder.classList.add("hidden");
    } else {
      profileViewAvatar.removeAttribute("src");
      profileViewAvatar.classList.remove("visible");
      profileViewAvatarPlaceholder.classList.remove("hidden");
    }
    profileViewModal.classList.remove("hidden");
    profileViewModal.setAttribute("aria-hidden", "false");
  } catch (error) {
    console.error("Failed to load profile:", error);
    alert(error.message);
  }
}

function closeProfileModal() {
  profileViewModal.classList.add("hidden");
  profileViewModal.setAttribute("aria-hidden", "true");
}

async function loadProfile() {
  try {
    const response = await fetch("/api/me");

    if (!response.ok) {
      window.location.href = "/login.html";
      return;
    }

    const data = await response.json();
    const user = data.user;
    profileViewAvatarButton.classList.toggle(
      "has-custom-avatar",
      avatarButton.classList.contains("has-custom-avatar"),
    );
    currentUserId = user.id;
    usernameElement.textContent = user.username || "Unknown";
    emailElement.textContent = user.email;
    infoUsername.textContent = user.username || "—";
    infoEmail.textContent = user.email;

    const mmr = user.mmr || 0;
    mmrElement.textContent = `${mmr} MMR`;
    mmrElement.dataset.mmr = mmr;
    rankElement.textContent = getRank(mmr);

    infoId.textContent = user.id;
    infoOauth.textContent = user.oauth42Id ? "Connected" : "Not connected";
    const createdDate = new Date(user.createdAt);
    const day = String(createdDate.getDate()).padStart(2, "0");
    const month = String(createdDate.getMonth() + 1).padStart(2, "0");
    const year = createdDate.getFullYear();
    infoCreated.textContent = `${day}.${month}.${year}`;

    if (user.avatarUrl) {
      avatarElement.src = `${user.avatarUrl}?t=${Date.now()}`;
      avatarElement.classList.add("visible");
      avatarPlaceholder.classList.add("hidden");
      updateAvatarState(user.avatarSource === "custom");
    } else {
      avatarElement.removeAttribute("src");
      avatarElement.classList.remove("visible");
      avatarPlaceholder.classList.remove("hidden");
      updateAvatarState(false);
    }
  } catch (error) {
    console.error("Failed to load profile:", error);
    window.location.href = "/login.html";
  }
}

loadProfile();
