// ローカル日付ユーティリティ。
// toISOString() は UTC なので使わない。日付キーは必ずローカル時刻から作る。

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const pad2 = (n) => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD'（ローカル） */
export function dateKeyOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 今日のキー */
export function todayKey(now = new Date()) {
  return dateKeyOf(now);
}

/** 昨日のキー */
export function yesterdayKey(now = new Date()) {
  return addDays(dateKeyOf(now), -1);
}

/** 'YYYY-MM-DD' → ローカル深夜0時の Date */
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 日付キーに n 日足す */
export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKeyOf(d);
}

/** 'YYYY-MM-DD' の形をしていて、実在する日付か */
export function isDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dateKeyOf(parseKey(value)) === value;
}

/** 2つの日付キーの差（日数, a - b） */
export function diffDays(a, b) {
  return Math.round((parseKey(a) - parseKey(b)) / 86400000);
}

/** その週の月曜日のキー */
export function weekStartOf(key) {
  const d = parseKey(key);
  const shift = (d.getDay() + 6) % 7; // 月曜を0にする
  d.setDate(d.getDate() - shift);
  return dateKeyOf(d);
}

/** '9月29日(月)' */
export function formatDateLabel(key) {
  const d = parseKey(key);
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;
}

/** 今日/昨日なら相対表記、それ以外は日付 */
export function formatRelativeLabel(key, now = new Date()) {
  const t = dateKeyOf(now);
  if (key === t) return `今日 ${formatDateLabel(key)}`;
  if (key === addDays(t, -1)) return `昨日 ${formatDateLabel(key)}`;
  return formatDateLabel(key);
}

/** エクスポートのファイル名用 'YYYYMMDD' */
export function compactKey(key) {
  return key.replace(/-/g, '');
}
