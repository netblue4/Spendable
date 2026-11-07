/* Spendable — a cute, self-contained budget helper.
 *
 * The whole point: show one number — how much you can safely spend this month
 * while still having enough left for the bills you haven't paid yet.
 *
 *   safe to spend  =  current balance  −  bills still unpaid
 *
 * All data lives on this device in localStorage (one small JSON blob), saved on
 * every change. No accounts, no server, works offline. Backup/Restore lets you
 * move it to another phone.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */
const STORAGE_KEY = 'spendable.v1';

function defaultState() {
  return { v: 1, currency: '€', recurring: [], months: {} };
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return defaultState();
    s.v = 1;
    s.currency = s.currency || '€';
    s.recurring = Array.isArray(s.recurring) ? s.recurring : [];
    s.months = (s.months && typeof s.months === 'object') ? s.months : {};
    return s;
  } catch (e) {
    console.warn('load failed', e);
    return defaultState();
  }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save — device storage may be full or blocked.'); }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
const el = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let currentKey = ym(new Date());

function ym(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function keyParts(k) { const [y, m] = k.split('-').map(Number); return { y, m }; }
function monthLabel(k) { const { y, m } = keyParts(k); return (MONTHS[m - 1] + ' ' + y).toUpperCase(); }
function shiftMonth(k, delta) {
  const { y, m } = keyParts(k);
  const d = new Date(y, m - 1 + delta, 1);
  return ym(d);
}

function money(n) {
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sign + state.currency + v;
}

/* Parse an amount the user typed, accepting both "," and "." as the decimal
 * separator (iPhone keyboards in many countries show a comma) and tolerating
 * thousands separators and stray currency symbols. */
function parseAmount(v) {
  if (typeof v === 'number') return v;
  if (v == null) return NaN;
  let s = String(v).trim().replace(/\s/g, '').replace(/[^0-9.,-]/g, '');
  if (!s) return NaN;
  const hasComma = s.indexOf(',') > -1, hasDot = s.indexOf('.') > -1;
  if (hasComma && hasDot) {
    // The separator that appears last is the decimal one; the other is thousands.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace(',', '.'); // lone comma = decimal separator
  }
  return parseFloat(s);
}

function ensureMonth(k) {
  if (!state.months[k]) state.months[k] = { balance: null, paid: {}, oneoffs: [], amounts: {} };
  const m = state.months[k];
  if (!m.paid) m.paid = {};
  if (!Array.isArray(m.oneoffs)) m.oneoffs = [];
  if (!m.amounts) m.amounts = {};        // per-month amount overrides for variable bills
  if (m.balance === undefined) m.balance = null;
  return m;
}

/* The amount to use for an item in a given month: a per-month override when the
 * bill varies and one has been set, otherwise its default (template) amount. */
function amountFor(item, k) {
  const m = ensureMonth(k);
  if (item.variable && m.amounts && m.amounts[item.id] != null) return Number(m.amounts[item.id]) || 0;
  return Number(item.amount) || 0;
}
function hasOverride(item, k) {
  const m = state.months[k];
  return !!(item.variable && m && m.amounts && m.amounts[item.id] != null);
}

/* All expense items shown for a month:
 *  - monthly recurring bills: every month
 *  - yearly bills: only in their due month
 *  - one-offs: only the month they were added to                              */
function itemsFor(k) {
  const m = ensureMonth(k);
  const mon = keyParts(k).m;
  const rec = state.recurring
    .filter((e) => {
      const f = e.freq || 'monthly';
      return f === 'monthly' || (f === 'yearly' && Number(e.dueMonth) === mon);
    })
    .map((e) => ({ ...e, freq: e.freq || 'monthly', kind: 'recurring' }));
  const one = m.oneoffs.map((e) => ({ ...e, freq: 'oneoff', kind: 'oneoff' }));
  return rec.concat(one);
}

function computeMonth(k) {
  const m = ensureMonth(k);
  const items = itemsFor(k);
  let reserved = 0, paidSum = 0, paidN = 0;
  for (const it of items) {
    const amt = amountFor(it, k);
    if (m.paid[it.id]) { paidSum += amt; paidN += 1; }
    else reserved += amt;
  }
  const balance = (m.balance === null || m.balance === undefined) ? null : Number(m.balance);
  const free = balance === null ? null : balance - reserved;
  return { items, reserved, paidSum, paidN, total: items.length, balance, free };
}

/* ------------------------------------------------------------------ *
 * Icons & colours
 * ------------------------------------------------------------------ */
const PRESETS = [
  { name: 'Rent', icon: '🏠' }, { name: 'Groceries', icon: '🛒' },
  { name: 'Electricity', icon: '⚡' }, { name: 'Water', icon: '💧' },
  { name: 'Internet', icon: '📶' }, { name: 'Phone', icon: '📱' },
  { name: 'Transport', icon: '🚌' }, { name: 'Savings', icon: '🐷' },
  { name: 'Gym', icon: '🏋️' }, { name: 'Subscriptions', icon: '📺' },
  { name: 'Insurance', icon: '🛡️' }, { name: 'Fun', icon: '🎉' },
];

const PALETTE = [
  { bg: '#fbe3e6', fg: '#d8566a' }, { bg: '#e7e2fb', fg: '#7b61c4' },
  { bg: '#fdeccf', fg: '#c98a1e' }, { bg: '#d9f2e5', fg: '#2f9e6b' },
  { bg: '#d9ecfb', fg: '#3a86c4' }, { bg: '#fde0ef', fg: '#c74f93' },
  { bg: '#e3f3d9', fg: '#5b9e39' }, { bg: '#fbe6d9', fg: '#c96a37' },
];

function guessIcon(name) {
  const n = (name || '').toLowerCase();
  const map = [
    [/rent|mortgage|accommod/, '🏠'], [/water/, '💧'], [/electri|power|energy/, '⚡'],
    [/wifi|internet|fibre|fiber|broadband/, '📶'], [/phone|mobile|cell|sim|airtime/, '📱'],
    [/grocer|food|supermarket/, '🛒'], [/transport|bus|train|metro|petrol|fuel|gas|car|uber/, '🚌'],
    [/sav(e|ing)|invest/, '🐷'], [/gym|fitness|sport/, '🏋️'],
    [/netflix|spotify|prime|disney|subscription|canva|claude|gemini|youtube/, '📺'],
    [/insur|assurance|cover/, '🛡️'], [/uni|school|tuition|fees|course|study|educat/, '🎓'],
    [/fun|entertain|night|party|game/, '🎉'], [/health|medic|dental|doctor|pharm/, '➕'],
    [/pay .* back|loan|debt|owe/, '🤝'], [/rates|tax|fee|bank/, '💳'],
  ];
  for (const [re, ico] of map) if (re.test(n)) return ico;
  return '💸';
}

function colorFor(name) {
  let h = 0;
  const s = name || '';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/* ------------------------------------------------------------------ *
 * Screen switching
 * ------------------------------------------------------------------ */
function showScreen(which) {
  el('monthly').hidden = which !== 'monthly';
  el('budget').hidden = which !== 'budget';
  el('addFab').hidden = which !== 'monthly';
  el('navMonthly').classList.toggle('active', which === 'monthly');
  el('navBudget').classList.toggle('active', which === 'budget');
  if (which === 'monthly') renderMonthly(); else renderBudget();
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ *
 * Monthly screen
 * ------------------------------------------------------------------ */
function renderMonthly() {
  el('monthLabel').textContent = monthLabel(currentKey);
  const c = computeMonth(currentKey);

  // Hero
  const hero = el('heroAmount');
  const cap = el('heroCaption');
  hero.classList.remove('negative', 'unset');
  if (c.balance === null) {
    hero.textContent = money(c.reserved);
    hero.classList.add('unset');
    cap.textContent = c.total ? 'of bills to cover — tap Balance to begin' : 'add your bills to begin';
  } else if (c.free >= 0) {
    hero.textContent = money(c.free);
    cap.textContent = 'safe to spend';
  } else {
    hero.textContent = money(c.free);
    hero.classList.add('negative');
    cap.textContent = 'short for your bills';
  }

  // Bar
  const free = el('barFree'), res = el('barReserved'), legend = el('barLegend');
  if (c.balance === null || c.balance <= 0) {
    free.style.width = '0%';
    res.style.width = c.reserved > 0 ? '100%' : '0%';
    legend.innerHTML = c.balance === null
      ? 'Set your balance to see what’s safe to spend'
      : '<b>' + money(0) + '</b> left';
  } else if (c.free >= 0) {
    free.style.width = (100 * c.free / c.balance) + '%';
    res.style.width = (100 * c.reserved / c.balance) + '%';
    legend.innerHTML = '<b>' + money(c.free) + '</b> left of <b>' + money(c.balance) + '</b>';
  } else {
    free.style.width = '0%';
    res.style.width = '100%';
    legend.innerHTML = 'Over by <b>' + money(-c.free) + '</b> — bills exceed balance';
  }

  // Stats
  el('balanceVal').textContent = c.balance === null ? 'Tap to set' : money(c.balance);
  el('reservedVal').textContent = money(c.reserved);
  el('paidCount').textContent = c.total ? (c.paidN + '/' + c.total + ' paid') : '';

  // Carry-over button: pull last month's balance when this one is blank,
  // otherwise push this month's balance forward as next month's starting point.
  const carry = el('carryBtn');
  const prevKey = shiftMonth(currentKey, -1);
  const nextKey = shiftMonth(currentKey, 1);
  const prevBal = state.months[prevKey] ? state.months[prevKey].balance : null;
  if (c.balance === null && prevBal !== null && prevBal !== undefined) {
    carry.hidden = false;
    carry.textContent = 'Start from ' + MONTHS[keyParts(prevKey).m - 1] + '’s balance (' + money(Number(prevBal)) + ')';
    carry.onclick = () => {
      ensureMonth(currentKey).balance = Number(prevBal);
      save(); renderMonthly();
      toast('Balance carried over');
    };
  } else if (c.balance !== null) {
    carry.hidden = false;
    carry.textContent = 'Carry over to ' + MONTHS[keyParts(nextKey).m - 1] + ' →';
    carry.onclick = () => {
      ensureMonth(nextKey).balance = Number(c.balance);
      save();
      currentKey = nextKey;
      renderMonthly();
      toast('Carried over to ' + MONTHS[keyParts(nextKey).m - 1]);
    };
  } else {
    carry.hidden = true;
    carry.onclick = null;
  }

  // List
  const list = el('expenseList');
  const empty = el('emptyState');
  list.innerHTML = '';
  if (!c.items.length) {
    empty.hidden = false;
    empty.innerHTML = '<b>No expenses yet.</b><br>Tap the <b>+</b> button, or go to <b>Budget</b> to add your monthly bills.';
    return;
  }
  empty.hidden = true;
  const m = ensureMonth(currentKey);
  // Show unpaid expenses first; ticked (paid) ones sink to the bottom.
  // Array.sort is stable, so the order within each group is preserved.
  const ordered = c.items.slice().sort((a, b) => (m.paid[a.id] ? 1 : 0) - (m.paid[b.id] ? 1 : 0));
  for (const it of ordered) {
    const paid = !!m.paid[it.id];
    const col = colorFor(it.name);
    const li = document.createElement('li');
    li.className = 'exp' + (paid ? ' paid' : '');

    const ico = document.createElement('div');
    ico.className = 'ico';
    ico.style.background = col.bg; ico.style.color = col.fg;
    ico.textContent = it.icon || guessIcon(it.name);

    const main = document.createElement('div');
    main.className = 'exp-main';
    const nm = document.createElement('div');
    nm.className = 'exp-name';
    nm.textContent = it.name;
    const tag = document.createElement('div');
    tag.className = 'exp-tag';
    tag.textContent = tagFor(it, currentKey);
    if (it.variable && !hasOverride(it, currentKey)) tag.classList.add('needs-set');
    main.appendChild(nm); main.appendChild(tag);

    const amt = document.createElement('div');
    amt.className = 'exp-amt';
    amt.textContent = money(amountFor(it, currentKey));

    const tick = document.createElement('button');
    tick.className = 'tick' + (paid ? ' on' : '');
    tick.setAttribute('aria-label', paid ? 'Mark as not paid' : 'Mark as paid');
    tick.textContent = '✓';
    tick.addEventListener('click', (e) => { e.stopPropagation(); togglePaid(it.id); });

    li.appendChild(ico); li.appendChild(main); li.appendChild(amt); li.appendChild(tick);
    // Varying bills: tapping sets just this month's amount. Others open the editor.
    li.addEventListener('click', () => { if (it.variable) openMonthAmount(it); else openEdit(it); });
    list.appendChild(li);
  }
}

/* Small caption under each expense name. */
function tagFor(it, k) {
  const f = it.freq || (it.kind === 'oneoff' ? 'oneoff' : 'monthly');
  let base = f === 'oneoff' ? 'one-off' : f === 'yearly' ? 'yearly' : 'monthly';
  if (f === 'yearly' && it.dueMonth) base = 'yearly · ' + MONTHS_SHORT[it.dueMonth - 1];
  if (it.variable) return hasOverride(it, k) ? (base + ' · varies') : 'tap to set this month';
  return base;
}

function togglePaid(id) {
  const m = ensureMonth(currentKey);
  if (m.paid[id]) delete m.paid[id]; else m.paid[id] = true;
  save();
  renderMonthly();
}

/* ------------------------------------------------------------------ *
 * Budget (setup) screen
 * ------------------------------------------------------------------ */
function renderBudget() {
  // preset chips
  const chips = el('presetChips');
  chips.innerHTML = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.innerHTML = '<span class="chip-ico">' + p.icon + '</span>' + p.name;
    b.addEventListener('click', () => openAdd({ name: p.name, icon: p.icon }));
    chips.appendChild(b);
  }

  // recurring list
  const list = el('recurringList');
  list.innerHTML = '';
  el('recurringEmpty').hidden = state.recurring.length > 0;
  for (const it of state.recurring) {
    const col = colorFor(it.name);
    const f = it.freq || 'monthly';
    let cadence = f === 'yearly' ? ('yearly · ' + (it.dueMonth ? MONTHS_SHORT[it.dueMonth - 1] : '?')) : 'monthly';
    if (it.variable) cadence += ' · varies';
    const li = document.createElement('li');
    li.className = 'bud';
    li.innerHTML =
      '<div class="ico" style="background:' + col.bg + ';color:' + col.fg + '">' + (it.icon || guessIcon(it.name)) + '</div>' +
      '<div class="bud-main"><div class="bud-name"></div><div class="bud-amt">' + money(Number(it.amount) || 0) + ' · ' + cadence + '</div></div>' +
      '<div class="chev">›</div>';
    li.querySelector('.bud-name').textContent = it.name;
    li.addEventListener('click', () => openEdit({ ...it, kind: 'recurring' }));
    list.appendChild(li);
  }

  el('currencySel').value = state.currency;
}

/* ------------------------------------------------------------------ *
 * Add / edit expense sheet
 * ------------------------------------------------------------------ */
let editing = null;      // { mode, id, kind, icon, freq, dueMonth, variable }
let editingAmtId = null; // id for the per-month amount sheet

function openAdd(prefill) {
  editing = { mode: 'add', id: null, kind: 'recurring', icon: (prefill && prefill.icon) || null };
  el('sheetTitle').textContent = 'Add expense';
  el('fName').value = (prefill && prefill.name) || '';
  el('fAmount').value = '';
  el('fCur').textContent = state.currency;
  editing.dueMonth = keyParts(currentKey).m;
  setFreq('monthly');
  setVariable(false);
  el('sheetDelete').hidden = true;
  openSheet('sheet');
  if (!el('fName').value) el('fName').focus(); else el('fAmount').focus();
}

function openEdit(it) {
  const freq = it.kind === 'oneoff' ? 'oneoff' : (it.freq || 'monthly');
  editing = { mode: 'edit', id: it.id, kind: it.kind, icon: it.icon || null };
  el('sheetTitle').textContent = 'Edit expense';
  el('fName').value = it.name;
  el('fAmount').value = (it.amount != null) ? it.amount : '';
  el('fCur').textContent = state.currency;
  editing.dueMonth = it.dueMonth || keyParts(currentKey).m;
  setFreq(freq);
  setVariable(!!it.variable);
  el('sheetDelete').hidden = false;
  openSheet('sheet');
}

function setFreq(freq) {
  editing.freq = freq;
  for (const b of el('fFreq').querySelectorAll('.seg')) {
    b.classList.toggle('active', b.dataset.val === freq);
  }
  const help = el('freqHelp');
  if (freq === 'yearly') { help.hidden = false; help.textContent = 'Shows up only in the month it’s due, every year.'; }
  else if (freq === 'oneoff') { help.hidden = false; help.textContent = 'One-off expenses only show up in the month you’re viewing.'; }
  else { help.hidden = true; help.textContent = ''; }
  el('monthPicker').hidden = freq !== 'yearly';
  if (freq === 'yearly') renderMonthPicker();
  el('variableField').hidden = freq === 'oneoff';
  if (freq === 'oneoff') setVariable(false);
}

function setVariable(on) {
  editing.variable = !!on;
  for (const b of el('fVariable').querySelectorAll('.seg')) {
    b.classList.toggle('active', (b.dataset.val === 'true') === !!on);
  }
  el('variableHelp').hidden = !on;
}

function renderMonthPicker() {
  const grid = el('mpGrid');
  grid.innerHTML = '';
  for (let i = 1; i <= 12; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mp-btn' + (editing.dueMonth === i ? ' active' : '');
    b.textContent = MONTHS_SHORT[i - 1];
    b.addEventListener('click', () => { editing.dueMonth = i; renderMonthPicker(); });
    grid.appendChild(b);
  }
}

function removeItemEverywhere(id) {
  state.recurring = state.recurring.filter((e) => e.id !== id);
  for (const k in state.months) {
    const m = state.months[k];
    if (Array.isArray(m.oneoffs)) m.oneoffs = m.oneoffs.filter((e) => e.id !== id);
  }
}

function saveSheet() {
  const name = el('fName').value.trim();
  let amount = parseAmount(el('fAmount').value);
  if (!name) { toast('Give it a name'); return; }
  const freq = editing.freq;
  const variable = freq !== 'oneoff' && editing.variable;
  // A variable bill may have a blank/0 default — you set the real figure each month.
  if (!isFinite(amount) || amount < 0) {
    if (variable) amount = 0; else { toast('Enter a valid amount'); return; }
  }

  const id = editing.id || uid();
  const item = { id, name, amount: Math.round(amount * 100) / 100, icon: editing.icon || guessIcon(name) };
  if (freq === 'yearly') { item.freq = 'yearly'; item.dueMonth = editing.dueMonth || keyParts(currentKey).m; }
  else if (freq === 'monthly') { item.freq = 'monthly'; }
  if (variable) item.variable = true;

  if (editing.mode === 'edit') removeItemEverywhere(id);
  if (freq === 'oneoff') ensureMonth(currentKey).oneoffs.push(item);
  else state.recurring.push(item);

  save();
  closeSheet('sheet');
  if (!el('monthly').hidden) renderMonthly(); else renderBudget();
  toast(editing.mode === 'edit' ? 'Saved' : 'Added');
}

function deleteItem() {
  if (!editing || !editing.id) return;
  removeItemEverywhere(editing.id);
  for (const k in state.months) {
    if (state.months[k].paid) delete state.months[k].paid[editing.id];
    if (state.months[k].amounts) delete state.months[k].amounts[editing.id];
  }
  save();
  closeSheet('sheet');
  if (!el('monthly').hidden) renderMonthly(); else renderBudget();
  toast('Deleted');
}

/* ------------------------------------------------------------------ *
 * Per-month amount sheet (for a varying bill)
 * ------------------------------------------------------------------ */
function openMonthAmount(it) {
  editingAmtId = it.id;
  const mName = MONTHS[keyParts(currentKey).m - 1];
  el('amtTitle').textContent = it.name + ' — ' + mName;
  el('amtCur').textContent = state.currency;
  const m = ensureMonth(currentKey);
  const cur = (m.amounts && m.amounts[it.id] != null) ? m.amounts[it.id] : (Number(it.amount) || 0);
  el('amtInput').value = cur;
  el('amtHelp').textContent = 'Set the amount for ' + mName + ' only. Default is ' + money(Number(it.amount) || 0) + '.';
  openSheet('amtSheet');
  el('amtInput').focus();
}

function saveMonthAmount() {
  if (!editingAmtId) return;
  const m = ensureMonth(currentKey);
  const v = parseAmount(el('amtInput').value);
  if (isFinite(v) && v >= 0) m.amounts[editingAmtId] = Math.round(v * 100) / 100;
  else delete m.amounts[editingAmtId];
  save();
  closeSheet('amtSheet');
  renderMonthly();
}

function resetMonthAmount() {
  if (!editingAmtId) return;
  const m = ensureMonth(currentKey);
  delete m.amounts[editingAmtId];
  save();
  closeSheet('amtSheet');
  renderMonthly();
  toast('Using the default amount');
}

/* ------------------------------------------------------------------ *
 * Balance sheet
 * ------------------------------------------------------------------ */
function openBalance() {
  const m = ensureMonth(currentKey);
  el('balCur').textContent = state.currency;
  el('balInput').value = (m.balance === null || m.balance === undefined) ? '' : m.balance;
  openSheet('balSheet');
  el('balInput').focus();
}

function saveBalance() {
  const v = parseAmount(el('balInput').value);
  const m = ensureMonth(currentKey);
  m.balance = isFinite(v) ? Math.round(v * 100) / 100 : null;
  save();
  closeSheet('balSheet');
  renderMonthly();
}

/* ------------------------------------------------------------------ *
 * Sheet open/close
 * ------------------------------------------------------------------ */
function openSheet(id) { el(id).hidden = false; }
function closeSheet(id) { el(id).hidden = true; }

/* ------------------------------------------------------------------ *
 * Backup / restore
 * ------------------------------------------------------------------ */
function exportData() {
  try {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spendable-backup-' + ym(new Date()) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup downloaded');
  } catch (e) { toast('Could not export'); }
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = JSON.parse(reader.result);
      if (!s || typeof s !== 'object' || !('recurring' in s) || !('months' in s)) {
        toast('That file is not a Spendable backup'); return;
      }
      state = {
        v: 1,
        currency: s.currency || '€',
        recurring: Array.isArray(s.recurring) ? s.recurring : [],
        months: (s.months && typeof s.months === 'object') ? s.months : {},
      };
      save();
      showScreen('budget');
      toast('Backup restored');
    } catch (e) { toast('Could not read that file'); }
  };
  reader.readAsText(file);
}

