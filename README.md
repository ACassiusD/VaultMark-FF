# 🔒 Private Bookmark Manager - Firefox Extension

## Overview
A secure Firefox extension that allows you to store and organize your bookmarks in **private folders** with master password protection. Bookmarks are **encrypted and stored locally** using Firefox's storage API, keeping your data private from casual access.

## 🔑 Core Features

### 🔐 Security & Authentication
- **Master Password Protection** - Requires authentication to access bookmarks
- **Auto-login Grace Period** - 5-minute grace period after successful login
- **AES-GCM Encryption** - All bookmark data is encrypted before storage
- **Password Hashing** - SHA-256 hashing for secure password verification

### 📁 Organization & Management
- **Folder System** - Create and manage bookmark folders with nested subfolders
- **Drag & Drop** - Move bookmarks between folders with intuitive drag-and-drop
- **Bookmark Management** - Add, delete, and organize bookmarks with favicons
- **Navigation** - Easy folder navigation with breadcrumb-style back buttons

### 🔍 Search & Discovery
- **Smart Search** - Search bookmarks by URL or title
- **Folder-Specific Search** - Search within current folder only
- **Global Search** - Search across all folders with toggle option
- **Search Results** - Clickable folder links in search results for quick navigation

### 💾 Data Management
- **Import/Export** - Backup and restore your bookmarks as JSON files
- **Save Current Tab** - One-click bookmark saving from the active tab
- **Keyboard Shortcut** - Save the current page with a key (e.g. F9 or Ctrl+Alt+S). In the popup, click **Options** (gear icon), then **Set keyboard shortcut for "Save page"** to assign a key in Firefox’s Manage Extension Shortcuts; pick one that doesn’t conflict with Firefox’s built-in shortcuts.
- **Context Menu Integration** - Right-click any tab to save it to bookmarks
- **Duplicate Prevention** - Automatic duplicate detection and prevention

## 🚨 Security Notice
> ⚠ **This extension is designed to keep your bookmarks private from casual access** (e.g., friends, coworkers, or anyone using your computer) **but is not hardened against targeted attacks** by someone with programming skills.

### What This Protects Against
- **Casual Access** - Family members, coworkers, general computer users
- **Basic Privacy** - Keeps bookmarks private from normal browsing
- **Accidental Exposure** - Prevents accidental sharing of bookmark data

### What This Does NOT Protect Against
- **Determined Attackers** - Anyone with programming knowledge and browser access
- **Malware** - Software that can access browser storage and memory
- **Physical Access** - Someone with direct access to your computer and browser
- **Browser Vulnerabilities** - Exploits that can access extension data

## 📦 Packaging for submission (AMO)

AMO requires **forward slashes** in the ZIP (e.g. `icons/bookmark.svg`). On Windows, `Compress-Archive` can create `icons\bookmark.svg`, which fails validation.

**Recommended:** run the pack script from the extension folder (where `manifest.json` is):

```powershell
.\pack.ps1
```

This creates `Private-Bookmarks-1.1.zip` in the parent folder with correct path separators.

**Alternative (Git Bash or WSL):** from the extension folder:
```bash
zip -r ../Private-Bookmarks-1.1.zip . -x "*.git*" -x "README.md" -x "pack.ps1"
```

