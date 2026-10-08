const allowedTypes = ["image/png", "image/jpeg", "image/webp"];

profileViewAvatarButton.addEventListener("click", (event) => {
  if (event.target.closest("#profile-view-delete-avatar-button")) return;
  avatarInput.click();
});

avatarButton.addEventListener("click", () => {
  if (!currentUserId) return;
  openProfile(currentUserId, true);
});

avatarInput.addEventListener("change", async () => {
  const file = avatarInput.files[0];
  if (!file) return;

  if (!allowedTypes.includes(file.type)) {
    alert("Please select a PNG, JPEG, or WebP image.");
    avatarInput.value = "";
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    alert("Image must be smaller than 2 MB.");
    avatarInput.value = "";
    return;
  }

  try {
    const imageData = await readFileAsDataURL(file);
    showUploadProgress();
    const data = await uploadWithProgress(
      "/api/me/avatar",
      JSON.stringify({ image: imageData }),
      "application/json",
      updateUploadProgress,
    );
    avatarElement.src = `${data.avatarUrl}?t=${Date.now()}`;
    avatarElement.classList.add("visible");
    avatarPlaceholder.classList.add("hidden");
    updateAvatarState(true);
    if (currentUserId) await openProfile(currentUserId, true);
    setTimeout(hideUploadProgress, 500);
  } catch (error) {
    hideUploadProgress();
    console.error("Failed to upload avatar:", error);
    alert(error.message || "Failed to upload profile picture.");
  } finally {
    avatarInput.value = "";
  }
});

profileViewDeleteAvatarButton.addEventListener("click", (event) => {
  event.stopPropagation();
  deleteAvatar();
});

async function deleteAvatar() {
  const confirmed = window.confirm("Delete your profile picture?");
  if (!confirmed) return;
  try {
    const response = await fetch("/api/me/avatar", { method: "DELETE" });
    const type = response.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await response.json() : {};
    if (!response.ok)
      throw new Error(data.error || `Server returned HTTP ${response.status}`);

    if (data.avatarUrl) {
      avatarElement.src = `${data.avatarUrl}?t=${Date.now()}`;
      avatarElement.classList.add("visible");
      avatarPlaceholder.classList.add("hidden");
      updateAvatarState(data.avatarSource === "custom");
    } else {
      avatarElement.removeAttribute("src");
      avatarElement.classList.remove("visible");
      avatarPlaceholder.classList.remove("hidden");
      updateAvatarState(false);
    }

    if (currentUserId) await openProfile(currentUserId, true);
  } catch (error) {
    console.error("Failed to delete avatar:", error);
    alert(error.message || "Failed to delete profile picture.");
  }
}

function updateAvatarState(hasCustomAvatar) {
  avatarButton.classList.toggle("has-custom-avatar", hasCustomAvatar);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}
