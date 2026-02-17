// Inline constants
const MASTER_PASSWORD_KEY = "auth_secret";

// Inline EncryptionService for popup script
class EncryptionService {
    static SALT = "chrome-bookmarks-v1";

    static async deriveKeyFromHashedPassword() {
      const result = await browser.storage.local.get(MASTER_PASSWORD_KEY);
      if (!result[MASTER_PASSWORD_KEY]) {
        throw new Error("No stored password found");
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
    
        return derivedKey;
      } catch (error) {
        throw error;
      }
    }
  
    /** Convert Uint8Array to base64 in chunks to avoid "too many function arguments" for large payloads. */
    static _uint8ArrayToBase64(bytes) {
      const CHUNK = 8192;
      let binary = "";
      const arr = new Uint8Array(bytes);
      for (let i = 0; i < arr.length; i += CHUNK) {
        const chunk = arr.subarray(i, Math.min(i + CHUNK, arr.length));
        binary += String.fromCharCode.apply(null, chunk);
      }
      return btoa(binary);
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
        encryptedData: this._uint8ArrayToBase64(encrypted),
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

const loginSection = document.getElementById("login-section");
const bookmarksSection = document.getElementById("bookmarks-section");
const loginForm = document.getElementById("login-form");
const searchInput = document.getElementById("bookmark-search");
const bookmarkForm = document.getElementById("bookmark-form");
const bookmarksList = document.getElementById("bookmarks-list");
const logoutButton = document.getElementById("logout-button");
const filterToggle = document.getElementById("filter-toggle");
const saveCurrentTabButton = document.getElementById("save-current-tab");

const BOOKMARKS_AND_FOLDERS_KEY = "folders";
const DEFAULT_SAVE_FOLDER_KEY = "defaultSaveFolderId";
const LAST_AUTH_TIME_KEY = "lastAuthTime"; // Key to store the last time the user entered their password
const AUTH_GRACE_PERIOD = 5 * 60 * 1000; // 5 minutes in milliseconds

const hashPassword = async (password) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
};
let currentFolderId = "root";

/**
 * Searches and filters bookmarks based on user input and filter toggle state,
 * When the filter toggle is checked, searches through all folders
 * When unchecked, only searches the current folder.
 * Update the UI to display matching results.
 * If no search query is provided, resets UI show default bookmarks view
 * 
 * @async
 * @function searchAndFilterBookmarks
 * @returns {Promise<void>} Updates UI with filtered bookmark results
 */
const searchAndFilterBookmarks = async () => {
  // Get and normalize the search query
  const searchQuery = searchInput.value.trim().toLowerCase();
  
  // If no search query, show all bookmarks and exit
  if (!searchQuery) {
    loadBookmarks();
    return;
  }

  // Get all bookmark data
  const data = await getAllBookmarkAndFolderData();
  if (!data) return;

  let filteredBookmarks = [];

  // Handle searching based on filter toggle state
  if (filterToggle.checked) {
    // Search all folders when toggle is checked
    filteredBookmarks = getFilteredBookmarksInAllFolders(data, searchQuery);
  } else {
    // Search only current folder when toggle is unchecked
    filteredBookmarks = getFilteredBookmarksInCurrentFolder(data, searchQuery);
  }

  renderFilteredBookmarks(filteredBookmarks);
};

/**
 * Recursively searches through all folders and subfolders for bookmarks matching a search query
 * @param {Object} folder - The folder object to search through, containing bookmarks and subfolders
 * @param {string} query - The search query to match against bookmark URLs and titles
 * @returns {Array} An array of bookmark objects that match the search query
 */
const getFilteredBookmarksInAllFolders = (folder, query) => {
  let results = [];

  // Search bookmarks in current folder
  if (folder.bookmarks) {
    results.push(...folder.bookmarks.filter(bookmark => 
      bookmark.url.toLowerCase().includes(query) || 
      bookmark.title.toLowerCase().includes(query)
    ).map(bookmark => ({
      ...bookmark,
      folderId: folder.id,
      folderName: folder.name
    })));
  }

  // Recursively search subfolders
  if (folder.subfolders) {
    folder.subfolders.forEach(subfolder => {
      results = results.concat(getFilteredBookmarksInAllFolders(subfolder, query));
    });
  }

  return results;
};

/**
 * Filters bookmarks in the current folder that match a search query
 * @param {Object} data - The full bookmark data structure containing all folders
 * @param {string} query - The search query to match against bookmark URLs and titles
 * @returns {Array} An array of bookmark objects from the current folder that match the search query
 */
const getFilteredBookmarksInCurrentFolder = (data, query) => {
  const currentFolder = findFolderById(data, currentFolderId);
  if (!currentFolder?.bookmarks) return [];

  // Return the bookmarks that match the search query
  return currentFolder.bookmarks.filter(bookmark =>
    bookmark.url.toLowerCase().includes(query) || 
    bookmark.title.toLowerCase().includes(query)
  );
};

// Render the filtered bookmarks to UI
const renderFilteredBookmarks = async (filteredBookmarks) => {
  bookmarksList.innerHTML = "";

  if (filteredBookmarks.length === 0) {
    renderNoSearchResultsMessage();
    return;
  }

  // Create and append each bookmark html element to the bookmarks list
  filteredBookmarks.forEach(bookmark => {
    const parentInfo = filterToggle.checked ? 
      { folderId: bookmark.folderId, folderName: bookmark.folderName } : 
      null;
    const bookmarkElement = createBookmarkElement(bookmark, parentInfo);
    bookmarksList.appendChild(bookmarkElement);
  });

  // Attach event listeners to the bookmarks list
  attachBookmarkEventListeners();
  attachDragAndDropListeners();
};

// Render the "no results found" message with a clear button
const renderNoSearchResultsMessage = () => {
  const noResultsHtml = `
    <li class='no-results'>
      No bookmarks found.
      <span id="clear-filter-btn" class="clear-search">✖ Clear Search</span>
    </li>
  `;
  bookmarksList.innerHTML = noResultsHtml;

  // Attach event listener to clear filter button
  document.getElementById("clear-filter-btn").addEventListener("click", () => {
    searchInput.value = "";
    loadBookmarks();
  });
};

// Create the element that displays the folder name for a bookmark filtered from another folder
const createFolderInfoElement = (parentInfo) => {
  if (!filterToggle.checked || !parentInfo || parentInfo.folderId === currentFolderId) {
    return null;
  }

  const folderInfo = document.createElement("span");
  folderInfo.classList.add("folder-info");
  
  // Create clickable folder name
  const folderNameSpan = document.createElement("span");
  folderNameSpan.classList.add("folder-name-link");
  folderNameSpan.textContent = `[${parentInfo.folderName}] `;
  folderNameSpan.dataset.folderId = parentInfo.folderId;
  
  // Add click event to navigate to folder
  folderNameSpan.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Navigate to the folder
    currentFolderId = parentInfo.folderId;
    searchInput.value = ""; // Clear the search
    loadBookmarks();
  });
  
  folderInfo.appendChild(folderNameSpan);
  return folderInfo;
};