Then upload the `.zip` at [addons.mozilla.org](https://addons.mozilla.org) → Developer Hub → Submit a New Add-on.

## 📦 Installation

### For Development/Testing
1. Clone this repository or download the ZIP file
2. Open **Firefox** and navigate to `about:debugging`
3. Click **"This Firefox"** in the left sidebar
4. Click **"Load Temporary Add-on"**
5. Select the `manifest.json` file from the VaultMarks-FF folder

### For Permanent Installation
1. Clone this repository or download the ZIP file
2. Open **Firefox** and navigate to `about:addons`
3. Click the gear icon and select **"Install Add-on From File"**
4. Select the `manifest.json` file from the VaultMarks-FF folder
5. **Note**: Permanent installation requires the extension to be signed by Mozilla

## 🛠 How It Works

### First-Time Setup
1. **Password Creation** - Set your master password when first accessing the extension
2. **Folder Initialization** - A root folder is automatically created for your bookmarks
3. **Encryption Setup** - All data is encrypted using your password as the key

### Daily Usage
1. **Authentication** - Enter your password to access bookmarks (or use grace period)
2. **Navigation** - Browse folders and bookmarks with an intuitive interface
3. **Management** - Add, delete, and organize bookmarks as needed
4. **Search** - Find bookmarks quickly using the search functionality

## 🔐 Technical Security Details

### Password Storage
- **Hashing Algorithm**: SHA-256 (one-way, non-reversible)
- **Storage Location**: Firefox storage under key `"auth_secret"`
- **Verification**: Login compares SHA-256 hash of entered password with stored hash

### Data Encryption
- **Algorithm**: AES-GCM with 256-bit keys
- **Key Derivation**: PBKDF2 with 100,000 iterations using SHA-256
- **Salt**: Static salt `"chrome-bookmarks-v1"` for key derivation
- **Storage**: Encrypted data stored in Firefox storage under key `"folders"`

### Security Limitations
- **Client-side Storage**: All data stored locally in browser
- **Browser Access**: Anyone with browser access can potentially access stored data
- **DevTools Vulnerability**: Encrypted data can be decrypted using browser DevTools
- **No Backend**: No server-side validation or secure key storage
- **Memory Access**: While extension is open, encryption keys exist in memory

## ⌨️ Keyboard Shortcut (Save Page)
You can save the current page without opening the popup by assigning a keyboard shortcut:

1. Open the extension popup and click **Options** (gear icon in the icon bar).
2. Click **Set keyboard shortcut for "Save page"** to open Firefox’s **Manage Extension Shortcuts**.
3. Choose a key combination that Firefox isn’t already using (e.g. **F9**, **Ctrl+Alt+S**). Avoid **Ctrl+Shift+S** (screenshot) and **Alt+Shift+S** (history).
4. After saving, that key will save the active tab and show a short “Page saved” toast on the page.

The same “Save Tab to” folder and default-save behaviour apply when using the shortcut.

## 🔄 Import & Export
- **Export**: Click the export button to download a `.json` backup of all your bookmarks
- **Import**: Click the import button and select a previously exported `.json` file to restore

## 🔍 Known Limitations
- **No Cloud Sync** - All data is stored locally
- **Password Recovery** - If you forget your password, there is no way to recover your data
- **Browser Dependency** - Data is tied to your Firefox browser installation
- **Temporary Installation** - Development version requires reloading after Firefox restart

## 🐞 Development & Debugging

### Debugging the Popup
To debug the popup's onload event and hit breakpoints before any code runs:

1. Find your extension's ID on the `about:debugging` page
2. Navigate to: `moz-extension://<your-extension-id>/popup.html`
3. Press Enter to open the popup as a regular tab
4. Right-click and select **Inspect** to open DevTools
5. Reload the tab (F5) to debug from the very start

### Useful Debug Commands

**View extension local storage:**
```javascript
browser.storage.local.get().then((result) => {
    console.log(result);
})
```

**Clear extension storage data:**
```javascript
browser.storage.local.clear()
```

## 🔄 Firefox Compatibility Notes

### API Differences from Chrome Version
- **Browser APIs**: Uses `browser.*` APIs instead of `chrome.*` APIs
- **Promise-based**: All storage and tabs operations return Promises
- **Manifest V2**: Uses Manifest V2 instead of Manifest V3
- **Background Scripts**: Uses traditional background scripts instead of service workers
- **Module System**: ES6 modules are inlined for compatibility

### Cross-Browser Compatibility
This Firefox version maintains full feature parity with the Chrome version while using Firefox-specific APIs and manifest format.

## 📝 Changelog

### 1.1
- Fixed importing
- Added keyboard shortcut for “Save page” (configurable in browser extension shortcuts)
- Added settings page (default save location, shortcut link)

### 1.0
- Complete port from Chrome extension
- All core features working
- Firefox API compatibility
- Favicon support for manual bookmark addition
- Context menu integration
- Import/Export functionality