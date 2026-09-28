import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMemo, toCsv, normalizeEntry, isValidEntry,
  readImport, mergeRecords, compareEntries, buildExport, exportFileName,
} from '../io.js';

const NOW = 1790000000000;

// ---- メモ取り込み -----------------------------------------------------

test('メモ形式の基本（計画書7章の例）', () => {
  const memo = [
    '# 2026-09-29',
    '午前|化学の自習|4|↑|反応のしくみがつながった',
    '夜|TOEICリスニング|2|↓|作業感が強い',
    '山: 化学がつながった瞬間',
    '谷: 朝の電車が混んでいた',
  ].join('\n');

  const { entries, days, skipped } = parseMemo(memo, NOW);
  assert.equal(skipped.length, 0);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    { ...entries[0], id: 'x' },
    {
      id: 'x', date: '2026-09-29', slot: '午前', activity: '化学の自習',
      tags: [], engagement: 4, energy: 1, note: '反応のしくみがつながった',
      createdAt: NOW, updatedAt: NOW,
    },
  );
  assert.equal(entries[1].energy, -1);

  assert.equal(days.length, 1);
  assert.deepEqual(days[0], {
    date: '2026-09-29', flat: false, updatedAt: NOW,
    peak: '化学がつながった瞬間', dip: '朝の電車が混んでいた',
  });
});

test('エネルギーは ↑→↓ でも +0- でも読める', () => {
  const memo = [
    '# 2026-09-29',
    '朝|散歩|3|+|',
    '午前|移動|3|0|',
    '午後|事務|3|-|',
    '夕方|読書|3|→|',
  ].join('\n');
  const { entries, skipped } = parseMemo(memo, NOW);
  assert.equal(skipped.length, 0);
  assert.deepEqual(entries.map((e) => e.energy), [1, 0, -1, 0]);
});

test('日付は # の行で切り替わる', () => {
  const memo = [
    '# 2026-09-29',
    '朝|散歩|3|↑|',
    '# 2026-09-30',
    '夜|勉強|5|↑|',
    '平坦',
  ].join('\n');
  const { entries, days } = parseMemo(memo, NOW);
  assert.deepEqual(entries.map((e) => e.date), ['2026-09-29', '2026-09-30']);
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '2026-09-30');
  assert.equal(days[0].flat, true);
});

test('ひとことに | が入っていても最後まで残す', () => {
  const { entries } = parseMemo('# 2026-09-29\n朝|散歩|3|↑|A|B', NOW);
  assert.equal(entries[0].note, 'A|B');
});

test('ひとことは省略できる', () => {
  const { entries, skipped } = parseMemo('# 2026-09-29\n朝|散歩|3|↑', NOW);
  assert.equal(skipped.length, 0);
  assert.equal(entries[0].note, '');
});

test('全角の｜と：も受け付ける', () => {
  const { entries, days, skipped } = parseMemo('# 2026-09-29\n朝｜散歩｜3｜↑｜気持ちよかった\n山：日の出', NOW);
  assert.equal(skipped.length, 0);
  assert.equal(entries[0].activity, '散歩');
  assert.equal(days[0].peak, '日の出');
});

test('解析できない行は行番号つきでスキップされる', () => {
  const memo = [
    '# 2026-09-29',     // 1
    '朝|散歩|3|↑|',      // 2 ok
    'これはただのメモ',    // 3 区切り不足
    '昼|昼食|3|↑|',      // 4 時間帯が違う
    '朝|散歩|9|↑|',      // 5 夢中度が範囲外
    '朝|散歩|3|?|',      // 6 エネルギーが不明
    '朝||3|↑|',         // 7 活動が空
    '# 2026-02-30',     // 8 実在しない日付
  ].join('\n');

  const { entries, skipped } = parseMemo(memo, NOW);
  assert.equal(entries.length, 1);
  assert.deepEqual(skipped.map((s) => s.line), [3, 4, 5, 6, 7, 8]);
  assert.match(skipped[1].reason, /時間帯/);
});

test('日付の行より前にある行はスキップする', () => {
  const { entries, days, skipped } = parseMemo('朝|散歩|3|↑|\n山: なにか', NOW);
  assert.equal(entries.length, 0);
  assert.equal(days.length, 0);
  assert.equal(skipped.length, 2);
});

test('空行は無視され、スキップにも数えない', () => {
  const { skipped } = parseMemo('# 2026-09-29\n\n  \n朝|散歩|3|↑|\n', NOW);
  assert.equal(skipped.length, 0);
});

// ---- 正規化・検証 -----------------------------------------------------

test('normalizeEntry は空白を取り除き、任意の項目は空なら入れない', () => {
  const e = normalizeEntry({
    date: '2026-09-29', slot: '朝', activity: '  化学の自習 ',
    engagement: '4', energy: '1', note: '  ', place: '  ', with: '', tags: [' 勉強 ', ''],
  }, NOW);
  assert.equal(e.activity, '化学の自習');
  assert.equal(e.note, '');
  assert.deepEqual(e.tags, ['勉強']);
  assert.ok(!('place' in e));
  assert.ok(!('with' in e));
  assert.equal(e.engagement, 4);
  assert.equal(e.energy, 1);
  assert.ok(e.id);
});

