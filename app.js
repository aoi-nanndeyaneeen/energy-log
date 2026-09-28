// 画面切り替え・フォーム・描画。
// CSP のため、インラインスクリプトもインラインのイベントハンドラも使わない。

import { todayKey, yesterdayKey, diffDays, isDateKey, formatRelativeLabel } from './dates.js';
import * as db from './db.js';
import * as io from './io.js';

const APP_VERSION = 'M2 (2026-09-28)';
const SLOTS = io.SLOTS;
const HISTORY_PAGE = 14;
const BACKUP_REMIND_DAYS = 7;

const $ = (id) => document.getElementById(id);

const state = {
  tab: 'record',
  mode: 'entry',        // 'entry' | 'day'
  dateKey: todayKey(),
  slot: SLOTS[0],
  engagement: null,
  energy: null,
  editingId: null,
  historyDays: HISTORY_PAGE,
};

// =====================================================================
// 小さな道具
// =====================================================================

let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 1800);
}

function showError(message) {
  const el = $('entry-error');
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** data-value を持つボタン群を作り、選択状態を管理する */
function buildChipGroup(container, values, { className = 'chip', onSelect }) {
  container.replaceChildren();
  for (const { value, label } of values) {
    const button = el('button', className, label);
    button.type = 'button';
    button.dataset.value = String(value);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => onSelect(value));
    container.appendChild(button);
  }
}