// Create a bookmark list item HTML element to be displayed to th UI
const createBookmarkElement = (bookmark, parentInfo) => {
  const { id, url, title, favIconUrl } = bookmark;
  
  const li = document.createElement("li");
  li.classList.add("bookmark");
  li.setAttribute("draggable", "true");
  li.dataset.url = url;

  // Create favicon image
  const img = document.createElement("img");
  img.src = favIconUrl || "default-icon.png";
  img.alt = "Favicon";
  img.classList.add("bookmark-favicon");

  // Create link
  const link = document.createElement("a");
  link.href = url;
  link.classList.add("bookmark-link");
  link.target = "_blank";
  link.textContent = title;

  // Create content container
  const contentContainer = document.createElement("div");
  contentContainer.classList.add("content-container");

  // Add folder info if needed
  const folderInfo = createFolderInfoElement(parentInfo);
  if (folderInfo) {
    contentContainer.appendChild(folderInfo);
  }
  contentContainer.appendChild(link);

  // Create delete button
  const deleteBtn = document.createElement("button");
  deleteBtn.classList.add("delete-btn");
  deleteBtn.dataset.bookmarkId = id;
  deleteBtn.textContent = "x";

  // Assemble the elements
  li.appendChild(img);
  li.appendChild(contentContainer);
  li.appendChild(deleteBtn);

  return li;
};

// Generic function to save data to storage
const saveToStorage = async (key, value) => {
  return browser.storage.local.set({ [key]: value });
};

