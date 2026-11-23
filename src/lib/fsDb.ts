import type { FSNode } from '../types/fs';

const DB_NAME = 'openfs_ios_android_v1';
const DB_VERSION = 1;
const STORE_NODES = 'nodes';
const STORE_BLOBS = 'blobs';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NODES)) {
        db.createObjectStore(STORE_NODES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function dbGetAllNodes(): Promise<FSNode[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NODES, 'readonly');
    const store = tx.objectStore(STORE_NODES);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as FSNode[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbPutNodes(nodes: FSNode[]): Promise<void> {
  if (nodes.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NODES, 'readwrite');
    const store = tx.objectStore(STORE_NODES);
    for (const node of nodes) {
      store.put(node);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbDeleteNodes(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NODES, STORE_BLOBS], 'readwrite');
    const nodeStore = tx.objectStore(STORE_NODES);
    const blobStore = tx.objectStore(STORE_BLOBS);
    for (const id of ids) {
      nodeStore.delete(id);
      blobStore.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbPutBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    tx.objectStore(STORE_BLOBS).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbGetBlob(id: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const req = tx.objectStore(STORE_BLOBS).get(id);
    req.onsuccess = () => resolve((req.result as Blob) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function dbClearAll(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NODES, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_NODES).clear();
    tx.objectStore(STORE_BLOBS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function resolveNodeBlob(node: FSNode): Promise<Blob | null> {
  if (node.hasBlob) {
    const stored = await dbGetBlob(node.id);
    if (stored) return stored;
  }
  if (node.assetUrl) {
    try {
      const resp = await fetch(node.assetUrl);
      if (resp.ok) return await resp.blob();
    } catch {
      return null;
    }
  }
  if (typeof node.textContent === 'string') {
    return new Blob([node.textContent], { type: node.mimeType || 'text/plain;charset=utf-8' });
  }
  return null;
}
