/** Tiny promise wrapper around IndexedDB (no dependencies). */
export interface KeyValueDb {
  get<T>(store: string, key: string): Promise<T | undefined>;
  put(store: string, key: string, value: unknown): Promise<void>;
  delete(store: string, key: string): Promise<void>;
  keys(store: string): Promise<string[]>;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export function openKeyValueDb(name: string, stores: string[], version = 1): Promise<KeyValueDb> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      for (const s of stores)
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'));
    req.onsuccess = () => {
      const db = req.result;
      const tx = (store: string, mode: IDBTransactionMode) =>
        db.transaction(store, mode).objectStore(store);
      resolve({
        get: <T>(store: string, key: string) =>
          promisify(tx(store, 'readonly').get(key)) as Promise<T | undefined>,
        put: async (store, key, value) => {
          await promisify(tx(store, 'readwrite').put(value, key));
        },
        delete: async (store, key) => {
          await promisify(tx(store, 'readwrite').delete(key));
        },
        keys: async (store) => (await promisify(tx(store, 'readonly').getAllKeys())).map(String),
      });
    };
  });
}
