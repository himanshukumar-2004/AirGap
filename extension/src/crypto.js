import browser from 'webextension-polyfill';
const DB_NAME = 'sih-security';
const STORE = 'keys';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getOrCreateKey() {
  const db = await openDb();
  const existing = await new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get('mappingKey');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  if (existing) return existing;

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  db.transaction(STORE, 'readwrite').objectStore(STORE).put(key, 'mappingKey');
  return key;
}

export async function encryptMapping(key, mappingObj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(mappingObj));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  await browser.storage.local.set({ mapping: { iv: [...iv], data: [...new Uint8Array(ciphertext)] } });
}

export async function decryptMapping(key) {
  const { mapping } = await browser.storage.local.get('mapping');
  if (!mapping) return {};
  const iv = new Uint8Array(mapping.iv);
  const ciphertext = new Uint8Array(mapping.data);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}
