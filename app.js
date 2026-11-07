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

function ensureMonth(k) {
  if (!state.months[k]) state.months[k] = { balance: null, paid: {}, oneoffs: [] };
  const m = state.months[k];
  if (!m.paid) m.paid = {};
  if (!Array.isArray(m.oneoffs)) m.oneoffs = [];
  if (m.balance === undefined) m.balance = null;
  return m;
}

/* All expense items shown for a month: recurring template + this month's one-offs. */
function itemsFor(k) {
  const m = ensureMonth(k);
  const rec = state.recurring.map((e) => ({ ...e, kind: 'recurring' }));
  const one = m.oneoffs.map((e) => ({ ...e, kind: 'oneoff' }));
  return rec.concat(one);
}

function computeMonth(k) {
  const m = ensureMonth(k);
  const items = itemsFor(k);
  let reserved = 0, paidSum = 0, paidN = 0;
  for (const it of items) {
    const amt = Number(it.amount) || 0;
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
    tag.textContent = it.kind === 'oneoff' ? 'one-off' : 'monthly';
    main.appendChild(nm); main.appendChild(tag);

    const amt = document.createElement('div');
    amt.className = 'exp-amt';
    amt.textContent = money(Number(it.amount) || 0);

    const tick = document.createElement('button');
    tick.className = 'tick' + (paid ? ' on' : '');
    tick.setAttribute('aria-label', paid ? 'Mark as not paid' : 'Mark as paid');
    tick.textContent = '✓';
    tick.addEventListener('click', (e) => { e.stopPropagation(); togglePaid(it.id); });

    li.appendChild(ico); li.appendChild(main); li.appendChild(amt); li.appendChild(tick);
    li.addEventListener('click', () => openEdit(it));
    list.appendChild(li);
  }
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
    const li = document.createElement('li');
    li.className = 'bud';
    li.innerHTML =
      '<div class="ico" style="background:' + col.bg + ';color:' + col.fg + '">' + (it.icon || guessIcon(it.name)) + '</div>' +
      '<div class="bud-main"><div class="bud-name"></div><div class="bud-amt">' + money(Number(it.amount) || 0) + ' · monthly</div></div>' +
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
let editing = null; // { mode:'add'|'edit', id, kind, icon }

function openAdd(prefill) {
  editing = { mode: 'add', id: null, kind: 'recurring', icon: (prefill && prefill.icon) || null };
  el('sheetTitle').textContent = 'Add expense';
  el('fName').value = (prefill && prefill.name) || '';
  el('fAmount').value = '';
  el('fCur').textContent = state.currency;
  setRecurring(true);
  el('sheetDelete').hidden = true;
  openSheet('sheet');
  if (!el('fName').value) el('fName').focus(); else el('fAmount').focus();
}

function openEdit(it) {
  editing = { mode: 'edit', id: it.id, kind: it.kind, icon: it.icon || null };
  el('sheetTitle').textContent = 'Edit expense';
  el('fName').value = it.name;
  el('fAmount').value = (it.amount != null) ? it.amount : '';
  el('fCur').textContent = state.currency;
  setRecurring(it.kind !== 'oneoff');
  el('sheetDelete').hidden = false;
  openSheet('sheet');
}

function setRecurring(isRec) {
  editing.recurring = isRec;
  for (const b of el('fRecurring').querySelectorAll('.seg')) {
    b.classList.toggle('active', (b.dataset.val === 'true') === isRec);
  }
  el('oneoffHelp').hidden = isRec;
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
  const amount = parseFloat(el('fAmount').value);
  if (!name) { toast('Give it a name'); return; }
  if (!isFinite(amount) || amount < 0) { toast('Enter a valid amount'); return; }

  const id = editing.id || uid();
  const item = { id, name, amount: Math.round(amount * 100) / 100, icon: editing.icon || guessIcon(name) };

  if (editing.mode === 'edit') removeItemEverywhere(id);
  if (editing.recurring) {
    state.recurring.push(item);
  } else {
    ensureMonth(currentKey).oneoffs.push(item);
  }
  save();
  closeSheet('sheet');
  // Re-render whichever screen is visible.
  if (!el('monthly').hidden) renderMonthly(); else renderBudget();
  toast(editing.mode === 'edit' ? 'Saved' : 'Added');
}

function deleteItem() {
  if (!editing || !editing.id) return;
  removeItemEverywhere(editing.id);
  // Also drop any paid flags for it.
  for (const k in state.months) { if (state.months[k].paid) delete state.months[k].paid[editing.id]; }
  save();
  closeSheet('sheet');
  if (!el('monthly').hidden) renderMonthly(); else renderBudget();
  toast('Deleted');
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
  const v = parseFloat(el('balInput').value);
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

el('fRecurring').addEventListener('click', (e) => {
  const b = e.target.closest('.seg'); if (!b) return;
  setRecurring(b.dataset.val === 'true');
});
el('sheetSave').addEventListener('click', saveSheet);
el('sheetCancel').addEventListener('click', () => closeSheet('sheet'));
el('sheetDelete').addEventListener('click', deleteItem);
el('sheet').addEventListener('click', (e) => { if (e.target === el('sheet')) closeSheet('sheet'); });

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