// Save data to Chrome storage (Encrypt before saving)
const saveToStorageEncrypted = async (key, value) => {
  try {
    console.log("[VaultMarks] saveToStorageEncrypted: deriving key and encrypting...");
    const { encryptedData, iv } = await EncryptionService.encrypt(JSON.stringify(value));
    console.log("[VaultMarks] saveToStorageEncrypted: encrypt done, writing to storage");
    await saveToStorage(key, { encryptedData, iv }); // Using the generic function
    console.log("[VaultMarks] saveToStorageEncrypted: write done");
  } catch (error) {
    console.error("[VaultMarks] saveToStorageEncrypted error:", error);
    throw error; // Propagate so callers (e.g. import) can show the right error
  }
};

// Retrieves data from browser storage using browser.storage.local with the specified key. 
// This function returns the stored value as-is, without performing any decryption.
const getFromStorage = async (key) => {
  const result = await browser.storage.local.get([key]);
  return result[key] || null;
};

// Get a decrypted version of the bookmark+folder data from chrome storage
const getAllBookmarkAndFolderData = async () => {
  try {
    const storedData = await getFromStorage(BOOKMARKS_AND_FOLDERS_KEY);
    if (!storedData) {
      console.log("[VaultMarks] getAllBookmarkAndFolderData: no stored data (null)");
      return null;
    }
    if (!storedData.encryptedData || !storedData.iv) {
      console.log("[VaultMarks] getAllBookmarkAndFolderData: stored data missing encryptedData or iv", Object.keys(storedData));
      return null;
    }
    const { encryptedData, iv } = storedData;
    const decryptedData = await EncryptionService.decrypt(encryptedData, iv);
    console.log("[VaultMarks] getAllBookmarkAndFolderData: decrypted, root id:", decryptedData && decryptedData.id, "bookmarks:", decryptedData && decryptedData.bookmarks && decryptedData.bookmarks.length);
    return decryptedData;
  } catch (error) {
    console.error("[VaultMarks] getAllBookmarkAndFolderData error:", error);

    return null;
  }
};

// Save data to Chrome storage (Encrypt before saving)
const saveAndHashPassword = async (password) => {
  try {
    const hashedPassword = await hashPassword(password);
    await browser.storage.local.set({ [MASTER_PASSWORD_KEY]: hashedPassword });
  } catch (error) {
    console.error("Error hashing password:", error);
  }
};

/**
 * Returns the hashed password stored in Chrome storage.
 * @returns {Promise<string | null>} - The stored password or null if not found.
 */
const getHashedPassword = async () => {
  const data = await browser.storage.local.get(MASTER_PASSWORD_KEY);
  return data[MASTER_PASSWORD_KEY] || null;
};

// Load and display bookmark + folders 
const loadBookmarks = async () => {
  const data = await getAllBookmarkAndFolderData();
  const folder = findFolderById(data, currentFolderId);
  if (!data) console.log("[VaultMarks] loadBookmarks: no data, nothing to show");
  else if (!folder) console.log("[VaultMarks] loadBookmarks: folder not found for id", currentFolderId);
  let foldersHtml = "";

  if (folder) {
    // Check if the current folder has a parent, if so, add a back button as the first folder item
    const parentFolder = findParentFolderById(data, currentFolderId);
    if (parentFolder) {
      foldersHtml += `<li class="back-btn" data-parent-folder-id="${parentFolder.id}"><span>Back to ${parentFolder.name}</span></li>`;
    }

    // Render folders
    foldersHtml += folder.subfolders
      .map(
        (subfolder) => `<li class="folder" data-folder-id="${subfolder.id}">
          <span class="folder-name">${subfolder.name}</span>
          <div class="folder-actions">
            <button class="delete-folder-btn" data-folder-id="${subfolder.id}">x</button>
          </div>
        </li>`
      )
      .join("");

    // Render bookmarks
    const bookmarksHtml = folder.bookmarks
      .map(
        ({ id, url, title, favIconUrl }) =>
          `<li class="bookmark" draggable="true" data-url="${url}">
            <img src="${favIconUrl || 'default-icon.png'}" alt="Favicon">
            <a href="${url}" class="bookmark-link" target="_blank">${title}</a>
            <button class="delete-btn" data-bookmark-id="${id}">x</button>
          </li>`
      )
      .join("");

    // Update UI
    bookmarksList.innerHTML = `<div class="folders-container">${foldersHtml}</div>${bookmarksHtml}`;

    attachFolderEventListeners();
    attachBookmarkEventListeners();
    attachDragAndDropListeners();
  }
  await refreshDefaultFolderSelect(data);
};

