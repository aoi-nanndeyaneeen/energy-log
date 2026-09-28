// エクスポート／インポート／メモ取り込み。
// このファイルの解析系は純粋関数にしてあり、node --test から直接読める
// （document / navigator は関数の中でしか触らない）。

import { isDateKey, compactKey, todayKey } from './dates.js';

export const SLOTS = ['朝', '午前', '午後', '夕方', '夜'];
export const EXPORT_SCHEMA_VERSION = 1;

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// ---- JSON エクスポート -------------------------------------------------

export function buildExport({ entries, days, reviews }, now = Date.now()) {
  return {
    app: 'energy-log',
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    entries,
    days,
    reviews,
  };
}

export function exportFileName(dateKey = todayKey()) {
  return `energy-log-${compactKey(dateKey)}.json`;
}

// ---- CSV ---------------------------------------------------------------

const CSV_COLUMNS = [
  'date', 'slot', 'activity', 'tags', 'place', 'with',
  'engagement', 'energy', 'note', 'createdAt', 'updatedAt', 'id',
];

function csvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** entries を CSV にする。Excel 対策で先頭に UTF-8 BOM を付ける。 */
export function toCsv(entries) {
  const rows = [CSV_COLUMNS.join(',')];
  const sorted = [...entries].sort(compareEntries);
  for (const e of sorted) {
    rows.push(CSV_COLUMNS.map((col) => {
      if (col === 'tags') return csvCell((e.tags || []).join(' '));
      return csvCell(e[col]);
    }).join(','));
  }
  return '﻿' + rows.join('\r\n') + '\r\n';
}

/** 日付 → 時間帯 → 作成順 */
export function compareEntries(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const sa = SLOTS.indexOf(a.slot), sb = SLOTS.indexOf(b.slot);
  if (sa !== sb) return sa - sb;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

// ---- メモ取り込み ------------------------------------------------------

const ENERGY_MAP = {
  '↑': 1, '+': 1, '＋': 1, 'up': 1, '1': 1,
  '→': 0, '0': 0, '±': 0, '-> ': 0, '~': 0,
  '↓': -1, '-': -1, 'ー': -1, '−': -1, 'down': -1,
};

function parseEnergy(token) {
  const t = token.trim();
  if (t in ENERGY_MAP) return ENERGY_MAP[t];
  if (t === '->' || t === '=>' || t === '→') return 0;
  return null;
}

/**
 * 7章のメモ形式を解析する。
 * @returns {{entries: Object[], days: Object[], skipped: {line:number, text:string, reason:string}[]}}
 */
export function parseMemo(text, now = Date.now()) {
  const entries = [];
  /** @type {Map<string, Object>} */
  const days = new Map();
  const skipped = [];
  let current = null;

  const lines = String(text).split(/\r\n|\r|\n/);
  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = rawLine.trim();
    if (!line) return;

    const skip = (reason) => skipped.push({ line: lineNo, text: rawLine.trim(), reason });

    // 日付の切り替え
    if (line.startsWith('#')) {
      const key = line.replace(/^#+/, '').trim();
      if (isDateKey(key)) current = key;
      else skip('日付として読めません');
      return;
    }

    const dayOf = (dateKey) => {
      if (!days.has(dateKey)) days.set(dateKey, { date: dateKey, flat: false, updatedAt: now });
      return days.get(dateKey);
    };

    // 山 / 谷 / 平坦
    const peak = line.match(/^山\s*[:：]\s*(.*)$/);
    const dip = line.match(/^谷\s*[:：]\s*(.*)$/);
    if (peak || dip) {
      if (!current) return skip('日付の行（# YYYY-MM-DD）より前にあります');
      const value = (peak ? peak[1] : dip[1]).trim();
      if (!value) return skip('中身が空です');
      dayOf(current)[peak ? 'peak' : 'dip'] = value;
      return;
    }
    if (line === '平坦' || line === 'flat') {
      if (!current) return skip('日付の行（# YYYY-MM-DD）より前にあります');
      dayOf(current).flat = true;
      return;
    }

    // 活動の行
    const parts = line.split(/[|｜]/).map((p) => p.trim());
    if (parts.length < 4) return skip('区切り（|）が足りません');
    if (!current) return skip('日付の行（# YYYY-MM-DD）より前にあります');

    const [slot, activity, engagementText, energyText] = parts;
    if (!SLOTS.includes(slot)) return skip(`時間帯「${slot}」が朝/午前/午後/夕方/夜のどれでもありません`);
    if (!activity) return skip('活動が空です');
    const engagement = Number(engagementText);
    if (!Number.isInteger(engagement) || engagement < 1 || engagement > 5) {
      return skip(`夢中度「${engagementText}」が1〜5ではありません`);
    }
    const energy = parseEnergy(energyText);
    if (energy === null) return skip(`エネルギー「${energyText}」が ↑→↓ / +0- ではありません`);

    entries.push(normalizeEntry({
      date: current,
      slot,
      activity,
      engagement,
      energy,
      note: parts.slice(4).join('|').trim(),
    }, now));
  });

  return { entries, days: [...days.values()], skipped };
}