function markChipGroup(container, value) {
  for (const button of container.children) {
    const on = button.dataset.value === String(value);
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

const ENERGY_LABEL = { '-1': '↓', '0': '→', '1': '↑' };
const ENERGY_CLASS = { '-1': 'down', '0': 'flat', '1': 'up' };

function slotIndex(slot) {
  const i = SLOTS.indexOf(slot);
  return i < 0 ? 0 : i;
}

// =====================================================================
// タブ
// =====================================================================

const PANELS = {
  record: 'panel-record',
  history: 'panel-history',
  review: 'panel-review',
  settings: 'panel-settings',
};

function setTab(name) {
  state.tab = name;
  for (const [key, panelId] of Object.entries(PANELS)) {
    $(panelId).classList.toggle('hidden', key !== name);
  }
  for (const button of $('tabbar').children) {
    const on = button.dataset.tab === name;
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  window.scrollTo(0, 0);
  if (name === 'history') renderHistory();
  if (name === 'review') renderReviewPlaceholder();
  if (name === 'settings') renderSettings();
}

// =====================================================================
// 記録タブ
// =====================================================================

function setMode(mode) {
  state.mode = mode;
  $('mode-entry').classList.toggle('is-on', mode === 'entry');
  $('mode-day').classList.toggle('is-on', mode === 'day');
  $('mode-entry').setAttribute('aria-pressed', mode === 'entry' ? 'true' : 'false');
  $('mode-day').setAttribute('aria-pressed', mode === 'day' ? 'true' : 'false');
  $('entry-form').classList.toggle('hidden', mode !== 'entry');
  $('day-form').classList.toggle('hidden', mode !== 'day');
  if (mode === 'day') loadDayForm();
}

async function setDate(dateKey) {
  if (!isDateKey(dateKey)) return;
  state.dateKey = dateKey;
  $('date-input').value = dateKey;
  for (const button of $('date-quick').children) {
    const target = button.dataset.quick === 'today' ? todayKey() : yesterdayKey();
    const on = target === dateKey;
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  $('today-title').textContent = `${formatRelativeLabel(dateKey)} の記録`;
  if (state.mode === 'day') await loadDayForm();
  await renderTodayList();
}

function setSlot(slot) {
  state.slot = slot;
  markChipGroup($('slot-chips'), slot);
}

function setEngagement(value) {
  state.engagement = value;
  markChipGroup($('engagement-chips'), value);
}

function setEnergy(value) {
  state.energy = value;
  markChipGroup($('energy-chips'), value);
}

function clearEntryForm({ keepSlot = true } = {}) {
  state.editingId = null;
  $('activity-input').value = '';
  $('note-input').value = '';
  $('place-input').value = '';
  $('with-input').value = '';
  $('tags-input').value = '';
  $('entry-details').open = false;
  setEngagement(null);
  setEnergy(null);
  if (!keepSlot) setSlot(SLOTS[0]);
  showError('');
  $('entry-save').textContent = '保存';
  $('entry-cancel').classList.add('hidden');
  $('entry-delete').classList.add('hidden');
}

function loadEntryIntoForm(entry) {
  state.editingId = entry.id;
  $('activity-input').value = entry.activity;
  $('note-input').value = entry.note || '';
  $('place-input').value = entry.place || '';
  $('with-input').value = entry.with || '';
  $('tags-input').value = (entry.tags || []).join(' ');
  if (entry.place || entry.with || (entry.tags || []).length) $('entry-details').open = true;
  setSlot(entry.slot);
  setEngagement(entry.engagement);
  setEnergy(entry.energy);
  showError('');
  $('entry-save').textContent = '更新';
  $('entry-cancel').classList.remove('hidden');
  $('entry-delete').classList.remove('hidden');
}

function parseTags(text) {
  return text.split(/[\s,、，]+/).map((t) => t.trim()).filter(Boolean);
}

async function submitEntry(event) {
  event.preventDefault();
  const activity = $('activity-input').value.trim();
  if (!activity) return showError('活動を入れてください。');
  if (state.engagement === null) return showError('夢中度を選んでください。');
  if (state.energy === null) return showError('エネルギーを選んでください。');
  showError('');

  const now = Date.now();
  const existing = state.editingId ? await db.getEntry(state.editingId) : null;
  const entry = io.normalizeEntry({
    id: existing ? existing.id : undefined,
    date: state.dateKey,
    slot: state.slot,
    activity,
    tags: parseTags($('tags-input').value),
    place: $('place-input').value,
    with: $('with-input').value,
    engagement: state.engagement,
    energy: state.energy,
    note: $('note-input').value,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  }, now);

  await db.putEntry(entry);

  // 保存するたびに次の時間帯へ進める（最後は「夜」で止める）
  const nextSlot = SLOTS[Math.min(slotIndex(state.slot) + 1, SLOTS.length - 1)];
  const wasEditing = !!existing;
  clearEntryForm();
  if (!wasEditing) setSlot(nextSlot);
  await db.setMeta('lastSlot', state.slot);

  await renderTodayList();
  $('activity-input').focus();
  toast(wasEditing ? '更新しました' : '保存しました');
}

async function removeEntry() {
  if (!state.editingId) return;
  if (!confirm('この記録を削除します。よろしいですか？')) return;
  await db.deleteEntry(state.editingId);
  clearEntryForm();
  await renderTodayList();
  toast('削除しました');
}

async function loadDayForm() {
  const day = await db.getDay(state.dateKey);
  $('peak-input').value = day && day.peak ? day.peak : '';
  $('dip-input').value = day && day.dip ? day.dip : '';
  $('flat-input').checked = !!(day && day.flat);
}

async function submitDay(event) {
  event.preventDefault();
  const peak = $('peak-input').value.trim();
  const dip = $('dip-input').value.trim();
  const flat = $('flat-input').checked;
  if (!peak && !dip && !flat) {
    await db.deleteDay(state.dateKey);
    await renderTodayList();
    return toast('山と谷を空にしました');
  }
  await db.putDay({
    date: state.dateKey,
    peak: peak || undefined,
    dip: dip || undefined,
    flat,
    updatedAt: Date.now(),
  });
  await renderTodayList();
  toast('保存しました');
}

// =====================================================================
// 記録の描画
// =====================================================================

function entryButton(entry, onClick) {
  const button = el('button', 'entry');
  button.type = 'button';
  if (entry.id === state.editingId) button.classList.add('is-editing');

  button.appendChild(el('span', 'entry-slot', entry.slot));

  const main = el('div', 'entry-main');
  main.appendChild(el('div', 'entry-name', entry.activity));
  if (entry.note) main.appendChild(el('div', 'entry-note', entry.note));
  const meta = [];
  if (entry.place) meta.push(`@${entry.place}`);
  if (entry.with) meta.push(`with ${entry.with}`);
  if (entry.tags && entry.tags.length) meta.push(entry.tags.map((t) => `#${t}`).join(' '));
  if (meta.length) main.appendChild(el('div', 'entry-meta', meta.join('  ')));
  button.appendChild(main);

  const marks = el('div', 'entry-marks');
  marks.appendChild(el('div', 'entry-eng', '●'.repeat(entry.engagement) + '○'.repeat(5 - entry.engagement)));
  const energy = el('div', `entry-energy ${ENERGY_CLASS[String(entry.energy)]}`, ENERGY_LABEL[String(entry.energy)]);
  marks.appendChild(energy);
  button.appendChild(marks);

  button.addEventListener('click', () => onClick(entry));
  return button;
}

function dayNotes(day) {
  const nodes = [];
  if (day && day.peak) {
    const p = el('div', 'day-peak');
    p.appendChild(el('span', 'mark', '山 '));
    p.appendChild(document.createTextNode(day.peak));
    nodes.push(p);
  }
  if (day && day.dip) {
    const p = el('div', 'day-peak');
    p.appendChild(el('span', 'mark dip', '谷 '));
    p.appendChild(document.createTextNode(day.dip));
    nodes.push(p);
  }
  if (day && day.flat) nodes.push(el('div', 'day-peak mini', '平坦な一日'));
  return nodes;
}

async function renderTodayList() {
  const [entries, day] = await Promise.all([
    db.entriesByDate(state.dateKey),
    db.getDay(state.dateKey),
  ]);
  entries.sort(io.compareEntries);

  const list = $('today-list');
  list.replaceChildren();

  const notes = dayNotes(day);
  if (notes.length) {
    const card = el('div', 'day-card');
    for (const node of notes) card.appendChild(node);
    list.appendChild(card);
  }

  if (!entries.length) {
    list.appendChild(el('p', 'empty', 'まだこの日の記録はありません。'));
    return;
  }
  const card = el('div', 'day-card');
  for (const entry of entries) {
    card.appendChild(entryButton(entry, (e) => {
      setMode('entry');
      loadEntryIntoForm(e);
      renderTodayList();
      window.scrollTo(0, 0);
    }));
  }
  list.appendChild(card);
}

// =====================================================================
// 履歴タブ
// =====================================================================

async function renderHistory() {
  const [entries, days] = await Promise.all([db.allEntries(), db.allDays()]);
  const dayByDate = new Map(days.map((d) => [d.date, d]));

  const byDate = new Map();
  for (const entry of entries) {
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date).push(entry);
  }
  for (const d of days) if (!byDate.has(d.date)) byDate.set(d.date, []);

  const dateKeys = [...byDate.keys()].sort().reverse();
  const shown = dateKeys.slice(0, state.historyDays);

  const list = $('history-list');
  list.replaceChildren();

  if (!shown.length) {
    list.appendChild(el('p', 'empty', 'まだ記録がありません。「記録」タブから書き始めてください。'));
    $('history-more').classList.add('hidden');
    return;
  }

  for (const dateKey of shown) {
    const card = el('div', 'day-card');
    const head = el('div', 'day-head');
    head.appendChild(el('span', null, formatRelativeLabel(dateKey)));
    const count = byDate.get(dateKey).length;
    head.appendChild(el('span', null, count ? `${count}件` : '山と谷のみ'));
    card.appendChild(head);

    for (const node of dayNotes(dayByDate.get(dateKey))) card.appendChild(node);

    const dayEntries = byDate.get(dateKey).sort(io.compareEntries);
    for (const entry of dayEntries) {
      card.appendChild(entryButton(entry, async (e) => {
        setTab('record');
        setMode('entry');
        await setDate(e.date);
        loadEntryIntoForm(e);
        await renderTodayList();
      }));
    }
    list.appendChild(card);
  }

  $('history-more').classList.toggle('hidden', dateKeys.length <= shown.length);
}

// =====================================================================
// 振り返りタブ（M3で作る）
// =====================================================================

async function renderReviewPlaceholder() {
  $('review-count').textContent = String(await db.countEntries());
}

// =====================================================================
// 設定タブ
// =====================================================================

async function collectAll() {
  const [entries, days, reviews] = await Promise.all([
    db.allEntries(), db.allDays(), db.allReviews(),
  ]);
  return { entries, days, reviews };
}

async function exportJson() {
  const data = await collectAll();
  if (!data.entries.length && !data.days.length) return toast('書き出すデータがありません');
  const blob = new Blob([JSON.stringify(io.buildExport(data), null, 2)], { type: 'application/json' });
  const result = await io.saveFile(blob, io.exportFileName());
  if (result === 'cancelled') return;
  await db.setMeta('lastBackupAt', Date.now());
  await renderSettings();
  await renderBackupBanner();
  toast('エクスポートしました');
}

async function exportCsv() {
  const entries = await db.allEntries();
  if (!entries.length) return toast('書き出すデータがありません');
  const blob = new Blob([io.toCsv(entries)], { type: 'text/csv' });
  const result = await io.saveFile(blob, io.exportFileName().replace(/\.json$/, '.csv'));
  if (result !== 'cancelled') toast('CSVを書き出しました');
}

async function importJsonFile(file) {
  const mode = document.querySelector('input[name="import-mode"]:checked').value;
  const report = $('import-json-result');
  try {
    const parsed = io.readImport(JSON.parse(await file.text()));
    const label = `活動${parsed.entries.length}件 / 山と谷${parsed.days.length}件 / 振り返り${parsed.reviews.length}件`;

    if (mode === 'replace') {
      if (!confirm(`いまのデータをすべて消して、${label} に置き換えます。よろしいですか？`)) return;
      await db.replaceAll(parsed);
    } else {
      if (!confirm(`${label} を統合します。よろしいですか？`)) return;
      const current = await collectAll();
      await db.bulkPut({
        entries: io.mergeRecords(current.entries, parsed.entries, 'id'),
        days: io.mergeRecords(current.days, parsed.days, 'date'),
        reviews: io.mergeRecords(current.reviews, parsed.reviews, 'weekStart'),
      });
    }

    const skippedTotal = parsed.rejected.entries + parsed.rejected.days + parsed.rejected.reviews;
    report.textContent = `取り込みました（${mode === 'replace' ? '置き換え' : '統合'}）: ${label}`
      + (skippedTotal ? `\n読めなかったデータ ${skippedTotal} 件は飛ばしました。` : '');
    await refreshAfterBulkChange();
    toast('インポートしました');
  } catch (err) {
    report.textContent = `読み込めませんでした: ${err.message}`;
  }
}

function memoReport(parsed) {
  const lines = [
    `活動 ${parsed.entries.length} 件、山と谷 ${parsed.days.length} 日ぶん。`,
  ];
  if (parsed.skipped.length) {
    lines.push(`${parsed.skipped.length} 行スキップ:`);
    for (const s of parsed.skipped.slice(0, 20)) {
      lines.push(`  ${s.line}行目: ${s.text}  — ${s.reason}`);
    }
    if (parsed.skipped.length > 20) lines.push(`  ...ほか ${parsed.skipped.length - 20} 行`);
  }
  return lines.join('\n');
}

function previewMemo() {
  const text = $('memo-input').value;
  if (!text.trim()) return toast('貼り付けてから押してください');
  $('memo-result').textContent = memoReport(io.parseMemo(text));
}

async function importMemo() {
  const text = $('memo-input').value;
  if (!text.trim()) return toast('貼り付けてから押してください');
  const parsed = io.parseMemo(text);
  if (!parsed.entries.length && !parsed.days.length) {
    $('memo-result').textContent = memoReport(parsed);
    return toast('取り込めた行がありません');
  }
  if (!confirm(`活動 ${parsed.entries.length} 件、山と谷 ${parsed.days.length} 日ぶんを取り込みます。よろしいですか？`)) return;

  // 山と谷は既存を消さないように、あれば足す形でまとめる
  const merged = [];
  for (const day of parsed.days) {
    const old = await db.getDay(day.date);
    merged.push(old ? { ...old, ...day, flat: day.flat || old.flat, updatedAt: Date.now() } : day);
  }
  await db.bulkPut({ entries: parsed.entries, days: merged });

  $('memo-result').textContent = memoReport(parsed);
  $('memo-input').value = '';
  await refreshAfterBulkChange();
  toast('取り込みました');
}

async function renderSettings() {
  const lastBackupAt = await db.getMeta('lastBackupAt', null);
  $('backup-status').textContent = lastBackupAt
    ? `最終バックアップ: ${new Date(lastBackupAt).toLocaleString('ja-JP')}`
    : '最終バックアップ: まだありません';
  $('version-line').textContent = `バージョン: ${APP_VERSION} / スキーマ: v${db.SCHEMA_VERSION}`;

  if (navigator.storage && navigator.storage.persisted) {
    const persisted = await navigator.storage.persisted();
    $('persist-status').textContent = persisted
      ? '永続化: 有効（ブラウザが勝手に消しません）'
      : '永続化: 無効（容量が足りないと消される可能性があります）';
    $('persist-request').disabled = persisted;
  } else {
    $('persist-status').textContent = '永続化: このブラウザでは確認できません';
    $('persist-request').disabled = true;
  }

  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      const mb = (n) => (n / 1048576).toFixed(1);
      $('estimate-status').textContent = `使用容量: ${mb(usage)} MB / ${mb(quota)} MB`;
    } catch {
      $('estimate-status').textContent = '使用容量: 取得できませんでした';
    }
  } else {
    $('estimate-status').textContent = '使用容量: このブラウザでは確認できません';
  }
}

async function requestPersist() {
  if (!navigator.storage || !navigator.storage.persist) return;
  const granted = await navigator.storage.persist();
  toast(granted ? '永続化されました' : 'ブラウザが許可しませんでした');
  await renderSettings();
}

async function wipeAll() {
  if (!confirm('すべての記録を消します。取り消せません。よろしいですか？')) return;
  if (!confirm('本当に消してよいですか？ 先にエクスポートは済んでいますか？')) return;
  await db.clearAll();
  state.historyDays = HISTORY_PAGE;
  clearEntryForm();
  await refreshAfterBulkChange();
  toast('すべて削除しました');
}

async function refreshAfterBulkChange() {
  await renderTodayList();
  await renderHistory();
  await renderReviewPlaceholder();
  await renderSettings();
  await renderBackupBanner();
}

// =====================================================================
// バックアップの催促
// =====================================================================

async function renderBackupBanner() {
  const banner = $('backup-banner');
  const count = await db.countEntries();
  if (!count) return banner.classList.add('hidden');

  const lastBackupAt = await db.getMeta('lastBackupAt', null);
  if (!lastBackupAt) {
    $('backup-banner-text').textContent = 'まだバックアップしていません。JSONを書き出しましょう。';
    return banner.classList.remove('hidden');
  }
  const days = diffDays(todayKey(), todayKey(new Date(lastBackupAt)));
  if (days >= BACKUP_REMIND_DAYS) {
    $('backup-banner-text').textContent = `最後のバックアップから${days}日たちました。書き出しましょう。`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

// =====================================================================
// Service Worker
// =====================================================================

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return; // file:// では登録できない
  const register = () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service Worker を登録できませんでした:', err);
    });
  };
  // init() は非同期なので、ここに来た時点で load はもう終わっていることが多い
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