// Find folder by ID (recursive)
const findFolderById = (folders, id) => {
  if (!folders || typeof folders !== "object") return null; // Ensure folders is a valid object

  // Check if the root folder itself matches the ID
  if (folders.id === id) return folders;

  // Ensure subfolders exists and is an array before recursion
  if (Array.isArray(folders.subfolders)) {
    for (const subfolder of folders.subfolders) {
      const found = findFolderById(subfolder, id);
      if (found) return found;
    }
  }

  return null; // Not found
};

const findParentFolderById = (folder, id, parent = null) => {

  // Ensure folder is a valid object
  if (!folder || typeof folder !== "object") return null; 

  // If the folder itself is the target, return its parent
  if (folder.id === id) return parent; 

  // Ensure subfolders exists and is an array before recursion
  if (Array.isArray(folder.subfolders)) {
    for (const subfolder of folder.subfolders) {
      const parentFolder = findParentFolderById(subfolder, id, folder);
      if (parentFolder) return parentFolder;
    }
  }

  return null; // No parent found
};

// Build a flat list of folders for the default-save-folder dropdown (id + display name with indent)
const getAllFoldersFlat = (folder, acc = [], prefix = "") => {
  if (!folder || typeof folder !== "object") return acc;
  acc.push({ id: folder.id, displayName: prefix + folder.name });
  if (Array.isArray(folder.subfolders)) {
    for (const sub of folder.subfolders) {
      getAllFoldersFlat(sub, acc, prefix + "  ");
    }
  }
  return acc;
};

// Populate the default save folder dropdown and restore selected value from storage
const refreshDefaultFolderSelect = async (data) => {
  const select = document.getElementById("default-save-folder");
  if (!select) return;
  let savedId = await getFromStorage(DEFAULT_SAVE_FOLDER_KEY);
  select.innerHTML = "";
  const currentOption = document.createElement("option");
  currentOption.value = "";
  currentOption.textContent = "Current folder";
  select.appendChild(currentOption);
  const validIds = new Set();
  if (data) {
    const flat = getAllFoldersFlat(data);
    for (const { id, displayName } of flat) {
      validIds.add(id);
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = displayName;
      select.appendChild(opt);
    }
  }
  // Only apply saved value if that folder still exists; otherwise clear to "Current folder"
  if (savedId && !validIds.has(savedId)) {
    savedId = null;
    await saveToStorage(DEFAULT_SAVE_FOLDER_KEY, null);
  }
  select.value = savedId || "";
};

// Validate backup root: must have id, name, and arrays for bookmarks and subfolders
const isValidBookmarkBackup = (obj) => {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.id !== "string" || typeof obj.name !== "string") return false;
  if (!Array.isArray(obj.bookmarks)) return false;
  if (!Array.isArray(obj.subfolders)) return false;
  return true;
};

// Import: open the import tab (file picker in popup would close the popup, so we use a tab that stays open)
const importData = async () => {
  console.log("[VaultMarks] Import button clicked, opening import tab");
  try {
    await browser.tabs.create({ url: browser.runtime.getURL("import.html") });
  } catch (error) {
    console.error("Error opening import tab:", error);
    alert("Failed to open import page.");
  }
};

// Export and download user's Bookmark and Folder data as a JSON
const exportData = async () => {
  try {
    // Get decrypted bookmark data
    const data = await getAllBookmarkAndFolderData();
    if (!data) {
      alert("No data available to export.");
      return;
    }

    // Convert the data to a JSON string with pretty formatting
    const jsonData = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonData], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    // Create and trigger download
    const a = document.createElement("a");
    a.href = url;
    a.download = "bookmarks_backup.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert("Data exported successfully!");
  } catch (error) {
    console.error("Error exporting data:", error);
    alert("Failed to export data.");
  }
};

//Save folder and bookmark data to chrome storage as encrypted
const saveBookmarkData = async (data) => {
  return await saveToStorageEncrypted(BOOKMARKS_AND_FOLDERS_KEY, data);
}

