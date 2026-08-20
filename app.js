(() => {
  'use strict';

  const STORAGE_KEY = 'habits-dashboard-v1';
  const EMOJI_PRESETS = ['✅','💧','🏃','📖','🧘','🛌','🥗','💪','🚭','📵','✍️','🧹','🎯','🙏','🎸','💊'];
  const COLOR_SLOTS = [1,2,3,4,5,6,7,8];
  const DAY_LABELS = ['S','M','T','W','T','F','S'];
  const WEEKS_OVERVIEW = 18;
  const WEEKS_DETAIL = 20;
  const TIME_SLOTS = [
    { key: 'morning', label: 'Morning' },
    { key: 'afternoon', label: 'Afternoon' },
    { key: 'evening', label: 'Evening' },
    { key: 'bedtime', label: 'Bedtime' }
  ];
  const STOCK_LOW_DAYS = 7;

  /* ---------------- date helpers ---------------- */
  function todayDate() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function fmt(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function parseLocal(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }
  function todayStr() { return fmt(todayDate()); }
  function humanDate(str) {
    const d = parseLocal(str);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function humanDateLong(str) {
    const d = parseLocal(str);
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function startOfWeek(date) {
    const dow = date.getDay();
    return addDays(date, -dow);
  }
  function debounce(fn, wait) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }
  function wireNoteInput(el, save) {
    const flush = () => save(el.value);
    el.addEventListener('input', debounce(flush, 400));
    el.addEventListener('blur', flush);
  }

  /* ---------------- state ---------------- */
  let state = loadState();

  function defaultState() {
    return {
      version: 1, habits: [], logs: {}, notes: {}, habitNotes: {},
      yearlyHabits: [], yearlyLogs: {},
      supplements: [], supplementLogs: {},
      settings: { theme: 'auto' }
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaultState();
      return Object.assign(defaultState(), parsed, {
        habits: Array.isArray(parsed.habits) ? parsed.habits : [],
        logs: parsed.logs && typeof parsed.logs === 'object' ? parsed.logs : {},
        notes: parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
        habitNotes: parsed.habitNotes && typeof parsed.habitNotes === 'object' ? parsed.habitNotes : {},
        yearlyHabits: Array.isArray(parsed.yearlyHabits) ? parsed.yearlyHabits : [],
        yearlyLogs: parsed.yearlyLogs && typeof parsed.yearlyLogs === 'object' ? parsed.yearlyLogs : {},
        supplements: Array.isArray(parsed.supplements) ? parsed.supplements : [],
        supplementLogs: parsed.supplementLogs && typeof parsed.supplementLogs === 'object' ? parsed.supplementLogs : {},
        settings: Object.assign({ theme: 'auto' }, parsed.settings || {})
      });
    } catch (e) {
      console.error('Failed to load state', e);
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (window.KeystoneApp && typeof window.KeystoneApp.onLocalSave === 'function') {
      window.KeystoneApp.onLocalSave(state);
    }
  }

  /* ---------------- habit logic ---------------- */
  function isScheduled(habit, dStr) {
    const dow = parseLocal(dStr).getDay();
    return habit.days.includes(dow);
  }
  function getRaw(habit, dStr) {
    const h = state.logs[habit.id];
    return h ? h[dStr] : undefined;
  }
  function isDone(habit, dStr) {
    const v = getRaw(habit, dStr);
    if (habit.type === 'count') return (Number(v) || 0) >= (habit.target || 1);
    return v === true;
  }
  function progressRatio(habit, dStr) {
    if (habit.type !== 'count') return isDone(habit, dStr) ? 1 : 0;
    const v = Number(getRaw(habit, dStr)) || 0;
    const t = habit.target || 1;
    return Math.max(0, Math.min(1, v / t));
  }
  function setValue(habit, dStr, value) {
    if (!state.logs[habit.id]) state.logs[habit.id] = {};
    const bucket = state.logs[habit.id];
    if (habit.type === 'count') {
      const n = Number(value) || 0;
      if (n <= 0) delete bucket[dStr];
      else bucket[dStr] = n;
    } else {
      if (value) bucket[dStr] = true;
      else delete bucket[dStr];
    }
    if (Object.keys(bucket).length === 0) delete state.logs[habit.id];
  }
  function floorDate(habit) {
    let min = habit.createdAt || todayStr();
    const bucket = state.logs[habit.id];
    if (bucket) {
      for (const k in bucket) if (k < min) min = k;
    }
    return min;
  }
  function currentStreak(habit, asOfStr) {
    const floor = floorDate(habit);
    let cursor = asOfStr ? parseLocal(asOfStr) : todayDate();
    let cStr = fmt(cursor);
    if (isScheduled(habit, cStr) && !isDone(habit, cStr)) {
      cursor = addDays(cursor, -1);
    }
    let count = 0;
    let guard = 0;
    while (fmt(cursor) >= floor && guard < 20000) {
      guard++;
      const ds = fmt(cursor);
      if (isScheduled(habit, ds)) {
        if (isDone(habit, ds)) { count++; cursor = addDays(cursor, -1); }
        else break;
      } else {
        cursor = addDays(cursor, -1);
      }
    }
    return count;
  }
  function longestStreak(habit) {
    const start = parseLocal(floorDate(habit));
    const end = todayDate();
    let run = 0, max = 0;
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const ds = fmt(d);
      if (isScheduled(habit, ds)) {
        if (isDone(habit, ds)) { run++; if (run > max) max = run; }
        else run = 0;
      }
    }
    return max;
  }
  function activeHabits() { return state.habits.filter(h => !h.archived); }

  /* ---------------- yearly goals ---------------- */
  function currentYear() { return String(todayDate().getFullYear()); }
  function activeYearlyHabits() { return state.yearlyHabits.filter(h => !h.archived); }
  function getYearlyValue(habit, year) {
    const bucket = state.yearlyLogs[habit.id];
    return (bucket && Number(bucket[year])) || 0;
  }
  function setYearlyValue(habit, year, value) {
    const n = Math.max(0, Math.round(Number(value)) || 0);
    if (!state.yearlyLogs[habit.id]) state.yearlyLogs[habit.id] = {};
    if (n <= 0) delete state.yearlyLogs[habit.id][year];
    else state.yearlyLogs[habit.id][year] = n;
    if (Object.keys(state.yearlyLogs[habit.id]).length === 0) delete state.yearlyLogs[habit.id];
  }

  /* ---------------- supplements ---------------- */
  function activeSupplements() { return state.supplements.filter(s => !s.archived); }
  function supplementSlots(supp) { return supp.times && supp.times.length ? supp.times : ['morning']; }
  function getTakenSlots(supp, ds) {
    const bucket = state.supplementLogs[supp.id];
    return (bucket && bucket[ds]) || [];
  }
  function isSlotTaken(supp, ds, slot) { return getTakenSlots(supp, ds).includes(slot); }
  function toggleSupplementSlot(supp, ds, slot) {
    if (!state.supplementLogs[supp.id]) state.supplementLogs[supp.id] = {};
    const bucket = state.supplementLogs[supp.id];
    const taken = bucket[ds] || [];
    const wasTaken = taken.includes(slot);
    const next = wasTaken ? taken.filter(s => s !== slot) : [...taken, slot];
    if (next.length) bucket[ds] = next; else delete bucket[ds];
    if (Object.keys(bucket).length === 0) delete state.supplementLogs[supp.id];
    if (supp.stockEnabled) {
      const delta = wasTaken ? 1 : -1;
      supp.stockRemaining = Math.max(0, (supp.stockRemaining || 0) + delta);
    }
  }
  function supplementDoneForDay(supp, ds) {
    const slots = supplementSlots(supp);
    const taken = getTakenSlots(supp, ds);
    return slots.every(s => taken.includes(s));
  }
  function supplementAdherencePct(supp, ds) {
    const slots = supplementSlots(supp);
    const taken = getTakenSlots(supp, ds).filter(s => slots.includes(s));
    return slots.length ? Math.round((taken.length / slots.length) * 100) : 0;
  }
  function supplementFloorDate(supp) {
    let min = supp.createdAt || todayStr();
    const bucket = state.supplementLogs[supp.id];
    if (bucket) for (const k in bucket) if (k < min) min = k;
    return min;
  }
  function supplementStreak(supp, asOfStr) {
    const floor = supplementFloorDate(supp);
    let cursor = asOfStr ? parseLocal(asOfStr) : todayDate();
    if (!supplementDoneForDay(supp, fmt(cursor))) cursor = addDays(cursor, -1);
    let count = 0, guard = 0;
    while (fmt(cursor) >= floor && guard < 20000) {
      guard++;
      const ds = fmt(cursor);
      if (supplementDoneForDay(supp, ds)) { count++; cursor = addDays(cursor, -1); }
      else break;
    }
    return count;
  }
  function supplementDaysRemaining(supp) {
    if (!supp.stockEnabled) return null;
    const perDay = supplementSlots(supp).length || 1;
    return Math.floor((supp.stockRemaining || 0) / perDay);
  }

  /* ---------------- review (week / month) ---------------- */
  let reviewPeriod = 'week';

  function reviewRange(period) {
    const today = todayDate();
    if (period === 'month') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start, end: today, label: today.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
    }
    const start = startOfWeek(today);
    return { start, end: today, label: `${humanDate(fmt(start))} – ${humanDate(fmt(today))}` };
  }

  function habitReviewStats(habit, start, end) {
    let scheduled = 0, done = 0;
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const ds = fmt(d);
      if (isScheduled(habit, ds)) { scheduled++; if (isDone(habit, ds)) done++; }
    }
    return { scheduled, done, pct: scheduled ? Math.round((done / scheduled) * 100) : 0 };
  }

  function supplementReviewStats(supp, start, end) {
    let dayCount = 0, sumPct = 0;
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      sumPct += supplementAdherencePct(supp, fmt(d));
      dayCount++;
    }
    return { pct: dayCount ? Math.round(sumPct / dayCount) : 0 };
  }

  function yearlyPaceStatus(habit) {
    const year = currentYear();
    const value = getYearlyValue(habit, year);
    const target = habit.target || 1;
    const startOfYear = new Date(Number(year), 0, 1);
    const endOfYear = new Date(Number(year), 11, 31);
    const totalDays = Math.round((endOfYear - startOfYear) / 86400000) + 1;
    const elapsedDays = Math.round((todayDate() - startOfYear) / 86400000) + 1;
    const expected = target * (elapsedDays / totalDays);
    const ratio = expected > 0 ? value / expected : (value > 0 ? 2 : 1);
    let status, cls;
    if (habit.createdAt === todayStr() && value === 0) { status = 'Just started'; cls = 'good'; }
    else if (ratio >= 1.05) { status = 'Ahead'; cls = 'good'; }
    else if (ratio >= 0.8) { status = 'On track'; cls = 'good'; }
    else if (ratio >= 0.5) { status = 'Behind'; cls = 'warning'; }
    else { status = 'Far behind'; cls = 'critical'; }
    return { status, cls, value, target, pct: Math.min(100, Math.round((value / target) * 100)) };
  }

  /* ---------------- daily notes ---------------- */
  function getNote(ds) { return state.notes[ds] || ''; }
  function setNote(ds, text) {
    if ((text || '').trim()) state.notes[ds] = text;
    else delete state.notes[ds];
  }
  function getHabitNote(habitId, ds) {
    const bucket = state.habitNotes[habitId];
    return (bucket && bucket[ds]) || '';
  }
  function setHabitNote(habitId, ds, text) {
    if ((text || '').trim()) {
      if (!state.habitNotes[habitId]) state.habitNotes[habitId] = {};
      state.habitNotes[habitId][ds] = text;
    } else if (state.habitNotes[habitId]) {
      delete state.habitNotes[habitId][ds];
      if (Object.keys(state.habitNotes[habitId]).length === 0) delete state.habitNotes[habitId];
    }
  }

  /* ---------------- trend data ---------------- */
  function computeWeeklyCompletion(habit, weeksCount) {
    const thisWeekStart = startOfWeek(todayDate());
    const weeks = [];
    for (let i = weeksCount - 1; i >= 0; i--) {
      const weekStart = addDays(thisWeekStart, -7 * i);
      const cap = addDays(weekStart, 6) > todayDate() ? todayDate() : addDays(weekStart, 6);
      let scheduled = 0, done = 0;
      for (let d = new Date(weekStart); d <= cap; d = addDays(d, 1)) {
        const ds = fmt(d);
        if (isScheduled(habit, ds)) { scheduled++; if (isDone(habit, ds)) done++; }
      }
      weeks.push({ weekStart: fmt(weekStart), scheduled, done, pct: scheduled ? Math.round((done / scheduled) * 100) : null });
    }
    return weeks;
  }
  function computeDailyValues(habit, daysCount) {
    const days = [];
    for (let i = daysCount - 1; i >= 0; i--) {
      const d = addDays(todayDate(), -i);
      const ds = fmt(d);
      if (!isScheduled(habit, ds)) continue;
      days.push({ ds, value: Number(getRaw(habit, ds)) || 0 });
    }
    return days;
  }

  /* ---------------- stats ---------------- */
  function computeStats() {
    const habits = activeHabits();
    const today = todayStr();
    let todayScheduled = 0, todayDone = 0;
    habits.forEach(h => { if (isScheduled(h, today)) { todayScheduled++; if (isDone(h, today)) todayDone++; } });

    const weekStart = startOfWeek(todayDate());
    let weekScheduled = 0, weekDone = 0;
    for (let d = new Date(weekStart); d <= todayDate(); d = addDays(d, 1)) {
      const ds = fmt(d);
      habits.forEach(h => { if (isScheduled(h, ds)) { weekScheduled++; if (isDone(h, ds)) weekDone++; } });
    }

    let bestStreak = 0;
    habits.forEach(h => { bestStreak = Math.max(bestStreak, currentStreak(h)); });

    return {
      todayPct: todayScheduled ? Math.round((todayDone / todayScheduled) * 100) : null,
      todayFrac: `${todayDone}/${todayScheduled}`,
      weekPct: weekScheduled ? Math.round((weekDone / weekScheduled) * 100) : null,
      bestStreak,
      count: habits.length
    };
  }

  /* ---------------- rendering: stats ---------------- */
  function renderStats() {
    const s = computeStats();
    $('#stat-today').textContent = s.todayPct === null ? '—' : `${s.todayPct}%`;
    $('#stat-week').textContent = s.weekPct === null ? '—' : `${s.weekPct}%`;
    $('#stat-streak').textContent = s.bestStreak > 0 ? `${s.bestStreak}d` : '—';
    $('#stat-count').textContent = String(s.count);
  }

  /* ---------------- rendering: overview heatmap ---------------- */
  function heatStepClass(pct) {
    if (pct === null || pct <= 0) return 0;
    if (pct <= 25) return 1;
    if (pct <= 50) return 2;
    if (pct <= 75) return 3;
    return 4;
  }

  function renderOverviewHeatmap() {
    const container = $('#overview-heatmap');
    container.innerHTML = '';
    const habits = activeHabits();
    const today = todayDate();
    const end = startOfWeek(today);
    const totalDays = WEEKS_OVERVIEW * 7;
    const start = addDays(end, -(totalDays - 7));

    for (let d = new Date(start); d < addDays(end, 7); d = addDays(d, 1)) {
      const ds = fmt(d);
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      if (d > today) {
        cell.classList.add('future');
      } else {
        let scheduled = 0, done = 0;
        habits.forEach(h => { if (isScheduled(h, ds)) { scheduled++; if (isDone(h, ds)) done++; } });
        const pct = scheduled ? (done / scheduled) * 100 : null;
        const step = heatStepClass(pct);
        if (step > 0) cell.style.background = `var(--heat-${step})`;
        if (ds === todayStr()) cell.classList.add('today');
        cell.classList.add('clickable');
        cell.title = scheduled ? `${humanDate(ds)} · ${Math.round(pct)}% (${done}/${scheduled})` : `${humanDate(ds)} · tap to view or add a note`;
        cell.addEventListener('click', () => openDaySheet(ds));
      }
      container.appendChild(cell);
    }
    requestAnimationFrame(() => {
      const scroller = container.parentElement;
      scroller.scrollLeft = scroller.scrollWidth;
    });
  }

  /* ---------------- rendering: habit list ---------------- */
  function habitColorVar(habit) { return `var(--series-${habit.color})`; }

  function swapActive(fullArray, activeArray, index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= activeArray.length) return;
    const a = activeArray[index], b = activeArray[targetIndex];
    const realIndexA = fullArray.indexOf(a);
    const realIndexB = fullArray.indexOf(b);
    fullArray[realIndexA] = b;
    fullArray[realIndexB] = a;
  }
  function buildReorderButtons(fullArray, activeArray, index, rerender) {
    const wrap = document.createElement('div');
    wrap.className = 'reorder-btns';
    const up = document.createElement('button');
    up.type = 'button'; up.className = 'reorder-btn'; up.textContent = '▲';
    up.setAttribute('aria-label', 'Move up');
    up.disabled = index === 0;
    up.addEventListener('click', () => { swapActive(fullArray, activeArray, index, -1); saveState(); rerender(); });
    const down = document.createElement('button');
    down.type = 'button'; down.className = 'reorder-btn'; down.textContent = '▼';
    down.setAttribute('aria-label', 'Move down');
    down.disabled = index === activeArray.length - 1;
    down.addEventListener('click', () => { swapActive(fullArray, activeArray, index, 1); saveState(); rerender(); });
    wrap.append(up, down);
    return wrap;
  }

  function renderHabitList() {
    const list = $('#habit-list');
    const habits = activeHabits();
    list.innerHTML = '';
    $('#empty-state').hidden = habits.length > 0;
    list.hidden = habits.length === 0;

    habits.forEach(habit => {
      const li = document.createElement('li');
      li.className = 'habit-row';
      li.style.setProperty('--habit-color', habitColorVar(habit));

      const icon = document.createElement('div');
      icon.className = 'habit-icon';
      icon.textContent = habit.emoji || '✅';
      icon.addEventListener('click', () => openDetail(habit.id));

      const main = document.createElement('div');
      main.className = 'habit-main';
      main.addEventListener('click', () => openDetail(habit.id));

      const name = document.createElement('p');
      name.className = 'habit-name';
      name.textContent = habit.name;

      const meta = document.createElement('p');
      meta.className = 'habit-meta';
      const streak = currentStreak(habit);
      const scheduleLabel = habit.days.length === 7 ? 'Every day' : habit.days.map(d => DAY_LABELS[d]).join(' ');
      meta.innerHTML = `<span class="habit-streak">${streak > 0 ? '🔥 ' + streak + 'd' : 'No streak yet'}</span> · ${scheduleLabel}`;

      const strip = document.createElement('div');
      strip.className = 'habit-strip';
      const today = todayDate();
      for (let i = 6; i >= 0; i--) {
        const d = addDays(today, -i);
        const ds = fmt(d);
        const cell = document.createElement('div');
        cell.className = 'strip-cell';
        const ratio = progressRatio(habit, ds);
        if (ratio >= 1) cell.style.background = habitColorVar(habit);
        else if (ratio > 0) cell.style.background = `color-mix(in srgb, ${habitColorVar(habit)} ${Math.round(ratio * 70) + 15}%, var(--surface-2))`;
        strip.appendChild(cell);
      }

      main.append(name, meta, strip);

      const control = document.createElement('div');
      control.className = 'habit-control';
      const ds = todayStr();
      if (habit.type === 'count') {
        const val = Number(getRaw(habit, ds)) || 0;
        const stepper = document.createElement('div');
        stepper.className = 'stepper';
        const minus = document.createElement('button');
        minus.type = 'button'; minus.className = 'stepper-btn'; minus.textContent = '−';
        minus.addEventListener('click', () => { setValue(habit, ds, Math.max(0, val - 1)); saveState(); renderAll(); });
        const value = document.createElement('span');
        value.className = 'stepper-value';
        value.textContent = `${val}/${habit.target || 1}`;
        const plus = document.createElement('button');
        plus.type = 'button'; plus.className = 'stepper-btn'; plus.textContent = '+';
        plus.addEventListener('click', () => { setValue(habit, ds, val + 1); saveState(); renderAll(); });
        stepper.append(minus, value, plus);
        control.appendChild(stepper);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'check-toggle' + (isDone(habit, ds) ? ' done' : '');
        btn.textContent = '✓';
        btn.setAttribute('aria-label', isDone(habit, ds) ? 'Mark not done today' : 'Mark done today');
        btn.addEventListener('click', () => { setValue(habit, ds, !isDone(habit, ds)); saveState(); renderAll(); });
        control.appendChild(btn);
      }

      li.append(icon, main, control, buildReorderButtons(state.habits, habits, habits.indexOf(habit), renderHabitList));
      list.appendChild(li);
    });
  }

  /* ---------------- rendering: yearly goals ---------------- */
  function renderYearlyList() {
    const list = $('#yearly-list');
    const habits = activeYearlyHabits();
    list.innerHTML = '';
    $('#yearly-empty-state').hidden = habits.length > 0;
    list.hidden = habits.length === 0;
    const year = currentYear();

    habits.forEach(habit => {
      const li = document.createElement('li');
      li.className = 'yearly-card';
      li.style.setProperty('--habit-color', habitColorVar(habit));

      const top = document.createElement('div');
      top.className = 'yearly-top';

      const icon = document.createElement('div');
      icon.className = 'habit-icon';
      icon.textContent = habit.emoji || '🎯';
      icon.addEventListener('click', () => openYearlyDetail(habit.id));

      const main = document.createElement('div');
      main.className = 'habit-main';
      main.addEventListener('click', () => openYearlyDetail(habit.id));

      const value = getYearlyValue(habit, year);
      const target = habit.target || 1;
      const pct = Math.min(100, Math.round((value / target) * 100));

      const name = document.createElement('p');
      name.className = 'habit-name';
      name.textContent = habit.name;
      const meta = document.createElement('p');
      meta.className = 'habit-meta';
      meta.textContent = `${value} / ${target}${habit.unit ? ' ' + habit.unit : ''} · ${pct}%`;
      main.append(name, meta);

      const control = document.createElement('div');
      control.className = 'habit-control';
      const stepper = document.createElement('div');
      stepper.className = 'stepper';
      const minus = document.createElement('button');
      minus.type = 'button'; minus.className = 'stepper-btn'; minus.textContent = '−';
      minus.addEventListener('click', () => { setYearlyValue(habit, year, value - 1); saveState(); renderYearlyList(); renderReview(); });
      const valSpan = document.createElement('span');
      valSpan.className = 'stepper-value';
      valSpan.textContent = String(value);
      const plus = document.createElement('button');
      plus.type = 'button'; plus.className = 'stepper-btn'; plus.textContent = '+';
      plus.addEventListener('click', () => { setYearlyValue(habit, year, value + 1); saveState(); renderYearlyList(); renderReview(); });
      stepper.append(minus, valSpan, plus);
      control.appendChild(stepper);

      top.append(icon, main, control, buildReorderButtons(state.yearlyHabits, habits, habits.indexOf(habit), renderYearlyList));

      const track = document.createElement('div');
      track.className = 'meter-track';
      const fill = document.createElement('div');
      fill.className = 'meter-fill';
      fill.style.width = `${pct}%`;
      track.appendChild(fill);

      li.append(top, track);
      list.appendChild(li);
    });
  }

  /* ---------------- rendering: supplements ---------------- */
  function renderSupplementList() {
    const list = $('#supplement-list');
    const supplements = activeSupplements();
    list.innerHTML = '';
    $('#supplement-empty-state').hidden = supplements.length > 0;
    list.hidden = supplements.length === 0;
    const ds = todayStr();

    supplements.forEach(supp => {
      const li = document.createElement('li');
      li.className = 'supplement-card';
      li.style.setProperty('--habit-color', habitColorVar(supp));

      const top = document.createElement('div');
      top.className = 'supplement-top';

      const icon = document.createElement('div');
      icon.className = 'habit-icon';
      icon.textContent = supp.emoji || '💊';
      icon.addEventListener('click', () => openSupplementDetail(supp.id));

      const main = document.createElement('div');
      main.className = 'habit-main';
      main.addEventListener('click', () => openSupplementDetail(supp.id));

      const name = document.createElement('p');
      name.className = 'habit-name';
      name.textContent = supp.name;

      const meta = document.createElement('p');
      meta.className = 'habit-meta';
      const doseText = supp.dose ? `${supp.dose}${supp.unit ? ' ' + supp.unit : ''}` : (supp.unit || '');
      const streak = supplementStreak(supp);
      const metaParts = [];
      if (doseText) metaParts.push(doseText);
      metaParts.push(streak > 0 ? `🔥 ${streak}d streak` : 'No streak yet');
      meta.textContent = metaParts.join(' · ');
      main.append(name, meta);

      top.append(icon, main, buildReorderButtons(state.supplements, supplements, supplements.indexOf(supp), renderSupplementList));

      const slotRow = document.createElement('div');
      slotRow.className = 'slot-row';
      supplementSlots(supp).forEach(slotKey => {
        const slotDef = TIME_SLOTS.find(t => t.key === slotKey);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'slot-chip' + (isSlotTaken(supp, ds, slotKey) ? ' taken' : '');
        chip.textContent = slotDef ? slotDef.label : slotKey;
        chip.addEventListener('click', () => { toggleSupplementSlot(supp, ds, slotKey); saveState(); renderSupplementList(); renderReview(); });
        slotRow.appendChild(chip);
      });

      li.append(top, slotRow);

      if (supp.stockEnabled) {
        const daysLeft = supplementDaysRemaining(supp);
        const stockLine = document.createElement('p');
        stockLine.className = 'stock-line' + (daysLeft !== null && daysLeft <= STOCK_LOW_DAYS ? ' low' : '');
        stockLine.textContent = `${supp.stockRemaining || 0} dose${supp.stockRemaining === 1 ? '' : 's'} left · ~${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
        li.appendChild(stockLine);
      }

      list.appendChild(li);
    });
  }

  /* ---------------- rendering: review ---------------- */
  function buildReviewRow(item, valueText, pct, statusInfo) {
    const row = document.createElement('div');
    row.className = 'review-row';
    row.style.setProperty('--habit-color', habitColorVar(item));

    const icon = document.createElement('div');
    icon.className = 'habit-icon';
    icon.textContent = item.emoji || '✅';

    const main = document.createElement('div');
    main.className = 'review-row-main';

    const top = document.createElement('div');
    top.className = 'review-row-top';
    const name = document.createElement('span');
    name.className = 'habit-name';
    name.textContent = item.name;
    top.appendChild(name);

    if (statusInfo) {
      const badge = document.createElement('span');
      badge.className = `status-badge status-${statusInfo.cls}`;
      badge.textContent = `${statusInfo.status} · ${statusInfo.value}/${statusInfo.target}`;
      top.appendChild(badge);
    } else {
      const value = document.createElement('span');
      value.className = 'review-row-value';
      value.textContent = valueText;
      top.appendChild(value);
    }

    const track = document.createElement('div');
    track.className = 'meter-track';
    const fill = document.createElement('div');
    fill.className = 'meter-fill';
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    track.appendChild(fill);

    main.append(top, track);
    row.append(icon, main);
    return row;
  }

  function renderReview() {
    const { start, end, label } = reviewRange(reviewPeriod);
    $('#review-range-label').textContent = label;

    const habits = activeHabits();
    const supplements = activeSupplements();
    const yearlyList = activeYearlyHabits();

    const habitRows = habits.map(h => ({ habit: h, stats: habitReviewStats(h, start, end) }));
    let habitScheduled = 0, habitDone = 0;
    habitRows.forEach(r => { habitScheduled += r.stats.scheduled; habitDone += r.stats.done; });
    const habitPct = habitScheduled ? Math.round((habitDone / habitScheduled) * 100) : null;

    const supplementRows = supplements.map(s => ({ supp: s, stats: supplementReviewStats(s, start, end) }));
    const supplementPct = supplementRows.length
      ? Math.round(supplementRows.reduce((sum, r) => sum + r.stats.pct, 0) / supplementRows.length)
      : null;

    const yearlyRows = yearlyList.map(h => ({ habit: h, status: yearlyPaceStatus(h) }));
    const onPaceCount = yearlyRows.filter(r => r.status.cls === 'good').length;

    const stats = $('#review-stats');
    stats.innerHTML = '';
    [
      ['Habits', habitPct === null ? '—' : `${habitPct}%`],
      ['Supplements', supplementPct === null ? '—' : `${supplementPct}%`],
      ['Yearly goals', yearlyRows.length ? `${onPaceCount}/${yearlyRows.length} on pace` : '—']
    ].forEach(([label, value]) => {
      const div = document.createElement('div');
      div.className = 'detail-stat';
      div.innerHTML = `<p class="stat-label">${label}</p><p class="stat-value">${value}</p>`;
      stats.appendChild(div);
    });

    $('#review-habits-group').hidden = habitRows.length === 0;
    const habitsList = $('#review-habits-list');
    habitsList.innerHTML = '';
    habitRows.forEach(({ habit, stats: s }) => {
      habitsList.appendChild(buildReviewRow(habit, `${s.done}/${s.scheduled} days`, s.pct));
    });

    $('#review-supplements-group').hidden = supplementRows.length === 0;
    const suppList = $('#review-supplements-list');
    suppList.innerHTML = '';
    supplementRows.forEach(({ supp, stats: s }) => {
      suppList.appendChild(buildReviewRow(supp, `${s.pct}% adherence`, s.pct));
    });

    $('#review-yearly-group').hidden = yearlyRows.length === 0;
    const yearlyListEl = $('#review-yearly-list');
    yearlyListEl.innerHTML = '';
    yearlyRows.forEach(({ habit, status }) => {
      yearlyListEl.appendChild(buildReviewRow(habit, null, status.pct, status));
    });

    $('#review-empty-state').hidden = (habits.length + supplements.length + yearlyList.length) > 0;
  }

  function reviewSummaryText() {
    const { start, end, label } = reviewRange(reviewPeriod);
    const periodName = reviewPeriod === 'week' ? 'Weekly' : 'Monthly';
    const lines = [`${periodName} review — ${label}`, ''];

    const habits = activeHabits();
    if (habits.length) {
      lines.push('Daily habits:');
      habits.forEach(h => {
        const s = habitReviewStats(h, start, end);
        lines.push(`  ${h.emoji || ''} ${h.name} — ${s.done}/${s.scheduled} days (${s.pct}%)`);
      });
      lines.push('');
    }

    const supplements = activeSupplements();
    if (supplements.length) {
      lines.push('Supplements:');
      supplements.forEach(s => {
        const stat = supplementReviewStats(s, start, end);
        lines.push(`  ${s.emoji || ''} ${s.name} — ${stat.pct}% adherence`);
      });
      lines.push('');
    }

    const yearlyList = activeYearlyHabits();
    if (yearlyList.length) {
      lines.push('Yearly goals:');
      yearlyList.forEach(h => {
        const status = yearlyPaceStatus(h);
        lines.push(`  ${h.emoji || ''} ${h.name} — ${status.value}/${status.target} (${status.status})`);
      });
    }

    return lines.join('\n').trim();
  }

  function syncReviewPeriodButtons() {
    $('#review-period-segmented').querySelectorAll('.segmented-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.period === reviewPeriod);
    });
  }
  $('#review-period-segmented').querySelectorAll('.segmented-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      reviewPeriod = btn.dataset.period;
      syncReviewPeriodButtons();
      renderReview();
    });
  });
  $('#review-share-btn').addEventListener('click', () => {
    shareText(reviewPeriod === 'week' ? 'Weekly review' : 'Monthly review', reviewSummaryText());
  });

  function renderAll() {
    renderStats();
    renderReview();
    renderOverviewHeatmap();
    renderHabitList();
    renderYearlyList();
    renderSupplementList();
  }

  /* ---------------- sheets ---------------- */
  function openSheet(id) { $(`#${id}-backdrop`).hidden = false; document.body.style.overflow = 'hidden'; }
  function closeSheet(id) { $(`#${id}-backdrop`).hidden = true; document.body.style.overflow = ''; }

  document.querySelectorAll('.sheet-close').forEach(btn => {
    btn.addEventListener('click', () => closeSheet(btn.dataset.close));
  });
  document.querySelectorAll('.sheet-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.hidden = true, document.body.style.overflow = ''; });
  });

  /* ---------------- habit form (add / edit) ---------------- */
  let editingHabitId = null;
  let formEmoji = EMOJI_PRESETS[0];
  let formColor = 1;
  let formDays = [0,1,2,3,4,5,6];
  let formType = 'check';

  function buildEmojiRow() {
    const row = $('#emoji-row');
    row.innerHTML = '';
    EMOJI_PRESETS.forEach(e => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-choice' + (e === formEmoji ? ' selected' : '');
      btn.textContent = e;
      btn.addEventListener('click', () => { formEmoji = e; buildEmojiRow(); });
      row.appendChild(btn);
    });
  }
  function buildColorRow() {
    const row = $('#color-row');
    row.innerHTML = '';
    COLOR_SLOTS.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-choice' + (c === formColor ? ' selected' : '');
      btn.style.setProperty('--swatch-color', `var(--series-${c})`);
      btn.setAttribute('aria-label', `Color ${c}`);
      btn.addEventListener('click', () => { formColor = c; buildColorRow(); });
      row.appendChild(btn);
    });
  }
  function buildDayRow() {
    const row = $('#day-row');
    row.innerHTML = '';
    DAY_LABELS.forEach((label, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-choice' + (formDays.includes(i) ? ' selected' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        if (formDays.includes(i)) formDays = formDays.filter(d => d !== i);
        else formDays = [...formDays, i].sort();
        buildDayRow();
      });
      row.appendChild(btn);
    });
  }
  function setFormType(type) {
    formType = type;
    $('#type-segmented').querySelectorAll('.segmented-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.typeChoice === type);
    });
    $('#target-row').hidden = type !== 'count';
  }
  $('#type-segmented').querySelectorAll('.segmented-btn').forEach(btn => {
    btn.addEventListener('click', () => setFormType(btn.dataset.typeChoice));
  });

  function resetForm() {
    editingHabitId = null;
    formEmoji = EMOJI_PRESETS[0];
    formColor = COLOR_SLOTS[state.habits.length % COLOR_SLOTS.length];
    formDays = [0,1,2,3,4,5,6];
    $('#habit-name').value = '';
    $('#habit-target').value = '';
    $('#habit-unit').value = '';
    $('#habit-id').value = '';
    $('#delete-habit-btn').hidden = true;
    $('#habit-active-row').hidden = true;
    $('#habit-active').checked = true;
    $('#habit-sheet-title').textContent = 'Add habit';
    setFormType('check');
    buildEmojiRow(); buildColorRow(); buildDayRow();
  }

  function openAddHabit() { resetForm(); openSheet('habit-sheet'); $('#habit-name').focus(); }

  function openEditHabit(habit) {
    editingHabitId = habit.id;
    formEmoji = habit.emoji;
    formColor = habit.color;
    formDays = [...habit.days];
    $('#habit-name').value = habit.name;
    $('#habit-target').value = habit.target || '';
    $('#habit-unit').value = habit.unit || '';
    $('#habit-id').value = habit.id;
    $('#delete-habit-btn').hidden = false;
    $('#habit-active-row').hidden = false;
    $('#habit-active').checked = !habit.archived;
    $('#habit-sheet-title').textContent = 'Edit habit';
    setFormType(habit.type);
    buildEmojiRow(); buildColorRow(); buildDayRow();
    openSheet('habit-sheet');
  }

  $('#habit-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#habit-name').value.trim();
    if (!name) return;
    if (formDays.length === 0) { showToast('Pick at least one day'); return; }
    const target = Math.max(1, parseInt($('#habit-target').value, 10) || 1);
    const unit = $('#habit-unit').value.trim() || (formType === 'count' ? 'times' : '');

    if (editingHabitId) {
      const h = state.habits.find(h => h.id === editingHabitId);
      Object.assign(h, { name, emoji: formEmoji, color: formColor, days: [...formDays], type: formType, target, unit, archived: !$('#habit-active').checked });
    } else {
      state.habits.push({
        id: 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name, emoji: formEmoji, color: formColor, days: [...formDays],
        type: formType, target, unit,
        createdAt: todayStr(), archived: false
      });
    }
    saveState();
    closeSheet('habit-sheet');
    renderAll();
  });

  $('#delete-habit-btn').addEventListener('click', () => {
    if (!editingHabitId) return;
    if (!confirm('Delete this habit and all of its history?')) return;
    state.habits = state.habits.filter(h => h.id !== editingHabitId);
    delete state.logs[editingHabitId];
    saveState();
    closeSheet('habit-sheet');
    renderAll();
  });

  $('#add-habit-btn').addEventListener('click', openAddHabit);
  $('#empty-add-btn').addEventListener('click', openAddHabit);

  /* ---------------- yearly goal form (add / edit) ---------------- */
  let editingYearlyId = null;
  let yearlyFormEmoji = '🎯';
  let yearlyFormColor = 1;

  function buildYearlyEmojiRow() {
    const row = $('#yearly-emoji-row');
    row.innerHTML = '';
    EMOJI_PRESETS.forEach(e => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-choice' + (e === yearlyFormEmoji ? ' selected' : '');
      btn.textContent = e;
      btn.addEventListener('click', () => { yearlyFormEmoji = e; buildYearlyEmojiRow(); });
      row.appendChild(btn);
    });
  }
  function buildYearlyColorRow() {
    const row = $('#yearly-color-row');
    row.innerHTML = '';
    COLOR_SLOTS.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-choice' + (c === yearlyFormColor ? ' selected' : '');
      btn.style.setProperty('--swatch-color', `var(--series-${c})`);
      btn.setAttribute('aria-label', `Color ${c}`);
      btn.addEventListener('click', () => { yearlyFormColor = c; buildYearlyColorRow(); });
      row.appendChild(btn);
    });
  }

  function resetYearlyForm() {
    editingYearlyId = null;
    yearlyFormEmoji = '🎯';
    yearlyFormColor = COLOR_SLOTS[state.yearlyHabits.length % COLOR_SLOTS.length];
    $('#yearly-name').value = '';
    $('#yearly-target').value = '';
    $('#yearly-unit').value = '';
    $('#yearly-id').value = '';
    $('#delete-yearly-btn').hidden = true;
    $('#yearly-active-row').hidden = true;
    $('#yearly-active').checked = true;
    $('#yearly-form-sheet-title').textContent = 'Add yearly goal';
    buildYearlyEmojiRow(); buildYearlyColorRow();
  }

  function openAddYearly() { resetYearlyForm(); openSheet('yearly-form-sheet'); $('#yearly-name').focus(); }

  function openEditYearly(habit) {
    editingYearlyId = habit.id;
    yearlyFormEmoji = habit.emoji;
    yearlyFormColor = habit.color;
    $('#yearly-name').value = habit.name;
    $('#yearly-target').value = habit.target || '';
    $('#yearly-unit').value = habit.unit || '';
    $('#yearly-id').value = habit.id;
    $('#delete-yearly-btn').hidden = false;
    $('#yearly-active-row').hidden = false;
    $('#yearly-active').checked = !habit.archived;
    $('#yearly-form-sheet-title').textContent = 'Edit yearly goal';
    buildYearlyEmojiRow(); buildYearlyColorRow();
    openSheet('yearly-form-sheet');
  }

  $('#yearly-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#yearly-name').value.trim();
    if (!name) return;
    const target = Math.max(1, parseInt($('#yearly-target').value, 10) || 1);
    const unit = $('#yearly-unit').value.trim();

    if (editingYearlyId) {
      const h = state.yearlyHabits.find(h => h.id === editingYearlyId);
      Object.assign(h, { name, emoji: yearlyFormEmoji, color: yearlyFormColor, target, unit, archived: !$('#yearly-active').checked });
    } else {
      state.yearlyHabits.push({
        id: 'y_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name, emoji: yearlyFormEmoji, color: yearlyFormColor, target, unit,
        createdAt: todayStr(), archived: false
      });
    }
    saveState();
    closeSheet('yearly-form-sheet');
    renderYearlyList();
    renderReview();
  });

  $('#delete-yearly-btn').addEventListener('click', () => {
    if (!editingYearlyId) return;
    if (!confirm('Delete this yearly goal and all of its history?')) return;
    state.yearlyHabits = state.yearlyHabits.filter(h => h.id !== editingYearlyId);
    delete state.yearlyLogs[editingYearlyId];
    saveState();
    closeSheet('yearly-form-sheet');
    renderYearlyList();
    renderReview();
  });

  $('#add-yearly-btn').addEventListener('click', openAddYearly);
  $('#yearly-empty-add-btn').addEventListener('click', openAddYearly);

  /* ---------------- yearly goal detail sheet ---------------- */
  let detailYearlyId = null;

  function openYearlyDetail(id) {
    detailYearlyId = id;
    renderYearlyDetail();
    openSheet('yearly-detail-sheet');
  }

  function renderYearlyDetail() {
    const habit = state.yearlyHabits.find(h => h.id === detailYearlyId);
    if (!habit) return;
    const year = currentYear();
    const value = getYearlyValue(habit, year);
    const target = habit.target || 1;
    const pct = Math.min(100, Math.round((value / target) * 100));

    $('#yearly-detail-sheet-title').textContent = `${habit.emoji} ${habit.name}`;

    const stats = $('#yearly-detail-stats');
    stats.innerHTML = '';
    [['This year', `${value}/${target}`], ['Progress', `${pct}%`], ['Remaining', String(Math.max(0, target - value))]]
      .forEach(([label, val]) => {
        const div = document.createElement('div');
        div.className = 'detail-stat';
        div.innerHTML = `<p class="stat-label">${label}</p><p class="stat-value">${val}</p>`;
        stats.appendChild(div);
      });

    $('#yearly-detail-meter').style.setProperty('--habit-color', habitColorVar(habit));
    $('#yearly-detail-fill').style.width = `${pct}%`;

    $('#yearly-value-input').value = value;

    const history = $('#yearly-history');
    history.innerHTML = '';
    const bucket = state.yearlyLogs[habit.id] || {};
    const years = Object.keys(bucket).filter(y => y !== year).sort((a, b) => Number(b) - Number(a));
    if (years.length === 0) {
      history.innerHTML = '<p class="field-hint">No history from previous years yet.</p>';
    } else {
      years.forEach(y => {
        const row = document.createElement('div');
        row.className = 'yearly-history-row';
        row.innerHTML = `<span>${y}</span><span>${bucket[y]} / ${target}${habit.unit ? ' ' + habit.unit : ''}</span>`;
        history.appendChild(row);
      });
    }
  }

  $('#yearly-value-save').addEventListener('click', () => {
    const habit = state.yearlyHabits.find(h => h.id === detailYearlyId);
    if (!habit) return;
    setYearlyValue(habit, currentYear(), $('#yearly-value-input').value);
    saveState();
    renderYearlyDetail();
    renderYearlyList();
    renderReview();
    showToast('Saved');
  });

  $('#yearly-edit-btn').addEventListener('click', () => {
    const habit = state.yearlyHabits.find(h => h.id === detailYearlyId);
    closeSheet('yearly-detail-sheet');
    openEditYearly(habit);
  });

  /* ---------------- supplement form (add / edit) ---------------- */
  let editingSupplementId = null;
  let supplementFormEmoji = '💊';
  let supplementFormColor = 1;
  let supplementFormTimes = ['morning'];

  function buildSupplementEmojiRow() {
    const row = $('#supplement-emoji-row');
    row.innerHTML = '';
    EMOJI_PRESETS.forEach(e => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-choice' + (e === supplementFormEmoji ? ' selected' : '');
      btn.textContent = e;
      btn.addEventListener('click', () => { supplementFormEmoji = e; buildSupplementEmojiRow(); });
      row.appendChild(btn);
    });
  }
  function buildSupplementColorRow() {
    const row = $('#supplement-color-row');
    row.innerHTML = '';
    COLOR_SLOTS.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-choice' + (c === supplementFormColor ? ' selected' : '');
      btn.style.setProperty('--swatch-color', `var(--series-${c})`);
      btn.setAttribute('aria-label', `Color ${c}`);
      btn.addEventListener('click', () => { supplementFormColor = c; buildSupplementColorRow(); });
      row.appendChild(btn);
    });
  }
  function buildSupplementTimeRow() {
    const row = $('#supplement-time-row');
    row.innerHTML = '';
    TIME_SLOTS.forEach(slot => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-choice wide' + (supplementFormTimes.includes(slot.key) ? ' selected' : '');
      btn.textContent = slot.label;
      btn.addEventListener('click', () => {
        if (supplementFormTimes.includes(slot.key)) supplementFormTimes = supplementFormTimes.filter(k => k !== slot.key);
        else supplementFormTimes = [...supplementFormTimes, slot.key];
        buildSupplementTimeRow();
      });
      row.appendChild(btn);
    });
  }

  $('#supplement-stock-enabled').addEventListener('change', e => {
    $('#supplement-stock-row').hidden = !e.target.checked;
  });

  function resetSupplementForm() {
    editingSupplementId = null;
    supplementFormEmoji = '💊';
    supplementFormColor = COLOR_SLOTS[state.supplements.length % COLOR_SLOTS.length];
    supplementFormTimes = ['morning'];
    $('#supplement-name').value = '';
    $('#supplement-dose').value = '';
    $('#supplement-unit').value = '';
    $('#supplement-stock-enabled').checked = false;
    $('#supplement-stock-row').hidden = true;
    $('#supplement-stock-count').value = '';
    $('#supplement-id').value = '';
    $('#delete-supplement-btn').hidden = true;
    $('#supplement-active-row').hidden = true;
    $('#supplement-active').checked = true;
    $('#supplement-form-sheet-title').textContent = 'Add supplement';
    buildSupplementEmojiRow(); buildSupplementColorRow(); buildSupplementTimeRow();
  }

  function openAddSupplement() { resetSupplementForm(); openSheet('supplement-form-sheet'); $('#supplement-name').focus(); }

  function openEditSupplement(supp) {
    editingSupplementId = supp.id;
    supplementFormEmoji = supp.emoji;
    supplementFormColor = supp.color;
    supplementFormTimes = [...supplementSlots(supp)];
    $('#supplement-name').value = supp.name;
    $('#supplement-dose').value = supp.dose || '';
    $('#supplement-unit').value = supp.unit || '';
    $('#supplement-stock-enabled').checked = !!supp.stockEnabled;
    $('#supplement-stock-row').hidden = !supp.stockEnabled;
    $('#supplement-stock-count').value = supp.stockEnabled ? (supp.stockRemaining || 0) : '';
    $('#supplement-id').value = supp.id;
    $('#delete-supplement-btn').hidden = false;
    $('#supplement-active-row').hidden = false;
    $('#supplement-active').checked = !supp.archived;
    $('#supplement-form-sheet-title').textContent = 'Edit supplement';
    buildSupplementEmojiRow(); buildSupplementColorRow(); buildSupplementTimeRow();
    openSheet('supplement-form-sheet');
  }

  $('#supplement-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#supplement-name').value.trim();
    if (!name) return;
    if (supplementFormTimes.length === 0) { showToast('Pick at least one time of day'); return; }
    const dose = $('#supplement-dose').value === '' ? null : Number($('#supplement-dose').value);
    const unit = $('#supplement-unit').value.trim();
    const stockEnabled = $('#supplement-stock-enabled').checked;
    const stockRemaining = stockEnabled ? Math.max(0, parseInt($('#supplement-stock-count').value, 10) || 0) : 0;

    if (editingSupplementId) {
      const s = state.supplements.find(s => s.id === editingSupplementId);
      Object.assign(s, { name, emoji: supplementFormEmoji, color: supplementFormColor, dose, unit, times: [...supplementFormTimes], stockEnabled, archived: !$('#supplement-active').checked });
      if (stockEnabled) s.stockRemaining = stockRemaining;
    } else {
      const supp = {
        id: 'sp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name, emoji: supplementFormEmoji, color: supplementFormColor, dose, unit,
        times: [...supplementFormTimes], stockEnabled,
        createdAt: todayStr(), archived: false
      };
      if (stockEnabled) supp.stockRemaining = stockRemaining;
      state.supplements.push(supp);
    }
    saveState();
    closeSheet('supplement-form-sheet');
    renderSupplementList();
    renderReview();
  });

  $('#delete-supplement-btn').addEventListener('click', () => {
    if (!editingSupplementId) return;
    if (!confirm('Delete this supplement and all of its history?')) return;
    state.supplements = state.supplements.filter(s => s.id !== editingSupplementId);
    delete state.supplementLogs[editingSupplementId];
    saveState();
    closeSheet('supplement-form-sheet');
    renderSupplementList();
    renderReview();
  });

  $('#add-supplement-btn').addEventListener('click', openAddSupplement);
  $('#supplement-empty-add-btn').addEventListener('click', openAddSupplement);

  /* ---------------- supplement detail sheet ---------------- */
  let detailSupplementId = null;
  let selectedSupplementDate = null;
  const WEEKS_SUPPLEMENT = 20;

  function openSupplementDetail(id) {
    detailSupplementId = id;
    selectedSupplementDate = null;
    $('#supplement-day-editor').hidden = true;
    renderSupplementDetail();
    openSheet('supplement-detail-sheet');
  }

  function renderSupplementDetail() {
    const supp = state.supplements.find(s => s.id === detailSupplementId);
    if (!supp) return;
    $('#supplement-detail-sheet-title').textContent = `${supp.emoji || '💊'} ${supp.name}`;

    const streak = supplementStreak(supp);
    const bucket = state.supplementLogs[supp.id] || {};
    const totalDoses = Object.values(bucket).reduce((sum, arr) => sum + arr.length, 0);
    let sum7 = 0;
    for (let i = 0; i < 7; i++) sum7 += supplementAdherencePct(supp, fmt(addDays(todayDate(), -i)));
    const adherence7 = Math.round(sum7 / 7);

    const stats = $('#supplement-detail-stats');
    stats.innerHTML = '';
    [['Current streak', streak ? streak + 'd' : '—'], ['7-day adherence', `${adherence7}%`], ['Doses logged', String(totalDoses)]]
      .forEach(([label, value]) => {
        const div = document.createElement('div');
        div.className = 'detail-stat';
        div.innerHTML = `<p class="stat-label">${label}</p><p class="stat-value">${value}</p>`;
        stats.appendChild(div);
      });

    const stockPanel = $('#supplement-stock-panel');
    if (supp.stockEnabled) {
      stockPanel.hidden = false;
      $('#supplement-stock-value').textContent = String(supp.stockRemaining || 0);
      const daysLeft = supplementDaysRemaining(supp);
      $('#supplement-stock-estimate').textContent = `About ${daysLeft} day${daysLeft === 1 ? '' : 's'} left at your current schedule`;
    } else {
      stockPanel.hidden = true;
    }

    const container = $('#supplement-heatmap');
    container.innerHTML = '';
    container.style.setProperty('--habit-color', habitColorVar(supp));
    const today = todayDate();
    const end = startOfWeek(today);
    const totalDays = WEEKS_SUPPLEMENT * 7;
    const start = addDays(end, -(totalDays - 7));

    for (let d = new Date(start); d < addDays(end, 7); d = addDays(d, 1)) {
      const ds = fmt(d);
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      if (d > today) {
        cell.classList.add('future');
      } else {
        const pct = supplementAdherencePct(supp, ds) / 100;
        if (pct >= 1) cell.style.background = habitColorVar(supp);
        else if (pct > 0) cell.style.background = `color-mix(in srgb, ${habitColorVar(supp)} ${Math.round(pct * 70) + 15}%, var(--surface-2))`;
        if (ds === todayStr()) cell.classList.add('today');
        if (ds === selectedSupplementDate) cell.classList.add('selected');
        cell.classList.add('clickable');
        const taken = getTakenSlots(supp, ds);
        const label = taken.length ? taken.map(k => (TIME_SLOTS.find(t => t.key === k) || {}).label || k).join(', ') : 'None taken';
        cell.title = `${humanDate(ds)} · ${label}`;
        cell.addEventListener('click', () => openSupplementDayEditor(supp, ds));
      }
      container.appendChild(cell);
    }
    requestAnimationFrame(() => {
      const scroller = container.parentElement;
      scroller.scrollLeft = scroller.scrollWidth;
    });
  }

  function openSupplementDayEditor(supp, ds) {
    selectedSupplementDate = ds;
    renderSupplementDetail();
    $('#supplement-day-editor').hidden = false;
    $('#supplement-day-editor-date').textContent = humanDate(ds);
    const row = $('#supplement-day-editor-slots');
    row.innerHTML = '';
    supplementSlots(supp).forEach(slotKey => {
      const slotDef = TIME_SLOTS.find(t => t.key === slotKey);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-choice wide' + (isSlotTaken(supp, ds, slotKey) ? ' selected' : '');
      btn.textContent = slotDef ? slotDef.label : slotKey;
      btn.addEventListener('click', () => {
        toggleSupplementSlot(supp, ds, slotKey);
        saveState();
        openSupplementDayEditor(supp, ds);
        renderSupplementList();
        renderReview();
      });
      row.appendChild(btn);
    });
  }
  $('#supplement-day-editor-close').addEventListener('click', () => {
    $('#supplement-day-editor').hidden = true;
    selectedSupplementDate = null;
    renderSupplementDetail();
  });

  $('#supplement-stock-add-btn').addEventListener('click', () => {
    const supp = state.supplements.find(s => s.id === detailSupplementId);
    if (!supp) return;
    const add = parseInt($('#supplement-stock-add').value, 10);
    if (!add || add <= 0) { showToast('Enter how many doses you added'); return; }
    supp.stockRemaining = (supp.stockRemaining || 0) + add;
    $('#supplement-stock-add').value = '';
    saveState();
    renderSupplementDetail();
    renderSupplementList();
    showToast('Stock updated');
  });

  $('#supplement-edit-btn').addEventListener('click', () => {
    const supp = state.supplements.find(s => s.id === detailSupplementId);
    closeSheet('supplement-detail-sheet');
    openEditSupplement(supp);
  });

  /* ---------------- detail sheet ---------------- */
  let detailHabitId = null;
  let selectedDetailDate = null;

  function openDetail(habitId) {
    detailHabitId = habitId;
    selectedDetailDate = null;
    $('#day-editor').hidden = true;
    const habit = state.habits.find(h => h.id === habitId);
    $('#detail-sheet-title').textContent = `${habit.emoji} ${habit.name}`;
    $('#backfill-value-row').hidden = habit.type !== 'count';
    $('#backfill-end').value = todayStr();
    $('#backfill-start').value = todayStr();
    renderDetail();
    openSheet('detail-sheet');
  }

  function renderDetail() {
    const habit = state.habits.find(h => h.id === detailHabitId);
    if (!habit) return;

    const stats = $('#detail-stats');
    stats.innerHTML = '';
    const cur = currentStreak(habit);
    const best = longestStreak(habit);
    let totalDone = 0;
    const bucket = state.logs[habit.id] || {};
    if (habit.type === 'count') totalDone = Object.values(bucket).filter(v => Number(v) >= (habit.target||1)).length;
    else totalDone = Object.keys(bucket).length;

    [['Current streak', cur ? cur + 'd' : '—'], ['Best streak', best ? best + 'd' : '—'], ['Total logged', String(totalDone)]]
      .forEach(([label, value]) => {
        const div = document.createElement('div');
        div.className = 'detail-stat';
        div.innerHTML = `<p class="stat-label">${label}</p><p class="stat-value">${value}</p>`;
        stats.appendChild(div);
      });

    renderDetailTrend(habit);

    const container = $('#detail-heatmap');
    container.innerHTML = '';
    container.style.setProperty('--habit-color', habitColorVar(habit));
    const today = todayDate();
    const end = startOfWeek(today);
    const totalDays = WEEKS_DETAIL * 7;
    const start = addDays(end, -(totalDays - 7));

    for (let d = new Date(start); d < addDays(end, 7); d = addDays(d, 1)) {
      const ds = fmt(d);
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      if (d > today) {
        cell.classList.add('future');
      } else {
        const ratio = progressRatio(habit, ds);
        if (ratio >= 1) cell.style.background = habitColorVar(habit);
        else if (ratio > 0) cell.style.background = `color-mix(in srgb, ${habitColorVar(habit)} ${Math.round(ratio * 70) + 15}%, var(--surface-2))`;
        if (ds === todayStr()) cell.classList.add('today');
        if (ds === selectedDetailDate) cell.classList.add('selected');
        cell.classList.add('clickable');
        const raw = getRaw(habit, ds);
        const label = habit.type === 'count' ? `${Number(raw)||0}${habit.unit ? ' ' + habit.unit : ''}` : (raw ? 'Done' : 'Not done');
        cell.title = `${humanDate(ds)} · ${label}`;
        cell.addEventListener('click', () => openDayEditor(habit, ds));
      }
      container.appendChild(cell);
    }
    requestAnimationFrame(() => {
      const scroller = container.parentElement;
      scroller.scrollLeft = scroller.scrollWidth;
    });
  }

  function renderDetailTrend(habit) {
    const container = $('#detail-trend');
    const legend = $('#trend-legend');
    container.innerHTML = '';
    legend.textContent = '';
    const usableHeight = 88;

    if (habit.type === 'check') {
      $('#trend-title').textContent = 'Weekly completion';
      const weeks = computeWeeklyCompletion(habit, 12);
      const thisWeek = fmt(startOfWeek(todayDate()));
      weeks.forEach(w => {
        const col = document.createElement('div');
        col.className = 'trend-bar-col';
        const bar = document.createElement('div');
        bar.className = 'trend-bar';
        const pct = w.pct === null ? 0 : w.pct;
        bar.style.height = `${Math.max(2, Math.round((pct / 100) * usableHeight))}px`;
        if (w.pct !== null && w.pct > 0) bar.style.background = habitColorVar(habit);
        if (w.weekStart === thisWeek) bar.classList.add('today');
        bar.title = w.scheduled
          ? `Week of ${humanDate(w.weekStart)} · ${w.pct}% (${w.done}/${w.scheduled})`
          : `Week of ${humanDate(w.weekStart)} · no scheduled days`;
        col.appendChild(bar);
        container.appendChild(col);
      });
    } else {
      $('#trend-title').textContent = `Daily ${habit.unit || 'amount'}`;
      const days = computeDailyValues(habit, 21);
      const target = habit.target || 1;
      const maxVal = Math.max(target, ...days.map(d => d.value), 1);
      days.forEach(d => {
        const col = document.createElement('div');
        col.className = 'trend-bar-col';
        const bar = document.createElement('div');
        bar.className = 'trend-bar';
        const heightPct = d.value / maxVal;
        bar.style.height = `${Math.max(2, Math.round(heightPct * usableHeight))}px`;
        const ratio = d.value / target;
        if (d.value > 0) {
          bar.style.background = ratio >= 1
            ? habitColorVar(habit)
            : `color-mix(in srgb, ${habitColorVar(habit)} ${Math.round(Math.min(1, ratio) * 70) + 15}%, var(--surface-2))`;
        }
        if (d.ds === todayStr()) bar.classList.add('today');
        bar.title = `${humanDate(d.ds)} · ${d.value}${habit.unit ? ' ' + habit.unit : ''} of ${target}`;
        col.appendChild(bar);
        container.appendChild(col);
      });
      const line = document.createElement('div');
      line.className = 'trend-target-line';
      line.style.bottom = `${Math.round(Math.min(1, target / maxVal) * usableHeight) + 1}px`;
      container.appendChild(line);
      legend.textContent = `Target: ${target}${habit.unit ? ' ' + habit.unit : ''}`;
    }

    requestAnimationFrame(() => {
      const scroller = container.parentElement;
      scroller.scrollLeft = scroller.scrollWidth;
    });
  }

  function openDayEditor(habit, ds) {
    selectedDetailDate = ds;
    renderDetail();
    $('#day-editor').hidden = false;
    $('#day-editor-date').textContent = humanDate(ds);
    const isCheck = habit.type === 'check';
    $('#day-editor-check').hidden = !isCheck;
    $('#day-editor-count').hidden = isCheck;
    if (isCheck) {
      $('#day-editor-mark-done').onclick = () => { setValue(habit, ds, true); saveState(); renderDetail(); renderAll(); };
      $('#day-editor-mark-undone').onclick = () => { setValue(habit, ds, false); saveState(); renderDetail(); renderAll(); };
    } else {
      $('#day-editor-value').value = Number(getRaw(habit, ds)) || '';
      $('#day-editor-unit').textContent = habit.unit || '';
      $('#day-editor-save').onclick = () => {
        setValue(habit, ds, $('#day-editor-value').value);
        saveState(); renderDetail(); renderAll();
      };
    }
    const noteInput = $('#day-editor-note');
    noteInput.value = getHabitNote(habit.id, ds);
    const flushNote = debounce(() => { setHabitNote(habit.id, ds, noteInput.value); saveState(); }, 400);
    noteInput.oninput = flushNote;
    noteInput.onblur = () => { setHabitNote(habit.id, ds, noteInput.value); saveState(); };
  }
  $('#day-editor-close').addEventListener('click', () => { $('#day-editor').hidden = true; selectedDetailDate = null; renderDetail(); });

  $('#detail-edit-btn').addEventListener('click', () => {
    const habit = state.habits.find(h => h.id === detailHabitId);
    closeSheet('detail-sheet');
    openEditHabit(habit);
  });

  /* ---------------- backfill ---------------- */
  $('#backfill-apply-btn').addEventListener('click', () => {
    const habit = state.habits.find(h => h.id === detailHabitId);
    const start = $('#backfill-start').value, end = $('#backfill-end').value;
    if (!start || !end || start > end) { showToast('Pick a valid date range'); return; }
    if (end > todayStr()) { showToast("Can't log future dates"); return; }
    let touched = 0;
    for (let d = parseLocal(start); d <= parseLocal(end); d = addDays(d, 1)) {
      const ds = fmt(d);
      if (!isScheduled(habit, ds)) continue;
      if (habit.type === 'count') {
        const v = $('#backfill-value').value;
        setValue(habit, ds, v === '' ? habit.target : v);
      } else {
        setValue(habit, ds, true);
      }
      touched++;
    }
    saveState(); renderDetail(); renderAll();
    showToast(`Logged ${touched} day${touched === 1 ? '' : 's'}`);
  });
  $('#backfill-clear-btn').addEventListener('click', () => {
    const habit = state.habits.find(h => h.id === detailHabitId);
    const start = $('#backfill-start').value, end = $('#backfill-end').value;
    if (!start || !end || start > end) { showToast('Pick a valid date range'); return; }
    for (let d = parseLocal(start); d <= parseLocal(end); d = addDays(d, 1)) setValue(habit, fmt(d), habit.type === 'count' ? 0 : false);
    saveState(); renderDetail(); renderAll();
    showToast('Range cleared');
  });

  /* ---------------- day sheet (per-date view) ---------------- */
  let currentDaySheetDate = null;

  function openDaySheet(ds) {
    currentDaySheetDate = ds;
    renderDaySheet();
    openSheet('day-sheet');
  }

  function renderDaySheet() {
    const ds = currentDaySheetDate;
    if (!ds) return;
    $('#day-sheet-title').textContent = ds === todayStr() ? 'Today' : humanDate(ds);

    const habits = activeHabits();
    const scheduledHabits = habits.filter(h => isScheduled(h, ds));
    const doneCount = scheduledHabits.filter(h => isDone(h, ds)).length;
    $('#day-sheet-summary').textContent = habits.length
      ? `${doneCount}/${scheduledHabits.length} scheduled habits complete`
      : 'No habits yet — add one to start tracking.';

    const list = $('#day-sheet-habits');
    list.innerHTML = '';
    habits.forEach(habit => {
      const li = document.createElement('li');
      li.className = 'day-habit-card';
      li.style.setProperty('--habit-color', habitColorVar(habit));

      const top = document.createElement('div');
      top.className = 'day-habit-top';

      const icon = document.createElement('div');
      icon.className = 'habit-icon';
      icon.textContent = habit.emoji || '✅';

      const main = document.createElement('div');
      main.className = 'habit-main';
      const name = document.createElement('p');
      name.className = 'habit-name';
      name.textContent = habit.name;
      const meta = document.createElement('p');
      meta.className = 'habit-meta';
      meta.textContent = isScheduled(habit, ds) ? 'Scheduled this day' : 'Not scheduled this day';
      main.append(name, meta);

      const control = document.createElement('div');
      control.className = 'habit-control';
      if (habit.type === 'count') {
        const val = Number(getRaw(habit, ds)) || 0;
        const stepper = document.createElement('div');
        stepper.className = 'stepper';
        const minus = document.createElement('button');
        minus.type = 'button'; minus.className = 'stepper-btn'; minus.textContent = '−';
        minus.addEventListener('click', () => { setValue(habit, ds, Math.max(0, val - 1)); saveState(); renderDaySheet(); renderAll(); });
        const value = document.createElement('span');
        value.className = 'stepper-value';
        value.textContent = `${val}/${habit.target || 1}`;
        const plus = document.createElement('button');
        plus.type = 'button'; plus.className = 'stepper-btn'; plus.textContent = '+';
        plus.addEventListener('click', () => { setValue(habit, ds, val + 1); saveState(); renderDaySheet(); renderAll(); });
        stepper.append(minus, value, plus);
        control.appendChild(stepper);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'check-toggle' + (isDone(habit, ds) ? ' done' : '');
        btn.textContent = '✓';
        btn.setAttribute('aria-label', isDone(habit, ds) ? 'Mark not done' : 'Mark done');
        btn.addEventListener('click', () => { setValue(habit, ds, !isDone(habit, ds)); saveState(); renderDaySheet(); renderAll(); });
        control.appendChild(btn);
      }

      top.append(icon, main, control);

      const noteInput = document.createElement('input');
      noteInput.type = 'text';
      noteInput.className = 'habit-note-input';
      noteInput.placeholder = `Note about ${habit.name}…`;
      noteInput.value = getHabitNote(habit.id, ds);
      wireNoteInput(noteInput, val => { setHabitNote(habit.id, ds, val); saveState(); });

      li.append(top, noteInput);
      list.appendChild(li);
    });

    $('#day-sheet-note').value = getNote(ds);
  }

  wireNoteInput($('#day-sheet-note'), val => {
    if (!currentDaySheetDate) return;
    setNote(currentDaySheetDate, val);
    saveState();
  });

  $('#day-sheet-share-btn').addEventListener('click', () => shareDay(currentDaySheetDate));

  /* ---------------- today's note (dashboard) ---------------- */
  let todayNoteSavedTimer = null;
  function initTodayNote() {
    const ta = $('#today-note-input');
    ta.value = getNote(todayStr());
    ta.addEventListener('input', debounce(() => {
      setNote(todayStr(), ta.value);
      saveState();
      const saved = $('#today-note-saved');
      saved.hidden = false;
      clearTimeout(todayNoteSavedTimer);
      todayNoteSavedTimer = setTimeout(() => { saved.hidden = true; }, 1500);
    }, 400));
  }
  $('#share-today-btn').addEventListener('click', () => shareDay(todayStr()));

  /* ---------------- share a day's summary ---------------- */
  function daySummaryText(ds) {
    const habits = activeHabits().filter(h => isScheduled(h, ds));
    const lines = [`${humanDateLong(ds)} — Keystone summary`, ''];
    let doneCount = 0;
    habits.forEach(h => {
      const done = isDone(h, ds);
      if (done) doneCount++;
      let line = `${done ? (h.emoji || '✅') : '▫️'} ${h.name}`;
      if (h.type === 'count') {
        const v = Number(getRaw(h, ds)) || 0;
        line += ` — ${v}/${h.target}${h.unit ? ' ' + h.unit : ''}`;
      }
      const streak = currentStreak(h, ds);
      line += streak > 0 ? ` · 🔥 ${streak}d streak` : ' · no streak';
      lines.push(line);
      const habitNote = getHabitNote(h.id, ds);
      if (habitNote.trim()) lines.push(`   ↳ ${habitNote.trim()}`);
    });
    if (habits.length) {
      lines.push('');
      lines.push(`${doneCount}/${habits.length} habits complete`);
    } else {
      lines.push('No habits scheduled.');
    }
    const note = getNote(ds);
    if (note.trim()) {
      lines.push('');
      lines.push('Notes:');
      lines.push(note.trim());
    }
    return lines.join('\n');
  }

  async function shareText(title, text) {
    if (navigator.share) {
      try { await navigator.share({ title, text }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        showToast('Copied — paste into your journal');
        return;
      } catch (e) { /* fall through */ }
    }
    showToast("Couldn't share on this device");
  }

  async function shareDay(ds) {
    if (!ds) return;
    await shareText('Keystone summary', daySummaryText(ds));
  }

  /* ---------------- settings ---------------- */
  function renderArchivedList() {
    const container = $('#archived-list');
    container.innerHTML = '';
    const archivedHabits = state.habits.filter(h => h.archived).map(h => ({ item: h, type: 'Habit', restore: () => { h.archived = false; renderAll(); } }));
    const archivedSupplements = state.supplements.filter(s => s.archived).map(s => ({ item: s, type: 'Supplement', restore: () => { s.archived = false; renderAll(); } }));
    const archivedYearly = state.yearlyHabits.filter(h => h.archived).map(h => ({ item: h, type: 'Yearly goal', restore: () => { h.archived = false; renderAll(); } }));
    const all = [...archivedHabits, ...archivedSupplements, ...archivedYearly];

    $('#archived-empty').hidden = all.length > 0;
    all.forEach(({ item, type, restore }) => {
      const row = document.createElement('div');
      row.className = 'yearly-history-row';
      const label = document.createElement('span');
      label.textContent = `${item.emoji || ''} ${item.name} · ${type}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.textContent = 'Restore';
      btn.addEventListener('click', () => {
        restore();
        saveState();
        renderArchivedList();
        showToast(`${item.name} restored`);
      });
      row.append(label, btn);
      container.appendChild(row);
    });
  }

  $('#settings-btn').addEventListener('click', () => { syncThemeButtons(); renderArchivedList(); openSheet('settings-sheet'); });

  function applyTheme(theme) {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }
  function syncThemeButtons() {
    $('#theme-segmented').querySelectorAll('.segmented-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.themeChoice === state.settings.theme);
    });
  }
  $('#theme-segmented').querySelectorAll('.segmented-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.theme = btn.dataset.themeChoice;
      saveState(); applyTheme(state.settings.theme); syncThemeButtons();
    });
  });

  $('#export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `habits-backup-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Backup downloaded');
  });

  $('#import-btn').addEventListener('click', () => $('#import-input').click());
  $('#import-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.habits)) throw new Error('bad format');
      const merge = confirm('Import backup.\n\nOK = merge with current data\nCancel = replace current data entirely');
      if (merge) {
        const existingIds = new Set(state.habits.map(h => h.id));
        parsed.habits.forEach(h => { if (!existingIds.has(h.id)) state.habits.push(h); });
        Object.keys(parsed.logs || {}).forEach(hid => {
          state.logs[hid] = Object.assign(state.logs[hid] || {}, parsed.logs[hid]);
        });
        Object.assign(state.notes, parsed.notes || {});
        Object.keys(parsed.habitNotes || {}).forEach(hid => {
          state.habitNotes[hid] = Object.assign(state.habitNotes[hid] || {}, parsed.habitNotes[hid]);
        });
        const existingYearlyIds = new Set(state.yearlyHabits.map(h => h.id));
        (parsed.yearlyHabits || []).forEach(h => { if (!existingYearlyIds.has(h.id)) state.yearlyHabits.push(h); });
        Object.keys(parsed.yearlyLogs || {}).forEach(hid => {
          state.yearlyLogs[hid] = Object.assign(state.yearlyLogs[hid] || {}, parsed.yearlyLogs[hid]);
        });
        const existingSupplementIds = new Set(state.supplements.map(s => s.id));
        (parsed.supplements || []).forEach(s => { if (!existingSupplementIds.has(s.id)) state.supplements.push(s); });
        Object.keys(parsed.supplementLogs || {}).forEach(sid => {
          state.supplementLogs[sid] = Object.assign(state.supplementLogs[sid] || {}, parsed.supplementLogs[sid]);
        });
      } else {
        state = Object.assign(defaultState(), parsed);
      }
      saveState();
      applyTheme(state.settings.theme);
      renderAll();
      initTodayNote();
      showToast('Backup imported');
    } catch (err) {
      console.error(err);
      showToast("Couldn't read that file");
    } finally {
      e.target.value = '';
    }
  });

  $('#reset-btn').addEventListener('click', () => {
    if (!confirm('This deletes every habit and log on this device. This cannot be undone. Continue?')) return;
    state = defaultState();
    saveState();
    applyTheme('auto');
    renderAll();
    initTodayNote();
    closeSheet('settings-sheet');
    showToast('All data erased');
  });

  /* ---------------- install tip ---------------- */
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function initInstallTip() {
    if (isStandalone()) return;
    if (localStorage.getItem('habits-install-tip-dismissed')) return;
    const ua = navigator.userAgent;
    const isiOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isMac = /Macintosh/.test(ua) && navigator.maxTouchPoints === 0;
    let text = null;
    if (isiOS) text = 'Install this dashboard: tap the Share icon, then "Add to Home Screen" — it opens full-screen and works offline.';
    else if (isMac) text = 'Install this dashboard: in Safari, choose File → Add to Dock for a full app-like window.';
    if (!text) return;
    $('#install-tip-text').textContent = text;
    $('#install-tip').hidden = false;
  }
  $('#install-tip-dismiss').addEventListener('click', () => {
    $('#install-tip').hidden = true;
    localStorage.setItem('habits-install-tip-dismissed', '1');
  });

  /* ---------------- misc ---------------- */
  let toastTimer = null;
  function showToast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }
  function $(sel) { return document.querySelector(sel); }

  /* ---------------- init ---------------- */
  function setTodayLabel() {
    $('#today-label').textContent = todayDate().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  applyTheme(state.settings.theme);
  setTodayLabel();
  syncReviewPeriodButtons();
  renderAll();
  initTodayNote();
  initInstallTip();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
    });
  }

  /* ---------------- bridge for sync.js (cloud sync) ---------------- */
  window.KeystoneApp = {
    getState: () => state,
    replaceState: (newState) => {
      if (!newState || typeof newState !== 'object') return;
      state = Object.assign(defaultState(), newState, {
        habits: Array.isArray(newState.habits) ? newState.habits : [],
        logs: newState.logs && typeof newState.logs === 'object' ? newState.logs : {},
        notes: newState.notes && typeof newState.notes === 'object' ? newState.notes : {},
        habitNotes: newState.habitNotes && typeof newState.habitNotes === 'object' ? newState.habitNotes : {},
        yearlyHabits: Array.isArray(newState.yearlyHabits) ? newState.yearlyHabits : [],
        yearlyLogs: newState.yearlyLogs && typeof newState.yearlyLogs === 'object' ? newState.yearlyLogs : {},
        supplements: Array.isArray(newState.supplements) ? newState.supplements : [],
        supplementLogs: newState.supplementLogs && typeof newState.supplementLogs === 'object' ? newState.supplementLogs : {},
        settings: Object.assign({ theme: 'auto' }, newState.settings || {})
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      applyTheme(state.settings.theme);
      syncReviewPeriodButtons();
      renderAll();
      initTodayNote();
    },
    onLocalSave: null,
    toast: (msg) => showToast(msg)
  };
})();