// =====================================================================
// 起動
// =====================================================================

function bindEvents() {
  for (const button of $('tabbar').children) {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  }

  $('mode-entry').addEventListener('click', () => setMode('entry'));
  $('mode-day').addEventListener('click', () => setMode('day'));

  for (const button of $('date-quick').children) {
    button.addEventListener('click', () => {
      setDate(button.dataset.quick === 'today' ? todayKey() : yesterdayKey());
    });
  }
  $('date-input').addEventListener('change', (event) => {
    if (isDateKey(event.target.value)) setDate(event.target.value);
    else setDate(state.dateKey);
  });

  $('entry-form').addEventListener('submit', submitEntry);
  $('entry-cancel').addEventListener('click', async () => {
    clearEntryForm();
    await renderTodayList();
  });
  $('entry-delete').addEventListener('click', removeEntry);
  $('day-form').addEventListener('submit', submitDay);

  $('history-more').addEventListener('click', () => {
    state.historyDays += HISTORY_PAGE;
    renderHistory();
  });

  $('backup-banner-go').addEventListener('click', () => setTab('settings'));

  $('export-json').addEventListener('click', exportJson);
  $('export-csv').addEventListener('click', exportCsv);
  $('import-json-btn').addEventListener('click', () => $('import-json-file').click());
  $('import-json-file').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (file) await importJsonFile(file);
  });
  $('memo-preview').addEventListener('click', previewMemo);
  $('memo-import').addEventListener('click', importMemo);
  $('persist-request').addEventListener('click', requestPersist);
  $('wipe-all').addEventListener('click', wipeAll);
}

