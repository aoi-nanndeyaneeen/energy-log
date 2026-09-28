// IndexedDB の薄いラッパー。
// スキーマを変えるときは DB_VERSION を上げ、onupgradeneeded の oldVersion で分岐する。

const DB_NAME = 'energy-log';
const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 1) {
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('date', 'date');
        entries.createIndex('activity', 'activity');
        db.createObjectStore('days', { keyPath: 'date' });
        db.createObjectStore('reviews', { keyPath: 'weekStart' });
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      // 次のバージョンからはここに移行処理を足す:
      // if (event.oldVersion < 2) { ... }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('ほかのタブでアプリが開いています。閉じてから再読み込みしてください。'));
  });
  return dbPromise;
}

function ask(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** ストアを渡してコールバックを実行し、トランザクション完了まで待つ */
async function run(storeNames, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('トランザクションが中断されました'));
    Promise.resolve(fn(tx)).then((value) => { result = value; }).catch((err) => {
      try { tx.abort(); } catch { /* 既に終了している */ }
      reject(err);
    });
  });
}

// ---- entries ----------------------------------------------------------

export function putEntry(entry) {
  return run('entries', 'readwrite', (tx) => ask(tx.objectStore('entries').put(entry)));
}

export function getEntry(id) {
  return run('entries', 'readonly', (tx) => ask(tx.objectStore('entries').get(id)));
}

export function deleteEntry(id) {
  return run('entries', 'readwrite', (tx) => ask(tx.objectStore('entries').delete(id)));
}

export function entriesByDate(dateKey) {
  return run('entries', 'readonly', (tx) =>
    ask(tx.objectStore('entries').index('date').getAll(dateKey)));
}

export function entriesBetween(fromKey, toKey) {
  return run('entries', 'readonly', (tx) =>
    ask(tx.objectStore('entries').index('date').getAll(IDBKeyRange.bound(fromKey, toKey))));
}

export function allEntries() {
  return run('entries', 'readonly', (tx) => ask(tx.objectStore('entries').getAll()));
}

export function countEntries() {
  return run('entries', 'readonly', (tx) => ask(tx.objectStore('entries').count()));
}

// ---- days / reviews ---------------------------------------------------

export function getDay(dateKey) {
  return run('days', 'readonly', (tx) => ask(tx.objectStore('days').get(dateKey)));
}

export function putDay(day) {
  return run('days', 'readwrite', (tx) => ask(tx.objectStore('days').put(day)));
}

export function deleteDay(dateKey) {
  return run('days', 'readwrite', (tx) => ask(tx.objectStore('days').delete(dateKey)));
}

export function allDays() {
  return run('days', 'readonly', (tx) => ask(tx.objectStore('days').getAll()));
}

export function allReviews() {
  return run('reviews', 'readonly', (tx) => ask(tx.objectStore('reviews').getAll()));
}

export function putReview(review) {
  return run('reviews', 'readwrite', (tx) => ask(tx.objectStore('reviews').put(review)));
}

// ---- meta -------------------------------------------------------------

export async function getMeta(key, fallback = null) {
  const row = await run('meta', 'readonly', (tx) => ask(tx.objectStore('meta').get(key)));
  return row === undefined ? fallback : row.value;
}

export function setMeta(key, value) {
  return run('meta', 'readwrite', (tx) => ask(tx.objectStore('meta').put({ key, value })));
}

export function allMeta() {
  return run('meta', 'readonly', (tx) => ask(tx.objectStore('meta').getAll()));
}

// ---- まとめ書き -------------------------------------------------------

/** 1つのトランザクションでまとめて put する */
export function bulkPut({ entries = [], days = [], reviews = [] }) {
  const names = [];
  if (entries.length) names.push('entries');
  if (days.length) names.push('days');
  if (reviews.length) names.push('reviews');
  if (!names.length) return Promise.resolve(0);
  return run(names, 'readwrite', (tx) => {
    for (const e of entries) tx.objectStore('entries').put(e);
    for (const d of days) tx.objectStore('days').put(d);
    for (const r of reviews) tx.objectStore('reviews').put(r);
    return entries.length + days.length + reviews.length;
  });
}

/** entries / days / reviews を空にしてから入れ直す（meta は残す） */
export function replaceAll({ entries = [], days = [], reviews = [] }) {
  return run(['entries', 'days', 'reviews'], 'readwrite', (tx) => {
    tx.objectStore('entries').clear();
    tx.objectStore('days').clear();
    tx.objectStore('reviews').clear();
    for (const e of entries) tx.objectStore('entries').put(e);
    for (const d of days) tx.objectStore('days').put(d);
    for (const r of reviews) tx.objectStore('reviews').put(r);
    return entries.length + days.length + reviews.length;
  });
}

/** meta も含めてすべて消す */
export function clearAll() {
  return run(['entries', 'days', 'reviews', 'meta'], 'readwrite', (tx) => {
    for (const name of ['entries', 'days', 'reviews', 'meta']) tx.objectStore(name).clear();
  });
}