//Log the full data for this extension stored in browser's local storage
const logBrowserStorageData = () => {
  browser.storage.local.get().then((result) => {
    console.log("Updated Local Storage Data --> ", result);
  }).catch((error) => {
    console.error("Error:", error);
  });
}

const handleSubmitPassword = async (e) => {
  e.preventDefault();
  const enteredPassword = document.getElementById("password").value.trim();
  if (!enteredPassword) {
    alert("Please enter a password.");
    return;
  }

  const storedPassword = await getHashedPassword();

  if (!storedPassword) {
    // First-time password setup
    const confirmPasswordInput = document.getElementById("confirm-password");
    if (!confirmPasswordInput) {
      // Create confirm password field if it doesn't exist
      const passwordInput = document.getElementById("password");
      const confirmInput = document.createElement("input");
      confirmInput.type = "password";
      confirmInput.id = "confirm-password";
      confirmInput.placeholder = "Confirm password";
      passwordInput.parentNode.insertBefore(confirmInput, passwordInput.nextSibling);
      return;
    }

    const confirmPassword = confirmPasswordInput.value.trim();
    if (enteredPassword === confirmPassword) {
      await saveAndHashPassword(enteredPassword);
      await setLastAuthTime();
      await initializeFolderStructure();
      loginSection.classList.add("hidden");
      bookmarksSection.classList.remove("hidden");
      loadBookmarks();
      
      // Remove confirm password field
      confirmPasswordInput.remove();
    } else {
      alert("Passwords do not match. Please try again.");
    }
  } else {
    // Regular login
    const hashedEnteredPassword = await hashPassword(enteredPassword);
    if (hashedEnteredPassword === storedPassword) {
      await setLastAuthTime();
      loginSection.classList.add("hidden");
      bookmarksSection.classList.remove("hidden");
      loadBookmarks();
    } else {
      alert("Invalid password. Please try again.");
    }
  }

  // Clear password fields
  document.getElementById("password").value = "";
  const confirmPasswordInput = document.getElementById("confirm-password");
  if (confirmPasswordInput) {
    confirmPasswordInput.value = "";
  }
};

// Save the current timestamp to storage on successful login
const setLastAuthTime = async () => {
  const currentTime = Date.now();
  await saveToStorage(LAST_AUTH_TIME_KEY, currentTime);
};

// Check if the grace period is active
const isWithinGracePeriod = async () => {
  const lastAuthTime = await getFromStorage(LAST_AUTH_TIME_KEY);
  if (!lastAuthTime) return false;

  const currentTime = Date.now();
  return currentTime - lastAuthTime < AUTH_GRACE_PERIOD;
};

// Helper function to initialize folder structure
const initializeFolderStructure = async () => {
  let existingData = await getFromStorage(BOOKMARKS_AND_FOLDERS_KEY);
  if (!existingData) {
    existingData = {
      id: "root",
      name: "Root",
      bookmarks: [],
      subfolders: []
    };
    try {
      await saveBookmarkData(existingData);
    } catch (error) {
      console.error("Error initializing folder structure:", error);
    }
  }
};

//======================================
//******     EVENT LISTENERS     *******
//======================================

// Handle search input and filter toggle
searchInput.addEventListener("input", searchAndFilterBookmarks);

// Handle filter toggle change
filterToggle.addEventListener("change", searchAndFilterBookmarks);

// Handle clear search button
const clearSearchBtn = document.getElementById("clear-search-btn");
clearSearchBtn.addEventListener("click", () => {
  searchInput.value = "";
  searchInput.focus();
  loadBookmarks();
  updateClearButtonVisibility();
});

// Function to update clear button visibility
const updateClearButtonVisibility = () => {
  if (searchInput.value.trim()) {
    clearSearchBtn.classList.add("visible");
  } else {
    clearSearchBtn.classList.remove("visible");
  }
};

// Update clear button visibility on search input
searchInput.addEventListener("input", updateClearButtonVisibility);

// Handle login button click
loginForm.addEventListener("submit", async (e) => {
  handleSubmitPassword(e);
});

// Handle logout button click
logoutButton.addEventListener("click", async () => {
  await saveToStorage(LAST_AUTH_TIME_KEY, null); // Clear the last auth time
  loginSection.classList.remove("hidden");
  bookmarksSection.classList.add("hidden");
  document.getElementById("password").value = "";
});

