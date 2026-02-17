(function () {
  const MASTER_PASSWORD_KEY = "auth_secret";
  const BOOKMARKS_AND_FOLDERS_KEY = "folders";
  const SALT = "chrome-bookmarks-v1";

  function isValidBookmarkBackup(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (typeof obj.id !== "string" || typeof obj.name !== "string") return false;
    if (!Array.isArray(obj.bookmarks)) return false;
    if (!Array.isArray(obj.subfolders)) return false;
    return true;
  }

  function showStatus(text, type) {
    const el = document.getElementById("status");
    el.textContent = text;
    el.className = type || "info";
    el.style.display = "block";
    document.getElementById("close-btn").style.display = "block";
  }

  function uint8ArrayToBase64(bytes) {
    const CHUNK = 8192;
    let binary = "";
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i += CHUNK) {
      const chunk = arr.subarray(i, Math.min(i + CHUNK, arr.length));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  async function encryptAndSave(data) {
    const result = await browser.storage.local.get(MASTER_PASSWORD_KEY);
    const password = result[MASTER_PASSWORD_KEY];
    if (!password) {
      throw new Error("No stored password found. Please log in to the extension first.");
    }
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: encoder.encode(SALT),
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedData = encoder.encode(JSON.stringify(data));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      derivedKey,
      encodedData
    );
    const encryptedData = uint8ArrayToBase64(encrypted);
    const ivB64 = btoa(String.fromCharCode(...iv));
    await browser.storage.local.set({
      [BOOKMARKS_AND_FOLDERS_KEY]: { encryptedData, iv: ivB64 },
    });
  }

  document.getElementById("file-input").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (ev) {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data || typeof data !== "object") {
          showStatus("Invalid file: not a valid JSON object.", "error");
          return;
        }
        if (!isValidBookmarkBackup(data)) {
          showStatus("Invalid backup format. File must have id, name, bookmarks (array), and subfolders (array).", "error");
          return;
        }

        if (!confirm("This will replace all existing bookmarks. Continue?")) {
          showStatus("Import cancelled.", "info");
          return;
        }

        showStatus("Importing…", "info");
        await encryptAndSave(data);
        showStatus("Import successful! You can close this tab and open the extension again.", "success");
      } catch (err) {
        showStatus("Import failed: " + (err && err.message ? err.message : String(err)), "error");
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("close-btn").addEventListener("click", function () {
    window.close();
  });
})();
