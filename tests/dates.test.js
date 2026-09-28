import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateKeyOf, todayKey, yesterdayKey, parseKey, addDays,
  isDateKey, diffDays, weekStartOf, formatDateLabel, compactKey,
} from '../dates.js';

test('日付キーはローカル時刻から作る（UTCにずらさない）', () => {
  // 受け入れテスト6: 午前0時〜9時に記録しても日付がずれない
  const earlyMorning = new Date(2026, 8, 29, 0, 30); // 2026-09-29 00:30 ローカル
  assert.equal(todayKey(earlyMorning), '2026-09-29');
  assert.notEqual(todayKey(earlyMorning), earlyMorning.toISOString().slice(0, 10));

  const beforeNine = new Date(2026, 8, 29, 8, 59);
  assert.equal(todayKey(beforeNine), '2026-09-29');
});

test('dateKeyOf はゼロ埋めする', () => {
  assert.equal(dateKeyOf(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(dateKeyOf(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
});

test('yesterdayKey は月をまたいでも正しい', () => {
  assert.equal(yesterdayKey(new Date(2026, 9, 1, 3, 0)), '2026-09-30');
  assert.equal(yesterdayKey(new Date(2027, 0, 1, 23, 0)), '2026-12-31');
});

test('addDays はうるう年をまたげる', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-28', 2), '2028-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('parseKey はローカル深夜0時を返す', () => {
  const d = parseKey('2026-09-29');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 29);
  assert.equal(d.getHours(), 0);
});

test('isDateKey は実在しない日付をはじく', () => {
  assert.ok(isDateKey('2026-09-29'));
  assert.ok(!isDateKey('2026-09-31'));
  assert.ok(!isDateKey('2026-13-01'));
  assert.ok(!isDateKey('2026-9-1'));
  assert.ok(!isDateKey('きのう'));
  assert.ok(!isDateKey(undefined));
});

test('diffDays は日数の差を返す', () => {
  assert.equal(diffDays('2026-09-29', '2026-09-22'), 7);
  assert.equal(diffDays('2026-09-29', '2026-09-29'), 0);
  assert.equal(diffDays('2026-09-22', '2026-09-29'), -7);
});

test('weekStartOf は月曜始まり', () => {
  assert.equal(weekStartOf('2026-09-28'), '2026-09-28'); // 月曜
  assert.equal(weekStartOf('2026-09-29'), '2026-09-28'); // 火曜
  assert.equal(weekStartOf('2026-10-04'), '2026-09-28'); // 日曜
  assert.equal(weekStartOf('2026-10-05'), '2026-10-05'); // 次の月曜
});

test('表示用の書式', () => {
  assert.equal(formatDateLabel('2026-09-29'), '9月29日(火)');
  assert.equal(compactKey('2026-09-29'), '20260929');
});
