import { STORAGE_KEYS } from "@jobpilot/shared";

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AUTO_LOCK_MS = 15 * 60 * 1000;

interface EncryptedVaultPayload {
  version: 1;
  ciphertext: string;
  iv: string;
}

let unlockedApiKey: string | null = null;
let autoLockTimer: number | undefined;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function armAutoLock(): void {
  if (autoLockTimer) window.clearTimeout(autoLockTimer);
  autoLockTimer = window.setTimeout(() => void lockVault(), AUTO_LOCK_MS);
}

export async function hasStoredApiKey(): Promise<boolean> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.encryptedApiKey);
  return typeof stored[STORAGE_KEYS.encryptedApiKey] === "object";
}

export async function saveApiKey(passphrase: string, apiKey: string): Promise<void> {
  if (passphrase.length < 10) throw new Error("Vault passphrase must be at least 10 characters.");
  if (!apiKey.trim()) throw new Error("API key cannot be empty.");

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(apiKey.trim()),
  );

  const payload: EncryptedVaultPayload = {
    version: 1,
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.encryptedApiKey]: payload,
    [STORAGE_KEYS.keySalt]: bytesToBase64(salt),
  });

  unlockedApiKey = apiKey.trim();
  await chrome.storage.session.set({
    [STORAGE_KEYS.vaultSession]: { unlockedAt: new Date().toISOString() },
  });
  armAutoLock();
}

export async function unlockVault(passphrase: string): Promise<void> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.encryptedApiKey,
    STORAGE_KEYS.keySalt,
  ]);
  const payload = stored[STORAGE_KEYS.encryptedApiKey] as EncryptedVaultPayload | undefined;
  const saltValue = stored[STORAGE_KEYS.keySalt];

  if (!payload || payload.version !== 1 || typeof saltValue !== "string") {
    throw new Error("No encrypted API key is stored yet.");
  }

  try {
    const key = await deriveKey(passphrase, base64ToBytes(saltValue));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
      key,
      base64ToBytes(payload.ciphertext),
    );
    unlockedApiKey = new TextDecoder().decode(plaintext);
    await chrome.storage.session.set({
      [STORAGE_KEYS.vaultSession]: { unlockedAt: new Date().toISOString() },
    });
    armAutoLock();
  } catch {
    throw new Error("Could not unlock vault. Check your passphrase.");
  }
}

export function getUnlockedApiKey(): string | null {
  if (unlockedApiKey) armAutoLock();
  return unlockedApiKey;
}

export async function lockVault(): Promise<void> {
  unlockedApiKey = null;
  if (autoLockTimer) window.clearTimeout(autoLockTimer);
  autoLockTimer = undefined;
  await chrome.storage.session.remove(STORAGE_KEYS.vaultSession);
}

export async function deleteStoredApiKey(): Promise<void> {
  await lockVault();
  await chrome.storage.local.remove([STORAGE_KEYS.encryptedApiKey, STORAGE_KEYS.keySalt]);
}
