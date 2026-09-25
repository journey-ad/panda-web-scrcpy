/**
 * 缩略图的本地存储：生成结果按设备路径存进 IndexedDB
 * 关掉页面再进来时先从这里获取，无需重新读取设备与解码
 */

const DB_NAME = 'panda-file-manager';
const STORE = 'thumbs';
const DB_VERSION = 1;
/** 索引名，按写入时间淘汰时用 */
const AT_INDEX = 'at';
/** 条目数上限，超出后按写入时间淘汰 */
const MAX_ENTRIES = 300;
/** 一次批量生成会连着写很多条，淘汰合并到一次 */
const TRIM_DELAY = 1000;

export interface StoredThumb {
  /** 设备路径，即主键 */
  path: string;
  /** 生成时的文件标识，文件改动后缓存条目作废 */
  key: string;
  blob: Blob;
  label: string;
  /** 写入时间 */
  at: number;
}

let opening: Promise<IDBDatabase | null> | null = null;

const open = () => {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'path' });
      store.createIndex(AT_INDEX, AT_INDEX);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
};

const asPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T | null>((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

/** 事务在中途可能被中止，无法取得结果时一律返回 null */
const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> => {
  const db = await open();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE, mode);
    return await asPromise(run(tx.objectStore(STORE)));
  } catch {
    return null;
  }
};

/** 超出上限后按写入时间移除最早的一批 */
const trim = async () => {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const total = Number((await asPromise(store.count())) ?? 0);
    let over = total - MAX_ENTRIES;
    if (over <= 0) return;
    const cursor = store.index(AT_INDEX).openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current || over <= 0) return;
      current.delete();
      over -= 1;
      current.continue();
    };
  } catch {
    /* 存储不可用时忽略 */
  }
};

let trimTimer = 0;

const scheduleTrim = () => {
  if (trimTimer) return;
  trimTimer = setTimeout(() => {
    trimTimer = 0;
    void trim();
  }, TRIM_DELAY);
};

export const readThumb = (path: string): Promise<StoredThumb | null | undefined> =>
  withStore<StoredThumb | undefined>('readonly', (store) => store.get(path));

export const dropThumb = (path: string) => withStore('readwrite', (store) => store.delete(path));

export const writeThumb = async (path: string, key: string, blob: Blob, label: string) => {
  await withStore('readwrite', (store) => store.put({ path, key, blob, label, at: Date.now() }));
  scheduleTrim();
};