/* ------------------------------------------------------------------ *
 * Toast
 * ------------------------------------------------------------------ */
let toastTimer = null;
function toast(msg) {
  const t = el('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */
el('prevMonth').addEventListener('click', () => { currentKey = shiftMonth(currentKey, -1); renderMonthly(); });
el('nextMonth').addEventListener('click', () => { currentKey = shiftMonth(currentKey, 1); renderMonthly(); });
el('addFab').addEventListener('click', () => openAdd(null));
el('balanceStat').addEventListener('click', openBalance);

el('navMonthly').addEventListener('click', () => showScreen('monthly'));
el('navBudget').addEventListener('click', () => showScreen('budget'));

el('fFreq').addEventListener('click', (e) => {
  const b = e.target.closest('.seg'); if (!b) return;
  setFreq(b.dataset.val);
});
el('fVariable').addEventListener('click', (e) => {
  const b = e.target.closest('.seg'); if (!b) return;
  setVariable(b.dataset.val === 'true');
});
el('sheetSave').addEventListener('click', saveSheet);
el('sheetCancel').addEventListener('click', () => closeSheet('sheet'));
el('sheetDelete').addEventListener('click', deleteItem);
el('sheet').addEventListener('click', (e) => { if (e.target === el('sheet')) closeSheet('sheet'); });

el('amtSave').addEventListener('click', saveMonthAmount);
el('amtReset').addEventListener('click', resetMonthAmount);
el('amtCancel').addEventListener('click', () => closeSheet('amtSheet'));
el('amtSheet').addEventListener('click', (e) => { if (e.target === el('amtSheet')) closeSheet('amtSheet'); });

el('balSave').addEventListener('click', saveBalance);
el('balCancel').addEventListener('click', () => closeSheet('balSheet'));
el('balSheet').addEventListener('click', (e) => { if (e.target === el('balSheet')) closeSheet('balSheet'); });

el('customForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = el('customName').value.trim();
  if (!name) return;
  el('customName').value = '';
  openAdd({ name });
});

el('currencySel').addEventListener('change', () => {
  state.currency = el('currencySel').value || '€';
  save();
  renderBudget();
});

el('exportBtn').addEventListener('click', exportData);
el('importBtn').addEventListener('click', () => el('importFile').click());
el('importFile').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
ensureMonth(currentKey);
showScreen('monthly');

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