async function init() {
  buildChipGroup($('slot-chips'), SLOTS.map((s) => ({ value: s, label: s })), { onSelect: setSlot });
  buildChipGroup(
    $('engagement-chips'),
    [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })),
    { className: 'chip big', onSelect: setEngagement },
  );
  buildChipGroup(
    $('energy-chips'),
    [{ value: -1, label: '↓' }, { value: 0, label: '→' }, { value: 1, label: '↑' }],
    { className: 'chip big', onSelect: setEnergy },
  );

  bindEvents();

  // ブラウザにデータを消さないよう要求する（結果は設定タブで見せる）
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  await db.openDb();
  setSlot(await db.getMeta('lastSlot', SLOTS[0]));
  setMode('entry');
  clearEntryForm();
  await setDate(todayKey());
  await renderBackupBanner();
  setTab('record');
  registerServiceWorker();
}

init().catch((err) => {
  console.error(err);
  const main = $('main');
  const box = el('div', 'card danger-card');
  box.appendChild(el('h2', 'card-title', 'アプリを起動できませんでした'));
  box.appendChild(el('p', 'mini', String(err && err.message ? err.message : err)));
  box.appendChild(el('p', 'mini', 'プライベートブラウズではIndexedDBが使えないことがあります。'));
  main.prepend(box);
});
