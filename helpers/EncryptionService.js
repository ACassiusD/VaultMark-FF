import { MASTER_PASSWORD_KEY } from "./constants.js";

export default class EncryptionService {
    static SALT = "chrome-bookmarks-v1"; // Static salt for PBKDF2 key derivation

    /**
     * Derives an encryption key from the user's password.
     * Used for Encryption and Decryption
     * @param {string} password - The user's password.
     * @returns {Promise<CryptoKey>} - The derived AES-GCM encryption key.
     */
    static async deriveKeyFromHashedPassword() {
      return new Promise((resolve, reject) => {
        chrome.storage.local.get(MASTER_PASSWORD_KEY, async (result) => { // Use this.MASTER_PASSWORD_KEY
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
                salt: encoder.encode(this.SALT), // Use this.SALT
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
        });
      });
    }
  
    /**
     * Encrypts data using AES-GCM.
     * @param {string} data - The data to encrypt.
     * @param {CryptoKey} key - The encryption key.
     * @returns {Promise<{ encryptedData: string, iv: string }>} - The encrypted data and IV.
     */
    static async encrypt(data) {
      let encryptionKey = await this.deriveKeyFromHashedPassword();
      const iv = crypto.getRandomValues(new Uint8Array(12)); // Unique IV per encryption
      const encodedData = new TextEncoder().encode(data);
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        encryptionKey,
        encodedData
      );
      return {
        encryptedData: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
        iv: btoa(String.fromCharCode(...iv)), // Store IV alongside data
      };
    }
  
    /**
     * Decrypts encrypted data using AES-GCM.
     * @param {string} encryptedData - Base64-encoded encrypted data.
     * @param {string} iv - Base64-encoded IV.
     * @param {CryptoKey} key - The decryption key.
     * @returns {Promise<string>} - The decrypted plaintext data.
     */
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
        return objectJson; // Convert string to object
      } catch (error) {
        return null; // Return null if JSON parsing fails
      }
    }      
  }
  