test('isValidEntry は壊れたレコードをはじく', () => {
  const base = normalizeEntry({ date: '2026-09-29', slot: '朝', activity: '散歩', engagement: 3, energy: 0 }, NOW);
  assert.ok(isValidEntry(base));
  assert.ok(!isValidEntry({ ...base, engagement: 6 }));
  assert.ok(!isValidEntry({ ...base, energy: 2 }));
  assert.ok(!isValidEntry({ ...base, slot: '昼' }));
  assert.ok(!isValidEntry({ ...base, date: '2026-9-29' }));
  assert.ok(!isValidEntry({ ...base, activity: '  ' }));
});

// ---- CSV --------------------------------------------------------------

test('CSV は BOM 付きで、引用符とカンマを正しく逃がす', () => {
  const entries = [normalizeEntry({
    date: '2026-09-29', slot: '朝', activity: '散歩, 朝の',
    engagement: 3, energy: 1, note: '彼は "よい" と言った', tags: ['運動', '朝'],
  }, NOW)];
  const csv = toCsv(entries);
  assert.ok(csv.startsWith('﻿'));
  const [header, row] = csv.replace('﻿', '').trim().split('\r\n');
  assert.equal(header.split(',')[0], 'date');
  assert.ok(row.includes('"散歩, 朝の"'));
  assert.ok(row.includes('"彼は ""よい"" と言った"'));
  assert.ok(row.includes('運動 朝'));
});

test('CSV は日付・時間帯の順に並ぶ', () => {
  const mk = (date, slot, createdAt) =>
    normalizeEntry({ date, slot, activity: 'x', engagement: 3, energy: 0, createdAt }, NOW);
  const rows = toCsv([mk('2026-09-30', '朝', 3), mk('2026-09-29', '夜', 2), mk('2026-09-29', '朝', 1)])
    .replace('﻿', '').trim().split('\r\n').slice(1);
  assert.deepEqual(rows.map((r) => r.split(',').slice(0, 2).join(' ')), [
    '2026-09-29 朝', '2026-09-29 夜', '2026-09-30 朝',
  ]);
});

test('compareEntries は同じ時間帯なら作成順', () => {
  const mk = (createdAt) =>
    normalizeEntry({ date: '2026-09-29', slot: '朝', activity: 'x', engagement: 3, energy: 0, createdAt }, NOW);
  assert.ok(compareEntries(mk(1), mk(2)) < 0);
});

// ---- エクスポート / インポート ----------------------------------------

test('エクスポートしたものをそのまま読み戻せる（受け入れテスト3）', () => {
  const entries = [
    normalizeEntry({ date: '2026-09-29', slot: '朝', activity: '散歩', engagement: 3, energy: 1 }, NOW),
    normalizeEntry({ date: '2026-09-29', slot: '夜', activity: '化学', engagement: 5, energy: 1, place: '図書館' }, NOW),
  ];
  const days = [{ date: '2026-09-29', peak: '日の出', flat: false, updatedAt: NOW }];
  const reviews = [{ weekStart: '2026-09-28', ups: 'a', downs: 'b', hypothesis: 'c', updatedAt: NOW }];

  const dump = JSON.parse(JSON.stringify(buildExport({ entries, days, reviews }, NOW)));
  const back = readImport(dump, NOW);

  assert.deepEqual(back.entries, entries);
  assert.equal(back.days[0].peak, '日の出');
  assert.equal(back.days[0].dip, undefined);
  assert.deepEqual(back.reviews, reviews);
  assert.deepEqual(back.rejected, { entries: 0, days: 0, reviews: 0 });
});

test('readImport は壊れたレコードを数えて捨てる', () => {
  const good = normalizeEntry({ date: '2026-09-29', slot: '朝', activity: '散歩', engagement: 3, energy: 1 }, NOW);
  const result = readImport({
    entries: [good, { date: 'ごみ' }, { date: '2026-09-29', slot: '朝', activity: '', engagement: 3, energy: 0 }],
    days: [{ date: '2026-09-29' }, { date: 'x' }],
    reviews: [{ weekStart: 'x' }],
  }, NOW);
  assert.equal(result.entries.length, 1);
  assert.equal(result.rejected.entries, 2);
  assert.equal(result.days.length, 1);
  assert.equal(result.rejected.days, 1);
  assert.equal(result.rejected.reviews, 1);
});

test('readImport はオブジェクトでないものを断る', () => {
  assert.throws(() => readImport(null), /オブジェクト/);
  assert.throws(() => readImport({ foo: 1 }), /entries/);
});

test('統合では updatedAt の新しいほうを残す', () => {
  const existing = [
    { id: 'a', updatedAt: 200 },
    { id: 'b', updatedAt: 100 },
  ];
  const incoming = [
    { id: 'a', updatedAt: 100 }, // 古い → 捨てる
    { id: 'b', updatedAt: 300 }, // 新しい → 上書き
    { id: 'c', updatedAt: 50 },  // 新規 → 追加
  ];
  assert.deepEqual(mergeRecords(existing, incoming, 'id').map((r) => r.id), ['b', 'c']);
});

test('エクスポートのファイル名', () => {
  assert.equal(exportFileName('2026-09-29'), 'energy-log-20260929.json');
});