// Handle Save Current Tab button
saveCurrentTabButton.addEventListener("click", async () => {
  try {
    // Get the active tab in the current window
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      const url = tab.url;
      const title = tab.title;
      const favIconUrl = tab.favIconUrl || "default-icon.png"; // Default icon if no favicon available

      // Retrieve folder structure and decide target folder (default or current)
      const data = await getAllBookmarkAndFolderData();
      const defaultFolderId = await getFromStorage(DEFAULT_SAVE_FOLDER_KEY);
      const targetFolderId = defaultFolderId || currentFolderId;
      const targetFolder = findFolderById(data, targetFolderId);

      if (!targetFolder) {
        alert("No target folder found. Please ensure a folder is selected or set a valid default.");
        return;
      }

      // Check for duplicates in the target folder
      const duplicate = targetFolder.bookmarks.find((bookmark) => bookmark.url === url);
      if (duplicate) {
        const confirmDuplicate = confirm(`Duplicate Bookmark Detected. Do you want to save it again?`);
        if (!confirmDuplicate) return;
      }

      // Add bookmark to the target folder with unique ID
      targetFolder.bookmarks.push({ 
        id: `bookmark-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        url, 
        title, 
        favIconUrl 
      });
      await saveBookmarkData(data); // Save updated structure
      loadBookmarks();
    } else {
      alert("No active tab found.");
    }
  } catch (error) {
    console.error("Error saving current tab:", error);
    alert("Failed to save the current tab.");
  }
});

// Handle Submit bookmark button
bookmarkForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = document.getElementById("url").value.trim();
  const title = document.getElementById("title").value.trim();

  try {
    const data = await getAllBookmarkAndFolderData();
    const currentFolder = findFolderById(data, currentFolderId);

    if (!currentFolder) {
      alert("No active folder found. Please ensure a folder is selected.");
      return;
    }

    const duplicate = currentFolder.bookmarks.find((bookmark) => bookmark.url === url);
    if (duplicate) {
      const confirmDuplicate = confirm(`Duplicate Bookmark Detected. Do you want to save it again?`);
      if (!confirmDuplicate) return;
    }

    const urlObj = new URL(url);
    const favIconUrl = `${urlObj.protocol}//${urlObj.hostname}/favicon.ico`;

    currentFolder.bookmarks.push({
      id: `bookmark-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      url,
      title,
      favIconUrl
    });
    await saveBookmarkData(data);
    loadBookmarks();
    bookmarkForm.reset();
  } catch (error) {
    console.error("Error saving bookmark:", error);
    alert("Failed to save bookmark. If you just logged in, try again.");
  }
});

// Handle Folder Creation
document.getElementById("create-folder-btn").addEventListener("click", async () => {
  const folderName = prompt("Enter folder name:");
  if (!folderName) return;

  try {
    const data = await getAllBookmarkAndFolderData();
    const currentFolder = findFolderById(data, currentFolderId);

    if (currentFolder) {
      const newFolder = {
        id: `folder-${Date.now()}`,
        name: folderName,
        bookmarks: [],
        subfolders: [],
      };
      currentFolder.subfolders.push(newFolder);
      await saveBookmarkData(data);
      loadBookmarks();
    }
  } catch (error) {
    console.error("Error creating folder:", error);
    alert("Failed to create folder. If you just logged in, try again.");
  }
});

document.addEventListener("DOMContentLoaded", () => {
  // Toggle bookmark form visibility
  document.getElementById("toggle-bookmark-form").addEventListener("click", () => {
    const form = document.getElementById("bookmark-form");
    form.style.display = form.style.display === "none" || form.style.display === "" ? "block" : "none";
  });

  // Hide form after submission
  document.getElementById("bookmark-form").addEventListener("submit", (e) => {
    e.preventDefault();
    setTimeout(() => {
      document.getElementById("bookmark-form").style.display = "none";
    }, 500);
  });

  // Persist default save folder when user changes the dropdown
  document.getElementById("default-save-folder").addEventListener("change", async (e) => {
    const value = e.target.value || null;
    await saveToStorage(DEFAULT_SAVE_FOLDER_KEY, value);
  });

  // Open Firefox’s “Manage Extension Shortcuts” so user can assign a key for “Save page”
  const optionsBtn = document.getElementById("options-btn");
  const mainView = document.getElementById("main-view");
  const settingsView = document.getElementById("settings-view");
  const settingsBackBtn = document.getElementById("settings-back-btn");
  const refreshShortcutDisplay = async () => {
    const el = document.getElementById("current-shortcut-display");
    if (!el || !browser.commands || typeof browser.commands.getAll !== "function") return;
    try {
      const commands = await browser.commands.getAll();
      const savePage = commands.find((c) => c.name === "save-page");
      el.textContent = savePage && savePage.shortcut ? savePage.shortcut : "Not set";
    } catch (_) {
      el.textContent = "—";
    }
  };

  if (optionsBtn && mainView && settingsView) {
    optionsBtn.addEventListener("click", () => {
      mainView.classList.add("hidden");
      settingsView.classList.remove("hidden");
      refreshShortcutDisplay();
    });
  }
  if (settingsBackBtn && mainView && settingsView) {
    settingsBackBtn.addEventListener("click", () => {
      settingsView.classList.add("hidden");
      mainView.classList.remove("hidden");
    });
  }

  const openShortcutBtn = document.getElementById("open-shortcut-settings");
  if (openShortcutBtn && browser.commands && typeof browser.commands.openShortcutSettings === "function") {
    openShortcutBtn.addEventListener("click", () => {
      browser.commands.openShortcutSettings();
    });
  } else if (openShortcutBtn) {
    openShortcutBtn.style.display = "none";
  }
});

// Handle export button click
document.getElementById("export-button").addEventListener("click", exportData);

// Handle import button click
document.getElementById("import-button").addEventListener("click", importData);

// Attach folder-related event listeners
const attachBookmarkEventListeners = () => {
  // Handle bookmark clicks (open in new tab)
  document.querySelectorAll(".bookmark-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault(); // Prevent default behavior
      const url = link.href;
      browser.tabs.create({ url, active: false }); // Open in a background tab
    });

    // Handle middle mouse button clicks (open in new tab)
    link.addEventListener("auxclick", (e) => {
      if (e.button === 1) { // Middle mouse button
        e.preventDefault(); // Prevent default behavior
        const url = link.href;
        browser.tabs.create({ url, active: false }); // Open in a background tab
      }
    });
  });

  // Handle bookmark deletion
  document.querySelectorAll(".delete-btn").forEach((button) =>
    button.addEventListener("click", async (e) => {
      const bookmarkId = button.dataset.bookmarkId;
      try {
        const data = await getAllBookmarkAndFolderData();
        const folder = findFolderById(data, currentFolderId);

        if (folder) {
          folder.bookmarks = folder.bookmarks.filter(
            (bookmark) => bookmark.id !== bookmarkId
          );
          await saveBookmarkData(data);
          loadBookmarks();
        }
      } catch (error) {
        console.error("Error deleting bookmark:", error);
        alert("Failed to delete bookmark.");
      }
    })
  );
};

//Attach event listeners to the folder elements in the UI including folder clicks and delete folder button clicks
const attachFolderEventListeners = async () => {
  const bookmarksAndFolderData = await getAllBookmarkAndFolderData();

  document.querySelectorAll(".folder").forEach((folderElement) => {
    folderElement.addEventListener("click", () => {
      const folderId = folderElement.dataset.folderId;
      currentFolderId = folderId; // Update the current folder ID
      loadBookmarks(); // Load the selected folder
    });

    folderElement.querySelector(".delete-folder-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      const folderIdToDelete = folderElement.dataset.folderId;
      try {
        const data = await getAllBookmarkAndFolderData();
        const parentFolder = findParentFolderById(data, folderIdToDelete);

        if (parentFolder) {
          const folderToDelete = parentFolder.subfolders.find(folder => folder.id === folderIdToDelete);
          const folderName = folderToDelete ? folderToDelete.name : "this folder";

          const confirmDelete = confirm(`Are you sure you want to delete "${folderName}"? This cannot be undone.`);
          if (!confirmDelete) return;

          parentFolder.subfolders = parentFolder.subfolders.filter(
            (folder) => folder.id !== folderIdToDelete
          );

          await saveBookmarkData(data);
          loadBookmarks();
        }
      } catch (error) {
        console.error("Error deleting folder:", error);
        alert("Failed to delete folder.");
      }
    });
  });

  // Add event listener for the inline back button
  const backBtn = document.querySelector(".back-btn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      const parentId = backBtn.dataset.parentFolderId;
      currentFolderId = parentId;
      loadBookmarks();
    });
  }
};

const attachDragAndDropListeners = () => {
  // Add Folder Events
  document.querySelectorAll(".folder").forEach((folderElement) => {
    //Folder Event - On Dragover
    folderElement.addEventListener("dragover", (e) => {
      e.preventDefault(); // Allow drop
      folderElement.classList.add("drag-over"); // Highlight folder
    });

    //Folder Event - On Drag Leave
    folderElement.addEventListener("dragleave", () => {
      folderElement.classList.remove("drag-over"); // Remove highlight
    });

    //Folder Event - On Drop
    folderElement.addEventListener("drop", async (e) => {
      e.preventDefault();
      folderElement.classList.remove("drag-over");

      const folderId = folderElement.dataset.folderId;
      const url = e.dataTransfer.getData("url");
      const title = e.dataTransfer.getData("title");
      const favIconUrl = e.dataTransfer.getData("favIconUrl");
      const bookmarkId = e.dataTransfer.getData("bookmarkId");

      if (!url || !folderId) return;

      try {
        const data = await getAllBookmarkAndFolderData();
        const targetFolder = findFolderById(data, folderId);

        if (targetFolder) {
          targetFolder.bookmarks.push({
            id: `bookmark-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            url,
            title,
            favIconUrl
          });

          const currentFolder = findFolderById(data, currentFolderId);
          if (currentFolder && bookmarkId) {
            currentFolder.bookmarks = currentFolder.bookmarks.filter(
              (bookmark) => bookmark.id !== bookmarkId
            );
          }
          await saveBookmarkData(data);
          loadBookmarks();
        }
      } catch (error) {
        console.error("Error moving bookmark:", error);
        alert("Failed to move bookmark.");
      }
    });
  });
  
  //Add Bookmark Events
  document.querySelectorAll(".bookmark").forEach((bookmarkElement) => {

    //Bookmark Event - On Drag Start
    bookmarkElement.addEventListener("dragstart", (e) => {
      const url = bookmarkElement.dataset.url;
      const title = bookmarkElement.querySelector(".bookmark-link").textContent;
      const favIconUrl = bookmarkElement.querySelector("img").src;
      const deleteBtn = bookmarkElement.querySelector(".delete-btn");
      const bookmarkId = deleteBtn ? deleteBtn.dataset.bookmarkId : null;

      // Store data for the dragged bookmark
      e.dataTransfer.setData("url", url);
      e.dataTransfer.setData("title", title);
      e.dataTransfer.setData("favIconUrl", favIconUrl);
      if (bookmarkId) {
        e.dataTransfer.setData("bookmarkId", bookmarkId);
      }
    });
  });
};