// ---- 正規化 / 検証 ------------------------------------------------------

/** 入力から保存できる Entry を作る（欠けているものは補う） */
export function normalizeEntry(input, now = Date.now()) {
  const entry = {
    id: typeof input.id === 'string' && input.id ? input.id : newId(),
    date: input.date,
    slot: input.slot,
    activity: String(input.activity || '').trim(),
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    engagement: Number(input.engagement),
    energy: Number(input.energy),
    note: String(input.note || '').trim(),
    createdAt: Number(input.createdAt) || now,
    updatedAt: Number(input.updatedAt) || now,
  };
  const place = String(input.place || '').trim();
  const withWho = String(input.with || '').trim();
  if (place) entry.place = place;
  if (withWho) entry.with = withWho;
  return entry;
}

export function isValidEntry(e) {
  return !!e && typeof e === 'object'
    && typeof e.id === 'string' && e.id !== ''
    && isDateKey(e.date)
    && SLOTS.includes(e.slot)
    && typeof e.activity === 'string' && e.activity.trim() !== ''
    && Number.isInteger(e.engagement) && e.engagement >= 1 && e.engagement <= 5
    && [-1, 0, 1].includes(e.energy);
}

export function isValidDay(d) {
  return !!d && typeof d === 'object' && isDateKey(d.date);
}

export function isValidReview(r) {
  return !!r && typeof r === 'object' && isDateKey(r.weekStart);
}

/**
 * インポートされた JSON を検証して、取り込める形に整える。
 * 壊れたレコードは捨て、件数を返す。
 */
export function readImport(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') throw new Error('JSON の中身がオブジェクトではありません');
  const pick = (value) => (Array.isArray(value) ? value : []);
  const rejected = { entries: 0, days: 0, reviews: 0 };

  const entries = [];
  for (const e of pick(raw.entries)) {
    const normalized = normalizeEntry(e, now);
    if (isValidEntry(normalized)) entries.push(normalized);
    else rejected.entries++;
  }
  const days = [];
  for (const d of pick(raw.days)) {
    if (!isValidDay(d)) { rejected.days++; continue; }
    days.push({
      date: d.date,
      peak: d.peak ? String(d.peak) : undefined,
      dip: d.dip ? String(d.dip) : undefined,
      flat: !!d.flat,
      updatedAt: Number(d.updatedAt) || now,
    });
  }
  const reviews = [];
  for (const r of pick(raw.reviews)) {
    if (!isValidReview(r)) { rejected.reviews++; continue; }
    reviews.push({
      weekStart: r.weekStart,
      ups: String(r.ups || ''),
      downs: String(r.downs || ''),
      hypothesis: String(r.hypothesis || ''),
      updatedAt: Number(r.updatedAt) || now,
    });
  }
  if (!entries.length && !days.length && !reviews.length && !raw.entries) {
    throw new Error('entries / days / reviews のどれも入っていません');
  }
  return { entries, days, reviews, rejected };
}

/**
 * 「統合」用。id（days は date、reviews は weekStart）が同じなら
 * updatedAt の新しいほうを残す。
 */
export function mergeRecords(existing, incoming, keyName) {
  const byKey = new Map(existing.map((r) => [r[keyName], r]));
  const result = [];
  for (const rec of incoming) {
    const old = byKey.get(rec[keyName]);
    if (!old || (Number(rec.updatedAt) || 0) >= (Number(old.updatedAt) || 0)) result.push(rec);
  }
  return result; // put するぶんだけ返す
}

// ---- ファイルの書き出し（ブラウザ専用） ---------------------------------

/** Web Share API が使えればファイル共有、だめならダウンロード */
export async function saveFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // 共有に失敗したらダウンロードに落とす
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}
