// Inline constants
const MASTER_PASSWORD_KEY = "auth_secret";
const BOOKMARKS_AND_FOLDERS_KEY = "folders";

// Inline EncryptionService for background script
class EncryptionService {
    static SALT = "chrome-bookmarks-v1";

    static async deriveKeyFromHashedPassword() {
      return new Promise((resolve, reject) => {
        browser.storage.local.get(MASTER_PASSWORD_KEY).then(async (result) => {
          if (!result[MASTER_PASSWORD_KEY]) {
            reject(new Error("No stored password found"));
            return;
          }
    
          try {
            const password = result[MASTER_PASSWORD_KEY];            
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
                salt: encoder.encode(this.SALT),
                iterations: 100000,
                hash: "SHA-256",
              },
              keyMaterial,
              { name: "AES-GCM", length: 256 },
              true,
              ["encrypt", "decrypt"]
            );
    
            resolve(derivedKey);
          } catch (error) {
            reject(error);
          }
        }).catch(reject);
      });
    }
  
    static async encrypt(data) {
      let encryptionKey = await this.deriveKeyFromHashedPassword();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encodedData = new TextEncoder().encode(data);
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        encryptionKey,
        encodedData
      );
      return {
        encryptedData: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
        iv: btoa(String.fromCharCode(...iv)),
      };
    }
  
    static async decrypt(encryptedData, iv) {    
      let encryptionKey = await this.deriveKeyFromHashedPassword();
      const encryptedBuffer = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
      const ivBuffer = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
    
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBuffer },
        encryptionKey,
        encryptedBuffer
      );
    
      const decodedData = new TextDecoder().decode(decrypted);
      let objectJson = JSON.parse(decodedData);
    
      try {
        return objectJson;
      } catch (error) {
        return null;
      }
    }      
}

// Add the context menu for tabs (async so we can await create() where it returns a Promise, e.g. Chrome)
browser.runtime.onInstalled.addListener(async () => {
  try {
    const createResult = browser.contextMenus.create({
      id: "saveTabToBookmarks",
      title: "Save Tab to Bookmarks",
      contexts: ["all"],
    });
    if (createResult && typeof createResult.then === "function") {
      await createResult;
    }
  } catch (error) {
    console.error("Error creating context menu:", error);
  }
});

// Handle import from import.html tab (popup closes when file picker opens, so import runs in a tab)
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "importBookmarks" || !message.data) {
    return;
  }
  (async () => {
    try {
      const { encryptedData, iv } = await EncryptionService.encrypt(JSON.stringify(message.data));
      await browser.storage.local.set({ [BOOKMARKS_AND_FOLDERS_KEY]: { encryptedData, iv } });
      sendResponse({ success: true });
    } catch (err) {
      console.error("Import failed:", err);
      sendResponse({ success: false, error: (err && err.message) ? err.message : String(err) });
    }
  })();
  return true; // keep channel open for async sendResponse
});

/**
 * Saves the given tab as a bookmark to the root folder.
 * Skips duplicates. Used by context menu and keyboard command.
 */
async function savePageFromTab(tab) {
  const { url, title, favIconUrl } = tab;
  if (!url || !title) return;

  try {
    const result = await browser.storage.local.get([BOOKMARKS_AND_FOLDERS_KEY]);
    const storedData = result[BOOKMARKS_AND_FOLDERS_KEY] || null;

    let folderData;
    if (storedData && storedData.encryptedData && storedData.iv) {
      folderData = await EncryptionService.decrypt(storedData.encryptedData, storedData.iv);
    } else {
      folderData = {
        id: "root",
        name: "Root",
        bookmarks: [],
        subfolders: []
      };
    }

    const rootFolder = folderData;
    const duplicate = rootFolder.bookmarks.find((bookmark) => bookmark.url === url);
    if (!duplicate) {
      const bookmarkId = `bookmark-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      rootFolder.bookmarks.push({
        id: bookmarkId,
        url,
        title,
        favIconUrl
      });
      const { encryptedData, iv } = await EncryptionService.encrypt(JSON.stringify(folderData));
      await browser.storage.local.set({ [BOOKMARKS_AND_FOLDERS_KEY]: { encryptedData, iv } });
    }
  } catch (err) {
    console.error("Error saving bookmark in background.js:", err);
  }
}

// Handle context menu clicks
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "saveTabToBookmarks") {
    await savePageFromTab(tab);
  }
});

// Handle keyboard shortcut
browser.commands.onCommand.addListener(async (command) => {
  if (command !== "save-page") return;

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) return;

  await savePageFromTab(tab);

  try {
    await browser.tabs.sendMessage(tab.id, { type: "SHOW_TOAST", text: "Page saved" });
  } catch (_) {
    // Tab may be a privileged page where content script cannot run; ignore
  }
});