/**
 * Main Function
 * 
 * Handles the initial setup when the extension popup GUI is opened:
 * - Ensures a master password exists, prompting the user to create one if missing.
 * - Initializes the folder structure with a root folder if it doesn't exist.
 * - Checks if the user is within the 5-minute grace period and auto-logs them in if so.
 * - Loads bookmarks and folders into the UI if the user is authenticated.
 */
(async () => {
  try {
    // Retrieve the stored master password
    let storedPassword = await getHashedPassword();

    // Check if within grace period
    const withinGracePeriod = await isWithinGracePeriod();
    
    if (withinGracePeriod) {
      // Auto-login if within grace period
      loginSection.classList.add("hidden");
      bookmarksSection.classList.remove("hidden");
      await initializeFolderStructure();
      currentFolderId = "root";
      loadBookmarks();
      return;
    }

    // Show login section if not in grace period
    loginSection.classList.remove("hidden");
    bookmarksSection.classList.add("hidden");

    // Update login form placeholder text based on whether password exists
    const passwordInput = document.getElementById("password");
    passwordInput.placeholder = storedPassword ? "Enter your password" : "Set a new password";

    // Only initialize folder structure if a password exists
    if (storedPassword) {
      await initializeFolderStructure();
    }

  } catch (error) {
    console.error("Error during setup:", error);
    alert("An error occurred during the setup process.");
  }
})();