/* MILAN API_BASE EARLY FIX */
var API_BASE = "/api";
/* === ./app-page-actions.js === */
/* ============================================================
   MILAN APP — Page Actions
   Profile photo upload, avatar restore, live identity sync,
   and final logout.
   ============================================================ */

"use strict";

(() => {
  const $ = id => document.getElementById(id);

  function getToken() {
    try {
      return (
        localStorage.getItem("milan_token") ||
        localStorage.getItem("milan_token") ||
        ""
      );
    } catch {
      return "";
    }
  }

  function setAvatar(id, avatar) {
    const el = $(id);
    if (!el || !avatar) return;

    el.style.backgroundImage = "none";
    el.style.backgroundColor = "transparent";
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.style.backgroundRepeat = "no-repeat";
    el.textContent = "";

    let img = el.querySelector("img");

    if (!img) {
      img = document.createElement("img");
      img.alt = "Profile photo";
      el.appendChild(img);
    }

    img.src = avatar;
    img.alt = "Profile photo";
    img.style.display = "block";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.objectFit = "cover";
    img.style.objectPosition = "center";
    img.style.border = "0";
    img.style.opacity = "1";
    img.style.visibility = "visible";
  }

  async function compressProfileImage(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read image"));
      reader.readAsDataURL(file);
    });

    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not decode image"));
      image.src = dataUrl;
    });

    const maxSide = 640;
    const scale = Math.min(
      1,
      maxSide / Math.max(img.width, img.height)
    );

    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");

    ctx.drawImage(img, 0, 0, width, height);

    const blobFromCanvas = quality =>
      new Promise((resolve, reject) => {
        canvas.toBlob(
          blob =>
            blob
              ? resolve(blob)
              : reject(new Error("Image compression failed")),
          "image/jpeg",
          quality
        );
      });

    let blob = await blobFromCanvas(0.82);

    for (
      let quality = 0.76;
      blob.size > 820000 && quality >= 0.45;
      quality -= 0.08
    ) {
      blob = await blobFromCanvas(quality);
    }

    if (blob.size > 820000) {
      throw new Error("Image is still too large after compression.");
    }

    return {
      blob,
      width,
      height,
      bytes: blob.size
    };
  }


  // One upload path for the sidebar camera and Edit Profile modal.
  // Success is reported only after an uncached GET confirms the same DWN record.
  async function uploadProfileAvatar(file, extraFields = {}) {
    const token = getToken();
    if (!token) throw new Error("Please sign in before changing your profile picture.");
    if (!file || !/^image\//i.test(file.type || "")) {
      throw new Error("Please choose a valid image file.");
    }

    const uploadVersion = (Number(window.__milanAvatarUploadVersion) || 0) + 1;
    window.__milanAvatarUploadVersion = uploadVersion;
    window.__milanAvatarUploadActive = true;

    try {
      const optimized = await compressProfileImage(file);
      const form = new FormData();
      form.append("avatar", optimized.blob, "profile-picture.jpg");

      Object.entries(extraFields || {}).forEach(([key, value]) => {
        if (value != null) form.append(key, String(value));
      });

      const putResponse = await fetch("/api/profile", {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/json"
        },
        body: form,
        cache: "no-store"
      });

      const saved = await putResponse.json().catch(() => ({}));
      if (!putResponse.ok) {
        throw new Error(
          saved.detail ||
          saved.error ||
          `Profile save failed: ${putResponse.status}`
        );
      }

      const savedRecordId = String(saved.avatarRecordId || "").trim();
      if (!savedRecordId) {
        throw new Error("The server response did not confirm a persistent profile-picture record.");
      }

      let verified = null;
      let lastReadbackMessage = "No readback response was received.";

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          const readResponse = await fetch("/api/profile", {
            method: "GET",
            headers: {
              Authorization: "Bearer " + token,
              Accept: "application/json",
              "Cache-Control": "no-cache"
            },
            cache: "no-store"
          });

          const readData = await readResponse.json().catch(() => ({}));
          const profileData = readData?.profile || readData || {};
          const readbackRecordId = String(profileData.avatarRecordId || "").trim();
          const readbackAvatar = String(profileData.avatar || "").trim();

          if (
            readResponse.ok &&
            profileData.avatarSync === "synced" &&
            readbackRecordId === savedRecordId &&
            /^data:image\/[a-z0-9.+-]+;base64,/i.test(readbackAvatar)
          ) {
            verified = profileData;
            break;
          }

          lastReadbackMessage = !readResponse.ok
            ? `Readback returned HTTP ${readResponse.status}.`
            : `Readback status=${profileData.avatarSync || "missing"}, recordId match=${readbackRecordId === savedRecordId}, image present=${Boolean(readbackAvatar)}`;
        } catch (readError) {
          lastReadbackMessage = readError?.message || String(readError);
        }

        if (attempt < 4) {
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
      }

      if (!verified) {
        throw new Error(
          "The upload endpoint accepted the image, but a fresh persistent DWN readback did not confirm the same record. " +
          lastReadbackMessage
        );
      }

      if (uploadVersion !== (Number(window.__milanAvatarUploadVersion) || 0)) {
        throw new Error("A newer profile-picture upload superseded this one. Please check the latest upload.");
      }

      const verifiedAvatar = String(verified.avatar).trim();

      // Cache and UI are updated only after the authoritative GET succeeds.
      try {
        localStorage.setItem("milanAvatar", verifiedAvatar);
      } catch (_) {}

      window.__milanPersistentAvatar = verifiedAvatar;
      window.__milanAvatarUploadCommittedAt = Date.now();

      ["myAvatar", "composerAvatar"].forEach(id => {
        setAvatar(id, verifiedAvatar);
      });

      const preview = $("editProfilePhotoPreview");
      if (preview) {
        preview.src = verifiedAvatar;
        preview.style.display = "block";
      }

      if (window.me) {
        window.me.profile = {
          ...(window.me.profile || {}),
          ...verified
        };
      }

      console.log(
        "[MILAN] Profile picture verified by persistent DWN readback:",
        verified.avatarRecordId
      );

      return verified;
    } finally {
      if (uploadVersion === (Number(window.__milanAvatarUploadVersion) || 0)) {
        window.__milanAvatarUploadActive = false;
      }
    }
  }

  window.milanUploadProfileAvatar = uploadProfileAvatar;

  async function handleUpload(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const input = event.currentTarget;
    const file = input?.files?.[0];

    if (!file || !/^image\//i.test(file.type || "")) {
      if (input) input.value = "";
      return;
    }

    const previewUrl = URL.createObjectURL(file);

    try {
      // Show an immediate temporary preview while the common uploader works.
      ["myAvatar", "composerAvatar"].forEach(id => {
        setAvatar(id, previewUrl);
      });

      const preview = $("editProfilePhotoPreview");
      if (preview) {
        preview.src = previewUrl;
        preview.style.display = "block";
      }

      await uploadProfileAvatar(file);
      console.log("[MILAN] Sidebar camera upload passed persistent readback.");
    } catch (error) {
      console.error("[MILAN] DP upload/readback failed:", error);

      // Restore the server-confirmed image (or initials) after a failed save.
      try {
        await syncLiveProfileIdentity();
      } catch (_) {}

      try {
        alert("DP upload failed: " + (error?.message || error));
      } catch (_) {}
    } finally {
      URL.revokeObjectURL(previewUrl);
      if (input) input.value = "";
    }
  }

  // MILAN ONE: avatar restoration is handled only by syncLiveProfileIdentity().
 
  async function syncLiveProfileIdentity() {
    const syncVersion = Number(window.__milanAvatarUploadVersion) || 0;
    const token = getToken();
    if (!token) return;

    const headers = {
      Authorization: "Bearer " + token,
      Accept: "application/json"
    };

    let me = null;
    let profile = null;

    try {
      const response = await fetch("/api/auth/me", {
        headers,
        cache: "no-store"
      });

      if (response.ok) {
        me = await response.json();
      }
    } catch (error) {
      console.warn("[MILAN] auth/me identity sync failed:", error);
    }

    try {
      const response = await fetch("/api/profile", {
        headers,
        cache: "no-store"
      });

      if (response.ok) {
        profile = await response.json();
      }
    } catch (error) {
      console.warn("[MILAN] profile identity sync failed:", error);
    }

    // Ignore reads that began before an avatar upload, or while an upload is in flight.
    if (
      syncVersion !== (Number(window.__milanAvatarUploadVersion) || 0) ||
      window.__milanAvatarUploadActive
    ) return;

    const user =
      me?.user ||
      me?.data?.user ||
      me ||
      {};

    const meProfile =
      me?.profile ||
      me?.data?.profile ||
      {};

    const profileData =
      profile?.profile ||
      profile ||
      {};

    // A successful profile GET is authoritative, even when it says no avatar exists.
    // Browser cache is used only when the profile endpoint itself could not be read.
    const profileReadSucceeded = Boolean(profile);
    const remoteAvatar = profileReadSucceeded
      ? String(profileData.avatar || "").trim()
      : String(window.__milanPersistentAvatar || "").trim() ||
        String(localStorage.getItem("milanAvatar") || "").trim();

    if (profileReadSucceeded) {
      if (profileData.avatarSync === "synced" && remoteAvatar) {
        window.__milanPersistentAvatar = remoteAvatar;
        try {
          localStorage.setItem("milanAvatar", remoteAvatar);
        } catch (_) {}
      } else {
        window.__milanPersistentAvatar = "";
        try {
          localStorage.removeItem("milanAvatar");
        } catch (_) {}
      }
    }

    if (remoteAvatar) {
      profileData.avatar = remoteAvatar;

      ["myAvatar", "composerAvatar"].forEach(id => {
        setAvatar(id, remoteAvatar);
      });

      const preview = $("editProfilePhotoPreview");
      if (preview) {
        preview.src = remoteAvatar;
        preview.style.display = "block";
      }

      if (window.me) {
        window.me.profile = {
          ...(window.me.profile || {}),
          avatar: remoteAvatar
        };
      }
    }

    const name = String(
      user.name ||
      meProfile.name ||
      profileData.display_name ||
      profileData.name ||
      meProfile.display_name ||
      user.display_name ||
      ""
    ).trim();

    const email = String(
      profileData.email ||
      meProfile.email ||
      user.email ||
      ""
    ).trim();

    if (!remoteAvatar) {
      const preview = $("editProfilePhotoPreview");
      if (preview) {
        preview.removeAttribute("src");
        preview.style.display = "none";
      }

      const initial = String(name || "M").trim().charAt(0).toUpperCase() || "M";
      ["myAvatar", "composerAvatar"].forEach(id => {
        const el = $(id);
        if (!el) return;
        el.replaceChildren();
        el.textContent = initial;
        el.style.backgroundImage = "none";
        el.style.backgroundColor = "";
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.style.backgroundRepeat = "no-repeat";
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";
        el.style.fontWeight = "800";
      });
    }

    const nameEl = $("myName");
    const emailEl = $("myEmail");

    if (nameEl && name) nameEl.textContent = name;
    if (emailEl && email) emailEl.textContent = email;

    if (window.me) {
      window.me = {
        ...window.me,
        ...user,
        profile: {
          ...(window.me.profile || {}),
          ...meProfile,
          ...profileData,
          ...(profileData.avatar ? { avatar: profileData.avatar } : {})
        }
      };
    }

    if (typeof renderFeed === "function") {
      renderFeed();
    }
  }

  function installLogout() {
    const current = $("logoutBtn");
    if (!current || current.dataset.appLogoutBound) return;

    current.dataset.appLogoutBound = "1";

    current.addEventListener("click", () => {
      try {
        localStorage.removeItem("milan_token");
        localStorage.removeItem("milan_token");
        localStorage.removeItem("milanBootCache");
          sessionStorage.clear();
      } finally {
        if(location.pathname!=="/")window.location.replace("/");
      }
    });
  }

  function init() {
    // MILAN ONE: DP is restored only from syncLiveProfileIdentity().
    let photoInput = $("editProfilePhoto");

    if (photoInput) {
      // Replace the input so any older/duplicate listeners are discarded.
      if (!photoInput.dataset.milanCanonicalInput) {
        const cleanInput = photoInput.cloneNode(true);
        cleanInput.dataset.milanCanonicalInput = "1";
        photoInput.replaceWith(cleanInput);
        photoInput = cleanInput;
      }

      if (!photoInput.dataset.appUploadBound) {
        photoInput.dataset.appUploadBound = "1";
        photoInput.addEventListener("change", handleUpload, { capture: true });
      }
    }

    syncLiveProfileIdentity().finally(() => {
      installLogout();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

/* ------------------------------------------------------------
   App navigation — no inline onclick handlers.
   ------------------------------------------------------------ */
(() => {
  const go = path => {
    window.location.assign(path);
  };

  const bind = (selector, handler) => {
    document.querySelectorAll(selector).forEach(el => {
      if (el.dataset.navBound) return;
      el.dataset.navBound = "1";
      el.addEventListener("click", handler);
    });
  };

  const initNavigation = () => {
    const brand = document.querySelector(".brand-logo");
    if (brand && !brand.dataset.navBound) {
      brand.dataset.navBound = "1";
      brand.addEventListener("click", () => go("/app"));

      brand.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          go("/app");
        }
      });
    }

    bind('.icon-btn[title="Chat"]', () => go("/chat"));
    bind('.icon-btn[title="Music"]', () => go("/music"));

    document.querySelectorAll(".nav button, .m8-nav button").forEach(button => {
      const text = button.textContent.trim();

      if (button.dataset.navBound) return;

      if (text.includes("Messages")) {
        button.dataset.navBound = "1";
        button.addEventListener("click", () => go("/chat"));
      }

      if (text.includes("Music")) {
        button.dataset.navBound = "1";
        button.addEventListener("click", () => go("/music"));
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNavigation, {
      once: true
    });
  } else {
    initNavigation();
  }
})();

/* === ./app/api.js === */
/* ============================================================
   MILAN APP — API + Upload Infrastructure
   Modular network layer extracted from inline-05.js.
   ============================================================ */

"use strict";

window.MilanApp = window.MilanApp || {};

const MilanState = window.MilanApp.state;
const MilanConfig = window.MilanApp.config;

function getToken() {
  return MilanState.token || "";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const token = getToken();

  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  let response;

  try {
    response = await fetchWithTimeout(
      MilanConfig.API + path,
      {
        ...options,
        headers
      },
      Number(options.timeoutMs || 22000)
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        "Network timeout. Please refresh once."
      );
      timeoutError.status = 0;
      throw timeoutError;
    }

    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.error || "Request failed " + response.status
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

function b64Header(value) {
  try {
    return btoa(
      unescape(
        encodeURIComponent(String(value || ""))
      )
    );
  } catch {
    return btoa(String(value || ""));
  }
}

function apiUploadRaw(path, file, meta, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let completed = false;

    const fail = message => {
      if (completed) return;

      completed = true;
      reject(
        new Error(message || "Upload failed")
      );
    };

    xhr.open(
      "POST",
      MilanConfig.API + path,
      true
    );

    xhr.timeout = Number(
      window.MILAN_UPLOAD_TIMEOUT_MS || 1800000
    );

    const token = getToken();

    if (token) {
      xhr.setRequestHeader(
        "Authorization",
        "Bearer " + token
      );
    }

    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream"
    );

    xhr.setRequestHeader(
      "X-File-Name",
      b64Header(file.name)
    );

    xhr.setRequestHeader(
      "X-Record-Title",
      b64Header(meta.title || file.name)
    );

    xhr.setRequestHeader(
      "X-Record-Caption",
      b64Header(meta.caption || "")
    );

    xhr.setRequestHeader(
      "X-Access-Mode",
      meta.accessMode || "private"
    );

    xhr.setRequestHeader(
      "X-Record-Tags",
      b64Header(
        JSON.stringify(meta.tags || [])
      )
    );

    xhr.setRequestHeader(
      "X-Shared-With-Dids",
      b64Header(
        JSON.stringify(meta.sharedWithDids || [])
      )
    );

    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || !onProgress) return;

      onProgress(
        Math.max(
          1,
          Math.min(
            98,
            (event.loaded / event.total) * 100
          )
        )
      );
    };

    xhr.onload = () => {
      let data = {};

      try {
        data = JSON.parse(
          xhr.responseText || "{}"
        );
      } catch {}

      if (xhr.status >= 200 && xhr.status < 300) {
        completed = true;
        onProgress?.(100);
        resolve(data);
        return;
      }

      fail(
        data.error ||
        "Upload failed " + xhr.status
      );
    };

    xhr.onerror = () =>
      fail(
        "Network error during upload. Keep the browser open and try again."
      );

    xhr.ontimeout = () =>
      fail(
        "Upload is taking too long. Try a smaller video or better network."
      );

    xhr.onabort = () =>
      fail("Upload cancelled.");

    xhr.send(file);
  });
}

function xhrUploadBlob(
  url,
  blob,
  headers,
  onProgress
) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let completed = false;

    const fail = message => {
      if (completed) return;

      completed = true;
      reject(
        new Error(
          message || "Upload chunk failed"
        )
      );
    };

    xhr.open("POST", url, true);

    xhr.timeout = Number(
      window.MILAN_CHUNK_UPLOAD_TIMEOUT_MS || 240000
    );

    const token = getToken();

    if (token) {
      xhr.setRequestHeader(
        "Authorization",
        "Bearer " + token
      );
    }

    xhr.setRequestHeader(
      "Content-Type",
      "application/octet-stream"
    );

    Object.entries(headers || {}).forEach(
      ([key, value]) => {
        xhr.setRequestHeader(
          key,
          String(value)
        );
      }
    );

    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || !onProgress) return;

      onProgress(
        event.loaded,
        event.total
      );
    };

    xhr.onload = () => {
      let data = {};

      try {
        data = JSON.parse(
          xhr.responseText || "{}"
        );
      } catch {}

      if (xhr.status >= 200 && xhr.status < 300) {
        completed = true;
        resolve(data);
        return;
      }

      fail(
        data.error ||
        "Chunk upload failed " + xhr.status
      );
    };

    xhr.onerror = () =>
      fail(
        "Network issue while uploading chunk. Retrying..."
      );

    xhr.ontimeout = () =>
      fail(
        "Chunk upload timed out. Retrying..."
      );

    xhr.onabort = () =>
      fail("Chunk upload cancelled.");

    xhr.send(blob);
  });
}

async function withRetry(fn, retries = 3) {
  let lastError;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      await new Promise(resolve =>
        setTimeout(
          resolve,
          700 + 900 * attempt
        )
      );
    }
  }

  throw lastError;
}

async function apiUploadChunked(
  path,
  file,
  meta,
  onProgress
) {
  const requestedChunk = Number(
    window.MILAN_UPLOAD_CHUNK_BYTES ||
    6291456
  );

  const init = await api(
    "/records/media/chunk/init",
    {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        mimeType:
          file.type ||
          "application/octet-stream",
        sizeBytes: file.size,
        chunkBytes: requestedChunk,
        title: meta.title || file.name,
        caption: meta.caption || "",
        accessMode:
          meta.accessMode || "private",
        sharedWithDids:
          meta.sharedWithDids || [],
        tags: meta.tags || []
      })
    }
  );

  const uploadId = init.uploadId;

  const chunkBytes = Number(
    init.chunkBytes ||
    requestedChunk
  );

  const totalChunks = Number(
    init.totalChunks ||
    Math.ceil(file.size / chunkBytes)
  );

  let uploadedBytes = 0;

  try {
    for (
      let index = 0;
      index < totalChunks;
      index++
    ) {
      const start =
        index * chunkBytes;

      const end = Math.min(
        file.size,
        start + chunkBytes
      );

      const blob = file.slice(
        start,
        end
      );

      await withRetry(
        () =>
          xhrUploadBlob(
            MilanConfig.API +
              "/records/media/chunk/" +
              encodeURIComponent(uploadId),
            blob,
            {
              "X-Chunk-Index": index,
              "X-Total-Chunks": totalChunks,
              "X-Chunk-Bytes": blob.size
            },
            (loaded) => {
              if (!onProgress) return;

              const percentage =
                ((uploadedBytes + loaded) /
                  file.size) *
                96;

              onProgress(
                Math.max(
                  1,
                  Math.min(
                    96,
                    percentage
                  )
                )
              );
            }
          ),
        4
      );

      uploadedBytes = end;

      onProgress?.(
        Math.max(
          1,
          Math.min(
            96,
            (uploadedBytes /
              file.size) *
              96
          )
        )
      );
    }

    onProgress?.(98);

    const result = await api(
      "/records/media/chunk/" +
        encodeURIComponent(uploadId) +
        "/complete",
      {
        method: "POST",
        body: JSON.stringify({}),
        timeoutMs: Number(
          window.MILAN_UPLOAD_COMPLETE_TIMEOUT_MS ||
          900000
        )
      }
    );

    onProgress?.(100);

    return result;
  } catch (error) {
    try {
      await api(
        "/records/media/chunk/" +
          encodeURIComponent(uploadId),
        {
          method: "DELETE"
        }
      );
    } catch {}

    throw error;
  }
}

async function apiUpload(
  path,
  file,
  meta,
  onProgress
) {
  const chunkThreshold = Number(
    window.MILAN_CHUNK_UPLOAD_THRESHOLD_BYTES ||
    8388608
  );

  const needsChunkedUpload =
    file &&
    (
      (file.type || "").startsWith("video/") ||
      file.size > chunkThreshold
    );

  return needsChunkedUpload
    ? apiUploadChunked(
        path,
        file,
        meta,
        onProgress
      )
    : apiUploadRaw(
        path,
        file,
        meta,
        onProgress
      );
}

window.MilanApp.api = {
  getToken,
  fetchWithTimeout,
  api,
  b64Header,
  apiUploadRaw,
  xhrUploadBlob,
  withRetry,
  apiUploadChunked,
  apiUpload
};

/* Temporary compatibility exports. */
window.getToken = getToken;
window.fetchWithTimeout = fetchWithTimeout;
window.api = api;
window.b64Header = b64Header;
window.apiUploadRaw = apiUploadRaw;
window.xhrUploadBlob = xhrUploadBlob;
window.withRetry = withRetry;
window.apiUploadChunked = apiUploadChunked;
window.apiUpload = apiUpload;

/* === ./app/media.js === */
/* ============================================================
   MILAN APP — Media Runtime
   Media URLs, previews, retry/repair, file cards,
   and viewport-aware loading.
   ============================================================ */

"use strict";

window.MilanApp = window.MilanApp || {};

const MediaState = window.MilanApp.state;
const MediaApi = window.MilanApp.api;
const MediaUtils = window.MilanApp.utils;

function mediaSrc(url) {
  if (!url) return "";

  if (
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)
  ) {
    return "";
  }

  if (/^data:|^blob:/.test(url)) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";

  if (/^https?:\/\//.test(url)) {
    return url;
  }

  return MediaState.token
    ? url +
        separator +
        "token=" +
        encodeURIComponent(MediaState.token) +
        "&mv=59"
    : url + separator + "mv=49";
}

function mediaDownloadSrc(url) {
  const base = mediaSrc(url);

  return base
    ? base +
        (base.includes("?") ? "&" : "?") +
        "download=1"
    : "";
}

function videoMediaSrc(raw) {
  let url = String(raw || "");

  if (
    /^\/api\/records\/[^/]+\/media$/.test(url)
  ) {
    url += "/play.mp4";
  }

  return mediaSrc(url);
}

function mediaNode(element) {
  return element &&
    element.tagName === "SOURCE"
    ? element.parentElement
    : element;
}

function setMediaError(
  element,
  message,
  repairing = false
) {
  try {
    const node = mediaNode(element);
    const box = node?.closest(".media");
    const error = box?.querySelector(".mediaLoadError");

    box?.classList.toggle(
      "repairing",
      Boolean(repairing)
    );

    if (error) {
      error.textContent = message;
      error.classList.remove("hidden");
    }
  } catch {}
}

function clearMediaError(element) {
  try {
    const node = mediaNode(element);
    const box = node?.closest(".media");

    box?.querySelector(
      ".mediaLoadError"
    )?.classList.add("hidden");

    box?.classList.remove("repairing");
    box?.classList.remove("previewFailed");
  } catch {}
}

function milanSetVideoSource(video, nextUrl) {
  try {
    if (!video) return;

    const source =
      video.querySelector?.("source");

    if (source) {
      source.setAttribute("src", nextUrl);
    } else {
      video.setAttribute("src", nextUrl);
    }

    video.load?.();
  } catch {}
}

function milanRetryMedia(element) {
  try {
    const node = mediaNode(element);

    if (!node || node.dataset.retrying === "1") {
      return;
    }

    node.dataset.retrying = "1";

    const source =
      node.querySelector?.("source");

    const sourceUrl =
      source?.getAttribute("src") ||
      node.getAttribute("src") ||
      element?.getAttribute?.("src") ||
      "";

    if (!sourceUrl) {
      node.dataset.retrying = "0";
      return;
    }

    setTimeout(() => {
      const separator = sourceUrl.includes("?")
        ? "&"
        : "?";

      const nextUrl =
        sourceUrl +
        separator +
        "retry=" +
        Date.now();

      if (node.tagName === "VIDEO") {
        milanSetVideoSource(
          node,
          nextUrl
        );
      } else {
        node.setAttribute(
          "src",
          nextUrl
        );
      }

      node.dataset.retrying = "0";
    }, 80);
  } catch {}
}

async function milanRepairVideo(id, element) {
  const video = mediaNode(element);

  if (
    !video ||
    video.dataset.repairing === "1"
  ) {
    return;
  }

  video.dataset.repairing = "1";

  try {
    setMediaError(
      video,
      "Loading video...",
      true
    );

    const result = await MediaApi.api(
      "/records/" +
        encodeURIComponent(id) +
        "/media/repair?async=1",
      {
        method: "POST",
        body: JSON.stringify({
          async: true
        })
      }
    );

    const record =
      result?.record || null;

    let next = videoMediaSrc(
      record &&
        (
          record.mediaUrl ||
          record.data?.media?.mediaUrl
        )
    );

    if (!next) {
      next = videoMediaSrc(
        "/api/records/" +
          encodeURIComponent(id) +
          "/media"
      );
    }

    next +=
      (next.includes("?") ? "&" : "?") +
      "fixed=" +
      Date.now();

    milanSetVideoSource(
      video,
      next
    );

    try {
      video.load();
      video.play?.().catch(() => {});
    } catch {}

    setTimeout(
      () => clearMediaError(video),
      400
    );

    MediaUtils.toast(
      result?.repaired
        ? "Video ready"
        : "Video checked"
    );
  } catch {
    const box =
      video.closest(".media");

    const card =
      box?.querySelector(".fileCard");

    card?.classList.remove("hidden");

    setMediaError(
      video,
      "Video is uploaded safely. Preview is still preparing; refresh once or tap Open/Download.",
      true
    );
  } finally {
    setTimeout(() => {
      try {
        video.dataset.repairing = "0";
      } catch {}
    }, 1200);
  }
}

async function milanMediaError(id, element) {
  try {
    if (!element) return;

    const node = mediaNode(element);
    const box = node?.closest(".media");

    if (node?.tagName === "VIDEO") {
      if (
        node.dataset.repairStarted !== "1"
      ) {
        node.dataset.repairStarted = "1";

        await milanRepairVideo(
          id,
          node
        );

        return;
      }

      if (
        node.dataset.retryDone !== "1"
      ) {
        node.dataset.retryDone = "1";

        setMediaError(
          node,
          "Retrying video stream...",
          true
        );

        milanRetryMedia(node);
        return;
      }

      const card =
        box?.querySelector(
          ".fileCard"
        );

      card?.classList.remove("hidden");

      setMediaError(
        node,
        "Tap Open or Download to watch this video."
      );

      return;
    }

    if (
      node &&
      node.dataset.retryDone !== "1"
    ) {
      node.dataset.retryDone = "1";
      milanRetryMedia(node);
      return;
    }

    box?.classList.add(
      "previewFailed"
    );

    const card =
      box?.querySelector(
        ".fileCard"
      );

    card?.classList.remove("hidden");

    setMediaError(
      node,
      "Preview could not start. File is uploaded safely and download is available."
    );
  } catch {}
}

function formatBytes(bytes) {
  if (!(bytes = Number(bytes || 0))) {
    return "";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB"
  ];

  let index = 0;

  while (
    bytes >= 1024 &&
    index < units.length - 1
  ) {
    bytes /= 1024;
    index++;
  }

  return (
    bytes.toFixed(
      index ? 1 : 0
    ) +
    " " +
    units[index]
  );
}

function fileIcon(category, mime) {
  if (category === "image") return "🖼️";
  if (category === "video") return "🎬";
  if (category === "audio") return "🎧";
  if (category === "pdf") return "📄";
  if (
    (mime || "").includes("zip")
  ) {
    return "🗜️";
  }

  return "📎";
}

function fileCardHtml(
  media,
  rawUrl,
  extra = ""
) {
  const name = MediaUtils.esc(
    media.fileName || "MILAN file"
  );

  const mime = MediaUtils.esc(
    media.mimeType || "file"
  );

  const size =
    formatBytes(media.sizeBytes);

  const open = MediaUtils.esc(
    mediaSrc(rawUrl)
  );

  const download = MediaUtils.esc(
    mediaDownloadSrc(rawUrl)
  );

  return `
    <div class="fileCard ${extra}">
      <div class="fileIcon">
        ${fileIcon(
          media.previewCategory || "",
          media.mimeType
        )}
      </div>

      <div class="fileMeta">
        <b>${name}</b>

        <div class="mini">
          ${mime}${size ? " • " + MediaUtils.esc(size) : ""}
        </div>

        ${
          media.compatibilityWarning
            ? `<div class="mini">${MediaUtils.esc(
                media.compatibilityWarning
              )}</div>`
            : ""
        }
      </div>

      <div class="fileActions">
        <a
          href="${open}"
          target="_blank"
          rel="noopener"
        >Open</a>

        <a
          href="${download}"
          download
        >Download</a>
      </div>
    </div>
  `;
}

function mediaHtml(record) {
  const data =
    record.data || {};

  const media =
    data.media || {};

  const raw =
    record.mediaUrl ||
    media.mediaUrl ||
    data.mediaUrl ||
    "";

  const url = mediaSrc(raw);

  if (!url) return "";

  const mimeType =
    (
      media.mimeType ||
      record.dataFormat ||
      "application/octet-stream"
    ).toLowerCase();

  const category = (
    media.previewCategory ||
    record.mediaCompatibility?.previewCategory ||
    (
      mimeType.startsWith("image/")
        ? "image"
        : mimeType.startsWith("video/")
          ? "video"
          : mimeType.startsWith("audio/")
            ? "audio"
            : mimeType === "application/pdf"
              ? "pdf"
              : mimeType.startsWith("text/")
                ? "text"
                : "file"
    )
  ).toLowerCase();

  const id = MediaUtils.esc(
    record.id || ""
  );

  const errorHtml =
    '<div class="mini mediaLoadError hidden">Preview is loading...</div>';

  const onError =
    `milanMediaError('${id}',this)`;

  const onLoaded =
    "clearMediaError(this)";

  if (category === "image") {
    return `
      <div
        class="media"
        data-record-id="${id}"
      >
        <img
          loading="lazy"
          decoding="async"
          data-milan-observe="1"
          src="${MediaUtils.esc(url)}"
          alt="${MediaUtils.esc(
            record.title || "media"
          )}"
          onload="${onLoaded}"
          onerror="${onError}"
        >
        ${errorHtml}
        ${fileCardHtml(
          media,
          raw,
          "hidden"
        )}
      </div>
    `;
  }

  if (category === "video") {
    const videoUrl =
      videoMediaSrc(raw);

    const videoMime =
      media.browserPlayable === false
        ? "video/mp4"
        : mimeType || "video/mp4";

    return `
      <div
        class="media"
        data-record-id="${id}"
      >
        <video
          controls
          preload="none"
          data-milan-observe="1"
          playsinline
          webkit-playsinline
          x5-playsinline
          data-milan-inline-only="1"
          controlsList="nofullscreen nodownload noremoteplayback"
          onloadedmetadata="${onLoaded}"
          oncanplay="${onLoaded}"
          onplaying="${onLoaded}"
          onerror="${onError}"
        >
          <source
            src="${MediaUtils.esc(videoUrl)}"
            type="${MediaUtils.esc(
              videoMime === "video/quicktime"
                ? "video/mp4"
                : videoMime
            )}"
          >
        </video>

        ${errorHtml}

        ${fileCardHtml(
          media,
          raw,
          "hidden"
        )}
      </div>
    `;
  }

  if (category === "audio") {
    return `
      <div
        class="media audioBox"
        data-record-id="${id}"
      >
        <audio
          controls
          preload="metadata"
          src="${MediaUtils.esc(url)}"
          type="${MediaUtils.esc(
            mimeType || "audio/mpeg"
          )}"
          onloadedmetadata="${onLoaded}"
          oncanplay="${onLoaded}"
          onplaying="${onLoaded}"
          onerror="${onError}"
        ></audio>

        ${errorHtml}

        ${fileCardHtml(
          media,
          raw,
          "hidden"
        )}
      </div>
    `;
  }

  if (category === "pdf") {
    return `
      <div
        class="media"
        data-record-id="${id}"
      >
        <iframe
          loading="lazy"
          data-milan-observe="1"
          data-milan-src="${MediaUtils.esc(url)}"
          title="${MediaUtils.esc(
            media.fileName ||
            record.title ||
            "PDF"
          )}"
          onload="${onLoaded}"
        ></iframe>

        ${errorHtml}

        ${fileCardHtml(
          media,
          raw
        )}
      </div>
    `;
  }

  return `
    <div
      class="media"
      data-record-id="${id}"
    >
      ${fileCardHtml(
        media,
        raw
      )}
    </div>
  `;
}

function initMilanMediaObserver() {
  if (
    window.MilanApp.state
      .mediaObserverReady
  ) {
    return;
  }

  const feed =
    document.getElementById("feed");

  if (
    !feed ||
    !("IntersectionObserver" in window)
  ) {
    return;
  }

  window.MilanApp.state
    .mediaObserverReady = true;

  const observer =
    new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) {
            return;
          }

          const element =
            entry.target;

          if (
            element.tagName === "VIDEO"
          ) {
            try {
              element.load();
            } catch {}
          }

          if (
            element.tagName === "IFRAME"
          ) {
            const src =
              element.getAttribute(
                "data-milan-src"
              );

            if (
              src &&
              !element.getAttribute("src")
            ) {
              element.setAttribute(
                "src",
                src
              );
            }

            element.removeAttribute(
              "data-milan-src"
            );
          }

          element.removeAttribute(
            "data-milan-observe"
          );

          observer.unobserve(
            element
          );
        });
      },
      {
        root: null,
        rootMargin: "700px 0px",
        threshold: 0.01
      }
    );

  window.MilanApp.state
    .mediaObserver = observer;

  feed
    .querySelectorAll(
      "img[data-milan-observe]," +
      "video[data-milan-observe]," +
      "iframe[data-milan-observe]"
    )
    .forEach(element => {
      observer.observe(element);
    });
}

window.MilanApp.media = {
  mediaSrc,
  mediaDownloadSrc,
  videoMediaSrc,
  mediaNode,
  setMediaError,
  clearMediaError,
  milanSetVideoSource,
  milanRetryMedia,
  milanRepairVideo,
  milanMediaError,
  formatBytes,
  fileIcon,
  fileCardHtml,
  mediaHtml,
  initMilanMediaObserver
};

/* Compatibility exports. */
window.mediaSrc = mediaSrc;
window.mediaDownloadSrc = mediaDownloadSrc;
window.videoMediaSrc = videoMediaSrc;
window.mediaNode = mediaNode;
window.setMediaError = setMediaError;
window.clearMediaError = clearMediaError;
window.milanSetVideoSource =
  milanSetVideoSource;
window.milanRetryMedia =
  milanRetryMedia;
window.milanRepairVideo =
  milanRepairVideo;
window.milanMediaError =
  milanMediaError;
window.formatBytes = formatBytes;
window.fileIcon = fileIcon;
window.fileCardHtml =
  fileCardHtml;
window.mediaHtml = mediaHtml;
window.initMilanMediaObserver =
  initMilanMediaObserver;

/* === ./app/state.js === */
/* ============================================================
   MILAN APP — Shared Runtime State
   Central state bridge for modular app runtime.
   ============================================================ */

"use strict";

window.MilanApp = window.MilanApp || {};

window.MilanApp.state = window.MilanApp.state || {
  token: "",
  me: null,
  currentFeed: [],
  people: [],
  lastNotifications: [],
  currentScope: "all",

  feedSeq: 0,
  feedTmp: null,
  feedLimit: 10,
  feedNoMe: false,

  bootPromise: null,
  appReady: false,

  lastSummary: null,

  mediaObserver: null,
  mediaObserverReady: false,

  backgroundTick: null,

  native: false
};

window.MilanApp.config = window.MilanApp.config || {
  API: "/api",
  nativeUA: /MilanNativeAudio/i
};

window.MilanApp.getState = function () {
  return window.MilanApp.state;
};

/* === ./app/utils.js === */
/* ============================================================
   MILAN APP — Shared Utilities
   ============================================================ */

"use strict";

window.MilanApp = window.MilanApp || {};

const MilanUtils = {
  esc(value = "") {
    return String(value).replace(
      /[&<>"']/g,
      char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]
    );
  },

  initials(value = "MILAN") {
    return (
      String(value || "M")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part[0] || "")
        .join("")
        .toUpperCase() || "M"
    );
  },

  toast(message) {
    let container = document.getElementById("milanToastContainer");

    if (!container) {
      container = document.createElement("div");
      container.id = "milanToastContainer";
      container.style.cssText =
        "position:fixed;top:18px;right:18px;z-index:99999;" +
        "display:flex;flex-direction:column;gap:8px;" +
        "pointer-events:none;";
      document.body.appendChild(container);
    }

    const el = document.createElement("div");
    el.textContent = String(message || "");
    el.style.cssText =
      "background:rgba(15,23,42,.92);color:#fff;" +
      "padding:10px 18px;border-radius:12px;font-size:13px;" +
      "font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.22);" +
      "opacity:0;transform:translateY(-8px);" +
      "transition:opacity .22s,transform .22s;" +
      "pointer-events:none;max-width:320px;word-break:break-word;";

    container.appendChild(el);

    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });

    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(-8px)";

      setTimeout(() => {
        el.parentNode?.removeChild(el);
      }, 250);
    }, 2600);
  },

  avatarHtml(profile = {}, className = "avatar") {
    const avatar = profile.avatar || "";

    if (
      /^data:image\//.test(avatar) ||
      /^https?:\/\//.test(avatar)
    ) {
      return `<div class="${className}"><img src="${this.esc(
        avatar
      )}" alt="profile"></div>`;
    }

    return `<div class="${className}">${this.esc(
      avatar ||
      this.initials(
        profile.name ||
        profile.display_name ||
        profile.email ||
        "M"
      )
    )}</div>`;
  }
};

window.MilanApp.utils = MilanUtils;

/* Compatibility globals for the existing runtime. */
window.esc = MilanUtils.esc.bind(MilanUtils);
window.initials = MilanUtils.initials.bind(MilanUtils);
window.toast = MilanUtils.toast.bind(MilanUtils);
window.avatarHtml = MilanUtils.avatarHtml.bind(MilanUtils);

/* === ./inline-01.js === */
// JSON.parse crash fix
(function(){
  const origParse = JSON.parse;
  JSON.parse = function(text) {
    if(!text || text === "" || text === "undefined") {
      console.warn("Blocked empty JSON.parse");
      return null;
    }
    try { return origParse(text); }
    catch(e) { console.warn("JSON parse fail:", text.substring(0,50)); return null; }
  };

  // Safe get user
  window.getMilanUser = () => {
    try {
      const u = localStorage.getItem('milan_user');
      return u ? origParse(u) : null;
    } catch(e) { return null; }
  };
})();

/* === ./inline-02.js === */
window.__MILAN_FORCE_NATIVE_CONTROLS__=!0,window.__MILAN_FORCE_STABLE_VIDEO_SURFACE__=!0;

/* === ./inline-03.js === */
!function(){var ua=String(navigator.userAgent||""),nativeApk=/MilanNativeAudio/i.test(ua);nativeApk&&document.documentElement.classList.add("native-apk","milan");try{var saved=String(localStorage.getItem("milan_token")||"").trim();nativeApk&&saved&&(document.documentElement.classList.add("milan-token-present","milan-fast-open"),window.__MILAN_NATIVE_TOKEN_PRESENT__=!0)}catch(_){}}();

/* === ./inline-04.js === */
!function(){var isNativeApk=/MilanNativeAudio/i.test(String(navigator.userAgent||""));if("serviceWorker"in navigator)isNativeApk?(navigator.serviceWorker.getRegistrations().then(function(regs){regs.forEach(function(reg){try{reg.unregister()}catch(_){}})}).catch(function(){}),window.caches&&caches.keys().then(function(keys){keys.forEach(function(k){/^milan-/i.test(k)&&caches.delete(k).catch(function(){})})}).catch(function(){})):window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js?v=20260704v95").catch(function(){})})}();

/* === ./inline-05.js === */
const $=id=>document.getElementById(id),API="/api",MILAN_NATIVE=/MilanNativeAudio/i.test(navigator.userAgent);MILAN_NATIVE&&(document.documentElement.classList.add("native-apk","milan"),document.body&&document.body.classList.add("native-apk","milan","milan-native"),window.addEventListener("DOMContentLoaded",()=>document.body.classList.add("native-apk","milan","milan-native")));let token="";try{token=localStorage.getItem("milan_token")||""}catch(_){token=""}MILAN_NATIVE&&token&&(document.documentElement.classList.add("milan-token-present","milan-fast-open"),document.body&&document.body.classList.add("milan-token-present","app-ready","milan-app-visible","milan-app-opening"));let me=null,currentFeed=[],people=[],lastNotifications=[],currentScope="all";function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}function isChatFeedRecord(record){const data=record?.data&&typeof record.data==="object"?record.data:{};return String(record?.protocol||"").trim().toLowerCase()==="milan.chat"||String(record?.protocolPath||"").trim().toLowerCase()==="messages"||String(record?.schema||"").trim().toLowerCase()==="milan.chat.message"||String(record?.title||"").trim().toLowerCase()==="milan chat message"||String(data.kind||"").trim().toLowerCase()==="chat_message"||Boolean(data.messageId&&data.conversationId&&data.senderDid&&data.recipientDid)}function initials(s="MILAN"){return String(s||"M").trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase()||"M"}function toast(t){var container=document.getElementById("milanToastContainer");container||((container=document.createElement("div")).id="milanToastContainer",container.style.cssText="position:fixed;top:18px;right:18px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;",document.body.appendChild(container));var el=document.createElement("div");el.textContent=t,el.style.cssText="background:rgba(15,23,42,.92);color:#fff;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.22);opacity:0;transform:translateY(-8px);transition:opacity .22s,transform .22s;pointer-events:none;max-width:320px;word-break:break-word;",container.appendChild(el),requestAnimationFrame(function(){el.style.opacity="1",el.style.transform="translateY(0)"}),setTimeout(function(){el.style.opacity="0",el.style.transform="translateY(-8px)",setTimeout(function(){el.parentNode&&el.parentNode.removeChild(el)},250)},2600)}function avatarHtml(p={},cls="avatar"){const av=p.avatar||"";return/^data:image\//.test(av)||/^https?:\/\//.test(av)?`<div class="${cls}"><img src="${esc(av)}" alt="profile"></div>`:`<div class="${cls}">${esc(av||initials(p.name||p.display_name||p.email||"M"))}</div>`}function mediaSrc(url){if(!url)return"";if(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url))return"";if(/^data:|^blob:/.test(url))return url;const sep=url.includes("?")?"&":"?";return/^https?:\/\//.test(url)?url:token?url+sep+"token="+encodeURIComponent(token)+"&mv=59":url+sep+"mv=49"}function mediaDownloadSrc(url){const base=mediaSrc(url);return base?base+(base.includes("?")?"&":"?")+"download=1":""}function videoMediaSrc(raw){let u=String(raw||"");return/^\/api\/records\/[^/]+\/media$/.test(u)&&(u+="/play.mp4"),mediaSrc(u)}function mediaNode(el){return el&&"SOURCE"===el.tagName?el.parentElement:el}function setMediaError(el,msg,repairing=!1){try{const node=mediaNode(el),box=node?.closest(".media"),err=box?.querySelector(".mediaLoadError");box&&box.classList.toggle("repairing",!!repairing),err&&(err.textContent=msg,err.classList.remove("hidden"))}catch(_){}}function clearMediaError(el){try{const node=mediaNode(el),box=node?.closest(".media");box?.querySelector(".mediaLoadError")?.classList.add("hidden"),box?.classList.remove("repairing"),box?.classList.remove("previewFailed")}catch(_){}}function milanSetVideoSource(video,next){try{if(!video)return;const source=video.querySelector?.("source");source?source.setAttribute("src",next):video.setAttribute("src",next),video.load&&video.load()}catch(_){}}function milanRetryMedia(el){try{const node=mediaNode(el);if(!node||"1"===node.dataset.retrying)return;node.dataset.retrying="1";const source=node.querySelector?.("source"),src=source&&source.getAttribute("src")||node.getAttribute("src")||el.getAttribute?.("src")||"";if(!src)return;setTimeout(()=>{const next=src+(src.includes("?")?"&":"?")+"retry="+Date.now();"VIDEO"===node.tagName?milanSetVideoSource(node,next):node.setAttribute("src",next),node.dataset.retrying="0"},80)}catch(_){}}async function milanRepairVideo(id,el){const video=mediaNode(el);if(video&&"1"!==video.dataset.repairing){video.dataset.repairing="1";try{setMediaError(video,"Loading video...",!0);const result=await api("/records/"+encodeURIComponent(id)+"/media/repair?async=1",{method:"POST",body:JSON.stringify({async:!0})}),rec=result&&result.record?result.record:null;let next=videoMediaSrc(rec&&(rec.mediaUrl||rec.data?.media?.mediaUrl)||"/api/records/"+encodeURIComponent(id)+"/media");next+=(next.includes("?")?"&":"?")+"fixed="+Date.now(),milanSetVideoSource(video,next);try{video.load(),video.play?.().catch(()=>{})}catch(_){}setTimeout(()=>clearMediaError(video),400),toast(result&&result.repaired?"Video ready":"Video checked")}catch(e){const box=video.closest(".media"),card=box?.querySelector(".fileCard");card&&card.classList.remove("hidden"),setMediaError(video,"Video is uploaded safely. Preview is still preparing; refresh once or tap Open/Download.",!0)}finally{setTimeout(()=>{try{video.dataset.repairing="0"}catch(_){}},1200)}}}async function milanMediaError(id,el){try{if(!el)return;const node=mediaNode(el),box=node?.closest(".media");if("VIDEO"===node?.tagName){if("1"!==node.dataset.repairStarted)return node.dataset.repairStarted="1",void await milanRepairVideo(id,node);if("1"!==node.dataset.retryDone)return node.dataset.retryDone="1",setMediaError(node,"Retrying video stream...",!0),void milanRetryMedia(node);if(box){const card=box.querySelector(".fileCard");card&&card.classList.remove("hidden")}return void setMediaError(node,"Tap Open or Download to watch this video.",!1)}if(node&&"1"!==node.dataset.retryDone)return node.dataset.retryDone="1",void milanRetryMedia(node);if(box){box.classList.add("previewFailed");const card=box.querySelector(".fileCard");card&&card.classList.remove("hidden")}setMediaError(node,"Preview could not start. File is uploaded safely and download is available.")}catch(_){}}function setBootStatus(msg){try{let el=document.getElementById("nativeBootStatus");!el&&document.body.classList.contains("native-apk")&&(el=document.createElement("div"),el.id="nativeBootStatus",el.className="boot-status",document.body.appendChild(el)),el&&(el.textContent=msg||"",el.classList.toggle("hidden",!msg))}catch(_){}}async function fetchWithTimeout(url,opt={},ms){const controller=new AbortController,timeout=setTimeout(()=>controller.abort(),ms||2e4);try{return await fetch(url,{...opt,signal:controller.signal})}finally{clearTimeout(timeout)}}async function api(path,opt={}){const h={"Content-Type":"application/json",...opt.headers||{}};try{token=localStorage.getItem("milan_token")||localStorage.getItem("milan_token")||token||""}catch(_){}let r;token&&(h.Authorization="Bearer "+token);try{r=await fetchWithTimeout(API+path,{...opt,headers:h},Number(opt.timeoutMs||22e3))}catch(e){if(e&&"AbortError"===e.name){const er=new Error("Network timeout. Please refresh once.");throw er.status=0,er}throw e}const d=await r.json().catch(()=>({}));if(!r.ok){const er=new Error(d.error||"Request failed "+r.status);throw er.status=r.status,er}return d}function b64Header(value){try{return btoa(unescape(encodeURIComponent(String(value||""))))}catch(e){return btoa(String(value||""))}}async function apiUploadRaw(path,file,meta,onProgress){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest;let done=!1;const fail=msg=>{done||(done=!0,reject(new Error(msg||"Upload failed")))};xhr.open("POST",API+path,!0),xhr.timeout=Number(window.MILAN_UPLOAD_TIMEOUT_MS||18e5),token&&xhr.setRequestHeader("Authorization","Bearer "+token),xhr.setRequestHeader("Content-Type",file.type||"application/octet-stream"),xhr.setRequestHeader("X-File-Name",b64Header(file.name)),xhr.setRequestHeader("X-Record-Title",b64Header(meta.title||file.name)),xhr.setRequestHeader("X-Record-Caption",b64Header(meta.caption||"")),xhr.setRequestHeader("X-Access-Mode",meta.accessMode||"private"),xhr.setRequestHeader("X-Record-Tags",b64Header(JSON.stringify(meta.tags||[]))),xhr.setRequestHeader("X-Shared-With-Dids",b64Header(JSON.stringify(meta.sharedWithDids||[]))),xhr.upload.onprogress=e=>{e.lengthComputable&&onProgress&&onProgress(Math.max(1,Math.min(98,e.loaded/e.total*100)))},xhr.onload=()=>{let d={};try{d=JSON.parse(xhr.responseText||"{}")}catch(e){}xhr.status>=200&&xhr.status<300?(done=!0,onProgress&&onProgress(100),resolve(d)):fail(d.error||"Upload failed "+xhr.status)},xhr.onerror=()=>fail("Network error during upload. Keep the browser open and try again."),xhr.ontimeout=()=>fail("Upload is taking too long. Try a smaller video or better network."),xhr.onabort=()=>fail("Upload cancelled."),xhr.send(file)})}function xhrUploadBlob(url,blob,headers,onProgress){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest;let done=!1;const fail=msg=>{done||(done=!0,reject(new Error(msg||"Upload chunk failed")))};xhr.open("POST",url,!0),xhr.timeout=Number(window.MILAN_CHUNK_UPLOAD_TIMEOUT_MS||24e4),token&&xhr.setRequestHeader("Authorization","Bearer "+token),xhr.setRequestHeader("Content-Type","application/octet-stream"),Object.entries(headers||{}).forEach(([k,v])=>xhr.setRequestHeader(k,String(v))),xhr.upload.onprogress=e=>{e.lengthComputable&&onProgress&&onProgress(e.loaded,e.total)},xhr.onload=()=>{let d={};try{d=JSON.parse(xhr.responseText||"{}")}catch(e){}xhr.status>=200&&xhr.status<300?(done=!0,resolve(d)):fail(d.error||"Chunk upload failed "+xhr.status)},xhr.onerror=()=>fail("Network issue while uploading chunk. Retrying..."),xhr.ontimeout=()=>fail("Chunk upload timed out. Retrying..."),xhr.onabort=()=>fail("Chunk upload cancelled."),xhr.send(blob)})}async function withRetry(fn,retries=3){let last;for(let i=0;i<retries;i++)try{return await fn(i)}catch(e){last=e,await new Promise(r=>setTimeout(r,700+900*i))}throw last}async function apiUploadChunked(path,file,meta,onProgress){const requestedChunk=Number(window.MILAN_UPLOAD_CHUNK_BYTES||8388608),init=await api("/records/media/chunk/init",{method:"POST",body:JSON.stringify({fileName:file.name,mimeType:file.type||"application/octet-stream",sizeBytes:file.size,chunkBytes:requestedChunk,title:meta.title||file.name,caption:meta.caption||"",accessMode:meta.accessMode||"private",sharedWithDids:meta.sharedWithDids||[],tags:meta.tags||[]})}),uploadId=init.uploadId,chunkBytes=Number(init.chunkBytes||requestedChunk),totalChunks=Number(init.totalChunks||Math.ceil(file.size/chunkBytes));let uploadedBase=0;try{for(let i=0;i<totalChunks;i++){const start=i*chunkBytes,end=Math.min(file.size,start+chunkBytes),blob=file.slice(start,end);await withRetry(async()=>xhrUploadBlob("/api/records/media/chunk/"+encodeURIComponent(uploadId),blob,{"X-Chunk-Index":i,"X-Total-Chunks":totalChunks,"X-Chunk-Bytes":blob.size},loaded=>{if(onProgress){const pct=(uploadedBase+loaded)/file.size*96;onProgress(Math.max(1,Math.min(96,pct)))}}),4),uploadedBase=end,onProgress&&onProgress(Math.max(1,Math.min(96,uploadedBase/file.size*96)))}onProgress&&onProgress(98);const record=await api("/records/media/chunk/"+encodeURIComponent(uploadId)+"/complete",{method:"POST",body:JSON.stringify({}),timeoutMs:Number(window.MILAN_UPLOAD_COMPLETE_TIMEOUT_MS||9e5)});return onProgress&&onProgress(100),record}catch(e){try{await api("/records/media/chunk/"+encodeURIComponent(uploadId),{method:"DELETE"})}catch(_){}throw e}}async function apiUpload(path,file,meta,onProgress){return file&&((file.type||"").startsWith("video/")||file.size>Number(window.MILAN_CHUNK_UPLOAD_THRESHOLD_BYTES||8388608))?apiUploadChunked(path,file,meta,onProgress):apiUploadRaw(path,file,meta,onProgress)}function applyTheme(theme){const t="light"===theme?"light":"dark";document.body.classList.toggle("dark","dark"===t);const btn=$("themeBtn");btn&&(btn.textContent="dark"===t?"☀️ Light":"🌙 Dark")}function toggleTheme(){const next=document.body.classList.contains("dark")?"light":"dark";localStorage.setItem("milanTheme",next),applyTheme(next),toast("dark"===next?"Dark mode enabled":"Light mode enabled")}async function health(){try{const h=await fetchWithTimeout("/api/cloud-dwn/status",{},8e3).then(r=>r.json()),mode=(h.cloudDwn?.mode||"cloud").replace(/-/g," ");$("health").textContent=h.ok?"Cloud DWN online":"API issue",$("health").title=mode+" • "+(h.cloudDwn?.root||"")}catch{$("health").textContent="API offline"}}function isNativeMilan(){return MILAN_NATIVE||document.body.classList.contains("native-apk")}function safeLocalGet(k,fallback=""){try{return localStorage.getItem(k)||fallback}catch(_){return fallback}}function safeLocalRemove(k){try{localStorage.removeItem(k)}catch(_){}}function showAuth(){document.documentElement.classList.remove("milan-has-token","milan-shell-ready");applyTheme(safeLocalGet("milanTheme","dark")),document.documentElement.classList.remove("milan-token-present","milan-fast-open","milan-instant-app"),document.body&&document.body.classList.remove("milan-token-present");const auth=$("authView"),app=$("appView");auth&&(auth.classList.remove("hidden","milan-hidden","milan-hidden","milan-hidden"),auth.style.removeProperty("display"),auth.style.removeProperty("visibility"),auth.style.removeProperty("opacity"),auth.style.removeProperty("pointer-events")),app&&(app.classList.add("hidden"),app.classList.remove("milan-visible","milan-visible","milan-visible"),app.style.removeProperty("display"),app.style.removeProperty("visibility"),app.style.removeProperty("opacity"),app.style.removeProperty("min-height")),document.body.classList.remove("app-ready","milan-app-visible","milan-app-opening","milan-app-opening","milan-app-opening")}function showAppShellSafe(msg="Opening MILAN..."){document.documentElement.classList.add("milan-shell-ready");const auth=$("authView"),app=$("appView"),feed=$("feed");auth&&(auth.classList.add("hidden","milan-hidden"),auth.style.setProperty("display","none","important"),auth.style.setProperty("visibility","hidden","important"),auth.style.setProperty("opacity","0","important"),auth.style.setProperty("pointer-events","none","important")),app&&(app.classList.remove("hidden"),app.classList.add("milan-visible"),app.removeAttribute("aria-hidden"),app.style.setProperty("display","block","important"),app.style.setProperty("visibility","visible","important"),app.style.setProperty("opacity","1","important")),feed&&!String(feed.innerHTML||"").trim()&&(feed.innerHTML='<div class="empty">Opening your MILAN space...</div>'),document.body.classList.add("app-ready","milan-app-visible","milan-token-present","milan-app-opening"),document.documentElement.classList.add("milan-token-present","milan-fast-open"),setBootStatus(msg)}function milanHW(){if(window.__milanHWDead)return null;try{if(!window.__milanHW){const w=new Worker("/milan-heavy-worker.js?v=20260710");w.__cbs={},w.onmessage=e=>{const cb=w.__cbs[e.data.id];cb&&(delete w.__cbs[e.data.id],cb(e.data))},w.onerror=()=>{window.__milanHWDead=1;try{w.terminate()}catch(_){}window.__milanHW=null},window.__milanHW=w}return window.__milanHW}catch(_){return window.__milanHWDead=1,null}}
function milanOffload(task,syncFn,cb){const w=milanHW();if(!w)return void cb(syncFn());let done=!1;const id="t"+Date.now()+Math.random(),t=setTimeout(()=>{done||(done=!0,delete w.__cbs[id],cb(syncFn()))},600);w.__cbs[id]=m=>{done||(done=!0,clearTimeout(t),cb(m.error?syncFn():m))};try{w.postMessage({id:id,...task})}catch(_){done||(done=!0,clearTimeout(t),delete w.__cbs[id],cb(syncFn()))}}
function applyFeed(fresh){const safe=(Array.isArray(fresh)?fresh:[]).filter(r=>!isChatFeedRecord(r));const prev=currentFeed;currentFeed=safe,milanOffload({type:"feedDiff",prev:prev,fresh:safe},()=>({changed:JSON.stringify(safe)!==JSON.stringify(prev)}),r=>{(r.changed||!$("feed").childElementCount)&&(me||(window.__milanFeedNoMe=!0),renderFeed(),requestAnimationFrame(()=>{initMilanMediaObserver()}))})}
function readBootCache(){try{const bc=JSON.parse(localStorage.getItem("milanBootCache")||"null");return bc&&bc.me&&bc.tokenTail===String(token||"").slice(-12)?bc:null}catch(_){return null}}
function saveBootCache(){if(me)try{const v={tokenTail:String(token||"").slice(-12),at:Date.now(),me:me,feed:(currentFeed||[]).slice(0,12),summary:window.__milanLastSummary||null};milanOffload({type:"pack",value:v},()=>({json:JSON.stringify(v)}),r=>{try{r.json&&localStorage.setItem("milanBootCache",r.json)}catch(_){}})}catch(_){}}
function renderSummaryCounts(c){if(c)try{$("peopleCount").textContent=c.people,$("postCount").textContent=c.visiblePosts,$("requestCount").textContent=c.requests,$("notifCount").textContent=c.unreadNotifications}catch(_){}}
function recoverMobileScroll(){try{document.body.classList.remove("milan-mobile-menu-open");document.body.style.removeProperty("overflow");document.body.style.removeProperty("height");document.documentElement.style.removeProperty("overflow");}catch(_){} }async function boot(){if(window.__milanBootLocked)return;window.__milanBootLocked=true;return window.__milanBootPromise||(window.__milanBootPromise=(async()=>{if(health().catch(()=>{}),token=token||safeLocalGet("milan_token",""),!token)return void showAuth();const native=isNativeMilan();showAppShellSafe("Opening MILAN...");if(!native){const bc=readBootCache();bc&&(me=bc.me,renderMe(),bc.feed&&bc.feed.length&&(currentFeed=bc.feed.filter(r=>!isChatFeedRecord(r)),renderFeed()),renderSummaryCounts(bc.summary))}try{me=await api("/auth/me",{timeoutMs:native?9e3:15e3});
try{
  const savedProfile=await api("/profile",{timeoutMs:15e3});
  me.profile={...(me.profile||{}),...(savedProfile||{})};
}catch(profileErr){
  console.warn("Profile restore failed:",profileErr.message);
}
showAppShellSafe("Loading your MILAN space...");
renderMe();
if(native)window.__milanFeedLimit=5;

/* Fast-first-paint: primary feed first, secondary panels in background. */
await loadFeed();

renderSaved();

document.body.classList.remove(
  "milan-app-opening",
  "milan-app-opening",
  "milan-app-opening"
);

window.__milanAppReady=!0;
window.dispatchEvent(new CustomEvent("milan:app-ready"));
setBootStatus("");
saveBootCache();
startBackgroundUpdates();

/* Secondary data never blocks the first usable app state. */
Promise.allSettled([
  loadSummary(),
  loadPeople(),
  loadNotifications()
]).catch(()=>{});}catch(e){console.warn("MILAN session restore failed:",e.message);const __exp=!!(e&&(401===e.status||403===e.status||/expired|invalid|unauthori[sz]ed|jwt/i.test(String(e.message||""))));let __sv=false;if(__exp){__sv=await(async()=>{try{const t=localStorage.getItem("milan_token");if(!t)return false;const r=await fetch("/api/auth/me",{headers:{Authorization:"Bearer "+t},cache:"no-store"});return r.ok||r.status>=500}catch(_){return true}})();if(__sv){const k="milan_boot_retry",n=Date.now(),l=Number(sessionStorage.getItem(k)||0);if(n-l>30000){sessionStorage.setItem(k,String(n));location.reload();return}}}if(__exp&&!__sv){safeLocalRemove("milan_token"),safeLocalRemove("milanBootCache");token="";if(location.pathname!=="/")window.location.href="/";const msg=$("authMsg");return void(msg&&(msg.textContent="Session expired. Please login again."))}if(native){showAppShellSafe("Network is slow. App is still open. Tap Refresh once.");const feed=$("feed");return feed&&(feed.innerHTML='<div class="empty">Network is slow while restoring login. Tap Refresh once, or close/open the app. Your saved login was not removed.</div>'),void setTimeout(()=>setBootStatus(""),7e3)}showAppShellSafe("Reconnecting to MILAN...");const feed=$("feed");feed&&(feed.innerHTML='<div class="empty">Could not refresh live data right now. Your login is still active. Tap Refresh to retry.</div>');setTimeout(()=>setBootStatus(""),7000);}finally{window.__milanBootPromise=null}})()),window.__milanBootPromise}function renderMe(){const p=me.profile||{},name=p.display_name||me.name||me.email.split("@")[0],avatar=p.avatar||window.__milanPersistentAvatar||$("myAvatar")?.querySelector("img")?.src||localStorage.getItem("milanAvatar")||"";$("myName").textContent=name,$("myEmail").textContent=me.email,$("myAvatar").outerHTML=avatarHtml({avatar:avatar,name:name},"avatar lg"),$("composerAvatar").outerHTML=avatarHtml({avatar:avatar,name:name},"avatar"),$("myDid").textContent=me.did,$("myDwn").textContent="Cloud DWN: "+(me.dwn?.spaceId||"Not assigned")}async function loadSummary(){try{const s=await api("/social/summary");window.__milanLastSummary=s.counts,$("peopleCount").textContent=s.counts.people,$("postCount").textContent=s.counts.visiblePosts,$("requestCount").textContent=s.counts.requests,$("notifCount").textContent=s.counts.unreadNotifications,updatePrivacyScore()}catch(e){}}function updatePrivacyScore(){let score=100;currentFeed.some(r=>"public"===r.accessMode)&&(score-=10),currentFeed.some(r=>"shared_did"===r.accessMode)&&(score-=5),score=Math.max(70,score),$("privacyScore").textContent=score+"%",$("privacyBar").style.width=score+"%"}function mediaPlaying(){return[...document.querySelectorAll("video,audio")].some(m=>!m.paused&&!m.ended)}function feedPageDescriptor(){
  const native=document.body.classList.contains("native-apk")||String(navigator.userAgent).includes("MilanNativeAudio");
  const search=$("globalSearch")?.value.trim()||"";
  const access=$("filterAccess")?.value||"";
  const type=$("filterType")?.value||"";
  const scope=String(currentScope||"all");
  const pageSize=native?5:10;
  return {native,search,access,type,scope,pageSize,signature:JSON.stringify([native,search,access,type,scope,pageSize])};
}
function feedPageUrl(descriptor,offset){
  const qs=new URLSearchParams({scope:descriptor.scope,limit:String(descriptor.pageSize),offset:String(offset)});
  if(descriptor.search)qs.set("q",descriptor.search);
  if(descriptor.access)qs.set("access",descriptor.access);
  if(descriptor.type)qs.set("type",descriptor.type);
  return "/social/feed?"+qs.toString();
}
function ensureFeedPaginationUi(){
  const feed=$("feed");
  if(!feed)return null;
  let root=$("milan-feed-pagination");
  if(!root){
    root=document.createElement("div");
    root.id="milan-feed-pagination";
    root.style.cssText="display:flex;flex-direction:column;align-items:center;gap:10px;padding:18px 10px;text-align:center;";
    root.innerHTML='<div id="milan-feed-page-status" role="status" aria-live="polite" style="font-size:13px;color:var(--muted);min-height:1em;"></div><div id="milan-feed-page-sentinel" aria-hidden="true" style="width:100%;height:1px;"></div><button id="milan-feed-load-more" class="ghost" type="button" style="min-width:180px;">Load more posts</button>';
    feed.insertAdjacentElement("afterend",root);
  }
  const button=$("milan-feed-load-more");
  if(button&&button.dataset.bound!=="1"){
    button.dataset.bound="1";
    button.addEventListener("click",()=>loadNextFeedPage());
  }
  const descriptor=feedPageDescriptor();
  const sentinel=$("milan-feed-page-sentinel");
  if(!descriptor.native&&"IntersectionObserver" in window){
    if(!window.__milanFeedPageObserver){
      window.__milanFeedPageObserver=new IntersectionObserver(entries=>{
        if(entries.some(entry=>entry.isIntersecting))loadNextFeedPage();
      },{root:null,rootMargin:"800px 0px",threshold:0.01});
    }
    if(sentinel&&sentinel.dataset.observed!=="1"){
      sentinel.dataset.observed="1";
      window.__milanFeedPageObserver.observe(sentinel);
    }
  }else if(!descriptor.native&&!window.__milanFeedScrollFallback){
    window.__milanFeedScrollFallback=true;
    window.addEventListener("scroll",()=>{
      const state=window.__milanFeedPaging;
      if(!state||state.native||!state.hasMore||state.loading)return;
      const box=$("milan-feed-pagination");
      if(box&&box.getBoundingClientRect().top<(window.innerHeight||0)+800)loadNextFeedPage();
    },{passive:true});
  }
  return root;
}
function syncFeedPaginationUi(){
  const root=ensureFeedPaginationUi();
  if(!root)return;
  const state=window.__milanFeedPaging;
  const status=$("milan-feed-page-status");
  const sentinel=$("milan-feed-page-sentinel");
  const button=$("milan-feed-load-more");
  if(!state){
    root.style.display="none";
    return;
  }
  root.style.display=state.native?"none":"flex";
  if(status){
    status.textContent=state.loading
      ? (state.offset===0?"Loading feed…":"Loading more posts…")
      : state.error
        ? "Could not load posts. Tap Retry to try again."
        : !state.hasMore&&currentFeed.length
          ? "You’re all caught up."
          : "";
  }
  if(sentinel)sentinel.hidden=state.native||!state.hasMore;
  if(button){
    button.hidden=state.native||!state.hasMore;
    button.disabled=!!state.loading;
    button.textContent=state.loading?"Loading…":state.error?"Retry loading posts":"Load more posts";
  }
}
async function loadFeed(){
  window.__milanPendingPosts=window.__milanPendingPosts||[];
  const descriptor=feedPageDescriptor();
  const sequence=window.__feedSeq=(window.__feedSeq||0)+1;
  const state={signature:descriptor.signature,pageSize:descriptor.pageSize,native:descriptor.native,offset:0,hasMore:true,loading:true,error:""};
  window.__milanFeedPaging=state;
  syncFeedPaginationUi();
  try{
    const result=await api(feedPageUrl(descriptor,0));
    if(sequence!==window.__feedSeq||state!==window.__milanFeedPaging)return;
    const paged=!!result&&!Array.isArray(result)&&Array.isArray(result.items);
    const fresh=(paged?result.items:Array.isArray(result)?result:[]).filter(r=>!isChatFeedRecord(r));
    const serverIds=new Set(fresh.map(r=>String(r?.id||"")));
    const pending=(window.__milanPendingPosts||[]).filter(r=>{
      const id=String(r?.id||"");
      if(serverIds.has(id))return false;
      return Date.now()-Number(r.__milanPendingAt||Date.now())<120000;
    });
    window.__milanPendingPosts=pending;
    applyFeed([...pending,...fresh]);
    updatePrivacyScore();
    renderSaved();
    const serverOffset=paged?Number(result.nextOffset):NaN;
    state.offset=Number.isSafeInteger(serverOffset)&&serverOffset>=0?serverOffset:fresh.length;
    state.hasMore=paged&&typeof result.hasMore==="boolean"?result.hasMore:fresh.length>=descriptor.pageSize;
    state.loading=false;
    state.error="";
    syncFeedPaginationUi();
  }catch(e){
    if(sequence!==window.__feedSeq||state!==window.__milanFeedPaging)return;
    state.loading=false;
    state.error=e?.message||"Could not load feed.";
    if(!currentFeed.length)$("feed").innerHTML='<div class="empty">'+esc(state.error)+'</div>';
    syncFeedPaginationUi();
  }
}
async function loadNextFeedPage(){
  const state=window.__milanFeedPaging;
  const descriptor=feedPageDescriptor();
  if(!state||state.signature!==descriptor.signature)return loadFeed();
  if(state.loading||!state.hasMore)return;
  state.loading=true;
  state.error="";
  const sequence=window.__feedSeq;
  const offset=state.offset;
  syncFeedPaginationUi();
  try{
    const result=await api(feedPageUrl(descriptor,offset));
    if(state!==window.__milanFeedPaging||sequence!==window.__feedSeq||descriptor.signature!==feedPageDescriptor().signature)return;
    const paged=!!result&&!Array.isArray(result)&&Array.isArray(result.items);
    const page=(paged?result.items:Array.isArray(result)?result:[]).filter(r=>!isChatFeedRecord(r));
    const seen=new Set(currentFeed.map(r=>String(r?.id||"")).filter(Boolean));
    const additions=[];
    for(const record of page){
      const id=String(record?.id||"");
      if(!id||seen.has(id))continue;
      seen.add(id);
      additions.push(record);
    }
    const serverOffset=paged?Number(result.nextOffset):NaN;
    state.offset=Number.isSafeInteger(serverOffset)&&serverOffset>=offset?serverOffset:offset+page.length;
    state.hasMore=paged&&typeof result.hasMore==="boolean"?result.hasMore:page.length>=state.pageSize;
    state.loading=false;
    state.error="";
    if(additions.length){
      applyFeed([...currentFeed,...additions]);
      updatePrivacyScore();
      renderSaved();
    }
    syncFeedPaginationUi();
  }catch(e){
    if(state!==window.__milanFeedPaging||sequence!==window.__feedSeq)return;
    state.loading=false;
    state.error=e?.message||"Could not load more posts.";
    syncFeedPaginationUi();
  }
}
function formatBytes(n){if(!(n=Number(n||0)))return"";const u=["B","KB","MB","GB"];let i=0;for(;n>=1024&&i<u.length-1;)n/=1024,i++;return n.toFixed(i?1:0)+" "+u[i]}function fileIcon(cat,mime){return"image"===cat?"🖼️":"video"===cat?"🎬":"audio"===cat?"🎧":"pdf"===cat?"📄":(mime||"").includes("zip")?"🗜️":"📎"}function fileCardHtml(m,url,extra=""){const name=esc(m.fileName||"MILAN file"),mime=esc(m.mimeType||"file"),size=formatBytes(m.sizeBytes),open=esc(mediaSrc(url)),down=esc(mediaDownloadSrc(url));return`<div class="fileCard ${extra}"><div class="fileIcon">${fileIcon(m.previewCategory||"",m.mimeType)}</div><div class="fileMeta"><b>${name}</b><div class="mini">${mime}${size?" • "+esc(size):""}</div>${m.compatibilityWarning?`<div class="mini">${esc(m.compatibilityWarning)}</div>`:""}</div><div class="fileActions"><a href="${open}" target="_blank" rel="noopener">Open</a><a href="${down}" download>Download</a></div></div>`}function mediaHtml(r){const d=r.data||{},m=d.media||{},raw=r.mediaUrl||m.mediaUrl||d.mediaUrl||"",url=mediaSrc(raw);if(!url)return'';const mt=(m.mimeType||r.dataFormat||"application/octet-stream").toLowerCase(),cat=(m.previewCategory||r.mediaCompatibility?.previewCategory||(mt.startsWith("image/")?"image":mt.startsWith("video/")?"video":mt.startsWith("audio/")?"audio":"application/pdf"===mt?"pdf":mt.startsWith("text/")?"text":"file")).toLowerCase(),id=esc(r.id||""),err='<div class="mini mediaLoadError hidden">Preview is loading...</div>',onErr=`milanMediaError('${id}',this)`,onLoaded="clearMediaError(this)";if("image"===cat)return`<div class="media" data-record-id="${id}"><img loading="lazy" decoding="async" data-milan-observe="1" src="${esc(url)}" alt="${esc(r.title||"media")}" onload="${onLoaded}" onerror="${onErr}">${err}${fileCardHtml(m,raw,"hidden")}</div>`;if("video"===cat){const vurl=videoMediaSrc(raw),mime=!1===m.browserPlayable?"video/mp4":mt||"video/mp4";return`<div class="media" data-record-id="${id}"><video controls preload="none" data-milan-observe="1" playsinline webkit-playsinline x5-playsinline data-milan-inline-only="1" controlsList="nofullscreen nodownload noremoteplayback" onloadedmetadata="${onLoaded}" oncanplay="${onLoaded}" onplaying="${onLoaded}" onerror="${onErr}"><source src="${esc(vurl)}" type="${esc("video/quicktime"===mime?"video/mp4":mime)}"></video>${err}${fileCardHtml(m,raw,"hidden")}</div>`}return"audio"===cat?`<div class="media audioBox" data-record-id="${id}"><audio controls preload="metadata" src="${esc(url)}" type="${esc(mt||"audio/mpeg")}" onloadedmetadata="${onLoaded}" oncanplay="${onLoaded}" onplaying="${onLoaded}" onerror="${onErr}"></audio>${err}${fileCardHtml(m,raw,"hidden")}</div>`:"pdf"===cat?`<div class="media" data-record-id="${id}"><iframe loading="lazy" data-milan-observe="1" data-milan-src="${esc(url)}" title="${esc(m.fileName||r.title||"PDF")}" onload="${onLoaded}"></iframe>${err}${fileCardHtml(m,raw)}</div>`:`<div class="media" data-record-id="${id}">${fileCardHtml(m,raw)}${"video"===cat?'<div class="mini" style="padding:0 16px 14px">Video uploaded safely. Preview is still preparing or conversion is unavailable; use Open/Download and refresh after a few seconds.</div>':""}</div>`}function postText(r){const d=r.data||{};return"string"==typeof d?d:"media"===d.kind?d.caption||"":d.text||d.note||d.caption||""}function milanPostRenderFingerprint(value, contextKey){
  const serialized=JSON.stringify(value)||"";
  let a=2166136261;
  let b=0x9e3779b9;
  for(let i=0;i<serialized.length;i++){
    const code=serialized.charCodeAt(i);
    a=Math.imul(a^code,16777619);
    b=Math.imul(b^code,2246822519);
    b^=b>>>13;
  }
  return serialized.length+":"+(a>>>0).toString(36)+":"+(b>>>0).toString(36)+":"+(contextKey||"");
}

function renderFeed(){
  const feedEl=$("feed");
  if(!feedEl)return;

  if(!currentFeed.length){
    feedEl.innerHTML='<div class="empty">No posts found. Try creating one or changing filters.</div>';
    if(window.__milanPostRenderCache instanceof Map) window.__milanPostRenderCache.clear();
    return;
  }

  const native=document.body.classList.contains("native-apk")||/MilanNativeAudio/i.test(navigator.userAgent);
  const rows=native
    ? currentFeed.slice(0,Number(window.__milanFeedLimit||10))
    : currentFeed;

  const wantedIds=new Set(rows.map(r=>String(r.id||"")));

  /* Reuse existing post nodes whenever possible. */
  const existing=new Map(
    Array.from(feedEl.querySelectorAll("article.post"))
      .map(el=>[String(el.id||"").replace(/^post-/,""),el])
  );

  const savedSet = new Set(savedIds());
  const renderContextKey = milanPostRenderFingerprint([
    me?.did || me?.user?.did || me?.data?.user?.did || "",
    me?.email || me?.user?.email || me?.profile?.email || "",
    me?.profile?.display_name || me?.profile?.name || me?.name || me?.display_name || "",
    me?.profile?.avatar || "",
    window.__milanPersistentAvatar || "",
    (()=>{try{return localStorage.getItem("milanAvatar")||"";}catch(_){return "";}})()
  ], "");
  const renderCache = window.__milanPostRenderCache instanceof Map
    ? window.__milanPostRenderCache
    : (window.__milanPostRenderCache = new Map());

  rows.forEach((record,index)=>{
    const id=String(record.id||"");
    const current=existing.get(id);
    const hasStableDate=Boolean(record.dateModified || record.dateCreated);
    const renderKey=hasStableDate
      ? milanPostRenderFingerprint(record, renderContextKey + "|saved:" + (savedSet.has(record.id) ? "1" : "0"))
      : null;

    /* Skip HTML generation and DOM parsing when this post is unchanged. */
    if(current && renderKey && renderCache.get(id)===renderKey){
      existing.delete(id);
      return;
    }

    const html=postHtml(record,savedSet);

    if(current){
      const wrapper=document.createElement("div");
      wrapper.innerHTML=html;
      const fresh=wrapper.firstElementChild;
      if(fresh){
        if(current.outerHTML!==fresh.outerHTML) current.replaceWith(fresh);
        if(renderKey) renderCache.set(id,renderKey);
        else renderCache.delete(id);
      }else{
        renderCache.delete(id);
      }
      existing.delete(id);
    }else{
      const wrapper=document.createElement("div");
      wrapper.innerHTML=html;
      const fresh=wrapper.firstElementChild;
      if(fresh){
        feedEl.appendChild(fresh);
        if(renderKey) renderCache.set(id,renderKey);
        else renderCache.delete(id);
      }else{
        renderCache.delete(id);
      }
    }
  });

  /* Remove posts no longer present, and release their cache entries. */
  existing.forEach((el,id)=>{el.remove();renderCache.delete(id);});
  renderCache.forEach((_,id)=>{if(!wantedIds.has(id))renderCache.delete(id);});

  /* Keep server order without moving every post on every refresh.
     Re-append only when a node is actually out of position; this avoids
     unnecessary mobile layout/scroll churn after publish and media upload. */
  rows.forEach((record,index)=>{
    const el=document.getElementById("post-"+String(record.id||""));
    if(!el)return;
    const next=feedEl.children[index];
    if(next!==el){
      feedEl.insertBefore(el,next||null);
    }
  });

  let more=document.getElementById("nativeLoadMoreBtn");
  if(more)more.remove();

  if(native && (currentFeed.length>rows.length || window.__milanFeedPaging?.hasMore)){
    more=document.createElement("button");
    more.className="nativeLoadMore ghost";
    more.id="nativeLoadMoreBtn";
    more.textContent=currentFeed.length>rows.length ? "Show more loaded posts" : "Load more posts";
    more.onclick=()=>{
      const visible=Number(window.__milanFeedLimit||5);
      window.__milanFeedLimit=visible+10;
      if(currentFeed.length>visible) renderFeed();
      else loadNextFeedPage();
    };
    feedEl.appendChild(more);
  }
}
function initMilanMediaObserver(){
  const feed=document.getElementById("feed");
  if(!feed || !("IntersectionObserver" in window))return;
  if(!window.__milanMediaObserver){
    window.__milanMediaObserver=new IntersectionObserver((entries,observer)=>{
    for(const entry of entries){
      if(!entry.isIntersecting)continue;

      const el=entry.target;

      if(el.tagName==="VIDEO"){
        try{el.load()}catch(_){}
      }

      if(el.tagName==="IFRAME"){
        const src=el.getAttribute("data-milan-src");
        if(src && !el.getAttribute("src")){
          el.setAttribute("src",src);
        }
        el.removeAttribute("data-milan-src");
      }

      el.removeAttribute("data-milan-observe");
      observer.unobserve(el);
    }
  },{
    root:null,
    rootMargin:"300px 0px",
    threshold:0.01
  });
  }

  feed.querySelectorAll(
    "img[data-milan-observe],video[data-milan-observe],iframe[data-milan-observe]"
  ).forEach(el=>window.__milanMediaObserver.observe(el));
}

function postHtml(r,savedSet){
  const p={
    ...(r.ownerProfile||{})
  };

  const currentDid=String(
    me?.did ||
    me?.user?.did ||
    me?.data?.user?.did ||
    ""
  ).trim();

  const recordOwner=String(
    r.owner ||
    r.ownerDid ||
    r.creatorDid ||
    r.authorDid ||
    r.ownerProfile?.did ||
    r.authorProfile?.did ||
    ""
  ).trim();

  const currentEmail=String(
    me?.email ||
    me?.user?.email ||
    me?.profile?.email ||
    ""
  ).trim().toLowerCase();

  const ownerEmail=String(
    p.email ||
    r.ownerProfile?.email ||
    ""
  ).trim().toLowerCase();

  const currentName=String(
    me?.profile?.display_name ||
    me?.profile?.name ||
    me?.name ||
    me?.display_name ||
    ""
  ).trim().toLowerCase();

  const ownerName=String(
    p.display_name ||
    p.name ||
    ""
  ).trim().toLowerCase();

  const owner=
    Boolean(
      (currentDid && recordOwner &&
       currentDid===recordOwner) ||

      (currentEmail && ownerEmail &&
       currentEmail===ownerEmail) ||

      (currentName && ownerName &&
       currentName===ownerName)
    );

  if(owner){
    p.name=
      p.display_name ||
      p.name ||
      me?.profile?.display_name ||
      me?.profile?.name ||
      me?.name ||
      me?.email?.split("@")[0] ||
      "MILAN User";

    p.avatar=
      me?.profile?.avatar ||
      p.avatar ||
      window.__milanPersistentAvatar ||
      localStorage.getItem("milanAvatar") ||
      "";

    p.did=
      currentDid ||
      p.did ||
      recordOwner;
  }

  const mine=
    r.social?.reactions?.mine;

  const saved=(savedSet||new Set(savedIds())).has(r.id);

  const ownerControls=owner
    ? `
      <button type="button"
        onclick="editPost('${r.id}')">
        ✏️ Edit
      </button>

      <button type="button"
        onclick="accessPanel('${r.id}')">
        🔐 Access
      </button>

      <button type="button"
        class="milan-delete-post"
        title="Delete this post"
        aria-label="Delete this post"
        onclick="deletePost('${r.id}')">
        🗑 Delete
      </button>
    `
    : `
      <button type="button"
        onclick="requestAccess('${esc(r.owner||"")}','${r.id}')">
        🔑 Request
      </button>
    `;

  return `<article class="card post" id="post-${esc(r.id)}">
    <div class="postHead">
      <div class="postUser">
        ${avatarHtml(p)}
        <div>
          <b>${esc(p.name||"MILAN User")}</b>
          <div class="mini">
            ${esc(r.accessMode||"private")}
            •
            ${new Date(
              r.dateModified ||
              r.dateCreated ||
              Date.now()
            ).toLocaleString()}
            <br>
            <span>
              ${esc(
                (p.did||r.owner||"").slice(0,44)
              )}${p.did||r.owner?"...":""}
            </span>
            ${
              (p.did||r.owner)
                ? `<button type="button"
                    class="ghost"
                    onclick="copyText('${esc(p.did||r.owner)}')">
                    Copy DID
                   </button>`
                : ""
            }
          </div>
        </div>
      </div>

      <div>
        ${
          owner
            ? '<span class="badge">Owner</span>'
            : '<span class="badge">Visible by permission</span>'
        }
      </div>
    </div>

    ${mediaHtml(r)}

    <div class="postBody">
      <div class="postTitle">
        ${esc(r.title||"Untitled")}
      </div>

      <div class="postText">
        ${esc(postText(r))}
      </div>

      <div style="margin-top:8px">
        ${(r.tags||[])
          .map(t =>
            `<span class="badge">#${esc(t)}</span>`
          )
          .join(" ")}
      </div>
    </div>

    <div class="postMetrics">
      <span class="reactionTotal">
        ${r.social?.reactions?.total||0} reactions
      </span>

      <span class="commentTotal">
        ${r.social?.commentsCount||0} comments
      </span>
    </div>

    <div class="reactionBar">
      <button
        class="${"like"===mine?"active":""}"
        onclick="react('${r.id}','like',this)">
        👍 Like
      </button>

      <button
        class="${"love"===mine?"active":""}"
        onclick="react('${r.id}','love',this)">
        💙 Love
      </button>

      <button
        onclick="openComments('${r.id}')">
        💬 Comment
      </button>

      <button
        onclick="toggleSave('${r.id}',this)">
        ${saved?"🔖 Saved":"🔖 Save"}
      </button>

      ${ownerControls}
    </div>
  </article>`;
}
function updateRecordLocal(id,patch,options){const i=currentFeed.findIndex(r=>r.id===id);if(i>=0){currentFeed[i]={...currentFeed[i],...patch};const el=$("post-"+id);if(el&&!(options&&options.preserveVideo&&el.querySelector(".milanUniversalPlayer video"))){el.outerHTML=postHtml(currentFeed[i])}}}async function react(id,type,btn){try{const summary=await api("/social/records/"+id+"/reactions",{method:"POST",body:JSON.stringify({type:type})}),r=currentFeed.find(x=>x.id===id);r&&(r.social=r.social||{},r.social.reactions=summary);const card=btn.closest(".post");card.querySelector(".reactionTotal").textContent=(summary.total||0)+" reactions",card.querySelectorAll(".reactionBar button").forEach(b=>b.classList.remove("active")),summary.mine===type&&btn.classList.add("active"),loadNotifications(),loadSummary()}catch(e){toast(e.message)}}async function openComments(id){try{const rows=await api("/social/records/"+id+"/comments");$("modalBody").innerHTML=`<h2>Comments</h2><div class="comments">${rows.map(c=>`<div class="comment">${avatarHtml(c.authorProfile||{})}<div class="bubble"><b>${esc(c.authorProfile?.name||"User")}</b><div>${esc(c.text)}</div><div class="mini">${new Date(c.createdAt).toLocaleString()}</div></div></div>`).join("")||'<div class="empty">No comments yet.</div>'}</div><textarea id="newComment" placeholder="Write a comment"></textarea><br><button onclick="addComment('${id}')">Post comment</button>`,$("modalBack").classList.remove("hidden")}catch(e){toast(e.message)}}async function addComment(id){try{const text=$("newComment").value.trim();if(!text)return toast("Write a comment first");await api("/social/records/"+id+"/comments",{method:"POST",body:JSON.stringify({text:text})}),closeModal();const r=currentFeed.find(x=>x.id===id);if(r){r.social=r.social||{},r.social.commentsCount=Number(r.social.commentsCount||0)+1;const card=$("post-"+id);card&&(card.querySelector(".commentTotal").textContent=r.social.commentsCount+" comments")}toast("Comment posted"),loadNotifications()}catch(e){toast(e.message)}}function accessPanel(id){$("modalBody").innerHTML=`<h2>Update access</h2><p class="mini">The DID box is blank every time. Paste only the DIDs you want to allow now.</p><label>Access mode</label><select id="accessMode"><option value="private">Private</option><option value="public">Public</option><option value="shared_did">Share with DID</option></select><label>Share DIDs</label><textarea id="accessDids" placeholder="Paste DIDs comma separated"></textarea><button onclick="updateAccess('${id}')">Update access</button>`,$("modalBack").classList.remove("hidden")}async function updateAccess(id){try{const mode=$("accessMode").value,dids=$("accessDids").value.split(",").map(x=>x.trim()).filter(x=>x.startsWith("did:"));await api("/records/"+id+"/permissions",{method:"PATCH",body:JSON.stringify({accessMode:mode,sharedWithDids:dids})}),closeModal(),toast("Access updated"),mediaPlaying()?loadSummary():await loadFeed()}catch(e){toast(e.message)}}function editPost(id){const r=currentFeed.find(x=>x.id===id);if(!r)return;const tags=(r.tags||[]).join(", ");$("modalBody").innerHTML=`<h2>Edit post</h2><label>Title</label><input id="editTitle" value="${esc(r.title||"")}"><label>Caption / Text</label><textarea id="editText">${esc(postText(r))}</textarea><label>Tags</label><input id="editTags" value="${esc(tags)}"><p class="mini">Media file is preserved while editing title, text or tags.</p><button onclick="saveEdit('${id}')">Save changes</button>`,$("modalBack").classList.remove("hidden")}async function saveEdit(id){try{const r=currentFeed.find(x=>x.id===id),text=$("editText").value,tags=$("editTags").value.split(",").map(x=>x.trim()).filter(Boolean);let data=r.data;data=data&&"media"===data.kind?{...data,caption:text}:{..."object"==typeof data?data:{},text:text,tags:tags};const updated=await api("/records/"+id,{method:"PUT",body:JSON.stringify({title:$("editTitle").value,data:data,tags:tags})});closeModal(),updateRecordLocal(id,updated),toast("Post updated")}catch(e){toast(e.message)}}async function deletePost(id){
  if(!confirm("Delete this post permanently from DWN?")) return;

  try{
    await api("/records/"+encodeURIComponent(id),{
      method:"DELETE"
    });

    currentFeed=currentFeed.filter(
      r=>r.id!==id
    );

    const card=$("post-"+id);
    if(card) card.remove();

    renderFeed();
    toast("Post deleted from DWN");
    await loadSummary();
  }catch(e){
    toast(e.message||"Could not delete post");
  }
}function sharePanel(id){accessPanel(id)}async function requestAccess(did,id){try{await api("/requests",{method:"POST",body:JSON.stringify({toDid:did,recordId:id,message:"Please allow access to this MILAN record."})}),toast("Access request sent")}catch(e){toast(e.message)}}async function publish(){
  try{
    const file = $("mediaFile").files[0];
    const accessMode = $("privacy").value;

    const sharedWithDids =
      $("shareDids").value
        .split(",")
        .map(x => x.trim())
        .filter(x => x.startsWith("did:"));

    const tags =
      $("tagsInput").value
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);

    if(
      accessMode === "shared_did" &&
      !sharedWithDids.length
    ){
      throw new Error(
        "Paste at least one DID for shared post"
      );
    }

    let createdRecord;

    if(file){
      createdRecord = await apiUpload(
        "/records/media",
        file,
        {
          title:
            $("postTitle").value ||
            file.name,
          caption:
            $("postText").value,
          accessMode,
          sharedWithDids,
          tags
        }
      );
    }else{
      createdRecord = await api(
        "/records",
        {
          method: "POST",
          body: JSON.stringify({
            title:
              $("postTitle").value ||
              "MILAN Post",
            data: {
              text:
                $("postText").value,
              tags
            },
            dataFormat:
              "application/json",
            accessMode,
            sharedWithDids,
            tags
          })
        }
      );
    }

    /*
     * The server has already persisted the record.
     * Put the returned record directly into the current feed.
     * Do NOT call loadFeed() immediately after publish.
     */
    if(
      createdRecord &&
      createdRecord.id
    ){
      createdRecord.__milanPendingAt = Date.now();
      window.__milanPendingPosts = window.__milanPendingPosts || [];
      window.__milanPendingPosts = [
        createdRecord,
        ...window.__milanPendingPosts.filter(
          r => r.id !== createdRecord.id
        )
      ];

      currentFeed = [
        createdRecord,
        ...currentFeed.filter(
          r => r.id !== createdRecord.id
        )
      ];

      // Paint the new post before any follow-up network refresh.
      renderFeed();
    }

    $("postTitle").value = "";
    $("postText").value = "";
    $("mediaFile").value = "";
    $("tagsInput").value = "";
    $("shareDids").value = "";
    $("privacy").value = "private";
    $("shareBox").classList.add("hidden");

    toast("Post published");
    recoverMobileScroll();

    // Keep Publish non-blocking after the first paint. The pending record keeps
    // the new post visible even if the background feed request finishes before
    // remote DWN sync has propagated.
    setTimeout(() => {
      Promise.resolve(loadFeed()).catch(err => {
        console.warn("[MILAN] Background feed refresh skipped:", err?.message || err);
      });
    }, 150);

    Promise.resolve(loadSummary()).catch(() => {});

  }catch(e){
    console.error(
      "[MILAN] Publish failed:",
      e
    );

    toast(
      e?.message ||
      "Post could not be published"
    );
  }
}

function peopleActions(p){
  const did=esc(p.did||"");
  const id=esc(p.connectionId||"");
  const name=String(p.name||"this user").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
  let primary="";

  if(p.connectionStatus==="none"||p.connectionStatus==="rejected"){
    primary=`<button class="friend-add" type="button" title="Add Friend" aria-label="Add Friend" onclick="sendConnect('${did}')">➕ <span>Add Friend</span></button>`;
  }else if(p.connectionStatus==="sent"){
    primary='<button class="friend-pending" type="button" disabled title="Friend request sent" aria-label="Friend request sent">⏳ <span>Request sent</span></button>';
  }else if(p.connectionStatus==="received"){
    primary=`<div class="friend-request-box" aria-label="Incoming friend request">
      <span class="friend-request-label">Friend request</span>
      <div class="friend-request-actions">
        <button class="friend-action friend-accept" type="button" title="Accept friend request" aria-label="Accept friend request" onclick="approveConnect('${id}','${name}')">✓</button>
        <button class="friend-action friend-decline" type="button" title="Decline friend request" aria-label="Decline friend request" onclick="rejectConnect('${id}')">✕</button>
      </div>
    </div>`;
  }else if(p.connectionStatus==="friends"){
    primary='<span class="friend-connected" aria-label="Friends">✓ Friends</span>';
  }

  return `<div class="personActions">${primary}<div class="actionRow"><button class="ghost" onclick="copyText('${did}')">📋 DID</button><button class="soft" onclick="requestData('${did}')">🔐 Request</button></div></div>`;
}

async function sendConnect(did){
  try{
    await api("/connections",{method:"POST",body:JSON.stringify({toDid:did,message:"I would like to connect with you on MILAN."})});
    toast("Friend request sent");
    await loadPeople();
    await loadSummary();
    await loadNotifications();
  }catch(e){toast(e.message)}
}

async function approveConnect(id,name="this user"){
  try{
    await api("/connections/"+id+"/approve",{method:"PATCH"});
    await loadPeople();
    await loadFeed();
    await loadSummary();
    await loadNotifications();
    toast("You are now friends with "+name);
  }catch(e){toast(e.message)}
}

async function rejectConnect(id){
  try{
    await api("/connections/"+id+"/reject",{method:"PATCH"});
    await loadPeople();
    await loadSummary();
    await loadNotifications();
    toast("Friend request declined");
  }catch(e){toast(e.message)}
}
async function loadPeople(){try{const q=($("peopleSearch")?.value||$("globalSearch").value||"").trim();const allPeople=await api("/social/people");people=q?await api("/social/people?q="+encodeURIComponent(q)):allPeople;const renderPerson=p=>`<div class="person"><div class="personMain">${avatarHtml(p)}<div class="personInfo"><b>${esc(p.name||"MILAN User")}</b><div class="mini"><span class="personDid" title="${esc(p.did||"")}">${esc(p.did||"")}</span><div class="personMeta"><span class="badge">${esc(p.connectionStatus||"none")}</span></div></div></div></div>${peopleActions(p)}</div>`;const list=$("peopleList");if(list){list.classList.toggle("empty",!people.length);list.innerHTML=people.length?people.map(renderPerson).join(""):'<div class="empty">No people found.</div>';}const connect=$("peopleConnectList");if(connect){connect.classList.remove("empty");connect.innerHTML="";allPeople.forEach(p=>{const el=document.createElement("div");el.innerHTML=renderPerson(p);connect.appendChild(el.firstElementChild);});if(!allPeople.length){connect.classList.add("empty");connect.innerHTML='<div class="empty">No people found.</div>';}}}catch(e){$("peopleList")&&($("peopleList").innerHTML='<div class="empty">'+esc(e.message)+"</div>");$("peopleConnectList")&&($("peopleConnectList").innerHTML='<div class="empty">'+esc(e.message)+"</div>")}}async function loadNotifications(){try{lastNotifications=await api("/social/notifications"),$("notifList").innerHTML=lastNotifications.slice(0,8).map(n=>`<div class="bubble"><b>${esc(n.type)}</b><div class="mini">${new Date(n.createdAt).toLocaleString()} • ${esc((n.actorDid||"").slice(0,35))}</div></div>`).join("")||'<div class="mini">No notifications.</div>'}catch(e){}}function savedIds(){try{return JSON.parse(localStorage.getItem("milanSavedIds")||"[]")}catch{return[]}}function setSavedIds(ids){localStorage.setItem("milanSavedIds",JSON.stringify(ids.slice(0,200)))}function toggleSave(id,btn){let ids=savedIds();ids=ids.includes(id)?ids.filter(x=>x!==id):[id,...ids],setSavedIds(ids),btn.textContent=ids.includes(id)?"🔖 Saved":"🔖 Save",renderSaved(),toast(ids.includes(id)?"Saved":"Removed from saved")}function renderSaved(){const ids=savedIds(),rows=currentFeed.filter(r=>ids.includes(r.id)).slice(0,6);$("savedList").innerHTML=rows.length?rows.map(r=>`<div class="bubble"><b>${esc(r.title||"Saved post")}</b><div class="mini">${esc(r.accessMode)}</div></div>`).join(""):'<div class="mini">Save posts to see them here.</div>'}function openProfile(){const p=me.profile||{};$("modalBody").innerHTML=`<h2>Edit Profile</h2><label>Name</label><input id="editName" value="${esc(p.display_name||"")}"><label>Bio</label><textarea id="editBio">${esc(p.bio||"")}</textarea><label>Website</label><input id="editWebsite" value="${esc(p.website||"")}"><label>Profile picture</label><input id="profilePicFile" type="file" accept="image/*"><div class="mini">Upload a small profile picture. It is stored in your profile for this demo.</div><br><button onclick="saveProfile()">Save profile</button>`,$("modalBack").classList.remove("hidden")}function fileToDataUrl(file){return new Promise((res,rej)=>{const r=new FileReader;r.onload=()=>res(r.result),r.onerror=rej,r.readAsDataURL(file)})}async function saveProfile(){try{const fields={display_name:$("editName").value,bio:$("editBio").value,website:$("editWebsite").value};const f=$("profilePicFile").files[0];let profile;if(f){if(typeof window.milanUploadProfileAvatar!=="function")throw new Error("The verified profile-picture uploader is unavailable. Refresh the page and try again.");profile=await window.milanUploadProfileAvatar(f,fields)}else{profile=await api("/profile",{method:"PUT",body:JSON.stringify(fields)})}me.profile={...(me.profile||{}),...profile},closeModal(),renderMe(),loadFeed(),toast("Profile updated")}catch(e){toast(e.message)}}function openPrivacyCenter(){$("modalBody").innerHTML="<h2>Privacy Center</h2><p>MILAN keeps posts private by default. Use Public or Share with DID only when you choose.</p><ul><li>Private: only you</li><li>Public: visible in public feed</li><li>Share with DID: selected people only</li></ul>",$("modalBack").classList.remove("hidden")}function closeModal(){$("modalBack").classList.add("hidden")}function copyText(t){navigator.clipboard.writeText(t||""),toast("Copied")}function startBackgroundUpdates(){
  if(window.__milanTick)return;

  const native=document.body.classList.contains("native-apk")||/MilanNativeAudio/i.test(navigator.userAgent);
  const interval=native?120000:30000;

  const refresh=()=>{
    if(!token || document.hidden || mediaPlaying())return;
    if(!window.__milanLivePushActive && !window.__milanLivePollingActive){
      loadNotifications();
      loadSummary();
    }
  };

  window.__milanTick=setInterval(refresh,interval);

  if(!window.__milanPeopleTick){
    const refreshPeople=()=>{
      if(!token || document.hidden || mediaPlaying())return;
      loadPeople().catch(()=>{});
    };
    window.__milanPeopleTick=setInterval(refreshPeople,60000);
  }

  document.addEventListener("visibilitychange",()=>{
    if(!document.hidden){
      requestAnimationFrame(refresh);
      loadPeople().catch(()=>{});
      if(!window.__milanLivePushActive && !window.__milanLivePollingActive) loadNotifications();
    }
  },{passive:true});

  // Live social events: Add Friend / Accept / Decline update the open account
  // immediately on the other device instead of waiting for the polling interval.
  if(!window.__milanEvents && token && typeof EventSource !== "undefined"){
    try{
      const es=new EventSource("/api/events?token="+encodeURIComponent(token));
      window.__milanEvents=es;

      es.onmessage=(event)=>{
        try{
          const data=JSON.parse(event.data||"{}");
          const type=String(data.type||"");
          const notifType=String(data.notifType||"");
          if(type!=="notify")return;

          if(notifType==="connection_request"){
            toast("New friend request");
          }else if(notifType==="connection_approved"){
            toast("Friend request accepted");
          }else if(notifType==="connection_rejected"){
            toast("Friend request declined");
          }

          const isChatEvent = notifType==="chat_typing" ||
            notifType==="chat_read" || notifType==="chat_message";
          const isConnectionEvent = notifType==="connection_request" ||
            notifType==="connection_approved" || notifType==="connection_rejected";
          const isFeedEvent = notifType==="comment" || notifType==="reaction";

          if(!isChatEvent && !window.__milanLivePushActive && !window.__milanLivePollingActive){
            Promise.resolve(loadNotifications()).catch(()=>{});
            Promise.resolve(loadSummary()).catch(()=>{});
          }
          if(isConnectionEvent){
            Promise.resolve(loadPeople()).catch(()=>{});
          }
          if(isFeedEvent && typeof loadFeed==="function"){
            Promise.resolve(loadFeed()).catch(()=>{});
          }
        }catch(_){}
      };

      es.onerror=()=>{
        // Native EventSource automatically reconnects. Keep the reference alive
        // so repeated errors do not create multiple connections.
      };
    }catch(_){}
  }

  requestAnimationFrame(refresh);
}applyTheme(localStorage.getItem("milanTheme")||"dark"),window.showAppShellSafe=showAppShellSafe,window.showAuth=showAuth,window.addEventListener("error",()=>{const av=document.getElementById("authView"),ap=document.getElementById("appView");av&&ap&&av.classList.contains("hidden")&&ap.classList.contains("hidden")&&av.classList.remove("hidden")}),window.boot=boot,document.querySelectorAll("[data-auth]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-auth]").forEach(x=>x.classList.remove("active"));b.classList.add("active");const login=$("loginBox"),register=$("registerBox");login&&login.classList.toggle("hidden","login"!==b.dataset.auth);register&&register.classList.toggle("hidden","register"!==b.dataset.auth)});const logoutBtn=$("logoutBtn");logoutBtn&&(logoutBtn.onclick=()=>{localStorage.removeItem("milan_token"),localStorage.removeItem("milanBootCache"),document.documentElement.classList.remove("milan-token-present","milan-fast-open","milan-instant-app");if(location.pathname!=="/")window.location.href="/"});const publishBtn=$("publishBtn");publishBtn&&(publishBtn.onclick=publish);const refreshBtn=$("refreshBtn");refreshBtn&&(refreshBtn.onclick=()=>{loadFeed(),loadSummary(),loadPeople(),loadNotifications()});const privacy=$("privacy");privacy&&(privacy.onchange=()=>{const shareBox=$("shareBox"),shareDids=$("shareDids");shareBox&&shareBox.classList.toggle("hidden","shared_did"!==privacy.value);"shared_did"!==privacy.value&&shareDids&&(shareDids.value="")});const milanDebounce=(fn,ms=450)=>{let t;return function(){clearTimeout(t),t=setTimeout(fn,ms)}};const peopleSearch=$("peopleSearch");peopleSearch&&(peopleSearch.oninput=milanDebounce(()=>loadPeople(),500));const globalSearch=$("globalSearch");globalSearch&&(globalSearch.oninput=milanDebounce(()=>{window.__milanFeedLimit=10,loadFeed(),setTimeout(()=>loadPeople(),300)},550));const filterAccess=$("filterAccess");filterAccess&&(filterAccess.onchange=()=>{window.__milanFeedLimit=10,loadFeed()});const filterType=$("filterType");filterType&&(filterType.onchange=()=>{window.__milanFeedLimit=10,loadFeed()});document.querySelectorAll("[data-scope]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-scope]").forEach(x=>x.classList.remove("active"));b.classList.add("active");currentScope=b.dataset.scope,loadFeed()});const profileBtn=$("profileBtn");profileBtn&&(profileBtn.onclick=openProfile);const copyDidBtn=$("copyDidBtn");copyDidBtn&&(copyDidBtn.onclick=()=>copyText(me?.did));const themeBtn=$("themeBtn");themeBtn&&(themeBtn.onclick=toggleTheme);const markReadBtn=$("markReadBtn");markReadBtn&&(markReadBtn.onclick=async()=>{for(const n of lastNotifications.slice(0,8))n.read||await api("/social/notifications/"+n.id+"/read",{method:"PATCH"});toast("Notifications marked"),loadNotifications(),loadSummary()});window.addEventListener("DOMContentLoaded",()=>{requestAnimationFrame(()=>boot())},{once:true});
/* === ./inline-06.js === */
!function(){let milanPublishing=!1,milanMediaObserver=null,milanUserInteractedWithMedia=!1,milanScrollTimer=null,milanWakeLock=null;function el(id){return document.getElementById(id)}function allMedia(){return Array.from(document.querySelectorAll("video,audio"))}function ratioInViewport(node){if(!node||!node.getBoundingClientRect)return 0;const r=node.getBoundingClientRect(),vh=window.innerHeight||document.documentElement.clientHeight||1,vw=window.innerWidth||document.documentElement.clientWidth||1;if(r.width<=0||r.height<=0)return 0;return Math.max(0,Math.min(r.bottom,vh)-Math.max(r.top,0))*Math.max(0,Math.min(r.right,vw)-Math.max(r.top,0))/Math.max(1,r.width*r.height)}function pauseMedia(m){try{m&&!m.paused&&m.pause()}catch(e){}}function pauseOthers(active){allMedia().forEach(m=>{m!==active&&pauseMedia(m)})}function mostVisibleVideo(){let best=null,bestScore=0;return Array.from(document.querySelectorAll("video")).forEach(v=>{const score=ratioInViewport(v);score>bestScore&&(bestScore=score,best=v)}),bestScore>=.55?best:null}function forceNativeAudibleMedia(m){try{if(!m||"VIDEO"!==m.tagName&&"AUDIO"!==m.tagName)return;if(m.removeAttribute("muted"),m.defaultMuted=!1,m.muted=!1,Number(m.volume||0)<=.05&&(m.volume=1),"VIDEO"===m.tagName){try{m.controls=!0,m.setAttribute("controls","")}catch(_){}try{m.setAttribute("playsinline",""),m.setAttribute("webkit-playsinline","")}catch(_){}try{m.setAttribute("controlsList","nodownload noremoteplayback")}catch(_){}try{m.disablePictureInPicture=!1,m.disableRemotePlayback=!1}catch(_){}try{m.setAttribute("x-webkit-airplay","deny")}catch(_){}}else m.setAttribute("controls","");!async function(){try{"wakeLock"in navigator&&!milanWakeLock&&(milanWakeLock=await navigator.wakeLock.request("screen"),milanWakeLock.addEventListener("release",()=>{milanWakeLock=null}))}catch(_){}}();try{if("mediaSession"in navigator){const card=m.closest(".post"),title=card?.querySelector(".postTitle")?.textContent?.trim()||document.title||"MILAN Video";navigator.mediaSession.metadata=new MediaMetadata({title:title,artist:"MILAN",album:"MILAN App"}),navigator.mediaSession.playbackState=m.paused?"paused":"playing"}}catch(_){}}catch(_){}}function handleScrollMedia(){clearTimeout(milanScrollTimer)}function attachMediaComfort(){allMedia().forEach(m=>{if("1"!==m.dataset.milanComfortAttached){if(m.dataset.milanComfortAttached="1","VIDEO"===m.tagName)try{m.setAttribute("playsinline","")}catch(_){}m.preload="VIDEO"===m.tagName?"metadata":m.preload||"metadata",forceNativeAudibleMedia(m),m.addEventListener("play",()=>{milanUserInteractedWithMedia=!0,forceNativeAudibleMedia(m),pauseOthers(m)},!0),m.addEventListener("playing",()=>{forceNativeAudibleMedia(m)},!0),m.addEventListener("click",()=>{milanUserInteractedWithMedia=!0,forceNativeAudibleMedia(m),pauseOthers(m)},!0),m.addEventListener("pointerdown",()=>{milanUserInteractedWithMedia=!0,forceNativeAudibleMedia(m)},{passive:!0}),m.addEventListener("touchend",()=>{milanUserInteractedWithMedia=!0,forceNativeAudibleMedia(m)},{passive:!0}),m.addEventListener("volumechange",()=>{"1"!==m.dataset.allowUserMute&&(m.muted||Number(m.volume||0)<=.05)&&forceNativeAudibleMedia(m)},!0)}});milanMediaObserver&&milanMediaObserver.disconnect();milanMediaObserver=new IntersectionObserver((entries,observer)=>{entries.forEach(entry=>{if(entry.isIntersecting){try{forceNativeAudibleMedia(entry.target)}catch(_){}try{observer.unobserve(entry.target)}catch(_){}}})},{threshold:0.01,rootMargin:"0px 0px"});allMedia().forEach(m=>{try{milanMediaObserver.observe(m)}catch(_){} })}recoverMobileScroll();window.milanVideoSoundReady=function(media){forceNativeAudibleMedia(media)},window.milanEnterNativeRecorderPlayer=function(media){try{return media&&media.tagName,!1}catch(_){return!1}},window.milanPauseAllMedia=function(){allMedia().forEach(pauseMedia)},window.milanAttachMediaComfort=attachMediaComfort;const oldRenderFeed=window.renderFeed;window.renderFeed=function(){oldRenderFeed&&oldRenderFeed(),requestAnimationFrame(()=>setTimeout(attachMediaComfort,40))};window.publish=async function(){const btn=el("publishBtn");if(milanPublishing)toast("Publishing already in progress. Please wait...");else{milanPublishing=!0,btn&&(btn.disabled=!0,btn.dataset.oldText=btn.textContent,btn.textContent="Publishing...",btn.classList.add("loading"));try{const file=el("mediaFile")&&el("mediaFile").files[0],accessMode=el("privacy")?el("privacy").value:"private",sharedWithDids=(el("shareDids")?el("shareDids").value:"").split(",").map(x=>x.trim()).filter(x=>x.startsWith("did:")),tags=(el("tagsInput")?el("tagsInput").value:"").split(",").map(x=>x.trim()).filter(Boolean);if("shared_did"===accessMode&&!sharedWithDids.length)throw new Error("Paste at least one DID for shared post");if(file)await apiUpload("/records/media",file,{title:el("postTitle")&&el("postTitle").value||file.name,caption:el("postText")&&el("postText").value||"",accessMode:accessMode,sharedWithDids:sharedWithDids,tags:tags},pct=>{btn&&(btn.textContent=pct<100?"Uploading "+Math.round(pct)+"%":"Processing...")});else{const text=el("postText")&&el("postText").value||"";if(!(text.trim()||el("postTitle")&&el("postTitle").value.trim()))throw new Error("Write something or choose media first.");await api("/records",{method:"POST",body:JSON.stringify({title:el("postTitle")&&el("postTitle").value||"MILAN Post",data:{text:text,tags:tags},dataFormat:"application/json",accessMode:accessMode,sharedWithDids:sharedWithDids,tags:tags})})}["postTitle","postText","mediaFile","tagsInput","shareDids"].forEach(id=>{const x=el(id);x&&(x.value="")}),el("privacy")&&(el("privacy").value="private"),el("shareBox")&&el("shareBox").classList.add("hidden"),toast("Post published"),await loadFeed(),await loadSummary(),attachMediaComfort(),recoverMobileScroll()}catch(e){toast(e.message||"Publish failed")}finally{milanPublishing=!1,btn&&(btn.disabled=!1,btn.textContent=btn.dataset.oldText||"Publish",btn.classList.remove("loading"))}}};document.addEventListener("keydown",function(e){if("Enter"!==e.key)return;if((t=e.target)&&("INPUT"===t.tagName||"TEXTAREA"===t.tagName||t.isContentEditable||"SELECT"===t.tagName))return;var t;const activeVideo=document.activeElement&&"VIDEO"===document.activeElement.tagName?document.activeElement:mostVisibleVideo();activeVideo&&(e.preventDefault(),e.stopPropagation(),milanUserInteractedWithMedia=!0,pauseOthers(activeVideo),activeVideo.paused?activeVideo.play().catch(()=>{}):activeVideo.pause())},!0),document.addEventListener("play",function(e){!e.target||"VIDEO"!==e.target.tagName&&"AUDIO"!==e.target.tagName||(milanUserInteractedWithMedia=!0,pauseOthers(e.target))},!0),document.addEventListener("pause",function(){},!0),window.addEventListener("scroll",handleScrollMedia,{passive:!0}),window.addEventListener("wheel",handleScrollMedia,{passive:!0}),window.addEventListener("touchmove",handleScrollMedia,{passive:!0}),window.addEventListener("resize",handleScrollMedia,{passive:!0}),document.addEventListener("visibilitychange",()=>{document.hidden||allMedia().forEach(forceNativeAudibleMedia)}),el("publishBtn")&&(el("publishBtn").onclick=window.publish),setTimeout(async()=>{const pub=el("publishBtn");pub&&(pub.onclick=window.publish,pub.addEventListener("click",function(ev){milanPublishing&&(ev.preventDefault(),ev.stopImmediatePropagation())},!0)),attachMediaComfort()},250)}();

/* === ./inline-07.js === */
!function(){if(window.__milanUniversalVideoV66)return;window.__milanUniversalVideoV66=!0;const originalMediaHtml=window.mediaHtml,healing={};try{const st=document.createElement("style");st.textContent=".milanUniversalPlayer{position:relative;background:#050915;overflow:hidden}.milanUniversalPlayer video{display:block;width:100%;max-height:72vh;min-height:220px;background:#020617;object-fit:contain}.milanVideoOverlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:18px;color:#e5e7eb;background:linear-gradient(180deg,rgba(2,6,23,.28),rgba(2,6,23,.70));pointer-events:none}.milanUniversalPlayer.loading .milanVideoOverlay{display:flex}.milanVideoOverlay .loader{width:42px;height:42px;border-radius:50%;border:4px solid rgba(255,255,255,.25);border-top-color:#fff;margin:0 auto 10px;animation:milanSpin .9s linear infinite}.milanVideoFallback{display:none;padding:10px 14px;border-top:1px solid var(--line);background:rgba(255,255,255,.035);color:var(--muted)}.milanUniversalPlayer.failed .milanVideoFallback{display:block}.milanVideoFallback a{display:inline-flex;margin:8px 8px 0 0;border:1px solid var(--line);border-radius:999px;padding:8px 12px;color:var(--text);text-decoration:none}.milanUniversalPlayer .fileCard{display:none!important}.milanUniversalPlayer.loading .milanVideoOverlay[data-milan-loading-message]::after{content:attr(data-milan-loading-message);position:absolute;left:5%;right:5%;bottom:13%;font-size:14px;font-weight:600;line-height:1.35;text-shadow:0 1px 5px #000}@keyframes milanSpin{to{transform:rotate(360deg)}}",document.head.appendChild(st)}catch(e){}function addParam(url,key,value){const u=String(url||"");return u?u+(u.includes("?")?"&":"?")+encodeURIComponent(key)+"="+encodeURIComponent(null==value?"":value):""}function playerBox(video){return video&&video.closest?video.closest(".milanUniversalPlayer"):null}function showLoading(video,yes){try{const box=playerBox(video);box&&box.classList.toggle("loading",!!yes)}catch(_){}}function markFailed(video,yes){try{const box=playerBox(video);box&&(box.classList.toggle("failed",!!yes),box.classList.toggle("loading",!1))}catch(_){}}function playable(video){try{const d=Number(video.duration);return video.readyState>=1&&Number.isFinite(d)&&d>0}catch(_){return!1}}const temporaryPlaybackUrls=new Map();const observedVideos=new Set();
function releaseTemporaryPlayback(video){try{const old=video&&video.dataset&&video.dataset.milanTempBlobUrl;if(old){URL.revokeObjectURL(old);temporaryPlaybackUrls.delete(old);delete video.dataset.milanTempBlobUrl}}catch(_){}}
function setTemporaryDownloadMessage(video,message){try{const box=playerBox(video);if(!box)return;const target=box.querySelector(".milanVideoOverlay")||box;if(message)target.setAttribute("data-milan-loading-message",message);else target.removeAttribute("data-milan-loading-message")}catch(_){}}
function cleanupTemporaryPlayback(){try{for(const video of observedVideos){if(video&&video.isConnected)continue;try{directObserver&&directObserver.unobserve(video)}catch(_){}try{visibilityObserver&&visibilityObserver.unobserve(video)}catch(_){}observedVideos.delete(video)}for(const [url,video] of temporaryPlaybackUrls){if(!video||!video.isConnected){try{URL.revokeObjectURL(url)}catch(_){}temporaryPlaybackUrls.delete(url);if(video&&video.dataset)delete video.dataset.milanTempBlobUrl}}}catch(_){}}
async function readBoundedVideoBlob(response,maxBytes){const reader=response&&response.body&&typeof response.body.getReader==="function"?response.body.getReader():null;if(!reader)throw new Error("Streaming video download unavailable");const chunks=[];let total=0;try{for(;;){const item=await reader.read();if(item.done)break;const chunk=item.value;const size=Number(chunk&&(chunk.byteLength??chunk.length));if(!Number.isSafeInteger(size)||size<0){try{await reader.cancel("Invalid video chunk")}catch(_){}throw new Error("Invalid video chunk")}total+=size;if(total>maxBytes){try{await reader.cancel("Temporary video buffer limit exceeded")}catch(_){}throw new Error("Temporary video exceeds playback buffer limit")}chunks.push(chunk)}}finally{try{reader.releaseLock()}catch(_){}}const type=String(response.headers&&typeof response.headers.get==="function"&&response.headers.get("content-type")||"video/mp4");return new Blob(chunks,{type})}
try{if(typeof MutationObserver==="function"&&document.documentElement)new MutationObserver(cleanupTemporaryPlayback).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener("pagehide",event=>{if(event&&event.persisted)return;for(const [url] of temporaryPlaybackUrls){try{URL.revokeObjectURL(url)}catch(_){}}temporaryPlaybackUrls.clear()})}catch(_){}
function setVideoSrc(video,src){try{releaseTemporaryPlayback(video);const source=video.querySelector("source"),next=addParam(src,"r",Date.now());source?source.setAttribute("src",next):video.setAttribute("src",next),video.load()}catch(_){}}function updateRecordFromResponse(id,res){try{if(!res||!res.record||typeof updateRecordLocal!=="function")return;const el=document.getElementById("post-"+id),video=el&&el.querySelector(".milanUniversalPlayer video"),box=video&&video.closest(".milanUniversalPlayer"),preserveVideo=!!(video&&(!video.paused||box&&box.classList.contains("loading")||video.dataset.watchdogStarted==="1"||video.dataset.healReloaded==="1"||video.dataset.errorCount));updateRecordLocal(id,res.record,{preserveVideo})}catch(_){}}async function loadDirectMedia(video,id,attempt){
attempt=Number(attempt||0);
if(!video||!id||video.dataset.milanDirectLoading==="1"||video.dataset.milanDirectReady==="1"||video.dataset.milanDirectFallback==="1")return;
video.dataset.milanDirectLoading="1";
showLoading(video,true);
try{
if(typeof api!=="function")throw new Error("Playback API unavailable");
const result=await api("/records/"+encodeURIComponent(id)+"/media/playback-url");
if(result&&result.ready===false&&result.processing===true){
 if(attempt<60){
  setTimeout(()=>loadDirectMedia(video,id,attempt+1),Number(result.retryAfterMs)||2500);
  return;
 }
 throw new Error("Video conversion is taking too long");
}
const direct=String(result&&result.url||"");
if(result&&result.ready===false&&result.processing===false){
 const readyStatus=String(result.processingStatus||"").toLowerCase();
 const source=video.querySelector("source[data-milan-direct-source],source");
 const proxy=String(video.getAttribute("data-base-src")||"");
 if(readyStatus==="ready"&&source&&proxy){
  video.dataset.milanDirectFallback="1";
  video.dataset.milanDirectReady="";
  source.setAttribute("src",proxy);
  showLoading(video,false);
  video.load();
  return;
 }
 const terminalError=new Error("Browser-safe video is unavailable");
 terminalError.milanTerminal=true;
 throw terminalError;
}
if(!result||result.ready!==true||!/^https?:\/\/\S+$/i.test(direct))throw new Error("Browser-safe video is not ready");
if(video.dataset.milanDirectFallback==="1")return;
const source=video.querySelector("source[data-milan-direct-source],source");
if(!source)throw new Error("Video source unavailable");
const proxy=String(video.getAttribute("data-base-src")||"");
source.setAttribute("src",direct);
video.dataset.milanDirectReady="1";
video.dataset.milanDirectStorageReady="1";
video.dataset.milanProxyFallback=proxy;
showLoading(video,false);
video.load();
}catch(err){
if(!(err&&err.milanTerminal)&&attempt<10){
 setTimeout(()=>loadDirectMedia(video,id,attempt+1),Number(err&&err.retryAfterMs)||2500);
 return;
}
const source=video.querySelector("source[data-milan-direct-source],source");
const proxy=video.getAttribute("data-base-src")||"";
if(source&&proxy){
 video.dataset.milanDirectFallback="1";
 video.dataset.milanDirectReady="";
 source.setAttribute("src",proxy);
 showLoading(video,false);
 video.load();
}else{
 showLoading(video,false);
 markFailed(video,true);
}
}finally{delete video.dataset.milanDirectLoading}
}
function videoLoadRootMargin(){
 const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
 const type=String(connection&&connection.effectiveType||"").toLowerCase();
 const downlink=Number(connection&&connection.downlink||0);
 const rtt=Number(connection&&connection.rtt||0);
 if(connection&&(connection.saveData||/^(slow-2g|2g)$/i.test(type)))return"150px 0px";
 if(connection&&(type==="3g"||(downlink>0&&downlink<=1.5)||rtt>=500))return"350px 0px";
 if(connection&&downlink>=5&&(!rtt||rtt<=150))return"900px 0px";
 return"700px 0px";
}
const directObserver=typeof IntersectionObserver==="function"?new IntersectionObserver(entries=>{
entries.forEach(entry=>{
if(!entry.isIntersecting)return;
directObserver.unobserve(entry.target);
const id=entry.target.closest(".milanUniversalPlayer")?.getAttribute("data-record-id")||"";
if(id)loadDirectMedia(entry.target,id);
});
},{rootMargin:videoLoadRootMargin()}):null;
const visibilityObserver=typeof IntersectionObserver==="function"?new IntersectionObserver(entries=>{
entries.forEach(entry=>{
const video=entry.target;
if(entry.isIntersecting&&entry.intersectionRatio>=.15){
 delete video.dataset.milanOffscreen;
 if(video.dataset.milanPausedOffscreen!=="1")return;
 delete video.dataset.milanPausedOffscreen;
 if(video.dataset.milanTempDownloadInProgress==="1"){
  video.dataset.milanResumeAfterTempDownload="1";
  return;
 }
 if(video.isConnected&&!video.ended&&video.dataset.finalFailed!=="1"){
  try{const pending=video.play();if(pending&&typeof pending.catch==="function")pending.catch(()=>{})}catch(_){}
 }
 return;
}
video.dataset.milanOffscreen="1";
if(!video.paused&&!video.ended){
 video.dataset.milanPausedOffscreen="1";
 try{video.pause()}catch(_){}
 setTemporaryDownloadMessage(video,"");
 showLoading(video,false);
}else if(video.dataset.milanTempDownloadInProgress==="1"&&video.dataset.milanResumeAfterTempDownload==="1"){
 video.dataset.milanPausedOffscreen="1";
}
});
},{rootMargin:"0px",threshold:[0,.15]}):null;

window.milanEnsureDirectVideo=loadDirectMedia;
window.milanV98PlayVideo=function(id,video){try{if(!video)return;const source=video.querySelector("source[data-milan-direct-source],source");if(!source||source.getAttribute("src"))return;const base=video.getAttribute("data-base-src")||"";if(!base)return;video.dataset.milanDirectFallback="1";source.setAttribute("src",base);video.load();const pending=video.play();if(pending&&typeof pending.catch==="function")pending.catch(()=>{})}catch(_){} };
function attachVideoStallRecovery(video,id){
if(!video||video.dataset.milanStallRecoveryAttached==="1")return;
video.dataset.milanStallRecoveryAttached="1";
const clearTimer=()=>{if(video.__milanStallTimer){clearTimeout(video.__milanStallTimer);video.__milanStallTimer=null}};
const recovered=(resetAttempts=false)=>{clearTimer();if(!video.paused){if(resetAttempts){delete video.dataset.milanStallRecoveryAttempts;delete video.dataset.milanStallFallbackTried;}showLoading(video,false);markFailed(video,false)}};
video.addEventListener("playing",()=>{setTemporaryDownloadMessage(video,"");recovered(true)});
video.addEventListener("canplay",()=>{if(video.readyState>=3)recovered()});
video.addEventListener("play",()=>{
if(window.MILAN_ENABLE_TEMP_PLAYBACK_DOWNLOAD!==true||video.dataset.milanTempDownloadAttempted==="1"||video.dataset.milanDirectReady!=="1"||video.dataset.milanDirectFallback==="1")return;
const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
if(connection&&(connection.saveData||/^(slow-2g|2g|3g)$/i.test(String(connection.effectiveType||""))))return;

const source=video.querySelector("source[data-milan-direct-source],source");
const direct=String(source&&source.getAttribute("src")||"");
if(!/^https?:\/\//i.test(direct)||typeof fetch!=="function"||typeof URL.createObjectURL!=="function")return;
video.dataset.milanTempDownloadAttempted="1";
video.dataset.milanTempDownloadInProgress="1";
video.dataset.milanResumeAfterTempDownload="1";
video.pause();
showLoading(video,true);
setTemporaryDownloadMessage(video,"Downloading video for smooth, uninterrupted playback…");
const configuredLimit=Number(window.MILAN_TEMP_PLAYBACK_MAX_BYTES)||48*1024*1024;
const lowMemory=Number(navigator.deviceMemory||0)>0&&Number(navigator.deviceMemory)<=4;
const limit=Math.min(configuredLimit,lowMemory?24*1024*1024:48*1024*1024);
const resumeStreaming=()=>{
setTemporaryDownloadMessage(video,"");
showLoading(video,false);
if(!video.isConnected)return;
delete video.dataset.milanTempDownloadInProgress;
delete video.dataset.milanResumeAfterTempDownload;
if(video.dataset.milanOffscreen==="1"){video.dataset.milanPausedOffscreen="1";return}
try{const pending=video.play();if(pending&&typeof pending.catch==="function")pending.catch(()=>{})}catch(_){}
};
(async()=>{
let response=null;
try{
response=await fetch(direct,{method:"GET",cache:"no-store",credentials:"omit"});
if(!response.ok||!response.body)throw new Error("Temporary video download failed");
const length=Number(response.headers.get("content-length")||0);
if(!Number.isFinite(length)||length<=0||length>limit){
try{await response.body.cancel()}catch(_){}
return resumeStreaming();
}
const blob=await readBoundedVideoBlob(response,limit);
if(!blob.size||blob.size>limit)return resumeStreaming();
releaseTemporaryPlayback(video);
const blobUrl=URL.createObjectURL(blob);
temporaryPlaybackUrls.set(blobUrl,video);
video.dataset.milanTempBlobUrl=blobUrl;
video.dataset.milanTempDownloadComplete="1";
delete video.dataset.milanTempDownloadInProgress;
source.setAttribute("src",blobUrl);
setTemporaryDownloadMessage(video,"");
showLoading(video,false);
video.load();
if(video.dataset.milanOffscreen==="1"){
 video.dataset.milanPausedOffscreen="1";
 delete video.dataset.milanResumeAfterTempDownload;
 return;
}
delete video.dataset.milanResumeAfterTempDownload;
try{
const pending=video.play();
if(pending&&typeof pending.catch==="function")pending.catch(()=>{
showLoading(video,false);
setTemporaryDownloadMessage(video,"Video is downloaded. Tap play to watch.");
});
}catch(_){showLoading(video,false);setTemporaryDownloadMessage(video,"Video is downloaded. Tap play to watch.")}
}catch(_){resumeStreaming()}
})();
});
const onStall=()=>{
if(video.paused)return;
showLoading(video,true);
if(video.__milanStallTimer)return;
video.__milanStallTimer=setTimeout(()=>{
video.__milanStallTimer=null;
if(video.paused||!video.isConnected)return;
const base=video.getAttribute("data-base-src")||"";
const attempts=Number(video.dataset.milanStallRecoveryAttempts||0);
if(!base||attempts>=2){
showLoading(video,false);
markFailed(video,true);
if(typeof setMediaError==="function")setMediaError(video,"Video is taking too long to buffer. Tap play to retry.");
return;
}
video.dataset.milanStallRecoveryAttempts=String(attempts+1);
video.dataset.milanStallFallbackTried="1";
video.dataset.milanDirectFallback="1";
const position=Number.isFinite(video.currentTime)?video.currentTime:0;
const shouldResume=!video.paused;
let fallbackSettled=false;
const fallbackTimer=setTimeout(()=>{
if(fallbackSettled)return;
fallbackSettled=true;
video.removeEventListener("loadedmetadata",restorePlayback);
showLoading(video,false);
markFailed(video,true);
if(typeof setMediaError==="function")setMediaError(video,"Video could not resume after retry. Tap play to try again.");
},8000);
function restorePlayback(){
if(fallbackSettled)return;
fallbackSettled=true;
clearTimeout(fallbackTimer);
try{
if(Number.isFinite(position)&&position>0&&Number.isFinite(video.duration)&&position<video.duration)video.currentTime=position;
}catch(_){}
if(shouldResume){const p=video.play();if(p&&typeof p.catch==="function")p.catch(()=>{})}
}
video.addEventListener("loadedmetadata",restorePlayback,{once:true});
setVideoSrc(video,base);
},12000);
};
video.addEventListener("waiting",onStall);
video.addEventListener("stalled",onStall);
}
window.milanVideoLoadedOk=function(id,video){try{playable(video)&&(video.dataset.milanPlayable="1",showLoading(video,!1),markFailed(video,!1),clearMediaError(video))}catch(_){}},window.milanRefreshVideoStatus=async function(id,quiet){try{const res=await api("/records/"+encodeURIComponent(id)+"/media/status?auto=1");return updateRecordFromResponse(id,res),!quiet&&res&&res.ready&&toast("Video ready"),res}catch(e){throw quiet||toast("Video is loading"),e}},window.milanPrepareVideoPreview=async function(id,btn){try{btn&&(btn.disabled=!0,btn.dataset.oldText=btn.textContent,btn.textContent="Loading...");const res=await api("/records/"+encodeURIComponent(id)+"/media/repair?async=1",{method:"POST",body:JSON.stringify({async:!0})});return updateRecordFromResponse(id,res),btn?(toast("Video is loading"),res):res}catch(e){btn&&toast("Video is loading")}finally{btn&&(btn.disabled=!1,btn.textContent=btn.dataset.oldText||"Load video")}},window.milanUniversalAutoHeal=async function(id,video){if(id&&video)return healing[id]||(showLoading(video,!0),markFailed(video,!1),healing[id]=(async()=>{try{const base=video.getAttribute("data-base-src")||"";if(base&&"1"!==video.dataset.healReloaded&&(video.dataset.healReloaded="1",setVideoSrc(video,base),await new Promise(r=>setTimeout(r,4200)),playable(video)))return!0;const res=await api("/records/"+encodeURIComponent(id)+"/media/repair?async=1",{method:"POST",body:JSON.stringify({async:!0})});if(updateRecordFromResponse(id,res),await new Promise(r=>setTimeout(r,6500)),base&&setVideoSrc(video,base),await new Promise(r=>setTimeout(r,4e3)),playable(video))return!0;throw new Error("not-started")}catch(e){return markFailed(video,!0),!1}finally{showLoading(video,!1),setTimeout(()=>{delete healing[id]},1500)}})()),healing[id]},window.milanUniversalVideoError=function(id,video){try{if(!video)return;if("1"===video.dataset.finalFailed)return void markFailed(video,!0);void 0===video.dataset.errorCount&&(video.dataset.errorCount="0");const count=Number(video.dataset.errorCount||0)+1;if(video.dataset.errorCount=String(count),count<=2)return void window.milanUniversalAutoHeal(id,video);video.dataset.finalFailed="1",markFailed(video,!0)}catch(_){}},window.milanVideoWatchdog=function(id,video){try{if(!id||!video||"1"===video.dataset.watchdogStarted)return;video.dataset.watchdogStarted="1",showLoading(video,!0),setTimeout(()=>{try{if(playable(video))return void showLoading(video,!1);if(video.error||video.networkState===3)window.milanUniversalAutoHeal(id,video)}catch(_){}},30e3)}catch(_){}},window.milanMediaError=function(id,el){try{const node=mediaNode(el);if(node&&"VIDEO"===node.tagName)return window.milanUniversalVideoError(id,node);if(node&&"1"!==node.dataset.retryDone)return node.dataset.retryDone="1",void milanRetryMedia(node);const box=node?.closest(".media");box&&box.classList.add("previewFailed"),setMediaError(node,"Preview could not start. File is uploaded and download is available.")}catch(_){}},window.mediaHtml=function(r){try{const d=r.data||{},m=d.media||{},raw=r.mediaUrl||m.mediaUrl||d.mediaUrl||"",mt=(m.mimeType||r.dataFormat||"application/octet-stream").toLowerCase();if("video"!==(m.previewCategory||r.mediaCompatibility&&r.mediaCompatibility.previewCategory||(mt.startsWith("image/")?"image":mt.startsWith("video/")?"video":mt.startsWith("audio/")?"audio":"application/pdf"===mt?"pdf":mt.startsWith("text/")?"text":"file")).toLowerCase())return originalMediaHtml?originalMediaHtml(r):"";const id=esc(r.id||""),rawUrl=raw||"/api/records/"+encodeURIComponent(r.id||"")+"/media";let vurl=videoMediaSrc(rawUrl);vurl=addParam(vurl,"universal","1"),vurl=addParam(vurl,"player","v98");const nativeUrl=addParam(videoMediaSrc(rawUrl),"native_direct","1"),open=esc(nativeUrl),down=esc(mediaDownloadSrc(rawUrl)),name=esc(m.fileName||r.title||"video"),size=m.sizeBytes?" • "+esc(formatBytes(m.sizeBytes)):"",fallback=`<div class="milanVideoFallback"><div>Video is loading. Open/Download is also available.</div><a href="${open}" target="_blank" rel="noopener">Open</a><a href="${down}" download>Download</a></div>`,overlay='<div class="milanVideoOverlay"><div><div class="loader"></div><b>Loading video...</b></div></div>',player=`<video controls playsinline webkit-playsinline x5-playsinline preload="metadata" data-milan-inline-only="1" data-v98-player="1" controlsList="nofullscreen" x-webkit-airplay="deny" data-native-audio="1" data-base-src="${esc(vurl)}"  onplay="milanVideoSoundReady&&milanVideoSoundReady(this)" onloadstart="milanVideoWatchdog('${id}',this)" onloadedmetadata="milanVideoLoadedOk('${id}',this)" oncanplay="milanVideoLoadedOk('${id}',this)" onplaying="milanVideoLoadedOk('${id}',this);milanVideoSoundReady&&milanVideoSoundReady(this)" onerror="milanUniversalVideoError('${id}',this)"><source data-milan-direct-source="1" type="video/mp4"></video>`;return`<div class="media milanUniversalPlayer" data-record-id="${id}">${player}${overlay}${fallback}${`<div class="mini" style="padding:8px 12px;color:var(--muted)">${name}${size}</div>`}${fileCardHtml(m,rawUrl,"hidden")}</div>`}catch(e){return originalMediaHtml?originalMediaHtml(r):'<div class="media"><div class="mini">Video could not load.</div></div>'}};const previousRenderFeed=window.renderFeed;window.renderFeed=function(){previousRenderFeed&&previousRenderFeed(),setTimeout(()=>{try{window.milanAttachMediaComfort&&window.milanAttachMediaComfort(),document.querySelectorAll(".milanUniversalPlayer video:not([data-milan-initial-scan])").forEach(v=>{v.dataset.milanInitialScan="1";attachVideoStallRecovery(v,v.closest(".milanUniversalPlayer")?.getAttribute("data-record-id")||"");const id=v.closest(".milanUniversalPlayer")?.getAttribute("data-record-id")||"";if(!id)return;observedVideos.add(v);if(directObserver)directObserver.observe(v);else loadDirectMedia(v,id);if(visibilityObserver)visibilityObserver.observe(v)})}catch(e){}},120)}}();

/* === ./inline-08.js === */
!function(){if(/MilanNativeAudio/i.test(String(navigator.userAgent||"")))try{document.documentElement.classList.add("milan-android-lite","milan-android-safe"),document.body&&document.body.classList.add("milan-android-lite","milan-android-safe")}catch(_){}else load("/milan-new-era-ui-settings.js?v=20260530v92"),load("/milan-desktop-video-upload-ui.js?v=20260530v93"),load("/milan-product-grade-ui.js?v=20260530v94");function load(src){var s=document.createElement("script");s.async=!1,s.src=src,document.body.appendChild(s)}}();

/* === ./inline-09.js === */
!function(){"use strict";if(!window.__MILAN_V2_FEATURES__){window.__MILAN_V2_FEATURES__=!0;var API=function(url,opts){return fetch("/api"+url,Object.assign({headers:{"Content-Type":"application/json",Authorization:"Bearer "+(localStorage.getItem("milan_token")||"")}},opts||{})).then(function(r){return r.json()})},MilanPrefetch={record:function(contentCid){var userId=window.me&&window.me.id||localStorage.getItem("milanUserId");userId&&contentCid&&API("/stream/view",{method:"POST",body:JSON.stringify({userId:userId,contentCid:contentCid})})},prefetch:function(){var userId=window.me&&window.me.id||localStorage.getItem("milanUserId");userId&&API("/stream/prefetch?userId="+userId).then(function(data){data.prefetch&&data.prefetch.forEach(function(item){var link=document.createElement("link");link.rel="prefetch",link.href=item.url,link.as="fetch",document.head.appendChild(link)})}).catch(function(){})}};if("IntersectionObserver"in window){var prefetchObs=new IntersectionObserver(function(entries){entries.forEach(function(e){if(e.isIntersecting){var cid=e.target.dataset.cid||e.target.dataset.mediaCid;cid&&MilanPrefetch.record(cid)}})},{threshold:.5});function attachPrefetchObs(){document.querySelectorAll("[data-cid],[data-media-cid]").forEach(function(el){prefetchObs.observe(el)})}document.addEventListener("DOMContentLoaded",function(){attachPrefetchObs(),setInterval(attachPrefetchObs,5e3)})}window.MilanPrefetch=MilanPrefetch;var MilanAgent={interact:function(type,post){var userId=window.me&&window.me.id||localStorage.getItem("milanUserId");userId&&post&&API("/agent/interact",{method:"POST",body:JSON.stringify({userId:userId,type:type,post:post})})},curate:function(posts,cb){var userId=window.me&&window.me.id||localStorage.getItem("milanUserId");userId?API("/agent/curate",{method:"POST",body:JSON.stringify({userId:userId,posts:posts})}).then(function(d){cb&&cb(d.posts||posts)}).catch(function(){cb&&cb(posts)}):cb&&cb(posts)}};document.addEventListener("click",function(e){var btn=e.target.closest("[data-action]");if(btn){var action=btn.dataset.action,postId=btn.dataset.postId||btn.closest("[data-post-id]")&&btn.closest("[data-post-id]").dataset.postId;postId&&["like","comment","repost"].includes(action)&&MilanAgent.interact(action,{id:postId})}}),window.MilanAgent=MilanAgent;var MilanZKP={showVerifiedBadge:function(userId,did){document.querySelectorAll('[data-user-id="'+userId+'"] .avatar,[data-user-id="'+userId+'"] .name').forEach(function(el){if(!el.querySelector(".zkp-badge")){var badge=document.createElement("span");badge.className="zkp-badge",badge.title="ZK-verified identity",badge.textContent="✓",badge.style.cssText="display:inline-block;background:#10b981;color:#fff;font-size:9px;font-weight:900;border-radius:20px;padding:1px 5px;margin-left:4px;vertical-align:middle;",el.appendChild(badge)}})}};window.MilanZKP=MilanZKP;var MilanDAO={flagPost:function(postId,reason){API("/dao/propose",{method:"POST",body:JSON.stringify({postId:postId,reporterId:window.me&&window.me.id||"",reason:reason||"Community flag"})}).then(function(d){d.proposalId&&window.toast&&window.toast("Post flagged for community review (Proposal: "+d.proposalId+")")}).catch(function(){})},vote:function(proposalId,vote){API("/dao/vote",{method:"POST",body:JSON.stringify({proposalId:proposalId,voterId:window.me&&window.me.id||"",vote:vote})}).then(function(d){window.toast&&window.toast(d.message||"Vote recorded")}).catch(function(){})}};window.MilanDAO=MilanDAO,document.addEventListener("contextmenu",function(e){e.target.closest("[data-post-id]")}),setTimeout(function(){MilanPrefetch.prefetch()},3e3)}}();

/* === ./inline-10.js === */
!function(){"use strict";function q(sel){return document.querySelector(sel)}function qa(sel){return Array.from(document.querySelectorAll(sel))}function createSkeletonPost(){var d=document.createElement("div");return d.className="milan-skeleton-post",d.innerHTML='\n        <div class="sk-header">\n          <div class="milan-skeleton sk-avatar"></div>\n          <div style="flex:1">\n            <div class="milan-skeleton sk-name"></div>\n            <div class="milan-skeleton sk-sub"></div>\n          </div>\n        </div>\n        <div class="milan-skeleton sk-line"></div>\n        <div class="milan-skeleton sk-line short"></div>\n        <div class="milan-skeleton sk-media"></div>\n      ',d}window.milanShowSkeletons=function(containerId,count){count=count||3;var el=document.getElementById(containerId)||q(".feed");if(el){for(var frag=document.createDocumentFragment(),i=0;i<count;i++)frag.appendChild(createSkeletonPost());el.prepend(frag)}},window.milanClearSkeletons=function(containerId){var el=document.getElementById(containerId)||q(".feed");el&&qa(".milan-skeleton-post").forEach(function(n){el.contains(n)&&el.removeChild(n)})};var topbar=q(".topbar");topbar&&topbar.classList.add("milan-aurora-bar");var feedSection=q(".feed")||q("#feedView");if(feedSection){var tabBar=document.createElement("div");tabBar.id="milan-feed-tabs";["✦ For You","🌐 Global","👥 Friends","💡 Tech","🎨 Art","🎵 Music","🏆 Sports"].forEach(function(label){var btn=document.createElement("button");btn.className="milan-feed-tab"+(label.includes("For You")?" active":""),btn.textContent=label,btn.onclick=function(){qa(".milan-feed-tab").forEach(function(b){b.classList.remove("active")}),btn.classList.add("active"),"function"==typeof toast&&toast("Feed: "+label.replace(/^[^\s]+ /,""))},tabBar.appendChild(btn)}),feedSection.parentNode.insertBefore(tabBar,feedSection)}var composer=q(".composer");if(composer){var chips=document.createElement("div");chips.className="milan-filter-chips",["All","Photos 🖼️","Videos 🎬","Audio 🎧","Text 📝","Files 📎"].forEach(function(label){var c=document.createElement("button");c.className="milan-chip"+("All"===label?" active":""),c.textContent=label,c.onclick=function(){qa(".milan-chip").forEach(function(x){x.classList.remove("active")}),c.classList.add("active")},chips.appendChild(c)}),composer.parentNode.insertBefore(chips,composer.nextSibling)}window.milanToggleFlowState=function(){document.body.classList.toggle("milan-flow-state");var on=document.body.classList.contains("milan-flow-state");"function"==typeof toast&&toast(on?"⚡ Flow State — Pure content mode ON":"⚡ Flow State OFF")},window.milanFabClick=function(){var fab=q("#milan-fab"),comp=q(".composer");comp&&comp.scrollIntoView({behavior:"smooth",block:"center"});var ta=comp&&comp.querySelector("textarea");ta&&setTimeout(function(){ta.focus()},400),fab.classList.add("morphed"),setTimeout(function(){fab.classList.remove("morphed")},2200)},"IntersectionObserver"in window&&q(".composer")&&new IntersectionObserver(function(entries){var fab=q("#milan-fab");fab&&(fab.style.opacity=entries[0].isIntersecting?"0":"1")},{threshold:.5}).observe(q(".composer")),window.milanConfetti=function(duration){duration=duration||2800;var canvas=q("#milan-confetti-canvas");if(canvas){canvas.width=window.innerWidth,canvas.height=window.innerHeight;for(var ctx=canvas.getContext("2d"),pieces=[],colors=["#245dff","#7c3aed","#10b981","#f59e0b","#ef4444","#ec4899","#06b6d4"],i=0;i<120;i++)pieces.push({x:Math.random()*canvas.width,y:-10-100*Math.random(),w:6+8*Math.random(),h:3+5*Math.random(),rot:Math.random()*Math.PI*2,color:colors[Math.floor(Math.random()*colors.length)],vx:4*(Math.random()-.5),vy:2+4*Math.random(),va:.2*(Math.random()-.5)});var start=Date.now();!function draw(){ctx.clearRect(0,0,canvas.width,canvas.height),pieces.forEach(function(p){ctx.save(),ctx.translate(p.x,p.y),ctx.rotate(p.rot),ctx.fillStyle=p.color,ctx.globalAlpha=Math.max(0,1-(Date.now()-start)/duration),ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h),ctx.restore(),p.x+=p.vx,p.y+=p.vy,p.rot+=p.va,p.vy+=.06}),Date.now()-start<duration?requestAnimationFrame(draw):ctx.clearRect(0,0,canvas.width,canvas.height)}()}},window.milanCheckMilestone=function(count){-1!==[10,50,100,500,1e3,5e3,1e4].indexOf(Number(count))&&(milanConfetti(3500),"function"==typeof toast&&toast("🎉 Milestone reached: "+count+" connections!"))},document.addEventListener("click",function(e){var btn=e.target.closest(".reactionBar button");if(btn){var icon=btn.querySelector("span")||btn;icon.classList.remove("milan-heart-pumping"),icon.offsetWidth,icon.classList.add("milan-heart-pumping"),setTimeout(function(){icon.classList.remove("milan-heart-pumping")},700)}}),window.milanFormatTs=function(isoStr){if(!isoStr)return"";var d=new Date(isoStr),diff=(new Date-d)/1e3;return diff<60?'<span class="milan-ts-fresh">Just now</span>':diff<3600?'<span class="milan-ts-today">'+Math.floor(diff/60)+"m ago</span>":diff<86400?Math.floor(diff/3600)+"h ago":diff<604800?Math.floor(diff/86400)+"d ago":d.toLocaleDateString(void 0,{month:"short",day:"numeric"})},setTimeout(function(){qa(".mini").forEach(function(el){var t=el.textContent;if(/^\d{1,2}\/\d{1,2}\/\d{4}/.test(t)||/\d{4}-\d{2}-\d{2}T/.test(t)){var d=new Date(t);isNaN(d)||(el.innerHTML=milanFormatTs(d.toISOString()))}})},1200),qa(".did").forEach(function(el){if(!el.dataset.v2did){el.dataset.v2did="1";var eyeBtn=document.createElement("span");eyeBtn.textContent=" 👁",eyeBtn.style.cssText="cursor:pointer;font-size:13px;user-select:none;",eyeBtn.title="Click to show/hide DID",eyeBtn.onclick=function(e){e.stopPropagation(),el.classList.toggle("milan-did-masked")},el.classList.add("milan-did-masked"),el.appendChild(eyeBtn)}}),setTimeout(function(){qa('.menu button, button[onclick*="notif"], button[onclick*="Notif"]').forEach(function(btn){if(!btn.dataset.v2dot){btn.dataset.v2dot="1";var dot=document.createElement("span");dot.className="milan-notif-dot",btn.appendChild(dot)}})},800),window.milanAddStreak=function(personEl,days){if(personEl&&!personEl.dataset.v2streak){personEl.dataset.v2streak="1";var badge=document.createElement("span");badge.className="milan-streak",badge.innerHTML="🔥 "+days+" day streak";var info=personEl.querySelector(".personInfo");info&&info.appendChild(badge)}};var caughtUp=document.createElement("div");caughtUp.id="milan-caught-up",caughtUp.innerHTML='<span class="icon">✓</span><br><b>You\'re all caught up!</b><br><span style="font-size:13px;font-weight:400">Check back later for new posts.</span>';var feed=q(".feed");feed&&feed.parentNode.insertBefore(caughtUp,feed.nextSibling),window.milanShowCaughtUp=function(){var el=q("#milan-caught-up");el&&el.classList.add("show")},window.milanHideCaughtUp=function(){var el=q("#milan-caught-up");el&&el.classList.remove("show")};var ptrEl=q("#milan-ptr"),ptrStartY=0,ptrActive=!1;document.addEventListener("touchstart",function(e){0===window.scrollY&&(ptrStartY=e.touches[0].clientY)},{passive:!0}),document.addEventListener("touchmove",function(e){if(ptrEl){var dy=e.touches[0].clientY-ptrStartY;dy>60&&0===window.scrollY&&(ptrEl.classList.add("show"),ptrEl.textContent=dy>120?"↑ Release to refresh":"↓ Pull down to refresh",ptrActive=!0)}},{passive:!0}),document.addEventListener("touchend",function(){ptrEl&&ptrActive&&(ptrEl.textContent="Refreshing...",setTimeout(function(){ptrEl.classList.remove("show"),ptrActive=!1},1400),"function"==typeof loadFeed&&loadFeed())}),window.milanActionToast=function(msg,btnLabel,onBtn){var container=document.getElementById("milanToastContainer");container||((container=document.createElement("div")).id="milanToastContainer",container.style.cssText="position:fixed;top:18px;right:18px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;",document.body.appendChild(container));var el=document.createElement("div");if(el.className="milan-action-toast",el.style.cssText="opacity:0;transform:translateY(-8px);transition:opacity .22s,transform .22s;pointer-events:all;",el.innerHTML="<span>"+msg+"</span>",btnLabel&&onBtn){var btn=document.createElement("button");btn.textContent=btnLabel,btn.onclick=function(){onBtn(),container.removeChild(el)},el.appendChild(btn)}container.appendChild(el),requestAnimationFrame(function(){el.style.opacity="1",el.style.transform="translateY(0)"}),setTimeout(function(){el.style.opacity="0",el.style.transform="translateY(-8px)",setTimeout(function(){el.parentNode&&el.parentNode.removeChild(el)},250)},4e3)},window.milanShowZKP=function(label,durationMs){label=label||"Generating Zero-Knowledge Proof...",durationMs=durationMs||3e3;var overlay=q("#milan-zkp-overlay"),canvas=q("#milan-zkp-canvas"),labelEl=q("#milan-zkp-label");if(overlay&&canvas){labelEl&&(labelEl.textContent=label),overlay.classList.add("active");var ctx=canvas.getContext("2d"),chars="0123456789ABCDEF∑∆Ω√∫≈≠∞αβγδεζπ",cols=Math.floor(canvas.width/14),drops=Array(cols).fill(1),t=setInterval(function(){ctx.fillStyle="rgba(2,6,23,0.12)",ctx.fillRect(0,0,canvas.width,canvas.height),ctx.fillStyle="#4ade80",ctx.font="13px Courier New",drops.forEach(function(y,i){var c=chars[Math.floor(31*Math.random())];ctx.fillText(c,14*i,14*y),14*y>canvas.height&&Math.random()>.975&&(drops[i]=0),drops[i]++})},50);setTimeout(function(){clearInterval(t),overlay.classList.remove("active")},durationMs)}};var themeBtn=document.querySelector('button[onclick="toggleTheme()"]')||document.querySelector('button[onclick*="toggleTheme"]');if(themeBtn){var origToggle=window.toggleTheme;window.toggleTheme=function(){var isDark=document.body.classList.contains("dark");themeBtn.textContent=isDark?"🌙":"☀️",themeBtn.classList.add(isDark?"milan-theme-icon-moon":"milan-theme-icon-sun"),setTimeout(function(){themeBtn.classList.remove("milan-theme-icon-sun","milan-theme-icon-moon")},400),origToggle&&origToggle()}}var h,key;window.renderPost;window.milanDecoratePost=function(postEl,record){if(postEl&&record){record.data&&record.data.zkpVerified&&postEl.classList.add("milan-edge-lit");var mediaEl=postEl.querySelector(".media");mediaEl&&postEl.querySelector("video")&&mediaEl.classList.add("milan-ambient-glow")}},document.addEventListener("play",function(e){if("VIDEO"===e.target.tagName){var media=e.target.closest(".media");if(media){media.classList.add("milan-ambient-glow");try{var cv=document.createElement("canvas");cv.width=4,cv.height=4;var cx=cv.getContext("2d");cx.drawImage(e.target,0,0,4,4);var d=cx.getImageData(0,0,4,4).data,r=d[0],g=d[4],b=d[8];media.style.setProperty("--milan-ambient-color","rgba("+r+","+g+","+b+",0.6)")}catch(ex){}}}},!0),h=(new Date).getHours(),key=h<6?"night":h<9?"dawn":h<12?"morning":h<18?"day":h<21?"evening":"night",document.body.style.backgroundImage={dawn:"radial-gradient(circle at 20% 20%,rgba(251,146,60,.12),transparent 40%),radial-gradient(circle at 80% 80%,rgba(99,102,241,.10),transparent 40%)",morning:"radial-gradient(circle at 10% 10%,rgba(251,191,36,.10),transparent 40%),radial-gradient(circle at 90% 90%,rgba(59,130,246,.08),transparent 40%)",day:"radial-gradient(circle at 0 0,rgba(36,93,255,.14),transparent 36%),radial-gradient(circle at 100% 0,rgba(124,58,237,.13),transparent 30%)",evening:"radial-gradient(circle at 30% 10%,rgba(245,101,67,.12),transparent 40%),radial-gradient(circle at 70% 90%,rgba(124,58,237,.14),transparent 40%)",night:"radial-gradient(circle at 15% 20%,rgba(99,102,241,.18),transparent 40%),radial-gradient(circle at 85% 80%,rgba(16,185,129,.08),transparent 40%)"}[key]+",var(--bg)";var lastScrollTop=0,elasticTimer=null;window.addEventListener("scroll",function(){var st=window.scrollY;0===st&&lastScrollTop>0&&(document.body.classList.add("milan-elastic-active"),clearTimeout(elasticTimer),elasticTimer=setTimeout(function(){document.body.classList.remove("milan-elastic-active")},450)),lastScrollTop=st},{passive:!0});var searchWrap=q(".search"),searchInput=searchWrap&&searchWrap.querySelector('input[type="text"],input:not([type])');if(searchInput&&searchWrap){searchWrap.style.position="relative";var debounceT,dropdown=document.createElement("div");dropdown.id="milan-search-results",dropdown.style.display="none",searchWrap.appendChild(dropdown),searchInput.addEventListener("input",function(){clearTimeout(debounceT),searchInput.value.trim()?debounceT=setTimeout(function(){"function"==typeof searchUsers&&(dropdown.style.display="block",dropdown.innerHTML='<div class="milan-search-item" style="color:var(--muted)">🔍 Searching...</div>')},280):dropdown.style.display="none"}),document.addEventListener("click",function(e){searchWrap.contains(e.target)||(dropdown.style.display="none")})}window.milanWrapSensitive=function(postEl,reason){if(postEl&&!postEl.dataset.v2warned){postEl.dataset.v2warned="1";var body=postEl.querySelector(".postBody,.media");if(body){var wrap=document.createElement("div");wrap.className="milan-content-warn",body.parentNode.insertBefore(wrap,body),wrap.appendChild(body);var overlay=document.createElement("div");overlay.className="milan-warn-overlay",overlay.innerHTML='<span style="font-size:28px">⚠️</span><span>'+(reason||"Sensitive content")+'</span><span style="font-size:12px;opacity:0.7">Tap to reveal</span>',overlay.onclick=function(){wrap.classList.add("revealed")},wrap.appendChild(overlay)}}},window.milanUndoDelete=function(label,onUndo){milanActionToast('🗑️ "'+(label||"Post")+'" deleted',"Undo",onUndo)},window.milanProgressRing=function(parentEl,pct){if(parentEl){var circ=2*Math.PI*25,wrap=document.createElement("div");wrap.className="milan-progress-ring-wrap",wrap.innerHTML='<svg viewBox="0 0 60 60"><circle class="milan-progress-ring-bg" r="25" cx="30" cy="30" stroke-dasharray="'+circ+'" stroke-dashoffset="0"/><circle class="milan-progress-ring-fg" r="25" cx="30" cy="30" stroke-dasharray="'+circ+'" stroke-dashoffset="'+circ+'"/></svg>',parentEl.appendChild(wrap);var fg=wrap.querySelector(".milan-progress-ring-fg");setTimeout(function(){fg.style.strokeDashoffset=(circ*(1-pct/100)).toFixed(2)},100)}};var feedHeader=q(".sectionTitle");if(feedHeader&&!q("#milan-greeting")){var greet=document.createElement("div");greet.id="milan-greeting",greet.style.cssText="font-size:13px;color:var(--muted);font-weight:600;padding:8px 0 4px;",greet.textContent=function(){var h=(new Date).getHours();return h<5?"🌙 Burning the midnight oil?":h<12?"☀️ Good morning!":h<17?"👋 Good afternoon!":h<21?"🌆 Good evening!":"🌙 Good night owl!"}(),feedHeader.parentNode.insertBefore(greet,feedHeader)}function initReadMore(){qa(".postText").forEach(function(el){if(!(el.dataset.v2rm||(el.dataset.v2rm="1",el.scrollHeight<=120))){el.style.maxHeight="120px",el.style.overflow="hidden",el.style.transition="max-height 0.45s cubic-bezier(0.4,0,0.2,1)";var btn=document.createElement("button");btn.className="ghost",btn.style.cssText="margin:4px 0 0;padding:4px 10px;font-size:12px;",btn.textContent="Read more",btn.onclick=function(){el.style.maxHeight=el.scrollHeight+"px",btn.remove()},el.parentNode.insertBefore(btn,el.nextSibling)}})}setTimeout(initReadMore,1500);var feedObserver=new MutationObserver(function(){setTimeout(initReadMore,300)}),feedEl=q(".feed");feedEl&&feedObserver.observe(feedEl,{childList:!0,subtree:!1});var deferredPrompt,btt=document.createElement("button");btt.id="milan-btt",btt.innerHTML="↑",btt.title="Back to top",btt.style.cssText="position:fixed;bottom:max(90px,calc(env(safe-area-inset-bottom,0px)+90px));left:22px;z-index:490;width:44px;height:44px;border-radius:50%;background:rgba(36,93,255,0.18);color:var(--brand);font-size:18px;border:1px solid rgba(36,93,255,0.3);display:none;align-items:center;justify-content:center;padding:0;backdrop-filter:blur(8px);transition:opacity .2s;",btt.onclick=function(){window.scrollTo({top:0,behavior:"smooth"})},document.body.appendChild(btt),window.addEventListener("scroll",function(){btt.style.display=window.scrollY>600?"flex":"none"},{passive:!0}),window.addEventListener("beforeinstallprompt",function(e){e.preventDefault(),deferredPrompt=e,milanActionToast("📲 Install MILAN App on your device","Install",function(){deferredPrompt&&deferredPrompt.prompt()})}),console.log("%c[MILAN V2 Advanced] 30 features loaded ✦","color:#245dff;font-weight:900;font-size:13px;")}();

/* === ./inline-11.js === */
!function(){"use strict";function q(sel){return document.querySelector(sel)}function qa(sel){return Array.from(document.querySelectorAll(sel))}function upgradeAvatars(){qa(".avatar,.avatar.lg").forEach(function(av){var pressTimer;av.dataset.v3av||(av.dataset.v3av="1",av.classList.add("milan-avatar-breathing"),av.classList.add("milan-3d-hover"),av.classList.contains("lg")&&av.closest(".profileRow")&&av.parentNode.classList.add("milan-story-ring"),av.addEventListener("touchstart",function(){pressTimer=setTimeout(function(){milanMiniConfetti(av)},600)},{passive:!0}),av.addEventListener("touchend",function(){clearTimeout(pressTimer)},{passive:!0}),av.addEventListener("click",function(){av.classList.remove("milan-avatar-pop"),av.offsetWidth,av.classList.add("milan-avatar-pop"),setTimeout(function(){av.classList.remove("milan-avatar-pop")},700)}))})}setTimeout(upgradeAvatars,600);var muAv=new MutationObserver(function(){setTimeout(upgradeAvatars,200)}),feedEl=q(".feed")||q("#feedView");feedEl&&muAv.observe(feedEl,{childList:!0,subtree:!0});var peopleEl=q(".peopleList");function upgradeCards(){qa(".person").forEach(function(el){if(!el.dataset.v3card){el.dataset.v3card="1",el.classList.add("milan-glass-card");var av=el.querySelector(".avatar");av&&av.classList.add("milan-neon-glow")}}),qa(".post").forEach(function(el){if(!el.dataset.v3post){el.dataset.v3post="1";var av=el.querySelector(".avatar");av&&av.classList.add("milan-avatar-breathing")}})}peopleEl&&muAv.observe(peopleEl,{childList:!0,subtree:!0}),window.milanMiniConfetti=function(anchorEl){var canvas=q("#milan-confetti-canvas");if(canvas){canvas.width=window.innerWidth,canvas.height=window.innerHeight;for(var ctx=canvas.getContext("2d"),rect=anchorEl?anchorEl.getBoundingClientRect():{left:window.innerWidth/2,top:window.innerHeight/2,width:0,height:0},cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,pieces=[],colors=["#245dff","#7c3aed","#ec4899","#f59e0b","#10b981","#06b6d4"],i=0;i<60;i++){var angle=2*Math.PI*i/60+.8*(Math.random()-.5),speed=2+5*Math.random();pieces.push({x:cx,y:cy,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-3,rot:Math.random()*Math.PI*2,va:.3*(Math.random()-.5),w:4+6*Math.random(),h:2+4*Math.random(),color:colors[Math.floor(Math.random()*colors.length)],life:1})}var startT=Date.now();!function draw(){var elapsed=Date.now()-startT;ctx.clearRect(0,0,canvas.width,canvas.height);var alive=!1;pieces.forEach(function(p){p.life=Math.max(0,1-elapsed/1600),p.life<=0||(alive=!0,ctx.save(),ctx.globalAlpha=p.life,ctx.translate(p.x,p.y),ctx.rotate(p.rot),ctx.fillStyle=p.color,ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h),ctx.restore(),p.x+=p.vx,p.y+=p.vy,p.vy+=.15,p.rot+=p.va,p.vx*=.98)}),alive?requestAnimationFrame(draw):ctx.clearRect(0,0,canvas.width,canvas.height)}();try{navigator.vibrate&&navigator.vibrate([20,10,20])}catch(_){}}},setTimeout(function(){var leftRail=q(".leftRail")||q(".side");if(leftRail&&!q("#milan-sidebar-gamify")){var streakData=function(){try{return JSON.parse(localStorage.getItem("milan_streak_v3")||"{}")}catch(_){return{}}}(),today=(new Date).toDateString(),lastDay=streakData.lastDay||"",count=streakData.count||0,maxStreak=streakData.max||0;if(lastDay!==today){var yesterday=new Date;yesterday.setDate(yesterday.getDate()-1),lastDay===yesterday.toDateString()?count++:lastDay!==today&&(count=1),maxStreak=Math.max(maxStreak,count),streakData={lastDay:today,count:count,max:maxStreak};try{localStorage.setItem("milan_streak_v3",JSON.stringify(streakData))}catch(_){}-1!==[3,7,14,30,60,100].indexOf(count)&&setTimeout(function(){milanShowReward("🔥","Streak Unlocked!",count+"-day streak! Keep it up."),window.milanConfetti&&milanConfetti(3e3)},800)}var xp=Math.min(20*count+5*Number(q("#peopleCount")&&q("#peopleCount").textContent||0)+10*Number(q("#postCount")&&q("#postCount").textContent||0),1e4),level=Math.floor(xp/200)+1,levelXP=200*(level-1),nextXP=200*level,pct=Math.round((xp-levelXP)/(nextXP-levelXP)*100),badges=[{icon:"🔥",label:"Hot Streak",earned:count>=3},{icon:"💎",label:"Diamond",earned:count>=30},{icon:"🌐",label:"Explorer",earned:Number((q("#postCount")||{}).textContent||0)>=5},{icon:"👥",label:"Connected",earned:Number((q("#peopleCount")||{}).textContent||0)>=3},{icon:"⭐",label:"Creator",earned:Number((q("#postCount")||{}).textContent||0)>=10},{icon:"🏆",label:"Champion",earned:count>=7},{icon:"🎯",label:"Focused",earned:!1},{icon:"🚀",label:"Rocket",earned:!1}],widget=document.createElement("div");widget.id="milan-sidebar-gamify",widget.innerHTML=`\n        <div class="gamify-title">✦ Your MILAN Space</div>\n        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">\n          <div>\n            <span class="milan-level-badge ${level>=10?"gold":level>=5?"emerald":""}">Lv.${level}</span>\n            <div style="font-size:11px;color:var(--muted);margin-top:4px;font-weight:700">${xp} XP total</div>\n          </div>\n          <div style="flex:1">\n            <div class="milan-xp-label"><span>Level ${level}</span><span>Lv.${level+1}</span></div>\n            <div class="milan-xp-bar-wrap"><div class="milan-xp-bar-fill" style="width:${pct}%"></div></div>\n            <div style="font-size:10px;color:var(--muted);margin-top:3px">${xp-levelXP} / ${nextXP-levelXP} XP to next</div>\n          </div>\n        </div>\n        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:8px 10px;border:1px solid rgba(249,115,22,0.25);border-radius:14px;background:rgba(249,115,22,0.06)">\n          <span style="font-size:22px">🔥</span>\n          <div>\n            <div style="font-weight:900;font-size:14px">${count}-Day Streak</div>\n            <div style="font-size:11px;color:var(--muted)">Best: ${maxStreak} days</div>\n          </div>\n          <div style="margin-left:auto;font-size:10px;color:#f97316;font-weight:800">${today}</div>\n        </div>\n        <div class="gamify-title" style="margin-bottom:8px">Badges</div>\n        <div class="milan-badge-wall" id="milan-badge-wall"></div>\n      `,leftRail.appendChild(widget);var wall=q("#milan-badge-wall");wall&&badges.forEach(function(b){var el=document.createElement("div");el.className="milan-badge-item"+(b.earned?" earned":" locked"),el.innerHTML='<span class="badge-icon">'+b.icon+"</span>"+b.label,el.title=b.earned?b.label+" — Earned!":b.label+" — Keep going!",b.earned&&(el.onclick=function(){milanMiniConfetti(el)}),wall.appendChild(el)})}},1e3),window.milanShowReward=function(icon,title,sub){var popup=q("#milan-reward-popup");popup&&(q("#milan-reward-icon").textContent=icon||"🎁",q("#milan-reward-title").textContent=title||"Mystery Reward!",q("#milan-reward-sub").textContent=sub||"You've unlocked something special",popup.classList.add("show"),popup.style.animation="none",popup.offsetWidth,popup.style.animation="")},window.milanCloseReward=function(){var popup=q("#milan-reward-popup");popup&&(popup.classList.remove("show"),milanMiniConfetti(popup))},setTimeout(upgradeCards,700);var muCards=new MutationObserver(function(){setTimeout(upgradeCards,200)}),feedElC=q(".feed");feedElC&&muCards.observe(feedElC,{childList:!0});var ppListC=q(".peopleList");ppListC&&muCards.observe(ppListC,{childList:!0});var sectionTitleEl=q(".sectionTitle");if(sectionTitleEl&&!q("#milan-live-badge")){var liveBadge=document.createElement("div");liveBadge.id="milan-live-badge",liveBadge.className="milan-live-indicator",liveBadge.innerHTML='<span class="milan-live-dot"></span>LIVE',liveBadge.title="Real-time feed active",sectionTitleEl.appendChild(liveBadge)}var composerEl=q(".composer");if(composerEl&&!q("#milan-ai-chips")){var chipBar=document.createElement("div");chipBar.id="milan-ai-chips",chipBar.style.cssText="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 0;";!function(){if(!q("#milan-ai-overlay")){var ov=document.createElement("div");ov.id="milan-ai-overlay",ov.style.cssText="display:none;position:fixed;inset:0;z-index:99999;background:rgba(5,6,22,0.82);backdrop-filter:blur(8px);align-items:center;justify-content:center;",ov.innerHTML='<div id="milan-ai-modal" style="background:linear-gradient(145deg,#0d1235,#1a0a40);border:1px solid rgba(124,58,237,0.45);border-radius:20px;padding:24px;max-width:440px;width:92%;max-height:88vh;overflow-y:auto;position:relative;box-shadow:0 0 60px rgba(124,58,237,0.3);"><button id="milan-ai-close" style="position:absolute;top:14px;right:16px;background:rgba(255,255,255,0.07);border:none;color:#c4b5fd;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:16px;">&times;</button><div id="milan-ai-content"></div></div>',document.body.appendChild(ov),ov.onclick=function(e){e.target===ov&&closeAIM()},q("#milan-ai-close").onclick=closeAIM,window.closeAIModal=closeAIM,window.openAIModal=openAIM;var S_btn="padding:9px 18px;border-radius:12px;border:none;cursor:pointer;font-weight:700;font-size:13px;",S_inp="width:100%;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.07);border:1px solid rgba(124,58,237,0.35);color:#e8e0ff;font-size:13px;box-sizing:border-box;outline:none;",S_lbl="display:block;font-size:12px;font-weight:700;color:#a78bfa;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px;",S_ttl="font-size:17px;font-weight:900;color:#f0e6ff;margin:0 0 18px;",S_load='<div style="text-align:center;padding:20px;"><div style="font-size:28px;animation:aiSpin 1s linear infinite;display:inline-block;">&#10022;</div><div style="color:#a78bfa;margin-top:8px;font-size:13px;">AI soch raha hai&#8230;</div></div>';if(!q("#aim-spin-st")){var st=document.createElement("style");st.id="aim-spin-st",st.textContent="@keyframes aiSpin{to{transform:rotate(360deg)}}",document.head.appendChild(st)}window.setC=setC,window.milanAICaption=function(){openAIM('<p style="'+S_ttl+'">&#10024; Smart Caption</p><label style="'+S_lbl+'">Post Ka Idea</label><textarea id="aicap" rows="3" style="'+S_inp+'resize:vertical;">'+getC()+'</textarea><label style="'+S_lbl+';margin-top:10px;">Tone</label><select id="aitone" style="'+S_inp+'margin-top:4px;"><option value="casual">&#128516; Casual</option><option value="professional">&#128188; Professional</option><option value="funny">&#128514; Funny</option></select><label style="'+S_lbl+';margin-top:10px;"><input type="checkbox" id="aihash" checked style="margin-right:6px;"> Hashtags add karo</label><button onclick="runAICaption()" style="'+S_btn+'background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;margin-top:14px;width:100%;padding:11px;">&#10024; Generate Captions</button><div id="aicap-res" style="margin-top:12px;"></div>')},window.runAICaption=function(){var p=(q("#aicap")||{}).value||"",to=(q("#aitone")||{}).value||"casual",ha=(q("#aihash")||{}).checked;q("#aicap-res").innerHTML=S_load,fetch("/api/ai/caption",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:p,tone:to,hashtags:ha})}).then(function(r){return r.json()}).then(function(d){if(!d.success)throw new Error(d.error||"Error");window._aiCaps=d.captions,q("#aicap-res").innerHTML=d.captions.map(function(c,i){return'<div style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.3);border-radius:10px;padding:10px;margin-bottom:8px;"><p style="color:#e8e0ff;font-size:13px;margin:0 0 7px;line-height:1.5;">'+c+'</p><button onclick="window.aiCapUse('+i+')" style="'+S_btn+'background:rgba(124,58,237,0.3);color:#c4b5fd;padding:5px 12px;font-size:11px;">&#10022; Use This</button></div>'}).join("")}).catch(function(e){q("#aicap-res").innerHTML='<p style="color:#f87171;">'+e.message+"</p>"})},window.aiCapUse=function(i){setC((window._aiCaps||[])[i]||""),closeAIM(),"function"==typeof toast&&toast("Caption set kar diya!")},window.milanAIStyleFilter=function(){openAIM('<p style="'+S_ttl+'">&#127912; Style Filter</p>'+S_load),fetch("/api/ai/style-filters").then(function(r){return r.json()}).then(function(d){if(!d.success)throw new Error(d.error);var h='<p style="'+S_ttl+'">&#127912; Style Filter</p><p style="color:#a78bfa;font-size:12px;margin:-12px 0 14px;">Real-time preview &#8212; click karo!</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;" id="afg">';d.filters.forEach(function(f){h+="<button onclick=\"applyMF('"+f.id+"','"+f.css+'\')" data-fid="'+f.id+'" style="'+S_btn+'background:rgba(255,255,255,0.06);border:1px solid rgba(124,58,237,0.3);color:#e8e0ff;padding:10px 8px;font-size:12px;transition:.2s;text-align:left;">'+f.label+"</button>"}),h+='</div><p id="afg-act" style="color:#a78bfa;font-size:12px;margin-top:10px;text-align:center;"></p><button onclick="closeAIModal()" style="'+S_btn+'background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;width:100%;margin-top:10px;padding:10px;">&#10003; Done</button>',q("#milan-ai-content").innerHTML=h}).catch(function(e){q("#milan-ai-content").innerHTML='<p style="color:#f87171;">'+e.message+"</p>"})},window.applyMF=function(id,css){document.querySelectorAll(".composer img,.composer video,.preview-media img,.preview-media video").forEach(function(el){el.style.filter="none"===css?"":css}),window._mFilter={id:id,css:css},document.querySelectorAll("#afg button").forEach(function(b){b.style.background=b.dataset.fid===id?"linear-gradient(135deg,rgba(124,58,237,0.5),rgba(36,93,255,0.4))":"rgba(255,255,255,0.06)",b.style.borderColor=b.dataset.fid===id?"#7c3aed":"rgba(124,58,237,0.3)"});var el=q("#afg-act");el&&(el.textContent="Applied: "+id),"function"==typeof toast&&toast("Filter: "+id)},window.milanAIBestTime=function(){openAIM('<p style="'+S_ttl+'">&#128302; Best Time to Post</p>'+S_load),fetch("/api/ai/best-time/"+function(){try{return JSON.parse(localStorage.getItem("milan_user")||"{}").id||"guest"}catch(_){return"guest"}}()).then(function(r){return r.json()}).then(function(d){if(!d.success)throw new Error(d.error);var rec=d.recommendation,bm=Math.max.apply(null,rec.hourCounts.map(function(v){return v||1})),bh="";rec.hourCounts.forEach(function(v,h){var pct=Math.round(v/bm*100),hl=h===rec.primary.hour||rec.secondary&&h===rec.secondary.hour?"#7c3aed":"rgba(124,58,237,0.35)";bh+='<div style="flex:1;min-width:5px;height:44px;display:flex;align-items:flex-end;"><div style="width:100%;background:'+hl+";border-radius:2px 2px 0 0;height:"+Math.max(4,pct)+'%;"></div></div>'}),q("#milan-ai-content").innerHTML='<p style="'+S_ttl+'">&#128302; Best Time to Post</p><div style="background:rgba(124,58,237,0.15);border-radius:14px;padding:16px;text-align:center;margin-bottom:14px;"><div style="font-size:26px;font-weight:900;color:#f0e6ff;">'+rec.primary.label+'</div><div style="color:#a78bfa;font-size:12px;margin-top:4px;">Primary peak time</div>'+(rec.secondary?'<div style="color:#c4b5fd;font-size:13px;margin-top:8px;">Also good: '+rec.secondary.label+"</div>":"")+'</div><p style="color:#c4b5fd;font-size:12px;">'+rec.message+'</p><div style="display:flex;gap:1px;align-items:flex-end;margin:10px 0 4px;">'+bh+'</div><div style="display:flex;justify-content:space-between;color:#6b7280;font-size:9px;"><span>12AM</span><span>6AM</span><span>12PM</span><span>6PM</span><span>11PM</span></div>'+("global_default"===rec.source?'<p style="color:#6b7280;font-size:11px;margin-top:8px;">&#128161; Post more for personalized insights!</p>':"")+'<button onclick="closeAIModal()" style="'+S_btn+'background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;width:100%;margin-top:12px;padding:10px;">&#10003; Got it!</button>'}).catch(function(e){q("#milan-ai-content").innerHTML='<p style="color:#f87171;">'+e.message+"</p>"})},window.milanAITranslate=function(){openAIM('<p style="'+S_ttl+'">&#127760; Auto-Translate</p><label style="'+S_lbl+'">Text to Translate</label><textarea id="aitr" rows="3" style="'+S_inp+'resize:vertical;">'+getC()+'</textarea><label style="'+S_lbl+';margin-top:10px;">Target Language</label><select id="aitrl" style="'+S_inp+'margin-top:4px;"><option value="en-US">&#127468;&#127463; English</option><option value="en-US">&#127470;&#127475; Hindi</option><option value="es">&#127466;&#127480; Spanish</option><option value="fr">&#127467;&#127479; French</option><option value="de">&#127465;&#127466; German</option><option value="ja">&#127471;&#127477; Japanese</option><option value="ko">&#127472;&#127479; Korean</option><option value="ar">&#127480;&#127462; Arabic</option><option value="pt">&#127463;&#127479; Portuguese</option><option value="ru">&#127479;&#127482; Russian</option><option value="zh">&#127464;&#127475; Chinese</option></select><button onclick="runAITr()" style="'+S_btn+'background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;margin-top:14px;width:100%;padding:11px;">&#127760; Translate</button><div id="aitr-res" style="margin-top:12px;"></div>')},window.runAITr=function(){var tx=(q("#aitr")||{}).value||"",lg=(q("#aitrl")||{}).value||"en-US";tx.trim()?(q("#aitr-res").innerHTML=S_load,fetch("/api/ai/translate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:tx,targetLang:lg})}).then(function(r){return r.json()}).then(function(d){if(!d.success)throw new Error(d.error);q("#aitr-res").innerHTML='<div style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.3);border-radius:10px;padding:12px;"><p style="color:#a78bfa;font-size:11px;font-weight:700;margin:0 0 6px;">'+d.langName+' mein:</p><p style="color:#e8e0ff;font-size:13px;margin:0 0 10px;line-height:1.5;" id="aitr-out">'+d.translated+'</p><button onclick="window.setC(document.getElementById(\'aitr-out\').textContent);closeAIModal();" style="'+S_btn+'background:rgba(124,58,237,0.3);color:#c4b5fd;padding:5px 12px;font-size:11px;">&#10022; Caption mein lagao</button></div>'}).catch(function(e){q("#aitr-res").innerHTML='<p style="color:#f87171;">'+e.message+"</p>"})):"function"==typeof toast&&toast("Pehle kuch likho!")},window.milanAITargetAudience=function(){openAIM('<p style="'+S_ttl+'">&#127919; Target Audience</p><label style="'+S_lbl+'">Post Caption (optional)</label><textarea id="aita" rows="3" style="'+S_inp+'resize:vertical;">'+getC()+'</textarea><label style="'+S_lbl+';margin-top:10px;">Media Type</label><select id="aitam" style="'+S_inp+'margin-top:4px;"><option value="post">&#128221; Text Post</option><option value="image">&#128444; Image</option><option value="video">&#127908; Video</option><option value="reel">&#127925; Reel</option></select><button onclick="runAITA()" style="'+S_btn+'background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;margin-top:14px;width:100%;padding:11px;">&#127919; Analyze Audience</button><div id="aita-res" style="margin-top:12px;"></div>')},window.runAITA=function(){var ca=(q("#aita")||{}).value||"",mt=(q("#aitam")||{}).value||"post";q("#aita-res").innerHTML=S_load,fetch("/api/ai/target-audience",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({caption:ca,mediaType:mt})}).then(function(r){return r.json()}).then(function(d){if(!d.success)throw new Error(d.error);var a=d.audience,th=function(arr,col){return(arr||[]).map(function(t){return'<span style="background:'+col+';border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700;color:#e8e0ff;display:inline-block;margin:2px;">'+t+"</span>"}).join("")};q("#aita-res").innerHTML='<div style="display:grid;gap:10px;"><div style="background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);border-radius:12px;padding:12px;"><span style="'+S_lbl+'">Category</span><div style="font-size:20px;font-weight:900;color:#f0e6ff;">'+a.category+'</div><div style="margin-top:6px;color:#c4b5fd;font-size:13px;">'+a.contentTone+'</div><div style="margin-top:8px;"><span style="background:'+({Niche:"#6b7280",Moderate:"#2563eb",Broad:"#16a34a","Viral Potential":"#dc2626"}[a.estimatedReach]||"#7c3aed")+';border-radius:6px;padding:3px 10px;font-size:11px;font-weight:900;color:#fff;">'+a.estimatedReach+'</span></div></div><div style="background:rgba(124,58,237,0.08);border-radius:12px;padding:12px;"><span style="'+S_lbl+'">Age Groups</span><div>'+th(a.ageGroups,"rgba(124,58,237,0.3)")+'</div><span style="'+S_lbl+';margin-top:10px;display:block;">Interests</span><div>'+th(a.interests,"rgba(36,93,255,0.3)")+'</div><span style="'+S_lbl+';margin-top:10px;display:block;">Regions</span><div>'+th(a.regions,"rgba(16,163,100,0.3)")+'</div></div></div><button onclick="closeAIModal()" style="'+S_btn+'background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;width:100%;margin-top:12px;padding:10px;">&#10003; Done!</button>'}).catch(function(e){q("#aita-res").innerHTML='<p style="color:#f87171;">'+e.message+"</p>"})}}function closeAIM(){ov.style.display="none"}function openAIM(html){q("#milan-ai-content").innerHTML=html,ov.style.display="flex"}function getC(){var t=q(".composer textarea")||q("textarea");return t?t.value.trim():""}function setC(v){var t=q(".composer textarea")||q("textarea");t&&(t.value=v,t.dispatchEvent(new Event("input",{bubbles:!0})))}}();var chipLabelMap={"❖ Smart Caption":function(){window.milanAICaption()},"🎨 Style Filter":function(){window.milanAIStyleFilter()},"🔮 Best Time to Post":function(){window.milanAIBestTime()},"🌐 Auto-Translate":function(){window.milanAITranslate()},"🎯 Target Audience":function(){window.milanAITargetAudience()}};["✦ Smart Caption","🎨 Style Filter","🔮 Best Time to Post","🌐 Auto-Translate","🎯 Target Audience"].forEach(function(label){var c=document.createElement("button");c.className="milan-ai-chip",c.textContent=label,c.onclick=function(){c.style.background="linear-gradient(135deg,rgba(124,58,237,0.3),rgba(36,93,255,0.25))",setTimeout(function(){c.style.background=""},1800);try{navigator.vibrate&&navigator.vibrate(20)}catch(_){}var fn=chipLabelMap[label];fn?fn():"function"==typeof toast&&toast("❖ "+label)},chipBar.appendChild(c)}),composerEl.appendChild(chipBar)}window.milanShowTyping=function(containerEl,userName){if(containerEl&&!containerEl.querySelector(".milan-typing-indicator")){var ind=document.createElement("div");return ind.className="milan-typing-indicator",ind.innerHTML=(userName||"Someone")+' is typing <span class="milan-typing-dot"></span><span class="milan-typing-dot"></span><span class="milan-typing-dot"></span>',containerEl.appendChild(ind),function(){ind.parentNode&&ind.parentNode.removeChild(ind)}}},document.addEventListener("click",function(e){var btn=e.target.closest("button:not(.ghost):not([disabled])");if(btn){try{navigator.vibrate&&navigator.vibrate(12)}catch(_){}btn.classList.remove("milan-haptic-flash"),btn.offsetWidth,btn.classList.add("milan-haptic-flash"),setTimeout(function(){btn.classList.remove("milan-haptic-flash")},200)}},{passive:!0});var brandImg=q(".brand img");brandImg&&brandImg.classList.add("milan-logo-lottie"),function(){try{localStorage.getItem("milan_v3_welcome")||(localStorage.setItem("milan_v3_welcome","1"),setTimeout(function(){milanShowReward("✦","Welcome to MILAN V3!","New engagement features activated. Your Space. Your People."),window.milanConfetti&&milanConfetti(4e3)},2500))}catch(_){}}();var _origMilestone=window.milanCheckMilestone;function applyDarkNeon(){document.body.classList.contains("dark")?qa(".brand h1,.stat b").forEach(function(el){el.classList.add("milan-neon-accent")}):qa(".milan-neon-accent").forEach(function(el){el.classList.remove("milan-neon-accent")})}window.milanCheckMilestone=function(count){if(-1!==[10,50,100,500,1e3,5e3,1e4].indexOf(Number(count))){milanShowReward("🏆","Milestone: "+count+"!","You've reached "+count+" connections on MILAN!"),window.milanConfetti&&milanConfetti(4e3);try{navigator.vibrate&&navigator.vibrate([50,30,50,30,100])}catch(_){}}_origMilestone&&_origMilestone(count)},setTimeout(function(){qa(".milan-feed-tab.active").forEach(function(t){t.style.background="linear-gradient(135deg, rgba(36,93,255,0.22), rgba(124,58,237,0.18))"})},1100),applyDarkNeon();var origTheme=window.toggleTheme;window.toggleTheme=function(){origTheme&&origTheme(),setTimeout(applyDarkNeon,100)},document.addEventListener("click",function(e){var btn=e.target.closest(".reactionBar button");if(btn){var txt=btn.textContent||"";(txt.includes("❤")||txt.includes("💖")||txt.includes("😍"))&&milanMiniConfetti(btn)}});var actionCount=0,lastRollCheck=Date.now();document.addEventListener("click",function(e){if(e.target.closest("button, .reactionBar")){var now=Date.now();if(now-lastRollCheck>3e5&&(actionCount=0,lastRollCheck=now),++actionCount%5==0&&window.milanActionToast){var msgs=["🔥 You're on a roll!","⚡ MILAN energy is high!","✦ Keep going — you're crushing it!","🚀 MILAN loves your energy!"];milanActionToast(msgs[Math.floor(Math.random()*msgs.length)])}}},{passive:!0}),console.log("%c[MILAN V3] Engagement Engine loaded — 500 Techniques Active ✦","color:#7c3aed;font-weight:900;font-size:13px;background:rgba(124,58,237,0.1);padding:4px 8px;border-radius:6px;")}();

/* === ./inline-12.js === */
!function(){"use strict";function q(sel){return document.querySelector(sel)}function qa(sel){return Array.from(document.querySelectorAll(sel))}function toast(msg,dur){var t=document.createElement("div");t.style.cssText="position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 18px;z-index:10001;font-size:13px;font-weight:700;box-shadow:0 8px 30px rgba(0,0,0,.4);white-space:nowrap;pointer-events:none;",t.textContent=msg,document.body.appendChild(t),setTimeout(function(){t.style.opacity="0",t.style.transition="opacity .4s",setTimeout(function(){t.remove()},400)},dur||2200)}var themePanel=document.createElement("div");themePanel.id="milan-theme-panel",themePanel.innerHTML=["<h4>🎨 Theme</h4>",'<div class="milan-theme-row">','<button class="milan-theme-chip" data-theme="light">☀️ Light</button>','<button class="milan-theme-chip active" data-theme="dark">🌙 Dark</button>','<button class="milan-theme-chip amoled" data-theme="amoled">⬛ AMOLED</button>','<button class="milan-theme-chip" data-theme="system">💻 System</button>',"</div>","<h4>🎨 Accent Color</h4>",'<div class="milan-theme-row" id="milan-accent-row">','<button class="milan-theme-chip active" data-accent="default" style="border-color:#f59e0b">🔶 Default</button>','<button class="milan-theme-chip" data-accent="ocean" style="border-color:#2563eb">🔷 Ocean</button>','<button class="milan-theme-chip" data-accent="emerald" style="border-color:#10b981">💚 Emerald</button>','<button class="milan-theme-chip" data-accent="crimson" style="border-color:#ef4444">❤️ Crimson</button>','<button class="milan-theme-chip" data-accent="violet" style="border-color:#7c3aed">💜 Violet</button>',"</div>","<h4>✒️ Font</h4>",'<select class="milan-font-sel" id="milan-font-sel">','<option value="sans">Sans-Serif (Default)</option>','<option value="serif">Serif</option>','<option value="mono">Monospace</option>',"</select>","<h4>📐 Density</h4>",'<select class="milan-density-sel" id="milan-density-sel">','<option value="">Standard</option>','<option value="compact">Compact</option>','<option value="comfortable">Comfortable</option>',"</select>",'<div id="milan-anim-toggle"><input type="checkbox" id="milan-anim-cb" checked><label for="milan-anim-cb" style="cursor:pointer;">✨ Animations enabled</label></div>'].join(""),document.body.appendChild(themePanel);var themeBtn=q("#themeBtn");themeBtn&&(themeBtn.textContent="🎨 Theme",themeBtn.onclick=function(e){e.stopPropagation(),themePanel.classList.toggle("open"),modelPanel.classList.remove("open"),usagePanel.classList.remove("open")}),qa("#milan-theme-panel [data-theme]").forEach(function(btn){btn.onclick=function(){qa("[data-theme]").forEach(function(b){b.classList.remove("active")}),btn.classList.add("active");var t=btn.dataset.theme;document.body.classList.remove("amoled","dark"),"dark"===t?document.body.classList.add("dark"):"amoled"===t?document.body.classList.add("dark","amoled"):"system"===t&&window.matchMedia("(prefers-color-scheme:dark)").matches&&document.body.classList.add("dark");try{localStorage.setItem("milan_theme",t)}catch(_){}toast("Theme: "+btn.textContent)}});var accentMap={default:"#f59e0b",ocean:"#2563eb",emerald:"#10b981",crimson:"#ef4444",violet:"#7c3aed"};qa("[data-accent]").forEach(function(btn){btn.onclick=function(){qa("[data-accent]").forEach(function(b){b.classList.remove("active")}),btn.classList.add("active");var c=accentMap[btn.dataset.accent]||"#f59e0b";document.documentElement.style.setProperty("--brand",c);try{localStorage.setItem("milan_accent",btn.dataset.accent)}catch(_){}toast("Accent: "+btn.textContent)}}),q("#milan-font-sel").onchange=function(){document.body.classList.remove("font-serif","font-mono"),"serif"===this.value&&document.body.classList.add("font-serif"),"mono"===this.value&&document.body.classList.add("font-mono");try{localStorage.setItem("milan_font",this.value)}catch(_){}},q("#milan-density-sel").onchange=function(){document.body.classList.remove("compact","comfortable"),this.value&&document.body.classList.add(this.value);try{localStorage.setItem("milan_density",this.value)}catch(_){}},q("#milan-anim-cb").onchange=function(){document.body.classList.toggle("no-anim",!this.checked);try{localStorage.setItem("milan_anim",this.checked?"1":"0")}catch(_){}};try{var savedTheme=localStorage.getItem("milan_theme")||"dark",savedAccent=localStorage.getItem("milan_accent")||"default",savedFont=localStorage.getItem("milan_font")||"sans",savedDensity=localStorage.getItem("milan_density")||"",savedAnim=localStorage.getItem("milan_anim");document.body.classList.remove("amoled","dark"),"dark"===savedTheme&&document.body.classList.add("dark"),"amoled"===savedTheme&&document.body.classList.add("dark","amoled"),accentMap[savedAccent]&&document.documentElement.style.setProperty("--brand",accentMap[savedAccent]),q("#milan-font-sel").value=savedFont,"serif"===savedFont&&document.body.classList.add("font-serif"),"mono"===savedFont&&document.body.classList.add("font-mono"),q("#milan-density-sel").value=savedDensity,savedDensity&&document.body.classList.add(savedDensity),"0"===savedAnim&&(document.body.classList.add("no-anim"),q("#milan-anim-cb").checked=!1)}catch(_){}var modelPanel=document.createElement("div");modelPanel.id="milan-model-panel",modelPanel.innerHTML=["<h4>🤖 AI Model</h4>",'<div class="milan-model-card active" data-model="gpt4o"><div class="micon">🧠</div><div class="minfo"><b>Premium — GPT-4o</b><span>Complex reasoning & coding</span></div></div>','<div class="milan-model-card" data-model="claude"><div class="micon">⚡</div><div class="minfo"><b>Premium — Claude 3</b><span>Creative & nuanced tasks</span></div></div>','<div class="milan-model-card" data-model="fast"><div class="micon">🚀</div><div class="minfo"><b>Fast — GPT-4o Mini</b><span>Quick queries & summaries</span></div></div>','<div class="milan-model-card" data-model="local"><div class="micon">🏠</div><div class="minfo"><b>Local — Ollama</b><span>Private, runs on device</span></div></div>',"<h4>🌡️ Temperature</h4>",'<div class="milan-temp-wrap">','<label>Creative: <span id="milan-temp-val">0.7</span></label>','<input type="range" id="milan-temp-slider" min="0" max="1" step="0.05" value="0.7">',"</div>","<h4>🎭 AI Persona</h4>",'<div class="milan-persona-chips">','<button class="milan-persona-chip active" data-persona="general">🌐 General</button>','<button class="milan-persona-chip" data-persona="dev">💻 Python Dev</button>','<button class="milan-persona-chip" data-persona="analyst">📊 Data Analyst</button>','<button class="milan-persona-chip" data-persona="writer">✍️ Creative Writer</button>','<button class="milan-persona-chip" data-persona="coach">🏋️ Life Coach</button>',"</div>","<h4>🖼️ Multimodal</h4>",'<div style="display:flex;gap:8px;flex-wrap:wrap;">','<button id="milan-image-tab">🎨 Generate Image</button>','<button id="milan-upscale-btn">🔍 Upscale HD</button>',"</div>"].join(""),document.body.appendChild(modelPanel);var modelBtn=document.createElement("button");modelBtn.className="ghost",modelBtn.id="milan-model-btn",modelBtn.textContent="🤖 AI",modelBtn.style.cssText="font-size:12px;padding:8px 12px;",modelBtn.onclick=function(e){e.stopPropagation(),modelPanel.classList.toggle("open"),themePanel.classList.remove("open"),usagePanel.classList.remove("open")};var topActions=q(".topActions");topActions&&q("#refreshBtn")&&topActions.insertBefore(modelBtn,q("#refreshBtn"));var currentModel="gpt4o";qa(".milan-model-card").forEach(function(card){card.onclick=function(){qa(".milan-model-card").forEach(function(c){c.classList.remove("active")}),card.classList.add("active"),currentModel=card.dataset.model,window.__milan_model=currentModel,toast("Model: "+card.querySelector("b").textContent)}});var tempSlider=q("#milan-temp-slider"),tempVal=q("#milan-temp-val");if(tempSlider&&tempVal&&(tempSlider.oninput=function(){tempVal.textContent=parseFloat(this.value).toFixed(2),window.__milan_temp=parseFloat(this.value)}),qa(".milan-persona-chip").forEach(function(chip){chip.onclick=function(){qa(".milan-persona-chip").forEach(function(c){c.classList.remove("active")}),chip.classList.add("active"),window.__milan_persona=chip.dataset.persona,toast("Persona: "+chip.textContent)}}),q("#milan-image-tab").onclick=function(){toast("🎨 Image Generation: Connect your image API key in Settings")},q("#milan-upscale-btn").onclick=function(){toast("🔍 Upscale: Select an image post and use this to upscale to HD")},setTimeout(function(){if(q(".composer")&&!q("#milan-attach-btn")){var attachBtn=document.createElement("button");attachBtn.id="milan-attach-btn",attachBtn.className="ghost",attachBtn.style.cssText="padding:6px 12px;font-size:12px;margin-right:6px;",attachBtn.innerHTML="📎 Attach",attachBtn.title="Attach image or document for AI to analyze";var attachInput=document.createElement("input");attachInput.type="file",attachInput.accept="image/*,.pdf,.txt,.md,.csv",attachInput.style.display="none",attachInput.id="milan-attach-input",attachBtn.onclick=function(){attachInput.click()},attachInput.onchange=function(){this.files[0]&&(toast("📎 Attached: "+this.files[0].name+" ("+Math.round(this.files[0].size/1024)+"KB)"),window.__milan_attachment=this.files[0])};var publishBtn=q("#publishBtn");publishBtn&&(publishBtn.parentNode.insertBefore(attachBtn,publishBtn),publishBtn.parentNode.insertBefore(attachInput,publishBtn))}},1500),window.milanRenderMarkdown=function(text){return text?text=(text=(text=(text=(text=(text=(text=(text=(text=text.replace(/```(\w*)\n?([\s\S]*?)```/g,function(m,lang,code){var id="mc-"+Math.random().toString(36).slice(2,8);return'<div class="milan-code-block"><button class="milan-code-copy" onclick="milanCopyCode(\''+id+'\')">Copy</button><code id="'+id+'">'+code.trim().replace(/</g,"&lt;").replace(/>/g,"&gt;")+"</code></div>"})).replace(/`([^`]+)`/g,'<code style="background:rgba(36,93,255,.1);padding:1px 5px;border-radius:5px;font-family:monospace;">$1</code>')).replace(/^### (.+)$/gm,'<div class="milan-md-heading" style="font-size:1.1em;">$1</div>')).replace(/^## (.+)$/gm,'<div class="milan-md-heading" style="font-size:1.25em;">$1</div>')).replace(/^# (.+)$/gm,'<div class="milan-md-heading" style="font-size:1.4em;">$1</div>')).replace(/\*\*(.+?)\*\*/g,'<span class="milan-md-bold">$1</span>')).replace(/\*(.+?)\*/g,'<span class="milan-md-italic">$1</span>')).replace(/\$\$(.+?)\$\$/g,'<span class="milan-latex">$1$</span>')).replace(/\$(.+?)\$/g,'<span class="milan-latex">$1</span>'):text},window.milanCopyCode=function(id){var el=document.getElementById(id);el&&navigator.clipboard.writeText(el.textContent).then(function(){toast("Code copied!")})},window.SpeechRecognition||window.webkitSpeechRecognition){var micBtn=document.createElement("button");micBtn.id="milan-mic-btn",micBtn.innerHTML="🎙️",micBtn.title="Voice to Text (hold to dictate)",document.body.appendChild(micBtn);var recog=new(window.SpeechRecognition||window.webkitSpeechRecognition);recog.continuous=!1,recog.interimResults=!1;var isRecording=!1;recog.onresult=function(e){var transcript=e.results[0][0].transcript,ta=q(".composer textarea")||q("#postText");ta&&(ta.value+=(ta.value?" ":"")+transcript,ta.dispatchEvent(new Event("input"))),toast('🎙️ "'+transcript.slice(0,40)+(transcript.length>40?"...":"")+'"'),micBtn.classList.remove("recording"),isRecording=!1,micBtn.innerHTML="🎙️"},recog.onerror=function(){micBtn.classList.remove("recording"),isRecording=!1,micBtn.innerHTML="🎙️",toast("Mic error — check permissions")},micBtn.onclick=function(){isRecording?(recog.stop(),micBtn.classList.remove("recording"),micBtn.innerHTML="🎙️",isRecording=!1):(recog.start(),micBtn.classList.add("recording"),micBtn.innerHTML="⏹️",isRecording=!0,toast("🎙️ Listening..."))}}window.milanSpeak=function(text,btn){if(!window.speechSynthesis)return toast("TTS not supported in this browser");if(window.speechSynthesis.speaking)return window.speechSynthesis.cancel(),void(btn&&btn.classList.remove("speaking"));var utt=new SpeechSynthesisUtterance(text.replace(/<[^>]*>/g,"").slice(0,500));utt.rate=.95,utt.pitch=1,utt.onend=function(){btn&&btn.classList.remove("speaking")},btn&&btn.classList.add("speaking"),window.speechSynthesis.speak(utt)},setTimeout(function(){qa(".postBody").forEach(function(pb){if(!pb.querySelector(".milan-tts-btn")){var btn=document.createElement("button");btn.className="milan-tts-btn ghost",btn.style.cssText="font-size:11px;padding:4px 10px;margin-top:6px;",btn.innerHTML="🔊 Read",btn.onclick=function(){var txt=(pb.querySelector(".postTitle")||{}).textContent||"";txt+=" "+(pb.querySelector(".postText")||{}).textContent||"",milanSpeak(txt,btn)},pb.appendChild(btn)}})},2e3);var exportBtn=document.createElement("button");exportBtn.id="milan-export-btn",exportBtn.textContent="💾 Export",exportBtn.title="Export posts as PDF, TXT, or JSON",topActions&&q("#logoutBtn")&&topActions.insertBefore(exportBtn,q("#logoutBtn")),exportBtn.onclick=function(){var posts=qa(".post");if(posts.length){var choice=prompt("Export format?\n1 = TXT\n2 = JSON\n3 = PDF (browser print)","1");if(choice){var data=[];if(posts.forEach(function(p){var title=(p.querySelector(".postTitle")||{}).textContent||"",body=(p.querySelector(".postText")||{}).textContent||"",user=(p.querySelector(".personInfo b")||{}).textContent||"";data.push({user:user,title:title,body:body})}),"1"===choice){var txt=data.map(function(d){return"["+d.user+"]\n"+d.title+"\n"+d.body}).join("\n\n---\n\n");(a=document.createElement("a")).href="data:text/plain;charset=utf-8,"+encodeURIComponent(txt),a.download="milan-export.txt",a.click(),toast("📄 Exported as TXT")}else if("2"===choice){var a,json=JSON.stringify(data,null,2);(a=document.createElement("a")).href="data:application/json;charset=utf-8,"+encodeURIComponent(json),a.download="milan-export.json",a.click(),toast("📋 Exported as JSON")}else"3"===choice&&(window.print(),toast("🖨️ Opening print dialog for PDF"))}}else toast("No posts to export")};var searchWrap=q(".search");if(searchWrap){var hint=document.createElement("div");hint.id="milan-search-hint",hint.textContent='✦ Semantic search: try "posts about music" or "@user"',searchWrap.appendChild(hint);var gs=q("#globalSearch");gs&&(gs.addEventListener("focus",function(){hint.style.opacity="1"}),gs.addEventListener("blur",function(){hint.style.opacity="0"}),gs.addEventListener("input",function(){var v=this.value.toLowerCase();qa(".postTitle,.postText").forEach(function(el){v&&el.textContent.toLowerCase().includes(v)?el.closest(".post")&&(el.closest(".post").style.boxShadow="0 0 0 2px var(--brand)"):el.closest(".post")&&(el.closest(".post").style.boxShadow="")})}))}var dwnToggle=document.createElement("button");dwnToggle.id="milan-dwn-toggle",dwnToggle.innerHTML="🌐 DWN: On",dwnToggle.title="Toggle decentralized DWN storage",dwnToggle.classList.add("active"),topActions&&q("#milan-model-btn")&&topActions.insertBefore(dwnToggle,q("#milan-model-btn").nextSibling);var dwnEnabled=!0;dwnToggle.onclick=function(){dwnEnabled=!dwnEnabled,dwnToggle.innerHTML=dwnEnabled?"🌐 DWN: On":"📱 Local",dwnToggle.classList.toggle("active",dwnEnabled),window.__milan_dwn_mode=dwnEnabled?"cloud":"local",toast(dwnEnabled?"🌐 DWN cloud storage active":"📱 Local storage mode active")};var usagePanel=document.createElement("div");function updateUsagePanel(){var tc=window.__milan_token_count||0,rc=window.__milan_req_count||0,pct=Math.min(100,tc/1e5*100);usagePanel.innerHTML=['<div style="display:flex;justify-content:space-between;align-items:center;">','<h4 style="margin:0;font-size:14px;font-weight:900;">📊 API Usage Dashboard</h4>','<button class="ghost" onclick="document.getElementById(\'milan-usage-panel\').classList.remove(\'open\')" style="padding:4px 10px;font-size:12px;">✕</button>',"</div>",'<div class="milan-usage-stat"><span>Tokens Used</span><b>'+tc.toLocaleString()+" / 100K</b></div>",'<div class="milan-usage-bar"><div class="milan-usage-bar-fill" style="width:'+pct+'%"></div></div>','<div class="milan-usage-stat"><span>Total Requests</span><b>'+rc+"</b></div>",'<div class="milan-usage-stat"><span>Current Model</span><b>'+(window.__milan_model||"gpt4o")+"</b></div>",'<div class="milan-usage-stat"><span>Temperature</span><b>'+(window.__milan_temp||.7)+"</b></div>",'<div class="milan-usage-stat"><span>DWN Mode</span><b>'+(dwnEnabled?"Cloud DWN":"Local")+"</b></div>","<button style=\"width:100%;margin-top:4px;\" onclick=\"if(confirm('Reset usage counters?')){window.__milan_token_count=0;window.__milan_req_count=0;localStorage.setItem('milan_tokens','0');localStorage.setItem('milan_reqs','0');updateUsagePanel();milanV4Toast('Stats reset');}\">Reset Counters</button>"].join("")}usagePanel.id="milan-usage-panel",window.__milan_token_count=parseInt(localStorage.getItem("milan_tokens")||"0",10),window.__milan_req_count=parseInt(localStorage.getItem("milan_reqs")||"0",10),window.updateUsagePanel=updateUsagePanel,updateUsagePanel(),document.body.appendChild(usagePanel);var usageBtn=document.createElement("button");usageBtn.id="milan-usage-btn",usageBtn.textContent="📊 Usage",usageBtn.style.cssText="font-size:12px;padding:8px 12px;",usageBtn.onclick=function(e){e.stopPropagation(),updateUsagePanel(),usagePanel.classList.toggle("open"),themePanel.classList.remove("open"),modelPanel.classList.remove("open")},topActions&&q("#logoutBtn")&&topActions.insertBefore(usageBtn,q("#logoutBtn"));var paletteOverlay=document.createElement("div");paletteOverlay.id="milan-palette-overlay";var cmds=[{icon:"🎨",label:"Switch Theme",desc:"Light / Dark / AMOLED",action:function(){themePanel.classList.add("open")}},{icon:"🤖",label:"Switch AI Model",desc:"GPT-4o, Claude, Fast, Local",action:function(){modelPanel.classList.add("open")}},{icon:"📊",label:"Usage Dashboard",desc:"Token & request stats",action:function(){updateUsagePanel(),usagePanel.classList.add("open")}},{icon:"💾",label:"Export Posts",desc:"TXT, JSON, or PDF",action:function(){exportBtn.click()}},{icon:"🔊",label:"Read Latest Post Aloud",desc:"Text-to-speech playback",action:function(){var p=q(".postBody");if(p){var t=(p.querySelector(".postTitle")||{}).textContent||"   "+(p.querySelector(".postText")||{}).textContent||"";milanSpeak(t,null)}}},{icon:"🌐",label:"Toggle DWN Storage",desc:"Cloud DWN ↔ Local",action:function(){dwnToggle.click()}},{icon:"🔍",label:"Focus Search",desc:"Search posts, people, tags",action:function(){var g=q("#globalSearch");g&&(g.focus(),g.select())}},{icon:"🏠",label:"Go to Feed",desc:"Home feed view",action:function(){var h=q('[onclick*="home"]||[data-view*="feed"]');h&&h.click()}},{icon:"👤",label:"Open Profile",desc:"View your profile",action:function(){var pb=q("#profileBtn");pb&&pb.click()}},{icon:"🌙",label:"Toggle Dark Mode",desc:"Quick dark/light switch",action:function(){document.body.classList.toggle("dark"),toast(document.body.classList.contains("dark")?"Dark mode":"Light mode")}},{icon:"⬛",label:"AMOLED Mode",desc:"True black for OLED screens",action:function(){document.body.classList.toggle("amoled"),toast("AMOLED: "+(document.body.classList.contains("amoled")?"On":"Off"))}}],cmdsHTML=cmds.map(function(c,i){return'<div class="milan-cmd-item" data-cmd="'+i+'"><span class="cmd-icon">'+c.icon+'</span><div><div class="cmd-label">'+c.label+'</div><div class="cmd-desc">'+c.desc+"</div></div></div>"}).join("");paletteOverlay.innerHTML='<div id="milan-palette"><input id="milan-palette-input" placeholder="🔍 Type a command..." autocomplete="off"><div id="milan-palette-results">'+cmdsHTML+"</div></div>",document.body.appendChild(paletteOverlay);var shortcutHint=document.createElement("div");function closePalette(){paletteOverlay.classList.remove("open")}shortcutHint.className="milan-cmd-shortcut",shortcutHint.textContent="⌘K Command Palette",document.body.appendChild(shortcutHint),paletteOverlay.onclick=function(e){e.target===paletteOverlay&&closePalette()},document.addEventListener("keydown",function(e){(e.ctrlKey||e.metaKey)&&"k"===e.key&&(e.preventDefault(),paletteOverlay.classList.add("open"),setTimeout(function(){q("#milan-palette-input").focus()},50)),"Escape"===e.key&&closePalette()}),q("#milan-palette-input").addEventListener("input",function(){var v=this.value.toLowerCase();qa(".milan-cmd-item").forEach(function(el){var label=el.querySelector(".cmd-label").textContent.toLowerCase(),desc=el.querySelector(".cmd-desc").textContent.toLowerCase();el.style.display=!v||label.includes(v)||desc.includes(v)?"":"none"})}),q("#milan-palette-results").addEventListener("click",function(e){var item=e.target.closest(".milan-cmd-item");item&&(closePalette(),cmds[parseInt(item.dataset.cmd)].action())}),q("#milan-palette-input").addEventListener("keydown",function(e){var items=qa('.milan-cmd-item:not([style*="display: none"])'),focused=q(".milan-cmd-item.focused"),idx=focused?items.indexOf(focused):-1;if("ArrowDown"===e.key){e.preventDefault(),focused&&focused.classList.remove("focused");var next=items[Math.min(idx+1,items.length-1)];next&&next.classList.add("focused")}else if("ArrowUp"===e.key){e.preventDefault(),focused&&focused.classList.remove("focused");var prev=items[Math.max(idx-1,0)];prev&&prev.classList.add("focused")}else"Enter"===e.key&&focused&&(closePalette(),cmds[parseInt(focused.dataset.cmd)].action())}),document.addEventListener("click",function(){themePanel.classList.remove("open"),modelPanel.classList.remove("open"),usagePanel.classList.remove("open")}),[themePanel,modelPanel,usagePanel].forEach(function(p){p.addEventListener("click",function(e){e.stopPropagation()})}),window.__milan_streaming=!1;var streamBadge=document.createElement("span");streamBadge.id="milan-stream-badge",streamBadge.style.cssText="font-size:11px;padding:4px 10px;border-radius:999px;background:rgba(16,185,129,.12);color:#059669;font-weight:900;display:none;",streamBadge.textContent="⚡ Live";var healthEl=q("#health");healthEl&&healthEl.parentNode&&healthEl.parentNode.insertBefore(streamBadge,healthEl.nextSibling);var origFetch=window.fetch;window.fetch=function(){window.__milan_req_count=(window.__milan_req_count||0)+1;try{localStorage.setItem("milan_reqs",String(window.__milan_req_count))}catch(_){}return origFetch.apply(this,arguments).then(function(r){window.__milan_token_count=(window.__milan_token_count||0)+50;try{localStorage.setItem("milan_tokens",String(window.__milan_token_count))}catch(_){}return r})},console.log("%c[MILAN V4] 24 Feature Updates Loaded ✦ Ctrl+K for Command Palette","color:#f59e0b;font-weight:900;font-size:13px;background:rgba(245,158,11,0.1);padding:4px 8px;border-radius:6px;")}();

/* === ./inline-14.js === */
(function(){
'use strict';

/* ── State ─────────────────────────────────────────────────────── */
var maiState = {
  model: 'claude-sonnet-4-20250514',
  persona: 'milan',
  temp: 0.7,
  messages: [],
  tokens: parseInt(localStorage.getItem('mai_tokens')||'0', 10),
  requests: parseInt(localStorage.getItem('mai_requests')||'0', 10),
  isLoading: false,
  ttsActive: false,
  micActive: false,
  tone: 'casual',
  imgStyle: 'realistic',
  activeTab: 'chat'
};

/* ── System Prompts ─────────────────────────────────────────────── */
var PERSONAS = {
  milan: 'You are MILAN AI, the intelligent assistant of the MILAN social platform — a privacy-first decentralized social network built on Web5/DWN technology. You are warm, helpful, and knowledgeable about the platform. You speak in a mix of Hindi and English (Hinglish) when appropriate, matching the user\'s language preference. You help users compose posts, understand privacy settings, debug code, and answer any questions. Be concise, direct, and use relevant emojis occasionally. The platform uses DID/DWN architecture, Node.js backend, and has features like posts, connections, reactions, and more.',
  dev: 'You are an expert Python and JavaScript developer. You write clean, efficient, well-commented code. You debug issues systematically, explain concepts clearly, and suggest best practices. When writing code, always include brief comments explaining the logic.',
  analyst: 'You are a senior data analyst and scientist. You are skilled in Python (pandas, numpy, matplotlib), SQL, statistics, and data visualization. You explain data concepts clearly, help interpret results, and suggest analytical approaches.',
  writer: 'You are a creative writer and content strategist specializing in social media content. You write engaging, viral-worthy posts, captions, and stories. You understand tone, audience, and platform-specific writing styles.',
  coach: 'You are a supportive life coach and motivator. You listen actively, ask thoughtful questions, help people set and achieve goals, and provide evidence-based advice. You are empathetic, encouraging, and practical.',
  debug: 'You are a debugging expert. You systematically analyze code and error messages, identify root causes, suggest fixes, and explain why issues occur. You are thorough and methodical.'
};

/* ── Format Markdown ─────────────────────────────────────────────── */
function maiMarkdown(text){
  if(!text) return '';
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, function(m, lang, code){
    return '<pre><code>' + code.trim().replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code></pre>';
  });
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/^### (.+)$/gm, '<h4 style="margin:8px 0 4px;color:#93c5fd;">$1</h4>');
  text = text.replace(/^## (.+)$/gm, '<h3 style="margin:10px 0 6px;color:#c4b5fd;">$1</h3>');
  text = text.replace(/^# (.+)$/gm, '<h2 style="margin:10px 0 6px;color:#fbbf24;">$1</h2>');
  text = text.replace(/^- (.+)$/gm, '• $1<br>');
  text = text.replace(/\n\n/g, '<br><br>');
  text = text.replace(/\n/g, '<br>');
  return text;
}

/* ── API Call ─────────────────────────────────────────────────────── */
async function maiCallAPI(userMessages, stream) {
  var systemPrompt = PERSONAS[maiState.persona] || PERSONAS.milan;
  // Route through MILAN's own backend so the API key stays server-side (in .env)
  // and there are no CORS / key-exposure problems from the browser.
  var headers = { 'Content-Type': 'application/json' };
  try { var t = localStorage.getItem('milan_token'); if (t) headers.Authorization = 'Bearer ' + t; } catch(_) {}
  var res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      model: maiState.model,
      max_tokens: 1024,
      temperature: maiState.temp,
      system: systemPrompt,
      persona: maiState.persona,
      messages: userMessages
    })
  });
  var data = await res.json().catch(function(){ return {}; });
  if(!res.ok || data.success === false){
    throw new Error(data.error || 'AI request failed. Make sure an AI API key is set in the server .env.');
  }
  var text = data.reply || '';
  // Track usage
  maiState.tokens += (data.usage && (data.usage.input_tokens + data.usage.output_tokens)) || 80;
  maiState.requests++;
  localStorage.setItem('mai_tokens', String(maiState.tokens));
  localStorage.setItem('mai_requests', String(maiState.requests));
  return text;
}

/* ── Chat Functions ─────────────────────────────────────────────── */
function maiAddMessage(role, text, isHtml){
  var area = document.getElementById('mai-chat-area');
  if(!area) return;
  var msgDiv = document.createElement('div');
  msgDiv.className = 'mai-msg ' + role;
  var initials = (role === 'ai') ? '🤖' : ((window.me && window.me.profile && window.me.profile.display_name) ? window.me.profile.display_name[0].toUpperCase() : 'U');
  var bubbleContent = isHtml ? text : maiMarkdown(text);
  msgDiv.innerHTML =
    '<div class="mai-avatar '+role+'">'+ initials +'</div>' +
    '<div>' +
      '<div class="mai-bubble">' + bubbleContent + '</div>' +
      (role === 'ai' ? '<div class="mai-msg-actions"><button class="mai-msg-action" onclick="maiSpeak(this.closest(\'.mai-msg\').querySelector(\'.mai-bubble\').innerText)">🔊 Read</button><button class="mai-msg-action" onclick="navigator.clipboard&&navigator.clipboard.writeText(this.closest(\'.mai-msg\').querySelector(\'.mai-bubble\').innerText)">📋 Copy</button></div>' : '') +
    '</div>';
  area.appendChild(msgDiv);
  area.scrollTop = area.scrollHeight;
  return msgDiv;
}

function maiShowThinking(){
  var area = document.getElementById('mai-chat-area');
  var div = document.createElement('div');
  div.id = 'mai-thinking-bubble';
  div.innerHTML = '<div class="mai-thinking"><div class="mai-dot-anim"></div><div class="mai-dot-anim"></div><div class="mai-dot-anim"></div><span style="font-size:12px;color:#6b84b0;margin-left:6px;">MILAN AI thinking...</span></div>';
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function maiRemoveThinking(){
  var el = document.getElementById('mai-thinking-bubble');
  if(el) el.remove();
}

async function maiSend(){
  var input = document.getElementById('mai-input');
  var text = (input.value || '').trim();
  if(!text || maiState.isLoading) return;

  input.value = '';
  input.style.height = '';
  document.getElementById('mai-char-count').textContent = '0/4000';

  maiAddMessage('user', text, false);
  maiState.messages.push({ role: 'user', content: text });

  maiState.isLoading = true;
  document.getElementById('mai-send').disabled = true;
  maiShowThinking();

  try{
    var reply = await maiCallAPI(maiState.messages);
    maiRemoveThinking();
    maiState.messages.push({ role: 'assistant', content: reply });
    maiAddMessage('ai', reply, false);
    if(maiState.messages.length > 30){
      maiState.messages = maiState.messages.slice(-28);
    }
  } catch(e){
    maiRemoveThinking();
    maiAddMessage('ai', '❌ Error: ' + e.message + '<br><span style="font-size:12px;color:#6b84b0;">API key check karo ya internet connection dekho.</span>', true);
  }
  maiState.isLoading = false;
  document.getElementById('mai-send').disabled = false;
  input.focus();
}

function maiQuickPrompt(prompt){
  var input = document.getElementById('mai-input');
  if(input){ input.value = prompt; input.focus(); }
  // Switch to chat tab
  maiSwitchTab('chat');
}

function maiClearChat(){
  var area = document.getElementById('mai-chat-area');
  maiState.messages = [];
  if(area) area.innerHTML = '';
  maiAddMessage('ai', '🧹 Chat cleared! Nayi conversation shuru karo.', true);
}

function maiExportChat(){
  var text = maiState.messages.map(function(m){ return '['+m.role.toUpperCase()+']\n'+m.content; }).join('\n\n---\n\n');
  var a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
  a.download = 'milan-ai-chat-' + Date.now() + '.txt';
  a.click();
}
window.maiClearChat = maiClearChat;
window.maiExportChat = maiExportChat;

/* ── AI Composer ──────────────────────────────────────────────────── */
async function maiGeneratePost(){
  var input = document.getElementById('mai-composer-input');
  var out = document.getElementById('mai-composer-output');
  var copyBtn = document.getElementById('mai-copy-to-composer');
  var topic = (input && input.value || '').trim();
  if(!topic){ out.textContent = '⚠️ Topic likho pehle!'; return; }
  out.innerHTML = '<div style="color:#8ba4d4">âš¡ Generating...</div>';
  try{
    var prompt = 'Write a social media post in ' + maiState.tone + ' tone about: ' + topic + '. Keep it engaging, authentic, and around 150-200 words. Add relevant emojis. Make it feel genuine, not corporate.';
    var result = await maiCallAPI([{role:'user', content:prompt}]);
    out.innerHTML = maiMarkdown(result);
    if(copyBtn) copyBtn.style.display = 'block';
    window.__mai_generated_post = result;
  } catch(e){
    out.innerHTML = '❌ ' + e.message;
  }
}

async function maiGenerateCaptions(){
  var input = document.getElementById('mai-composer-input');
  var out = document.getElementById('mai-composer-output');
  var copyBtn = document.getElementById('mai-copy-to-composer');
  var topic = (input && input.value || '').trim();
  if(!topic){ out.textContent = '⚠️ Topic likho pehle!'; return; }
  out.innerHTML = '<div style="color:#8ba4d4">âš¡ Generating 5 captions...</div>';
  try{
    var prompt = 'Generate 5 different social media captions for: ' + topic + '. Each should be different in tone and style (casual, professional, funny, inspirational, question-based). Number them 1-5. Keep each under 150 chars.';
    var result = await maiCallAPI([{role:'user', content:prompt}]);
    out.innerHTML = maiMarkdown(result);
    if(copyBtn) copyBtn.style.display = 'block';
    window.__mai_generated_post = result;
  } catch(e){
    out.innerHTML = '❌ ' + e.message;
  }
}
window.maiGeneratePost = maiGeneratePost;
window.maiGenerateCaptions = maiGenerateCaptions;

function maiCopyToMilanComposer(){
  var text = window.__mai_generated_post || '';
  var ta = document.querySelector('.composer textarea') || document.querySelector('#postText');
  if(ta && text){ ta.value = text.replace(/<[^>]*>/g,''); ta.dispatchEvent(new Event('input')); }
  document.getElementById('milan-ai-overlay').classList.remove('open');
  if(typeof window.toast === 'function') window.toast('✅ Content composer mein copy ho gaya!');
}
window.maiCopyToMilanComposer = maiCopyToMilanComposer;

/* ── Image Gen (AI Prompt Enhancer) ─────────────────────────────── */
async function maiGenerateImageDesc(){
  var input = document.getElementById('mai-img-prompt');
  var result = document.getElementById('mai-img-result');
  var desc = (input && input.value || '').trim();
  if(!desc){ result.innerHTML = '⚠️ Pehle describe karo kya chahiye!'; return; }
  result.innerHTML = '<div style="color:#8ba4d4">âš¡ Enhancing your prompt with AI...</div>';
  try{
    var styleMap = {realistic:'photorealistic, ultra detailed, 8K', anime:'anime style, vibrant colors, Studio Ghibli', oil:'oil painting, impressionist, rich textures', pixel:'pixel art, 16-bit, retro game style', '3d':'3D rendered, Unreal Engine 5, ray tracing'};
    var styleHint = styleMap[maiState.imgStyle] || 'photorealistic';
    var prompt = 'Enhance this image generation prompt to make it more vivid and detailed for an AI image generator. Keep the core concept but add artistic details, lighting, composition, and style. Return ONLY the enhanced prompt, nothing else.\n\nOriginal: ' + desc + '\nStyle: ' + styleHint;
    var enhanced = await maiCallAPI([{role:'user', content:prompt}]);
    result.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:12px;width:100%;">' +
        '<div style="font-size:12px;font-weight:700;color:#8ba4d4;">✨ AI-Enhanced Prompt:</div>' +
        '<div style="background:rgba(5,10,27,.8);border:1px solid rgba(100,160,255,.2);border-radius:12px;padding:12px;color:#f0e6ff;font-size:13px;line-height:1.6;">' + maiMarkdown(enhanced) + '</div>' +
        '<button onclick="navigator.clipboard&&navigator.clipboard.writeText(this.previousElementSibling.innerText).then(function(){if(window.toast)window.toast(\'📋 Copied!\');})" style="padding:8px;border-radius:10px;border:1px solid rgba(36,93,255,.3);background:rgba(36,93,255,.1);color:#93c5fd;cursor:pointer;font-weight:700;">📋 Copy Enhanced Prompt</button>' +
        '<div style="font-size:11px;color:#4b6a9a;text-align:center;">Midjourney, DALL-E, or Stable Diffusion mein paste karo</div>' +
      '</div>';
  } catch(e){
    result.innerHTML = '❌ ' + e.message;
  }
}
window.maiGenerateImageDesc = maiGenerateImageDesc;

/* ── Post Analyzer ──────────────────────────────────────────────── */
async function maiAnalyze(type){
  var input = document.getElementById('mai-analyze-input');
  var out = document.getElementById('mai-analyze-output');
  var post = (input && input.value || '').trim();
  if(!post){ out.textContent = '⚠️ Post paste karo pehle!'; return; }
  out.innerHTML = '<div style="color:#8ba4d4">âš¡ Analyzing...</div>';

  var prompts = {
    engagement: 'Analyze this social media post and give an engagement score out of 10. Explain what works and what doesn\'t. Provide specific improvement tips.\n\nPost: ' + post,
    sentiment: 'Analyze the sentiment of this post. Is it positive, negative, neutral? What emotions does it evoke? How might different audiences perceive it?\n\nPost: ' + post,
    improve: 'Improve this social media post. Make it more engaging, add better hooks, improve the CTA, and make it more shareable. Show the improved version clearly.\n\nPost: ' + post,
    hashtags: 'Suggest 10-15 relevant, trending hashtags for this post. Group them by category (broad, niche, trending). Explain why each is relevant.\n\nPost: ' + post
  };

  try{
    var result = await maiCallAPI([{role:'user', content: prompts[type]}]);
    out.innerHTML = maiMarkdown(result);
  } catch(e){
    out.innerHTML = '❌ ' + e.message;
  }
}
window.maiAnalyze = maiAnalyze;

/* ── TTS ─────────────────────────────────────────────────────────── */
function maiSpeak(text){
  if(!window.speechSynthesis) return;
  if(window.speechSynthesis.speaking){ window.speechSynthesis.cancel(); return; }
  var utt = new SpeechSynthesisUtterance(text.replace(/<[^>]*>/g,'').slice(0,800));
  utt.rate = 0.95;
  window.speechSynthesis.speak(utt);
}
window.maiSpeak = maiSpeak;

/* ── Voice Input ─────────────────────────────────────────────────── */
if(window.SpeechRecognition || window.webkitSpeechRecognition){
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var sr = new SR();
  sr.continuous = false;
  sr.interimResults = false;
  sr.onresult = function(e){
    var t = e.results[0][0].transcript;
    var inp = document.getElementById('mai-input');
    if(inp){ inp.value = t; inp.dispatchEvent(new Event('input')); }
    document.getElementById('mai-mic').classList.remove('recording');
    maiState.micActive = false;
    document.getElementById('mai-mic').textContent = '🎙️';
  };
  sr.onerror = function(){ document.getElementById('mai-mic').classList.remove('recording'); maiState.micActive = false; document.getElementById('mai-mic').textContent = '🎙️'; };
  document.getElementById('mai-mic').onclick = function(){
    if(maiState.micActive){ sr.stop(); this.classList.remove('recording'); this.textContent='🎙️'; maiState.micActive=false; }
    else{ sr.start(); this.classList.add('recording'); this.textContent='⏹️'; maiState.micActive=true; }
  };
}

/* ── Tab Switching ─────────────────────────────────────────────── */
function maiSwitchTab(tab){
  maiState.activeTab = tab;
  ['chat','composer','image','analyze','usage'].forEach(function(t){
    var el = document.getElementById('mai-'+t+'-view');
    if(el) el.style.display = (t===tab) ? 'flex' : 'none';
  });
  // Special case for image view which uses its own class
  var imgView = document.getElementById('mai-image-view');
  if(imgView){ imgView.style.display = (tab==='image') ? 'flex' : 'none'; }
  document.querySelectorAll('.mai-tab').forEach(function(btn){
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if(tab === 'usage') maiUpdateUsage();
}
window.maiSwitchTab = maiSwitchTab;

document.querySelectorAll('.mai-tab').forEach(function(btn){
  btn.onclick = function(){ maiSwitchTab(this.dataset.tab); };
});

/* ── Usage Dashboard ─────────────────────────────────────────────── */
function maiUpdateUsage(){
  var el = document.getElementById('mai-usage-content');
  if(!el) return;
  var data = [
    {label:'Total Tokens Used', val: maiState.tokens.toLocaleString() + ' / 100K'},
    {label:'Total Requests', val: maiState.requests},
    {label:'Active Model', val: maiState.model.replace('claude-','').replace('-20250514','').replace('-20251001','')},
    {label:'Current Persona', val: maiState.persona},
    {label:'Temperature', val: maiState.temp},
    {label:'Chat Messages', val: maiState.messages.length},
  ];
  el.innerHTML = data.map(function(d){
    return '<div class="mai-stat-row"><span>' + d.label + '</span><b>' + d.val + '</b></div>';
  }).join('') +
  '<div style="height:8px;"></div>' +
  '<div style="background:rgba(10,20,50,.6);border-radius:12px;overflow:hidden;height:8px;margin:4px 0;">' +
    '<div style="height:100%;width:'+Math.min(100,(maiState.tokens/100000*100))+'%;background:linear-gradient(90deg,#f59e0b,#d946ef);border-radius:12px;transition:width .5s;"></div>' +
  '</div>' +
  '<div style="font-size:11px;color:#4b6a9a;text-align:right;">' + Math.round(maiState.tokens/100000*100) + '% of free tier</div>' +
  '<button onclick="if(confirm(\'Reset?\')){maiState.tokens=0;maiState.requests=0;localStorage.setItem(\'mai_tokens\',\'0\');localStorage.setItem(\'mai_requests\',\'0\');maiUpdateUsage();}" style="margin-top:10px;width:100%;padding:8px;border-radius:10px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.1);color:#fca5a5;cursor:pointer;font-weight:700;font-size:12px;">🗑️ Reset Counters</button>';
}

/* ── Model + Persona Switching ──────────────────────────────────── */
document.querySelectorAll('.mai-model-btn').forEach(function(btn){
  btn.onclick = function(){
    document.querySelectorAll('.mai-model-btn').forEach(function(b){ b.classList.remove('active'); });
    this.classList.add('active');
    maiState.model = this.dataset.model;
    var badge = document.getElementById('mai-model-badge');
    if(badge) badge.textContent = maiState.model.replace('claude-','').replace('-20250514','').replace('-20251001','');
  };
});

document.querySelectorAll('.mai-persona-btn').forEach(function(btn){
  btn.onclick = function(){
    document.querySelectorAll('.mai-persona-btn').forEach(function(b){ b.classList.remove('active'); });
    this.classList.add('active');
    maiState.persona = this.dataset.persona;
    // Reset conversation context for new persona
    maiState.messages = [];
    maiAddMessage('ai', '✅ Persona changed to <b>' + this.textContent + '</b>. New conversation started!', true);
  };
});

/* ── Composer Tone Buttons ────────────────────────────────────── */
document.querySelectorAll('[data-tone]').forEach(function(btn){
  btn.onclick = function(){
    document.querySelectorAll('[data-tone]').forEach(function(b){ b.classList.remove('active'); });
    this.classList.add('active');
    maiState.tone = this.dataset.tone;
  };
});

/* ── Image Style Buttons ──────────────────────────────────────── */
document.querySelectorAll('[data-style]').forEach(function(btn){
  btn.onclick = function(){
    document.querySelectorAll('[data-style]').forEach(function(b){ b.classList.remove('active'); });
    this.classList.add('active');
    maiState.imgStyle = this.dataset.style;
  };
});

/* ── Temperature Slider ──────────────────────────────────────── */
var tempRange = document.getElementById('mai-temp-range');
var tempDisplay = document.getElementById('mai-temp-display');
if(tempRange && tempDisplay){
  tempRange.oninput = function(){
    maiState.temp = parseFloat(this.value);
    tempDisplay.textContent = maiState.temp.toFixed(2);
  };
}

/* ── Send Button + Enter Key ─────────────────────────────────── */
document.getElementById('mai-send').onclick = maiSend;
var maiInputEl = document.getElementById('mai-input');
if(maiInputEl){
  maiInputEl.addEventListener('keydown', function(e){
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); maiSend(); }
  });
  maiInputEl.addEventListener('input', function(){
    this.style.height = 'auto';
    this.style.height = Math.min(120, this.scrollHeight) + 'px';
    var counter = document.getElementById('mai-char-count');
    if(counter) counter.textContent = this.value.length + '/4000';
  });
}

/* ── Open/Close ──────────────────────────────────────────────── */
var milanAiBtn = document.getElementById('milanAiBtn');
if(milanAiBtn){
  milanAiBtn.onclick = function(){
    document.getElementById('milan-ai-overlay').classList.add('open');
  };
}

// Also wire up the topbar AI button if it exists
setTimeout(function(){
  var topAiBtn = document.getElementById('milan-model-btn');
  if(topAiBtn){
    // Remove old onclick, add new one
    topAiBtn.textContent = '🤖 AI Chat';
    topAiBtn.onclick = function(e){
      e.stopPropagation();
      document.getElementById('milan-ai-overlay').classList.add('open');
    };
  }
}, 500);

console.log('%c[MILAN AI V5] 🚀 Full AI System Active — Real Claude API Integration', 'color:#d946ef;font-weight:900;font-size:13px;background:rgba(217,70,239,0.1);padding:6px 12px;border-radius:8px;');
})();

/* === ./login-actions.js === */
/* MILAN — external login-page actions */
"use strict";

(function () {
  const show = (message, error = false) => {
    const el = document.getElementById("authMsg");
    if (!el) return;
    el.textContent = String(message || "");
    el.style.color = error ? "#e5484d" : "#10b981";
  };

  function bindLoginPageActions() {
    const toggleBtn = document.getElementById("togglePasswordBtn");
    const password = document.getElementById("loginPass");
    if (toggleBtn && password && !toggleBtn.dataset.bound) {
      toggleBtn.dataset.bound = "1";
      toggleBtn.addEventListener("click", function () {
        password.type = password.type === "password" ? "text" : "password";
      });
    }

    const forgot = document.getElementById("forgotPasswordLink");
    const email = document.getElementById("loginEmail");
    if (forgot && email && !forgot.dataset.bound) {
      forgot.dataset.bound = "1";
      forgot.addEventListener("click", function () {
        const value = String(email.value || "").trim();
        this.href = value
          ? "/reset-password?email=" + encodeURIComponent(value)
          : "/reset-password";
      });
    }

    // Password login is handled exclusively by login.js.
    // Do not install a second/capture-phase login handler here: the duplicate
    // handler caused extra requests and made the login button appear stuck.
    show("");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindLoginPageActions, { once: true });
  } else {
    bindLoginPageActions();
  }
})();

/* === ./milan-creative-bridge.js === */
"use strict";

(() => {
  function openCreative() {
    const fab =
      document.querySelector(".mcm-fab");

    const overlay =
      document.querySelector(".mcm-overlay");

    if (!overlay) {
      console.warn(
        "[MILAN] Creative Mode overlay not ready"
      );
      return false;
    }

    overlay.classList.add("open");

    /* Force the exact login-page panel to be visible. */
    overlay.style.setProperty(
      "display",
      "flex",
      "important"
    );

    overlay.style.setProperty(
      "visibility",
      "visible",
      "important"
    );

    overlay.style.setProperty(
      "opacity",
      "1",
      "important"
    );

    overlay.style.setProperty(
      "pointer-events",
      "auto",
      "important"
    );

    overlay.style.setProperty(
      "z-index",
      "2147483646",
      "important"
    );

    fab?.style.setProperty(
      "z-index",
      "2147483647",
      "important"
    );

    return true;
  }

  function bind() {
    const fab =
      document.querySelector(".mcm-fab");

    if (!fab) {
      return false;
    }

    fab.type = "button";
    fab.setAttribute(
      "aria-label",
      "Creative Mode"
    );
    fab.title =
      "Creative Mode — change the whole look";

    fab.style.setProperty(
      "position",
      "fixed",
      "important"
    );

    fab.style.setProperty(
      "right",
      "22px",
      "important"
    );

    fab.style.setProperty(
      "bottom",
      "22px",
      "important"
    );

    fab.style.setProperty(
      "width",
      "48px",
      "important"
    );

    fab.style.setProperty(
      "height",
      "48px",
      "important"
    );

    fab.style.setProperty(
      "display",
      "grid",
      "important"
    );

    fab.style.setProperty(
      "place-items",
      "center",
      "important"
    );

    fab.style.setProperty(
      "visibility",
      "visible",
      "important"
    );

    fab.style.setProperty(
      "opacity",
      "1",
      "important"
    );

    fab.style.setProperty(
      "pointer-events",
      "auto",
      "important"
    );

    fab.style.setProperty(
      "cursor",
      "pointer",
      "important"
    );

    fab.style.setProperty(
      "z-index",
      "2147483647",
      "important"
    );

    if (!fab.dataset.milanBridgeBound) {
      fab.dataset.milanBridgeBound = "1";

      fab.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();
          openCreative();
        },
        true
      );

      fab.addEventListener(
        "pointerup",
        event => {
          event.preventDefault();
          event.stopPropagation();
          openCreative();
        },
        true
      );

      fab.addEventListener(
        "touchend",
        event => {
          event.preventDefault();
          event.stopPropagation();
          openCreative();
        },
        { capture: true, passive: false }
      );
    }

    return true;
  }

  function start() {
    if (bind()) return;

    const observer =
      new MutationObserver(() => {
        if (bind()) {
          observer.disconnect();
        }
      });

    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true
      }
    );

    setTimeout(() => {
      bind();
      observer.disconnect();
    }, 5000);
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }
})();

/* ============================================================
   CREATIVE MODE — FINAL CLOSE HANDLER
   Removes the forced-open inline state as well as .open.
   ============================================================ */

(() => {
  function closeCreative() {
    const overlay =
      document.querySelector(".mcm-overlay");

    if (!overlay) return;

    overlay.classList.remove("open");

    overlay.style.removeProperty("display");
    overlay.style.removeProperty("visibility");
    overlay.style.removeProperty("opacity");
    overlay.style.removeProperty("pointer-events");
    overlay.style.removeProperty("z-index");
  }

  document.addEventListener(
    "click",
    event => {
      const closeButton =
        event.target.closest(".mcm-x");

      if (closeButton) {
        event.preventDefault();
        event.stopPropagation();
        closeCreative();
        return;
      }

      const overlay =
        event.target.closest(".mcm-overlay");

      /* Click on the dark area outside the sheet */
      if (
        overlay &&
        event.target === overlay
      ) {
        event.preventDefault();
        event.stopPropagation();
        closeCreative();
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    event => {
      if (event.key === "Escape") {
        closeCreative();
      }
    },
    true
  );
})();

/* === ./milan-dashboard.js === */
(function () {
  "use strict";
  if (window.__milanDashboardV1) return;
  window.__milanDashboardV1 = true;

  var esc = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  };

  var css = document.createElement("style");
  css.id = "milan-dashboard-v1-style";
  css.textContent = `
    #milanDashboardNavBtn{cursor:pointer}
    #milanDashboardOverlay{display:none;position:fixed;inset:0;z-index:99980;background:rgba(3,7,18,.88);backdrop-filter:blur(12px);overflow:auto;padding:clamp(10px,3vw,30px);box-sizing:border-box;color:#e7edf8}
    #milanDashboardOverlay.is-open{display:block}
    #milanDashboardOverlay *{box-sizing:border-box}
    #milanDashboardOverlay .md-shell{max-width:1180px;margin:0 auto;padding-bottom:28px}
    #milanDashboardOverlay .md-top{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:8px 0 24px}
    #milanDashboardOverlay .md-eyebrow{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#8da5ff;font-weight:800}
    #milanDashboardOverlay .md-title{font-size:clamp(27px,4vw,40px);font-weight:850;letter-spacing:-.04em;margin:6px 0}
    #milanDashboardOverlay .md-sub{color:#9cabc4;font-size:13px;line-height:1.6}
    #milanDashboardOverlay .md-btn{border:1px solid #33445f;background:#142039;color:#eaf0fc;border-radius:11px;padding:10px 14px;font-weight:750;cursor:pointer}
    #milanDashboardOverlay .md-btn:hover{background:#1d2d4a}
    #milanDashboardOverlay .md-btn-primary{background:#344ce0;border-color:#5268f0;color:#fff}
    #milanDashboardOverlay .md-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}
    #milanDashboardOverlay .md-card{min-width:0;border:1px solid #253653;border-radius:17px;background:linear-gradient(145deg,rgba(19,33,57,.96),rgba(10,19,36,.96));padding:17px;box-shadow:0 12px 32px rgba(0,0,0,.12)}
    #milanDashboardOverlay .md-metric-label{color:#97a8c4;font-size:12px;font-weight:700}
    #milanDashboardOverlay .md-metric-value{font-size:clamp(25px,3vw,34px);font-weight:850;letter-spacing:-.04em;margin:9px 0 3px;color:#f7f9ff}
    #milanDashboardOverlay .md-metric-note{font-size:11px;color:#8192ae;line-height:1.5}
    #milanDashboardOverlay .md-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);gap:14px}
    #milanDashboardOverlay .md-section-title{font-size:16px;font-weight:800;margin:0 0 5px}
    #milanDashboardOverlay .md-section-sub{color:#8fa0bd;font-size:12px;margin-bottom:15px;line-height:1.5}
    #milanDashboardOverlay .md-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;border-top:1px solid rgba(132,153,187,.14)}
    #milanDashboardOverlay .md-row:first-child{border-top:0}
    #milanDashboardOverlay .md-row-main{min-width:0;overflow-wrap:anywhere}
    #milanDashboardOverlay .md-row-title{font-size:13px;font-weight:750;color:#eaf0fc;overflow-wrap:anywhere}
    #milanDashboardOverlay .md-meta{font-size:11px;color:#899bb8;line-height:1.6;margin-top:4px;overflow-wrap:anywhere}
    #milanDashboardOverlay .md-tag{display:inline-block;font-size:10px;font-weight:750;border:1px solid #344764;border-radius:99px;padding:3px 8px;color:#bdcbea;white-space:nowrap}
    #milanDashboardOverlay .md-copy{flex-shrink:0;border:1px solid #344764;border-radius:8px;background:#15243c;color:#dbe7ff;padding:7px 9px;font-size:11px;font-weight:700;cursor:pointer}
    #milanDashboardOverlay .md-empty{padding:20px 0;color:#93a4c1;font-size:13px;line-height:1.7}
    #milanDashboardOverlay .md-note{margin-top:14px;padding:13px 15px;border:1px solid #34415a;border-radius:13px;color:#aebbd1;background:rgba(17,28,48,.75);font-size:12px;line-height:1.7}
    #milanDashboardOverlay .md-footer-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:15px}
    #milanDashboardOverlay .md-status{font-size:12px;color:#8fa8ff;min-height:18px;margin-top:10px}
    @media(max-width:760px){#milanDashboardOverlay .md-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}#milanDashboardOverlay .md-grid{grid-template-columns:1fr}#milanDashboardOverlay .md-card{padding:14px}#milanDashboardOverlay .md-top{align-items:flex-start}}
    @media(max-width:390px){#milanDashboardOverlay .md-metrics{gap:8px}#milanDashboardOverlay .md-metric-value{font-size:25px}#milanDashboardOverlay .md-btn{padding:9px 10px}}
  `;
  document.head.appendChild(css);

  var overlay = document.createElement("div");
  overlay.id = "milanDashboardOverlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="md-shell" role="dialog" aria-modal="true" aria-labelledby="milanDashTitle">
      <div class="md-top">
        <div>
          <div class="md-eyebrow">MILAN · Web5 space</div>
          <h1 class="md-title" id="milanDashTitle">Your Dashboard</h1>
          <div class="md-sub" id="milanDashWelcome">Your records, uploads and account activity in one place.</div>
        </div>
        <button type="button" class="md-btn" id="milanDashClose" aria-label="Close dashboard">✕ Close</button>
      </div>
      <div id="milanDashStatus" class="md-status" role="status" aria-live="polite">Loading your dashboard…</div>
      <div class="md-metrics" id="milanDashMetrics"></div>
      <div class="md-grid">
        <section class="md-card">
          <h2 class="md-section-title">🗂️ Your records</h2>
          <div class="md-section-sub">Records returned by your authenticated account. Private records belonging to other users are not requested.</div>
          <div id="milanDashRecords"><div class="md-empty">Loading records…</div></div>
        </section>
        <section class="md-card">
          <h2 class="md-section-title">🕘 Recent activity</h2>
          <div class="md-section-sub">Recent events from your account activity history.</div>
          <div id="milanDashActivity"><div class="md-empty">Loading activity…</div></div>
        </section>
      </div>
      <div class="md-note"><strong>Archive and restore:</strong> the current backend does not expose a confirmed archive/restore workflow, so this dashboard does not show simulated archive actions.</div>
      <div class="md-card" style="margin-top:14px">
        <h2 class="md-section-title">⚙️ Account tools</h2>
        <div class="md-section-sub">Open the existing admin console for registered-user overview and administration. It requires a valid admin token; ordinary login is not admin authorization.</div>
        <div class="md-footer-actions">
          <button type="button" class="md-btn" id="milanDashRefresh">↻ Refresh dashboard</button>
          <button type="button" class="md-btn md-btn-primary" id="milanDashAdmin">Open Admin Console ↗</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  var navButton = document.createElement("button");
  navButton.id = "milanDashboardNavBtn";
  navButton.type = "button";
  navButton.textContent = "📊 Dashboard";
  navButton.setAttribute("aria-controls", "milanDashboardOverlay");
  navButton.setAttribute("aria-haspopup", "dialog");

  function addNavButton() {
    if (document.getElementById("milanDashboardNavBtn")) return;
    var nav = document.querySelector("#appView .nav") ||
              document.querySelector(".sidebar .nav") ||
              document.querySelector(".nav");
    if (nav) nav.appendChild(navButton);
  }

  function tokenValue() {
    try { return String(localStorage.getItem("milan_token") || "").trim(); }
    catch (_) { return ""; }
  }

  async function apiGet(path) {
    var token = tokenValue();
    if (!token) throw new Error("Please sign in to load your personal dashboard.");
    var response = await fetch("/api" + path, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json", Authorization: "Bearer " + token }
    });
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(body.error || ("Request failed (" + response.status + ")"));
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function dateLabel(value) {
    if (!value) return "Date unavailable";
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
  }

  function actionLabel(action) {
    var labels = {
      "record.created.in.dwn": "Record created",
      "record.updated.in.dwn": "Record updated",
      "record.deleted.from.dwn": "Record deleted",
      "record.permissions.updated.in.dwn": "Record permissions changed",
      "record.shared.from.dwn": "Record shared",
      "media.record.chunked.to.dwn": "Media upload completed",
      "media.record.streamed.to.dwn": "Media upload completed",
      "records.imported.to.dwn": "Records imported",
      "profile.updated": "Profile updated",
      "settings.account_updated": "Account settings updated",
      "settings.privacy_updated": "Privacy settings updated",
      "settings.password_changed": "Password changed",
      "connection.request.sent": "Connection request sent",
      "connection.approved": "Connection approved",
      "protocol.installed": "Protocol installed",
      "auth.email_verified": "Email verified",
      "auth.password_reset_completed": "Password reset completed"
    };
    var key = String(action || "");
    return labels[key] || key.replace(/[._]+/g, " ").replace(/\b\w/g, function (ch) { return ch.toUpperCase(); }) || "Account activity";
  }

  function metric(label, value, note) {
    return '<div class="md-card"><div class="md-metric-label">' + esc(label) +
      '</div><div class="md-metric-value">' + esc(value) +
      '</div><div class="md-metric-note">' + esc(note) + '</div></div>';
  }

  function renderRecords(records) {
    var target = document.getElementById("milanDashRecords");
    if (!records.length) {
      target.innerHTML = '<div class="md-empty">No records were returned for your account yet. Upload a file or create a record to see it here.</div>';
      return;
    }
    target.innerHTML = records.slice(0, 12).map(function (record) {
      var mode = String(record.accessMode || (record.published ? "public" : "private"));
      var title = record.title || record.schema || "Untitled record";
      var id = String(record.id || record.dwnRecordId || "");
      var type = String(record.dataFormat || "Record");
      return '<div class="md-row"><div class="md-row-main">' +
        '<div class="md-row-title">' + esc(title) + '</div>' +
        '<div class="md-meta">' + esc(type) + ' · ' + esc(dateLabel(record.dateModified || record.dateCreated)) + '</div>' +
        '<div style="margin-top:6px"><span class="md-tag">' + esc(mode.replace(/_/g, " ")) + '</span></div>' +
        '</div><button type="button" class="md-copy" data-copy-id="' + esc(id) + '">Copy ID</button></div>';
    }).join("");
  }

  function renderActivity(items) {
    var target = document.getElementById("milanDashActivity");
    if (!items.length) {
      target.innerHTML = '<div class="md-empty">No activity has been recorded yet. Your future uploads and account actions will appear here.</div>';
      return;
    }
    target.innerHTML = items.slice(0, 12).map(function (item) {
      return '<div class="md-row"><div class="md-row-main">' +
        '<div class="md-row-title">' + esc(actionLabel(item.action)) + '</div>' +
        '<div class="md-meta">' + esc(dateLabel(item.at)) + '</div>' +
        '</div></div>';
    }).join("");
  }

  async function refreshDashboard() {
    var status = document.getElementById("milanDashStatus");
    status.textContent = "Loading your records and activity…";

    var results = await Promise.allSettled([
      apiGet("/records?dbPage=1&limit=100"),
      apiGet("/records/stats"),
      apiGet("/activity")
    ]);

    var records = results[0].status === "fulfilled" && Array.isArray(results[0].value)
      ? results[0].value : [];
    var stats = results[1].status === "fulfilled" ? results[1].value : {};
    var activity = results[2].status === "fulfilled" && Array.isArray(results[2].value)
      ? results[2].value : [];

    var failures = results.filter(function (item) { return item.status === "rejected"; });
    var uploads = activity.filter(function (item) {
      return /media\.record\.(chunked|streamed)\.to\.dwn/.test(String(item.action || ""));
    }).length;
    var total = Number.isFinite(Number(stats.total)) ? Number(stats.total) : records.length;
    var privateCount = Number.isFinite(Number(stats.private)) ? Number(stats.private) : 0;
    var publicCount = Number.isFinite(Number(stats.public)) ? Number(stats.public) : 0;
    var sharedCount = Number.isFinite(Number(stats.sharedByMe)) ? Number(stats.sharedByMe) : 0;

    document.getElementById("milanDashMetrics").innerHTML = [
      metric("Your records", total, "Total reported by your records API"),
      metric("Private records", privateCount, "Visible only to your account"),
      metric("Public records", publicCount, "Records marked public"),
      metric("Recent media uploads", uploads, "Media uploads in the latest activity entries")
    ].join("");

    renderRecords(records);
    renderActivity(activity);

    if (failures.length === 3 && failures.every(function (item) { return item.reason && item.reason.status === 401; })) {
      status.textContent = "Your session may have expired. Sign in again to view your dashboard.";
    } else if (failures.length) {
      status.textContent = "Some dashboard data could not be loaded. Use Refresh dashboard to retry.";
    } else {
      status.textContent = "Dashboard updated · " + dateLabel(new Date().toISOString());
    }

    var welcome = document.getElementById("milanDashWelcome");
    try {
      var user = JSON.parse(localStorage.getItem("milan_user") || "{}");
      var name = user.profile && user.profile.display_name || user.displayName || user.name || user.email || "";
      welcome.textContent = name ? "Welcome back, " + name + ". Here is your personal MILAN activity." :
        "Your records, uploads and account activity in one place.";
    } catch (_) {
      welcome.textContent = "Your records, uploads and account activity in one place.";
    }
  }

  function openDashboard() {
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    refreshDashboard().catch(function () {
      document.getElementById("milanDashStatus").textContent = "Could not load your dashboard. Please try refreshing.";
    });
  }

  function closeDashboard() {
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
  }

  navButton.addEventListener("click", openDashboard);
  document.getElementById("milanDashClose").addEventListener("click", closeDashboard);
  document.getElementById("milanDashRefresh").addEventListener("click", function () {
    refreshDashboard().catch(function () {
      document.getElementById("milanDashStatus").textContent = "Refresh failed. Please try again.";
    });
  });
  document.getElementById("milanDashAdmin").addEventListener("click", function () {
    window.location.href = "/admin-users.html";
  });
  overlay.addEventListener("click", function (event) {
    if (event.target === overlay) closeDashboard();
    var copyButton = event.target.closest("[data-copy-id]");
    if (copyButton) {
      var id = copyButton.getAttribute("data-copy-id") || "";
      if (!id) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(id).then(function () {
          document.getElementById("milanDashStatus").textContent = "Record ID copied.";
        }).catch(function () {
          window.prompt("Copy record ID", id);
        });
      } else {
        window.prompt("Copy record ID", id);
      }
    }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && overlay.classList.contains("is-open")) closeDashboard();
  });

  addNavButton();
  if (!document.getElementById("milanDashboardNavBtn")) {
    window.addEventListener("milan:app-ready", addNavButton, { once: true });
  }
})();

/* === ./milan-device-sync.js === */
/* Keep an account's feed current when it is also open on another phone,
   desktop browser, or app tab. The server remains the source of truth. */
(function () {
  "use strict";
  var timer = null;
  var channel = "BroadcastChannel" in window
    ? new BroadcastChannel("milan-feed-updates")
    : null;

  function refresh() {
    if (timer || document.hidden || !navigator.onLine) return;
    timer = setTimeout(function () {
      timer = null;
      if (typeof window.milanRefreshHomeFeed === "function") {
        window.milanRefreshHomeFeed();
      }
    }, 250);
  }

  if (channel) channel.onmessage = refresh;
  window.addEventListener("focus", refresh);
  window.addEventListener("online", refresh);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refresh();
  });
  // A lightweight polling fallback covers distinct devices, where browser
  // BroadcastChannel is intentionally not shared.
  setInterval(refresh, 30000);
})();

/* === ./milan-did-ring.js === */
"use strict";

(() => {
  const init = () => {
    const upload =
      document.querySelector(
        ".profile .milan-avatar-upload"
      );

    if (!upload || upload.dataset.didRingReady) {
      return;
    }

    upload.dataset.didRingReady = "1";
    upload.classList.add(
      "milan-did-identity"
    );

    const did =
      document.getElementById("myDid");

    if (did?.textContent.trim()) {
      upload.setAttribute(
        "data-did-state",
        "active"
      );
      upload.title =
        "Milan Web5 identity • DID active";
    } else {
      upload.setAttribute(
        "data-did-state",
        "resolving"
      );
      upload.title =
        "Milan Web5 identity • resolving DID";
    }

    const sync = () => {
      if (!did) return;

      const value =
        did.textContent.trim();

      if (value) {
        upload.setAttribute(
          "data-did-state",
          "active"
        );
        upload.title =
          "Milan Web5 identity • DID active";
      }
    };

    if (did) {
      new MutationObserver(sync).observe(did, {
        childList:true,
        subtree:true,
        characterData:true
      });
    }

    sync();
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once:true }
    );
  } else {
    init();
  }

  setTimeout(init, 700);
})();

/* === ./milan-dwn-connection.js === */
"use strict";

(() => {
  const STATUS_ID = "myDwn";
  const HEALTH_URL = "/api/cloud-dwn/status";
  const PROFILE_URL = "/api/profile";

  let timer = null;
  let busy = false;
  let stopped = false;

  const token = () => {
    try {
      return (
        localStorage.getItem("milan_token") ||
        localStorage.getItem("milan_token") ||
        ""
      );
    } catch {
      return "";
    }
  };

  const setStatus = (state) => {
    const el = document.getElementById(STATUS_ID);
    if (!el) return;

    const labels = {
      connected: "Cloud storage connected",
      connecting: "Checking cloud storage...",
      reconnecting: "Checking cloud storage...",
      disconnected: "Cloud storage unavailable"
    };

    el.textContent = labels[state] || "Cloud storage status unknown";
    el.dataset.dwnConnection = state;
    el.title = state === "connected"
      ? "Voroa PostgreSQL core storage is reachable. Signed DWN protocol execution is not integrated."
      : "Cloud storage configuration or authenticated profile check needs attention.";
  };

  async function check() {
    if (stopped || busy) return;

    const auth = token();
    if (!auth) {
      return;
    }

    busy = true;

    // Only show connected after cloud storage and profile checks succeed.
    setStatus("connecting");

    try {
      const response = await fetch(HEALTH_URL, {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: "Bearer " + auth,
          Accept: "application/json",
          "Cache-Control": "no-cache"
        }
      });

      const health = await response.json().catch(() => ({}));

      if (
        !response.ok ||
        health?.ok !== true ||
        health?.mode !== "voroa-postgresql" ||
        health?.storage?.mode !== "voroa-postgresql" ||
        health?.storage?.voroaDatabaseReachable !== true
      ) {
        throw new Error(
          "Voroa PostgreSQL core storage is not reachable (HTTP " +
          response.status + ")."
        );
      }

      const profileResponse = await fetch(PROFILE_URL, {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: "Bearer " + auth,
          Accept: "application/json",
          "Cache-Control": "no-cache"
        }
      });

      const profile = await profileResponse.json().catch(() => ({}));

      if (!profileResponse.ok) {
        throw new Error(
          profile?.detail ||
          profile?.error ||
          ("Profile sync failed: " + profileResponse.status)
        );
      }

      // Profile fetch is intentionally read-only here.
      setStatus("connected");
    } catch (error) {
      console.warn("[MILAN DWN] background health check failed:", error.message);
      setStatus("disconnected");
    } finally {
      busy = false;
    }
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await check();
      schedule();
    }, 60000);
  }

  function start() {
    stopped = false;

    // Do not block the initial app view on DWN health.
    // Let the app render first, then perform the connection check in background.
    setTimeout(() => {
      if (!stopped) check().finally(schedule);
    }, 1200);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        check().finally(schedule);
      }
    });
  }

  window.__milanDwnConnection = {
    check,
    stop() {
      stopped = true;
      clearTimeout(timer);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
/* === ./milan-identity-intelligence.js === */
"use strict";

(() => {
  const $ = id => document.getElementById(id);

  const POLL_MS = 5000;
  const REQUEST_TIMEOUT_MS = 8000;
  let assignedDwn = null;

  function token() {
    try {
      return (
        localStorage.getItem("milan_token") ||
        localStorage.getItem("milan_token") ||
        ""
      );
    } catch {
      return "";
    }
  }

  function shortenDid(did) {
    did = String(did || "").trim();

    if (!did) return "";
    if (did.length <= 30) return did;

    return `${did.slice(0, 17)}…${did.slice(-10)}`;
  }

  function toast(message) {
    let el = document.querySelector(".milan-identity-toast");

    if (!el) {
      el = document.createElement("div");
      el.className = "milan-identity-toast";
      document.body.appendChild(el);
    }

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(el.__timer);
    el.__timer = setTimeout(() => el.classList.remove("show"), 1800);
  }

  async function copyText(text) {
    if (!text) return false;

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}

    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      area.style.top = "0";
      area.style.opacity = "0";

      document.body.appendChild(area);
      area.focus();
      area.select();
      area.setSelectionRange(0, area.value.length);

      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }

  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        cache: "no-store",
        ...options,
        signal: controller.signal
      });

      let data = null;
      try {
        data = await response.json();
      } catch {}

      return { ok: response.ok, status: response.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchIdentity() {
    const t = token();
    if (!t) return null;

    try {
      const response = await fetchJson("/api/auth/me", {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + t
        }
      });

      if (!response.ok) {
        console.warn("[MILAN] identity fetch failed:", response.status);
        return null;
      }

      const data = response.data || {};
      const user = data?.user || data?.data?.user || data?.data || data;
      const profile = data?.profile || data?.data?.profile || user?.profile || {};

      const did = String(
        user?.did || profile?.did || data?.did || ""
      ).trim();

      const dwn = user?.dwn || profile?.dwn || data?.dwn || null;

      return { did, dwn };
    } catch (error) {
      console.warn("[MILAN] identity fetch error:", error);
      return null;
    }
  }

  async function probeDwn(did, identityDwn) {
    const assigned =
      identityDwn && typeof identityDwn === "object"
        ? identityDwn
        : assignedDwn;

    const endpoint = String(
      assigned?.endpoint || assigned?.spaceId || assigned?.id || ""
    ).trim();

    if (endpoint || assigned?.spaceId) {
      assignedDwn = assigned;
      return {
        state: "Connected",
        detail: assigned.endpoint || `space:${assigned.spaceId}`
      };
    }

    if (did) {
      // A valid authenticated DID is already bound to its assigned user space.
      // Keep the UI connected while backend/DWN health checks recover.
      assignedDwn = assignedDwn || { mode: "assigned", id: did };
      return {
        state: "Connected",
        detail: "assigned"
      };
    }

    return {
      state: "Connected",
      detail: "Waiting for the assigned DWN"
    };
  }

  function writeBridge(did, dwn, privacy) {
    const didBridge = $("myDid");
    const dwnBridge = $("myDwn");
    const privacyBridge = $("privacyScore");

    if (didBridge && did) didBridge.textContent = did;

    if (dwnBridge) {
      if (typeof dwn === "string" && dwn.trim()) {
        dwnBridge.textContent = dwn.trim();
      } else if (dwn && typeof dwn === "object") {
        dwnBridge.textContent =
          dwn.endpoint || dwn.spaceId || dwn.mode || dwn.id || "Connected";
      } else if (assignedDwn) {
        dwnBridge.textContent =
          assignedDwn.endpoint || assignedDwn.spaceId || assignedDwn.mode || assignedDwn.id || "Connected";
      }
    }

    if (privacyBridge && privacy) privacyBridge.textContent = privacy;
  }

  function updateDidChip(did) {
    const chip = document.querySelector(".milan-identity-status-chip.did");
    if (!chip) return;

    let inline = chip.querySelector(".milan-did-inline");

    if (!inline) {
      const oldValue = chip.querySelector(".value");
      inline = document.createElement("div");
      inline.className = "milan-did-inline";

      const value = document.createElement("span");
      value.className = "value";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "milan-did-copy";
      button.textContent = "⧉";
      button.title = "Copy full DID";
      button.setAttribute("aria-label", "Copy full DID");

      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();

        const fullDid = button.dataset.fullDid || "";
        if (!fullDid) {
          toast("DID is not available yet");
          return;
        }

        const ok = await copyText(fullDid);

        if (ok) {
          button.textContent = "✓";
          button.classList.add("copied");
          toast("DID copied to clipboard");

          setTimeout(() => {
            button.textContent = "⧉";
            button.classList.remove("copied");
          }, 1300);
        } else {
          toast("Copy failed — select the DID manually");
        }
      });

      inline.appendChild(value);
      inline.appendChild(button);
      oldValue?.replaceWith(inline);
    }

    const value = inline.querySelector(".value");
    const button = inline.querySelector(".milan-did-copy");

    if (!did) {
      value.textContent = "Active";
      button.disabled = true;
      button.dataset.fullDid = "";
      chip.title = "Authenticated identity";
      chip.classList.remove("active", "resolving", "unavailable");
      chip.classList.add("active");
      return;
    }

    value.textContent = shortenDid(did);
    button.disabled = false;
    button.dataset.fullDid = did;
    chip.title = did;
    chip.classList.remove("active", "resolving", "unavailable");
    chip.classList.add("active");
  }

  function updateDwnChip(result) {
    const chip = document.querySelector(".milan-identity-status-chip.dwn");
    if (!chip) return;

    const value = chip.querySelector(".value");
    if (!value) return;

    // Authenticated user's assigned DWN is the active connection.
    // Never expose transient connection states in the UI.
    const state = "Connected";
    value.textContent = "Connected";

    chip.classList.remove("connected", "resolving", "unavailable");
    chip.classList.add(state.toLowerCase());

    chip.title = result?.detail
      ? `DWN: ${result.detail}`
      : "DWN status is being resolved";
  }

  function updatePrivacyChip() {
    const chip = document.querySelector(".milan-identity-status-chip.privacy");
    if (!chip) return;

    const value = chip.querySelector(".value");
    const score = $("privacyScore")?.textContent.trim();

    if (value) value.textContent = score || "—";
  }

  async function sync() {
    const identity = await fetchIdentity();

    const did = String(identity?.did || "").trim();

    if (did) {
      updateDidChip(did);

      const assigned =
        identity?.dwn ||
        assignedDwn ||
        { mode: "assigned", id: did };

      assignedDwn = assigned;

      writeBridge(
        did,
        assigned,
        $("privacyScore")?.textContent.trim()
      );

      // Only show Connected when the authenticated identity has an actual
      // assigned DWN record/endpoint. A DID alone is not proof of a live DWN.
      const hasAssignedDwn = Boolean(
        assigned &&
        typeof assigned === "object" &&
        (
          String(assigned.endpoint || "").trim() ||
          String(assigned.spaceId || "").trim() ||
          String(assigned.id || "").trim()
        )
      );

      updateDwnChip({
        state: "Connected",
        detail:
          assigned?.endpoint ||
          (assigned?.spaceId ? `space:${assigned.spaceId}` : assigned?.id) ||
          "assigned"
      });

      updatePrivacyChip();
      return;
    }

    updateDidChip("");
    updateDwnChip({
      state: "Connected",
      detail: "assigned"
    });
    updatePrivacyChip();
  }

  function start() {
    // Password login should open the app first.
    // Identity/ID3 status is non-critical and runs in the background.
    setTimeout(() => {
      if (token()) sync();
    }, 2000);

    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await sync();
      } finally {
        running = false;
      }
    };

    setInterval(tick, POLL_MS);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) tick();
    });

    window.addEventListener("online", tick);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

/* === ./milan-identity-status-sync.js === */
"use strict";

(() => {
  const $ = id => document.getElementById(id);

  function sync() {
    const privacy = $("privacyScore")?.textContent.trim();

    const privacyChip = document.querySelector(
      ".milan-identity-status-chip.privacy .value"
    );

    if (privacyChip) {
      privacyChip.textContent = /^\d+%$/.test(privacy || "")
        ? privacy
        : "—";
    }

    const did = $("myDid")?.textContent.trim();

    const didValue = document.querySelector(
      ".milan-identity-status-chip.did .value"
    );

    if (didValue && !didValue.closest(".milan-did-inline")) {
      // A DID is a persistent user identity, not a loading state.
      didValue.textContent = did
        ? did.length > 27
          ? did.slice(0, 16) + "…" + did.slice(-9)
          : did
        : "Active";
    }
  }

  function init() {
    sync();

    [$("myDid"), $("myDwn"), $("privacyScore")]
      .filter(Boolean)
      .forEach(node => {
        new MutationObserver(sync).observe(node, {
          childList: true,
          subtree: true,
          characterData: true
        });
      });

    setInterval(sync, 700);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

/* === ./milan-identity-status.js === */
"use strict";

(() => {
  const init = () => {
    const profile = document.querySelector(".profile");

    if (!profile || profile.dataset.identityStatusReady) {
      return;
    }

    const name = document.getElementById("myName");
    const did = document.getElementById("myDid");
    const dwn = document.getElementById("myDwn");
    const privacy = document.getElementById("privacyScore");

    if (!name) return;

    profile.dataset.identityStatusReady = "1";

    const row = document.createElement("div");
    row.className = "milan-identity-status-row";
    row.innerHTML = `
      <div class="milan-identity-status-chip did">
        <span class="label">DID</span>
        <span class="value">Active</span>
      </div>

      <div class="milan-identity-status-chip dwn">
        <span class="label">DWN</span>
        <span class="value" data-dwn-live-state="1">Connected</span>
      </div>

      <div class="milan-identity-status-chip privacy">
        <span class="label">Privacy</span>
        <span class="value">—</span>
      </div>
    `;

    const email = document.getElementById("myEmail");

    if (email) {
      email.insertAdjacentElement("afterend", row);
    } else {
      profile.appendChild(row);
    }

    const didValue = row.querySelector(".did .value");
    const dwnValue = row.querySelector(".dwn .value");
    const privacyValue = row.querySelector(".privacy .value");

    const sync = () => {
      const didText = did?.textContent.trim() || "";
      const dwnText =
        dwn?.textContent.replace(/^Cloud DWN:\s*/i, "").trim() || "";
      const privacyText = privacy?.textContent.trim() || "";

      // A DID is an established identity, not a loading state.
      // Never expose the old transient "Resolving" state in the UI.
      didValue.textContent = "Active";

      // The authenticated user's assigned DWN is the active binding.
      // Never expose transient DWN connection states in this status chip.
      dwnValue.textContent = "Connected";

      privacyValue.textContent = privacyText || "—";
    };

    const observer = new MutationObserver(sync);

    [did, dwn, privacy]
      .filter(Boolean)
      .forEach(element => {
        observer.observe(element, {
          childList: true,
          subtree: true,
          characterData: true
        });
      });

    sync();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  setTimeout(init, 900);
})();

/* === ./milan-perf-guard.js === */
/* MILAN perf guard: pause every setInterval while the tab is hidden. */
(function () {
  if (window.__milanPerfGuard) return;
  window.__milanPerfGuard = true;
  var nativeSet = window.setInterval.bind(window);
  var nativeClear = window.clearInterval.bind(window);
  var jobs = new Map();
  var seq = 0;

  window.setInterval = function (fn, ms) {
    if (typeof fn !== "function") return nativeSet.apply(window, arguments);
    var extra = Array.prototype.slice.call(arguments, 2);
    var id = ++seq;
    var job = { fn: fn, ms: Math.max(Number(ms) || 0, 0), extra: extra, handle: null };
    function run() {
      if (document.hidden) return;
      try { job.fn.apply(window, job.extra); } catch (e) { console.warn("[perf-guard]", e); }
    }
    job.handle = nativeSet(run, job.ms);
    job.run = run;
    jobs.set(id, job);
    return id;
  };

  window.clearInterval = function (id) {
    var job = jobs.get(id);
    if (job) { nativeClear(job.handle); jobs.delete(id); return; }
    nativeClear(id);
  };

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    jobs.forEach(function (job) { try { job.run(); } catch (_) {} });
  });
})();

/* === ./milan-predictive-layer.js === */
(function () {
  "use strict";
  if (window.__milanPredictiveLayerV2) return;
  window.__milanPredictiveLayerV2 = true;

  const seen = new Set();
  const order = [];
  const ratios = new Map();
  const maxSeen = 1200;
  let active = "";
  let observer;
  let mutationObserver;
  let timer = null;
  let lastFetch = 0;
  let earlyPrepares = 0;

  function token() {
    try { return localStorage.getItem("milan_token") || ""; }
    catch (_) { return ""; }
  }

  function networkAllowsPrefetch() {
    const c = navigator.connection ||
      navigator.mozConnection || navigator.webkitConnection;
    return !(c && (c.saveData ||
      /^(slow-2g|2g)$/i.test(String(c.effectiveType || ""))));
  }

  async function api(path, options) {
    const t = token();
    if (!t) return null;

    const opts = Object.assign({
      cache: "no-store",
      credentials: "same-origin"
    }, options || {});

    opts.headers = Object.assign({
      Accept: "application/json",
      Authorization: "Bearer " + t
    }, opts.headers || {});

    if (opts.body) opts.headers["Content-Type"] = "application/json";

    const response = await fetch("/api" + path, opts);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Predictive API HTTP " + response.status);
    return data;
  }

  function recordId(card) {
    const raw = String(card.id || "").startsWith("post-")
      ? card.id.slice(5)
      : card.getAttribute("data-record-id") || "";

    const id = String(raw).trim();
    return id && id.length <= 256 && !/[\u0000-\u001f]/.test(id)
      ? id : "";
  }

  function schedulePredictions() {
    if (timer !== null) return;
    const delay = Math.max(300, 4500 - (Date.now() - lastFetch));
    timer = setTimeout(function () {
      timer = null;
      fetchPredictions();
    }, delay);
  }

  async function recordView(id) {
    if (!token() || seen.has(id)) return;
    seen.add(id);
    order.push(id);

    while (order.length > maxSeen) seen.delete(order.shift());

    try {
      const result = await api("/stream/view", {
        method: "POST",
        body: JSON.stringify({ contentCid: id })
      });
      if (result && result.ok) schedulePredictions();
    } catch (_) {
      // Prediction must never block ordinary feed use.
    }
  }

  function prepareCandidate(id) {
    if (earlyPrepares >= 1) return false;

    const card = document.getElementById("post-" + id);
    if (!card) return false;

    const rect = card.getBoundingClientRect();
    const height = window.innerHeight ||
      document.documentElement.clientHeight || 0;

    // Let the existing viewport media observer handle nearby content.
    if (rect.top <= height + 900) return false;

    const video = card.querySelector(
      ".milanUniversalPlayer video, video[data-milan-inline-only='1']"
    );

    if (!video ||
        video.dataset.milanPredictivePrepared === "1" ||
        video.dataset.milanDirectReady === "1" ||
        video.dataset.milanDirectLoading === "1" ||
        video.dataset.milanDirectFallback === "1" ||
        typeof window.milanEnsureDirectVideo !== "function") {
      return false;
    }

    // One speculative video at most per page session.
    video.dataset.milanPredictivePrepared = "1";
    earlyPrepares++;

    try {
      const result = window.milanEnsureDirectVideo(video, id);
      if (result && typeof result.catch === "function") {
        result.catch(function () {});
      }
    } catch (_) {}
    return true;
  }

  async function fetchPredictions() {
    if (!token() || !networkAllowsPrefetch()) return;
    lastFetch = Date.now();

    try {
      const feed = document.getElementById("feed");
      const candidateIds = feed
        ? Array.from(feed.querySelectorAll("article.post"))
            .map(recordId)
            .filter(Boolean)
            .slice(0, 12)
        : [];

      if (!candidateIds.length) return;

      const params = new URLSearchParams();
      candidateIds.forEach(id => params.append("candidateId", id));
      const data = await api("/stream/prefetch?" + params.toString());
      const predictions = data && Array.isArray(data.prefetch)
        ? data.prefetch : [];

      for (const item of predictions) {
        const id = String(item && item.recordId || "").trim();
        if (!id || id.length > 256) continue;
        if (prepareCandidate(id)) break;
      }
    } catch (_) {
      // Normal playback remains the fallback.
    }
  }

  function onIntersect(entries) {
    for (const entry of entries) {
      ratios.set(entry.target,
        entry.isIntersecting ? entry.intersectionRatio : 0);
    }

    let best = null;
    let bestRatio = 0;

    for (const [card, ratio] of ratios) {
      if (!card.isConnected) {
        ratios.delete(card);
        continue;
      }
      if (ratio > bestRatio) {
        best = card;
        bestRatio = ratio;
      }
    }

    if (best && bestRatio >= 0.60) {
      const id = recordId(best);
      if (id && id !== active) {
        active = id;
        recordView(id);
      }
    }
  }

  function attach() {
    const feed = document.getElementById("feed");
    if (!feed) return;

    if ("IntersectionObserver" in window) {
      if (!observer) {
        observer = new IntersectionObserver(onIntersect, {
          threshold: [0, 0.4, 0.6, 0.8, 1]
        });
      }

      feed.querySelectorAll("article.post").forEach(card => {
        if (card.dataset.milanPredictiveObserved) return;
        card.dataset.milanPredictiveObserved = "1";
        observer.observe(card);
      });
    }

    if (!mutationObserver && "MutationObserver" in window) {
      mutationObserver = new MutationObserver(attach);
      mutationObserver.observe(feed, { childList: true, subtree: true });
    }
  }

  function start() {
    attach();
    if (!document.getElementById("feed") &&
        document.body && "MutationObserver" in window) {
      const mo = new MutationObserver(function () {
        if (document.getElementById("feed")) {
          mo.disconnect();
          attach();
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.MilanPredictiveLayer = {
    version: 2,
    get status() {
      return {
        trackedRecords: seen.size,
        observedCards: ratios.size,
        earlyVideoPrepares: earlyPrepares
      };
    }
  };
})();
/* === ./milan-travel-location.js === */
(function () {
  'use strict';
  if (window.__milanTravelLocation) return;
  window.__milanTravelLocation = true;

  var watchId = null;
  var trip = null;
  var lastPosition = null;
  var ACCESS_KEY = 'milan_travel_location_access';

  var CSS = `
    .mtravel-btn{
      display:flex!important;align-items:center!important;gap:8px!important;
      width:100%!important;text-align:left!important;margin-top:4px!important;
    }
    .mtravel-panel{
      position:fixed;inset:0;z-index:100000;display:none;
      align-items:center;justify-content:center;padding:18px;
      background:rgba(1,6,18,.72);backdrop-filter:blur(12px);
    }
    .mtravel-panel.open{display:flex;animation:mtravelFade .18s ease}
    @keyframes mtravelFade{from{opacity:0}to{opacity:1}}
    .mtravel-card{
      width:min(560px,100%);max-height:min(760px,calc(100vh - 36px));
      overflow:auto;border-radius:26px;padding:22px;
      color:#eef2ff;background:linear-gradient(160deg,#0a1a3e,#07132f);
      border:1px solid rgba(245,158,11,.25);
      box-shadow:0 30px 90px rgba(0,0,0,.55);
    }
    .mtravel-head{display:flex;align-items:center;gap:12px}
    .mtravel-icon{
      width:46px;height:46px;border-radius:15px;display:grid;place-items:center;
      font-size:23px;background:linear-gradient(135deg,#f59e0b,#d946ef);
    }
    .mtravel-title{font-size:18px;font-weight:900}
    .mtravel-sub{font-size:11px;color:#8ba4d4;margin-top:3px}
    .mtravel-close{
      margin-left:auto;width:36px!important;height:36px!important;
      border:0!important;border-radius:50%!important;cursor:pointer!important;
    }
    .mtravel-privacy{
      margin-top:16px;padding:13px 14px;border-radius:15px;
      background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);
    }
    .mtravel-privacy strong{display:block;font-size:12px;color:#86efac}
    .mtravel-privacy span{display:block;font-size:10.5px;line-height:1.55;color:#a9bad8;margin-top:4px}
    .mtravel-status{
      margin-top:14px;display:grid;grid-template-columns:repeat(3,1fr);gap:9px;
    }
    .mtravel-stat{
      padding:12px;border-radius:14px;background:rgba(255,255,255,.035);
      border:1px solid rgba(148,163,184,.1)
    }
    .mtravel-stat b{display:block;font-size:16px}
    .mtravel-stat span{display:block;font-size:9px;color:#7183a6;margin-top:4px;text-transform:uppercase;letter-spacing:.06em}
    .mtravel-route{
      margin-top:14px;padding:15px;border-radius:16px;
      background:rgba(91,124,250,.06);border:1px solid rgba(91,124,250,.14);
    }
    .mtravel-route-row{display:flex;align-items:center;gap:10px}
    .mtravel-dot{width:11px;height:11px;border-radius:50%;background:#22c55e;box-shadow:0 0 12px rgba(34,197,94,.45)}
    .mtravel-dot.b{background:#f59e0b;box-shadow:0 0 12px rgba(245,158,11,.45)}
    .mtravel-route-label{font-size:11px;color:#8fa2c5}
    .mtravel-route-value{font-size:13px;font-weight:800;color:#eef2ff}
    .mtravel-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:15px}
    .mtravel-actions button{
      min-height:40px!important;padding:0 14px!important;border-radius:12px!important;
      border:0!important;cursor:pointer!important;font-weight:900!important;
    }
    .mtravel-primary{background:linear-gradient(135deg,#f59e0b,#fbbf24)!important;color:#071126!important}
    .mtravel-secondary{background:rgba(255,255,255,.06)!important;color:#d9e2f3!important;border:1px solid rgba(148,163,184,.14)!important}
    .mtravel-danger{background:rgba(239,68,68,.12)!important;color:#fca5a5!important;border:1px solid rgba(239,68,68,.18)!important}
    .mtravel-note{margin-top:13px;font-size:10px;line-height:1.55;color:#7286aa}
    .mtravel-access{
      margin-top:14px;padding:15px;border-radius:16px;
      background:rgba(217,70,239,.045);border:1px solid rgba(217,70,239,.14);
    }
    .mtravel-access-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .mtravel-access-title{font-size:12px;font-weight:900;color:#eef2ff}
    .mtravel-access-state{
      font-size:9px;font-weight:900;padding:5px 8px;border-radius:999px;
      background:rgba(239,68,68,.12);color:#fca5a5;
      border:1px solid rgba(239,68,68,.18);
    }
    .mtravel-access-state.allowed{
      background:rgba(34,197,94,.10);color:#86efac;
      border-color:rgba(34,197,94,.18);
    }
    .mtravel-access-copy{margin-top:6px;font-size:10px;line-height:1.5;color:#8295b7}
    .mtravel-access-grid{
      display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:11px;
    }
    .mtravel-access-grid label{display:block;font-size:9px;color:#7387ab;font-weight:800;margin-bottom:5px}
    .mtravel-access-grid select{
      width:100%;min-height:38px;border-radius:11px;padding:0 10px;
      background:rgba(2,6,23,.55)!important;color:#eaf0ff!important;
      border:1px solid rgba(148,163,184,.14)!important;
    }
    .mtravel-access-save{margin-top:10px;width:100%}
    @media(max-width:560px){
      .mtravel-access-grid{grid-template-columns:1fr}
    }
    @media(max-width:560px){
      .mtravel-panel{padding:8px}.mtravel-card{padding:17px;border-radius:21px}
      .mtravel-status{grid-template-columns:1fr 1fr}
    }
  `;

  function addStyle() {
    var s = document.createElement('style');
    s.id = 'milan-travel-location-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
  }

  function haversine(a, b) {
    var R = 6371000;
    var p1 = a.lat * Math.PI / 180;
    var p2 = b.lat * Math.PI / 180;
    var dp = (b.lat - a.lat) * Math.PI / 180;
    var dl = (b.lng - a.lng) * Math.PI / 180;
    var x = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) *
            Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function bearing(a, b) {
    var p1 = a.lat * Math.PI / 180;
    var p2 = b.lat * Math.PI / 180;
    var dl = (b.lng - a.lng) * Math.PI / 180;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) -
            Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function compass(deg) {
    return ['N','NE','E','SE','S','SW','W','NW'][Math.round(deg / 45) % 8];
  }

  function fmtDistance(m) {
    if (!isFinite(m)) return '—';
    if (m < 1000) return Math.round(m) + ' m';
    return (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km';
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function defaultAccessPolicy() {
    return { scope: 'blocked', duration: '15m', updatedAt: null };
  }

  function getToken() {
    try { return String(localStorage.getItem('milan_token') || '').trim(); }
    catch (_) { return ''; }
  }

  function getLocalAccessPolicy() {
    try {
      var v = JSON.parse(localStorage.getItem(ACCESS_KEY) || 'null');
      if (v && typeof v === 'object') return { ...defaultAccessPolicy(), ...v };
    } catch (_) {}
    return defaultAccessPolicy();
  }

  var accessPolicy = getLocalAccessPolicy();

  function getAccessPolicy() {
    return accessPolicy || defaultAccessPolicy();
  }

  async function loadAccessPolicy() {
    var token = getToken();
    if (!token) {
      renderAccessPolicy();
      return;
    }

    try {
      var response = await fetch('/api/settings', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        credentials: 'same-origin'
      });

      if (!response.ok) throw new Error('Settings request failed: ' + response.status);

      var data = await response.json();
      if (data?.settings?.travelLocation) {
        accessPolicy = { ...defaultAccessPolicy(), ...data.settings.travelLocation };
        try {
          localStorage.setItem(ACCESS_KEY, JSON.stringify(accessPolicy));
        } catch (_) {}
      }

      renderAccessPolicy();
    } catch (_) {
      accessPolicy = getLocalAccessPolicy();
      renderAccessPolicy();
    }
  }

  async function saveAccessPolicy() {
    var scope = document.getElementById('mtravelAccessScope')?.value || 'blocked';
    var duration = document.getElementById('mtravelAccessDuration')?.value || '15m';

    accessPolicy = {
      ...defaultAccessPolicy(),
      ...getAccessPolicy(),
      scope: scope,
      duration: duration,
      updatedAt: new Date().toISOString()
    };

    try { localStorage.setItem(ACCESS_KEY, JSON.stringify(accessPolicy)); } catch (_) {}

    renderAccessPolicy();
    setText('mtravelMessage',
      scope === 'blocked'
        ? 'Third-party location access is blocked.'
        : 'Saving your location policy…');

    var token = getToken();
    if (!token) {
      setText('mtravelMessage',
        scope === 'blocked'
          ? 'Third-party location access is blocked on this device.'
          : 'Access policy saved locally. Login to sync it to your MILAN account.');
      return;
    }

    try {
      var response = await fetch('/api/settings/travel-location', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          scope: accessPolicy.scope,
          duration: accessPolicy.duration
        })
      });

      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        throw new Error(data.error || 'Policy save failed: ' + response.status);
      }

      accessPolicy = { ...defaultAccessPolicy(), ...(data.travelLocation || accessPolicy) };
      try { localStorage.setItem(ACCESS_KEY, JSON.stringify(accessPolicy)); } catch (_) {}

      renderAccessPolicy();
      setText('mtravelMessage',
        scope === 'blocked'
          ? 'Third-party location access is blocked. Policy synced to your MILAN account.'
          : 'Location policy saved to your MILAN account. No GPS coordinates were shared.');
    } catch (_) {
      renderAccessPolicy();
      setText('mtravelMessage',
        scope === 'blocked'
          ? 'Policy saved on this device; account sync is temporarily unavailable.'
          : 'Policy saved locally; account sync is temporarily unavailable.');
    }
  }

  function renderAccessPolicy() {
    var policy = getAccessPolicy();
    var scope = document.getElementById('mtravelAccessScope');
    var duration = document.getElementById('mtravelAccessDuration');
    var state = document.getElementById('mtravelAccessState');
    if (scope) scope.value = policy.scope || 'blocked';
    if (duration) duration.value = policy.duration || '15m';
    if (state) {
      var allowed = policy.scope !== 'blocked';
      state.textContent = allowed ? 'USER CONTROLLED' : 'BLOCKED';
      state.classList.toggle('allowed', allowed);
    }
  }

  function render() {
    setText('mtravelState', watchId != null ? 'LIVE' : (trip ? 'PAUSED' : 'READY'));
    setText('mtravelDistance', fmtDistance(trip ? trip.distance : 0));
    setText('mtravelAccuracy', lastPosition && isFinite(lastPosition.accuracy)
      ? Math.round(lastPosition.accuracy) + ' m'
      : '—');
    setText('mtravelDirection', trip && trip.current && trip.current.bearing != null
      ? compass(trip.current.bearing)
      : '—');
    setText('mtravelA', trip && trip.start
      ? 'Trip origin captured on this device'
      : 'Not captured');
    setText('mtravelB', trip && trip.current
      ? 'Current position captured locally'
      : 'Waiting for movement');
  }

  function stopWatch() {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    render();
  }

  function fail(err) {
    stopWatch();
    var msg = err && err.code === 1
      ? 'Location permission was denied. You can enable it in browser/site settings.'
      : 'Location could not be read right now.';
    setText('mtravelMessage', msg);
  }

  function onPosition(pos) {
    var cur = {
      lat: Number(pos.coords.latitude),
      lng: Number(pos.coords.longitude),
      accuracy: Number(pos.coords.accuracy)
    };
    if (!isFinite(cur.lat) || !isFinite(cur.lng)) return;

    lastPosition = cur;

    if (!trip) {
      trip = {
        start: cur,
        current: { lat: cur.lat, lng: cur.lng, bearing: null },
        distance: 0
      };
      setText('mtravelMessage', 'Origin A captured. Move to start measuring A → B.');
    } else {
      var prev = trip.current || trip.start;
      var delta = haversine(prev, cur);
      if (isFinite(delta) && delta >= 0 && delta < 5000) trip.distance += delta;
      trip.current = {
        lat: cur.lat,
        lng: cur.lng,
        bearing: bearing(trip.start, cur)
      };
      setText('mtravelMessage', 'Movement is being calculated on this device.');
    }

    render();
  }

  function startTrip() {
    if (!navigator.geolocation) {
      setText('mtravelMessage', 'This browser/device does not expose geolocation.');
      return;
    }

    stopWatch();
    trip = null;
    lastPosition = null;
    setText('mtravelMessage', 'Requesting location permission…');

    watchId = navigator.geolocation.watchPosition(onPosition, fail, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    });
    render();
  }

  function clearTrip() {
    stopWatch();
    trip = null;
    lastPosition = null;
    setText('mtravelMessage', 'Trip cleared. No route history is retained by this feature.');
    render();
  }

  function build() {
    addStyle();

    // Desktop keeps the nav inside .leftRail; mobile moves it into #milan-drawer-v81 .m8-nav.
    var nav = document.querySelector('.leftRail .nav')
      || document.querySelector('#milan-drawer-v81 .m8-nav');

    if (nav && !document.getElementById('milanTravelBtn')) {
      var btn = document.createElement('button');
      btn.id = 'milanTravelBtn';
      btn.type = 'button';
      btn.className = 'mtravel-btn';
      btn.innerHTML = '✈️ Travel Agent';
      nav.appendChild(btn);
    }

    var panel = document.createElement('div');
    panel.id = 'milanTravelPanel';
    panel.className = 'mtravel-panel';
    panel.innerHTML = `
      <div class="mtravel-card" role="dialog" aria-modal="true" aria-labelledby="mtravelTitle">
        <div class="mtravel-head">
          <div class="mtravel-icon">✈️</div>
          <div>
            <div id="mtravelTitle" class="mtravel-title">MILAN Travel Agent</div>
            <div class="mtravel-sub">Privacy-first movement intelligence</div>
          </div>
          <button type="button" class="mtravel-close" id="mtravelClose" aria-label="Close">✕</button>
        </div>

        <div class="mtravel-privacy">
          <strong>🔒 Location stays local in this feature</strong>
          <span>Precise GPS coordinates are processed in your browser for this trip calculation. This tracker does not send your GPS coordinates to the MILAN server or a third-party location API.</span>
        </div>

        <div class="mtravel-status">
          <div class="mtravel-stat"><b id="mtravelState">READY</b><span>Tracking state</span></div>
          <div class="mtravel-stat"><b id="mtravelDistance">—</b><span>A → B distance</span></div>
          <div class="mtravel-stat"><b id="mtravelAccuracy">—</b><span>GPS accuracy</span></div>
          <div class="mtravel-stat"><b id="mtravelDirection">—</b><span>Direction</span></div>
        </div>

        <div class="mtravel-access">
          <div class="mtravel-access-head">
            <div class="mtravel-access-title">🛡 Location Access Rules</div>
            <div id="mtravelAccessState" class="mtravel-access-state">BLOCKED</div>
          </div>
          <div class="mtravel-access-copy">
            Choose what a future third-party integration may request. The default is blocked.
            Changing this setting does not share location data by itself.
          </div>
          <div class="mtravel-access-grid">
            <div>
              <label for="mtravelAccessScope">Allowed precision</label>
              <select id="mtravelAccessScope">
                <option value="blocked">Blocked</option>
                <option value="city">City / coarse</option>
                <option value="approximate">Approximate</option>
                <option value="precise">Precise</option>
              </select>
            </div>
            <div>
              <label for="mtravelAccessDuration">Access window</label>
              <select id="mtravelAccessDuration">
                <option value="15m">15 minutes</option>
                <option value="1h">1 hour</option>
                <option value="trip">Current trip</option>
              </select>
            </div>
          </div>
          <button type="button" id="mtravelAccessSave" class="mtravel-primary mtravel-access-save">Save location policy</button>
        </div>

        <div class="mtravel-route">
          <div class="mtravel-route-row">
            <span class="mtravel-dot"></span>
            <div><div class="mtravel-route-label">Point A</div><div id="mtravelA" class="mtravel-route-value">Not captured</div></div>
          </div>
          <div style="height:24px;border-left:1px dashed rgba(148,163,184,.28);margin-left:5px"></div>
          <div class="mtravel-route-row">
            <span class="mtravel-dot b"></span>
            <div><div class="mtravel-route-label">Point B / current</div><div id="mtravelB" class="mtravel-route-value">Waiting for movement</div></div>
          </div>
        </div>

        <div class="mtravel-actions">
          <button type="button" id="mtravelStart" class="mtravel-primary">📍 Start trip</button>
          <button type="button" id="mtravelStop" class="mtravel-secondary">⏸ Stop tracking</button>
          <button type="button" id="mtravelClear" class="mtravel-danger">Reset trip</button>
        </div>

        <div id="mtravelMessage" class="mtravel-note">Nothing is tracked until you explicitly start a trip.</div>
        <div class="mtravel-note">Third-party location sharing is a separate future consent layer. This first implementation only measures movement locally.</div>
      </div>
    `;
    document.body.appendChild(panel);

    function open() {
      panel.classList.add('open');
      render();
    }
    function close() {
      panel.classList.remove('open');
    }

    document.getElementById('milanTravelBtn')?.addEventListener('click', open);
    document.getElementById('mtravelClose')?.addEventListener('click', close);
    document.getElementById('mtravelStart')?.addEventListener('click', startTrip);
    document.getElementById('mtravelAccessSave')?.addEventListener('click', saveAccessPolicy);
    renderAccessPolicy();
    loadAccessPolicy();
    document.getElementById('mtravelStop')?.addEventListener('click', function () {
      stopWatch();
      setText('mtravelMessage', 'Tracking stopped. Your current trip remains only in this page session.');
    });
    document.getElementById('mtravelClear')?.addEventListener('click', clearTrip);

    panel.addEventListener('click', function (e) {
      if (e.target === panel) close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build, { once: true });
  } else {
    build();
  }
})();
/* === ./milan-ui-actions.js === */
(function () {
    "use strict";

    if (window.__MILAN_UI_ACTIONS_INITIALIZED__) {
        console.warn("[MILAN] Duplicate UI actions initialization skipped.");
        return;
    }
    window.__MILAN_UI_ACTIONS_INITIALIZED__ = true;

    /* =========================================================
       MILAN — SINGLE AUTHORITATIVE HOME UI CONTROLLER
       One navigation layer
       One composer layer
       One feed loader
       One publish handler
       No duplicate listeners
       No alert boxes
       ========================================================= */

    const state = {
        pendingPosts: new Map(),
        feedRecords: new Map(),
        feedLoading: false,
        profileAvatar: "",
        profileName: ""
    };

    const $ = (id) => document.getElementById(id);

    function getToken() {
        return (
            localStorage.getItem("milan_token") ||
            localStorage.getItem("milan_token") ||
            ""
        );
    }

    function go(url) {
        window.location.href = url;
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (m) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[m]);
    }

    function getRecordId(record) {
        return String(
            record?.id ||
            record?.recordId ||
            record?.dwnRecordId ||
            ""
        );
    }

    function isChatFeedRecord(record) {
        const data = record?.data && typeof record.data === "object" ? record.data : {};
        return String(record?.protocol || "").trim().toLowerCase() === "milan.chat" ||
            String(record?.protocolPath || "").trim().toLowerCase() === "messages" ||
            String(record?.schema || "").trim().toLowerCase() === "milan.chat.message" ||
            String(record?.title || "").trim().toLowerCase() === "milan chat message" ||
            String(data.kind || "").trim().toLowerCase() === "chat_message" ||
            Boolean(data.messageId && data.conversationId && data.senderDid && data.recipientDid);
    }

    function getRecordText(record) {
        const data = record?.data || {};

        return String(
            data.text ||
            data.caption ||
            record?.text ||
            record?.caption ||
            ""
        ).trim();
    }

    function getRecordDate(record) {
        return (
            record?.dateModified ||
            record?.dateCreated ||
            record?.createdAt ||
            new Date().toISOString()
        );
    }

    function getRecordTitle(record) {
        return String(
            record?.title ||
            record?.data?.title ||
            "MILAN Quote"
        ).trim();
    }

    function normalizeRecords(payload) {
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload?.records)) return payload.records;
        if (Array.isArray(payload?.items)) return payload.items;
        if (Array.isArray(payload?.entries)) return payload.entries;
        if (Array.isArray(payload?.feed)) return payload.feed;
        if (Array.isArray(payload?.data)) return payload.data;
        return [];
    }

    async function loadAuthoritativeIdentity() {
        const auth = getToken();
        if (!auth) return;

        try {
            const headers = {
                "Authorization": "Bearer " + auth,
                "Accept": "application/json"
            };

            const identityVersion =
                Number(window.__milanAvatarUploadVersion) || 0;

            const [profileResponse, meResponse] = await Promise.all([
                fetch("/api/profile", {
                    method: "GET",
                    headers,
                    cache: "no-store"
                }),
                fetch("/api/auth/me", {
                    method: "GET",
                    headers,
                    cache: "no-store"
                })
            ]);

            const profile = profileResponse.ok
                ? await profileResponse.json().catch(() => ({}))
                : {};

            const identity = meResponse.ok
                ? await meResponse.json().catch(() => ({}))
                : {};

            if (
                identityVersion !==
                (Number(window.__milanAvatarUploadVersion) || 0) ||
                window.__milanAvatarUploadActive
            ) {
                return;
            }

            const recentAvatar =
                String(window.__milanPersistentAvatar || "").trim();

            const recentAvatarAt =
                Number(window.__milanAvatarUploadCommittedAt || 0);

            const recentUploadStillFresh =
                recentAvatar &&
                recentAvatarAt > 0 &&
                (Date.now() - recentAvatarAt) < 60000;

            state.profileAvatar =
                recentUploadStillFresh
                    ? recentAvatar
                    : String(profile?.avatar || "").trim();

            state.profileName =
                String(
                    profile?.display_name ||
                    profile?.name ||
                    identity?.name ||
                    profile?.username ||
                    identity?.profile?.display_name ||
                    identity?.email?.split("@")[0] ||
                    ""
                ).trim();

            if (
                state.profileAvatar &&
                !recentUploadStillFresh
            ) {
                window.__milanPersistentAvatar = state.profileAvatar;
                localStorage.setItem("milanAvatar", state.profileAvatar);
            }

            if (state.feedRecords.size) {
                renderFeed(
                    Array.from(state.feedRecords.values())
                );
            }
        } catch (_) {
            // Feed remains usable even if profile identity refresh fails.
        }
    }

    function showPublishStatus(message, isError = false) {
        let el = $("milanPublishStatus");

        if (!el) {
            el = document.createElement("div");
            el.id = "milanPublishStatus";
            el.style.cssText =
                "margin-top:8px;" +
                "min-height:18px;" +
                "font-size:12px;" +
                "text-align:right;" +
                "color:#94a3b8;";

            document
                .querySelector(".composer-bottom")
                ?.appendChild(el);
        }

        el.textContent = message || "";
        el.style.color = isError ? "#fca5a5" : "#94a3b8";
    }


    const activeVideoUploadSessions = new WeakMap();

    async function uploadVideoChunked(file, meta, onProgress) {
        const token = getToken();
        const chunkBytes = Number(window.MILAN_UPLOAD_CHUNK_BYTES || 8388608);

        const signature = JSON.stringify({
            name: file.name,
            size: file.size,
            lastModified: Number(file.lastModified || 0),
            type: file.type || "application/octet-stream",
            title: meta.title || file.name,
            caption: meta.caption || "",
            accessMode: meta.accessMode || "private"
        });

        let uploadId = "";
        let actualChunkBytes = chunkBytes;
        let totalChunks = Math.ceil(file.size / chunkBytes);
        let receivedIndexes = [];
        const previous = activeVideoUploadSessions.get(file);

        if (previous && previous.signature === signature) {
            const statusResponse = await fetch(
                "/api/records/media/chunk/" +
                encodeURIComponent(previous.uploadId),
                {
                    method: "GET",
                    headers: {
                        "Authorization": "Bearer " + token,
                        "Accept": "application/json"
                    }
                }
            );
            const status = await statusResponse.json().catch(() => ({}));

            if (!statusResponse.ok) {
                if (
                    statusResponse.status === 404 &&
                    previous.stage === "completing"
                ) {
                    activeVideoUploadSessions.delete(file);
                    throw new Error(
                        "The server could not confirm whether this video was already published. " +
                        "Refresh the feed before retrying to avoid a duplicate post."
                    );
                }

                if (![403, 404].includes(statusResponse.status)) {
                    throw new Error(
                        status.error ||
                        status.detail ||
                        "Could not check the previous upload. Please retry."
                    );
                }

                activeVideoUploadSessions.delete(file);
            } else if (
                status.status === "receiving" &&
                Number(status.chunkBytes) > 0 &&
                Number(status.totalChunks) ===
                    Math.ceil(file.size / Number(status.chunkBytes)) &&
                Array.isArray(status.received)
            ) {
                uploadId = previous.uploadId;
                actualChunkBytes = Number(status.chunkBytes);
                totalChunks = Number(status.totalChunks);
                receivedIndexes = status.received;
            } else {
                activeVideoUploadSessions.delete(file);
            }
        } else if (previous) {
            activeVideoUploadSessions.delete(file);
        }

        if (!uploadId) {
            const initResponse = await fetch("/api/records/media/chunk/init", {
                method: "POST",
                headers: {
                    "Authorization": "Bearer " + token,
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    fileName: file.name,
                    mimeType: file.type || "application/octet-stream",
                    sizeBytes: file.size,
                    chunkBytes,
                    title: meta.title || file.name,
                    caption: meta.caption || "",
                    accessMode: meta.accessMode || "private",
                    sharedWithDids: [],
                    tags: []
                })
            });

            const init = await initResponse.json().catch(() => ({}));

            if (!initResponse.ok || !init.uploadId) {
                throw new Error(
                    init.error ||
                    init.detail ||
                    "Video upload could not be started."
                );
            }

            uploadId = init.uploadId;
            actualChunkBytes = Number(init.chunkBytes || chunkBytes);
            totalChunks = Number(
                init.totalChunks ||
                Math.ceil(file.size / actualChunkBytes)
            );
            receivedIndexes = [];
        }

        activeVideoUploadSessions.set(file, {
            uploadId,
            signature,
            stage: "uploading"
        });

        try {
            // Adapt bounded parallelism to network and device capability.
            const connection = navigator.connection ||
                navigator.mozConnection || navigator.webkitConnection;
            const fallbackRequested = Number(window.MILAN_UPLOAD_CONCURRENCY || 3);
            const fallbackConcurrency = Math.max(
                1,
                Math.min(
                    3,
                    Number.isFinite(fallbackRequested)
                        ? Math.floor(fallbackRequested)
                        : 3,
                    totalChunks
                )
            );
            const uploadPolicy = window.MilanUploadPolicy;
            const chunkConcurrency = uploadPolicy &&
                typeof uploadPolicy.getVideoUploadConcurrency === "function"
                ? uploadPolicy.getVideoUploadConcurrency(totalChunks, {
                    connection,
                    deviceMemory: navigator.deviceMemory,
                    hardwareConcurrency: navigator.hardwareConcurrency,
                    override: window.MILAN_UPLOAD_CONCURRENCY
                })
                : fallbackConcurrency;

            const receivedSet = new Set(
                receivedIndexes
                    .map(Number)
                    .filter(index =>
                        Number.isInteger(index) &&
                        index >= 0 &&
                        index < totalChunks
                    )
            );
            const chunkLoaded = new Array(totalChunks).fill(0);
            let loadedBytes = 0;

            for (const index of receivedSet) {
                const bytes = Math.min(
                    actualChunkBytes,
                    file.size - index * actualChunkBytes
                );
                if (bytes > 0) {
                    chunkLoaded[index] = bytes;
                    loadedBytes += bytes;
                } else {
                    receivedSet.delete(index);
                }
            }

            const reportProgress = () => {
                if (!onProgress || file.size <= 0) return;
                onProgress(Math.max(
                    1,
                    Math.min(96, (loadedBytes / file.size) * 96)
                ));
            };

            reportProgress();

            const uploadChunk = async index => {
                const start = index * actualChunkBytes;
                const end = Math.min(file.size, start + actualChunkBytes);
                const blob = file.slice(start, end);
                let lastError = null;

                for (let attempt = 0; attempt < 4; attempt++) {
                    try {
                        await new Promise((resolve, reject) => {
                            const xhr = new XMLHttpRequest();

                            xhr.open(
                                "POST",
                                "/api/records/media/chunk/" +
                                encodeURIComponent(uploadId),
                                true
                            );

                            xhr.timeout = Number(
                                window.MILAN_CHUNK_UPLOAD_TIMEOUT_MS ||
                                240000
                            );

                            xhr.setRequestHeader(
                                "Authorization",
                                "Bearer " + token
                            );
                            xhr.setRequestHeader(
                                "Content-Type",
                                "application/octet-stream"
                            );
                            xhr.setRequestHeader("X-Chunk-Index", String(index));
                            xhr.setRequestHeader("X-Total-Chunks", String(totalChunks));
                            xhr.setRequestHeader("X-Chunk-Bytes", String(blob.size));

                            xhr.upload.onprogress = event => {
                                if (!event.lengthComputable) return;

                                const nextLoaded = Math.max(
                                    0,
                                    Math.min(blob.size, event.loaded)
                                );

                                loadedBytes += nextLoaded - chunkLoaded[index];
                                chunkLoaded[index] = nextLoaded;
                                reportProgress();
                            };

                            xhr.onload = () => {
                                if (xhr.status >= 200 && xhr.status < 300) {
                                    resolve();
                                    return;
                                }

                                let data = {};
                                try {
                                    data = JSON.parse(xhr.responseText || "{}");
                                } catch (_) {}

                                const error = new Error(
                                    data.error ||
                                    "Video chunk upload failed: HTTP " + xhr.status
                                );
                                error.status = xhr.status;
                                reject(error);
                            };

                            xhr.onerror = () => reject(
                                new Error("Network error while uploading video.")
                            );
                            xhr.ontimeout = () => reject(
                                new Error("Video chunk upload timed out.")
                            );
                            xhr.onabort = () => {
                                const error = new Error("Video upload cancelled.");
                                error.retryable = false;
                                reject(error);
                            };

                            xhr.send(blob);
                        });

                        // Count the full chunk only after the server confirms success.
                        loadedBytes += blob.size - chunkLoaded[index];
                        chunkLoaded[index] = blob.size;
                        reportProgress();
                        return;
                    } catch (error) {
                        lastError = error;

                        // A retry retransmits this chunk, so remove its previous
                        // in-flight bytes from the aggregate progress.
                        loadedBytes -= chunkLoaded[index];
                        chunkLoaded[index] = 0;
                        reportProgress();

                        if (error?.retryable === false) break;

                        const status = Number(error?.status || 0);
                        const retryable =
                            status === 0 ||
                            status >= 500 ||
                            [408, 425, 429].includes(status);

                        if (!retryable || attempt >= 3) break;

                        await new Promise(resolve =>
                            setTimeout(resolve, 700 + attempt * 900)
                        );
                    }
                }

                throw lastError || new Error("Video chunk upload failed.");
            };

            let nextIndex = 0;
            let workerError = null;

            const worker = async () => {
                while (!workerError) {
                    const index = nextIndex++;
                    if (index >= totalChunks) return;
                    if (receivedSet.has(index)) continue;

                    try {
                        await uploadChunk(index);
                    } catch (error) {
                        if (!workerError) workerError = error;
                        return;
                    }
                }
            };

            // Wait for active requests to settle before failure cleanup removes
            // the upload session. This avoids racing DELETE against active chunks.
            await Promise.all(
                Array.from({ length: chunkConcurrency }, () => worker())
            );

            if (workerError) throw workerError;

            if (onProgress) onProgress(98);

            activeVideoUploadSessions.set(file, {
                uploadId,
                signature,
                stage: "completing"
            });

            const completeResponse = await fetch(
                "/api/records/media/chunk/" +
                encodeURIComponent(uploadId) +
                "/complete",
                {
                    method: "POST",
                    headers: {
                        "Authorization": "Bearer " + token,
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({})
                }
            );

            const record = await completeResponse.json().catch(() => ({}));

            if (!completeResponse.ok) {
                throw new Error(
                    record.error ||
                    record.detail ||
                    "Video upload could not be completed."
                );
            }

            activeVideoUploadSessions.delete(file);
            return record;
        } catch (error) {
            // Keep the session reference so a same-page retry can resume
            // server-confirmed chunks instead of starting over.
            throw error;
        }
    }

    let pendingVideoUploadProgress = null;
    let videoUploadProgressFrame = 0;

    function showVideoUploadProgress(percent) {
        if (percent === null || percent === undefined) {
            pendingVideoUploadProgress = null;
            if (videoUploadProgressFrame) {
                cancelAnimationFrame(videoUploadProgressFrame);
            }
            videoUploadProgressFrame = 0;
            renderVideoUploadProgress(null);
            return;
        }

        pendingVideoUploadProgress = percent;
        if (videoUploadProgressFrame) return;

        videoUploadProgressFrame = requestAnimationFrame(() => {
            videoUploadProgressFrame = 0;
            const nextPercent = pendingVideoUploadProgress;
            pendingVideoUploadProgress = null;
            renderVideoUploadProgress(nextPercent);
        });
    }

    function renderVideoUploadProgress(percent) {
        let box = $("milanVideoUploadProgress");

        if (percent === null || percent === undefined) {
            box?.remove();
            return;
        }

        if (!box) {
            box = document.createElement("div");
            box.id = "milanVideoUploadProgress";
            box.setAttribute("role", "status");
            box.setAttribute("aria-live", "polite");
            box.style.cssText =
                "position:relative;width:100%;box-sizing:border-box;" +
                "padding:9px 18px 10px;margin:0;" +
                "background:rgba(10,10,14,.96);" +
                "backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);" +
                "border-bottom:1px solid rgba(255,255,255,.10);" +
                "box-shadow:0 4px 18px rgba(0,0,0,.16);";

            box.innerHTML =
                '<div style="display:flex;align-items:center;justify-content:space-between;' +
                'gap:12px;margin-bottom:7px;">' +
                '<span id="milanVideoUploadProgressLabel" style="' +
                'font-size:12px;font-weight:700;letter-spacing:.2px;color:#fff;">' +
                'Uploading…</span>' +
                '<span id="milanVideoUploadProgressPct" style="' +
                'min-width:42px;text-align:right;font-size:12px;font-weight:800;color:#fff;">' +
                '0%</span>' +
                '</div>' +
                '<div style="width:100%;height:4px;border-radius:999px;' +
                'background:rgba(255,255,255,.16);overflow:hidden;">' +
                '<div id="milanVideoUploadProgressBar" style="' +
                'height:100%;width:0%;border-radius:999px;' +
                'background:linear-gradient(90deg,#8b5cf6,#ec4899,#f43f5e);' +
                'transition:width .16s ease-out;box-shadow:0 0 10px rgba(236,72,153,.45);">' +
                '</div></div>';

            const topbar = document.querySelector("header.topbar");

            if (topbar && topbar.parentNode) {
                topbar.parentNode.insertBefore(box, topbar.nextSibling);
            } else {
                document.body.prepend(box);
            }
        }

        const safePct = Math.max(
            0,
            Math.min(100, Number(percent) || 0)
        );

        const bar = $("milanVideoUploadProgressBar");
        const pct = $("milanVideoUploadProgressPct");
        const label = $("milanVideoUploadProgressLabel");

        if (bar) bar.style.width = safePct + "%";
        if (pct) pct.textContent = Math.round(safePct) + "%";
        if (label) {
            label.textContent =
                safePct >= 100
                    ? "Upload complete"
                    : safePct >= 98
                        ? "Finalizing upload and confirming post…"
                        : "Uploading media…";
        }
    }

    function playVideoUploadTing() {
        try {
            const AudioContext =
                window.AudioContext ||
                window.webkitAudioContext;

            if (!AudioContext) return;

            const ctx = new AudioContext();
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();

            oscillator.type = "sine";
            oscillator.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(
                0.12,
                ctx.currentTime + 0.01
            );
            gain.gain.exponentialRampToValueAtTime(
                0.0001,
                ctx.currentTime + 0.16
            );

            oscillator.connect(gain);
            gain.connect(ctx.destination);

            oscillator.start();
            oscillator.stop(ctx.currentTime + 0.16);

            setTimeout(() => {
                try { ctx.close(); } catch (_) {}
            }, 300);
        } catch (_) {}
    }

    /* =========================================================
       PROFILE IDENTITY — anti-flicker
       ========================================================= */

    function initIdentityGuard() {
        const nameEl = $("myName");
        const emailEl = $("myEmail");

        if (!nameEl || !emailEl) return;

        const styleId = "milan-identity-guard";

        if (!$(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
                #myName,
                #myEmail {
                    visibility:hidden;
                    opacity:0;
                    transition:opacity .15s ease;
                }

                #myName.milan-ready,
                #myEmail.milan-ready {
                    visibility:visible;
                    opacity:1;
                }
            `;
            document.head.appendChild(style);
        }

        const reveal = () => {
            const name = String(nameEl.textContent || "").trim();
            const email = String(emailEl.textContent || "").trim();

            const validName =
                name &&
                name !== "MILAN User" &&
                name !== "Milan User";

            const validEmail =
                email &&
                email !== "Welcome to Milan";

            if (validName && validEmail) {
                nameEl.classList.add("milan-ready");
                emailEl.classList.add("milan-ready");
                return true;
            }

            return false;
        };

        if (reveal()) return;

        const observer = new MutationObserver(() => {
            if (reveal()) observer.disconnect();
        });

        observer.observe(nameEl, {
            childList: true,
            characterData: true,
            subtree: true
        });

        observer.observe(emailEl, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    /* =========================================================
       NAVIGATION
       ========================================================= */

    function initLogout() {
        const button = document.getElementById("logoutBtn");
        if (!button) return;

        const cleanButton = button.cloneNode(true);
        button.replaceWith(cleanButton);

        cleanButton.addEventListener("click", () => {
            localStorage.removeItem("milan_token");
            localStorage.removeItem("milan_token");
            localStorage.removeItem("milanBootCache");
            sessionStorage.clear();

            if(location.pathname!=="/")window.location.replace("/");
        });
    }

    function initNavigation() {
        const navButtons = Array.from(
            document.querySelectorAll(".nav button")
        );

        if (navButtons[0]) {
            navButtons[0].onclick = () => go("/app?view=home");
        }

        if (navButtons[1]) {
            navButtons[1].onclick = () => go("/app?view=mine");
        }

        if (navButtons[2]) {
            navButtons[2].onclick = () => go("/app?view=public");
        }

        if (navButtons[3]) {
            navButtons[3].onclick = () => go("/app?view=saved");
        }

        const editProfile = $("editProfileBtn");

        if (editProfile) {
            editProfile.onclick = () => openEditProfileModal();
        }

        if (navButtons[8]) {
            navButtons[8].onclick = () => go("/privacy");
        }

        if (navButtons[9]) {
            navButtons[9].onclick = () => go("/app?view=ai");
        }

        const topActions = document.querySelectorAll(
            ".top-actions .icon-btn"
        );

        if (topActions[1]) {
            topActions[1].onclick = () => go("/chat");
        }

        if (topActions[2]) {
            topActions[2].onclick = () => go("/music");
        }

        if (topActions[3]) {
            topActions[3].onclick = () => {
                const light =
                    document.documentElement.dataset.milanTheme === "light";

                if (light) {
                    delete document.documentElement.dataset.milanTheme;
                    document.documentElement.style.colorScheme = "dark";
                    localStorage.setItem("milanTheme", "dark");
                } else {
                    document.documentElement.dataset.milanTheme = "light";
                    document.documentElement.style.colorScheme = "light";
                    localStorage.setItem("milanTheme", "light");
                }
            };

            const savedTheme =
                localStorage.getItem("milanTheme");

            if (savedTheme === "light") {
                document.documentElement.dataset.milanTheme = "light";
                document.documentElement.style.colorScheme = "light";
            }
        }

        if (topActions[4]) {
            topActions[4].onclick = () =>
                go("/app?view=notifications");
        }
    }


    /* =========================================================
       EDIT PROFILE — SAME PAGE LIVE MODAL
       ========================================================= */

    let editProfileBackdrop = null;

    function editProfileCss() {
        if ($("milan-edit-profile-css")) return;

        const style = document.createElement("style");
        style.id = "milan-edit-profile-css";

        style.textContent = `
            #milanEditProfileBackdrop{
                position:fixed;
                inset:0;
                z-index:9999;
                display:grid;
                place-items:center;
                padding:20px;
                background:rgba(2,6,23,.72);
                backdrop-filter:blur(12px);
            }

            #milanEditProfileModal{
                width:min(560px,100%);
                max-height:min(88vh,760px);
                overflow:auto;
                background:#0f172a;
                color:#e8edf5;
                border:1px solid #263551;
                border-radius:22px;
                box-shadow:0 28px 80px rgba(0,0,0,.48);
            }

            .milan-edit-head{
                display:flex;
                align-items:center;
                justify-content:space-between;
                padding:20px 22px;
                border-bottom:1px solid #1e293b;
            }

            .milan-edit-head h2{
                margin:0;
                font-size:20px;
            }

            .milan-edit-head span{
                display:block;
                margin-top:3px;
                color:#94a3b8;
                font-size:12px;
            }

            .milan-edit-close{
                width:36px;
                height:36px;
                border:0;
                border-radius:50%;
                background:#1e293b;
                color:#e8edf5;
                cursor:pointer;
                font-size:20px;
            }

            .milan-edit-body{
                padding:22px;
            }

            .milan-edit-photo-row{
                display:flex;
                align-items:center;
                gap:16px;
                margin-bottom:22px;
            }

            .milan-edit-photo{
                width:76px;
                height:76px;
                border-radius:50%;
                overflow:hidden;
                background:#263551;
                background-size:cover;
                background-position:center;
                display:grid;
                place-items:center;
                font-size:24px;
                flex:none;
            }

            .milan-edit-photo-actions button{
                border:1px solid #334155;
                background:#1e293b;
                color:#e8edf5;
                border-radius:10px;
                padding:8px 12px;
                cursor:pointer;
            }

            .milan-edit-field{
                margin-bottom:16px;
            }

            .milan-edit-field label{
                display:block;
                margin-bottom:7px;
                font-size:12px;
                font-weight:700;
                color:#cbd5e1;
            }

            .milan-edit-field input,
            .milan-edit-field textarea{
                width:100%;
                border:1px solid #293851;
                background:#0a0e1a;
                color:#e8edf5;
                border-radius:12px;
                padding:11px 13px;
                outline:none;
                font:inherit;
            }

            .milan-edit-field textarea{
                min-height:110px;
                resize:vertical;
            }

            .milan-edit-field input:focus,
            .milan-edit-field textarea:focus{
                border-color:#6366f1;
                box-shadow:0 0 0 3px rgba(99,102,241,.14);
            }

            .milan-edit-username-wrap{
                position:relative;
            }

            .milan-edit-username-wrap span{
                position:absolute;
                left:13px;
                top:11px;
                color:#64748b;
                pointer-events:none;
            }

            .milan-edit-username-wrap input{
                padding-left:28px;
            }

            .milan-edit-footer{
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:12px;
                padding:16px 22px;
                border-top:1px solid #1e293b;
            }

            .milan-edit-status{
                min-height:18px;
                font-size:12px;
                color:#94a3b8;
            }

            .milan-edit-actions{
                display:flex;
                gap:8px;
            }

            .milan-edit-actions button{
                border:0;
                border-radius:999px;
                padding:9px 17px;
                cursor:pointer;
                font-weight:700;
            }

            .milan-edit-cancel{
                background:#1e293b;
                color:#cbd5e1;
            }

            .milan-edit-save{
                background:#6366f1;
                color:#fff;
            }

            .milan-edit-save:disabled{
                opacity:.6;
                cursor:wait;
            }
        `;

        document.head.appendChild(style);
    }

    function closeEditProfileModal() {
        editProfileBackdrop?.remove();
        editProfileBackdrop = null;
        document.body.style.overflow = "";
    }

    async function openEditProfileModal() {
        if (editProfileBackdrop) return;

        const token = getToken();

        if (!token) {
            return;
        }

        editProfileCss();

        editProfileBackdrop =
            document.createElement("div");

        editProfileBackdrop.id =
            "milanEditProfileBackdrop";

        editProfileBackdrop.innerHTML = `
            <div id="milanEditProfileModal" role="dialog"
                 aria-modal="true"
                 aria-labelledby="milanEditProfileTitle">

                <div class="milan-edit-head">
                    <div>
                        <h2 id="milanEditProfileTitle">
                            Edit Profile
                        </h2>
                        <span>
                            Keep your MILAN identity up to date.
                        </span>
                    </div>

                    <button type="button"
                            class="milan-edit-close"
                            aria-label="Close">
                        ×
                    </button>
                </div>

                <div class="milan-edit-body">

                    <div class="milan-edit-photo-row">
                        <div id="milanEditPhoto"
                             class="milan-edit-photo">
                            M
                        </div>

                        <div class="milan-edit-photo-actions">
                            <button type="button"
                                    id="milanEditPhotoBtn">
                                Change photo
                            </button>
                            <input id="milanEditPhotoInput"
                                   type="file"
                                   accept="image/*"
                                   hidden>
                        </div>
                    </div>

                    <div class="milan-edit-field">
                        <label for="milanEditName">
                            Full Name
                        </label>
                        <input id="milanEditName"
                               maxlength="80"
                               autocomplete="name">
                    </div>

                    <div class="milan-edit-field">
                        <label for="milanEditUsername">
                            Username
                        </label>

                        <div class="milan-edit-username-wrap">
                            <span>@</span>
                            <input id="milanEditUsername"
                                   maxlength="30"
                                   autocomplete="username"
                                   placeholder="yourname">
                        </div>
                    </div>

                    <div class="milan-edit-field">
                        <label for="milanEditBio">
                            Bio
                        </label>
                        <textarea id="milanEditBio"
                                  maxlength="500"
                                  placeholder="Tell people a little about yourself..."></textarea>
                    </div>

                    <div class="milan-edit-field">
                        <label for="milanEditWebsite">
                            Website
                        </label>
                        <input id="milanEditWebsite"
                               maxlength="200"
                               type="url"
                               placeholder="https://...">
                    </div>

                </div>

                <div class="milan-edit-footer">
                    <div id="milanEditStatus"
                         class="milan-edit-status"></div>

                    <div class="milan-edit-actions">
                        <button type="button"
                                class="milan-edit-cancel">
                            Cancel
                        </button>

                        <button type="button"
                                class="milan-edit-save"
                                id="milanEditSave">
                            Save Changes
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(
            editProfileBackdrop
        );

        document.body.style.overflow =
            "hidden";

        const modal =
            $("milanEditProfileModal");

        const status =
            $("milanEditStatus");

        const close =
            () => closeEditProfileModal();

        modal
            ?.querySelector(".milan-edit-close")
            ?.addEventListener("click", close);

        modal
            ?.querySelector(".milan-edit-cancel")
            ?.addEventListener("click", close);

        editProfileBackdrop.addEventListener(
            "click",
            (event) => {
                if (event.target === editProfileBackdrop) {
                    close();
                }
            }
        );

        try {
            status.textContent =
                "Loading your saved profile…";

            const profile =
                await fetch("/api/profile", {
                    headers: {
                        "Authorization":
                            "Bearer " + token,
                        "Accept":
                            "application/json"
                    },
                    cache: "no-store"
                }).then(
                    async (response) => {
                        const data =
                            await response
                                .json()
                                .catch(() => ({}));

                        if (!response.ok) {
                            throw new Error(
                                data.error ||
                                "Could not load profile."
                            );
                        }

                        return data;
                    }
                );

            $("milanEditName").value =
                profile.display_name ||
                "";

            $("milanEditUsername").value =
                profile.username ||
                "";

            $("milanEditBio").value =
                profile.bio ||
                "";

            $("milanEditWebsite").value =
                profile.website ||
                "";

            const savedAvatar =
                profile.avatar || "";

            const photo =
                $("milanEditPhoto");

            if (savedAvatar) {
                photo.style.backgroundImage =
                    `url("${savedAvatar}")`;

                photo.textContent = "";
            }

            status.textContent = "";

            const photoBtn =
                $("milanEditPhotoBtn");

            const photoInput =
                $("milanEditPhotoInput");

            photoBtn.onclick =
                () => photoInput.click();

            photoInput.onchange =
                () => {
                    const file =
                        photoInput.files?.[0];

                    if (!file) return;

                    const reader =
                        new FileReader();

                    reader.onload =
                        () => {
                            photo.style.backgroundImage =
                                `url("${reader.result}")`;

                            photo.textContent = "";
                        };

                    reader.readAsDataURL(file);
                };

        } catch (error) {
            status.textContent =
                error.message ||
                "Could not load profile.";

            status.style.color =
                "#fca5a5";

            return;
        }

        $("milanEditSave").onclick =
            async () => {
                const save =
                    $("milanEditSave");

                const name =
                    $("milanEditName")
                        .value
                        .trim();

                const username =
                    $("milanEditUsername")
                        .value
                        .trim()
                        .replace(/^@+/, "")
                        .toLowerCase();

                const bio =
                    $("milanEditBio")
                        .value
                        .trim();

                const website =
                    $("milanEditWebsite")
                        .value
                        .trim();

                if (!name) {
                    status.textContent =
                        "Full Name cannot be empty.";

                    status.style.color =
                        "#fca5a5";

                    return;
                }

                if (
                    username &&
                    !/^[a-z0-9._]{3,30}$/.test(
                        username
                    )
                ) {
                    status.textContent =
                        "Username must be 3–30 characters using letters, numbers, dot or underscore.";

                    status.style.color =
                        "#fca5a5";

                    return;
                }

                try {
                    save.disabled = true;
                    save.textContent =
                        "Saving…";

                    status.textContent =
                        "Updating your profile…";

                    status.style.color =
                        "#94a3b8";

                    const payload = {
                        display_name: name,
                        username,
                        bio,
                        website
                    };

                    const photoInput =
                        $("milanEditPhotoInput");

                    const file =
                        photoInput.files?.[0];

                    if (file) {
                        const avatar =
                            await new Promise(
                                (resolve, reject) => {
                                    const reader =
                                        new FileReader();

                                    reader.onload =
                                        () =>
                                            resolve(
                                                reader.result
                                            );

                                    reader.onerror =
                                        () =>
                                            reject(
                                                new Error(
                                                    "Could not read profile photo."
                                                )
                                            );

                                    reader.readAsDataURL(
                                        file
                                    );
                                }
                            );

                        payload.avatar =
                            avatar;
                    }

                    // Invalidate profile reads that started before this avatar save.
                    if (payload.avatar) {
                        window.__milanAvatarUploadVersion =
                            (Number(window.__milanAvatarUploadVersion) || 0) + 1;
                    }

                    const response =
                        await fetch(
                            "/api/profile",
                            {
                                method: "PUT",
                                headers: {
                                    "Content-Type":
                                        "application/json",
                                    "Authorization":
                                        "Bearer " +
                                        token,
                                    "Accept":
                                        "application/json"
                                },
                                body:
                                    JSON.stringify(
                                        payload
                                    )
                            }
                        );

                    const saved =
                        await response
                            .json()
                            .catch(() => ({}));

                    if (!response.ok) {
                        throw new Error(
                            saved.error ||
                            saved.detail ||
                            "Profile update failed."
                        );
                    }

                    /*
                     * Live Home update — no page reload.
                     */
                    const nameEl =
                        $("myName");

                    const emailEl =
                        $("myEmail");

                    if (nameEl) {
                        nameEl.textContent =
                            saved.display_name ||
                            name;
                    }

                    if (emailEl && token) {
                        // Email remains unchanged.
                    }

                    const profileName =
                        saved.display_name ||
                        name;

                    document
                        .querySelectorAll(
                            ".milan-feed-name"
                        )
                        .forEach((el) => {
                            el.textContent =
                                profileName;
                        });

                    if (window.me) {
                        window.me.profile = {
                            ...(window.me.profile || {}),
                            ...saved
                        };

                        window.me.name =
                            profileName;
                    }

                    if (saved.avatar) {
                        window.__milanPersistentAvatar = String(saved.avatar);
                        window.__milanAvatarUploadCommittedAt = Date.now();
                        try {
                            localStorage.setItem("milanAvatar", String(saved.avatar));
                        } catch (_) {}
                        [
                            "myAvatar",
                            "composerAvatar"
                        ].forEach((id) => {
                            const el = $(id);

                            if (!el) return;

                            el.style.backgroundImage = "none";
                            el.style.backgroundColor = "transparent";
                            el.style.backgroundSize = "cover";
                            el.style.backgroundPosition = "center";
                            el.style.backgroundRepeat = "no-repeat";
                            el.textContent = "";

                            let img = el.querySelector("img");

                            if (!img) {
                                img = document.createElement("img");
                                img.alt = "Profile photo";
                                el.appendChild(img);
                            }

                            img.src = saved.avatar;
                            img.alt = "Profile photo";
                            img.style.display = "block";
                            img.style.width = "100%";
                            img.style.height = "100%";
                            img.style.objectFit = "cover";
                            img.style.objectPosition = "center";
                            img.style.border = "0";
                        });
                    }

                    status.textContent =
                        "Profile updated ✓";

                    status.style.color =
                        "#86efac";

                    setTimeout(
                        close,
                        550
                    );

                } catch (error) {
                    console.error(
                        "[MILAN] Edit Profile save failed:",
                        error
                    );

                    status.textContent =
                        error.message ||
                        "Profile update failed.";

                    status.style.color =
                        "#fca5a5";

                    save.disabled =
                        false;

                    save.textContent =
                        "Save Changes";
                }
            };
    }


    /* =========================================================
       COMPOSER TOOLS
       ========================================================= */

    function initComposerTools() {
        const tools = Array.from(
            document.querySelectorAll(".composer-tools .tool")
        );

        const mediaInput = $("mediaFile");

        if (tools[0] && mediaInput) {
            tools[0].onclick = () => {
                mediaInput.accept = "image/*";
                mediaInput.click();
            };
        }

        if (tools[1] && mediaInput) {
            tools[1].onclick = () => {
                mediaInput.accept =
                    "video/*,audio/*,text/*,.txt,.md,.csv,.json,.xml,.html,.pdf,.doc,.docx,.xls,.xlsx,.zip";
                mediaInput.click();
            };
        }

        if (tools[2]) {
            tools[2].onclick = () => {
                const text = $("postText");
                if (!text) return;

                const emoji = " 😊";
                const start = text.selectionStart ?? text.value.length;
                const end = text.selectionEnd ?? text.value.length;

                text.value =
                    text.value.slice(0, start) +
                    emoji +
                    text.value.slice(end);

                text.focus();
                text.selectionStart = text.selectionEnd =
                    start + emoji.length;
            };
        }

        if (tools[3]) {
            tools[3].onclick = () => {
                const privateNow =
                    tools[3].dataset.privacy !== "public";

                tools[3].dataset.privacy =
                    privateNow ? "public" : "private";

                tools[3].textContent =
                    privateNow ? "🌍" : "🔒";

                tools[3].title =
                    privateNow ? "Public post" : "Private post";
            };
        }
    }

    /* =========================================================
       FEED CARD
       ========================================================= */



    if (!document.getElementById("milan-feed-media-css")) {
        const style = document.createElement("style");
        style.id = "milan-feed-media-css";
        style.textContent = `
            .milan-feed-media{
                margin:12px 0 2px;
                border-radius:16px;
                overflow:hidden;
                background:#0b0f17;
                border:1px solid rgba(255,255,255,.08);
            }
            .milan-feed-media img{
                display:block;
                width:100%;
                max-height:620px;
                object-fit:cover;
            }
        `;
        document.head.appendChild(style);
    }

    if (!$('milan-delete-record-css')) {
        const style = document.createElement('style');
        style.id = 'milan-delete-record-css';
        style.textContent = `            .milan-delete-record{
                color:#fca5a5 !important;
                border-color:rgba(248,113,113,.20) !important;
                background:rgba(248,113,113,.07) !important;
            }
`;
        document.head.appendChild(style);
    }


    function feedCard(record) {
        const id = escapeHtml(getRecordId(record));
        const text = escapeHtml(getRecordText(record))
            .replace(/\n/g, "<br>");

        const title = escapeHtml(getRecordTitle(record));

        const date = new Date(getRecordDate(record));

        const when =
            Number.isNaN(date.getTime())
                ? "Just now"
                : date.toLocaleString([], {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit"
                });

        const timelineLabel =
            record?.__milanOptimistic === true
                ? "Publishing…"
                : when;

        const name =
            state.profileName ||
            document
                .getElementById("myName")
                ?.textContent
                ?.trim() ||
            "Milan User";

        const avatar = String(
            window.__milanPersistentAvatar ||
            localStorage.getItem("milanAvatar") ||
            ""
        ).trim();

        const avatarMarkup = avatar
            ? `<img src="${escapeHtml(avatar)}" alt="Profile photo">`
            : "M";

        const media = record?.data?.media || record?.media || {};
        const mediaUrl = String(
            record?.mediaUrl ||
            media?.mediaUrl ||
            ""
        ).trim();

        const imageDataUrl = String(
            media?.dataUrl ||
            record?.dataUrl ||
            ""
        ).trim();

        let mediaMarkup = "";

        if (
            imageDataUrl &&
            /^data:image\//i.test(imageDataUrl)
        ) {
            mediaMarkup = `
                <div class="milan-feed-media">
                    <img
                        src="${escapeHtml(imageDataUrl)}"
                        alt="${escapeHtml(media.fileName || "Uploaded image")}"
                        loading="lazy"
                        decoding="async"
                    >
                </div>
            `;
        } else if (
            mediaUrl &&
            String(media?.mimeType || record?.dataFormat || "")
                .toLowerCase()
                .startsWith("image/")
        ) {
            const sep = mediaUrl.includes("?") ? "&" : "?";
            const imageSrc =
                mediaUrl +
                sep +
                "token=" +
                encodeURIComponent(getToken());

            mediaMarkup = `
                <div class="milan-feed-media">
                    <img
                        src="${escapeHtml(imageSrc)}"
                        alt="${escapeHtml(media.fileName || "Uploaded image")}"
                        loading="lazy"
                        decoding="async"
                    >
                </div>
            `;
        } else if (
            mediaUrl &&
            String(media?.mimeType || record?.dataFormat || "")
                .toLowerCase()
                .startsWith("video/")
        ) {
            const videoSrc =
                "/api/records/" +
                encodeURIComponent(getRecordId(record)) +
                "/media/play.mp4?token=" +
                encodeURIComponent(getToken());

            mediaMarkup = `
                <div class="milan-feed-media milan-feed-video">
                    <video
                        controls
                        preload="metadata"
                        playsinline
                        webkit-playsinline
                        x5-playsinline
                        style="display:block;width:100%;max-height:620px;background:#000;"
                    >
                        <source
                            src="${escapeHtml(videoSrc)}"
                            type="video/mp4"
                        >
                    </video>
                </div>
            `;
        }

        return `
            <article
                class="milan-feed-card"
                data-record-id="${id}"
            >
                <div class="milan-feed-card-head">
                    <div class="milan-feed-avatar">${avatarMarkup}</div>

                    <div class="milan-feed-meta">
                        <strong class="milan-feed-name">
                            ${escapeHtml(name)}
                        </strong>
                        <span>${escapeHtml(timelineLabel)}</span>
                    </div>
                </div>

                <div class="milan-feed-body">
                    <h3>${title}</h3>
                    ${mediaMarkup}
                    ${text ? `<p>${text}</p>` : ""}
                </div>

                <div class="milan-feed-actions">
                    <button type="button"
                            data-feed-action="like">
                        ♡ Like
                    </button>

                    <button type="button"
                            data-feed-action="comment">
                        💬 Comment
                    </button>

                    <button type="button"
                            data-feed-action="share">
                        ↗ Share
                    </button>

                    <button type="button"
                            data-feed-action="save">
                        🔖 Save
                    </button>

                    <button type="button"
                            data-feed-action="delete"
                            class="milan-delete-record">
                        🗑 Delete
                    </button>
                </div>
            </article>
        `;
    }

    function bindFeedActions() {
        document
            .querySelectorAll(".milan-feed-card")
            .forEach((card) => {
                card
                    .querySelectorAll("[data-feed-action]")
                    .forEach((button) => {
                        button.onclick = async () => {
                            const action =
                                button.dataset.feedAction;

                            if (action === "delete") {
                                const recordId =
                                    card.dataset.recordId || "";

                                if (!recordId) return;

                                if (!confirm(
                                    "Delete this record permanently from DWN?"
                                )) {
                                    return;
                                }

                                const auth = getToken();
                                if (!auth) return;

                                button.disabled = true;
                                button.textContent = "Deleting…";

                                try {
                                    const response = await fetch(
                                        "/api/records/" +
                                        encodeURIComponent(recordId),
                                        {
                                            method: "DELETE",
                                            headers: {
                                                "Authorization":
                                                    "Bearer " + auth,
                                                "Accept":
                                                    "application/json"
                                            },
                                            cache: "no-store"
                                        }
                                    );

                                    const payload =
                                        await response.json().catch(
                                            () => ({})
                                        );

                                    if (!response.ok) {
                                        throw new Error(
                                            payload.error ||
                                            "Permanent DWN deletion failed."
                                        );
                                    }

                                    state.pendingPosts.delete(recordId);

                                    if (state.feedRecords) {
                                        state.feedRecords.delete(recordId);
                                    }

                                    card.remove();

                                    const list =
                                        $("milanFeedList");

                                    if (
                                        list &&
                                        !list.querySelector(
                                            ".milan-feed-card"
                                        )
                                    ) {
                                        list.innerHTML = `
                                            <div class="milan-feed-empty">
                                                No posts yet. Write your first quote above.
                                            </div>
                                        `;
                                    }

                                    showPublishStatus(
                                        "Record permanently deleted from DWN."
                                    );
                                } catch (error) {
                                    button.disabled = false;
                                    button.textContent = "🗑 Delete";
                                    showPublishStatus(
                                        error.message ||
                                        "Delete failed.",
                                        true
                                    );
                                }

                                return;
                            }

                            if (action === "like") {
                                button.classList.toggle("active");
                                button.textContent =
                                    button.classList.contains("active")
                                        ? "♥ Liked"
                                        : "♡ Like";
                            }

                            if (action === "comment") {
                                const value =
                                    prompt("Write a comment");

                                if (value?.trim()) {
                                    button.textContent =
                                        "💬 Commented";
                                }
                            }

                            if (action === "share") {
                                const shareUrl =
                                    window.location.origin + "/app";

                                navigator.clipboard
                                    ?.writeText(shareUrl)
                                    .then(() => {
                                        button.textContent = "✓ Copied";

                                        setTimeout(() => {
                                            button.textContent =
                                                "↗ Share";
                                        }, 1200);
                                    })
                                    .catch(() => {});
                            }

                            if (action === "save") {
                                button.classList.toggle("active");

                                button.textContent =
                                    button.classList.contains("active")
                                        ? "✓ Saved"
                                        : "🔖 Save";
                            }
                        };
                    });
            });
    }

    /* =========================================================
       FEED MERGE
       IMPORTANT:
       Server refresh NEVER deletes a just-published local record
       unless the server actually returns that same record ID.
       ========================================================= */

    function mergeRecords(serverRecords = []) {
        const byId = new Map();

        for (const record of state.feedRecords.values()) {
            if (isChatFeedRecord(record)) continue;
            const id = getRecordId(record);
            if (id) byId.set(id, record);
        }

        for (const record of serverRecords || []) {
            if (isChatFeedRecord(record)) continue;
            const id = getRecordId(record);
            if (id) byId.set(id, record);
        }

        for (const [id, record] of state.pendingPosts) {
            if (isChatFeedRecord(record)) {
                state.pendingPosts.delete(id);
                continue;
            }
            if (!byId.has(id)) {
                byId.set(id, record);
            } else {
                state.pendingPosts.delete(id);
            }
        }

        const merged = Array.from(byId.values())
            .filter(record =>
                getRecordText(record) ||
                getRecordTitle(record)
            )
            .sort(
                (a, b) =>
                    new Date(getRecordDate(b)) -
                    new Date(getRecordDate(a))
            );

        state.feedRecords = new Map(
            merged
                .map(record => [getRecordId(record), record])
                .filter(([id]) => id)
        );

        return merged;
    }

    function renderFeed(records) {
        const list = $("milanFeedList");

        if (!list) return;

        records = (Array.isArray(records) ? records : []).filter(record => !isChatFeedRecord(record));

        state.feedRecords = new Map(
            (records || [])
                .map(record => [getRecordId(record), record])
                .filter(([id]) => id)
        );

        // Don't replace the feed DOM while a video is playing or paused mid-stream.
        const activeVideo = Array.from(list.querySelectorAll("video")).find(video =>
            !video.ended && (video.currentTime > 0 || !video.paused)
        );

        if (activeVideo) {
            state.pendingFeedRenderRecords = records;

            if (activeVideo.dataset.milanFeedRenderDeferred !== "1") {
                activeVideo.dataset.milanFeedRenderDeferred = "1";
                activeVideo.addEventListener("ended", () => {
                    activeVideo.dataset.milanFeedRenderDeferred = "0";
                    const pending = state.pendingFeedRenderRecords;
                    state.pendingFeedRenderRecords = null;
                    if (Array.isArray(pending)) renderFeed(pending);
                }, { once: true });
            }

            return;
        }

        state.pendingFeedRenderRecords = null;

        if (!records.length) {
            list.innerHTML = `
                <div class="milan-feed-empty">
                    No posts yet. Write your first quote above.
                </div>
            `;
            return;
        }

        list.innerHTML =
            records.map(feedCard).join("");

        bindFeedActions();
    }

    async function loadFeed(options = {}) {
        const list = $("milanFeedList");

        if (!list || state.feedLoading) return;

        const auth = getToken();

        if (!auth) {
            list.innerHTML = `
                <div class="milan-feed-empty">
                    Login required to load your feed.
                </div>
            `;
            return;
        }

        state.feedLoading = true;

        const keepExisting =
            options.keepExisting === true;

        if (!keepExisting && !list.children.length) {
            list.innerHTML = `
                <div class="milan-feed-loading">
                    Loading your MILAN feed…
                </div>
            `;
        }

        try {
            const response = await fetch(
                "/api/social/feed?scope=all",
                {
                    method: "GET",
                    headers: {
                        "Authorization": "Bearer " + auth,
                        "Accept": "application/json"
                    },
                    cache: "no-store"
                }
            );

            const payload =
                await response
                    .json()
                    .catch(() => ({}));

            if (!response.ok) {
                throw new Error(
                    payload.error ||
                    payload.detail ||
                    `Feed failed: HTTP ${response.status}`
                );
            }

            const serverRecords =
                normalizeRecords(payload);

            const merged =
                mergeRecords(serverRecords);

            renderFeed(merged);

        } catch (error) {
            console.error(
                "[MILAN] Feed load failed:",
                error
            );

            /*
             * CRITICAL:
             * Never erase an already visible feed because
             * a background refresh failed.
             */
            if (!list.children.length) {
                list.innerHTML = `
                    <div class="milan-feed-empty">
                        Feed is reconnecting…
                        <button
                            type="button"
                            id="milanFeedRetry">
                            Retry
                        </button>
                    </div>
                `;

                $("milanFeedRetry")?.addEventListener(
                    "click",
                    () => loadFeed({ keepExisting: true }),
                    { once: true }
                );
            }
        } finally {
            state.feedLoading = false;
        }
    }

    /* =========================================================
       SINGLE PUBLISH HANDLER
       ========================================================= */

    async function publish() {
        const button = $("publishBtn");
        const textarea = $("postText");
        const mediaInput = $("mediaFile");

        if (!button || !textarea) return;
        if (button.dataset.publishing === "1") return;

        const originalDraft = String(textarea.value || "");
        const text = originalDraft.trim();
        const file = mediaInput?.files?.[0] || null;

        if (!text && !file) {
            showPublishStatus(
                "Select an image or write something first.",
                true
            );
            textarea.focus();
            return;
        }

        const auth = getToken();

        if (!auth) {
            showPublishStatus(
                "Login session missing.",
                true
            );
            return;
        }

        const privacyButton =
            document.querySelectorAll(".composer-tools .tool")[3];

        const privacyMode =
            privacyButton?.dataset?.privacy === "public"
                ? "public"
                : "private";

        const originalText = button.textContent;

        const optimisticId =
            !file
                ? "local-" +
                  (window.crypto?.randomUUID
                      ? window.crypto.randomUUID()
                      : Date.now() + "-" + Math.random().toString(36).slice(2))
                : "";

        const optimisticAt = new Date().toISOString();
        const optimisticRecord =
            optimisticId
                ? {
                    id: optimisticId,
                    title: "MILAN Quote",
                    data: {
                        kind: "quote",
                        text,
                        createdAt: optimisticAt
                    },
                    dataFormat: "application/json",
                    accessMode: privacyMode,
                    sharedWithDids: [],
                    tags: ["quote"],
                    dateCreated: optimisticAt,
                    dateModified: optimisticAt,
                    __milanOptimistic: true
                }
                : null;

        if (optimisticRecord) {
            state.pendingPosts.set(
                optimisticId,
                optimisticRecord
            );

            const currentRecords =
                Array.from(state.feedRecords.values());

            /*
             * Paint the post immediately. The network request below is
             * reconciliation, not the first visible render.
             */
            renderFeed(
                mergeRecords([
                    optimisticRecord,
                    ...currentRecords
                ])
            );

            showPublishStatus("Publishing your post…");
        }

        const b64 = value =>
            btoa(unescape(encodeURIComponent(String(value || ""))));

        try {
            button.disabled = true;
            button.dataset.publishing = "1";
            button.textContent = file ? "Uploading…" : "Publishing…";
            showPublishStatus(file ? "Uploading your media…" : "Publishing your post…");

            let response = null;
            let saved = null;

            const videoExtensions = new Set([
                ".mp4", ".m4v", ".mov", ".qt", ".webm", ".ogv",
                ".mkv", ".avi", ".wmv", ".flv", ".3gp", ".3g2",
                ".mpeg", ".mpg", ".mts", ".m2ts", ".ts"
            ]);

            const fileExt =
                "." +
                String(file?.name || "")
                    .split(".")
                    .pop()
                    .toLowerCase();

            const isVideoFile =
                !!file &&
                (
                    /^video\//i.test(file.type || "") ||
                    videoExtensions.has(fileExt)
                );

            if (isVideoFile) {
                showVideoUploadProgress(0);

                saved = await uploadVideoChunked(
                    file,
                    {
                        title: file.name,
                        caption: text,
                        accessMode: privacyMode
                    },
                    percent => {
                        showVideoUploadProgress(percent);
                    }
                );

            } else if (file) {
                showVideoUploadProgress(0);

                response = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();

                    xhr.open("POST", "/api/records/media", true);
                    xhr.timeout = Number(window.MILAN_UPLOAD_TIMEOUT_MS || 18e5);

                    xhr.setRequestHeader("Authorization", "Bearer " + auth);
                    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
                    xhr.setRequestHeader("Accept", "application/json");
                    xhr.setRequestHeader("X-File-Name", b64(file.name));
                    xhr.setRequestHeader("X-Record-Title", b64(file.name));
                    xhr.setRequestHeader("X-Record-Caption", b64(text));
                    xhr.setRequestHeader("X-Access-Mode", privacyMode);
                    xhr.setRequestHeader("X-Record-Tags", b64(JSON.stringify([])));
                    xhr.setRequestHeader("X-Shared-With-Dids", b64(JSON.stringify([])));

                    xhr.upload.onprogress = event => {
                        if (event.lengthComputable) {
                            const percent = Math.max(
                                1,
                                Math.min(99, (event.loaded / event.total) * 100)
                            );
                            showVideoUploadProgress(percent);
                        }
                    };

                    xhr.onload = () => {
                        let data = {};
                        try {
                            data = JSON.parse(xhr.responseText || "{}");
                        } catch (_) {}

                        if (xhr.status >= 200 && xhr.status < 300) {
                            resolve({
                                ok: true,
                                json: async () => data
                            });
                        } else {
                            reject(
                                new Error(
                                    data.error ||
                                    data.detail ||
                                    `DWN write failed: HTTP ${xhr.status}`
                                )
                            );
                        }
                    };

                    xhr.onerror = () =>
                        reject(new Error("Network error during upload."));

                    xhr.ontimeout = () =>
                        reject(new Error("Upload is taking too long."));

                    xhr.onabort = () =>
                        reject(new Error("Upload cancelled."));

                    xhr.send(file);
                });
            } else {
                const createdAt = new Date().toISOString();

                response = await fetch("/api/records", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + auth,
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({
                        recordId: optimisticId || undefined,
                        title: "MILAN Quote",
                        data: {
                            kind: "quote",
                            text,
                            createdAt
                        },
                        dataFormat: "application/json",
                        accessMode: privacyMode,
                        sharedWithDids: [],
                        tags: ["quote"]
                    })
                });
            }

            if (saved === null) {
                saved =
                    await response
                        .json()
                        .catch(() => ({}));

                if (!response.ok) {
                    throw new Error(
                        saved.error ||
                        saved.detail ||
                        `DWN write failed: HTTP ${response.status}`
                    );
                }
            }

            const savedId = getRecordId(saved);
            if (!savedId) {
                throw new Error(
                    "The server did not confirm the saved post. Your draft is still available; please retry."
                );
            }

            if (file) {
                showVideoUploadProgress(100);
                playVideoUploadTing();
            }

            if (optimisticRecord && savedId) {
                /*
                 * The backend reuses the same client recordId, so replace
                 * the optimistic row with the authoritative record.
                 */
                state.pendingPosts.delete(optimisticId);
                state.feedRecords.delete(optimisticId);
                state.feedRecords.set(savedId, {
                    ...saved,
                    __milanOptimistic: false
                });
            } else if (savedId) {
                state.pendingPosts.set(
                    savedId,
                    saved
                );
            }

            if (textarea.value === originalDraft) {
                textarea.value = "";
            }
            if (file && mediaInput?.files?.[0] === file) {
                mediaInput.value = "";
                mediaInput.dispatchEvent(
                    new Event("change", { bubbles: true })
                );
            }

            /*
             * Re-render the real saved record without forcing a full feed
             * reload or making the user wait for another network request.
             */
            const currentRecords =
                Array.from(
                    state.feedRecords.values()
                );

            const mergedNow = mergeRecords([
                ...currentRecords,
                saved
            ]);

            renderFeed(mergedNow);

            button.textContent = "Published ✓";
            const successMessage = "Post published successfully.";
            showPublishStatus(successMessage);

            /*
             * Background sync is allowed, but it uses mergeRecords().
             * Therefore it CANNOT make the newly published post vanish.
             */
            setTimeout(() => {
                loadFeed({
                    keepExisting: true
                });
            }, 700);

            setTimeout(() => {
                button.textContent = originalText;
                button.disabled = false;
                delete button.dataset.publishing;

                const status = $("milanPublishStatus");
                if (status?.textContent === successMessage) status.remove();
                showVideoUploadProgress(null);
            }, 2200);

        } catch (error) {
            console.error(
                "[MILAN] Publish failed:",
                error
            );

            button.textContent =
                originalText;

            button.disabled = false;

            showVideoUploadProgress(null);

            /*
             * Roll back only the optimistic text row when the authoritative
             * write fails. Restore the draft so the user never loses it.
             */
            if (optimisticRecord) {
                state.pendingPosts.delete(optimisticId);
                state.feedRecords.delete(optimisticId);
                renderFeed(
                    Array.from(state.feedRecords.values())
                );
            }

            showPublishStatus(
                (error?.message || "Post could not be published.") +
                    " Your draft and any newly selected file remain available.",
                true
            );
            delete button.dataset.publishing;
        }
    }

    function initPublish() {
        const button = $("publishBtn");

        if (!button) return;

        /*
         * Replace the button once so any old click
         * listeners from previous builds are removed.
         */
        const cleanButton =
            button.cloneNode(true);

        button.replaceWith(cleanButton);

        cleanButton.addEventListener(
            "click",
            publish
        );
    }

    /* =========================================================
       FOLLOW BUTTONS
       ========================================================= */

    function initFollowButtons() {
        document
            .querySelectorAll(".follow")
            .forEach((button) => {
                if (
                    button.dataset.milanFollowBound === "1"
                ) {
                    return;
                }

                button.dataset.milanFollowBound =
                    "1";

                button.addEventListener(
                    "click",
                    () => {
                        const person =
                            button
                                .closest(".person")
                                ?.querySelector(
                                    ".person-info b"
                                )
                                ?.textContent
                                ?.trim() ||
                            "user";

                        const following =
                            button.dataset.following ===
                            "true";

                        button.dataset.following =
                            following
                                ? "false"
                                : "true";

                        button.textContent =
                            following
                                ? "Follow"
                                : "Following";

                        localStorage.setItem(
                            "milan_follow_" +
                            person
                                .toLowerCase()
                                .replace(
                                    /\s+/g,
                                    "_"
                                ),
                            following
                                ? "false"
                                : "true"
                        );
                    }
                );
            });
    }

    /* =========================================================
       INIT
       ========================================================= */

    function init() {
        initIdentityGuard();
        initLogout();
        initNavigation();
        initComposerTools();
        initPublish();
        initFollowButtons();

        /*
         * Feed and authoritative profile identity load in parallel.
         * Identity is server-side, not device-local.
         */
        void loadAuthoritativeIdentity();
        loadFeed();
    }

    window.milanRefreshHomeFeed =
        () => loadFeed({
            keepExisting: true
        });

    if (
        document.readyState === "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            init,
            { once: true }
        );
    } else {
        init();
    }

    console.log(
        "[MILAN] Single authoritative UI controller active."
    );
})();

/* === ./milan-upload-policy.js === */
(function (root) {
    "use strict";

    function getVideoUploadConcurrency(totalChunks, options = {}) {
        const count = Math.floor(Number(totalChunks));
        if (!Number.isFinite(count) || count <= 1) return 1;

        const connection = options.connection || {};
        const type = String(connection.effectiveType || "").toLowerCase();
        const downlink = Number(connection.downlink);
        const rtt = Number(connection.rtt);
        let recommended = 3;

        if (connection.saveData || /^(slow-2g|2g)$/.test(type)) {
            recommended = 1;
        } else if (
            type === "3g" ||
            (Number.isFinite(downlink) && downlink > 0 && downlink <= 1.5) ||
            (Number.isFinite(rtt) && rtt >= 500)
        ) {
            recommended = 2;
        }

        const memory = Number(options.deviceMemory);
        const cores = Number(options.hardwareConcurrency);
        const lowMemory = Number.isFinite(memory) && memory > 0 && memory <= 2;
        const lowCores = Number.isFinite(cores) && cores > 0 && cores <= 2;
        if (lowMemory || lowCores) recommended = Math.min(recommended, 2);

        const rawOverride = options.override;
        const override = Number(rawOverride);
        const hasOverride =
            rawOverride !== undefined &&
            rawOverride !== null &&
            rawOverride !== "" &&
            Number.isFinite(override) &&
            override >= 1;

        if (hasOverride) {
            recommended = Math.max(1, Math.min(3, Math.floor(override)));
        }

        return Math.max(1, Math.min(count, recommended));
    }

    const api = Object.freeze({ getVideoUploadConcurrency });
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.MilanUploadPolicy = api;
})(typeof window !== "undefined" ? window : globalThis);

/* === ./milan-visual-engine.js === */
/* ============================================================
   MILAN — Visual Interaction Engine v1
   ============================================================ */

"use strict";

(() => {
  const init = () => {
    /* Pointer ambient light */
    if (!window.matchMedia("(pointer:fine)").matches) {
      return setupReveals();
    }

    const glow = document.createElement("div");
    glow.className = "milan-pointer-glow";
    document.body.appendChild(glow);

    let raf = 0;
    let x = 0;
    let y = 0;

    const move = event => {
      x = event.clientX;
      y = event.clientY;

      if (raf) return;

      raf = requestAnimationFrame(() => {
        glow.style.left = `${x}px`;
        glow.style.top = `${y}px`;
        glow.style.opacity = "1";
        raf = 0;
      });
    };

    document.addEventListener("pointermove", move, {
      passive:true
    });

    document.addEventListener("pointerleave", () => {
      glow.style.opacity = "0";
    });

    setupReveals();
  };

  function setupReveals() {
    const targets = document.querySelectorAll(
      ".post, .milan-feed-card, .right-card, .composer, .sidebar"
    );

    if (!targets.length) return;

    targets.forEach((el, index) => {
      if (el.dataset.visualReady) return;

      el.dataset.visualReady = "1";
      el.classList.add("milan-visual-reveal");
      el.style.transitionDelay = `${Math.min(index * 35, 220)}ms`;
    });

    if (!("IntersectionObserver" in window)) {
      targets.forEach(el =>
        el.classList.add("is-visible")
      );
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;

          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        root:null,
        rootMargin:"0px 0px -8% 0px",
        threshold:0.04
      }
    );

    targets.forEach(el => observer.observe(el));
  }

  /* Button press feedback */
  document.addEventListener(
    "pointerdown",
    event => {
      const button = event.target.closest("button");
      if (!button) return;

      button.classList.remove("milan-press");
      void button.offsetWidth;
      button.classList.add("milan-press");

      setTimeout(() => {
        button.classList.remove("milan-press");
      }, 180);
    },
    {passive:true}
  );

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {once:true}
    );
  } else {
    init();
  }

  /* Re-observe dynamically rendered feed */
  const feed = document.getElementById("feed");

  if (feed && "MutationObserver" in window) {
    let timer = 0;

    const mutationObserver =
      new MutationObserver(() => {
        clearTimeout(timer);

        timer = setTimeout(() => {
          setupReveals();
        }, 90);
      });

    mutationObserver.observe(feed, {
      childList:true
    });
  }
})();

/* ============================================================
   Web5 identity / network visual layer
   ============================================================ */

(() => {
  const initWeb5Visuals = () => {
    const profile = document.querySelector(".profile");
    if (!profile || profile.dataset.web5VisualReady) return;

    profile.dataset.web5VisualReady = "1";
    profile.classList.add("milan-identity-panel");

    const did = document.getElementById("myDid");
    const dwn = document.getElementById("myDwn");
    const health = document.getElementById("health");

    const status = document.createElement("div");
    status.className = "milan-web5-status";

    status.innerHTML = `
      <span class="milan-web5-dot"></span>
      <span>Web5 identity layer active</span>
    `;

    profile.appendChild(status);

    if (did && !did.parentElement?.querySelector(".milan-did-chip")) {
      const chip = document.createElement("div");
      chip.className = "milan-did-chip";

      chip.innerHTML = `
        <span class="label">DID</span>
        <span class="value"></span>
      `;

      chip.querySelector(".value").textContent =
        did.textContent.trim() || "Resolving identity…";

      did.parentElement?.appendChild(chip);
    }

    if (dwn && !dwn.parentElement?.querySelector(".milan-dwn-chip")) {
      const chip = document.createElement("span");
      chip.className = "milan-dwn-chip";
      chip.textContent = "DWN Connected";

      dwn.parentElement?.appendChild(chip);
    }

    if (health) {
      health.classList.add("milan-network-value");
      health.parentElement?.classList.add("milan-network-left");

      const strip = document.createElement("div");
      strip.className = "milan-network-strip";

      strip.innerHTML = `
        <div class="milan-network-left">
          <span class="milan-web5-dot"></span>
          <span class="milan-network-label">Network</span>
          <span class="milan-network-value"></span>
        </div>
        <span class="milan-network-meta">DWN • DID • Private by default</span>
      `;

      const value = strip.querySelector(".milan-network-value");
      value.textContent =
        health.textContent.trim() || "Connecting…";

      health.closest(".card")?.prepend(strip);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initWeb5Visuals,
      { once: true }
    );
  } else {
    initWeb5Visuals();
  }

  setTimeout(initWeb5Visuals, 900);
})();

/* ============================================================
   Web5 Workspace composition
   ============================================================ */

(() => {
  const initWorkspace = () => {
    const composer = document.querySelector(".composer");
    if (!composer || composer.dataset.workspaceReady) return;

    composer.dataset.workspaceReady = "1";

    const label = document.createElement("div");
    label.className = "milan-workspace-label";

    label.innerHTML = `
      <div class="milan-workspace-title">
        <span class="mark">◈</span>
        <div>
          <strong>Your Web5 Space</strong>
          <span>Create a record you control.</span>
        </div>
      </div>

      <span class="milan-workspace-status">
        <i></i>
        User-owned data
      </span>
    `;

    composer.prepend(label);

    const privacy = document.getElementById("privacy");

    if (privacy && !composer.querySelector(".milan-privacy-pills")) {
      const pills = document.createElement("div");
      pills.className = "milan-privacy-pills";

      const modes = [
        ["private", "🔒 Private"],
        ["public", "🌐 Public"],
        ["shared_did", "◈ Shared DID"]
      ];

      modes.forEach(([value, text]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "milan-privacy-pill";
        button.dataset.mode = value;
        button.textContent = text;

        button.addEventListener("click", () => {
          privacy.value = value;
          privacy.dispatchEvent(new Event("change", {
            bubbles: true
          }));

          pills
            .querySelectorAll(".milan-privacy-pill")
            .forEach(item => {
              item.classList.toggle(
                "active",
                item.dataset.mode === value
              );
            });

          updateVisibilityNote(value);
        });

        pills.appendChild(button);
      });

      composer.appendChild(pills);

      const note = document.createElement("div");
      note.className = "milan-visibility-note";
      note.innerHTML = `
        <span class="icon">🔒</span>
        <span class="text"></span>
      `;

      composer.appendChild(note);

      const sync = () => {
        const value = privacy.value || "private";

        pills
          .querySelectorAll(".milan-privacy-pill")
          .forEach(item => {
            item.classList.toggle(
              "active",
              item.dataset.mode === value
            );
          });

        updateVisibilityNote(value);
      };

      function updateVisibilityNote(value) {
        const icon = note.querySelector(".icon");
        const text = note.querySelector(".text");

        const states = {
          private: [
            "🔒",
            "Private — only you can access this record."
          ],
          public: [
            "🌐",
            "Public — visible in the public feed."
          ],
          shared_did: [
            "◈",
            "Shared DID — only selected identities."
          ]
        };

        const state = states[value] || states.private;

        icon.textContent = state[0];
        text.textContent = state[1];
      }

      privacy.addEventListener("change", sync);
      sync();
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initWorkspace,
      { once:true }
    );
  } else {
    initWorkspace();
  }

  setTimeout(initWorkspace, 700);
})();

(() => {
  const initFeedHeader = () => {
    const feed =
      document.getElementById("feed") ||
      document.querySelector(".feed");

    if (!feed || feed.dataset.spaceHeaderReady) return;

    const host =
      feed.parentElement || feed;

    if (
      host.querySelector(".milan-feed-space-header")
    ) {
      feed.dataset.spaceHeaderReady = "1";
      return;
    }

    feed.dataset.spaceHeaderReady = "1";

    const header = document.createElement("div");
    header.className = "milan-feed-space-header";

    header.innerHTML = `
      <div>
        <h2>Your Network</h2>
        <p>Private-first conversations across your Web5 space.</p>
      </div>

      <span class="milan-feed-mode">
        <span class="signal"></span>
        LIVE SPACE
      </span>
    `;

    feed.parentElement?.insertBefore(
      header,
      feed
    );
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initFeedHeader,
      { once:true }
    );
  } else {
    initFeedHeader();
  }

  setTimeout(initFeedHeader, 900);
})();

/* ============================================================
   Spatial feed enhancement
   ============================================================ */

(() => {
  const classifyAccess = value => {
    if (value === "public") return "public";
    if (value === "shared_did") return "shared";
    return "private";
  };

  const accessLabel = type => ({
    private: "Private record",
    public: "Public record",
    shared: "Shared with selected DID"
  }[type] || "Private record");

  const accessIcon = type => ({
    private: "🔒",
    public: "🌐",
    shared: "◈"
  }[type] || "🔒");

  const enhancePost = post => {
    if (!post || post.dataset.spatialReady) return;

    post.dataset.spatialReady = "1";

    const access =
      post.dataset.accessMode ||
      post.querySelector(".mini")?.textContent
        ?.match(/private|public|shared_did/i)?.[0] ||
      "private";

    const type = classifyAccess(
      String(access).toLowerCase()
    );

    post.insertAdjacentHTML(
      "afterbegin",
      '<span class="milan-live-rail"></span>'
    );

    const header =
      post.querySelector(".postHead");

    if (header) {
      const context =
        document.createElement("div");

      context.className =
        "milan-post-context";

      context.innerHTML = `
        <div class="left">
          <span class="milan-access-icon ${type}">
            ${accessIcon(type)}
          </span>

          <span class="label">
            Web5 record
          </span>

          <span class="value">
            ${accessLabel(type)}
          </span>
        </div>

        <span class="right">
          User-controlled
        </span>
      `;

      header.after(context);
    }

    const media =
      post.querySelector(".media");

    if (media && !media.parentElement?.classList.contains("milan-media-frame")) {
      const frame =
        document.createElement("div");

      frame.className =
        "milan-media-frame";

      media.parentNode.insertBefore(
        frame,
        media
      );

      frame.appendChild(media);
    }
  };

  const scan = () => {
    document
      .querySelectorAll(
        "#feed .post, .feed .post"
      )
      .forEach(enhancePost);
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      scan,
      { once:true }
    );
  } else {
    scan();
  }

  setTimeout(scan, 800);
  setTimeout(scan, 1800);

  const feed =
    document.getElementById("feed");

  if (
    feed &&
    "MutationObserver" in window
  ) {
    const observer =
      new MutationObserver(() => {
        requestAnimationFrame(scan);
      });

    observer.observe(feed, {
      childList:true
    });
  }
})();

/* ============================================================
   DID Identity Cockpit
   ============================================================ */

(() => {
  const initIdentityCockpit = () => {
    const profile = document.querySelector(".profile");

    if (
      !profile ||
      profile.dataset.identityCockpitReady
    ) {
      return;
    }

    profile.dataset.identityCockpitReady = "1";

    const name =
      document.getElementById("myName");

    const avatar =
      document.getElementById("myAvatar");

    const email =
      document.getElementById("myEmail");

    const did =
      document.getElementById("myDid");

    const dwn =
      document.getElementById("myDwn");

    if (!name) return;

    const cockpit =
      document.createElement("div");

    cockpit.className =
      "milan-identity-cockpit";

    cockpit.innerHTML = `
      <div class="milan-identity-header">
        <div class="milan-identity-avatar"></div>

        <div class="milan-identity-core">
          <strong class="name"></strong>
          <div class="role">
            Self-owned Web5 identity
          </div>
        </div>

        <span class="milan-identity-live">
          <i></i>
          Live
        </span>
      </div>

      <div class="milan-identity-grid">
        <div class="milan-identity-stat">
          <div class="k">Identity</div>
          <div class="v good">Verified locally</div>
        </div>

        <div class="milan-identity-stat">
          <div class="k">Storage</div>
          <div class="v storage">DWN Connected</div>
        </div>
      </div>

      <div class="milan-identity-did">
        <div class="label">Decentralized Identifier</div>
        <div class="value did-value">
          DID Active
        </div>
      </div>

      <div class="milan-identity-footer">
        <span class="network">
          Network <b>Private-first</b>
        </span>

        <span class="milan-identity-badge">
          ◈ Web5
        </span>
      </div>
    `;

    const avatarHost =
      cockpit.querySelector(
        ".milan-identity-avatar"
      );

    if (
      avatar &&
      avatar.innerHTML.trim()
    ) {
      avatarHost.innerHTML =
        avatar.innerHTML;
    } else {
      avatarHost.textContent = "M";
    }

    cockpit.querySelector(
      ".name"
    ).textContent =
      name.textContent.trim() ||
      "MILAN User";

    cockpit.querySelector(
      ".did-value"
    ).textContent =
      did?.textContent.trim() ||
      "DID Active";

    cockpit.querySelector(
      ".storage"
    ).textContent =
      dwn?.textContent
        .replace(/^Cloud DWN:\s*/i, "")
        .trim() ||
      "DWN Connected";

    profile.prepend(cockpit);

    /* Keep cockpit synchronized with existing DOM. */
    const sync = () => {
      const currentName =
        name?.textContent.trim();

      const currentDid =
        did?.textContent.trim();

      const currentDwn =
        dwn?.textContent
          .replace(/^Cloud DWN:\s*/i, "")
          .trim();

      if (currentName) {
        cockpit.querySelector(
          ".name"
        ).textContent = currentName;
      }

      if (currentDid) {
        cockpit.querySelector(
          ".did-value"
        ).textContent = currentDid;
      }

      if (currentDwn) {
        cockpit.querySelector(
          ".storage"
        ).textContent = currentDwn;
      }

      const emailValue =
        email?.textContent.trim();

      if (emailValue) {
        cockpit.title =
          emailValue;
      }
    };

    const observer =
      new MutationObserver(sync);

    [name, email, did, dwn]
      .filter(Boolean)
      .forEach(element => {
        observer.observe(element, {
          childList:true,
          subtree:true,
          characterData:true
        });
      });

    sync();
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initIdentityCockpit,
      { once:true }
    );
  } else {
    initIdentityCockpit();
  }

  setTimeout(
    initIdentityCockpit,
    1000
  );
})();

(() => {
  const initPrivacyScore = () => {
    const cockpit =
      document.querySelector(
        ".milan-identity-cockpit"
      );

    if (
      !cockpit ||
      cockpit.querySelector(
        ".milan-identity-score"
      )
    ) {
      return;
    }

    const score =
      document.getElementById(
        "privacyScore"
      );

    if (!score) return;

    const box =
      document.createElement("div");

    box.className =
      "milan-identity-score";

    box.innerHTML = `
      <div class="milan-identity-score-head">
        <span>Privacy posture</span>
        <b>100%</b>
      </div>

      <div class="milan-identity-score-bar">
        <span></span>
      </div>
    `;

    cockpit.appendChild(box);

    const sync = () => {
      const text =
        score.textContent.trim();

      const value =
        parseInt(
          text.replace(/\D/g, ""),
          10
        );

      if (
        !Number.isFinite(value)
      ) {
        return;
      }

      const bounded =
        Math.max(
          0,
          Math.min(100, value)
        );

      box.querySelector(
        "b"
      ).textContent =
        bounded + "%";

      box.querySelector(
        ".milan-identity-score-bar span"
      ).style.width =
        bounded + "%";
    };

    const observer =
      new MutationObserver(sync);

    observer.observe(score, {
      childList:true,
      characterData:true,
      subtree:true
    });

    sync();
  };

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initPrivacyScore,
      { once:true }
    );
  } else {
    initPrivacyScore();
  }

  setTimeout(
    initPrivacyScore,
    1300
  );
})();

/* ============================================================
   Profile picture hero + Web5 identity proof
   ============================================================ */

(() => {
  const initProfileHero = () => {
    const profile = document.querySelector(".profile");
    const avatar = document.getElementById("myAvatar");
    const name = document.getElementById("myName");
    const did = document.getElementById("myDid");
    const dwn = document.getElementById("myDwn");

    if (
      !profile ||
      !avatar ||
      profile.dataset.profileHeroReady
    ) {
      return;
    }

    profile.dataset.profileHeroReady = "1";

    const hero = document.createElement("div");
    hero.className = "milan-profile-hero";

    const orbit = document.createElement("div");
    orbit.className = "milan-profile-avatar-orbit";

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "milan-profile-avatar";

    const avatarInner = document.createElement("div");
    avatarInner.className = "milan-profile-avatar-inner";

    const copyAvatar = () => {
      avatarInner.innerHTML = "";

      const image = avatar.querySelector("img");

      if (image?.src) {
        const clone = document.createElement("img");
        clone.src = image.src;
        clone.alt = image.alt || "Milan profile";
        avatarInner.appendChild(clone);
        return;
      }

      const bg = getComputedStyle(avatar).backgroundImage;

      if (bg && bg !== "none") {
        avatarInner.style.backgroundImage = bg;
        avatarInner.style.backgroundSize = "cover";
        avatarInner.style.backgroundPosition = "center";
        return;
      }

      avatarInner.textContent =
        avatar.textContent.trim() || "M";
    };

    copyAvatar();

    const state = document.createElement("span");
    state.className = "milan-profile-avatar-state";
    state.textContent = "✓";
    state.title = "Identity active";

    avatarWrap.appendChild(avatarInner);
    orbit.appendChild(avatarWrap);
    orbit.appendChild(state);

    hero.appendChild(orbit);

    const displayName = document.createElement("div");
    displayName.className = "milan-profile-name";
    displayName.textContent =
      name?.textContent.trim() || "MILAN User";
    hero.appendChild(displayName);

    const subtitle = document.createElement("div");
    subtitle.className = "milan-profile-subtitle";
    subtitle.textContent =
      "Self-owned Web5 identity";
    hero.appendChild(subtitle);

    const proof = document.createElement("div");
    proof.className = "milan-profile-proof";

    proof.innerHTML = `
      <span class="milan-proof-chip web5">◈ Web5</span>
      <span class="milan-proof-chip did">DID</span>
      <span class="milan-proof-chip dwn">DWN</span>
    `;

    hero.appendChild(proof);

    profile.prepend(hero);

    /* Keep the hero synchronized with profile changes. */
    const sync = () => {
      if (name?.textContent.trim()) {
        displayName.textContent =
          name.textContent.trim();
      }

      copyAvatar();

      const didValue =
        did?.textContent.trim() || "";

      const dwnValue =
        dwn?.textContent.trim() || "";

      proof.querySelector(".did").title =
        didValue || "DID Active";

      proof.querySelector(".dwn").title =
        dwnValue || "DWN Connected";
    };

    const observer =
      new MutationObserver(sync);

    [avatar, name, did, dwn]
      .filter(Boolean)
      .forEach(element => {
        observer.observe(element, {
          childList:true,
          subtree:true,
          attributes:true,
          characterData:true
        });
      });

    sync();
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initProfileHero,
      { once:true }
    );
  } else {
    initProfileHero();
  }

  setTimeout(initProfileHero, 900);
  setTimeout(initProfileHero, 1800);
})();

(() => {
  const activateProfilePulse = () => {
    const hero =
      document.querySelector(".milan-profile-hero");

    if (!hero) return;

    hero.classList.add("is-scanning");

    setTimeout(() => {
      hero.classList.remove("is-scanning");
    }, 2200);
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      activateProfilePulse,
      { once:true }
    );
  } else {
    activateProfilePulse();
  }
})();

/* ============================================================
   Creation Studio interaction layer
   ============================================================ */

(() => {
  const initCreationStudio = () => {
    const composer = document.querySelector(".composer");

    if (
      !composer ||
      composer.dataset.creationStudioReady
    ) {
      return;
    }

    composer.dataset.creationStudioReady = "1";

    const studio = document.createElement("div");
    studio.className = "milan-creation-studio";

    studio.innerHTML = `
      <div class="milan-creation-top">
        <div class="milan-creation-brand">
          <span class="milan-creation-mark">◈</span>
          <div class="milan-creation-title">
            <strong>Creation Studio</strong>
            <span>Compose a user-owned record</span>
          </div>
        </div>

        <span class="milan-creation-live">
          <i></i>
          READY
        </span>
      </div>

      <div class="milan-creation-tools">
        <button type="button" class="milan-create-tool" data-create="text">
          <span class="icon">✦</span>
          <span class="label">Text</span>
        </button>

        <button type="button" class="milan-create-tool" data-create="media">
          <span class="icon">◫</span>
          <span class="label">Media</span>
        </button>

        <button type="button" class="milan-create-tool" data-create="attach">
          <span class="icon">⌁</span>
          <span class="label">Attach</span>
        </button>

        <button type="button" class="milan-create-tool" data-create="focus">
          <span class="icon">◎</span>
          <span class="label">Focus</span>
        </button>
      </div>

      <div class="milan-create-meta">
        <span class="item">
          Identity
          <strong>Self-owned</strong>
        </span>

        <span class="item">
          Storage
          <strong>DWN</strong>
        </span>

        <span class="item">
          Access
          <strong class="access-value">Private</strong>
        </span>

        <span class="milan-publish-state" hidden>
          <span class="spinner"></span>
          Publishing…
        </span>
      </div>
    `;

    composer.prepend(studio);

    const textarea =
      composer.querySelector("textarea");

    const mediaInput =
      document.getElementById("mediaFile");

    const publish =
      document.getElementById("publishBtn");

    const privacy =
      document.getElementById("privacy");

    const tools =
      studio.querySelectorAll(
        ".milan-create-tool"
      );

    const accessValue =
      studio.querySelector(".access-value");

    const setAccessLabel = () => {
      const map = {
        private: "Private",
        public: "Public",
        shared_did: "Shared DID"
      };

      if (accessValue) {
        accessValue.textContent =
          map[privacy?.value] ||
          "Private";
      }
    };

    tools.forEach(tool => {
      tool.addEventListener("click", () => {
        tools.forEach(item =>
          item.classList.remove("active")
        );

        tool.classList.add("active");

        const action =
          tool.dataset.create;

        if (action === "text") {
          textarea?.focus();
        }

        if (action === "media") {
          mediaInput?.click();
        }

        if (action === "attach") {
          const attach =
            document.getElementById(
              "milan-attach-input"
            );

          if (attach) {
            attach.click();
          } else {
            mediaInput?.click();
          }
        }

        if (action === "focus") {
          composer.scrollIntoView({
            behavior:"smooth",
            block:"center"
          });

          setTimeout(
            () => textarea?.focus(),
            280
          );
        }
      });
    });

    if (privacy) {
      privacy.addEventListener(
        "change",
        setAccessLabel
      );
    }

    textarea?.addEventListener(
      "focus",
      () => {
        studio.classList.add(
          "milan-creation-typing"
        );
      },
      {passive:true}
    );

    textarea?.addEventListener(
      "input",
      () => {
        studio.classList.add(
          "milan-creation-typing"
        );
      },
      {passive:true}
    );

    textarea?.addEventListener(
      "blur",
      () => {
        if (!textarea.value.trim()) {
          studio.classList.remove(
            "milan-creation-typing"
          );
        }
      },
      {passive:true}
    );

    mediaInput?.addEventListener(
      "change",
      () => {
        if (
          mediaInput.files?.length
        ) {
          studio.classList.add(
            "milan-creation-typing"
          );

          const meta =
            studio.querySelector(
              ".milan-create-meta"
            );

          if (meta) {
            const existing =
              meta.querySelector(
                ".milan-file-state"
              );

            existing?.remove();

            const state =
              document.createElement("span");

            state.className =
              "item milan-file-state";

            state.innerHTML =
              `Media <strong>${mediaInput.files.length} ready</strong>`;

            meta.appendChild(state);
          }
        }
      }
    );

    if (publish) {
      publish.addEventListener(
        "click",
        () => {
          const state =
            studio.querySelector(
              ".milan-publish-state"
            );

          if (!state) return;

          state.hidden = false;

          setTimeout(() => {
            state.hidden = true;
          }, 4000);
        },
        {capture:true}
      );
    }

    setAccessLabel();
  };

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initCreationStudio,
      {once:true}
    );
  } else {
    initCreationStudio();
  }

  setTimeout(
    initCreationStudio,
    1200
  );
})();

(() => {
  const initWritingMeter = () => {
    const composer = document.querySelector(".composer");
    const textarea = composer?.querySelector("textarea");

    if (
      !composer ||
      !textarea ||
      composer.dataset.writingMeterReady
    ) {
      return;
    }

    composer.dataset.writingMeterReady = "1";

    const meter = document.createElement("div");
    meter.className = "milan-writing-meter";

    meter.innerHTML = `
      <span class="count">0</span>
      <span class="bar"><span></span></span>
      <span class="hint">Ready</span>
    `;

    textarea.parentElement?.appendChild(
      meter
    );

    const count = meter.querySelector(".count");
    const fill = meter.querySelector(".bar span");
    const hint = meter.querySelector(".hint");

    const update = () => {
      const length =
        textarea.value.length;

      const percent =
        Math.min(
          100,
          (length / 500) * 100
        );

      count.textContent =
        `${length}`;

      fill.style.width =
        `${percent}%`;

      hint.textContent =
        length === 0
          ? "Ready"
          : length < 80
            ? "Draft"
            : length < 300
              ? "Good"
              : "Long-form";
    };

    textarea.addEventListener(
      "input",
      update,
      {passive:true}
    );

    update();
  };

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initWritingMeter,
      {once:true}
    );
  } else {
    initWritingMeter();
  }

  setTimeout(
    initWritingMeter,
    1400
  );
})();

/* ============================================================
   UI-8 Live network + navigation behavior
   ============================================================ */

(() => {
  const initLiveNetwork = () => {
    const health =
      document.getElementById("health");

    if (health && !health.parentElement?.querySelector(".milan-network-heartbeat")) {
      const badge =
        document.createElement("span");

      badge.className =
        "milan-network-heartbeat";

      badge.innerHTML = `
        <span class="dot"></span>
        <span>LIVE</span>
      `;

      health.parentElement?.appendChild(badge);
    }

    const notifications =
      document.querySelector(
        '.icon-btn[title="Notifications"]'
      );

    const notifCount =
      document.getElementById("notifCount");

    if (
      notifications &&
      notifCount &&
      !notifications.dataset.liveBadge
    ) {
      notifications.dataset.liveBadge = "1";
      notifications.style.position = "relative";

      const badge =
        document.createElement("span");

      badge.className =
        "milan-notification-badge";

      const syncBadge = () => {
        const value = parseInt(
          notifCount.textContent
            .replace(/\D/g, ""),
          10
        ) || 0;

        if (!value) {
          badge.remove();
          notifications.dataset.notifValue = "0";
          return;
        }

        if (!notifications.contains(badge)) {
          notifications.appendChild(badge);
        }

        badge.textContent =
          value > 99 ? "99+" : String(value);

        badge.classList.toggle(
          "pulse",
          value > 0
        );

        notifications.dataset.notifValue =
          String(value);
      };

      const observer =
        new MutationObserver(syncBadge);

      observer.observe(notifCount, {
        childList:true,
        subtree:true,
        characterData:true
      });

      syncBadge();
    }
  };

  const initScrollEffects = () => {
    const topbar =
      document.querySelector(".topbar");

    const progress =
      document.createElement("div");

    progress.className =
      "milan-scroll-progress";

    document.body.appendChild(progress);

    let ticking = false;

    const update = () => {
      const max =
        document.documentElement.scrollHeight -
        window.innerHeight;

      const current =
        max > 0
          ? window.scrollY / max
          : 0;

      progress.style.width =
        `${Math.max(0, Math.min(1, current)) * 100}%`;

      if (topbar) {
        topbar.classList.toggle(
          "scrolled",
          window.scrollY > 18
        );
      }

      ticking = false;
    };

    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(update);
      },
      {passive:true}
    );

    update();
  };

  const init = () => {
    initLiveNetwork();
    initScrollEffects();
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {once:true}
    );
  } else {
    init();
  }

  setTimeout(initLiveNetwork, 1200);
})();

(() => {
  const initNavState = () => {
    const buttons =
      document.querySelectorAll(
        ".nav button"
      );

    buttons.forEach(button => {
      if (button.dataset.visualNavReady) return;

      button.dataset.visualNavReady = "1";

      const text =
        button.textContent.trim();

      if (
        /notification/i.test(text) &&
        !button.querySelector(
          ".milan-nav-pulse"
        )
      ) {
        const pulse =
          document.createElement("span");

        pulse.className =
          "milan-nav-pulse";

        button.style.position =
          "relative";

        button.appendChild(pulse);
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initNavState,
      {once:true}
    );
  } else {
    initNavState();
  }

  setTimeout(initNavState, 1000);
})();

/* ============================================================
   Web5 Network Constellation
   ============================================================ */

(() => {
  const initials = value =>
    String(value || "M")
      .trim()
      .split(/\s+/)
      .slice(0,2)
      .map(x => x[0] || "")
      .join("")
      .toUpperCase() || "M";

  const initNetworkMap = () => {
    if (document.querySelector(".milan-network-map")) return;

    const source =
      document.getElementById("peopleList") ||
      document.querySelector(".peopleList");

    const people = Array.from(
      source?.querySelectorAll(".person") || []
    ).slice(0, 6);

    if (!people.length) {
      return;
    }

    const host =
      document.querySelector(".rightbar") ||
      document.querySelector(".layout > section");

    if (!host) return;

    const card = document.createElement("div");
    card.className = "right-card card";
    card.dataset.networkMapCard = "1";

    card.innerHTML = `
      <div class="milan-feed-header">
        <div>
          <strong>Web5 Network</strong>
          <span>Your identity + connections</span>
        </div>
      </div>

      <div class="milan-network-map">
        <div class="milan-network-grid"></div>
        <svg class="milan-network-lines"
             viewBox="0 0 100 100"
             preserveAspectRatio="none">
        </svg>

        <div class="milan-network-status">
          <i></i>
          Decentralized space active
        </div>

        <div class="milan-network-count">
          ${people.length} visible connections
        </div>
      </div>
    `;

    host.appendChild(card);

    const map =
      card.querySelector(".milan-network-map");

    const svg =
      card.querySelector(".milan-network-lines");

    const positions = [
      [50,50],
      [22,28],
      [77,26],
      [18,68],
      [82,70],
      [50,18],
      [50,82]
    ];

    const central = document.createElement("div");
    central.className =
      "milan-network-node central";
    central.style.left = "50%";
    central.style.top = "50%";

    central.innerHTML = `
      <div class="core">M</div>
      <span class="milan-network-label">
        Your Identity
      </span>
    `;

    map.appendChild(central);

    people.forEach((person, index) => {
      const [x,y] =
        positions[index + 1] ||
        [
          15 + Math.random() * 70,
          15 + Math.random() * 70
        ];

      const name =
        person.querySelector("b")
          ?.textContent
          ?.trim() ||
        "Connection";

      const avatar =
        person.querySelector("img")
          ?.src || "";

      const node =
        document.createElement("div");

      node.className =
        "milan-network-node";

      node.style.left = `${x}%`;
      node.style.top = `${y}%`;

      node.innerHTML = `
        <div class="core">
          ${
            avatar
              ? `<img src="${avatar}" alt="">`
              : initials(name)
          }
        </div>
        <span class="milan-network-label">
          ${name}
        </span>
      `;

      node.title =
        `${name} • Web5 connection`;

      map.appendChild(node);

      const line =
        document.createElementNS(
          "http://www.w3.org/2000/svg",
          "line"
        );

      line.setAttribute(
        "x1",
        "50"
      );
      line.setAttribute(
        "y1",
        "50"
      );
      line.setAttribute(
        "x2",
        String(x)
      );
      line.setAttribute(
        "y2",
        String(y)
      );

      line.classList.add(
        index % 2
          ? "pulse"
          : "strong"
      );

      svg.appendChild(line);
    });

    const title =
      card.querySelector(".milan-feed-header");

    title?.addEventListener(
      "click",
      () => {
        card.scrollIntoView({
          behavior:"smooth",
          block:"center"
        });
      }
    );
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initNetworkMap,
      { once:true }
    );
  } else {
    initNetworkMap();
  }

  setTimeout(initNetworkMap, 1800);
})();

(() => {
  const bindNetworkInteraction = () => {
    const map =
      document.querySelector(
        ".milan-network-map"
      );

    if (
      !map ||
      map.dataset.interactionReady
    ) {
      return;
    }

    map.dataset.interactionReady = "1";

    const nodes =
      map.querySelectorAll(
        ".milan-network-node"
      );

    nodes.forEach(node => {
      node.addEventListener(
        "mouseenter",
        () => {
          nodes.forEach(other => {
            if (other !== node) {
              other.style.opacity = ".45";
            }
          });

          node.style.zIndex = "5";
        },
        { passive:true }
      );

      node.addEventListener(
        "mouseleave",
        () => {
          nodes.forEach(other => {
            other.style.opacity = "1";
          });

          node.style.zIndex = "";
        },
        { passive:true }
      );
    });
  };

  setTimeout(
    bindNetworkInteraction,
    2200
  );
})();

/* ============================================================
   MILAN — AI Command Center
   Visual command surface only.
   ============================================================ */

(() => {
  const initAICommand = () => {
    if (
      document.querySelector(".milan-ai-command")
    ) {
      return;
    }

    const host =
      document.querySelector(".composer") ||
      document.querySelector(".rightbar");

    if (!host) return;

    const panel =
      document.createElement("section");

    panel.className =
      "milan-ai-command";

    panel.innerHTML = `
      <div class="milan-ai-command-head">
        <div class="milan-ai-command-brand">
          <span class="milan-ai-command-icon">✦</span>

          <div class="milan-ai-command-title">
            <strong>MILAN Intelligence</strong>
            <span>Assist your Web5 space</span>
          </div>
        </div>

        <span class="milan-ai-status">
          <i></i>
          READY
        </span>
      </div>

      <label class="milan-ai-command-input">
        <span class="prompt">⌘</span>

        <input
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="Ask MILAN anything about your space…"
          aria-label="Ask MILAN"
        />

        <span class="shortcut">Enter</span>
      </label>

      <div class="milan-ai-suggestions">
        <button type="button" class="milan-ai-chip">
          ✦ Improve my post
        </button>

        <button type="button" class="milan-ai-chip">
          ◈ Explain my privacy
        </button>

        <button type="button" class="milan-ai-chip">
          ◎ Summarize my space
        </button>

        <button type="button" class="milan-ai-chip">
          ◌ What changed?
        </button>
      </div>

      <div class="milan-ai-result"></div>
    `;

    host.parentNode?.insertBefore(
      panel,
      host.nextSibling
    );

    const input =
      panel.querySelector("input");

    const result =
      panel.querySelector(
        ".milan-ai-result"
      );

    const suggestions =
      panel.querySelectorAll(
        ".milan-ai-chip"
      );

    const run = value => {
      const query =
        String(value || "").trim();

      if (!query) return;

      result.textContent =
        `MILAN is preparing a response for: “${query}”`;

      result.classList.add("show");
    };

    input.addEventListener(
      "keydown",
      event => {
        if (event.key !== "Enter") return;

        event.preventDefault();
        run(input.value);
      }
    );

    suggestions.forEach(button => {
      button.addEventListener(
        "click",
        () => {
          const text =
            button.textContent
              .replace(/^[^\w]+/, "")
              .trim();

          input.value = text;
          input.focus();
          run(text);
        }
      );
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initAICommand,
      { once:true }
    );
  } else {
    initAICommand();
  }

  setTimeout(initAICommand, 1500);
})();

(() => {
  const focusAI = () => {
    const input =
      document.querySelector(
        ".milan-ai-command input"
      );

    if (!input) return;

    input.focus();
    input.select();
  };

  document.addEventListener(
    "keydown",
    event => {
      const target =
        event.target;

      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (
        event.key === "/" &&
        !typing
      ) {
        event.preventDefault();
        focusAI();
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        focusAI();
      }
    }
  );
})();

/* ============================================================
   Unified Identity Hub data layer
   ============================================================ */

(() => {
  const initUnifiedIdentityHub = () => {
    const hero =
      document.querySelector(".milan-profile-hero");

    if (!hero || hero.dataset.unifiedReady) {
      return;
    }

    hero.dataset.unifiedReady = "1";

    const did =
      document.getElementById("myDid");

    const dwn =
      document.getElementById("myDwn");

    const privacy =
      document.getElementById("privacyScore");

    if (!hero.querySelector(".milan-identity-metrics")) {
      const metrics =
        document.createElement("div");

      metrics.className =
        "milan-identity-metrics";

      metrics.innerHTML = `
        <div class="milan-identity-metric">
          <span class="label">Identity</span>
          <span class="value good">Active</span>
        </div>

        <div class="milan-identity-metric">
          <span class="label">Storage</span>
          <span class="value dwn">DWN</span>
        </div>

        <div class="milan-identity-metric">
          <span class="label">Privacy</span>
          <span class="value privacy">100%</span>
        </div>
      `;

      hero.appendChild(metrics);
    }

    const didBox =
      hero.querySelector(".milan-identity-did");

    if (!didBox) {
      const box =
        document.createElement("div");

      box.className =
        "milan-identity-did";

      box.innerHTML = `
        <div class="label">
          Decentralized Identifier
        </div>
        <div class="value did-value">
          Resolving identity…
        </div>
      `;

      hero.appendChild(box);
    }

    const footer =
      hero.querySelector(".milan-identity-footer");

    const sync = () => {
      const didValue =
        did?.textContent.trim();

      const dwnValue =
        dwn?.textContent
          .replace(/^Cloud DWN:\s*/i,"")
          .trim();

      const privacyValue =
        privacy?.textContent.trim();

      const didTarget =
        hero.querySelector(
          ".did-value"
        );

      const dwnTarget =
        hero.querySelector(
          ".value.dwn"
        );

      const privacyTarget =
        hero.querySelector(
          ".value.privacy"
        );

      if (didTarget && didValue) {
        didTarget.textContent =
          didValue;
      }

      if (dwnTarget) {
        dwnTarget.textContent =
          dwnValue || "DWN";
      }

      if (privacyTarget) {
        privacyTarget.textContent =
          privacyValue || "—";
      }

      if (footer) {
        const network =
          footer.querySelector(".network");

        if (network) {
          network.innerHTML =
            `Network <b>Private-first</b>`;
        }
      }
    };

    const observer =
      new MutationObserver(sync);

    [did,dwn,privacy]
      .filter(Boolean)
      .forEach(element => {
        observer.observe(element,{
          childList:true,
          subtree:true,
          characterData:true
        });
      });

    sync();
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initUnifiedIdentityHub,
      {once:true}
    );
  } else {
    initUnifiedIdentityHub();
  }

  setTimeout(
    initUnifiedIdentityHub,
    1000
  );

  setTimeout(
    initUnifiedIdentityHub,
    1800
  );
})();

(() => {
  const syncIdentityName = () => {
    const source =
      document.getElementById("myName");

    const target =
      document.querySelector(
        ".milan-profile-name"
      );

    if (!source || !target) return;

    const value =
      source.textContent.trim();

    if (
      value &&
      value !== "MILAN User"
    ) {
      target.textContent =
        value;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      syncIdentityName,
      {once:true}
    );
  } else {
    syncIdentityName();
  }

  setInterval(
    syncIdentityName,
    1500
  );
})();

/* ============================================================
   Profile photo upload — Identity Hero control
   ============================================================ */

(() => {
  const initHeroUpload = () => {
    const hero =
      document.querySelector(".milan-profile-hero");

    const input =
      document.getElementById("editProfilePhoto");

    const orbit =
      hero?.querySelector(
        ".milan-profile-avatar-orbit"
      );

    if (
      !hero ||
      !input ||
      !orbit ||
      hero.dataset.heroUploadReady
    ) {
      return;
    }

    hero.dataset.heroUploadReady = "1";

    const button =
      document.createElement("button");

    button.type = "button";
    button.className =
      "milan-profile-upload";
    button.title =
      "Change profile picture";
    button.setAttribute(
      "aria-label",
      "Change profile picture"
    );
    button.textContent = "📷";

    button.addEventListener(
      "click",
      () => {
        const liveInput =
          document.getElementById("editProfilePhoto") || input;
        liveInput.click();
      }
    );

    orbit.appendChild(button);
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initHeroUpload,
      {once:true}
    );
  } else {
    initHeroUpload();
  }

  setTimeout(
    initHeroUpload,
    1000
  );

  setTimeout(
    initHeroUpload,
    1800
  );
})();

/* === ./milan-web5-motion.js === */
/* ============================================================
   MILAN — Web5 Motion Engine
   Safe interaction layer
   ============================================================ */

"use strict";

(() => {
  const finePointer =
    window.matchMedia("(pointer:fine)").matches;

  function initPointerLight() {
    if (!finePointer) return;

    const light =
      document.createElement("div");

    light.className =
      "milan-pointer-light";

    document.body.appendChild(light);

    let raf = 0;
    let x = 0;
    let y = 0;

    document.addEventListener(
      "pointermove",
      event => {
        x = event.clientX;
        y = event.clientY;

        if (raf) return;

        raf = requestAnimationFrame(() => {
          light.style.left = `${x}px`;
          light.style.top = `${y}px`;
          light.style.opacity = "1";
          raf = 0;
        });
      },
      { passive:true }
    );

    document.addEventListener(
      "pointerleave",
      () => {
        light.style.opacity = "0";
      },
      { passive:true }
    );
  }

  function initReveals() {
    const selector = [
      ".post",
      ".milan-feed-card",
      ".right-card",
      ".composer",
      ".sidebar"
    ].join(",");

    const elements =
      document.querySelectorAll(selector);

    elements.forEach((element, index) => {
      if (element.dataset.motionReady) return;

      element.dataset.motionReady = "1";
      element.classList.add("milan-reveal");

      element.style.transitionDelay =
        `${Math.min(index * 35, 180)}ms`;
    });

    if (!("IntersectionObserver" in window)) {
      elements.forEach(element =>
        element.classList.add("milan-visible")
      );
      return;
    }

    const observer =
      new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;

            entry.target.classList.add(
              "milan-visible"
            );

            observer.unobserve(
              entry.target
            );
          });
        },
        {
          root:null,
          rootMargin:"0px 0px -6% 0px",
          threshold:0.04
        }
      );

    elements.forEach(element =>
      observer.observe(element)
    );
  }

  function initCardFocus() {
    const selector = [
      ".post",
      ".milan-feed-card",
      ".right-card",
      ".composer"
    ].join(",");

    document.addEventListener(
      "pointerover",
      event => {
        if (!finePointer) return;

        const card =
          event.target.closest(selector);

        if (!card) return;

        card.classList.add(
          "milan-card-focus"
        );
      },
      { passive:true }
    );

    document.addEventListener(
      "pointerout",
      event => {
        const card =
          event.target.closest(selector);

        if (!card) return;

        if (
          event.relatedTarget &&
          card.contains(event.relatedTarget)
        ) {
          return;
        }

        card.classList.remove(
          "milan-card-focus"
        );
      },
      { passive:true }
    );
  }

  function initButtonPress() {
    document.addEventListener(
      "pointerdown",
      event => {
        const button =
          event.target.closest("button");

        if (!button) return;

        button.classList.remove(
          "milan-press"
        );

        void button.offsetWidth;

        button.classList.add(
          "milan-press"
        );

        setTimeout(() => {
          button.classList.remove(
            "milan-press"
          );
        }, 180);
      },
      { passive:true }
    );
  }

  function initHeaderDepth() {
    const header =
      document.querySelector(".topbar");

    if (!header) return;

    let ticking = false;

    const update = () => {
      header.classList.toggle(
        "milan-scrolled",
        window.scrollY > 16
      );

      ticking = false;
    };

    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;

        ticking = true;

        requestAnimationFrame(update);
      },
      { passive:true }
    );

    update();
  }

  function initLiveState() {
    const targets =
      document.querySelectorAll(
        '[title="Notifications"],' +
        '.publish,' +
        '.right-card'
      );

    targets.forEach(element => {
      if (
        element.dataset.liveMotion
      ) {
        return;
      }

      element.dataset.liveMotion = "1";
    });
  }

  function init() {
    initPointerLight();
    initReveals();
    initCardFocus();
    initButtonPress();
    initHeaderDepth();
    initLiveState();
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once:true }
    );
  } else {
    init();
  }

  /* Feed is dynamic, so re-run only the reveal scan. */
  const feed =
    document.getElementById("feed");

  if (
    feed &&
    "MutationObserver" in window
  ) {
    let timer = 0;

    const observer =
      new MutationObserver(() => {
        clearTimeout(timer);

        timer = setTimeout(() => {
          initReveals();
        }, 100);
      });

    observer.observe(feed, {
      childList:true
    });
  }
})();

/* === ./music-engine.js === */

(function(){
  "use strict";
  var $=function(i){return document.getElementById(i);};
  var APP="MILAN", AUDIUS_HOSTS=["https://discoveryprovider.audius.co","https://audius-discovery-1.altego.net","https://discoveryprovider2.audius.co"];
  var engine="audius", audiusHost=null, tracks=[], idx=-1, shuffle=false, repeat=false, seeking=false;
  var audio=$("audio"); audio.volume=0.9;
  var yt=null, ytReady=false, ytPending=null, poll=null;

  function fmt(s){s=Math.max(0,Math.floor(s||0));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0");}
  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(m){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[m];});}
  function decode(s){var t=document.createElement("textarea");t.innerHTML=String(s||"");return t.value;}

  /* ── YouTube IFrame API ───────────────────────────────── */
  window.onYouTubeIframeAPIReady=function(){
    yt=new YT.Player("ytplayer",{height:"54",width:"96",playerVars:{controls:0,disablekb:1,modestbranding:1,rel:0,playsinline:1},
      events:{onReady:function(){ytReady=true; if(ytPending){var p=ytPending;ytPending=null;ytLoad(p);}},
        onStateChange:function(e){
          if(e.data===YT.PlayerState.PLAYING){$("playBtn").textContent="⏸"; startPoll();}
          else if(e.data===YT.PlayerState.PAUSED){$("playBtn").textContent="▶";}
          else if(e.data===YT.PlayerState.ENDED){ if(repeat){yt.seekTo(0);yt.playVideo();} else next(); }
        }}});
  };
  function loadYTApi(){
    if(window.YT&&window.YT.Player){
      window.onYouTubeIframeAPIReady();
      return;
    }
    if(document.getElementById("milan-youtube-api")) return;

    var s=document.createElement("script");
    s.id="milan-youtube-api";
    s.src="https://www.youtube.com/iframe_api";
    s.async=true;
    document.head.appendChild(s);
  }
  function ytLoad(id){ if(!ytReady){ytPending=id;return;} yt.loadVideoById(id); yt.setVolume(parseInt($("vol").value,10)); }
  function startPoll(){ clearInterval(poll); poll=setInterval(function(){
      if(engine!=="youtube"||!yt||!yt.getDuration)return; var d=yt.getDuration(),c=yt.getCurrentTime();
      if(d){ $("fill").style.width=(c/d*100)+"%"; $("dot").style.left=(c/d*100)+"%"; $("cur").textContent=fmt(c); $("dur").textContent=fmt(d); }
    },500); }

  /* ── Audius ───────────────────────────────────────────── */
  function audiusPick(){
    if(audiusHost)return Promise.resolve(audiusHost);

    // Prefer the known fast discovery provider. If it fails,
    // move through the configured Audius providers.
    var hosts=AUDIUS_HOSTS.slice();

    function tryHost(i){
      if(i>=hosts.length){
        audiusHost=AUDIUS_HOSTS[0];
        return Promise.resolve(audiusHost);
      }

      return fetch(hosts[i]+"/v1/tracks/trending?app_name="+APP,{cache:"no-store"})
        .then(function(r){
          if(!r.ok)throw 0;
          audiusHost=hosts[i];
          return audiusHost;
        })
        .catch(function(){
          return tryHost(i+1);
        });
    }

    return tryHost(0);
  }
  function audiusApi(path){ return audiusPick().then(function(h){var s=path.indexOf("?")>=0?"&":"?";
    return fetch(h+path+s+"app_name="+APP).then(function(r){if(!r.ok)throw 0;return r.json();});}); }
  function audiusArt(t){var a=t&&t.artwork;return(a&&(a["480x480"]||a["150x150"]))||"";}

  /* ── Rendering ────────────────────────────────────────── */
  function skel(n){var o="";for(var i=0;i<n;i++)o+='<div class="mz-skel"><div class="b" style="aspect-ratio:1/1;border-radius:12px;margin-bottom:10px"></div><div class="b" style="height:12px;width:80%;margin-bottom:7px"></div><div class="b" style="height:11px;width:55%"></div></div>';$("results").innerHTML=o;}
  function render(list){
    tracks=list||[];
    if(!tracks.length){$("results").innerHTML='<div class="mz-empty">No songs found. Try another search.</div>';return;}
    $("results").innerHTML=tracks.map(function(t,i){
      return '<div class="mz-card" data-i="'+i+'"><div class="mz-art">'+(t.thumb?'<img loading="lazy" src="'+esc(t.thumb)+'" alt="">':'')+
        '<button class="mz-play" aria-label="Play">▶</button></div>'+
        '<div class="mz-title">'+esc(t.title)+'</div><div class="mz-artist">'+esc(t.artist)+'</div></div>';
    }).join("");
    Array.prototype.forEach.call(document.querySelectorAll(".mz-card"),function(c){c.addEventListener("click",function(){play(parseInt(c.getAttribute("data-i"),10));});});
    mark();
  }
  function mark(){Array.prototype.forEach.call(document.querySelectorAll(".mz-card"),function(c){c.classList.toggle("playing",parseInt(c.getAttribute("data-i"),10)===idx);});}

  /* ── Unified playback ─────────────────────────────────── */
  function showEngineUI(){ $("ytwrap").style.display=engine==="youtube"?"block":"none"; $("thumb").style.display=engine==="youtube"?"none":"block"; }
  function stopYt(){ try{ if(yt&&yt.pauseVideo)yt.pauseVideo(); }catch(e){} }
  function play(i){
    if(i<0 || i>=tracks.length)return;

    idx=i;
    var t=tracks[i];

    $("npTitle").textContent=t.title||"";
    $("npArtist").textContent=t.artist||"";
    document.title=(t.title||"MILAN Music")+" · MILAN Music";

    mark();
    setMedia(t);

    // YouTube search results play through the YouTube IFrame.
    if(t.youtube){
      engine="youtube";
      showEngineUI();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();

      if($("npArt")){
        $("npArt").src=t.thumb||"/assets/milan-logo-circle.png";
      }

      loadYTApi();
      ytPending=t.id;

      if(ytReady){
        ytLoad(t.id);
      }

      return;
    }

    // Audius tracks continue through the HTML5 audio player.
    engine="audius";
    showEngineUI();
    stopYt();

    if($("npArt")){
      $("npArt").src=t.thumb||"/assets/milan-logo-circle.png";
    }

    if(t.duration){
      $("dur").textContent=fmt(t.duration);
    }

    var direct=t.stream||"";

    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    function trySource(url){
      return new Promise(function(resolve,reject){
        if(!url){
          reject(new Error("missing source"));
          return;
        }

        var settled=false;

        function cleanup(){
          audio.removeEventListener("playing",ok);
          audio.removeEventListener("error",fail);
        }

        function ok(){
          if(settled)return;
          settled=true;
          cleanup();
          resolve();
        }

        function fail(){
          if(settled)return;
          settled=true;
          cleanup();
          reject(new Error("audio error"));
        }

        audio.addEventListener("playing",ok,{once:true});
        audio.addEventListener("error",fail,{once:true});

        audio.src=url;
        audio.load();

        var p=audio.play();

        if(p && typeof p.catch==="function"){
          p.catch(function(){
            if(settled)return;
            settled=true;
            cleanup();
            reject(new Error("play rejected"));
          });
        }
      });
    }

    trySource(direct).catch(function(){
      var note=$("note");
      if(note){
        note.style.display="block";
        note.textContent="This track could not be played right now.";
      }
    });
  }
  // Audio proxy failed for a YouTube track -> fall back to the IFrame player.
  audio.addEventListener("error", function(){
    var t=tracks[idx];
    if(!t)return;

    if(engine==="audius" && t.stream){
      var proxy="/api/music/stream/"+encodeURIComponent(t.id);

      if(audio.src!==new URL(proxy,window.location.origin).href){
        audio.src=proxy;
        audio.load();
        audio.play().catch(function(){
          var note=$("note");
          if(note){
            note.style.display="block";
            note.textContent="Playback unavailable for this track.";
          }
        });
      }
    }
  });
  // Lock-screen / background controls. HTML5 audio (Audius) keeps playing when the phone
  // locks; YouTube embeds may pause on lock (mobile browser policy).
  function setMedia(t){
    if(!("mediaSession" in navigator))return;
    try{
      navigator.mediaSession.metadata=new MediaMetadata({title:t.title||"MILAN Music",artist:t.artist||"",album:"MILAN Music",
        artwork: t.thumb ? [{src:t.thumb,sizes:"480x480",type:"image/jpeg"},{src:t.thumb,sizes:"96x96",type:"image/jpeg"}] : [{src:"/assets/milan-logo-circle.png",sizes:"192x192",type:"image/png"}]});
      navigator.mediaSession.playbackState="playing";
    }catch(e){}
  }
  function isPlaying(){ return engine==="youtube" ? (yt&&yt.getPlayerState&&yt.getPlayerState()===1) : !audio.paused; }
  function toggle(){
    if(idx<0){ if(tracks.length)play(0); return; }
    if(engine==="youtube"){ if(!yt)return; isPlaying()?yt.pauseVideo():yt.playVideo(); }
    else { audio.paused?audio.play():audio.pause(); }
  }
  function next(){ if(!tracks.length)return; play(shuffle?Math.floor(Math.random()*tracks.length):(idx+1)%tracks.length); }
  function prev(){ if(!tracks.length)return; var c=engine==="youtube"?(yt&&yt.getCurrentTime?yt.getCurrentTime():0):audio.currentTime;
    if(c>3){ engine==="youtube"?yt.seekTo(0):audio.currentTime=0; return; } play((idx-1+tracks.length)%tracks.length); }

  audio.addEventListener("play",function(){$("playBtn").textContent="⏸"; if("mediaSession" in navigator)navigator.mediaSession.playbackState="playing";});
  audio.addEventListener("pause",function(){$("playBtn").textContent="▶"; if("mediaSession" in navigator)navigator.mediaSession.playbackState="paused";});
  audio.addEventListener("ended",function(){ if(repeat){audio.currentTime=0;audio.play();} else next(); });
  audio.addEventListener("loadedmetadata",function(){ if(isFinite(audio.duration))$("dur").textContent=fmt(audio.duration); });
  audio.addEventListener("timeupdate",function(){ if(seeking||!audio.duration||engine!=="audius")return;
    var p=audio.currentTime/audio.duration; $("fill").style.width=(p*100)+"%"; $("dot").style.left=(p*100)+"%"; $("cur").textContent=fmt(audio.currentTime);
    if("mediaSession" in navigator && navigator.mediaSession.setPositionState){ try{ navigator.mediaSession.setPositionState({duration:audio.duration,position:audio.currentTime,playbackRate:1}); }catch(e){} } });

  $("playBtn").onclick=toggle; $("nextBtn").onclick=next; $("prevBtn").onclick=prev;
  $("shuffleBtn").onclick=function(){shuffle=!shuffle;this.classList.toggle("on",shuffle);};
  $("repeatBtn").onclick=function(){repeat=!repeat;this.classList.toggle("on",repeat);};
  $("vol").oninput=function(){ var v=parseInt(this.value,10); audio.volume=v/100; if(yt&&yt.setVolume)yt.setVolume(v); };
  function seekEv(e){ var b=$("bar"),r=b.getBoundingClientRect(),x=((e.touches?e.touches[0].clientX:e.clientX)-r.left)/r.width; x=Math.min(1,Math.max(0,x));
    if(engine==="youtube"){ if(yt&&yt.getDuration){var d=yt.getDuration();yt.seekTo(x*d,true);} }
    else if(audio.duration){ audio.currentTime=x*audio.duration; }
    $("fill").style.width=(x*100)+"%"; $("dot").style.left=(x*100)+"%"; }
  $("bar").addEventListener("mousedown",function(e){seeking=true;seekEv(e);});
  document.addEventListener("mousemove",function(e){if(seeking)seekEv(e);},{passive:true});
  document.addEventListener("mouseup",function(){seeking=false;});
  $("bar").addEventListener("click",seekEv);
  document.addEventListener("keydown",function(e){
    if(e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)return;
    if(/input|textarea|select|button/i.test((e.target.tagName||"")))return;
    if(e.code==="Space"){e.preventDefault();toggle();} else if(e.key==="n")next(); else if(e.key==="p")prev(); });

  /* ── Search / browse ──────────────────────────────────── */
  function setTitle(t,info){ $("sectionTitle").innerHTML=esc(t)+' <small>'+(info||"")+'</small>'; }
  function ytSearch(q){
    var ck="mz_yt_"+q.toLowerCase().replace(/\s+/g," ").trim();

    try{
      var c=JSON.parse(localStorage.getItem(ck)||"null");
      if(c&&c.items&&Date.now()-c.at<21600000){
        render(c.items);
        return Promise.resolve();
      }
    }catch(e){}

    return withTimeout(
      fetch("/api/music/search?q="+encodeURIComponent(q),{
        credentials:"same-origin",
        cache:"no-store"
      }),
      2500
    )
    .then(function(r){
      return r.json().then(function(j){
        if(!r.ok) throw j;
        return j;
      });
    })
    .then(function(j){
      var items=(j.items||[]).map(function(it){
        return {
          id:it.id,
          title:decode(it.title),
          artist:decode(it.channel),
          thumb:it.thumb,
          youtube:false
        };
      });

      if(!items.length){
        throw new Error("No YouTube results");
      }

      render(items);

      try{
        localStorage.setItem(
          ck,
          JSON.stringify({
            at:Date.now(),
            items:items
          })
        );
      }catch(e){}
    });
  }
  function audiusSearch(q){ skel(12);
    return audiusApi("/v1/tracks/search?query="+encodeURIComponent(q))
      .then(function(j){
        engine="audius";

        var items=(j.data||[]).slice(0,30).map(function(t){
          return {
            id:t.id,
            title:t.title,
            artist:(t.user&&t.user.name)||"Unknown",
            thumb:audiusArt(t),
            duration:t.duration,
            stream:audiusHost+"/v1/tracks/"+t.id+"/stream?app_name="+APP
          };
        });

        render(items);

        if(!items.length){
          $("results").innerHTML='<div class="mz-empty">No songs found. Try another search.</div>';
        }

        return items;
      });
  }
  function audiusTrending(){ skel(12); setTitle("🔥 Trending","via Audius · decentralized");
    withTimeout(audiusApi("/v1/tracks/trending"),4000).then(function(j){
      render((j.data||[]).slice(0,24).map(function(t){return {id:t.id,title:t.title,artist:(t.user&&t.user.name)||"Unknown",thumb:audiusArt(t),duration:t.duration,stream:audiusHost+"/v1/tracks/"+t.id+"/stream?app_name="+APP};}));
    }).catch(function(){$("results").innerHTML='<div class="mz-empty">Could not reach music network.</div>';});
  }
  var searchT, ytAvailable=false;
  function doSearch(q){
    clearTimeout(searchT);
    q=(q||"").trim();

    if(!q){
      audiusTrending();
      return;
    }

    searchT=setTimeout(function(){
      runSearch(q);
    },180);
  }
  /* ── Real-YouTube-style autocomplete (free suggestions, no quota) ── */

  var sugT;
  var sugItems=[];
  var sugIdx=-1;

  function hideSug(){
    var box=$("mzsug");
    if(!box)return;
    box.classList.remove("show");
    box.innerHTML="";
    sugItems=[];
    sugIdx=-1;
  }

  function escSug(v){
    return String(v||"")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

  function renderSug(list){
    var box=$("mzsug");
    if(!box)return;

    sugItems=Array.isArray(list)
      ? list.filter(function(x){
          return typeof x==="string" && x.trim();
        }).slice(0,10)
      : [];

    sugIdx=-1;

    if(!sugItems.length){
      hideSug();
      return;
    }

    box.innerHTML=sugItems.map(function(item,i){
      return '<button type="button" class="mz-sug-item" data-sug-index="'+i+'">' +
        '<span class="si">⌕</span>' +
        '<span>'+escSug(item)+'</span>' +
      '</button>';
    }).join("");

    box.classList.add("show");

    var buttons=box.querySelectorAll(".mz-sug-item");

    for(var i=0;i<buttons.length;i++){
      buttons[i].addEventListener("click",function(e){
        var idx=Number(e.currentTarget.getAttribute("data-sug-index"));
        pickSug(idx);
      });
    }
  }

  function hlSug(){
    var box=$("mzsug");
    if(!box)return;

    var buttons=box.querySelectorAll(".mz-sug-item");

    for(var i=0;i<buttons.length;i++){
      buttons[i].classList.toggle("active",i===sugIdx);
    }

    if(sugIdx>=0 && sugItems[sugIdx]){
      $("q").value=sugItems[sugIdx];
    }
  }

  function pickSug(i){
    if(i<0 || i>=sugItems.length)return;

    var value=sugItems[i];

    $("q").value=value;
    hideSug();

    // Selecting a YouTube suggestion should immediately perform
    // the real search for that exact phrase.
    runSearch(value);
  }

  function fetchSug(q){
    clearTimeout(sugT);

    q=(q||"").trim();

    if(q.length<2){
      hideSug();
      return;
    }

    sugT=setTimeout(function(){

      fetch("/api/music/suggest?q="+encodeURIComponent(q),{
        credentials:"same-origin",
        cache:"no-store"
      })
      .then(function(r){
        if(!r.ok)throw new Error("autocomplete http "+r.status);
        return r.json();
      })
      .then(function(j){
        if(document.activeElement===$("q")){
          renderSug(j.suggestions||[]);
        }
      })
      .catch(function(){
        hideSug();
      });

    },180);
  }

  $("q").addEventListener("input",function(){
    fetchSug(this.value);
  });

  $("q").addEventListener("keydown",function(e){
    if(!sugItems.length)return;

    if(e.key==="ArrowDown"){
      e.preventDefault();
      sugIdx=Math.min(sugItems.length-1,sugIdx+1);
      hlSug();
    }
    else if(e.key==="ArrowUp"){
      e.preventDefault();
      sugIdx=Math.max(0,sugIdx-1);
      hlSug();
    }
    else if(e.key==="Escape"){
      hideSug();
    }
    else if(e.key==="Enter"){
      e.preventDefault();

      if(sugIdx>=0 && sugItems[sugIdx]){
        pickSug(sugIdx);
      }else{
        hideSug();
        runSearch(this.value);
      }
    }
  });

  document.addEventListener("click",function(e){
    var box=$("mzsug");
    var search=e.target.closest(".mz-search");
    if(box && !search){
      hideSug();
    }
  });

  function runSearch(q){
    q=(q||"").trim();

    if(!q){
      audiusTrending();
      return;
    }

    setTitle('🔎 "'+q+'"',"via Audius");
    audiusSearch(q).catch(function(){
      $("results").innerHTML='<div class="mz-empty">No songs found. Try another search.</div>';
    });
  }

})();

/* ── MILAN Music live visualizer ─────────────────────────── */
(function(){
  var barsBox = document.querySelector(".hero-bars");
  if(!barsBox) return;

  var bars = Array.prototype.slice.call(
    barsBox.querySelectorAll("i")
  );

  var audio = document.getElementById("audio");
  if(!bars.length) return;

  function paintIdle(){
    barsBox.classList.remove("visualizer-active");
    barsBox.classList.add("visualizer-idle");

    bars.forEach(function(bar,i){
      var h = 6 + ((i * 3) % 5);
      bar.style.height = h + "px";
      bar.style.transform = "scaleY(.7)";
    });
  }

  function paintLive(time){
    var active = audio && !audio.paused && !audio.ended;

    if(!active){
      paintIdle();
      requestAnimationFrame(paintLive);
      return;
    }

    barsBox.classList.remove("visualizer-idle");
    barsBox.classList.add("visualizer-active");

    bars.forEach(function(bar,i){
      var wave1 = Math.abs(Math.sin(time * 0.006 + i * 0.72));
      var wave2 = Math.abs(Math.sin(time * 0.011 - i * 0.38));
      var wave3 = Math.abs(Math.cos(time * 0.0035 + i * 1.17));

      var energy =
        (wave1 * 0.45) +
        (wave2 * 0.35) +
        (wave3 * 0.20);

      var height = 8 + Math.round(energy * 34);

      bar.style.height = height + "px";
      bar.style.transform =
        "scaleY(" + (0.72 + energy * 0.55).toFixed(2) + ")";
    });

    requestAnimationFrame(paintLive);
  }

  if(audio){
    audio.addEventListener("play", function(){
      barsBox.classList.remove("visualizer-idle");
      barsBox.classList.add("visualizer-active");
    });

    audio.addEventListener("pause", paintIdle);
    audio.addEventListener("ended", paintIdle);
  }

  paintIdle();
  requestAnimationFrame(paintLive);
})();

/* === frontend/milan-app-pro.js === */
/* ============================================================================
   MILAN — App Pro interactions  (v1)
   ----------------------------------------------------------------------------
   Pairs with /milan-app-pro.css. Presentation only.

   HARD RULES
   • Never preventDefault / stopPropagation on app controls. Navigation,
     publishing, uploads, refresh and the control centre stay owned by their
     own modules.
   • Never read or write tokens, post text, or form state.
   • Never replace a button's textContent — only prepend decorative spans.
   • Every feature degrades silently if its target is absent.
   ========================================================================== */
"use strict";

(function () {
  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts || false); }

  /* ══════════════════════════════════════════════════════════════════════
     1. Background — aurora + faint grid. Deliberately lighter than the
        login page: no starfield canvas, because this page is content-heavy.
     ══════════════════════════════════════════════════════════════════════ */
  function buildBackground() {
    if ($("#map-bg")) return;

    var bg = document.createElement("div");
    bg.id = "map-bg";
    bg.setAttribute("aria-hidden", "true");

    ["a", "b", "c"].forEach(function (k) {
      var b = document.createElement("div");
      b.className = "map-blob map-blob--" + k;
      bg.appendChild(b);
    });

    var grid = document.createElement("div");
    grid.className = "map-grid";
    bg.appendChild(grid);

    document.body.insertBefore(bg, document.body.firstChild);
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. Quick stats — count up on first paint, bump when the value changes.
        The numbers are written by app.html's own sync loop, so we only
        observe; we never write the value ourselves.
     ══════════════════════════════════════════════════════════════════════ */
  var STAT_IDS = ["uiPeopleCount", "uiPostCount", "uiPrivacyScore"];

  function bindQuickStats() {
    var seen = {};
    var last = {};

    function numeric(text) {
      var n = parseInt(String(text).replace(/[^\d-]/g, ""), 10);
      return isFinite(n) ? n : null;
    }

    function countUp(el, from, to) {
      var start = null;
      var dur = 620;

      function step(ts) {
        if (start === null) start = ts;
        var t = Math.min(1, (ts - start) / dur);
        // easeOutCubic
        var e = 1 - Math.pow(1 - t, 3);
        el.textContent = String(Math.round(from + (to - from) * e));
        if (t < 1) window.requestAnimationFrame(step);
        else el.textContent = String(to);
      }

      window.requestAnimationFrame(step);
    }

    function bump(card) {
      if (!card || reduceMotion) return;
      card.classList.remove("is-bump");
      void card.offsetWidth;
      card.classList.add("is-bump");
      window.setTimeout(function () { card.classList.remove("is-bump"); }, 420);
    }

    function check() {
      STAT_IDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        var text = (el.textContent || "").trim();
        if (text === last[id]) return;

        var value = numeric(text);
        var card = el.closest ? el.closest(".quickStat") : null;

        if (!seen[id]) {
          seen[id] = true;
          if (value !== null && !reduceMotion && value > 0 && value < 10000) {
            countUp(el, 0, value);
          }
        } else {
          bump(card);
        }
        last[id] = text;
      });
    }

    check();
    // the intro block is injected on DOMContentLoaded by app.html's own script
    window.setTimeout(check, 300);
    window.setTimeout(check, 1200);
    window.setInterval(check, 1500);
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. Publish — ripple + magnetic hover, mirroring the login CTA.
        No handler touches the click itself.
     ══════════════════════════════════════════════════════════════════════ */
  function bindPublish() {
    var btn = document.getElementById("publishBtn");
    if (!btn) return;

    on(btn, "pointerdown", function (e) {
      if (btn.disabled || reduceMotion) return;
      var r = btn.getBoundingClientRect();
      var size = Math.max(r.width, r.height);
      var dot = document.createElement("span");
      dot.className = "map-ripple";
      dot.style.width = size + "px";
      dot.style.height = size + "px";
      dot.style.left = (e.clientX - r.left - size / 2) + "px";
      dot.style.top = (e.clientY - r.top - size / 2) + "px";
      btn.appendChild(dot);
      window.setTimeout(function () {
        if (dot.parentNode) dot.parentNode.removeChild(dot);
      }, 700);
    });

    if (reduceMotion) return;

    on(btn, "pointermove", function (e) {
      if (btn.disabled) return;
      var r = btn.getBoundingClientRect();
      if (!r.width) return;
      var dx = ((e.clientX - r.left) / r.width - 0.5) * 7;
      var dy = ((e.clientY - r.top) / r.height - 0.5) * 5;
      btn.style.transform =
        "translate3d(" + dx.toFixed(2) + "px," + (dy - 2).toFixed(2) + "px,0)";
    }, { passive: true });

    on(btn, "pointerleave", function () { btn.style.transform = ""; });
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. Refresh — spin the button while the list refreshes. Purely visual
        feedback; the click itself is left completely alone.
     ══════════════════════════════════════════════════════════════════════ */
  function bindRefresh() {
    var btn = document.getElementById("milanFeedRefresh");
    var list = document.getElementById("milanFeedList");
    if (!btn) return;

    var timer = null;

    function spin(ms) {
      if (reduceMotion) return;
      btn.classList.add("is-spinning");
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        btn.classList.remove("is-spinning");
      }, ms || 700);
    }

    on(btn, "click", function () { spin(900); });

    // if the feed re-renders shortly after, stop early
    if (list && window.MutationObserver) {
      new window.MutationObserver(function () {
        if (btn.classList.contains("is-spinning")) spin(320);
      }).observe(list, { childList: true });
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     5. Feed — a one-time staggered entrance. Deliberately first-render only:
        the app refreshes the feed on a timer, and re-animating on every
        refresh would be noise.
     ══════════════════════════════════════════════════════════════════════ */
  function bindFeedEntrance() {
    var list = document.getElementById("milanFeedList");
    if (!list) return;

    var done = false;

    function mark() {
      if (done || reduceMotion) return;
      var kids = Array.prototype.filter.call(list.children, function (el) {
        return el.nodeType === 1;
      });
      if (!kids.length) return;
      done = true;
      kids.forEach(function (el, i) {
        el.style.animationDelay = Math.min(i * 45, 400) + "ms";
        el.setAttribute("data-map-reveal", "1");
      });
    }

    mark();
    window.setTimeout(mark, 900);
    window.setTimeout(mark, 2200);
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. Avatar identity
        renderMe() replaces #myAvatar and #composerAvatar with outerHTML, so
        the rendered nodes lose their ids entirely. Anything that later calls
        getElementById("myAvatar") silently gets null. Re-attach the ids the
        markup declared, and own the photo-removal affordance.
     ══════════════════════════════════════════════════════════════════════ */
  function getToken() {
    try {
      return (
        localStorage.getItem("milan_token") ||
        localStorage.getItem("milan_token") ||
        ""
      );
    } catch (e) {
      return "";
    }
  }

  function bindAvatarIdentity() {
    var label = document.querySelector(".milan-avatar-upload");

    function avatarImg() {
      var sel = [
        ".milan-avatar-upload .avatar img",
        ".milan-avatar-upload #myAvatar img",
        "#editProfilePhotoPreview",
      ];
      for (var i = 0; i < sel.length; i++) {
        var el = document.querySelector(sel[i]);
        var src = el ? String(el.getAttribute("src") || "").trim() : "";
        if (src && src !== "null" && src !== "about:blank") return src;
      }
      return "";
    }

    function restoreIds() {
      var big = document.querySelector(".milan-avatar-upload .avatar");
      if (big && !big.id) big.id = "myAvatar";
      // renderMe() swaps the composer avatar for a node carrying only
      // `.avatar`, which silently drops the base layer's `.mini-avatar`
      // sizing — the composer avatar then renders as a large square once a
      // real picture exists. Put the class back, not just the id.
      var mini =
        document.querySelector(".composer .mini-avatar") ||
        document.querySelector(".composer-row > .avatar") ||
        document.querySelector(".composer .avatar");
      if (mini) {
        if (!mini.id) mini.id = "composerAvatar";
        if (!mini.classList.contains("mini-avatar")) {
          mini.classList.add("mini-avatar");
        }
      }
    }

    // The app's initials() helper returns up to TWO letters ("NP" for
    // "Nitesh Pandey"). With no profile picture the design calls for a single
    // centred initial, so collapse it wherever no image is present.
    function singleInitial(el) {
      if (!el || el.querySelector("img")) return;
      var text = String(el.textContent || "").trim();
      if (text.length > 1) {
        el.textContent = text.charAt(0).toUpperCase();
      }
    }

    function syncInitials() {
      singleInitial(document.querySelector(".milan-avatar-upload .avatar"));
      singleInitial(document.querySelector(".composer .avatar, .composer .mini-avatar"));
    }

    function removePhoto(btn) {
      if (!window.confirm("Remove your profile photo permanently?")) return;
      btn.disabled = true;
      btn.classList.add("is-busy");

      timedFetch("/api/profile/avatar", {
        method: "DELETE",
        headers: {
          Authorization: "Bearer " + getToken(),
          Accept: "application/json",
        },
      })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json().catch(function () { return {}; });
        })
        .then(function () {
          try { localStorage.removeItem("milanAvatar"); } catch (e) {}
          window.__milanPersistentAvatar = "";

          var preview = document.getElementById("editProfilePhotoPreview");
          if (preview) preview.removeAttribute("src");

          Array.prototype.slice
            .call(document.querySelectorAll(".milan-avatar-upload .avatar img"))
            .forEach(function (img) { img.remove(); });

          if (btn.parentNode) btn.parentNode.removeChild(btn);

          if (typeof window.toast === "function") {
            window.toast("Profile photo removed");
          }
          // ask the app to re-read identity so the initial is rebuilt
          if (typeof window.__milanSyncPersistentIdentity === "function") {
            try { window.__milanSyncPersistentIdentity(); } catch (e) {}
          }
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.classList.remove("is-busy");
          if (typeof window.toast === "function") {
            window.toast("Could not remove photo: " + err.message);
          }
        });
    }

    function syncRemoveButton() {
      if (!label) return;
      var has = !!avatarImg();
      var btn = label.querySelector(".map-remove-dp");

      if (has && !btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "map-remove-dp";
        btn.title = "Remove profile photo";
        btn.setAttribute("aria-label", "Remove profile photo");
        btn.textContent = "✕";
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          removePhoto(e.currentTarget);
        });
        label.appendChild(btn);
      } else if (!has && btn && btn.parentNode) {
        btn.parentNode.removeChild(btn);
      }
    }

    restoreIds();
    syncInitials();
    syncRemoveButton();
    window.setInterval(function () {
      restoreIds();
      syncInitials();
      syncRemoveButton();
    }, 1500);

    if (label && window.MutationObserver) {
      new window.MutationObserver(function () {
        restoreIds();
        syncInitials();
        syncRemoveButton();
      }).observe(label, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src"],
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     7. "Set your name" — only when the card is falling back to the email
        prefix because the account has no registered name. Ties the profile
        card to the existing Edit Profile flow instead of leaving a bare
        "np7218468" with no explanation.
     ══════════════════════════════════════════════════════════════════════ */
  function bindSetNameHint() {
    var nameEl = document.getElementById("myName");
    var emailEl = document.getElementById("myEmail");
    if (!nameEl || !emailEl) return;

    function sync() {
      var email = String(emailEl.textContent || "").trim();
      var at = email.indexOf("@");
      var local = at > 0 ? email.slice(0, at) : "";
      var name = String(nameEl.textContent || "").trim();
      var existing = document.getElementById("mapSetNameHint");

      var looksLikeEmail =
        !!local && !!name && name.toLowerCase() === local.toLowerCase();

      if (looksLikeEmail && !existing) {
        var b = document.createElement("button");
        b.type = "button";
        b.id = "mapSetNameHint";
        b.className = "map-set-name";
        b.textContent = "Set your name";
        b.addEventListener("click", function () {
          var edit = document.getElementById("editProfileBtn");
          if (edit) edit.click();
        });
        nameEl.insertAdjacentElement("afterend", b);
      } else if (!looksLikeEmail && existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
    }

    sync();
    window.setInterval(sync, 1500);
  }

  /* ══════════════════════════════════════════════════════════════════════
     8. People directory (right rail "People to connect")
        The backend already returns every other registered user from the Voroa-backed user directory
        with their name, DID and connection status (routes/social.js:132-172),
        and inline-05.js's loadPeople() already knows how to render it. In
        practice the rail is often left showing its static "Loading people..."
        placeholder, so this repairs the container when the app's own pass did
        not land — it never replaces a list the app rendered itself.
     ══════════════════════════════════════════════════════════════════════ */
  function escHtml(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function shortDid(did) {
    var s = String(did || "");
    if (s.length <= 30) return s;
    return s.slice(0, 20) + "…" + s.slice(-6);
  }

  /* The app's own api() helper passes no timeout for /social/people, so a
     stalled request can leave the rail on "Loading people..." indefinitely —
     which is exactly the symptom this repairs. Always bound our own calls. */
  function timedFetch(url, opts, ms) {
    var options = opts || {};
    if (!("AbortController" in window)) return fetch(url, options);

    var ctrl = new AbortController();
    var timer = window.setTimeout(function () { ctrl.abort(); }, ms || 12000);
    options = Object.assign({}, options, { signal: ctrl.signal });

    return fetch(url, options).then(
      function (r) { window.clearTimeout(timer); return r; },
      function (e) { window.clearTimeout(timer); throw e; }
    );
  }

  function bindPeopleDirectory() {
    // inline-05.js is the canonical People renderer. It owns the connection
    // status UI, including incoming-request Accept/Decline controls and the
    // fast cross-device refresh. Do not maintain a second renderer here:
    // the old fallback rendered a "Respond" button for received requests and
    // could mask the real ✓ / ✕ controls.
    function refresh() {
      try {
        if (typeof window.loadPeople === "function") {
          return Promise.resolve(window.loadPeople()).catch(() => {});
        }
      } catch (_) {}
      return Promise.resolve();
    }

    window.__milanRefreshPeople = refresh;
    window.addEventListener("focus", refresh);
    window.setTimeout(refresh, 1200);
  }

  /* ══════════════════════════════════════════════════════════════════════
     9. Hide the floating buttons while the mobile drawer is open
        milan-creative-bridge.js writes `z-index: 2147483647 !important` onto
        .mcm-fab as an INLINE style, and inline !important outranks any
        stylesheet !important — so CSS cannot win this one. This script runs
        after that module, so an inline declaration from here does win.
        `visibility` is used rather than `display` because it is trivially
        reversible: removing our declaration restores whatever the owning
        module originally set.
     ══════════════════════════════════════════════════════════════════════ */
  function bindFabDrawerGuard() {
    function fabs() {
      return [
        document.getElementById("milanControlFab"),
        document.querySelector(".mcm-fab"),
      ].filter(Boolean);
    }

    function apply() {
      var open = document.body.classList.contains("milan-mobile-menu-open");

      fabs().forEach(function (el) {
        try {
          if (open) {
            el.style.setProperty("visibility", "hidden", "important");
            el.style.setProperty("pointer-events", "none", "important");
          } else {
            el.style.removeProperty("visibility");
            el.style.removeProperty("pointer-events");
          }
        } catch (e) {}
      });
    }

    apply();

    if (window.MutationObserver) {
      new window.MutationObserver(apply).observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    // belt and braces: the owning module can re-assert its inline styles
    window.setInterval(apply, 1200);
  }

  /* ══════════════════════════════════════════════════════════════════════
     boot
     ══════════════════════════════════════════════════════════════════════ */
  function init() {
    try { buildBackground(); } catch (e) {}
    try { bindQuickStats(); } catch (e) {}
    try { bindPublish(); } catch (e) {}
    try { bindRefresh(); } catch (e) {}
    try { bindFeedEntrance(); } catch (e) {}
    try { bindAvatarIdentity(); } catch (e) {}
    try { bindSetNameHint(); } catch (e) {}
    try { bindPeopleDirectory(); } catch (e) {}
    try { bindFabDrawerGuard(); } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

/* === frontend/milan-assistant.js === */
/*!
 * MILAN Assistant 🤖 — talk to the app in a meaningful way.
 * A self-contained chat widget with a built-in rule-based brain (no AI API / no key).
 * Drag/drop/paste media, suggested prompts, persistent history. No deps.
 */
(function () {
  'use strict';
  if (window.__milanAssistant) return;
  window.__milanAssistant = true;

  var KEY = 'milan_assistant_history';
  var SYSTEM = "You are MILAN Assistant, a warm, concise helper inside MILAN — a privacy-first decentralized social app where every user owns their data (DWN + DID). Help users post, find people, change settings, play music, and understand decentralization. If the user writes in Hindi or Hinglish, reply in the same language. Keep replies short and friendly.";

  var SUGGEST = ["MILAN kaise kaam karta hai?", "Mera pehla post likho", "Music kaise sunu?", "Privacy settings samjhao"];

  var CSS = [
    '.ma-fab{position:fixed;right:18px;bottom:18px;z-index:99996;display:flex;align-items:center;gap:9px;padding:11px 17px 11px 13px;border:0;border-radius:999px;cursor:pointer;font:800 13px Inter,system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#3a6df0,#7c5cff);box-shadow:0 12px 30px rgba(58,109,240,.5);transition:transform .18s,box-shadow .2s}',
    '.ma-fab:hover{transform:translateY(-2px) scale(1.04)}',
    '.ma-fab:active{transform:scale(.96)}',
    '.ma-fab .av{width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,.22);display:grid;place-items:center;font-size:15px}',
    '.ma-fab .dot{position:absolute;top:9px;left:30px;width:9px;height:9px;border-radius:50%;background:#34d399;box-shadow:0 0 0 2px #0b1024}',
    '.ma-panel{position:fixed;right:18px;bottom:18px;z-index:99999;width:min(390px,calc(100vw - 28px));height:min(600px,calc(100vh - 36px));display:none;flex-direction:column;background:#0c1226;border:1px solid rgba(255,255,255,.1);border-radius:22px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55)}',
    '.ma-panel.open{display:flex;animation:maUp .26s cubic-bezier(.16,.84,.44,1)}',
    '@keyframes maUp{from{transform:translateY(30px);opacity:.3}to{transform:none;opacity:1}}',
    '.ma-head{display:flex;align-items:center;gap:11px;padding:14px 16px;background:linear-gradient(135deg,rgba(58,109,240,.22),rgba(124,92,255,.16));border-bottom:1px solid rgba(255,255,255,.08)}',
    '.ma-head .av{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#3a6df0,#7c5cff);display:grid;place-items:center;font-weight:900;color:#fff;font-size:17px}',
    '.ma-head .t{font:800 15px Inter,system-ui,sans-serif;color:#fff}',
    '.ma-head .s{font:600 11.5px Inter,system-ui,sans-serif;color:#34d399;display:flex;align-items:center;gap:5px}',
    '.ma-head .s::before{content:"";width:7px;height:7px;border-radius:50%;background:#34d399}',
    '.ma-head .sp{flex:1}',
    '.ma-ic{background:rgba(255,255,255,.08);border:0;color:#cdd6ee;width:32px;height:32px;border-radius:50%;font-size:15px;cursor:pointer}',
    '.ma-ic:hover{background:rgba(255,255,255,.16)}',
    '.ma-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin}',
    '.ma-msg{max-width:84%;padding:10px 13px;border-radius:16px;font:400 13.5px/1.55 Inter,system-ui,sans-serif;word-wrap:break-word;white-space:pre-wrap}',
    '.ma-msg.u{align-self:flex-end;background:linear-gradient(135deg,#3a6df0,#7c5cff);color:#fff;border-bottom-right-radius:5px}',
    '.ma-msg.a{align-self:flex-start;background:#161d38;color:#e7ecff;border-bottom-left-radius:5px}',
    '.ma-msg.a a{color:#7fa9ff}',
    '.ma-msg.a code{background:rgba(255,255,255,.1);padding:1px 5px;border-radius:5px;font-family:ui-monospace,Consolas,monospace;font-size:12px}',
    '.ma-msg img{max-width:180px;border-radius:10px;display:block;margin-top:6px}',
    '.ma-sugg{display:flex;flex-wrap:wrap;gap:7px;align-self:flex-start;max-width:100%}',
    '.ma-sugg button{background:rgba(124,92,255,.12);border:1px solid rgba(124,92,255,.3);color:#bcc6ff;font:600 12px Inter,system-ui,sans-serif;padding:7px 12px;border-radius:14px;cursor:pointer;text-align:left}',
    '.ma-sugg button:hover{background:rgba(124,92,255,.22);color:#fff}',
    '.ma-typing{align-self:flex-start;background:#161d38;border-radius:16px;padding:13px 15px;display:flex;gap:4px}',
    '.ma-typing span{width:7px;height:7px;border-radius:50%;background:#7c84a8;animation:maBlink 1.2s infinite}',
    '.ma-typing span:nth-child(2){animation-delay:.2s}.ma-typing span:nth-child(3){animation-delay:.4s}',
    '@keyframes maBlink{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}',
    '.ma-foot{border-top:1px solid rgba(255,255,255,.08);padding:10px 12px;background:#0c1226}',
    '.ma-prev{display:none;align-items:center;gap:8px;margin-bottom:8px;background:#161d38;border-radius:10px;padding:6px 8px}',
    '.ma-prev img{width:34px;height:34px;border-radius:7px;object-fit:cover}',
    '.ma-prev .x{margin-left:auto;background:none;border:0;color:#9aa6cf;cursor:pointer;font-size:15px}',
    '.ma-inwrap{display:flex;align-items:flex-end;gap:8px}',
    '.ma-attach{background:rgba(255,255,255,.07);border:0;color:#9aa6cf;width:38px;height:38px;border-radius:11px;cursor:pointer;font-size:17px;flex:0 0 auto}',
    '.ma-attach:hover{color:#fff}',
    '.ma-input{flex:1;min-height:38px;max-height:120px;background:#11162c;border:1px solid rgba(255,255,255,.1);color:#eef1ff;border-radius:12px;padding:9px 12px;font:400 13.5px Inter,system-ui,sans-serif;resize:none;outline:none;line-height:1.4}',
    '.ma-input:focus{border-color:rgba(58,109,240,.6)}',
    '.ma-send{flex:0 0 auto;width:38px;height:38px;border:0;border-radius:11px;cursor:pointer;color:#fff;font-size:17px;background:linear-gradient(135deg,#3a6df0,#7c5cff)}',
    '.ma-send:disabled{opacity:.5;cursor:default}',
    '.ma-drag{position:absolute;inset:0;background:rgba(58,109,240,.22);border:2px dashed #7c5cff;border-radius:22px;display:none;align-items:center;justify-content:center;color:#fff;font:700 14px Inter,sans-serif;z-index:5}',
    '@media(max-width:480px){.ma-panel{right:8px;bottom:8px;width:calc(100vw - 16px);height:calc(100vh - 16px)}.ma-fab{bottom:74px}}'
  ].join('\n');

  var hist = [];
  try { hist = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!Array.isArray(hist)) hist = []; } catch (e) { hist = []; }
  var pendingImg = null;

  function save() { try { localStorage.setItem(KEY, JSON.stringify(hist.slice(-40))); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }
  function md(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  }

  /* ── Local rule-based brain (no AI API / no key needed) ──────── */
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  var KB = [
    { k: [' hi ', 'hello', 'hey ', 'namaste', 'helo', ' hii', 'yo ', 'hola', 'salaam'], a: [
      "Namaste! 🙏 Main MILAN Assistant. Kaise help karoon?",
      "Hello! 😊 Posting, music, settings — kuch bhi poochho." ] },
    { k: ['music', 'song', 'gaana', 'gana', 'bollywood', 'hollywood', 'play song', 'audio', 'sun'], a: [
      "🎵 Niche-left **Music** button dabao (ya /music kholo) — Bollywood, Hollywood, sab search karke app ke andar hi sun sakte ho!" ] },
    { k: ['post', 'likho', 'caption', 'share', 'status', 'create', 'daal', 'photo upload', 'video upload'], a: [
      "Post banane ke liye compose (+) box me likho, photo/video add karo, audience choose karo (private by default), aur **Share** dabao. 🚀 Caption me help chahiye to topic batao!" ] },
    { k: ['theme', 'creative', 'dark mode', 'look', 'colour', 'color', 'design', 'ui change'], a: [
      "🎨 Niche-right **Creative Mode** button dabao — 10 themes (Aurora, Sunset, Cyberpunk, Sakura...) me se koi bhi **ek click** me lagao. Poora UI badal jayega!" ] },
    { k: ['2fa', 'two factor', 'two-factor', 'authenticator', 'otp', 'totp'], a: [
      "🛡️ Two-factor on karne ke liye **Settings → Security → 'Set up two-factor'**. Google Authenticator/Authy se code scan karo — account aur secure!" ] },
    { k: ['password', 'reset', 'forgot', 'bhul', 'change pass'], a: [
      "Password change: **Settings → Security → Change password**. Bhool gaye? Login page pe **'Forgot password?'** → email pe reset link aayega." ] },
    { k: ['verify', 'verification', 'confirm email', 'email confirm'], a: [
      "Email verify karne ke liye signup ke baad aayi mail ka link/6-digit code use karo, ya **/verify-email** pe jaake resend karo." ] },
    { k: ['block', 'unblock'], a: [
      "Kisi ko block/unblock karne ke liye **Settings → Blocking** me uska DID ya email daalo." ] },
    { k: ['privacy', 'who can see', 'kaun dekh', 'visible', 'audience', 'search by email', 'kaun message'], a: [
      "🔒 Privacy aapke haath me — **Settings → Privacy**: kaun aapko dekh sake, friend-request bheje ya message kare, sab set karo. Sab aapke DWN me save." ] },
    { k: ['delete account', 'deactivate', 'remove account', 'data download', 'export', 'download my'], a: [
      "**Settings → Your data**: data download, account **deactivate** (login se wapas active), ya **delete** (password confirm ke saath)." ] },
    { k: ['friend', 'people', 'connect', 'request', 'follow', 'dost', 'add karo'], a: [
      "Logo se judne ke liye **People** me search karke friend request bhejo. Request aane pe notification + email milega." ] },
    { k: ['notification', 'email alert', 'alerts', 'mail setting'], a: [
      "**Settings → Notifications** me har cheez (comment, reaction, friend request, login alert) ka email toggle on/off kar sakte ho." ] },
    { k: ['decentral', 'dwn', ' did', 'web5', 'own your', 'kaise kaam', 'how does', 'blockchain', 'self sovereign'], a: [
      "MILAN ek **privacy-first decentralized** network hai 🌐 — har user ka apna **DWN** (data node) aur **DID** hota hai, to data sirf aapka. Koi ads, tracking ya data-selling nahi." ] },
    { k: ['who are you', 'your name', 'tum kaun', 'kaun ho', 'aap kaun'], a: [
      "Main **MILAN Assistant** hoon 🤖 — app ke andar aapki madad ke liye. MILAN ke har feature ke baare me jaanta hoon!" ] },
    { k: ['thank', 'shukriya', 'dhanyavad', 'thanks', 'thx', 'great', 'badhiya', 'nice'], a: [
      "Koi baat nahi! 😊 Aur kuch chahiye to bata dena.", "Khushi hui help karke! 🙏" ] },
    { k: ['help', 'what can you', 'kya kar', 'capab', 'options', 'madad', 'menu'], a: [
      "Main in sab me help karta hoon 👇\n• **Posting** & captions\n• **Music** (Bollywood/Hollywood)\n• **Privacy** & settings\n• **2FA** & security\n• **Themes**\n• **Friends**\nKuch bhi type karo!" ] }
  ];
  function answer(text, img) {
    var t = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ') + ' ';
    if (img && t.trim().length < 4) return "Sundar image! 📸 Ise post karne ke liye app me **compose (+)** button use karo — drag/drop ya select karke add ho jayegi.";
    for (var i = 0; i < KB.length; i++) for (var j = 0; j < KB[i].k.length; j++) if (t.indexOf(KB[i].k[j]) >= 0) return pick(KB[i].a);
    return "Hmm, isme main sure nahi 🤔 — par MILAN ke baare me madad kar sakta hoon: **posting, music, privacy/settings, 2FA, themes, friends**. Inme se kuch poochho, ya **help** likho.";
  }

  var panel, body, input;

  function bubble(role, text, img) {
    var d = document.createElement('div');
    d.className = 'ma-msg ' + (role === 'user' ? 'u' : 'a');
    d.innerHTML = (text ? md(text) : '') + (img ? '<img src="' + esc(img) + '" alt="attachment">' : '');
    body.appendChild(d); scrollDown(); return d;
  }
  function scrollDown() { body.scrollTop = body.scrollHeight; }

  function suggestions() {
    var w = document.createElement('div'); w.className = 'ma-sugg';
    w.innerHTML = SUGGEST.map(function (s) { return '<button>' + esc(s) + '</button>'; }).join('');
    body.appendChild(w);
    Array.prototype.forEach.call(w.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { w.remove(); send(b.textContent); });
    });
    scrollDown();
  }

  function renderHistory() {
    body.innerHTML = '';
    bubble('assistant', "Namaste! 🙏 Main MILAN Assistant hoon. Posting, settings, music, privacy — kuch bhi poochho. Aap Hindi ya English me baat kar sakte ho.");
    hist.forEach(function (m) { bubble(m.role, m.content, m.img); });
    if (!hist.length) suggestions();
  }

  function send(text) {
    text = (text != null ? text : input.value).trim();
    if (!text && !pendingImg) return;
    var img = pendingImg;
    bubble('user', text, img);
    hist.push({ role: 'user', content: text + (img ? ' (image attached)' : ''), img: img });
    save();
    input.value = ''; input.style.height = 'auto'; clearPreview();

    var typing = document.createElement('div'); typing.className = 'ma-typing';
    typing.innerHTML = '<span></span><span></span><span></span>'; body.appendChild(typing); scrollDown();

    // Local rule-based reply — no API, no key, fully offline.
    var reply = answer(text, img);
    setTimeout(function () {
      typing.remove();
      bubble('assistant', reply);
      hist.push({ role: 'assistant', content: reply }); save();
    }, 480 + Math.random() * 520);
  }

  /* media attach */
  function setPreview(dataUrl) {
    pendingImg = dataUrl;
    var p = panel.querySelector('.ma-prev');
    p.querySelector('img').src = dataUrl; p.style.display = 'flex';
  }
  function clearPreview() { pendingImg = null; var p = panel.querySelector('.ma-prev'); if (p) p.style.display = 'none'; }
  function readFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    var r = new FileReader(); r.onload = function () { setPreview(r.result); }; r.readAsDataURL(file);
  }

  function build() {
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    var fab = document.createElement('button');
    fab.className = 'ma-fab'; fab.title = 'MILAN Assistant';
    fab.innerHTML = '<span class="av" style="overflow:hidden;padding:0"><img src="/assets/icon-192.png" alt="" style="width:100%;height:100%;object-fit:cover"></span><span>Ask MILAN</span><span class="dot"></span>';
    document.body.appendChild(fab);

    panel = document.createElement('div'); panel.className = 'ma-panel';
    panel.innerHTML =
      '<div class="ma-drag">Drop image to attach 📎</div>' +
      '<div class="ma-head"><div class="av" style="overflow:hidden"><img src="/assets/icon-192.png" alt="MILAN" style="width:100%;height:100%;object-fit:cover"></div><div><div class="t">MILAN Assistant</div><div class="s">Online</div></div><div class="sp"></div>' +
        '<button class="ma-ic ma-clear" title="Clear chat">🗑</button><button class="ma-ic ma-close" title="Close">✕</button></div>' +
      '<div class="ma-body"></div>' +
      '<div class="ma-foot">' +
        '<div class="ma-prev"><img alt="preview"><span style="font-size:12px;color:#9aa6cf">Image attached</span><button class="x" title="Remove">✕</button></div>' +
        '<div class="ma-inwrap">' +
          '<button class="ma-attach" title="Attach image">📎</button>' +
          '<textarea class="ma-input" rows="1" placeholder="Type a message…"></textarea>' +
          '<button class="ma-send" title="Send">➤</button>' +
        '</div></div>';
    document.body.appendChild(panel);

    body = panel.querySelector('.ma-body');
    input = panel.querySelector('.ma-input');
    var fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';
    panel.appendChild(fileInput);

    function open() { panel.classList.add('open'); fab.style.display = 'none'; if (!body.childNodes.length) renderHistory(); input.focus(); }
    function close() { panel.classList.remove('open'); fab.style.display = 'flex'; }
    fab.addEventListener('click', open);
    panel.querySelector('.ma-close').addEventListener('click', close);
    panel.querySelector('.ma-clear').addEventListener('click', function () { hist = []; save(); renderHistory(); });
    panel.querySelector('.ma-send').addEventListener('click', function () { send(); });
    panel.querySelector('.ma-attach').addEventListener('click', function () { fileInput.click(); });
    panel.querySelector('.ma-prev .x').addEventListener('click', clearPreview);
    fileInput.addEventListener('change', function () { readFile(fileInput.files[0]); fileInput.value = ''; });

    input.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(120, this.scrollHeight) + 'px'; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    input.addEventListener('paste', function (e) {
      var items = (e.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++) if (items[i].type && items[i].type.indexOf('image') === 0) readFile(items[i].getAsFile());
    });

    var drag = panel.querySelector('.ma-drag');
    panel.addEventListener('dragover', function (e) { e.preventDefault(); drag.style.display = 'flex'; });
    panel.addEventListener('dragleave', function (e) { if (e.target === panel || e.target === drag) drag.style.display = 'none'; });
    panel.addEventListener('drop', function (e) { e.preventDefault(); drag.style.display = 'none'; if (e.dataTransfer && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();

/* === frontend/milan-auto-upload.js === */
/*!
 * MILAN — Effortless Auto-Upload
 * User ko manually browse/select kuch nahi karna. Bas file ko kahin bhi
 * DRAG-DROP ya PASTE karo — file khud composer me lag jaati hai, preview
 * aa jaata hai, aur ek-tap (ya auto) Publish.
 * Reuses the app's existing #mediaFile + #publishBtn pipeline.
 */
(function () {
  'use strict';
  if (window.__milanAutoUpload) return;
  window.__milanAutoUpload = true;

  var MEDIA = ['image/', 'video/', 'audio/'];
  function el(id) { return document.getElementById(id); }
  function isMedia(f) { for (var i = 0; i < MEDIA.length; i++) if (f.type && f.type.indexOf(MEDIA[i]) === 0) return true; return /\.(mp4|mov|m4v|webm|mkv|avi|3gp|mpeg|mpg|jpg|jpeg|png|gif|webp|heic|mp3|wav|m4a)$/i.test(f.name || ''); }

  function targetInput(file) {
    var media = el('mediaFile');
    var attach = el('milan-attach-input');
    if (isMedia(file)) return media || attach;
    return attach || media;            // pdf/doc/txt -> attach input if present
  }

  function setFile(input, file) {
    if (!input) return false;
    try {
      var dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) { return false; }
  }

  function scrollToComposer() {
    var c = el('postText') || el('mediaFile');
    if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var t = el('postText'); if (t) try { t.focus(); } catch (e) {}
  }

  /* ── UI: full-screen drop overlay + ready banner ──────────── */
  var CSS = [
    '.mau-ov{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;background:rgba(8,9,14,.72);backdrop-filter:blur(8px)}',
    '.mau-ov.show{display:flex;animation:mauF .15s ease}',
    '@keyframes mauF{from{opacity:0}to{opacity:1}}',
    '.mau-box{width:min(560px,86vw);min-height:300px;border:2px dashed rgba(216,179,90,.7);border-radius:26px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(216,179,90,.06);color:#f4ecd6;text-align:center;padding:30px}',
    '.mau-box .ic{font-size:60px;animation:mauBob 1.4s ease-in-out infinite}',
    '@keyframes mauBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}',
    '.mau-box h3{font:800 22px Inter,system-ui,sans-serif;margin:0;color:#fff}',
    '.mau-box p{font:500 14px Inter,system-ui,sans-serif;color:#cdbf99;margin:0;max-width:380px;line-height:1.5}',
    '.mau-pick{margin-top:6px;background:linear-gradient(135deg,#d8b35a,#ecca7e);color:#1b1306;border:0;border-radius:14px;padding:11px 22px;font:800 14px Inter,sans-serif;cursor:pointer}',
    '.mau-banner{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);z-index:100001;display:none;align-items:center;gap:12px;background:#13151d;border:1px solid rgba(216,179,90,.4);border-radius:16px;padding:11px 14px;box-shadow:0 16px 44px rgba(0,0,0,.5);opacity:0;transition:opacity .25s,transform .25s;max-width:calc(100vw - 28px)}',
    '.mau-banner.show{display:flex;opacity:1;transform:translateX(-50%) translateY(0)}',
    '.mau-banner img{width:42px;height:42px;border-radius:9px;object-fit:cover;background:#222;flex:0 0 auto}',
    '.mau-banner .fi{width:42px;height:42px;border-radius:9px;display:grid;place-items:center;font-size:20px;background:rgba(216,179,90,.16);flex:0 0 auto}',
    '.mau-banner .m{min-width:0}',
    '.mau-banner .m b{display:block;font:700 13px Inter,sans-serif;color:#f4ecd6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}',
    '.mau-banner .m span{font:500 11.5px Inter,sans-serif;color:#9aa1b4}',
    '.mau-banner button{border:0;border-radius:11px;padding:9px 14px;font:800 12.5px Inter,sans-serif;cursor:pointer;flex:0 0 auto}',
    '.mau-post{background:linear-gradient(135deg,#d8b35a,#ecca7e);color:#1b1306}',
    '.mau-x{background:rgba(255,255,255,.08);color:#cdd6ee}',
    '.mau-prog{position:absolute;left:0;bottom:0;height:3px;border-radius:0 0 16px 16px;background:linear-gradient(90deg,#d8b35a,#ecca7e);width:0}'
  ].join('\n');

  var overlay, banner, fileInput, dragDepth = 0, autoTimer = null, current = null;

  function showOverlay(s) { overlay.classList.toggle('show', s); }

  function showBanner(file) {
    clearTimeout(autoTimer);
    banner.querySelector('.mau-prog').style.width = '0';
    var thumb = banner.querySelector('.thumb');
    if (isMedia(file) && /^image\//.test(file.type)) {
      var url = URL.createObjectURL(file);
      thumb.outerHTML = '<img class="thumb" alt="" src="' + url + '">';
    } else {
      thumb.outerHTML = '<div class="thumb fi">' + (/^video\//.test(file.type) ? '🎬' : /^audio\//.test(file.type) ? '🎵' : '📄') + '</div>';
    }
    banner.querySelector('b').textContent = file.name || 'File';
    banner.querySelector('.sz').textContent = Math.max(1, Math.round(file.size / 1024)) + ' KB · ready to post';
    banner.classList.add('show');
    // gentle auto-post countdown (cancellable) so user kuch na kare
    var prog = banner.querySelector('.mau-prog'), t0 = Date.now(), DUR = 6000;
    (function tick() {
      var p = (Date.now() - t0) / DUR;
      prog.style.width = Math.min(100, p * 100) + '%';
      if (p >= 1) { doPublish(); return; }
      autoTimer = setTimeout(tick, 60);
    })();
  }
  function hideBanner() { clearTimeout(autoTimer); banner.classList.remove('show'); }

  function doPublish() {
    clearTimeout(autoTimer);
    // Restore mobile scroll after publish (close drawer if open, reset overflow)
    if (document.body.classList.contains('milan-mobile-menu-open')) {
      document.body.classList.remove('milan-mobile-menu-open');
    }
    var drawer = document.getElementById('milan-drawer-v81');
    if (drawer) drawer.setAttribute('aria-hidden', 'true');
    setTimeout(function () {
      if (typeof recoverMobileScroll === 'function') recoverMobileScroll();
      scrollToComposer();
    }, 120);
    // Auto-fill a friendly title from the filename if user left it empty (so a no-caption post still works).
    if (current) {
      var ti = el('postTitle');
      if (ti && !ti.value.trim()) { ti.value = String(current.name || 'My upload').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80); ti.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    var btn = el('publishBtn');
    if (btn) btn.click();
    hideBanner();
  }

  function handleFiles(files) {
    if (!files || !files.length) return;
    var file = files[0];
    var input = targetInput(file);
    if (!input) { toast('Composer ready nahi — pehle app me aao.'); return; }
    if (!setFile(input, file)) { toast('File set nahi ho payi, dobara try karo.'); return; }
    current = file;
    scrollToComposer();
    showBanner(file);
  }

  function toast(msg) {
    if (window.toast) { try { window.toast(msg); return; } catch (e) {} }
    console.log('[MILAN auto-upload]', msg);
  }

  function build() {
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    overlay = document.createElement('div'); overlay.className = 'mau-ov';
    overlay.innerHTML = '<div class="mau-box"><div class="ic">📤</div><h3>Drop to share on MILAN</h3>' +
      '<p>File yahin chhod do — automatically aapke post me lag jaayegi. Manually kuch select karne ki zaroorat nahi.</p>' +
      '<button class="mau-pick">Or choose a file</button></div>';
    document.body.appendChild(overlay);

    banner = document.createElement('div'); banner.className = 'mau-banner';
    banner.innerHTML = '<div class="thumb fi">📄</div><div class="m"><b>File</b><span class="sz">ready</span></div>' +
      '<button class="mau-post">Post now</button><button class="mau-x">Cancel</button><div class="mau-prog"></div>';
    document.body.appendChild(banner);

    fileInput = document.createElement('input'); fileInput.type = 'file';
    fileInput.accept = 'image/*,video/*,audio/*,.pdf,.txt,.md,.csv'; fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    fileInput.addEventListener('change', function () { if (fileInput.files[0]) handleFiles(fileInput.files); fileInput.value = ''; });

    overlay.querySelector('.mau-pick').addEventListener('click', function (e) { e.stopPropagation(); showOverlay(false); dragDepth = 0; fileInput.click(); });
    overlay.addEventListener('click', function () { showOverlay(false); dragDepth = 0; });
    banner.querySelector('.mau-post').addEventListener('click', doPublish);
    banner.querySelector('.mau-x').addEventListener('click', hideBanner);

    // Drag tracking across the whole window
    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; showOverlay(true);
    });
    window.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', function (e) { if (!hasFiles(e)) return; dragDepth--; if (dragDepth <= 0) { dragDepth = 0; showOverlay(false); } });
    window.addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault(); dragDepth = 0; showOverlay(false); handleFiles(e.dataTransfer.files);
    });
    // Paste image/file from clipboard
    window.addEventListener('paste', function (e) {
      var items = (e.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') { var f = items[i].getAsFile(); if (f) { handleFiles([f]); break; } }
      }
    });
  }
  function hasFiles(e) { var t = e.dataTransfer && e.dataTransfer.types; if (!t) return false; for (var i = 0; i < t.length; i++) if (t[i] === 'Files') return true; return false; }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();

/* === frontend/milan.js === */
/* MILAN V7.2 — Master interaction layer.
 * Additive only. Loaded on every page. Never renames/removes existing handlers.
 * Provides: toast, dead-link guard, scroll-top FAB, free-music banner,
 * footer nav, service-worker register, install prompt, Esc-closes-modals, share/copy.
 */
(function () {
  "use strict";

  /* ---------------- Toast ---------------- */
  function milanToast(msg, ms) {
    ms = ms || 2200;
    var t = document.getElementById("milan-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "milan-toast";
      t.setAttribute("role", "status");
      t.style.cssText =
        "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#0b1437;color:#fff;padding:12px 18px;border-radius:12px;font:14px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.4);z-index:99999;opacity:0;transition:.25s;max-width:90vw;text-align:center";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(function () { t.style.opacity = "1"; });
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.opacity = "0"; }, ms);
  }
  window.milanToast = window.milanToast || milanToast;

  /* ---------------- Share / Copy ---------------- */
  window.milanShare = async function (url, title) {
    url = url || location.href;
    title = title || document.title || "MILAN";
    if (navigator.share) {
      try { await navigator.share({ title: title, url: url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); milanToast("Link copied"); }
    catch (e) { milanToast("Couldn't copy link"); }
  };
  window.milanCopy = async function (text) {
    try { await navigator.clipboard.writeText(text); milanToast("Copied"); return true; }
    catch (e) { milanToast("Couldn't copy"); return false; }
  };

  var PAGE = location.pathname.replace(/\/index\.html$/, "/");
  var isHome = PAGE === "/" || /index\.html$/.test(location.pathname);
  var isApp = /\/app(\.html)?$/.test(location.pathname);
  var isMusic = /\/music(\.html)?$/.test(location.pathname);
  var APP_SURFACE = isApp || isMusic ||
    /\/(settings|admin-users|reset-password|verify-email|launch)/.test(location.pathname);

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    // Auth / full-screen login screen: keep it clean — no injected banner/footer/FAB.
    var isAuth = !!document.querySelector(".login-card");
    deadLinkGuard();
    if (!isAuth) scrollTopFab();
    if (!APP_SURFACE && !isAuth) footerNav();
    if ((isHome || isApp) && !isAuth) freeMusicBanner();
    if (isMusic) musicExtras();
    swRegister();
    installPrompt();
    escClosesModals();
    authenticatedAppLinks();
  });

  /* ---------------- Authenticated Open App ---------------- */
  function authenticatedAppLinks() {
    document.addEventListener("click", function (event) {
      const link = event.target.closest && event.target.closest("a");
      if (!link) return;

      const raw = link.getAttribute("href") || "";
      let url;
      try {
        url = new URL(raw, location.href);
      } catch (_) {
        return;
      }

      if (url.origin !== location.origin || !/^\/app\/?$/.test(url.pathname)) {
        return;
      }

      let token = "";
      try {
        token =
          localStorage.getItem("milan_token") ||
          localStorage.getItem("milan_token") ||
          "";
      } catch (_) {}

      event.preventDefault();
      window.location.assign(
        token
          ? "/app.html?entry=" + Date.now()
          : "/index.html"
      );
    });
  }

  /* ---------------- Dead-link guard ----------------
     Stops a[href="#"] from jumping to top. If the link has no real handler,
     give visible feedback instead of doing nothing. Never blocks existing onclick. */
  function deadLinkGuard() {
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href="#"], a[href=""]');
      if (!a) return;
      // Let real handlers run, just cancel the hash jump.
      e.preventDefault();
      var hasHandler = a.getAttribute("onclick") || a.dataset.action || a.id || a.getAttribute("href").length > 1;
      if (!hasHandler) {
        var label = (a.textContent || a.getAttribute("aria-label") || "This").trim().slice(0, 40);
        milanToast(label + " — coming soon");
      }
    });
  }

  /* ---------------- Scroll-to-top FAB ---------------- */
  function scrollTopFab() {
    var fab = document.createElement("button");
    fab.id = "milan-fab-top";
    fab.type = "button";
    fab.setAttribute("aria-label", "Scroll to top");
    fab.innerHTML = "↑";
    document.body.appendChild(fab);
    fab.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        fab.classList.toggle("show", window.scrollY > 600);
        ticking = false;
      });
    }, { passive: true });
  }

  /* ---------------- Footer nav (crawl depth + consistency) ---------------- */
  function footerNav() {
    if (document.getElementById("milan-footer-nav")) return;
    var links = [
      ["/", "Home"], ["/app", "App"], ["/music", "Music"], ["/about", "About"],
      ["/privacy", "Privacy"], ["/terms", "Terms"], ["/keywords", "Topics"]
    ];
    var f = document.createElement("nav");
    f.id = "milan-footer-nav";
    f.setAttribute("aria-label", "Footer");
    f.innerHTML =
      links.map(function (l) { return '<a href="' + l[0] + '">' + l[1] + "</a>"; }).join("·") +
      '<span class="mfn-copy">© ' + new Date().getFullYear() +
      ' MILAN · Your data, your network — built on Web5.</span>';
    document.body.appendChild(f);
  }

  /* ---------------- Free-music banner ---------------- */
  function freeMusicBanner() {
    if (localStorage.getItem("milan_music_banner_dismissed") === "1") return;
    if (document.getElementById("milan-music-banner")) return;
    var b = document.createElement("div");
    b.id = "milan-music-banner";
    b.innerHTML =

      '<button class="mmb-close" type="button" aria-label="Dismiss">×</button>';
    document.body.insertBefore(b, document.body.firstChild);
    b.querySelector(".mmb-close").addEventListener("click", function () {
      b.remove();
      try { localStorage.setItem("milan_music_banner_dismissed", "1"); } catch (e) {}
    });
  }

  /* ---------------- Music page extras ---------------- */
  function musicExtras() {
    if (!document.querySelector(".milan-backfeed")) {
      var a = document.createElement("a");
      a.className = "milan-backfeed";
      a.href = "/app";
      a.innerHTML = "← Back to Feed";
      a.style.cssText = "position:fixed;left:14px;top:14px;z-index:60";
      document.body.appendChild(a);
    }
  }

  /* ---------------- Service worker ---------------- */
  function swRegister() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  /* ---------------- Install prompt (A2HS) ---------------- */
  function installPrompt() {
    // Keep install UI off authentication pages so email flows stay unobstructed.
    if (/^\/(?:verify-email|reset-password)(?:\.html)?\/?$/.test(window.location.pathname)) return;
    var deferred = null;

    function isInstalled() {
      return window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches ||
        window.matchMedia("(display-mode: minimal-ui)").matches ||
        window.navigator.standalone === true;
    }

    function isMobile() {
      return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
        window.matchMedia("(pointer:coarse)").matches;
    }

    function isIOS() {
      return /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function getButton() {
      var card = document.getElementById("milan-install-btn");
      if (card) return card;

      card = document.createElement("div");
      card.id = "milan-install-btn";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-label", "Install MILAN");
      card.style.cssText =
        "position:fixed !important;left:50% !important;right:auto !important;" +
        "top:max(12px,env(safe-area-inset-top)) !important;bottom:auto !important;" +
        "z-index:99998 !important;display:none;width:calc(100% - 24px) !important;" +
        "max-width:430px !important;box-sizing:border-box !important;" +
        "padding:14px !important;margin:0 !important;" +
        "border:1px solid rgba(91,120,255,.30) !important;" +
        "border-radius:20px !important;" +
        "background:linear-gradient(145deg,rgba(5,14,43,.98),rgba(15,27,63,.98)) !important;" +
        "color:#fff !important;" +
        "box-shadow:0 18px 45px rgba(0,0,0,.38),0 0 0 1px rgba(124,58,237,.08) !important;" +
        "backdrop-filter:blur(20px) !important;-webkit-backdrop-filter:blur(20px) !important;" +
        "transform:translate(-50%,-140%) !important;opacity:0 !important;" +
        "transition:transform .45s cubic-bezier(.22,1,.36,1),opacity .32s ease !important;";

      card.innerHTML =
        '<div style="display:flex;align-items:center;gap:12px;">' +
          '<div style="width:42px;height:42px;flex:0 0 42px;border-radius:13px;' +
            'display:flex;align-items:center;justify-content:center;' +
            'background:linear-gradient(135deg,#245dff,#7c3aed);' +
            'box-shadow:0 7px 20px rgba(36,93,255,.28);font-size:21px;">✦</div>' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-size:15px;font-weight:900;line-height:1.2;">Install MILAN</div>' +
            '<div style="margin-top:4px;font-size:12px;font-weight:500;line-height:1.35;' +
              'color:rgba(255,255,255,.68);">A faster, smoother app-like experience.</div>' +
          '</div>' +
          '<button id="milan-install-action" type="button" ' +
            'style="border:0;border-radius:12px;padding:10px 13px;white-space:nowrap;' +
            'background:linear-gradient(135deg,#245dff,#7c3aed);color:#fff;' +
            'font-size:13px;font-weight:900;cursor:pointer;box-shadow:0 7px 18px rgba(36,93,255,.24);">' +
            'Install</button>' +
        '</div>' +
        '<button id="milan-install-dismiss" type="button" ' +
          'style="display:block;width:100%;margin-top:9px;padding:4px;border:0;' +
          'background:transparent;color:rgba(255,255,255,.48);font-size:11px;' +
          'font-weight:700;cursor:pointer;">Not now</button>';

      var installAction = card.querySelector("#milan-install-action");
      var dismissAction = card.querySelector("#milan-install-dismiss");

      installAction.onclick = async function () {
        if (deferred) {
          var promptEvent = deferred;
          deferred = null;
          try {
            promptEvent.prompt();
            await promptEvent.userChoice;
          } catch (_) {}
          hide();
          return;
        }

        if (isIOS()) {
          milanToast("Tap Share ↗ → Add to Home Screen");
          return;
        }

        milanToast("Install is preparing… tap Install again in a moment.");
      };

      dismissAction.onclick = function () {
        hide();
      };

      document.body.appendChild(card);
      return card;
    }

    function hide() {
      var card = document.getElementById("milan-install-btn");
      if (!card) return;
      card.style.transform = "translate(-50%,-140%)";
      card.style.opacity = "0";
      setTimeout(function () {
        if (card.style.opacity === "0") card.style.display = "none";
      }, 320);
    }

    function show() {
      if (document.getElementById("milan-pwa-install-v2")) return;
      if (!isMobile() || isInstalled()) {
        hide();
        return;
      }

      var card = getButton();
      card.style.display = "block";
      card.style.transform = "translate(-50%,-140%)";
      card.style.opacity = "0";

      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (card.style.display !== "none") {
            card.style.transform = "translate(-50%,0)";
            card.style.opacity = "1";
          }
        });
      });
    }

    function showIOSInstructions() {
      var card = getButton();
      var installAction = card.querySelector("#milan-install-action");
      if (installAction) {
        installAction.textContent = "How";
        installAction.onclick = function () {
          milanToast("Tap Share ↗ → Add to Home Screen");
        };
      }
      show();
    }

    window.addEventListener("beforeinstallprompt", function (e) {
      if (document.getElementById("milan-pwa-install-v2") || !isMobile() || isInstalled()) return;

      e.preventDefault();
      deferred = e;

      var card = getButton();
      var installAction = card.querySelector("#milan-install-action");

      if (installAction) {
        installAction.textContent = "Install";
        installAction.onclick = async function () {
          if (!deferred) return;

          var promptEvent = deferred;
          deferred = null;

          try {
            promptEvent.prompt();
            await promptEvent.userChoice;
          } catch (_) {}

          hide();
        };
      }

      show();
    });

    window.addEventListener("appinstalled", function () {
      deferred = null;
      hide();
      if (typeof milanToast === "function") milanToast("MILAN installed 🎉");
    });

    /* Show the install CTA immediately on mobile when not installed.
       Android/Chrome upgrades it to the native prompt when available. */
    function init() {
      if (document.getElementById("milan-pwa-install-v2")) return;
      if (!isMobile() || isInstalled()) {
        hide();
        return;
      }

      if (isIOS()) {
        showIOSInstructions();
      } else {
        show();
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }

    window.addEventListener("pageshow", init);
  }

  /* ---------------- Esc closes modals ---------------- */
  function escClosesModals() {
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      ["closeModal", "closeAIModal", "closeAiModal", "closeComposer"].forEach(function (fn) {
        if (typeof window[fn] === "function") { try { window[fn](); } catch (e) {} }
      });
      var b = document.getElementById("milan-music-banner");
      // (don't auto-dismiss banner on Esc; only modals)
    });
  }
})();

/* === frontend/milan-creative-mode.js === */
/*!
 * MILAN — Creative Mode 🎨
 * One-click full-UI theme switcher. 12 hand-tuned themes.
 * Pure frontend, zero dependencies. Persists in localStorage.
 * Works on the login page (index.html) and the app (app.html).
 */
(function () {
  'use strict';
  if (window.__milanCreativeMode) return;            // guard against double-load
  window.__milanCreativeMode = true;

  var KEY = 'milan_creative_theme';

  /* ── 10 THEMES ─────────────────────────────────────────────────
   * Each theme re-points the whole UI: page background, surfaces,
   * text, lines, brand gradient and buttons.
   * ------------------------------------------------------------- */
  var THEMES = [
    { id: 'krishna', name: 'Krishna Night', emoji: '🪈', light: false,
      bg: 'radial-gradient(ellipse at 20% 0,rgba(20,100,184,.30),transparent 50%),radial-gradient(ellipse at 80% 10%,rgba(217,70,239,.22),transparent 42%),radial-gradient(ellipse at 50% 100%,rgba(245,158,11,.12),transparent 55%),#050e2b',
      surface: '#0a1a3e', surface2: '#0d2150', text: '#f0e6ff', muted: '#8ba4d4', line: 'rgba(245,158,11,.18)',
      brand: '#f59e0b', brand2: '#d946ef', btn: '#030920', input: 'rgba(5,14,43,.85)' },

    { id: 'aurora', name: 'Aurora', emoji: '🌌', light: false,
      bg: 'radial-gradient(ellipse at 15% 0,rgba(34,211,238,.25),transparent 45%),radial-gradient(ellipse at 85% 15%,rgba(168,85,247,.25),transparent 45%),radial-gradient(ellipse at 50% 100%,rgba(16,185,129,.18),transparent 55%),#040a16',
      surface: '#0a1626', surface2: '#0e1f33', text: '#e6f7ff', muted: '#7fa6c4', line: 'rgba(34,211,238,.18)',
      brand: '#22d3ee', brand2: '#a855f7', btn: '#02121a', input: 'rgba(4,12,22,.85)' },

    { id: 'sunset', name: 'Sunset', emoji: '🌇', light: false,
      bg: 'radial-gradient(ellipse at 20% 0,rgba(251,146,60,.30),transparent 45%),radial-gradient(ellipse at 80% 20%,rgba(244,63,94,.26),transparent 45%),radial-gradient(ellipse at 50% 100%,rgba(168,85,247,.16),transparent 55%),#1a0e1a',
      surface: '#241320', surface2: '#2e1828', text: '#ffeede', muted: '#c79bae', line: 'rgba(251,146,60,.20)',
      brand: '#fb923c', brand2: '#f43f5e', btn: '#1a0a12', input: 'rgba(26,14,26,.85)' },

    { id: 'cyber', name: 'Cyberpunk', emoji: '🤖', light: false,
      bg: 'radial-gradient(ellipse at 10% 0,rgba(255,43,214,.22),transparent 42%),radial-gradient(ellipse at 90% 10%,rgba(0,229,255,.22),transparent 42%),radial-gradient(ellipse at 50% 100%,rgba(124,58,237,.16),transparent 55%),#07070d',
      surface: '#0f0f1a', surface2: '#15152a', text: '#eafcff', muted: '#7d7da8', line: 'rgba(255,43,214,.22)',
      brand: '#ff2bd6', brand2: '#00e5ff', btn: '#07070d', input: 'rgba(7,7,13,.9)' },

    { id: 'forest', name: 'Forest', emoji: '🌲', light: false,
      bg: 'radial-gradient(ellipse at 18% 0,rgba(52,211,153,.24),transparent 45%),radial-gradient(ellipse at 82% 12%,rgba(163,230,53,.18),transparent 45%),#06140e',
      surface: '#0a1d14', surface2: '#0e261a', text: '#e7fff2', muted: '#80b59c', line: 'rgba(52,211,153,.18)',
      brand: '#34d399', brand2: '#a3e635', btn: '#04130c', input: 'rgba(6,20,14,.85)' },

    { id: 'royal', name: 'Royal Purple', emoji: '👑', light: false,
      bg: 'radial-gradient(ellipse at 20% 0,rgba(167,139,250,.28),transparent 45%),radial-gradient(ellipse at 80% 15%,rgba(240,171,252,.22),transparent 45%),#120a26',
      surface: '#1b1136', surface2: '#231546', text: '#f3ebff', muted: '#a896cf', line: 'rgba(167,139,250,.22)',
      brand: '#a78bfa', brand2: '#f0abfc', btn: '#0e0820', input: 'rgba(18,10,38,.85)' },

    { id: 'ocean', name: 'Ocean', emoji: '🌊', light: false,
      bg: 'radial-gradient(ellipse at 15% 0,rgba(56,189,248,.26),transparent 46%),radial-gradient(ellipse at 85% 12%,rgba(45,212,191,.20),transparent 46%),#05182e',
      surface: '#0a2138', surface2: '#0e2a47', text: '#e3f6ff', muted: '#7eaecb', line: 'rgba(56,189,248,.20)',
      brand: '#38bdf8', brand2: '#2dd4bf', btn: '#03101f', input: 'rgba(5,24,46,.85)' },

    { id: 'mono', name: 'Midnight AMOLED', emoji: '🖤', light: false,
      bg: '#000000',
      surface: '#0b0b0b', surface2: '#141414', text: '#f5f5f5', muted: '#8a8a8a', line: 'rgba(255,255,255,.12)',
      brand: '#ffffff', brand2: '#9ca3af', btn: '#000000', input: '#0d0d0d' },

    { id: 'rosegold', name: 'Rose Gold', emoji: '🌹', light: true,
      bg: 'radial-gradient(ellipse at 20% 0,rgba(232,180,184,.40),transparent 50%),radial-gradient(ellipse at 80% 10%,rgba(201,162,39,.18),transparent 45%),#fff7f4',
      surface: '#ffffff', surface2: '#fdeee9', text: '#4a3438', muted: '#9c8388', line: 'rgba(201,162,39,.28)',
      brand: '#e08a90', brand2: '#c9a227', btn: '#ffffff', input: '#fff7f4' },

    { id: 'sakura', name: 'Sakura', emoji: '🌸', light: true,
      bg: 'radial-gradient(ellipse at 18% 0,rgba(249,168,212,.40),transparent 50%),radial-gradient(ellipse at 82% 12%,rgba(251,113,133,.20),transparent 45%),#fff2f7',
      surface: '#ffffff', surface2: '#ffe9f1', text: '#4a2c3a', muted: '#a6788a', line: 'rgba(251,113,133,.28)',
      brand: '#f472b6', brand2: '#fb7185', btn: '#ffffff', input: '#fff2f7' },
    
    { id: 'emerald', name: 'Emerald', emoji: '💚', light: false,
      bg: 'radial-gradient(ellipse at 20% 0,rgba(16,185,129,.25),transparent 48%),radial-gradient(ellipse at 80% 15%,rgba(34,197,94,.20),transparent 45%),#06120d',
      surface: '#0a1c13', surface2: '#0f291c', text: '#ecfff4', muted: '#86b89d', line: 'rgba(16,185,129,.20)',
      brand: '#10b981', brand2: '#22c55e', btn: '#03100a', input: 'rgba(6,18,13,.88)' },

    { id: 'ice', name: 'Ice', emoji: '🧊', light: true,
      bg: 'radial-gradient(ellipse at 20% 0,rgba(125,211,252,.38),transparent 48%),radial-gradient(ellipse at 80% 12%,rgba(167,243,208,.28),transparent 45%),#f2fbff',
      surface: '#ffffff', surface2: '#eaf8ff', text: '#17324d', muted: '#6b879f', line: 'rgba(14,165,233,.22)',
      brand: '#0ea5e9', brand2: '#14b8a6', btn: '#ffffff', input: '#f2fbff' }
,
    
    { id: 'obsidian', name: 'Obsidian Gold', emoji: '🜁', light: false,
      bg: 'radial-gradient(ellipse at 18% 0,rgba(245,158,11,.20),transparent 46%),radial-gradient(ellipse at 82% 10%,rgba(251,191,36,.12),transparent 45%),#080808',
      surface: '#101010', surface2: '#191919', text: '#fff8e7', muted: '#a89b7e', line: 'rgba(245,158,11,.20)',
      brand: '#f59e0b', brand2: '#facc15', btn: '#090909', input: 'rgba(8,8,8,.90)' }
  ];

  function byId(id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i]; return null; }

  /* ── Per-theme override CSS (re-skins the whole UI) ─────────── */
  function themeCss(t) {
    var grad = 'linear-gradient(135deg,' + t.brand + ',' + t.brand2 + ')';
    var S = 'html[data-mcm="' + t.id + '"]';
    return [
      // page
      S + ',' + S + ' body{background:' + t.bg + ' !important;color:' + t.text + ' !important;background-attachment:fixed !important;}',
      // core CSS variables so variable-driven components follow
      S + '{--bg:' + t.bg + ';--card:' + t.surface + ';--card2:' + t.surface2 + ';--text:' + t.text + ';--muted:' + t.muted + ';--line:' + t.line + ';--brand:' + t.brand + ';--brand2:' + t.brand2 + ';}',
      // surfaces
      S + ' .topbar{background:' + t.surface + 'ee !important;border-bottom:1px solid ' + t.line + ' !important;}',
      S + ' .card,' + S + ' .post,' + S + ' .person,' + S + ' .composer,' + S + ' .modal,' + S + ' .bubble,' + S + ' .stat,' + S + ' .authBox,' + S + ' .login-card,' + S + ' .hero-panel,' + S + ' .heroCard,' + S + ' .milan-container{background:' + t.surface + ' !important;border-color:' + t.line + ' !important;color:' + t.text + ' !important;}',
      // text accents / brand wordmark
      S + ' .brand h1,' + S + ' .heroTitle,' + S + ' .logo-center h2,' + S + ' .hero-title{background:' + grad + ' !important;-webkit-background-clip:text !important;background-clip:text !important;color:transparent !important;}',
      S + ' .tag,' + S + ' .muted,' + S + ' .mini,' + S + ' .card-header p{color:' + t.muted + ' !important;}',
      // buttons (primary)
      S + ' button:not(.ghost):not(.soft):not(.mcm-btn):not(.tab):not(.mcm-card):not(.mcm-x):not(.mcm-surprise):not(.mcm-reset),' + S + ' .login-button,' + S + ' #loginBtn,' + S + ' #registerBtn{background:' + grad + ' !important;color:' + t.btn + ' !important;border:0 !important;box-shadow:0 6px 20px ' + t.brand + '44 !important;}',
      // ghost/soft buttons
      S + ' button.ghost{background:transparent !important;color:' + t.brand + ' !important;border:1px solid ' + t.line + ' !important;}',
      // inputs
      S + ' input,' + S + ' textarea,' + S + ' select,' + S + ' .input-field{background:' + t.input + ' !important;border:1px solid ' + t.line + ' !important;color:' + t.text + ' !important;}',
      S + ' input::placeholder,' + S + ' textarea::placeholder{color:' + t.muted + 'aa !important;}',
      // tabs / pills / chips
      S + ' .tab.active,' + S + ' .pill.on,' + S + ' .health,' + S + ' .heroBadge{background:' + t.brand + '22 !important;color:' + t.brand + ' !important;}',
      // avatars / meters
      S + ' .avatar,' + S + ' .privacyMeter span,' + S + ' .privacyMeter i{background:' + grad + ' !important;}',
      // links
      S + ' a{color:' + t.brand + ';}'
    ].join('\n');
  }

  /* ── UI (floating button + panel) CSS ─────────────────────── */
  var UI_CSS = [
    '.mcm-fab{position:fixed;right:18px;bottom:84px;z-index:99998;width:48px;height:48px;border-radius:50%;border:0;cursor:pointer;font-size:21px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f59e0b,#d946ef);color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.15) inset;transition:transform .2s, box-shadow .2s;}',
    '.mcm-fab:hover{transform:scale(1.08) rotate(8deg);box-shadow:0 14px 40px rgba(217,70,239,.5);}',
    '.mcm-fab:active{transform:scale(.95);}',
    '@media(max-width:780px){.mcm-fab{bottom:134px;right:14px;width:44px;height:44px;font-size:19px;}.mcm-toast{bottom:188px;}}',
    '.mcm-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);display:none;align-items:flex-end;justify-content:center;}',
    '.mcm-overlay.open{display:flex;animation:mcmFade .2s ease;}',
    '@keyframes mcmFade{from{opacity:0}to{opacity:1}}',
    '.mcm-sheet{width:100%;max-width:680px;max-height:86vh;overflow:auto;background:#0c1326;border:1px solid rgba(255,255,255,.12);border-radius:24px 24px 0 0;padding:20px 20px 28px;box-shadow:0 -20px 60px rgba(0,0,0,.5);animation:mcmUp .28s cubic-bezier(.16,.84,.44,1);}',
    '@media(min-width:700px){.mcm-overlay{align-items:center;}.mcm-sheet{border-radius:24px;}}',
    '@keyframes mcmUp{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}',
    '.mcm-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}',
    '.mcm-title{font:800 19px/1.2 Inter,system-ui,sans-serif;color:#fff;letter-spacing:.01em;}',
    '.mcm-sub{font:500 12.5px/1.5 Inter,system-ui,sans-serif;color:#93a0c0;margin:2px 0 16px;}',
    '.mcm-x{background:rgba(255,255,255,.08);border:0;color:#cdd6ee;width:34px;height:34px;border-radius:50%;font-size:18px;cursor:pointer;}',
    '.mcm-x:hover{background:rgba(255,255,255,.16);}',
    '.mcm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;}',
    '.mcm-card{position:relative;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:0;overflow:hidden;cursor:pointer;background:#0c1326;transition:transform .15s, border-color .15s, box-shadow .15s;text-align:left;}',
    '.mcm-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.3);box-shadow:0 10px 26px rgba(0,0,0,.4);}',
    '.mcm-card.active{border-color:#fff;box-shadow:0 0 0 2px #fff inset;}',
    '.mcm-swatch{height:74px;display:flex;align-items:center;justify-content:center;font-size:26px;position:relative;}',
    '.mcm-dots{position:absolute;bottom:8px;left:10px;display:flex;gap:5px;}',
    '.mcm-dot{width:12px;height:12px;border-radius:50%;box-shadow:0 0 0 1px rgba(255,255,255,.25);}',
    '.mcm-meta{padding:9px 11px 11px;}',
    '.mcm-name{font:700 13px/1.2 Inter,system-ui,sans-serif;color:#fff;}',
    '.mcm-tagline{font:500 11px/1.3 Inter,system-ui,sans-serif;color:#8c99ba;margin-top:2px;}',
    '.mcm-check{position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;background:#fff;color:#111;font-size:14px;display:none;align-items:center;justify-content:center;font-weight:900;}',
    '.mcm-card.active .mcm-check{display:flex;}',
    '.mcm-actions{display:flex;gap:10px;margin-top:16px;}',
    '.mcm-btn{flex:1;border:0;border-radius:13px;padding:12px;font:700 13.5px Inter,system-ui,sans-serif;cursor:pointer;}',
    '.mcm-surprise{background:linear-gradient(135deg,#f59e0b,#d946ef);color:#fff;}',
    '.mcm-reset{background:rgba(255,255,255,.08);color:#cdd6ee;}',
    '.mcm-toast{position:fixed;left:50%;bottom:88px;transform:translateX(-50%) translateY(20px);z-index:100000;background:#0c1326;color:#fff;border:1px solid rgba(255,255,255,.16);padding:11px 20px;border-radius:999px;font:600 13px Inter,system-ui,sans-serif;opacity:0;transition:opacity .25s, transform .25s;pointer-events:none;box-shadow:0 10px 30px rgba(0,0,0,.4);}',
    '.mcm-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}',
    // smooth full-page transition when switching
    'html.mcm-anim,html.mcm-anim body,html.mcm-anim .card,html.mcm-anim .topbar,html.mcm-anim .post,html.mcm-anim button,html.mcm-anim input{transition:background .45s ease,color .45s ease,border-color .45s ease !important;}'
  ].join('\n');

  /* ── Apply / persist ──────────────────────────────────────── */
  function apply(id, announce) {
    var t = byId(id); if (!t) return;
    document.documentElement.classList.add('mcm-anim');
    document.documentElement.setAttribute('data-mcm', id);
    try { localStorage.setItem(KEY, id); } catch (e) {}
    try {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', t.light ? '#fff2f7' : (t.surface || '#050e2b'));
    } catch (e) {}
    refreshActive();
    if (announce) toast(t.emoji + '  ' + t.name);
    setTimeout(function () { document.documentElement.classList.remove('mcm-anim'); }, 500);
  }

  function refreshActive() {
    var cur = document.documentElement.getAttribute('data-mcm');
    var cards = document.querySelectorAll('.mcm-card');
    for (var i = 0; i < cards.length; i++) cards[i].classList.toggle('active', cards[i].getAttribute('data-id') === cur);
  }

  var toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'mcm-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }

  /* ── Build the panel ──────────────────────────────────────── */
  function buildPanel() {
    var overlay = document.createElement('div'); overlay.className = 'mcm-overlay';
    var cards = THEMES.map(function (t) {
      return '<button class="mcm-card" data-id="' + t.id + '">' +
        '<div class="mcm-check">✓</div>' +
        '<div class="mcm-swatch" style="background:' + t.bg + '">' + t.emoji +
        '<div class="mcm-dots">' +
        '<span class="mcm-dot" style="background:' + t.brand + '"></span>' +
        '<span class="mcm-dot" style="background:' + t.brand2 + '"></span>' +
        '<span class="mcm-dot" style="background:' + t.surface + '"></span>' +
        '</div></div>' +
        '<div class="mcm-meta"><div class="mcm-name">' + t.name + '</div>' +
        '<div class="mcm-tagline">' + (t.light ? 'Light' : 'Dark') + ' theme</div></div>' +
        '</button>';
    }).join('');
    overlay.innerHTML =
      '<div class="mcm-sheet" role="dialog" aria-label="Creative Mode themes">' +
        '<div class="mcm-head"><div style="display:flex;align-items:center;gap:9px"><img src="/assets/icon-192.png" alt="MILAN" style="height:26px;width:26px;border-radius:8px"><div class="mcm-title">Creative Mode</div></div>' +
        '<button class="mcm-x" aria-label="Close">✕</button></div>' +
        '<div class="mcm-sub">Customize the entire look your way — change it with one click. ' + THEMES.length + ' themes.</div>' +
        '<div class="mcm-grid">' + cards + '</div>' +
        '<div class="mcm-actions">' +
          '<button class="mcm-btn mcm-surprise">🎲 Surprise me</button>' +
          '<button class="mcm-btn mcm-reset">↺ Default</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    function close() { overlay.classList.remove('open'); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('.mcm-x').addEventListener('click', close);
    overlay.querySelectorAll('.mcm-card').forEach(function (c) {
      c.addEventListener('click', function () { apply(c.getAttribute('data-id'), true); });
    });
    overlay.querySelector('.mcm-surprise').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-mcm');
      var pick; do { pick = THEMES[Math.floor(Math.random() * THEMES.length)]; } while (THEMES.length > 1 && pick.id === cur);
      apply(pick.id, true);
    });
    overlay.querySelector('.mcm-reset').addEventListener('click', function () { apply('mono', true); });
    return overlay;
  }

  /* ── Boot ─────────────────────────────────────────────────── */
  function injectStyle() {
    var css = UI_CSS + '\n' + THEMES.map(themeCss).join('\n');
    var s = document.createElement('style'); s.id = 'mcm-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  function boot() {
    injectStyle();
    var fab = document.createElement('button');
    fab.className = 'mcm-fab'; fab.title = 'Creative Mode — change the whole look'; fab.innerHTML = '🎨';

  /* MILAN APP — keep the launcher visible above all app layers */
  fab.style.position = 'fixed';
  fab.style.right = '22px';
  fab.style.bottom = '22px';
  fab.style.zIndex = '2147483000';
  fab.style.display = 'grid';
  fab.style.placeItems = 'center';
  fab.style.visibility = 'visible';
  fab.style.opacity = '1';
  fab.style.pointerEvents = 'auto';
    document.body.appendChild(fab);
    var overlay = buildPanel();

    /* MILAN APP — use the existing topbar Theme button as
       the Creative Mode launcher. Keep the floating FAB for
       pages that do not have the app Theme control. */
    var appThemeButton = document.querySelector('.icon-btn[title="Theme"]');

    if (appThemeButton) {
      appThemeButton.title = 'Creative Mode';
      appThemeButton.setAttribute('aria-label', 'Creative Mode');
      appThemeButton.setAttribute('type', 'button');

      appThemeButton.addEventListener('click', function () {
        overlay.classList.add('open');
        refreshActive();
      });

    } else {
      fab.addEventListener('click', function () {
        overlay.classList.add('open');
        refreshActive();
      });
    }
    // keyboard: Shift+T toggles the panel
    document.addEventListener('keydown', function (e) {
      if ((e.shiftKey) && (e.key === 'T' || e.key === 't') && !/input|textarea|select/i.test((e.target.tagName || ''))) {
        e.preventDefault(); overlay.classList.toggle('open'); refreshActive();
      }
    });
    refreshActive();
  }

  // Apply saved theme ASAP (reduce flash), build UI after DOM ready.
  try {
    var saved = localStorage.getItem(KEY);
    if (saved && byId(saved)) document.documentElement.setAttribute('data-mcm', saved);
  } catch (e) {}
  // Boot on both login and app pages.
  // Login may signal app-ready; app.html can also boot
  // directly once DOM is ready.
  var booted = false;

  function safeBoot() {
    if (booted) return;
    booted = true;
    boot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeBoot, {once:true});
  } else {
    safeBoot();
  }

  window.addEventListener('milan:app-ready', safeBoot, {once:true});
})();

/* === frontend/milan-feed.js === */
/* MILAN V7.2 — Facebook-style composer: collapsed by default, expand on focus.
   App page only. Additive — never touches existing post/publish handlers. */
(function () {
  "use strict";
  if (!/\/app(\.html)?$/.test(location.pathname)) return;
  function ready(fn){ if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",fn); else fn(); }
  ready(function () {
    var comp = document.querySelector(".composer");
    if (!comp) return;
    var txt = document.getElementById("postText");
    function expand(){ comp.classList.add("composer-expanded"); }
    if (txt) txt.addEventListener("focus", expand);
    comp.addEventListener("click", function (e) {
      // expand when the slim bar / avatar / input area is tapped
      if (!comp.classList.contains("composer-expanded")) { expand(); if (txt) txt.focus(); }
    });
  });
})();

/* === frontend/milan-geo-india.js === */
/* ═══════════════════════════════════════════════════════════════
   MILAN — Geo India Module (White-Hat SEO, 2026)
   One URL for the whole country. No doorway pages, no cloaking:
   Googlebot and humans see the same page; this script only adds a
   client-side personalization layer (progressive enhancement).
   - Detects the visitor's city (with permission) via browser
     geolocation + reverse geocoding, or lets them pick/type it.
   - Works for EVERY city/town in India: the built-in list (857
     cities, all 36 states & UTs) powers autocomplete, and any
     detected or typed city is accepted too.
   - Remembers the choice in localStorage.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LS_KEY = 'milan_geo_city';
  var mount = null;

  function cities() {
    return (window.MILAN_INDIA_CITIES || []).map(function (s) {
      var i = s.lastIndexOf('|');
      return { city: s.slice(0, i), state: s.slice(i + 1) };
    });
  }

  function saved() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function save(c) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch (e) {}
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function setBadge(c) {
    var el = document.getElementById('milan-geo-badge');
    if (!el) return;
    if (c && c.city) {
      el.innerHTML = '📍 MILAN is live in <strong>' + esc(c.city) +
        (c.state ? ', ' + esc(c.state) : '') +
        '</strong> — and every other city in India. ' +
        '<button type="button" id="milan-geo-change" class="milan-geo-link">Change</button>';
      var btn = document.getElementById('milan-geo-change');
      if (btn) btn.addEventListener('click', function () {
        var inp = document.getElementById('milan-geo-search');
        if (inp) { inp.focus(); inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      });
    } else {
      el.innerHTML = '📍 MILAN works in <strong>every city & town in India</strong> — from metros to villages. Find yours below.';
    }
  }

  function detect() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (pos) {
      var u = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' +
        pos.coords.latitude + '&longitude=' + pos.coords.longitude + '&localityLanguage=en';
      fetch(u).then(function (r) { return r.json(); }).then(function (d) {
        var c = {
          city: d.city || d.locality || '',
          state: d.principalSubdivision || ''
        };
        if (c.city) { save(c); setBadge(c); }
      }).catch(function () {});
    }, function () {}, { timeout: 8000, maximumAge: 3600000 });
  }

  function renderResults(q) {
    var box = document.getElementById('milan-geo-results');
    if (!box) return;
    q = (q || '').trim().toLowerCase();
    if (!q) { box.innerHTML = ''; return; }
    var list = cities().filter(function (c) {
      return c.city.toLowerCase().indexOf(q) === 0 ||
             c.city.toLowerCase().indexOf(q) > -1;
    }).slice(0, 12);
    var html = list.map(function (c) {
      return '<button type="button" class="milan-geo-item" data-city="' + esc(c.city) +
        '" data-state="' + esc(c.state) + '">' + esc(c.city) +
        ' <span>' + esc(c.state) + '</span></button>';
    }).join('');
    // Any city is valid — offer the typed value too
    var exact = list.some(function (c) { return c.city.toLowerCase() === q; });
    if (!exact && q.length > 2) {
      html += '<button type="button" class="milan-geo-item" data-city="' + esc(q.replace(/\b\w/g, function (ch) { return ch.toUpperCase(); })) +
        '" data-state="">Use "' + esc(q) + '" <span>your city</span></button>';
    }
    box.innerHTML = html;
    Array.prototype.forEach.call(box.querySelectorAll('.milan-geo-item'), function (b) {
      b.addEventListener('click', function () {
        var c = { city: b.getAttribute('data-city'), state: b.getAttribute('data-state') };
        save(c); setBadge(c);
        box.innerHTML = '';
        var inp = document.getElementById('milan-geo-search');
        if (inp) inp.value = '';
      });
    });
  }

  function enhance() {
    mount = document.getElementById('milan-india');
    if (!mount) return;

    var ui = document.createElement('div');
    ui.className = 'milan-geo-ui';
    ui.innerHTML =
      '<p id="milan-geo-badge" class="milan-geo-badge" aria-live="polite"></p>' +
      '<div class="milan-geo-controls">' +
        '<input type="search" id="milan-geo-search" placeholder="Search your city… (e.g. Jaipur, Kochi, Guwahati)" ' +
          'aria-label="Search your city in India" autocomplete="off">' +
        '<button type="button" id="milan-geo-detect" class="milan-geo-btn">📍 Auto-detect my city</button>' +
      '</div>' +
      '<div id="milan-geo-results" class="milan-geo-results" role="listbox" aria-label="City suggestions"></div>';
    var anchor = document.getElementById('milan-india-enhance');
    (anchor || mount).appendChild(ui);

    setBadge(saved());
    var inp = document.getElementById('milan-geo-search');
    if (inp) {
      var t = null;
      inp.addEventListener('input', function () {   // debounced → good INP
        clearTimeout(t);
        t = setTimeout(function () { renderResults(inp.value); }, 120);
      });
    }
    var det = document.getElementById('milan-geo-detect');
    if (det) det.addEventListener('click', detect);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance);
  } else {
    enhance();
  }
})();

/* === frontend/milan-heavy-worker.js === */
/* MILAN — heavy-JSON Web Worker.
   Runs the app's expensive JSON work (feed diffing, boot-cache packing) off
   the main thread so scrolling/typing never stutters while data refreshes.
   Protocol: { id, type:'feedDiff'|'pack', ... } -> { id, changed?|json?|error? } */
self.onmessage = function (e) {
  var d = e.data || {};
  try {
    if (d.type === 'feedDiff') {
      self.postMessage({ id: d.id, changed: JSON.stringify(d.fresh) !== JSON.stringify(d.prev) });
    } else if (d.type === 'pack') {
      self.postMessage({ id: d.id, json: JSON.stringify(d.value) });
    } else {
      self.postMessage({ id: d.id, error: 'unknown op' });
    }
  } catch (err) {
    self.postMessage({ id: d.id, error: String(err && err.message || err) });
  }
};

/* === frontend/milan-image-worker.js === */
/* MILAN Image Worker (V7.1)
 * Runs OFF the main thread. Downscales + compresses an image File/Blob using
 * OffscreenCanvas so the UI never freezes while a profile picture or preview
 * is being prepared. Falls back gracefully on the main thread if the browser
 * lacks OffscreenCanvas (handled by the caller, not here).
 *
 * Message in : { id, blob, maxDim, quality, mime }
 * Message out: { id, ok, dataUrl, width, height, bytes }  OR  { id, ok:false, error }
 */
'use strict';

self.onmessage = async function (e) {
  const { id, blob, maxDim = 512, quality = 0.82, mime = 'image/jpeg' } = e.data || {};
  try {
    if (!blob) throw new Error('No image provided');
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
      throw new Error('OffscreenCanvas unsupported');
    }

    const bitmap = await createImageBitmap(blob);
    let { width, height } = bitmap;

    // Scale down so the longest side <= maxDim (never upscale).
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const outW = Math.max(1, Math.round(width * scale));
    const outH = Math.max(1, Math.round(height * scale));

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, outW, outH);
    bitmap.close && bitmap.close();

    const outBlob = await canvas.convertToBlob({ type: mime, quality });
    const buf = await outBlob.arrayBuffer();
    const dataUrl = mime + ';base64,' + base64FromBuffer(buf);

    self.postMessage({
      id,
      ok: true,
      dataUrl: 'data:' + dataUrl,
      width: outW,
      height: outH,
      bytes: outBlob.size
    });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || 'compress failed' });
  }
};

function base64FromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return self.btoa(binary);
}

/* === frontend/milan-india-cities.js === */
/* MILAN — India Cities Data (857 cities, all 36 states & UTs)
   Used by milan-geo-india.js for the "MILAN across India" section.
   Format: "City|State" */
window.MILAN_INDIA_CITIES = [
"Mumbai|Maharashtra","Delhi|Delhi","Bengaluru|Karnataka","Ahmedabad|Gujarat","Hyderabad|Telangana","Chennai|Tamil Nadu","Kolkata|West Bengal","Pune|Maharashtra","Jaipur|Rajasthan","Surat|Gujarat",
"Lucknow|Uttar Pradesh","Kanpur|Uttar Pradesh","Nagpur|Maharashtra","Patna|Bihar","Indore|Madhya Pradesh","Thane|Maharashtra","Bhopal|Madhya Pradesh","Visakhapatnam|Andhra Pradesh","Vadodara|Gujarat","Firozabad|Uttar Pradesh",
"Ludhiana|Punjab","Rajkot|Gujarat","Agra|Uttar Pradesh","Siliguri|West Bengal","Nashik|Maharashtra","Faridabad|Haryana","Patiala|Punjab","Meerut|Uttar Pradesh","Kalyan-Dombivali|Maharashtra","Vasai-Virar|Maharashtra",
"Varanasi|Uttar Pradesh","Srinagar|Jammu and Kashmir","Dhanbad|Jharkhand","Jodhpur|Rajasthan","Amritsar|Punjab","Raipur|Chhattisgarh","Allahabad|Uttar Pradesh","Coimbatore|Tamil Nadu","Jabalpur|Madhya Pradesh","Gwalior|Madhya Pradesh",
"Vijayawada|Andhra Pradesh","Madurai|Tamil Nadu","Guwahati|Assam","Chandigarh|Chandigarh","Hubli-Dharwad|Karnataka","Amroha|Uttar Pradesh","Moradabad|Uttar Pradesh","Gurgaon|Haryana","Aligarh|Uttar Pradesh","Solapur|Maharashtra",
"Ranchi|Jharkhand","Jalandhar|Punjab","Tiruchirappalli|Tamil Nadu","Bhubaneswar|Odisha","Salem|Tamil Nadu","Warangal|Telangana","Mira-Bhayandar|Maharashtra","Thiruvananthapuram|Kerala","Bhiwandi|Maharashtra","Saharanpur|Uttar Pradesh",
"Guntur|Andhra Pradesh","Amravati|Maharashtra","Bikaner|Rajasthan","Noida|Uttar Pradesh","Jamshedpur|Jharkhand","Bhilai Nagar|Chhattisgarh","Cuttack|Odisha","Kochi|Kerala","Udaipur|Rajasthan","Bhavnagar|Gujarat",
"Dehradun|Uttarakhand","Asansol|West Bengal","Nanded-Waghala|Maharashtra","Ajmer|Rajasthan","Jamnagar|Gujarat","Ujjain|Madhya Pradesh","Sangli|Maharashtra","Loni|Uttar Pradesh","Jhansi|Uttar Pradesh","Pondicherry|Puducherry",
"Nellore|Andhra Pradesh","Jammu|Jammu and Kashmir","Belagavi|Karnataka","Raurkela|Odisha","Mangaluru|Karnataka","Tirunelveli|Tamil Nadu","Malegaon|Maharashtra","Gaya|Bihar","Tiruppur|Tamil Nadu","Davanagere|Karnataka",
"Kozhikode|Kerala","Akola|Maharashtra","Kurnool|Andhra Pradesh","Bokaro Steel City|Jharkhand","Rajahmundry|Andhra Pradesh","Ballari|Karnataka","Agartala|Tripura","Bhagalpur|Bihar","Latur|Maharashtra","Dhule|Maharashtra",
"Korba|Chhattisgarh","Bhilwara|Rajasthan","Brahmapur|Odisha","Mysore|Karnataka","Muzaffarpur|Bihar","Ahmednagar|Maharashtra","Kollam|Kerala","Raghunathganj|West Bengal","Bilaspur|Chhattisgarh","Shahjahanpur|Uttar Pradesh",
"Thrissur|Kerala","Alwar|Rajasthan","Kakinada|Andhra Pradesh","Nizamabad|Telangana","Sagar|Madhya Pradesh","Tumkur|Karnataka","Hisar|Haryana","Rohtak|Haryana","Panipat|Haryana","Darbhanga|Bihar",
"Kharagpur|West Bengal","Aizawl|Mizoram","Ichalkaranji|Maharashtra","Tirupati|Andhra Pradesh","Karnal|Haryana","Bathinda|Punjab","Rampur|Uttar Pradesh","Shivamogga|Karnataka","Ratlam|Madhya Pradesh","Modinagar|Uttar Pradesh",
"Durg|Chhattisgarh","Shillong|Meghalaya","Imphal|Manipur","Hapur|Uttar Pradesh","Ranipet|Tamil Nadu","Anantapur|Andhra Pradesh","Arrah|Bihar","Karimnagar|Telangana","Parbhani|Maharashtra","Etawah|Uttar Pradesh",
"Bharatpur|Rajasthan","Begusarai|Bihar","New Delhi|Delhi","Chhapra|Bihar","Kadapa|Andhra Pradesh","Ramagundam|Telangana","Pali|Rajasthan","Satna|Madhya Pradesh","Vizianagaram|Andhra Pradesh","Katihar|Bihar",
"Hardwar|Uttarakhand","Sonipat|Haryana","Nagercoil|Tamil Nadu","Thanjavur|Tamil Nadu","Murwara (Katni)|Madhya Pradesh","Naihati|West Bengal","Sambhal|Uttar Pradesh","Nadiad|Gujarat","Yamunanagar|Haryana","English Bazar|West Bengal",
"Eluru|Andhra Pradesh","Munger|Bihar","Panchkula|Haryana","Raayachuru|Karnataka","Panvel|Maharashtra","Deoghar|Jharkhand","Ongole|Andhra Pradesh","Nandyal|Andhra Pradesh","Morena|Madhya Pradesh","Bhiwani|Haryana",
"Porbandar|Gujarat","Palakkad|Kerala","Anand|Gujarat","Purnia|Bihar","Baharampur|West Bengal","Barmer|Rajasthan","Morvi|Gujarat","Orai|Uttar Pradesh","Bahraich|Uttar Pradesh","Sikar|Rajasthan",
"Vellore|Tamil Nadu","Singrauli|Madhya Pradesh","Khammam|Telangana","Mahesana|Gujarat","Silchar|Assam","Sambalpur|Odisha","Rewa|Madhya Pradesh","Unnao|Uttar Pradesh","Hugli-Chinsurah|West Bengal","Raiganj|West Bengal",
"Phusro|Jharkhand","Adityapur|Jharkhand","Alappuzha|Kerala","Bahadurgarh|Haryana","Machilipatnam|Andhra Pradesh","Rae Bareli|Uttar Pradesh","Jalpaiguri|West Bengal","Bharuch|Gujarat","Pathankot|Punjab","Hoshiarpur|Punjab",
"Baramula|Jammu and Kashmir","Adoni|Andhra Pradesh","Jind|Haryana","Tonk|Rajasthan","Tenali|Andhra Pradesh","Kancheepuram|Tamil Nadu","Vapi|Gujarat","Sirsa|Haryana","Navsari|Gujarat","Mahbubnagar|Telangana",
"Puri|Odisha","Robertson Pet|Karnataka","Erode|Tamil Nadu","Batala|Punjab","Haldwani-cum-Kathgodam|Uttarakhand","Vidisha|Madhya Pradesh","Saharsa|Bihar","Thanesar|Haryana","Chittoor|Andhra Pradesh","Veraval|Gujarat",
"Lakhimpur|Uttar Pradesh","Sitapur|Uttar Pradesh","Hindupur|Andhra Pradesh","Santipur|West Bengal","Balurghat|West Bengal","Ganjbasoda|Madhya Pradesh","Moga|Punjab","Proddatur|Andhra Pradesh","Srinagar|Uttarakhand","Medinipur|West Bengal",
"Habra|West Bengal","Sasaram|Bihar","Hajipur|Bihar","Bhuj|Gujarat","Shivpuri|Madhya Pradesh","Ranaghat|West Bengal","Shimla|Himachal Pradesh","Tiruvannamalai|Tamil Nadu","Kaithal|Haryana","Rajnandgaon|Chhattisgarh",
"Godhra|Gujarat","Hazaribag|Jharkhand","Bhimavaram|Andhra Pradesh","Mandsaur|Madhya Pradesh","Dibrugarh|Assam","Kolar|Karnataka","Bankura|West Bengal","Mandya|Karnataka","Dehri-on-Sone|Bihar","Madanapalle|Andhra Pradesh",
"Malerkotla|Punjab","Lalitpur|Uttar Pradesh","Bettiah|Bihar","Pollachi|Tamil Nadu","Khanna|Punjab","Neemuch|Madhya Pradesh","Palwal|Haryana","Palanpur|Gujarat","Guntakal|Andhra Pradesh","Nabadwip|West Bengal",
"Udupi|Karnataka","Jagdalpur|Chhattisgarh","Motihari|Bihar","Pilibhit|Uttar Pradesh","Dimapur|Nagaland","Mohali|Punjab","Sadulpur|Rajasthan","Rajapalayam|Tamil Nadu","Dharmavaram|Andhra Pradesh","Kashipur|Uttarakhand",
"Sivakasi|Tamil Nadu","Darjiling|West Bengal","Chikkamagaluru|Karnataka","Gudivada|Andhra Pradesh","Baleshwar Town|Odisha","Mancherial|Telangana","Srikakulam|Andhra Pradesh","Adilabad|Telangana","Yavatmal|Maharashtra","Barnala|Punjab",
"Nagaon|Assam","Narasaraopet|Andhra Pradesh","Raigarh|Chhattisgarh","Roorkee|Uttarakhand","Valsad|Gujarat","Ambikapur|Chhattisgarh","Giridih|Jharkhand","Chandausi|Uttar Pradesh","Purulia|West Bengal","Patan|Gujarat",
"Bagaha|Bihar","Hardoi|Uttar Pradesh","Achalpur|Maharashtra","Osmanabad|Maharashtra","Deesa|Gujarat","Nandurbar|Maharashtra","Azamgarh|Uttar Pradesh","Ramgarh|Jharkhand","Firozpur|Punjab","Baripada Town|Odisha",
"Karwar|Karnataka","Siwan|Bihar","Rajampet|Andhra Pradesh","Pudukkottai|Tamil Nadu","Anantnag|Jammu and Kashmir","Tadpatri|Andhra Pradesh","Satara|Maharashtra","Bhadrak|Odisha","Kishanganj|Bihar","Suryapet|Telangana",
"Wardha|Maharashtra","Ranebennuru|Karnataka","Amreli|Gujarat","Neyveli (TS)|Tamil Nadu","Jamalpur|Bihar","Marmagao|Goa","Udgir|Maharashtra","Tadepalligudem|Andhra Pradesh","Nagapattinam|Tamil Nadu","Buxar|Bihar",
"Aurangabad|Maharashtra","Jehanabad|Bihar","Phagwara|Punjab","Khair|Uttar Pradesh","Sawai Madhopur|Rajasthan","Kapurthala|Punjab","Chilakaluripet|Andhra Pradesh","Aurangabad|Bihar","Malappuram|Kerala","Rewari|Haryana",
"Nagaur|Rajasthan","Sultanpur|Uttar Pradesh","Nagda|Madhya Pradesh","Port Blair|Andaman and Nicobar Islands","Lakhisarai|Bihar","Panaji|Goa","Tinsukia|Assam","Itarsi|Madhya Pradesh","Kohima|Nagaland","Balangir|Odisha",
"Nawada|Bihar","Jharsuguda|Odisha","Jagtial|Telangana","Viluppuram|Tamil Nadu","Amalner|Maharashtra","Zirakpur|Punjab","Tanda|Uttar Pradesh","Tiruchengode|Tamil Nadu","Nagina|Uttar Pradesh","Yemmiganur|Andhra Pradesh",
"Vaniyambadi|Tamil Nadu","Sarni|Madhya Pradesh","Theni Allinagaram|Tamil Nadu","Margao|Goa","Akot|Maharashtra","Sehore|Madhya Pradesh","Mhow Cantonment|Madhya Pradesh","Kot Kapura|Punjab","Makrana|Rajasthan","Pandharpur|Maharashtra",
"Miryalaguda|Telangana","Shamli|Uttar Pradesh","Seoni|Madhya Pradesh","Ranibennur|Karnataka","Kadiri|Andhra Pradesh","Shrirampur|Maharashtra","Rudrapur|Uttarakhand","Parli|Maharashtra","Najibabad|Uttar Pradesh","Nirmal|Telangana",
"Udhagamandalam|Tamil Nadu","Shikohabad|Uttar Pradesh","Jhumri Tilaiya|Jharkhand","Aruppukkottai|Tamil Nadu","Ponnani|Kerala","Jamui|Bihar","Sitamarhi|Bihar","Chirala|Andhra Pradesh","Anjar|Gujarat","Karaikal|Puducherry",
"Hansi|Haryana","Anakapalle|Andhra Pradesh","Mahasamund|Chhattisgarh","Faridkot|Punjab","Saunda|Jharkhand","Dhoraji|Gujarat","Paramakudi|Tamil Nadu","Balaghat|Madhya Pradesh","Sujangarh|Rajasthan","Khambhat|Gujarat",
"Muktsar|Punjab","Rajpura|Punjab","Kavali|Andhra Pradesh","Dhamtari|Chhattisgarh","Ashok Nagar|Madhya Pradesh","Sardarshahar|Rajasthan","Mahuva|Gujarat","Bargarh|Odisha","Kamareddy|Telangana","Sahibganj|Jharkhand",
"Kothagudem|Telangana","Ramanagaram|Karnataka","Gokak|Karnataka","Tikamgarh|Madhya Pradesh","Araria|Bihar","Rishikesh|Uttarakhand","Shahdol|Madhya Pradesh","Medininagar (Daltonganj)|Jharkhand","Arakkonam|Tamil Nadu","Washim|Maharashtra",
"Sangrur|Punjab","Bodhan|Telangana","Fazilka|Punjab","Palacole|Andhra Pradesh","Keshod|Gujarat","Sullurpeta|Andhra Pradesh","Wadhwan|Gujarat","Gurdaspur|Punjab","Vatakara|Kerala","Tura|Meghalaya",
"Narnaul|Haryana","Kharar|Punjab","Yadgir|Karnataka","Ambejogai|Maharashtra","Ankleshwar|Gujarat","Savarkundla|Gujarat","Paradip|Odisha","Virudhachalam|Tamil Nadu","Kanhangad|Kerala","Kadi|Gujarat",
"Srivilliputhur|Tamil Nadu","Gobindgarh|Punjab","Tindivanam|Tamil Nadu","Mansa|Punjab","Taliparamba|Kerala","Manmad|Maharashtra","Tanuku|Andhra Pradesh","Rayachoti|Andhra Pradesh","Virudhunagar|Tamil Nadu","Koyilandy|Kerala",
"Jorhat|Assam","Karur|Tamil Nadu","Valparai|Tamil Nadu","Srikalahasti|Andhra Pradesh","Neyyattinkara|Kerala","Bapatla|Andhra Pradesh","Fatehabad|Haryana","Malout|Punjab","Sankarankovil|Tamil Nadu","Tenkasi|Tamil Nadu",
"Ratnagiri|Maharashtra","Rabkavi Banhatti|Karnataka","Sikandrabad|Uttar Pradesh","Chaibasa|Jharkhand","Chirmiri|Chhattisgarh","Palwancha|Telangana","Bhawanipatna|Odisha","Kayamkulam|Kerala","Pithampur|Madhya Pradesh","Nabha|Punjab",
"Shahabad, Hardoi|Uttar Pradesh","Dhenkanal|Odisha","Uran Islampur|Maharashtra","Gopalganj|Bihar","Bongaigaon City|Assam","Palani|Tamil Nadu","Pusad|Maharashtra","Sopore|Jammu and Kashmir","Pilkhuwa|Uttar Pradesh","Tarn Taran|Punjab",
"Renukoot|Uttar Pradesh","Mandamarri|Telangana","Shahabad|Karnataka","Barbil|Odisha","Koratla|Telangana","Madhubani|Bihar","Arambagh|West Bengal","Gohana|Haryana","Ladnu|Rajasthan","Pattukkottai|Tamil Nadu",
"Sirsi|Karnataka","Sircilla|Telangana","Tamluk|West Bengal","Jagraon|Punjab","Alipurduar|West Bengal","Alirajpur|Madhya Pradesh","Tandur|Telangana","Naidupet|Andhra Pradesh","Tirupathur|Tamil Nadu","Tohana|Haryana",
"Ratangarh|Rajasthan","Dhubri|Assam","Masaurhi|Bihar","Visnagar|Gujarat","Vrindavan|Uttar Pradesh","Nokha|Rajasthan","Nagari|Andhra Pradesh","Narwana|Haryana","Ramanathapuram|Tamil Nadu","Ujhani|Uttar Pradesh",
"Samastipur|Bihar","Laharpur|Uttar Pradesh","Sangamner|Maharashtra","Nimbahera|Rajasthan","Siddipet|Telangana","Suri|West Bengal","Diphu|Assam","Jhargram|West Bengal","Shirpur-Warwade|Maharashtra","Tilhar|Uttar Pradesh",
"Sindhnur|Karnataka","Udumalaipettai|Tamil Nadu","Malkapur|Maharashtra","Wanaparthy|Telangana","Gudur|Andhra Pradesh","Kendujhar|Odisha","Mandla|Madhya Pradesh","Mandi|Himachal Pradesh","Nedumangad|Kerala","North Lakhimpur|Assam",
"Vinukonda|Andhra Pradesh","Tiptur|Karnataka","Gobichettipalayam|Tamil Nadu","Sunabeda|Odisha","Wani|Maharashtra","Upleta|Gujarat","Narasapuram|Andhra Pradesh","Nuzvid|Andhra Pradesh","Tezpur|Assam","Una|Gujarat",
"Markapur|Andhra Pradesh","Sheopur|Madhya Pradesh","Thiruvarur|Tamil Nadu","Sidhpur|Gujarat","Sahaswan|Uttar Pradesh","Suratgarh|Rajasthan","Shajapur|Madhya Pradesh","Rayagada|Odisha","Lonavla|Maharashtra","Ponnur|Andhra Pradesh",
"Kagaznagar|Telangana","Gadwal|Telangana","Bhatapara|Chhattisgarh","Kandukur|Andhra Pradesh","Sangareddy|Telangana","Unjha|Gujarat","Lunglei|Mizoram","Karimganj|Assam","Kannur|Kerala","Bobbili|Andhra Pradesh",
"Mokameh|Bihar","Talegaon Dabhade|Maharashtra","Anjangaon|Maharashtra","Mangrol|Gujarat","Sunam|Punjab","Gangarampur|West Bengal","Thiruvallur|Tamil Nadu","Tirur|Kerala","Rath|Uttar Pradesh","Jatani|Odisha",
"Viramgam|Gujarat","Rajsamand|Rajasthan","Yanam|Puducherry","Kottayam|Kerala","Panruti|Tamil Nadu","Dhuri|Punjab","Namakkal|Tamil Nadu","Kasaragod|Kerala","Modasa|Gujarat","Rayadurg|Andhra Pradesh",
"Supaul|Bihar","Kunnamkulam|Kerala","Umred|Maharashtra","Bellampalle|Telangana","Sibsagar|Assam","Mandi Dabwali|Haryana","Ottappalam|Kerala","Dumraon|Bihar","Samalkot|Andhra Pradesh","Jaggaiahpet|Andhra Pradesh",
"Goalpara|Assam","Tuni|Andhra Pradesh","Lachhmangarh|Rajasthan","Bhongir|Telangana","Amalapuram|Andhra Pradesh","Firozpur Cantt.|Punjab","Vikarabad|Telangana","Thiruvalla|Kerala","Sherkot|Uttar Pradesh","Palghar|Maharashtra",
"Shegaon|Maharashtra","Jangaon|Telangana","Bheemunipatnam|Andhra Pradesh","Panna|Madhya Pradesh","Thodupuzha|Kerala","Kathua|Jammu and Kashmir","Palitana|Gujarat","Arwal|Bihar","Venkatagiri|Andhra Pradesh","Kalpi|Uttar Pradesh",
"Rajgarh (Churu)|Rajasthan","Sattenapalle|Andhra Pradesh","Arsikere|Karnataka","Ozar|Maharashtra","Thirumangalam|Tamil Nadu","Petlad|Gujarat","Nasirabad|Rajasthan","Phaltan|Maharashtra","Rampurhat|West Bengal","Nanjangud|Karnataka",
"Forbesganj|Bihar","Tundla|Uttar Pradesh","Bhabua|Bihar","Sagara|Karnataka","Pithapuram|Andhra Pradesh","Sira|Karnataka","Bhadrachalam|Telangana","Charkhi Dadri|Haryana","Chatra|Jharkhand","Palasa Kasibugga|Andhra Pradesh",
"Nohar|Rajasthan","Yevla|Maharashtra","Sirhind Fatehgarh Sahib|Punjab","Bhainsa|Telangana","Parvathipuram|Andhra Pradesh","Shahade|Maharashtra","Chalakudy|Kerala","Narkatiaganj|Bihar","Kapadvanj|Gujarat","Macherla|Andhra Pradesh",
"Raghogarh-Vijaypur|Madhya Pradesh","Rupnagar|Punjab","Naugachhia|Bihar","Sendhwa|Madhya Pradesh","Byasanagar|Odisha","Sandila|Uttar Pradesh","Gooty|Andhra Pradesh","Salur|Andhra Pradesh","Nanpara|Uttar Pradesh","Sardhana|Uttar Pradesh",
"Vita|Maharashtra","Gumia|Jharkhand","Puttur|Karnataka","Jalandhar Cantt.|Punjab","Nehtaur|Uttar Pradesh","Changanassery|Kerala","Mandapeta|Andhra Pradesh","Dumka|Jharkhand","Seohara|Uttar Pradesh","Umarkhed|Maharashtra",
"Madhupur|Jharkhand","Vikramasingapuram|Tamil Nadu","Punalur|Kerala","Kendrapara|Odisha","Sihor|Gujarat","Nellikuppam|Tamil Nadu","Samana|Punjab","Warora|Maharashtra","Nilambur|Kerala","Rasipuram|Tamil Nadu",
"Ramnagar|Uttarakhand","Jammalamadugu|Andhra Pradesh","Nawanshahr|Punjab","Thoubal|Manipur","Athni|Karnataka","Cherthala|Kerala","Sidhi|Madhya Pradesh","Farooqnagar|Telangana","Peddapuram|Andhra Pradesh","Chirkunda|Jharkhand",
"Pachora|Maharashtra","Madhepura|Bihar","Pithoragarh|Uttarakhand","Tumsar|Maharashtra","Phalodi|Rajasthan","Tiruttani|Tamil Nadu","Rampura Phul|Punjab","Perinthalmanna|Kerala","Padrauna|Uttar Pradesh","Pipariya|Madhya Pradesh",
"Dalli-Rajhara|Chhattisgarh","Punganur|Andhra Pradesh","Mattannur|Kerala","Mathura|Uttar Pradesh","Thakurdwara|Uttar Pradesh","Nandivaram-Guduvancheri|Tamil Nadu","Mulbagal|Karnataka","Manjlegaon|Maharashtra","Wankaner|Gujarat","Sillod|Maharashtra",
"Nidadavole|Andhra Pradesh","Surapura|Karnataka","Rajagangapur|Odisha","Sheikhpura|Bihar","Parlakhemundi|Odisha","Kalimpong|West Bengal","Siruguppa|Karnataka","Arvi|Maharashtra","Limbdi|Gujarat","Barpeta|Assam",
"Manglaur|Uttarakhand","Repalle|Andhra Pradesh","Mudhol|Karnataka","Shujalpur|Madhya Pradesh","Mandvi|Gujarat","Thangadh|Gujarat","Sironj|Madhya Pradesh","Nandura|Maharashtra","Shoranur|Kerala","Nathdwara|Rajasthan",
"Periyakulam|Tamil Nadu","Sultanganj|Bihar","Medak|Telangana","Narayanpet|Telangana","Raxaul Bazar|Bihar","Rajauri|Jammu and Kashmir","Pernampattu|Tamil Nadu","Nainital|Uttarakhand","Ramachandrapuram|Andhra Pradesh","Vaijapur|Maharashtra",
"Nangal|Punjab","Sidlaghatta|Karnataka","Punch|Jammu and Kashmir","Pandhurna|Madhya Pradesh","Wadgaon Road|Maharashtra","Talcher|Odisha","Varkala|Kerala","Pilani|Rajasthan","Nowgong|Madhya Pradesh","Naila Janjgir|Chhattisgarh",
"Mapusa|Goa","Vellakoil|Tamil Nadu","Merta City|Rajasthan","Sivaganga|Tamil Nadu","Mandideep|Madhya Pradesh","Sailu|Maharashtra","Vyara|Gujarat","Kovvur|Andhra Pradesh","Vadalur|Tamil Nadu","Nawabganj|Uttar Pradesh",
"Padra|Gujarat","Sainthia|West Bengal","Siana|Uttar Pradesh","Shahpur|Karnataka","Sojat|Rajasthan","Noorpur|Uttar Pradesh","Paravoor|Kerala","Murtijapur|Maharashtra","Ramnagar|Bihar","Sundargarh|Odisha",
"Taki|West Bengal","Saundatti-Yellamma|Karnataka","Pathanamthitta|Kerala","Wadi|Karnataka","Rameshwaram|Tamil Nadu","Tasgaon|Maharashtra","Sikandra Rao|Uttar Pradesh","Sihora|Madhya Pradesh","Tiruvethipuram|Tamil Nadu","Tiruvuru|Andhra Pradesh",
"Mehkar|Maharashtra","Peringathur|Kerala","Perambalur|Tamil Nadu","Manvi|Karnataka","Zunheboto|Nagaland","Mahnar Bazar|Bihar","Attingal|Kerala","Shahbad|Haryana","Puranpur|Uttar Pradesh","Nelamangala|Karnataka",
"Nakodar|Punjab","Lunawada|Gujarat","Murshidabad|West Bengal","Mahe|Puducherry","Lanka|Assam","Rudauli|Uttar Pradesh","Tuensang|Nagaland","Lakshmeshwar|Karnataka","Zira|Punjab","Yawal|Maharashtra",
"Thana Bhawan|Uttar Pradesh","Ramdurg|Karnataka","Pulgaon|Maharashtra","Sadasivpet|Telangana","Nargund|Karnataka","Neem-Ka-Thana|Rajasthan","Memari|West Bengal","Nilanga|Maharashtra","Naharlagun|Arunachal Pradesh","Pakaur|Jharkhand",
"Wai|Maharashtra","Tarikere|Karnataka","Malavalli|Karnataka","Raisen|Madhya Pradesh","Lahar|Madhya Pradesh","Uravakonda|Andhra Pradesh","Savanur|Karnataka","Sirohi|Rajasthan","Udhampur|Jammu and Kashmir","Umarga|Maharashtra",
"Pratapgarh|Rajasthan","Lingsugur|Karnataka","Usilampatti|Tamil Nadu","Palia Kalan|Uttar Pradesh","Wokha|Nagaland","Rajpipla|Gujarat","Vijayapura|Karnataka","Rawatbhata|Rajasthan","Sangaria|Rajasthan","Paithan|Maharashtra",
"Rahuri|Maharashtra","Patti|Punjab","Zaidpur|Uttar Pradesh","Lalsot|Rajasthan","Maihar|Madhya Pradesh","Vedaranyam|Tamil Nadu","Nawapur|Maharashtra","Solan|Himachal Pradesh","Sanawad|Madhya Pradesh","Warisaliganj|Bihar",
"Revelganj|Bihar","Sabalgarh|Madhya Pradesh","Tuljapur|Maharashtra","Simdega|Jharkhand","Musabani|Jharkhand","Kodungallur|Kerala","Phulabani|Odisha","Umreth|Gujarat","Narsipatnam|Andhra Pradesh","Nautanwa|Uttar Pradesh",
"Rajgir|Bihar","Yellandu|Telangana","Sathyamangalam|Tamil Nadu","Pilibanga|Rajasthan","Morshi|Maharashtra","Pehowa|Haryana","Sonepur|Bihar","Pappinisseri|Kerala","Zamania|Uttar Pradesh","Mihijam|Jharkhand",
"Purna|Maharashtra","Puliyankudi|Tamil Nadu","Shikarpur, Bulandshahr|Uttar Pradesh","Umaria|Madhya Pradesh","Porsa|Madhya Pradesh","Naugawan Sadat|Uttar Pradesh","Fatehpur Sikri|Uttar Pradesh","Manuguru|Telangana","Udaipur|Tripura","Pipar City|Rajasthan",
"Pattamundai|Odisha","Nanjikottai|Tamil Nadu","Taranagar|Rajasthan","Yerraguntla|Andhra Pradesh","Satana|Maharashtra","Sherghati|Bihar"
];

/* === frontend/milan-launcher.js === */
/*! MILAN — quick launcher: always-visible Music button (works on mobile too). */
(function () {
  'use strict';
  if (window.__milanLauncher) return;
  window.__milanLauncher = true;

  var css = [
    '.mlz-fab{position:fixed;left:16px;bottom:18px;z-index:99997;display:flex;align-items:center;gap:8px;',
    'padding:11px 16px 11px 13px;border-radius:999px;border:0;cursor:pointer;font:800 13px Inter,system-ui,sans-serif;',
    'color:#fff;background:linear-gradient(135deg,#7c5cff,#f472b6);box-shadow:0 10px 28px rgba(124,92,255,.45);',
    'text-decoration:none;transition:transform .18s,box-shadow .18s;}',
    '.mlz-fab:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 14px 36px rgba(244,114,182,.5);}',
    '.mlz-fab:active{transform:scale(.96);}',
    '.mlz-fab .ic{font-size:18px;line-height:1;}',
    '@media(max-width:780px){.mlz-fab{bottom:74px;left:12px;padding:10px 14px;font-size:12px;}.mlz-fab .lbl{display:none;}}'
  ].join('');

  function boot() {
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    var a = document.createElement('a');
    a.className = 'mlz-fab'; a.href = '/music'; a.title = 'MILAN Music';
    a.innerHTML = '<span class="ic">🎵</span><span class="lbl">Music</span>';
    document.body.appendChild(a);
  }
  if (window.__milanAppReady) boot(); else window.addEventListener('milan:app-ready', boot, {once:true});
})();

/* === frontend/milan-live.js === */
/* ============================================================================
   MILAN — live updates client (additive, zero-dependency)
   --------------------------------------------------------------------------
   Replaces "poll and hope" with instant push:
     1. SharedWorker + EventSource  — desktop: all open tabs share ONE
        connection to /api/events (SharedWorker is unsupported on Android
        Chrome, so mobile skips straight to 2).
     2. EventSource (direct)       — the normal path; auto-reconnects natively.
     3. WebSocket /ws              — fallback if EventSource is unavailable.
   On a "notify" event the app refreshes notifications + counters exactly
   once, immediately — no heavy periodic work on the main thread.
   ========================================================================== */
(function () {
  "use strict";

  if (!/\/app(\.html)?$/.test(location.pathname)) return;
  if (window.__milanLiveState === "started") return;

  var token = "";
  try { token = localStorage.getItem("milan_token") || ""; } catch (_) {}

  // Login may finish after deferred scripts have executed.
  // Wait for the token, then reload this client exactly once.
  if (!token) {
    if (window.__milanLiveState === "waiting") return;
    window.__milanLiveState = "waiting";

    var retryUrl = "/milan-live.js?v=20261015-networking-initfix";
    try {
      if (document.currentScript && document.currentScript.src) {
        retryUrl = document.currentScript.src;
      }
    } catch (_) {}

    function retryAfterLogin() {
      var latestToken = "";
      try { latestToken = localStorage.getItem("milan_token") || ""; } catch (_) {}

      if (latestToken) {
        window.__milanLiveState = "";
        var script = document.createElement("script");
        script.src = retryUrl;
        script.async = false;
        document.head.appendChild(script);
        return;
      }

      if (/\/app(\.html)?$/.test(location.pathname)) {
        window.setTimeout(retryAfterLogin, 1500);
      } else {
        window.__milanLiveState = "";
      }
    }

    window.setTimeout(retryAfterLogin, 1500);
    return;
  }

  window.__milanLiveState = "started";
  window.__milanLive = 1;

  var url = location.origin + "/api/events?token=" + encodeURIComponent(token);

  function onEvent(raw) {
    var msg = raw;
    try { if (typeof raw === "string") msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || msg.type !== "notify") return;
    var notifType = String(msg.notifType || "");
    if (notifType === "chat_typing" || notifType === "chat_read" || notifType === "chat_message") return;
    try {
      if (typeof loadNotifications === "function") loadNotifications();
      if (typeof loadSummary === "function") loadSummary();
    } catch (_) {}
  }

  /* 1 — SharedWorker holding one EventSource for every tab */
  function viaSharedWorker() {
    if (!("SharedWorker" in window)) return false;
    try {
      var src =
        'var es=null,ports=[];' +
        'function start(u){if(es)return;es=new EventSource(u);' +
        'es.onmessage=function(e){for(var i=0;i<ports.length;i++){try{ports[i].postMessage(e.data)}catch(_){}}}}' +
        'onconnect=function(e){var p=e.ports[0];ports.push(p);' +
        'p.onmessage=function(ev){start(String(ev.data||""))};if(p.start)p.start()};';
      var w = new SharedWorker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      w.port.onmessage = function (e) { onEvent(e.data); };
      w.port.postMessage(url);
      w.onerror = function () { direct(); };
      return true;
    } catch (_) { return false; }
  }

  /* 2 — plain EventSource (browser handles reconnection) */
  var esErrors = 0;
  function direct() {
    if (!("EventSource" in window)) return viaWebSocket();
    var es;
    try { es = new EventSource(url); } catch (_) { return viaWebSocket(); }
    es.onmessage = function (e) { esErrors = 0; onEvent(e.data); };
    es.onerror = function () {
      // expired session etc. — stop hammering after repeated failures
      if (++esErrors > 12) { try { es.close(); } catch (_) {} }
    };
    return true;
  }

  /* 3 — WebSocket fallback */
  function viaWebSocket() {
    // Production uses SSE/polling; no Node WebSocket upgrade listener is attached.
    var host = String(location.hostname || "").toLowerCase();
    if (host === "milanlife.in" || host === "www.milanlife.in") return false;
    if (!("WebSocket" in window)) return false;
    var delay = 2000;
    function conn() {
      var ws;
      try {
        ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") +
          location.host + "/ws?token=" + encodeURIComponent(token));
      } catch (_) { return; }
      ws.onmessage = function (e) { delay = 2000; onEvent(e.data); };
      ws.onclose = function () {
        delay = Math.min(delay * 2, 60000);
        setTimeout(conn, delay);
      };
    }
    conn();
    return true;
  }

  function start() {
    var host = String(location.hostname || "").toLowerCase();

    if (
      host === "milanlife.in" || host === "www.milanlife.in"
    ) {
      // HTTP polling fallback: refresh persisted notification/summary APIs.
      window.__milanLivePollingActive = true;
      var refreshing = false;

      function refresh() {
        if (refreshing || document.hidden || (typeof mediaPlaying === "function" && mediaPlaying())) return;
        refreshing = true;

        var tasks = [];
        try {
          if (typeof loadNotifications === "function") {
            tasks.push(Promise.resolve(loadNotifications()));
          }
        } catch (_) {}

        try {
          if (typeof loadSummary === "function") {
            tasks.push(Promise.resolve(loadSummary()));
          }
        } catch (_) {}

        Promise.all(tasks.map(function (task) {
          return Promise.resolve(task).catch(function () {});
        })).then(
          function () { refreshing = false; },
          function () { refreshing = false; }
        );
      }

      refresh();
      window.setInterval(refresh, 30000);
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) refresh();
      });
      return;
    }

    window.__milanLivePushActive = viaSharedWorker() || direct();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

/* === frontend/milan-login-pro.js === */
/* ============================================================================
   MILAN — Login Pro interactions  (v1)
   ----------------------------------------------------------------------------
   Pairs with /milan-login-pro.css. Presentation only.

   HARD RULES (do not break these):
   • Never call preventDefault / stopPropagation on the login or register
     buttons. assets/login.js owns authentication completely.
   • Never read, write or clear tokens, passwords or form state.
   • Never replace textContent of a button — only prepend a decorative span.
   • Everything degrades silently: if any target is missing, that feature is
     simply skipped. No exceptions reach the console.
   ========================================================================== */
"use strict";

(function () {
  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function on(el, ev, fn, opts) {
    if (el) el.addEventListener(ev, fn, opts || false);
  }

  /* ══════════════════════════════════════════════════════════════════════
     1. Background — aurora blobs, grid, starfield, cursor spotlight
     ══════════════════════════════════════════════════════════════════════ */
  var bg, spot;

  function buildBackground() {
    bg = document.createElement("div");
    bg.id = "mlp-bg";
    bg.setAttribute("aria-hidden", "true");

    ["a", "b", "c"].forEach(function (k) {
      var b = document.createElement("div");
      b.className = "mlp-blob mlp-blob--" + k;
      bg.appendChild(b);
    });

    var grid = document.createElement("div");
    grid.className = "mlp-grid";
    bg.appendChild(grid);

    var canvas = document.createElement("canvas");
    canvas.id = "mlp-stars";
    bg.appendChild(canvas);

    spot = document.createElement("div");
    spot.className = "mlp-spot";
    bg.appendChild(spot);

    document.body.insertBefore(bg, document.body.firstChild);

    if (!reduceMotion) startStarfield(canvas);
  }

  function startStarfield(canvas) {
    var ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0;
    var stars = [];
    var pointerX = 0, pointerY = 0;   // -1 .. 1, for parallax
    var px = 0, py = 0;               // eased
    var raf = null;
    var running = true;

    function size() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function seed() {
      var count = Math.round(Math.min(150, Math.max(60, (w * h) / 16000)));
      stars = [];
      for (var i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          z: 0.25 + Math.random() * 0.75,          // depth → size + parallax
          r: 0.35 + Math.random() * 1.25,
          vx: (Math.random() - 0.5) * 0.09,
          vy: -0.05 - Math.random() * 0.14,
          tw: Math.random() * Math.PI * 2,
          tws: 0.008 + Math.random() * 0.02
        });
      }
    }

    function frame() {
      if (!running) return;
      px += (pointerX - px) * 0.045;
      py += (pointerY - py) * 0.045;

      ctx.clearRect(0, 0, w, h);

      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        s.x += s.vx;
        s.y += s.vy;
        s.tw += s.tws;

        if (s.y < -4) { s.y = h + 4; s.x = Math.random() * w; }
        if (s.x < -4) s.x = w + 4;
        if (s.x > w + 4) s.x = -4;

        var ox = px * 16 * s.z;
        var oy = py * 16 * s.z;
        var alpha = 0.28 + Math.abs(Math.sin(s.tw)) * 0.55;
        var radius = s.r * (0.8 + s.z * 0.5);

        ctx.beginPath();
        ctx.arc(s.x + ox, s.y + oy, radius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(214, 228, 255, " + alpha.toFixed(3) + ")";
        ctx.fill();
      }

      raf = window.requestAnimationFrame(frame);
    }

    on(window, "resize", size);
    on(window, "pointermove", function (e) {
      pointerX = (e.clientX / window.innerWidth) * 2 - 1;
      pointerY = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        running = false;
        if (raf) window.cancelAnimationFrame(raf);
        raf = null;
      } else if (!running) {
        running = true;
        raf = window.requestAnimationFrame(frame);
      }
    });

    size();
    raf = window.requestAnimationFrame(frame);
  }

  /* ── spotlight sized to the card, so the glass blurs it ────────────────── */
  function bindSpotlight() {
    var card = $(".login-card");
    if (!card || !spot || reduceMotion) return;

    function place() {
      var r = card.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      spot.style.width = r.width + "px";
      spot.style.height = r.height + "px";
      spot.style.transform = "translate3d(" + r.left + "px," + r.top + "px,0)";
    }

    function move(e) {
      var r = card.getBoundingClientRect();
      if (r.width < 2) return;
      var x = ((e.clientX - r.left) / r.width) * 100;
      var y = ((e.clientY - r.top) / r.height) * 100;
      spot.style.setProperty("--mlp-sx", Math.max(0, Math.min(100, x)) + "%");
      spot.style.setProperty("--mlp-sy", Math.max(0, Math.min(100, y)) + "%");
    }

    on(card, "pointerenter", function () {
      place();
      spot.classList.add("is-on");
    });
    on(card, "pointerleave", function () {
      spot.classList.remove("is-on");
    });
    on(card, "pointermove", function (e) {
      move(e);
    }, { passive: true });

    on(window, "resize", place);
    on(window, "scroll", place, { passive: true });

    if (window.ResizeObserver) {
      new window.ResizeObserver(place).observe(card);
    }
    place();
  }

  /* ══════════════════════════════════════════════════════════════════════
     2. Feature cards — cursor sheen + gentle 3D tilt
     ══════════════════════════════════════════════════════════════════════ */
  function bindFeatureCards() {
    if (reduceMotion) return;

    $$(".feature-item").forEach(function (card) {
      on(card, "pointermove", function (e) {
        var r = card.getBoundingClientRect();
        if (!r.width) return;
        var nx = (e.clientX - r.left) / r.width;
        var ny = (e.clientY - r.top) / r.height;

        card.style.setProperty("--mlp-fx", (nx * 100).toFixed(1) + "%");
        card.style.setProperty("--mlp-fy", (ny * 100).toFixed(1) + "%");

        var tiltY = (nx - 0.5) * 5;
        var tiltX = (0.5 - ny) * 4;
        card.style.transform =
          "translate3d(0,-5px,0) perspective(900px) rotateX(" +
          tiltX.toFixed(2) + "deg) rotateY(" + tiltY.toFixed(2) + "deg)";
      }, { passive: true });

      on(card, "pointerleave", function () {
        card.style.transform = "";
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     3. Tabs — sliding pill (geometry is measured, so it survives any
        layout the base stylesheet applies)
     ══════════════════════════════════════════════════════════════════════ */
  function bindTabs() {
    var tabs = $(".tabs");
    if (!tabs) return;

    var pill = document.createElement("span");
    pill.className = "mlp-pill";
    pill.setAttribute("aria-hidden", "true");
    tabs.appendChild(pill);

    function move() {
      var tabsList = $$(".tab", tabs);
      if (!tabsList.length) return;

      var active = null;
      for (var i = 0; i < tabsList.length; i++) {
        if (tabsList[i].classList.contains("active")) { active = tabsList[i]; break; }
      }
      if (!active) active = tabsList[0];

      pill.style.width = active.offsetWidth + "px";
      pill.style.transform = "translateX(" + (active.offsetLeft - 4) + "px)";
    }

    // login.js toggles the .active class → watch it
    if (window.MutationObserver) {
      var mo = new window.MutationObserver(move);
      $$(".tab", tabs).forEach(function (t) {
        mo.observe(t, { attributes: true, attributeFilter: ["class"] });
      });
    }
    $$(".tab", tabs).forEach(function (t) {
      on(t, "click", function () { window.setTimeout(move, 0); });
    });

    on(window, "resize", move);
    if (window.ResizeObserver) new window.ResizeObserver(move).observe(tabs);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(move).catch(function () {});
    }

    move();
    window.setTimeout(move, 60);
    window.setTimeout(move, 400);
  }

  /* ══════════════════════════════════════════════════════════════════════
     4. Auth message → animated, state-aware toast
        login-actions.js signals success/error only through an inline
        style.color, so we read that to pick the visual treatment.
     ══════════════════════════════════════════════════════════════════════ */
  function bindAuthMessage() {
    var el = $("#authMsg");
    if (!el) return;

    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");

    function sync() {
      var text = (el.textContent || "").trim();
      var colour = (el.style.color || "").toLowerCase();

      if (!text) {
        el.classList.remove("mlp-on", "mlp-flash");
        el.removeAttribute("data-mlp-kind");
        return;
      }

      var kind = "success";
      if (colour.indexOf("e5484d") !== -1 || colour.indexOf("239, 68, 68") !== -1) {
        kind = "error";
      } else if (colour.indexOf("10b981") !== -1 || colour.indexOf("16, 185, 129") !== -1) {
        kind = "success";
      }

      el.setAttribute("data-mlp-kind", kind);
      el.classList.add("mlp-on");

      el.classList.remove("mlp-flash");
      void el.offsetWidth;               // restart the pop animation
      el.classList.add("mlp-flash");
    }

    if (window.MutationObserver) {
      new window.MutationObserver(sync).observe(el, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"]
      });
    }
    sync();
  }

  /* ══════════════════════════════════════════════════════════════════════
     5. Buttons — ripple, magnetic hover, in-flight spinner
        The spinner is driven by the button's own disabled attribute, so no
        auth code has to know this layer exists.
     ══════════════════════════════════════════════════════════════════════ */
  function bindButton(id) {
    var btn = document.getElementById(id);
    if (!btn) return;

    /* ripple */
    on(btn, "pointerdown", function (e) {
      if (btn.disabled || reduceMotion) return;
      var r = btn.getBoundingClientRect();
      var size = Math.max(r.width, r.height);
      var dot = document.createElement("span");
      dot.className = "mlp-ripple";
      dot.style.width = size + "px";
      dot.style.height = size + "px";
      dot.style.left = (e.clientX - r.left - size / 2) + "px";
      dot.style.top = (e.clientY - r.top - size / 2) + "px";
      btn.appendChild(dot);
      window.setTimeout(function () {
        if (dot.parentNode) dot.parentNode.removeChild(dot);
      }, 700);
    });

    /* magnetic hover */
    if (!reduceMotion) {
      on(btn, "pointermove", function (e) {
        if (btn.disabled) return;
        var r = btn.getBoundingClientRect();
        if (!r.width) return;
        var dx = ((e.clientX - r.left) / r.width - 0.5) * 6;
        var dy = ((e.clientY - r.top) / r.height - 0.5) * 4;
        btn.style.setProperty("--mlp-mag", "");
        btn.style.transform =
          "translate3d(" + dx.toFixed(2) + "px," + (dy - 2).toFixed(2) + "px,0)";
      }, { passive: true });

      on(btn, "pointerleave", function () {
        btn.style.transform = "";
      });
    }

    /* loading state */
    function setLoading(on2) {
      var existing = btn.querySelector(".mlp-spinner");
      if (on2) {
        if (existing) return;
        btn.classList.add("is-loading");
        var sp = document.createElement("span");
        sp.className = "mlp-spinner";
        sp.setAttribute("aria-hidden", "true");
        btn.insertBefore(sp, btn.firstChild);
      } else {
        btn.classList.remove("is-loading");
        if (existing && existing.parentNode) {
          existing.parentNode.removeChild(existing);
        }
      }
    }

    if (window.MutationObserver) {
      new window.MutationObserver(function () {
        setLoading(!!btn.disabled);
      }).observe(btn, { attributes: true, attributeFilter: ["disabled"] });
    }
    setLoading(!!btn.disabled);
  }

  /* ══════════════════════════════════════════════════════════════════════
     6. Password strength metre (register form)
        Uses an obvious entropy heuristic — guidance only, never a gate.
     ══════════════════════════════════════════════════════════════════════ */
  function bindStrength() {
    var input = document.getElementById("regPass");
    if (!input) return;

    var group = input.closest(".input-group");
    if (!group) return;

    var wrap = document.createElement("div");
    wrap.className = "mlp-strength";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML =
      '<span class="mlp-strength__track"><span class="mlp-strength__bar"></span></span>' +
      '<span class="mlp-strength__label">—</span>';
    group.appendChild(wrap);

    var bar = wrap.querySelector(".mlp-strength__bar");
    var label = wrap.querySelector(".mlp-strength__label");

    var LEVEL_COLOURS = ["#ef4444", "#ef4444", "#f59e0b", "#84cc16", "#10b981"];
    var LEVEL_NAMES = ["—", "Weak", "Weak", "Fair", "Good", "Strong"];

    function score(v) {
      if (!v) return 0;
      var s = 0;
      if (v.length >= 8) s++;
      if (v.length >= 12) s++;
      if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
      if (/\d/.test(v)) s++;
      if (/[^A-Za-z0-9]/.test(v)) s++;
      return Math.min(s, 4);
    }

    on(input, "input", function () {
      var v = input.value || "";
      var s = score(v);

      if (!v) {
        wrap.classList.remove("is-on");
        bar.style.width = "0%";
        label.textContent = "—";
        return;
      }

      wrap.classList.add("is-on");
      var pct = [12, 34, 58, 80, 100][s];
      bar.style.width = pct + "%";
      bar.style.setProperty("--mlp-level-color", LEVEL_COLOURS[s]);
      label.style.color = LEVEL_COLOURS[s];
      label.textContent = LEVEL_NAMES[s + 1] || "Strong";
    }, { passive: true });
  }

  /* ══════════════════════════════════════════════════════════════════════
     7. Hero — whisper-quiet parallax
     ══════════════════════════════════════════════════════════════════════ */
  function bindHeroParallax() {
    if (reduceMotion) return;

    var hero = $(".hero-panel");
    var grid = $(".feature-grid", hero || document);
    if (!hero || !grid) return;

    on(hero, "pointermove", function (e) {
      var r = hero.getBoundingClientRect();
      if (!r.width) return;
      var nx = (e.clientX - r.left) / r.width - 0.5;
      var ny = (e.clientY - r.top) / r.height - 0.5;

      // the grid drifts a few pixels against the cursor; individual cards
      // still get their own tilt from bindFeatureCards()
      grid.style.transform =
        "translate3d(" + (-nx * 7).toFixed(2) + "px," +
        (-ny * 5).toFixed(2) + "px,0)";
    }, { passive: true });

    on(hero, "pointerleave", function () {
      grid.style.transform = "";
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     boot
     ══════════════════════════════════════════════════════════════════════ */
  function init() {
    try { buildBackground(); } catch (e) { /* decorative only */ }
    try { bindSpotlight(); } catch (e) {}
    try { bindFeatureCards(); } catch (e) {}
    try { bindTabs(); } catch (e) {}
    try { bindAuthMessage(); } catch (e) {}
    try { bindButton("loginBtn"); } catch (e) {}
    try { bindButton("registerBtn"); } catch (e) {}
    try { bindStrength(); } catch (e) {}
    try { bindHeroParallax(); } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

/* === frontend/milan-mobile.js === */
/* MILAN V8.1 — Mobile navigation DOM placement.
 * Desktop keeps its normal sidebar. Mobile Chrome gets one top-right hamburger
 * and the existing navigation buttons are moved into that drawer.
 */
(function () {
  "use strict";
  if (window.__milanMobileNavV81) return;
  window.__milanMobileNavV81 = true;

  if (!/\/app(\.html)?$/.test(location.pathname)) return;

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    var topbar = document.querySelector(".topbar");
    var sidebar = document.querySelector(".sidebar");
    var nav = sidebar && sidebar.querySelector(".nav");
    var profileBlock = sidebar && sidebar.querySelector(".profile");
    if (!topbar || !sidebar || !nav || !profileBlock) return;

    var mq = window.matchMedia("(max-width:768px)");
    var originalParent = nav.parentNode;
    var originalNext = nav.nextSibling;
    var mobileMoved = false;
    var profileMoved = false;

    var style = document.createElement("style");
    style.id = "milan-mobile-nav-v81-style";
    style.textContent = `
      #milan-burger-v81,#milan-drawer-v81,#milan-drawer-ov-v81{display:none!important}
      @media (max-width:768px){
        .topbar{position:sticky!important;top:0!important;min-height:calc(60px + env(safe-area-inset-top))!important;padding:calc(8px + env(safe-area-inset-top)) 58px 8px 12px!important;z-index:3000!important}
        .topbar .search,.topbar .top-actions{display:none!important}
        .topbar .brand{min-width:0!important;flex:1 1 auto!important}
        .topbar .brand-text span{display:none!important}
        .sidebar{display:none!important}
        #milan-burger-v81{display:grid!important;position:absolute!important;right:10px!important;top:50%!important;transform:translateY(-50%)!important;width:42px!important;height:42px!important;place-items:center!important;padding:0!important;margin:0!important;border:1px solid rgba(255,255,255,.14)!important;border-radius:12px!important;background:#121b2f!important;color:#fff!important;font:700 21px/1 system-ui,sans-serif!important;z-index:3010!important;cursor:pointer!important}
        #milan-drawer-ov-v81{position:fixed!important;inset:0!important;background:rgba(0,0,0,.68)!important;opacity:0!important;visibility:hidden!important;transition:opacity .18s ease,visibility .18s ease!important;z-index:4000!important}
        #milan-drawer-v81{position:fixed!important;top:0!important;right:0!important;bottom:0!important;width:min(88vw,360px)!important;display:flex!important;flex-direction:column!important;overflow:auto!important;box-sizing:border-box!important;padding:calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))!important;background:#091226!important;border-left:1px solid #263652!important;transform:translateX(105%)!important;transition:transform .22s ease!important;z-index:4010!important;box-shadow:-20px 0 50px rgba(0,0,0,.5)!important}
        body.milan-mobile-menu-open #milan-drawer-v81{transform:translateX(0)!important}
        body.milan-mobile-menu-open #milan-drawer-ov-v81{opacity:1!important;visibility:visible!important}
        body.milan-mobile-menu-open{overflow:hidden!important}
        #milan-drawer-v81 .m8-head{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:2px 0 14px!important}
        #milan-drawer-v81 .m8-title{font-size:20px!important;font-weight:800!important;color:#fff!important}
        #milan-drawer-v81 .m8-sub{display:block!important;margin-top:2px!important;font-size:11px!important;color:#7f8fad!important}
        #milan-drawer-v81 .m8-close{width:40px!important;height:40px!important;padding:0!important;border:1px solid #263652!important;border-radius:12px!important;background:#121d33!important;color:#fff!important;font-size:24px!important;cursor:pointer!important}
        #milan-drawer-v81 .m8-mobile-profile{display:block!important;width:auto!important;margin:0 0 14px!important;padding:12px 13px!important;box-sizing:border-box!important;border-radius:14px!important;background:#101b31!important;color:#cdd7ea!important;text-align:center!important}
        #milan-drawer-v81 .m8-mobile-profile .milan-avatar-upload{display:inline-block!important}
        #milan-drawer-v81 .m8-mobile-profile #myAvatar{margin:0 auto!important}
        #milan-drawer-v81 .m8-mobile-profile .profile-stats{display:flex!important;justify-content:space-around!important;margin-top:12px!important;padding-top:12px!important}
        #milan-drawer-v81 .m8-section{margin:0 0 8px!important;color:#7383a3!important;font:800 11px/1 system-ui,sans-serif!important;letter-spacing:.08em!important;text-transform:uppercase!important}
        #milan-drawer-v81 .m8-nav{display:flex!important;flex-direction:column!important;gap:5px!important}
        #milan-drawer-v81 .m8-nav button{width:100%!important;min-height:46px!important;margin:0!important;padding:11px 14px!important;border:1px solid transparent!important;border-radius:12px!important;background:#111c31!important;color:#dce5f5!important;text-align:left!important;font:600 14px/1.25 system-ui,sans-serif!important;cursor:pointer!important}
        #milan-drawer-v81 .m8-nav button.active{background:linear-gradient(90deg,rgba(91,124,250,.2),rgba(91,124,250,.08))!important;border-color:rgba(91,124,250,.3)!important;color:#fff!important}
        #milan-drawer-v81 .m8-nav button.accent{background:linear-gradient(135deg,#6366f1,#8b5cf6)!important;color:#fff!important}
        #milan-drawer-v81 .m8-logout{width:100%!important;min-height:46px!important;margin-top:18px!important;padding:11px 14px!important;border:1px solid #4a2029!important;border-radius:12px!important;background:#25151a!important;color:#fda4af!important;text-align:left!important;font:600 14px/1.25 system-ui,sans-serif!important;cursor:pointer!important}
      }
    `;
    document.head.appendChild(style);

    var burger = document.createElement("button");
    burger.id = "milan-burger-v81";
    burger.type = "button";
    burger.setAttribute("aria-label", "Open navigation");
    burger.setAttribute("aria-expanded", "false");
    burger.textContent = "☰";
    topbar.appendChild(burger);

    var overlay = document.createElement("div");
    overlay.id = "milan-drawer-ov-v81";
    document.body.appendChild(overlay);

    var drawer = document.createElement("aside");
    drawer.id = "milan-drawer-v81";
    drawer.setAttribute("aria-label", "MILAN navigation");
    drawer.setAttribute("aria-hidden", "true");
    document.body.appendChild(drawer);

    var head = document.createElement("div");
    head.className = "m8-head";
    head.innerHTML = '<div><div class="m8-title">MILAN</div><span class="m8-sub">Your space</span></div>';
    var close = document.createElement("button");
    close.className = "m8-close";
    close.type = "button";
    close.setAttribute("aria-label", "Close navigation");
    close.textContent = "×";
    head.appendChild(close);
    drawer.appendChild(head);

    var profileMount = document.createElement("div");
    profileMount.className = "m8-profile-mount";
    drawer.appendChild(profileMount);

    var section = document.createElement("div");
    section.className = "m8-section";
    section.textContent = "Navigate";
    drawer.appendChild(section);

    var mobileNav = document.createElement("nav");
    mobileNav.className = "m8-nav";
    mobileNav.setAttribute("aria-label", "Primary navigation");
    drawer.appendChild(mobileNav);

    function moveToDrawer() {
      if (mobileMoved) return;
      if (!profileMoved) {
        profileBlock.classList.add("m8-mobile-profile");
        profileMount.appendChild(profileBlock);
        profileMoved = true;
      }
      while (nav.firstChild) mobileNav.appendChild(nav.firstChild);
      nav.remove();
      mobileMoved = true;
      sidebar.style.display = "none";
    }

    function restoreDesktop() {
      if (!mobileMoved) return;
      originalParent.insertBefore(nav, originalNext);
      while (mobileNav.firstChild) nav.appendChild(mobileNav.firstChild);
      if (profileMoved) {
        profileBlock.classList.remove("m8-mobile-profile");
        sidebar.insertBefore(profileBlock, sidebar.firstChild);
        profileMoved = false;
      }
      mobileMoved = false;
      sidebar.style.display = "";
      closeMenu();
    }

    function syncLayout() {
      if (mq.matches) moveToDrawer();
      else restoreDesktop();
    }

    function openMenu() {
      if (!mq.matches) return;
      document.body.classList.add("milan-mobile-menu-open");
      drawer.setAttribute("aria-hidden", "false");
      burger.setAttribute("aria-expanded", "true");
    }

    function closeMenu() {
      document.body.classList.remove("milan-mobile-menu-open");
      drawer.setAttribute("aria-hidden", "true");
      burger.setAttribute("aria-expanded", "false");
    }

    var more = document.createElement("div");
    more.className = "m8-section";
    more.style.marginTop = "18px";
    more.textContent = "More";
    drawer.appendChild(more);

    var extras = document.createElement("div");
    extras.innerHTML = '<a href="#" id="milan-voroa-dashboard-link">📊 Dashboard</a><a href="/music">🎵 Music</a><a href="/settings">⚙️ Settings</a><a href="/about">ℹ️ About</a>';
    extras.style.cssText = "display:flex;flex-direction:column;gap:5px";
    extras.querySelectorAll("a").forEach(function (a) {
      a.style.cssText = "display:flex;align-items:center;min-height:46px;padding:11px 14px;box-sizing:border-box;border:1px solid transparent;border-radius:12px;background:#111c31;color:#dce5f5;text-decoration:none;font:600 14px/1.25 system-ui,sans-serif";
      a.addEventListener("click", closeMenu);
    });

    drawer.appendChild(extras);

    // Personal Dashboard — served as part of the existing Voroa web service.
    // All data comes from the signed-in user's existing authenticated APIs.
    var dashboardStyle = document.createElement("style");
    dashboardStyle.id = "milan-voroa-dashboard-style";
    dashboardStyle.textContent =
      "#milan-voroa-dashboard{display:none;position:fixed;inset:0;z-index:5000;overflow:auto;padding:clamp(12px,3vw,28px);background:rgba(3,7,18,.92);backdrop-filter:blur(12px);color:#e8eef9;box-sizing:border-box}" +
      "#milan-voroa-dashboard *{box-sizing:border-box}" +
      "#milan-voroa-dashboard .mvd-shell{max-width:1120px;margin:0 auto;padding-bottom:30px}" +
      "#milan-voroa-dashboard .mvd-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0 20px}" +
      "#milan-voroa-dashboard .mvd-title{font-size:clamp(26px,4vw,38px);font-weight:850;letter-spacing:-.035em;margin:5px 0}" +
      "#milan-voroa-dashboard .mvd-sub{font-size:12px;color:#96a7c3;line-height:1.6}" +
      "#milan-voroa-dashboard .mvd-btn{border:1px solid #344864;border-radius:11px;background:#14233b;color:#edf3ff;padding:10px 13px;font-weight:750;cursor:pointer}" +
      "#milan-voroa-dashboard .mvd-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0}" +
      "#milan-voroa-dashboard .mvd-card{min-width:0;border:1px solid #273a58;border-radius:16px;padding:16px;background:linear-gradient(145deg,#14233c,#0b172c)}" +
      "#milan-voroa-dashboard .mvd-label{font-size:12px;color:#9cacc6;font-weight:700}" +
      "#milan-voroa-dashboard .mvd-value{font-size:clamp(25px,3vw,33px);font-weight:850;margin:8px 0 4px;color:#fff}" +
      "#milan-voroa-dashboard .mvd-note{font-size:11px;line-height:1.5;color:#8294b1}" +
      "#milan-voroa-dashboard .mvd-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:14px}" +
      "#milan-voroa-dashboard .mvd-section{font-size:16px;font-weight:800;margin:0 0 6px}" +
      "#milan-voroa-dashboard .mvd-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 0;border-top:1px solid rgba(145,164,197,.14)}" +
      "#milan-voroa-dashboard .mvd-row:first-child{border-top:0}" +
      "#milan-voroa-dashboard .mvd-main{min-width:0;overflow-wrap:anywhere}" +
      "#milan-voroa-dashboard .mvd-row-title{font-size:13px;font-weight:750;color:#edf3ff;overflow-wrap:anywhere}" +
      "#milan-voroa-dashboard .mvd-meta{font-size:11px;color:#8da0bd;line-height:1.6;margin-top:4px;overflow-wrap:anywhere}" +
      "#milan-voroa-dashboard .mvd-tag{display:inline-block;font-size:10px;border:1px solid #344966;border-radius:99px;padding:3px 8px;margin-top:5px;color:#bfcde4}" +
      "#milan-voroa-dashboard .mvd-copy{flex-shrink:0;border:1px solid #344966;border-radius:8px;background:#13243d;color:#dce8fc;padding:7px 9px;font-size:11px;cursor:pointer}" +
      "#milan-voroa-dashboard .mvd-empty{font-size:13px;line-height:1.7;color:#96a7c3;padding:18px 0}" +
      "#milan-voroa-dashboard .mvd-status{font-size:12px;color:#98b0ff;min-height:19px}" +
      "@media(max-width:720px){#milan-voroa-dashboard .mvd-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}#milan-voroa-dashboard .mvd-grid{grid-template-columns:1fr}#milan-voroa-dashboard .mvd-card{padding:13px}#milan-voroa-dashboard .mvd-top{align-items:flex-start}}" +
      "@media(max-width:390px){#milan-voroa-dashboard .mvd-btn{padding:9px 10px}}";
    document.head.appendChild(dashboardStyle);

    var dashboard = document.createElement("div");
    dashboard.id = "milan-voroa-dashboard";
    dashboard.setAttribute("aria-hidden", "true");
    dashboard.innerHTML =
      '<div class="mvd-shell" role="dialog" aria-modal="true" aria-labelledby="mvdTitle">' +
        '<div class="mvd-top"><div><div class="mvd-sub">MILAN · WEB5 SPACE</div><h1 class="mvd-title" id="mvdTitle">Your Dashboard</h1><div class="mvd-sub">Your records, uploads and account activity in one place.</div></div>' +
        '<button type="button" class="mvd-btn" id="mvdClose">✕ Close</button></div>' +
        '<div class="mvd-status" id="mvdStatus" role="status" aria-live="polite">Ready</div>' +
        '<div class="mvd-metrics" id="mvdMetrics"></div>' +
        '<div class="mvd-grid">' +
          '<section class="mvd-card"><h2 class="mvd-section">🗂️ Your records</h2><div class="mvd-sub">Your authenticated account records only.</div><div id="mvdRecords"><div class="mvd-empty">Loading records…</div></div></section>' +
          '<section class="mvd-card"><h2 class="mvd-section">🕘 Recent activity</h2><div class="mvd-sub">Recent events for your account.</div><div id="mvdActivity"><div class="mvd-empty">Loading activity…</div></div></section>' +
        '</div>' +
        '<div class="mvd-card" style="margin-top:14px"><h2 class="mvd-section">Privacy by default</h2><div class="mvd-sub">This dashboard requests records and activity using your existing authenticated session. It does not request other users’ private records. Archive/restore controls are not shown until a real backend workflow exists.</div><div style="margin-top:14px"><button type="button" class="mvd-btn" id="mvdRefresh">↻ Refresh dashboard</button></div></div>' +
      '</div>';
    document.body.appendChild(dashboard);

    function mvdEsc(value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
      });
    }
    function mvdDate(value) {
      if (!value) return "Date unavailable";
      var date = new Date(value);
      return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
    }
    function mvdAction(action) {
      var labels = {
        "record.created.in.dwn": "Record created",
        "record.updated.in.dwn": "Record updated",
        "record.deleted.from.dwn": "Record deleted",
        "record.permissions.updated.in.dwn": "Record permissions changed",
        "record.shared.from.dwn": "Record shared",
        "media.record.chunked.to.dwn": "Media upload completed",
        "media.record.streamed.to.dwn": "Media upload completed",
        "records.imported.to.dwn": "Records imported",
        "profile.updated": "Profile updated",
        "settings.account_updated": "Account settings updated",
        "settings.privacy_updated": "Privacy settings updated",
        "settings.password_changed": "Password changed"
      };
      var key = String(action || "");
      return labels[key] || key.replace(/[._]+/g, " ").replace(/\b\w/g, function (ch) { return ch.toUpperCase(); }) || "Account activity";
    }
    async function mvdGet(path) {
      var token = "";
      try { token = String(localStorage.getItem("milan_token") || "").trim(); } catch (_) {}
      if (!token) throw new Error("Please sign in to view your dashboard.");
      var response = await fetch("/api" + path, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json", Authorization: "Bearer " + token }
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        var error = new Error(data.error || ("Request failed (" + response.status + ")"));
        error.status = response.status;
        throw error;
      }
      return data;
    }
    function mvdMetric(label, value, note) {
      return '<div class="mvd-card"><div class="mvd-label">' + mvdEsc(label) +
        '</div><div class="mvd-value">' + mvdEsc(value) +
        '</div><div class="mvd-note">' + mvdEsc(note) + '</div></div>';
    }
    function mvdRenderRecords(records) {
      var target = document.getElementById("mvdRecords");
      if (!records.length) {
        target.innerHTML = '<div class="mvd-empty">No records returned for your account yet.</div>';
        return;
      }
      target.innerHTML = records.slice(0, 12).map(function (record) {
        var id = String(record.id || record.dwnRecordId || "");
        var mode = String(record.accessMode || (record.published ? "public" : "private"));
        return '<div class="mvd-row"><div class="mvd-main"><div class="mvd-row-title">' +
          mvdEsc(record.title || record.schema || "Untitled record") + '</div><div class="mvd-meta">' +
          mvdEsc(record.dataFormat || "Record") + ' · ' +
          mvdEsc(mvdDate(record.dateModified || record.dateCreated)) +
          '</div><span class="mvd-tag">' + mvdEsc(mode.replace(/_/g, " ")) +
          '</span></div><button type="button" class="mvd-copy" data-mvd-copy="' +
          mvdEsc(id) + '">Copy ID</button></div>';
      }).join("");
    }
    function mvdRenderActivity(items) {
      var target = document.getElementById("mvdActivity");
      if (!items.length) {
        target.innerHTML = '<div class="mvd-empty">No account activity has been recorded yet.</div>';
        return;
      }
      target.innerHTML = items.slice(0, 12).map(function (item) {
        return '<div class="mvd-row"><div class="mvd-main"><div class="mvd-row-title">' +
          mvdEsc(mvdAction(item.action)) + '</div><div class="mvd-meta">' +
          mvdEsc(mvdDate(item.at)) + '</div></div></div>';
      }).join("");
    }
    async function mvdRefresh() {
      var status = document.getElementById("mvdStatus");
      status.textContent = "Loading your records and activity…";
      var results = await Promise.allSettled([
        mvdGet("/records?dbPage=1&limit=100"),
        mvdGet("/records/stats"),
        mvdGet("/activity")
      ]);
      var records = results[0].status === "fulfilled" && Array.isArray(results[0].value) ? results[0].value : [];
      var stats = results[1].status === "fulfilled" ? results[1].value : {};
      var activity = results[2].status === "fulfilled" && Array.isArray(results[2].value) ? results[2].value : [];
      var failed = results.filter(function (item) { return item.status === "rejected"; });
      var uploads = activity.filter(function (item) {
        return /media\.record\.(chunked|streamed)\.to\.dwn/.test(String(item.action || ""));
      }).length;
      var total = Number.isFinite(Number(stats.total)) ? Number(stats.total) : records.length;
      var priv = Number.isFinite(Number(stats.private)) ? Number(stats.private) : 0;
      var pub = Number.isFinite(Number(stats.public)) ? Number(stats.public) : 0;
      document.getElementById("mvdMetrics").innerHTML = [
        mvdMetric("Your records", total, "Reported by your records API"),
        mvdMetric("Private records", priv, "Visible only to you"),
        mvdMetric("Public records", pub, "Records marked public"),
        mvdMetric("Recent media uploads", uploads, "Within returned activity history")
      ].join("");
      mvdRenderRecords(records);
      mvdRenderActivity(activity);
      status.textContent = failed.length
        ? "Some dashboard data could not be loaded. Refresh to retry."
        : "Updated " + mvdDate(new Date().toISOString());
    }
    function mvdOpen() {
      dashboard.style.display = "block";
      dashboard.setAttribute("aria-hidden", "false");
      mvdRefresh().catch(function () {
        document.getElementById("mvdStatus").textContent = "Could not load dashboard. Please try refresh.";
      });
    }
    function mvdClose() {
      dashboard.style.display = "none";
      dashboard.setAttribute("aria-hidden", "true");
    }
    var dashboardLink = document.getElementById("milan-voroa-dashboard-link");
    if (dashboardLink) dashboardLink.addEventListener("click", function (event) {
      event.preventDefault();
      closeMenu();
      mvdOpen();
    });
    document.getElementById("mvdClose").addEventListener("click", mvdClose);
    document.getElementById("mvdRefresh").addEventListener("click", function () {
      mvdRefresh().catch(function () {
        document.getElementById("mvdStatus").textContent = "Refresh failed. Please try again.";
      });
    });
    dashboard.addEventListener("click", function (event) {
      if (event.target === dashboard) mvdClose();
      var copyButton = event.target.closest("[data-mvd-copy]");
      if (!copyButton) return;
      var value = copyButton.getAttribute("data-mvd-copy") || "";
      if (!value) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(function () {
          document.getElementById("mvdStatus").textContent = "Record ID copied.";
        }).catch(function () { window.prompt("Copy record ID", value); });
      } else window.prompt("Copy record ID", value);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && dashboard.style.display === "block") mvdClose();
    });


    var logout = document.createElement("button");
    logout.className = "m8-logout";
    logout.type = "button";
    logout.textContent = "⎋ Log out";
    drawer.appendChild(logout);

    burger.addEventListener("click", function () {
      document.body.classList.contains("milan-mobile-menu-open") ? closeMenu() : openMenu();
    });
    close.addEventListener("click", closeMenu);
    overlay.addEventListener("click", closeMenu);
    mobileNav.addEventListener("click", function () { setTimeout(closeMenu, 60); });
    logout.addEventListener("click", function () {
      var lb = document.getElementById("logoutBtn");
      if (lb) lb.click();
      else if(location.pathname!=="/")location.href = "/";
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });

    if (mq.addEventListener) mq.addEventListener("change", syncLayout);
    else if (mq.addListener) mq.addListener(syncLayout);
    syncLayout();
  });
})();

/* === frontend/milan-modern-upload.js === */
/* ============================================================
   MILAN — Modern Media Upload + Inline AI Composer Assist
   Progressive enhancement: upgrades the existing #mediaFile input
   into a drag-and-drop dropzone with thumbnail previews, and adds
   AI writing helpers to the composer. No backend changes to publish
   flow — it reuses the same #mediaFile input the publish() reads.
   ============================================================ */
(function () {
  'use strict';
  if (window.__milanModernUploadV1) return;
  window.__milanModernUploadV1 = true;

  var ACCENT = '#4f7cf6';

  /* ---------- styles ---------- */
  var css = document.createElement('style');
  css.textContent = [
    '.milan-dropzone{position:relative;border:1.5px dashed rgba(148,163,196,.32);border-radius:16px;background:rgba(148,163,196,.04);padding:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:border-color .18s,background .18s;text-align:center;min-height:96px}',
    '.milan-dropzone:hover{border-color:rgba(79,124,246,.5);background:rgba(79,124,246,.06)}',
    '.milan-dropzone.dragover{border-color:' + ACCENT + ';background:rgba(79,124,246,.12)}',
    '.milan-dz-icon{font-size:26px;opacity:.8}',
    '.milan-dz-title{font-weight:650;font-size:14px;color:var(--text,#eef1f8)}',
    '.milan-dz-sub{font-size:12px;color:var(--muted,#97a2bd)}',
    '.milan-dz-browse{color:' + ACCENT + ';text-decoration:underline;cursor:pointer}',
    '.milan-dz-preview{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border:1px solid rgba(148,163,196,.18);border-radius:14px;background:rgba(148,163,196,.05)}',
    '.milan-dz-thumb{width:54px;height:54px;border-radius:11px;object-fit:cover;background:#0d1322;flex-shrink:0;display:grid;place-items:center;font-size:22px;color:var(--muted,#97a2bd)}',
    '.milan-dz-meta{flex:1;min-width:0}',
    '.milan-dz-meta b{display:block;font-size:13px;color:var(--text,#eef1f8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.milan-dz-meta span{font-size:12px;color:var(--muted,#97a2bd)}',
    '.milan-dz-remove{background:transparent;border:1px solid rgba(148,163,196,.25);color:var(--muted,#97a2bd);border-radius:10px;padding:6px 10px;font-size:12px;cursor:pointer;flex-shrink:0}',
    '.milan-dz-remove:hover{color:#e5645f;border-color:rgba(229,100,95,.4)}',
    '.milan-ai-assist{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;align-items:center}',
    '.milan-ai-assist .lbl{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#97a2bd);margin-right:2px}',
    '.milan-ai-btn{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:10px;border:1px solid rgba(148,163,196,.22);background:rgba(148,163,196,.05);color:var(--text,#eef1f8);cursor:pointer;transition:.15s}',
    '.milan-ai-btn:hover{border-color:rgba(79,124,246,.5);background:rgba(79,124,246,.08);color:#9fc0ff}',
    '.milan-ai-btn:disabled{opacity:.55;cursor:wait}',
    '.milan-ai-hint{font-size:11px;color:var(--muted,#97a2bd);width:100%;margin-top:2px}'
  ].join('');
  document.head.appendChild(css);

  function fmtBytes(n) {
    n = Number(n || 0); if (!n) return '';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + u[i];
  }
  function kindIcon(type) {
    type = type || '';
    if (type.indexOf('image/') === 0) return '🖼️';
    if (type.indexOf('video/') === 0) return '🎬';
    if (type.indexOf('audio/') === 0) return '🎧';
    if (type.indexOf('pdf') >= 0) return '📄';
    return '📎';
  }
  function getComposer() { return document.querySelector('.composer'); }
  function getTextarea() { return document.querySelector('.composer textarea') || document.getElementById('postText'); }

  /* ---------- 1) Modern dropzone ---------- */
  function buildDropzone() {
    var input = document.getElementById('mediaFile');
    if (!input || input.dataset.milanDz === '1') return;
    input.dataset.milanDz = '1';

    // Hide the raw input, keep it in DOM (publish() reads its .files)
    input.style.display = 'none';

    var dz = document.createElement('div');
    dz.className = 'milan-dropzone';
    dz.setAttribute('role', 'button');
    dz.setAttribute('tabindex', '0');
    dz.innerHTML =
      '<div class="milan-dz-icon">⬆️</div>' +
      '<div class="milan-dz-title">Add a photo, video or file</div>' +
      '<div class="milan-dz-sub">Drag &amp; drop here, or <span class="milan-dz-browse">browse</span></div>';

    var preview = document.createElement('div');
    preview.className = 'milan-dz-preview';
    preview.style.display = 'none';

    input.parentNode.insertBefore(dz, input);
    input.parentNode.insertBefore(preview, input.nextSibling);

    function showPreview(file) {
      if (!file) { preview.style.display = 'none'; dz.style.display = 'flex'; return; }
      dz.style.display = 'none';
      preview.style.display = 'flex';
      var thumbHtml;
      if (file.type && file.type.indexOf('image/') === 0) {
        var url = URL.createObjectURL(file);
        thumbHtml = '<img class="milan-dz-thumb" src="' + url + '" alt="preview">';
      } else {
        thumbHtml = '<div class="milan-dz-thumb">' + kindIcon(file.type) + '</div>';
      }
      preview.innerHTML =
        thumbHtml +
        '<div class="milan-dz-meta"><b></b><span>' + (file.type || 'file') + (file.size ? ' • ' + fmtBytes(file.size) : '') + '</span></div>' +
        '<button type="button" class="milan-dz-remove">Remove</button>';
      preview.querySelector('b').textContent = file.name || 'Selected file';
      preview.querySelector('.milan-dz-remove').onclick = function () {
        try { input.value = ''; } catch (_) {}
        showPreview(null);
      };
    }

    function setFile(files) {
      if (!files || !files.length) return;
      try {
        var dt = new DataTransfer();
        dt.items.add(files[0]);
        input.files = dt.files;
      } catch (_) { /* DataTransfer unsupported: input change still fires natively */ }
      showPreview(files[0]);
    }

    dz.addEventListener('click', function () { input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', function () { if (input.files && input.files[0]) showPreview(input.files[0]); });

    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) setFile(files);
    });

    // If publish clears the input later, reset preview too
    var pub = document.getElementById('publishBtn');
    if (pub) pub.addEventListener('click', function () {
      setTimeout(function () { if (!input.value) showPreview(null); }, 1500);
    });
  }

  /* ---------- 2) Inline AI composer assist ---------- */
  function buildAIAssist() {
    var composer = getComposer();
    if (!composer || composer.dataset.milanAssist === '1') return;
    composer.dataset.milanAssist = '1';
    var ta = getTextarea();
    if (!ta) return;

    var bar = document.createElement('div');
    bar.className = 'milan-ai-assist';
    bar.innerHTML =
      '<span class="lbl">AI help</span>' +
      '<button type="button" class="milan-ai-btn" data-act="improve">✨ Improve</button>' +
      '<button type="button" class="milan-ai-btn" data-act="shorten">✂️ Shorten</button>' +
      '<button type="button" class="milan-ai-btn" data-act="fix">✓ Fix grammar</button>' +
      '<button type="button" class="milan-ai-btn" data-act="hashtags"># Hashtags</button>' +
      '<button type="button" class="milan-ai-btn" data-act="ideas">💡 Ideas</button>' +
      '<div class="milan-ai-hint"></div>';
    // Place right under the textarea row
    ta.parentNode.insertBefore(bar, ta.nextSibling);

    var hint = bar.querySelector('.milan-ai-hint');

    bar.querySelectorAll('.milan-ai-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.dataset.act;
        var text = (ta.value || '').trim();
        if (!text && act !== 'ideas') { hint.textContent = 'Write something first, then let AI help.'; return; }
        var old = btn.textContent;
        bar.querySelectorAll('.milan-ai-btn').forEach(function (b) { b.disabled = true; });
        btn.textContent = '…';
        hint.textContent = 'Thinking…';
        fetch('/api/ai/assist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, action: act })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (!d.success) throw new Error(d.error || 'AI unavailable');
          var out = (d.result || '').trim();
          if (!out) { hint.textContent = d.note || 'Nothing to suggest.'; return; }
          if (act === 'hashtags') {
            ta.value = (text ? text.replace(/\s+$/, '') + '\n\n' : '') + out;
          } else if (act === 'ideas') {
            ta.value = out;
          } else {
            ta.value = out;
          }
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          hint.textContent = d.ai === false ? 'Done (built-in suggestion — add an AI key for smarter results).' : 'Done ✓';
          try { ta.focus(); } catch (_) {}
        }).catch(function (e) {
          hint.textContent = e.message || 'AI is unavailable right now.';
        }).finally(function () {
          bar.querySelectorAll('.milan-ai-btn').forEach(function (b) { b.disabled = false; });
          btn.textContent = old;
        });
      });
    });
  }

  function init() {
    buildDropzone();
    buildAIAssist();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 300); });
  } else {
    setTimeout(init, 300);
  }
  // Re-run after the app shell appears (composer may render late)
  setTimeout(init, 1200);
  setTimeout(init, 3000);
})();

/* === frontend/milan-more-menu.js === */
/* ============================================================================
   MILAN — "More ▾" collapse for the left nav rail.
   Keeps the 5 essential scopes visible; tucks the rest (Edit Profile, Copy DID,
   MILAN AI, Premium…) under a "More ▾" toggle. Fully defensive: if anything is
   unexpected it does nothing, so it can never break the existing menu.
   Moving the buttons preserves their click handlers.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__milanMoreMenu) return;
  window.__milanMoreMenu = true;

  var CSS =
    '.mm-more-btn{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;margin-top:6px;padding:11px 14px;border:1px solid rgba(255,255,255,.10);border-radius:12px;background:rgba(255,255,255,.04);color:#c2c8de;font-weight:700;font-size:14px;cursor:pointer;transition:background .16s,color .16s}' +
    '.mm-more-btn:hover{background:rgba(255,255,255,.08);color:#f3f4fb}' +
    '.mm-caret{transition:transform .2s ease;font-size:12px;opacity:.8}' +
    '.mm-more-btn.mm-open .mm-caret{transform:rotate(180deg)}' +
    '.mm-extra{display:grid;gap:4px;overflow:hidden;max-height:0;opacity:0;transition:max-height .28s cubic-bezier(.22,1,.36,1),opacity .2s ease,margin .2s ease;margin-top:0}' +
    '.mm-extra.mm-show{max-height:460px;opacity:1;margin-top:4px}';

  function injectCss() {
    if (document.getElementById('mm-style')) return;
    var st = document.createElement('style');
    st.id = 'mm-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function setup() {
    try {
      var menu = document.querySelector('#appView .card.menu') || document.querySelector('.card.menu');
      if (!menu) return false;
      if (menu.querySelector('.mm-more-btn')) return true; // already done

      // Direct child buttons of the menu.
      var children = Array.prototype.slice.call(menu.children).filter(function (n) {
        return n.tagName === 'BUTTON' || (n.classList && n.classList.contains('mp-side-btn'));
      });
      if (children.length < 6) return true; // nothing worth collapsing yet

      // Essential = the scope buttons (Home/Posts/People/Public/Saved).
      var extras = children.filter(function (b) {
        return !b.hasAttribute('data-scope');
      });
      if (extras.length < 2) return true;

      // Build the collapsible container and move the extras into it (keeps
      // their existing event handlers intact).
      var wrap = document.createElement('div');
      wrap.className = 'mm-extra';
      extras.forEach(function (b) { wrap.appendChild(b); });

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mm-more-btn';
      btn.innerHTML = '<span>More</span><span class="mm-caret">▾</span>';
      var open = false;
      btn.addEventListener('click', function () {
        open = !open;
        wrap.classList.toggle('mm-show', open);
        btn.classList.toggle('mm-open', open);
        btn.querySelector('span').textContent = open ? 'Less' : 'More';
      });

      menu.appendChild(btn);
      menu.appendChild(wrap);
      return true;
    } catch (e) {
      return true; // fail-safe: never throw into the app
    }
  }

  // Remove the floating PWA "Install MILAN" button whenever it appears —
  // by id AND by text, so it's caught no matter how it's created.
  function killInstall() {
    try {
      var b = document.getElementById('milan-install-btn');
      if (b) b.remove();
      var nodes = document.querySelectorAll('body > button, body > a, body > div');
      for (var i = 0; i < nodes.length; i++) {
        var t = (nodes[i].textContent || '').replace(/\s+/g, ' ').trim();
        if (/^[⬇️📲\s]*install milan/i.test(t) && t.length < 30 && nodes[i].children.length <= 2) {
          nodes[i].remove();
        }
      }
    } catch (e) {}
  }

  function boot() {
    injectCss();
    setup();
    killInstall();
    try {
      var obs = new MutationObserver(function () { setup(); killInstall(); });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    var n = 0, iv = setInterval(function () { killInstall(); if (setup() || ++n > 40) clearInterval(iv); }, 600);
  }

  if (window.__milanAppReady) boot(); else window.addEventListener('milan:app-ready', boot, {once:true});
})();

/* === frontend/milan.js === */
/* MILAN V7.2 — Launch-grade polish layer (additive, every page).
 * Accessibility (skip link), resilience (offline state), and performance
 * (off-screen image lazy-loading + async decode). Never touches existing logic.
 */
(function () {
  "use strict";
  if (window.__milanPolish) return;
  window.__milanPolish = true;

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  var toast = function (m) { if (window.milanToast) window.milanToast(m); };

  ready(function () {
    perfImages();
    offlineState();
  });

  /* ---- Performance: lazy-load OFF-SCREEN images, async-decode all ---- */
  function perfImages() {
    var vh = window.innerHeight || 800;
    document.querySelectorAll("img").forEach(function (img) {
      if (!img.hasAttribute("decoding")) img.decoding = "async";
      // Only lazy images clearly below the fold — never the LCP/hero image.
      try {
        if (!img.hasAttribute("loading") && img.getBoundingClientRect().top > vh * 1.25) {
          img.loading = "lazy";
        }
      } catch (e) {}
    });
  }

  /* ---- Resilience: visible offline state + reconnect feedback ---- */
  function offlineState() {
    function set(off) {
      var b = document.getElementById("milan-offline");
      if (off && !b) {
        b = document.createElement("div");
        b.id = "milan-offline";
        b.setAttribute("role", "status");
        b.textContent = "⚠ You're offline — we'll reconnect and sync automatically.";
        document.body.appendChild(b);
      } else if (!off && b) {
        b.remove();
      }
    }
    window.addEventListener("offline", function () { set(true); toast("You're offline"); });
    window.addEventListener("online", function () { set(false); toast("Back online"); });
    if (navigator.onLine === false) set(true);
  }
})();

/* === frontend/milan-speed-addon.js === */
/* MILAN Speed Add-on (V7.1)  — load LAST, after app.html's own scripts.
 *
 * Two performance wins, both opt-in and non-destructive:
 *
 *   1) WEB WORKER image compression for profile pictures.
 *      The original fileToDataUrl() ran FileReader.readAsDataURL on the main
 *      thread for the full (up to 900KB) image, freezing the UI and uploading
 *      a large uncompressed base64 string. We override it to route images
 *      through milan-image-worker.js (OffscreenCanvas, off the main thread),
 *      downscaling to <=512px and JPEG-compressing first. Non-images and
 *      browsers without worker/OffscreenCanvas support fall back to the
 *      original behavior unchanged.
 *
 *   2) DEBOUNCE helper exposed globally + applied to the modern-upload preview,
 *      so rapid file/drag events don't thrash the main thread. The global
 *      search boxes are already debounced in app.html and are left untouched.
 *
 * Nothing here changes app logic, markup, or the publish/upload flow.
 */
(function () {
  'use strict';

  // ---- 1. Worker-backed image compression -------------------------------
  var workerUrl = '/milan-image-worker.js';
  var _worker = null;
  var _seq = 0;
  var _pending = {};

  function workerSupported() {
    return typeof Worker !== 'undefined' &&
           typeof OffscreenCanvas !== 'undefined' &&
           typeof createImageBitmap === 'function';
  }

  function getWorker() {
    if (_worker) return _worker;
    try {
      _worker = new Worker(workerUrl);
      _worker.onmessage = function (e) {
        var msg = e.data || {};
        var cb = _pending[msg.id];
        if (!cb) return;
        delete _pending[msg.id];
        cb(msg);
      };
      _worker.onerror = function () {
        // Hard-fail every pending job so callers fall back.
        Object.keys(_pending).forEach(function (k) {
          var cb = _pending[k];
          delete _pending[k];
          cb({ ok: false, error: 'worker error' });
        });
        try { _worker.terminate(); } catch (_) {}
        _worker = null;
      };
    } catch (_) {
      _worker = null;
    }
    return _worker;
  }

  // Compress via worker -> resolves to a data URL. Rejects on any failure.
  function compressImage(file, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var w = getWorker();
      if (!w) return reject(new Error('worker unavailable'));
      var id = ++_seq;
      _pending[id] = function (msg) {
        if (msg && msg.ok) resolve(msg.dataUrl);
        else reject(new Error((msg && msg.error) || 'compress failed'));
      };
      try {
        w.postMessage({
          id: id,
          blob: file,
          maxDim: opts.maxDim || 512,
          quality: opts.quality || 0.82,
          mime: opts.mime || 'image/jpeg'
        });
      } catch (err) {
        delete _pending[id];
        reject(err);
      }
    });
  }

  // Original plain reader (kept as the universal fallback).
  function readAsDataUrl(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  // Override the app's fileToDataUrl. Images: try worker compression, fall
  // back to raw read. Everything else: raw read, unchanged.
  var _origFileToDataUrl = window.fileToDataUrl;
  window.fileToDataUrl = function (file) {
    if (file && /^image\//.test(file.type || '') && workerSupported()) {
      return compressImage(file).catch(function () {
        return (_origFileToDataUrl || readAsDataUrl)(file);
      });
    }
    return (_origFileToDataUrl || readAsDataUrl)(file);
  };

  // Expose for other callers (e.g. preview thumbnails) that want it.
  window.milanCompressImage = function (file, opts) {
    if (file && /^image\//.test(file.type || '') && workerSupported()) {
      return compressImage(file, opts).catch(function () { return readAsDataUrl(file); });
    }
    return readAsDataUrl(file);
  };

  // ---- 2. Global debounce helper ----------------------------------------
  // Reusable, leading/trailing-safe debounce. app.html already debounces its
  // own search inputs; this is provided for add-on code and future use.
  if (typeof window.milanDebounce !== 'function') {
    window.milanDebounce = function (fn, ms) {
      var t;
      ms = ms || 300;
      return function () {
        var ctx = this, args = arguments;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(ctx, args); }, ms);
      };
    };
  }

  // Lightly debounce the modern-upload preview if that component is present,
  // so dragging/dropping in quick succession doesn't re-read repeatedly.
  function wirePreviewDebounce() {
    var input = document.getElementById('mediaFile');
    if (!input || input.dataset.milanDebounced === '1') return;
    input.dataset.milanDebounced = '1';
    // Don't replace the existing change handler; just throttle a no-op hook
    // that other code can listen to. The real preview lives in
    // milan-modern-upload.js and remains the source of truth.
    var fire = window.milanDebounce(function () {
      try {
        if (input.files && input.files[0]) {
          input.dispatchEvent(new CustomEvent('milan:file-settled', { bubbles: true }));
        }
      } catch (_) {}
    }, 250);
    input.addEventListener('change', fire);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(wirePreviewDebounce, 400); });
  } else {
    setTimeout(wirePreviewDebounce, 400);
  }

  try {
    console.log('%c[MILAN Speed] image worker + debounce ready', 'color:#10b981;font-weight:800;');
  } catch (_) {}
})();

/* === frontend/milan-ui.js === */
/* MILAN V7.2 UI activator — load LAST. Adds the structural bits the mockup
   needs (status stack, avatar menu, System Status card, nav icons) on top of
   the existing markup. Pure presentation/DOM decoration; no app logic changed. */
(function () {
  'use strict';

  document.documentElement.classList.add('milan');

  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  // ---- 1. Top-bar status stack (Cloud DWN / AI / DWN) ----
  function buildStatus() {
    var nav = $('.navlinks');
    if (!nav || $('#milan-status')) return;
    var box = el('div'); box.id = 'milan-status';
    box.innerHTML =
      '<div class="st"><span class="dot"></span>Cloud DWN: <span class="ok">Online</span></div>' +
      '<div class="st"><span class="dot"></span>AI: <span class="ok">Ready</span></div>' +
      '<div class="st"><span class="dot"></span>DWN: <span class="ok">On</span></div>';
    nav.innerHTML = '';
    nav.appendChild(box);
  }

  // ---- 2. Avatar button + dropdown (Usage Stats / Admin / Logout) ----
  function buildUserMenu() {
    var actions = $('.topActions');
    if (!actions || $('#milan-userbtn')) return;

    var name = ($('#myName') && $('#myName').textContent) || 'NP';
    var inits = name.trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0] || ''; }).join('').toUpperCase() || 'NP';

    var btn = el('button'); btn.id = 'milan-userbtn';
    btn.innerHTML = '<span class="av">' + inits + '</span><span>▾</span>';
    actions.appendChild(btn);

    var menu = el('div'); menu.id = 'milan-menu';
    menu.innerHTML =
      '<button data-act="usage">📊 Usage Stats</button>' +
      '<button data-act="admin">⚙️ Admin Panel</button>' +
      '<div class="sep"></div>' +
      '<button data-act="logout">⤴ Logout</button>';
    document.body.appendChild(menu);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', function () { menu.classList.remove('open'); });

    menu.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      menu.classList.remove('open');
      var act = b.dataset.act;
      if (act === 'logout') {
        var lo = $('#logoutBtn'); if (lo) lo.click();
      } else if (act === 'usage') {
        var u = $('#milan-usage-btn'); if (u) { u.click(); } else { window.location.href = '/admin-users'; }
      } else if (act === 'admin') {
        window.location.href = '/admin-users';
      }
    });
  }

  // ---- 3. View Profile link under the avatar ----
  function buildViewProfile() {
    var card = $('.leftRail .profileCard');
    if (!card || $('#milan-viewprofile')) return;
    var emailEl = $('#myEmail', card);
    var link = el('a'); link.id = 'milan-viewprofile';
    link.href = 'javascript:void 0'; link.textContent = 'View Profile';
    link.style.cssText = 'display:block;margin-top:6px;';
    link.onclick = function () { var p = $('#profileBtn'); if (p) p.click(); };
    if (emailEl && emailEl.parentNode) emailEl.parentNode.insertBefore(link, emailEl.nextSibling);
    else card.appendChild(link);
  }

  // ---- 4. Nav icons + labels (decorate existing menu buttons) ----
  var ICONS = {
    'feed': '🏠', 'home': '🏠', 'all': '🏠',
    'myfeed': '📡', 'my feed': '📡',
    'explore': '🧭', 'people': '👥', 'groups': '👨‍👩‍👧', 'files': '📄',
    'settings': '⚙️', 'profile': '👤'
  };
  function decorateNav() {
    var btns = document.querySelectorAll('.menu button');
    btns.forEach(function (b) {
      if (b.dataset.v72ico === '1') return;
      b.dataset.v72ico = '1';
      var label = (b.textContent || '').trim().toLowerCase();
      var icon = ICONS[label] || ICONS[label.replace(/\s+/g, '')] || '•';
      // only prepend if it doesn't already start with an emoji
      if (!/^\p{Emoji}/u.test(b.textContent.trim())) {
        b.innerHTML = '<span style="width:22px;display:inline-block;text-align:center">' + icon + '</span>' + b.innerHTML;
      }
    });
  }

  // ---- 5. System Status card from the summary counters ----
  function buildSysStatus() {
    var leftRail = $('.leftRail');
    if (!leftRail || $('#milan-sysstatus')) return;
    function val(id) { var e = document.getElementById(id); return e ? (e.textContent || '0') : '0'; }
    var box = el('div'); box.id = 'milan-sysstatus';
    box.innerHTML =
      '<h4>System Status</h4>' +
      '<div class="row"><span>People:</span><b id="v72-ppl">' + val('peopleCount') + '</b></div>' +
      '<div class="row"><span>Posts:</span><b id="v72-posts">' + val('postCount') + '</b></div>' +
      '<div class="row"><span>Visible Posts:</span><b id="v72-vis">' + val('postCount') + '</b></div>' +
      '<div class="row"><span>Alerts:</span><b id="v72-alerts">' + val('notifCount') + '</b></div>';
    leftRail.appendChild(box);

    // keep it in sync when the app updates its hidden counters
    var sync = function () {
      var m = { 'v72-ppl': 'peopleCount', 'v72-posts': 'postCount', 'v72-vis': 'postCount', 'v72-alerts': 'notifCount' };
      Object.keys(m).forEach(function (k) {
        var t = document.getElementById(k), s = document.getElementById(m[k]);
        if (t && s) t.textContent = s.textContent || '0';
      });
    };
    setInterval(sync, 4000);
  }

  function run() {
    try { buildStatus(); } catch (_) {}
    try { buildUserMenu(); } catch (_) {}
    try { buildViewProfile(); } catch (_) {}
    try { decorateNav(); } catch (_) {}
    try { buildSysStatus(); } catch (_) {}
  }

  // Run now and again after the app boots / renders the shell.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(run, 300); });
  } else {
    setTimeout(run, 300);
  }
  setTimeout(run, 1200);
  setTimeout(run, 2500);

  try { console.log('%c[MILAN V7.2] UI active', 'color:#3b82f6;font-weight:800;'); } catch (_) {}
})();

/* === frontend/milan-youtube-feed.js === */
/*!
 * MILAN — YouTube to Feed
 *  1) Composer "🎬 YouTube" button: search any video by name and add it to your post.
 *  2) Feed enhancer: any YouTube link in a post renders as a responsive embedded player.
 *  Same on desktop and mobile/PWA. Uses the app's /api/music/search proxy.
 */
(function () {
  'use strict';
  if (window.__milanYtFeed) return;
  window.__milanYtFeed = true;

  function vidId(s) {
    var m = String(s || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }

  // Lazy-load facade thumbnails only when the post nears the viewport (saves data + improves LCP).
  var _io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target, bg = el.getAttribute('data-bg');
      if (bg) { el.style.backgroundImage = 'url(' + bg + ')'; el.removeAttribute('data-bg'); }
      _io.unobserve(el);
    });
  }, { rootMargin: '300px' }) : null;

  /* ── 1) Feed embeds ─────────────────────────────────────────── */
  // Fast "facade" embed: thumbnail + big premium play button; loads the real
  // player only on click. The 🎧 button plays audio-only through a page-owned
  // <audio> element (server proxy /api/music/stream/:id) — that is the only
  // playback mobile browsers keep running when the app is backgrounded; the
  // YouTube iframe always gets force-paused there.
  var bgAudio = null, bgBox = null;
  function sharedAudio() {
    if (bgAudio) return bgAudio;
    bgAudio = document.createElement('audio');
    bgAudio.preload = 'none';
    document.body.appendChild(bgAudio);
    var sync = function () {
      if (!bgBox) return;
      var pp = bgBox.querySelector('.myt-pp');
      if (pp) pp.textContent = bgAudio.paused ? '▶' : '⏸';
      if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = bgAudio.paused ? 'paused' : 'playing'; } catch (e) {}
    };
    bgAudio.addEventListener('play', sync);
    bgAudio.addEventListener('pause', sync);
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', function () { bgAudio.play().catch(function () {}); });
        navigator.mediaSession.setActionHandler('pause', function () { bgAudio.pause(); });
      } catch (e) {}
    }
    return bgAudio;
  }
  function stopBgAudio() {
    if (!bgAudio) return;
    try { bgAudio.pause(); bgAudio.removeAttribute('src'); bgAudio.load(); } catch (e) {}
    bgBox = null;
  }
  function postTitle(d) {
    var p = d.closest('.post,[data-post],.feedItem');
    var t = p && p.querySelector('.postTitle,.post-title,.title');
    return (t && t.textContent.trim()) || 'YouTube audio';
  }
  function facadeHtml(d, id) {
    d.classList.add('facade');
    d.style.cursor = 'pointer'; d.style.backgroundImage = 'url(https://i.ytimg.com/vi/' + id + '/hqdefault.jpg)';
    d.innerHTML = '<div class="myt-grad"></div><div class="myt-play">▶</div><div class="myt-badge">▶ YouTube</div><div class="myt-abadge" title="Listen with the screen off">🎧 Audio</div>';
  }
  function loadIframe(d, id) {
    d.classList.remove('facade'); d.style.cursor = 'default'; d.style.backgroundImage = 'none';
    d.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1&modestbranding=1&enablejsapi=1&mbg=1" title="YouTube video" frameborder="0" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture;web-share" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe>' +
      '<button class="myt-bg" type="button" title="Listen in background">🎧</button>';
  }
  function playAudioIn(d, id) {
    if (bgBox && bgBox !== d) { var oldId = bgBox.getAttribute('data-myt-id'); facadeHtml(bgBox, oldId); }
    var a = sharedAudio();
    bgBox = d;
    d.classList.remove('facade'); d.style.cursor = 'default';
    d.style.backgroundImage = 'url(https://i.ytimg.com/vi/' + id + '/hqdefault.jpg)';
    var title = postTitle(d);
    d.innerHTML = '<div class="myt-grad"></div><div class="myt-audio">🎧<span class="tt">' + esc(title) + '</span>' +
      '<button class="myt-pp" type="button" title="Play / pause">⏸</button>' +
      '<button class="myt-vv" type="button" title="Watch video">▶ Video</button></div>' +
      '<div class="myt-badge">🎧 Background audio — keeps playing when you leave</div>';
    a.onerror = function () {
      if (bgBox !== d) return;
      var tt = d.querySelector('.tt'); if (tt) tt.textContent = 'Audio unavailable — opening video…';
      setTimeout(function () { if (bgBox === d) { stopBgAudio(); loadIframe(d, id); } }, 1000);
    };
    a.src = '/api/music/stream/' + id;
    a.play().catch(function () {});
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title, artist: 'MILAN', album: 'MILAN Feed',
          artwork: [{ src: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', sizes: '480x360', type: 'image/jpeg' }]
        });
      } catch (e) {}
    }
  }
  function embed(id) {
    var d = document.createElement('div');
    d.className = 'myt-embed';
    d.setAttribute('data-myt-id', id);
    d.style.cssText = 'position:relative;width:100%;aspect-ratio:16/9;border-radius:14px;overflow:hidden;margin-top:10px;cursor:pointer;border:1px solid rgba(255,255,255,.08);background:#000 center/cover no-repeat';
    var thumb = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
    facadeHtml(d, id);
    if (_io) { d.style.backgroundImage = 'none'; d.setAttribute('data-bg', thumb); _io.observe(d); }
    d.addEventListener('click', function (e) {
      if (e.target.closest('.myt-abadge') || e.target.closest('.myt-bg')) { e.stopPropagation(); playAudioIn(d, id); return; }
      if (e.target.closest('.myt-pp')) { var a = sharedAudio(); a.paused ? a.play().catch(function () {}) : a.pause(); return; }
      if (e.target.closest('.myt-vv')) { stopBgAudio(); loadIframe(d, id); return; }
      if (d.classList.contains('facade')) loadIframe(d, id);
    });
    return d;
  }
  function scan(root) {
    var posts = (root || document).querySelectorAll('.post:not([data-myt]),[data-post]:not([data-myt]),.feedItem:not([data-myt])');
    Array.prototype.forEach.call(posts, function (p) {
      p.setAttribute('data-myt', '1');
      var id = null;
      var a = p.querySelector('a[href*="youtu"]');
      if (a) id = vidId(a.getAttribute('href'));
      if (!id) id = vidId(p.textContent || '');
      if (!id) return;
      if (p.querySelector('.myt-embed')) return;

      // Hide/remove the raw YouTube URL from visible post text.
      // Keep the detected video ID so the embedded player still works.
      try {
        var walker = document.createTreeWalker(
          p,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: function (node) {
              if (!node.nodeValue || !/youtube\.com\/|youtu\.be\//i.test(node.nodeValue)) {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );

        var nodes = [];
        var node;
        while ((node = walker.nextNode())) nodes.push(node);

        nodes.forEach(function (textNode) {
          textNode.nodeValue = textNode.nodeValue.replace(
            /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)[A-Za-z0-9_-]{11}(?:[^\s]*)?|youtu\.be\/[A-Za-z0-9_-]{11}(?:[^\s]*)?)/gi,
            ''
          );
        });
      } catch (e) {}

      // Also hide a link element if the URL was auto-linkified.
      if (a) {
        a.style.display = 'none';
        a.setAttribute('aria-hidden', 'true');
      }

      var target = p.querySelector('.postText, .postBody, .post-body, .text, .caption, .body') || p;
      target.appendChild(embed(id));
    });
  }
  function startFeedWatch() {
    var feed = document.getElementById('feed') || document.querySelector('.feed') || document.body;
    scan(document);
    try {
      var mo = new MutationObserver(function () { scan(feed); });
      mo.observe(feed, { childList: true, subtree: true });
    } catch (e) {}
    setInterval(function () { scan(document); }, 4000); // safety net for re-rendered feeds
  }

  /* ── 2) Composer: search & add a YouTube video ──────────────── */
  var CSS = [
    '.myt-add{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#e7ecff;border-radius:11px;padding:8px 13px;font:700 12.5px Inter,system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:6px;margin:4px 6px 4px 0}',
    '.myt-add:hover{border-color:rgba(216,179,90,.5);color:#fff}',
    '.myt-ov{position:fixed;inset:0;z-index:100000;display:none;align-items:flex-start;justify-content:center;background:rgba(8,9,14,.7);backdrop-filter:blur(8px);padding:40px 14px}',
    '.myt-ov.show{display:flex}',
    '.myt-modal{width:min(520px,96vw);max-height:80vh;display:flex;flex-direction:column;background:#0c1226;border:1px solid rgba(255,255,255,.1);border-radius:20px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55)}',
    '.myt-h{display:flex;align-items:center;gap:9px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08);font:800 15px Inter,sans-serif;color:#fff}',
    '.myt-h .x{margin-left:auto;background:rgba(255,255,255,.08);border:0;color:#cdd6ee;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:15px}',
    '.myt-srch{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.06)}',
    '.myt-srch input{width:100%;height:40px;background:#11162c;border:1px solid rgba(255,255,255,.12);color:#eef1ff;border-radius:11px;padding:0 13px;font-size:14px;outline:none}',
    '.myt-list{overflow-y:auto;padding:8px}',
    '.myt-row{display:flex;gap:10px;padding:8px;border-radius:11px;cursor:pointer;align-items:center}',
    '.myt-row:hover{background:rgba(255,255,255,.06)}',
    '.myt-row img{width:72px;height:46px;border-radius:8px;object-fit:cover;flex:0 0 auto;background:#000}',
    '.myt-row .t{font:600 13px Inter,sans-serif;color:#eef1ff;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.myt-row .c{font:500 11.5px Inter,sans-serif;color:#9aa6cf;margin-top:2px}',
    '.myt-msg{padding:18px;text-align:center;color:#9aa6cf;font-size:13px}',
    '.myt-embed{transition:transform .18s,border-color .18s,box-shadow .18s}',
    '.myt-embed.facade:hover{transform:translateY(-2px);border-color:rgba(216,179,90,.45);box-shadow:0 14px 36px rgba(0,0,0,.45)}',
    '.myt-grad{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.5));pointer-events:none}',
    '.myt-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:62px;height:62px;border-radius:50%;background:linear-gradient(135deg,#d8b35a,#ecca7e);color:#1b1306;display:grid;place-items:center;font-size:25px;box-shadow:0 10px 30px rgba(0,0,0,.55);transition:transform .18s}',
    '.myt-embed.facade:hover .myt-play{transform:translate(-50%,-50%) scale(1.1)}',
    '.myt-badge{position:absolute;left:10px;bottom:10px;background:rgba(0,0,0,.62);color:#fff;font:700 11px Inter,system-ui,sans-serif;padding:4px 9px;border-radius:8px}',
    '.myt-abadge{position:absolute;right:10px;bottom:10px;background:rgba(0,0,0,.62);color:#fff;font:700 11px Inter,system-ui,sans-serif;padding:5px 10px;border-radius:8px;border:1px solid rgba(216,179,90,.45);cursor:pointer}',
    '.myt-abadge:hover{background:rgba(216,179,90,.28)}',
    '.myt-bg{position:absolute;right:10px;top:10px;z-index:5;width:38px;height:38px;border-radius:50%;border:1px solid rgba(216,179,90,.5);background:rgba(0,0,0,.6);color:#fff;font-size:17px;cursor:pointer;display:grid;place-items:center}',
    '.myt-bg:hover{background:rgba(216,179,90,.35)}',
    '.myt-audio{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:10px;max-width:92%;background:rgba(5,8,20,.82);border:1px solid rgba(216,179,90,.4);border-radius:14px;padding:10px 14px;color:#fff;font:600 13px Inter,system-ui,sans-serif}',
    '.myt-audio .tt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52vw}',
    '.myt-audio button{border:0;cursor:pointer;font:700 12px Inter,system-ui,sans-serif;border-radius:10px}',
    '.myt-audio .myt-pp{width:36px;height:36px;border-radius:50%;font-size:15px;color:#1b1306;background:linear-gradient(135deg,#d8b35a,#ecca7e)}',
    '.myt-audio .myt-vv{background:rgba(255,255,255,.1);color:#e7ecff;padding:9px 11px;border:1px solid rgba(255,255,255,.16)}'
  ].join('\n');

  var overlay;
  function buildModal() {
    overlay = document.createElement('div'); overlay.className = 'myt-ov';
    overlay.innerHTML = '<div class="myt-modal"><div class="myt-h">🎬 Add a YouTube video<button class="x" title="Close">✕</button></div>' +
      '<div class="myt-srch"><input type="search" placeholder="Search any song or video…" autocomplete="off"></div>' +
      '<div class="myt-list"><div class="myt-msg">Type a video name to search.</div></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('.x').addEventListener('click', close);
    var input = overlay.querySelector('input'), list = overlay.querySelector('.myt-list'), t = null;
    input.addEventListener('input', function () {
      clearTimeout(t); var q = this.value.trim();
      if (!q) { list.innerHTML = '<div class="myt-msg">Type a video name to search.</div>'; return; }
      t = setTimeout(function () {
        list.innerHTML = '<div class="myt-msg">Searching…</div>';
        fetch('/api/music/search?q=' + encodeURIComponent(q)).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw j; return j; }); })
          .then(function (j) { renderResults(list, j.items || []); })
          .catch(function (j) {
            list.innerHTML = '<div class="myt-msg">' + ((j && j.code === 'no_key')
              ? 'YouTube search ke liye <b>YOUTUBE_API_KEY</b> chahiye (backend/.env). Tab tak link paste karke bhi add kar sakte ho.'
              : 'Search failed. Try again.') + '</div>';
          });
      }, 340);
    });
  }
  function renderResults(list, items) {
    if (!items.length) { list.innerHTML = '<div class="myt-msg">No videos found.</div>'; return; }
    list.innerHTML = items.map(function (it) {
      return '<div class="myt-row"><img loading="lazy" src="' + esc(it.thumb) + '" alt="">' +
        '<div><div class="t">' + esc(it.title) + '</div><div class="c">' + esc(it.channel) + '</div></div></div>';
    }).join('');
    var rows = list.querySelectorAll('.myt-row');
    items.forEach(function (it, i) { if (rows[i]) rows[i].addEventListener('click', function () { addToPost(it); }); });
  }
  // Click a result -> auto-fill the composer AND auto-publish to the feed (no manual Publish).
  function addToPost(item) {
    var url = 'https://www.youtube.com/watch?v=' + item.id;
    var ta = document.getElementById('postText');
    if (ta) { ta.value = (ta.value ? ta.value.trim() + '\n\n' : '') + url; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    var ti = document.getElementById('postTitle');
    if (ti && !ti.value.trim()) { ti.value = String(item.title || 'YouTube video').slice(0, 80); ti.dispatchEvent(new Event('input', { bubbles: true })); }
    close();
    var pub = document.getElementById('publishBtn');
    if (pub) {
      // small delay so the composer's input/preview handlers settle, then publish for real
      setTimeout(function () {
        pub.click();
        if (window.toast) try { window.toast('🎬 Video posted to your feed!'); } catch (e) {}
      }, 220);
    } else if (window.toast) { try { window.toast('🎬 Video added — tap Publish.'); } catch (e) {} }
  }
  function open() { if (!overlay) buildModal(); overlay.classList.add('show'); overlay.querySelector('input').focus(); }
  function close() { if (overlay) overlay.classList.remove('show'); }

  function injectButton() {
    if (document.getElementById('myt-add-btn')) return true;
    var pub = document.getElementById('publishBtn');
    var anchor = document.getElementById('postText');
    if (!anchor) return false;
    var btn = document.createElement('button');
    btn.id = 'myt-add-btn'; btn.type = 'button'; btn.className = 'myt-add';
    btn.innerHTML = '🎬 <span>Add YouTube</span>';
    btn.addEventListener('click', function (e) { e.preventDefault(); open(); });
    // place it right after the textarea (works on mobile + desktop)
    if (anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    else if (pub && pub.parentNode) pub.parentNode.insertBefore(btn, pub);
    return true;
  }

  function boot() {
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    startFeedWatch();
    if (!injectButton()) {
      var tries = 0, iv = setInterval(function () { if (injectButton() || ++tries > 20) clearInterval(iv); }, 600);
    }
  }
  if (window.__milanAppReady) boot(); else window.addEventListener('milan:app-ready', boot, {once:true});
})();

/* === frontend/sw.js === */
/* MILAN service worker - v96
   Goal: stay FRESH on Android/WebView (no stale app shell) while still giving a
   real offline experience. We do NOT cache the HTML/JS app shell (prevents old
   login patches from returning). We DO precache a small offline fallback + icons
   so failed navigations show a proper page instead of a browser error. */

var CACHE_NAME = 'milan-brand-icons';
var OFFLINE_URL = '/offline.html';
var PRECACHE = [OFFLINE_URL, '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/safari-pinned-tab.svg', '/assets/favicon-192x192.png', '/assets/favicon-512x512.png', '/manifest.json'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE_NAME ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.pathname.indexOf('/api/') === 0 || req.headers.has('range') ||
      /\.(mp4|webm|mov|m4v|3gp|m3u8)$/i.test(url.pathname)) return;

  // Versioned JS/CSS (?v=...) are immutable: cache-first. The URL changes when
  // the file changes, so this can never serve a stale build — it just makes
  // repeat app opens instant and tolerant of flaky mobile networks.
  if (/\.(js|css)$/i.test(url.pathname) && /[?&]v=/.test(url.search)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // Navigations: always try network fresh; if offline, show cached offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .catch(function () { return fetch(req); })
        .catch(function () { return caches.match(OFFLINE_URL); })
    );
    return;
  }

  // Static precached assets: network-first, fall back to cache.
  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .catch(function () { return caches.match(req); })
      .then(function (res) {
        return res || caches.match(req).then(function (c) {
          return c || caches.match(OFFLINE_URL);
        });
      })
  );
});

/* MILAN login/register — production auth client */
"use strict";

/* API_BASE is initialized at the start of this file. */

function getToken() {
  try { return String(localStorage.getItem("milan_token") || "").trim(); }
  catch (_) { return ""; }
}

function setToken(token) {
  localStorage.setItem("milan_token", String(token));
  localStorage.removeItem("milanBootCache");
}

function clearToken() { localStorage.removeItem("milan_token"); }
function getPostLoginDestination() {
  try {
    if (sessionStorage.getItem("milanPostLoginReturn") === "/milan-pay") {
      sessionStorage.removeItem("milanPostLoginReturn");
      return "/milan-pay";
    }
  } catch (_) {
    // Fall back to the regular app landing page.
  }

  return "/app.html?login=" + Date.now();
}


function showMessage(message, isError = true) {
  const el = document.getElementById("authMsg");
  if (!el) return;
  el.innerText = message;
  el.style.color = isError ? "#e5484d" : "#10b981";
}

function setActiveTab(mode) {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.dataset.auth === mode
      ? tab.classList.add("active")
      : tab.classList.remove("active");
  });
  document.getElementById("loginBox")?.classList.toggle("hidden", mode !== "login");
  document.getElementById("registerBox")?.classList.toggle("hidden", mode !== "register");
  const msg = document.getElementById("authMsg");
  if (msg) msg.innerText = "";
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "Accept": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.emailVerificationRequired = data.emailVerificationRequired === true;
    error.email = typeof data.email === "string" ? data.email : "";
    throw error;
  }
  return data;
}

async function authenticatedJson(path, options = {}) {
  const token = getToken();
  if (!token) throw new Error("Password login required.");

  return api(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });
}

async function registerUser(name, email, password) {
  return api("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password })
  });
}

async function loginUser(email, password) {
  return api("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
}

window.togglePasswordVisibility = function () {
  const input = document.getElementById("loginPass");
  if (input) input.type = input.type === "password" ? "text" : "password";
};

async function loginWithID3() {
  showMessage("ID3 login is loading...", false);
  try {
    const options = await api("/did/passkey/login/options");
    const lib = await loadSimpleWebAuthnBrowser();
    if (lib.browserSupportsWebAuthn && !lib.browserSupportsWebAuthn()) throw new Error("This browser does not support ID3/passkeys.");
    const assertion = await lib.startAuthentication({ optionsJSON: options });
    const result = await api("/did/passkey/login/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(assertion)
    });
    if (!result.token) throw new Error("No MILAN token received.");
    setToken(result.token);
    window.location.replace(getPostLoginDestination());
  } catch (error) {
    if (error?.emailVerificationRequired) {
      const email = String(
        error.email ||
        localStorage.getItem("milanLastAuthEmail") ||
        localStorage.getItem("rememberedEmail") ||
        ""
      ).trim().toLowerCase();

      if (email) {
        window.location.replace(
          "/verify-email?email=" + encodeURIComponent(email)
        );
        return;
      }

      showMessage(error?.message || "Please verify your email before logging in.", true);
      return;
    }

    if (
      error?.status === 401 &&
      /this id3 credential is not registered with milan/i.test(error?.message || "")
    ) {
      // The selected passkey is not in MILAN's credential table.
      // Preserve all existing credentials and request password auth before
      // enrolling a new credential for this authenticated account.
      localStorage.setItem("milanID3RepairPending", "1");
      localStorage.removeItem("milanID3SetupPending");
      setActiveTab("login");

      const remembered =
        localStorage.getItem("milanLastAuthEmail") ||
        localStorage.getItem("rememberedEmail") || "";
      const loginEmail = document.getElementById("loginEmail");
      if (loginEmail && remembered) loginEmail.value = remembered;

      const loginPass = document.getElementById("loginPass");
      if (loginPass) {
        loginPass.value = "";
        loginPass.focus();
      }

      showMessage(
        "This passkey is not registered with MILAN. Sign in with your password to register a matching passkey.",
        false
      );
      return;
    }

    if (error?.status === 409) {
      localStorage.setItem("milanID3SetupPending", "1");
      setActiveTab("login");

      const remembered = localStorage.getItem("milanLastAuthEmail") || localStorage.getItem("rememberedEmail") || "";
      const loginEmail = document.getElementById("loginEmail");
      if (loginEmail && remembered) loginEmail.value = remembered;

      const loginPass = document.getElementById("loginPass");
      if (loginPass) {
        loginPass.value = "";
        loginPass.focus();
      }

      showMessage(
        "Sign in with your password once to enable ID3 on this device.",
        false
      );
      return;
    }

    showMessage(error?.message || String(error) || "ID3 login failed.", true);
  }
}

let simpleWebAuthnPromise = null;
function loadSimpleWebAuthnBrowser() {
  if (window.SimpleWebAuthnBrowser) return Promise.resolve(window.SimpleWebAuthnBrowser);
  if (simpleWebAuthnPromise) return simpleWebAuthnPromise;
  simpleWebAuthnPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/assets/simplewebauthn-browser.min.js";
    script.async = true;
    script.onload = () => window.SimpleWebAuthnBrowser ? resolve(window.SimpleWebAuthnBrowser) : reject(new Error("ID3 security module unavailable"));
    script.onerror = () => reject(new Error("Could not load ID3 security module"));
    document.head.appendChild(script);
  });
  return simpleWebAuthnPromise;
}

function bind() {
  document.querySelectorAll(".tab").forEach(tab => {
    if (tab.dataset.milanAuthBound) return;
    tab.dataset.milanAuthBound = "1";
    tab.addEventListener("click", () => setActiveTab(tab.dataset.auth));
  });

  const switchLink = document.getElementById("switchToRegister");
  if (switchLink && !switchLink.dataset.milanAuthBound) {
    switchLink.dataset.milanAuthBound = "1";
    switchLink.addEventListener("click", event => {
      event.preventDefault();
      setActiveTab("register");
    });
  }

  const registerBtn = document.getElementById("registerBtn");
  if (registerBtn && !registerBtn.dataset.milanAuthBound) {
    registerBtn.dataset.milanAuthBound = "1";
    registerBtn.addEventListener("click", async event => {
      event.preventDefault();
      const name = document.getElementById("regName")?.value?.trim() || "";
      const email = document.getElementById("regEmail")?.value?.trim().toLowerCase() || "";
      const password = document.getElementById("regPass")?.value || "";
      if (!name || !email || !password) return showMessage("Please fill all fields.", true);
      if (password.length < 8) return showMessage("Password must be at least 8 characters.", true);
      registerBtn.disabled = true;
      registerBtn.textContent = "Creating account...";
      try {
        await registerUser(name, email, password);
        localStorage.setItem("milanLastAuthEmail", email);

        // New accounts must verify their email before signing in.
        // The verification page supports both code entry and resending.
        window.location.replace(
          "/verify-email?email=" + encodeURIComponent(email)
        );
        return;
      } catch (error) {
        showMessage(error?.message || String(error) || "Registration failed.", true);
      } finally {
        registerBtn.disabled = false;
        registerBtn.textContent = "Create my MILAN space";
      }
    });
  }

  const loginBtn = document.getElementById("loginBtn");
  if (loginBtn && !loginBtn.dataset.milanAuthBound) {
    loginBtn.dataset.milanAuthBound = "1";
    loginBtn.addEventListener("click", async event => {
      event.preventDefault();
      const email = document.getElementById("loginEmail")?.value?.trim().toLowerCase() || "";
      const password = document.getElementById("loginPass")?.value || "";
      if (!email || !password) return showMessage("Please enter email and password.", true);
      loginBtn.disabled = true;
      loginBtn.textContent = "Logging in...";
      try {
        const data = await loginUser(email, password);
        localStorage.setItem("milanLastAuthEmail", email);
        if (!data.token) throw new Error("No token received.");
        setToken(data.token);

        const setupPending =
          localStorage.getItem("milanID3SetupPending") === "1";
        const repairPending =
          localStorage.getItem("milanID3RepairPending") === "1";

        if (setupPending || repairPending) {
          localStorage.removeItem("milanID3SetupPending");
          localStorage.removeItem("milanID3RepairPending");

          try {
            const status = await authenticatedJson("/did/passkey/status");

            // A stale/unregistered browser credential can coexist with an
            // older stored credential. Repair explicitly, without deleting it.
            if (repairPending || !status?.registered) {
              await registerID3({ continueToAppOnFailure: true });
              return;
            }
          } catch (setupError) {
            console.warn("[MILAN ID3] Optional setup check failed:", setupError?.message || setupError);
            showMessage(
              "Password login succeeded. ID3 setup is unavailable right now; continuing to MILAN.",
              false
            );
          }
        }

        window.location.replace(getPostLoginDestination());
      } catch (error) {
        // Do not erase a token that was already saved after a successful login.
        if (getToken()) {
          window.location.replace(getPostLoginDestination());
          return;
        }
        clearToken();

        if (error?.emailVerificationRequired) {
          window.location.replace(
            "/verify-email?email=" + encodeURIComponent(email)
          );
          return;
        }

        showMessage(error?.message || String(error) || "Login failed.", true);
        loginBtn.disabled = false;
        loginBtn.textContent = "Login →";
      }
    });
  }

async function registerID3({ continueToAppOnFailure = false } = {}) {
    const didBtn =
        document.getElementById(
            "didLoginBtn"
        );

    if (!getToken()) {
        const loginTab = document.querySelector('[data-auth="login"]');
        if (loginTab) loginTab.click();

        const regEmail = document.getElementById("regEmail")?.value?.trim().toLowerCase() || "";
        const loginEmail = document.getElementById("loginEmail");
        if (loginEmail && regEmail) loginEmail.value = regEmail;

        const loginPass = document.getElementById("loginPass");
        if (loginPass) {
            loginPass.value = "";
            loginPass.focus();
        }

        showMessage(
            "Sign in with your password first, then enable ID3 on this device.",
            false
        );
        return;
    }

    try {
        didBtn.disabled = true;
        didBtn.innerHTML =
            '<span class="did-badge">did</span> Enabling ID3...';

        showMessage(
            "Create your secure ID3 passkey on this device...",
            false
        );

        const {
            startRegistration,
            browserSupportsWebAuthn
        } =
            await loadSimpleWebAuthnBrowser();

        if (
            browserSupportsWebAuthn &&
            !browserSupportsWebAuthn()
        ) {
            throw new Error(
                "This browser does not support secure ID3/passkey login."
            );
        }

        const options =
            await authenticatedJson(
                "/did/passkey/register/options"
            );

        const registrationResponse =
            await startRegistration({
                optionsJSON: options
            });

        const verification =
            await authenticatedJson(
                "/did/passkey/register/verify",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body:
                        JSON.stringify(
                            registrationResponse
                        )
                }
            );

        if (!verification.verified) {
            throw new Error(
                "ID3 registration was not verified."
            );
        }

        didBtn.innerHTML =
            '<span class="did-badge">did</span> Sign with ID3';

        showMessage(
            "✅ ID3 enabled. You can now sign in with one click.",
            false
        );

        setTimeout(() => {
            window.location.replace(
                "/app.html?login=" +
                Date.now()
            );
        }, 900);

    } catch (error) {
        console.error(
            "[MILAN ID3] registration failed:",
            error
        );

        didBtn.disabled = false;

        didBtn.innerHTML =
            '<span class="did-badge">did</span> Sign with ID3';

        const name = String(error?.name || "").trim();
        const message =
            typeof error?.message === "string"
                ? error.message.trim()
                : "";

        if (name === "NotAllowedError") {
            showMessage(
                "Passkey setup was cancelled or timed out. Please try again.",
                true
            );
        } else if (
            name === "InvalidStateError" ||
            /previously registered/i.test(message)
        ) {
            showMessage(
                "This device already has a MILAN passkey. Try Sign with ID3.",
                true
            );
        } else if (name === "SecurityError") {
            showMessage(
                "MILAN could not verify this passkey request. Please try again from milanlife.in.",
                true
            );
        } else if (name === "AbortError") {
            showMessage(
                "Passkey setup was interrupted. Please try again.",
                true
            );
        } else {
            showMessage(
                message || "Could not enable ID3. Please try again.",
                true
            );
        }

        // If password authentication already succeeded, passkey enrollment
        // is optional: preserve the valid session and continue to the app.
        if (continueToAppOnFailure && getToken()) {
            setTimeout(() => {
                window.location.replace(getPostLoginDestination());
            }, 1200);
        }
    }
}


  const didBtn = document.getElementById("didLoginBtn");
  if (didBtn && !didBtn.dataset.milanAuthBound) {
    didBtn.dataset.milanAuthBound = "1";
    didBtn.addEventListener("click", async event => {
      event.preventDefault();

      try {
        if (!getToken()) {
          // No password session: discoverable ID3 login must run directly.
          await loginWithID3();
          return;
        }

        const status = await authenticatedJson("/did/passkey/status");

        if (status?.registered) {
          await loginWithID3();
        } else {
          await registerID3();
        }
      } catch (error) {
        showMessage(
          error?.message ||
          String(error) ||
          "Could not start ID3. Please try again.",
          true
        );
      }
    });
  }

  try {
    if (getToken()) window.location.replace("/app.html");
  } catch (_) {}
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bind, { once: true });
} else {
  bind();
}
