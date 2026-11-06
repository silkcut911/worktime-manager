// 화면 (주소: #/today #/plan #/list #/month #/settings). 데이터는 localStorage 한 곳, 계산은 core.js(WT).
const KEY = 'worktime-db';
let db;
const ui = { page: null, mode: 'set', setId: null, open: null, editSet: null, okOld: {}, draft: null, editDay: null };
const F = WT.fmt;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = () => window.WT_TODAY || WT.localToday();
const tym = () => today().slice(0, 7);
const DOW = '일월화수목금토';
const mLabel = (ym) => `${ym.slice(0, 4)}년 ${+ym.slice(5)}월`;
const dLabel = (date) => `${+date.slice(5, 7)}/${+date.slice(8)}(${DOW[WT.dow(date.slice(0, 7), +date.slice(8))]})`;
const signCls = (m) => (m < 0 ? 'neg' : m > 0 ? 'pos' : '');
const setOf = (id) => db.sets.find((s) => s.id === id);
// 달력 칸이 좁아 한글은 두 글자, 영어는 첫 단어만
const chipName = (n) => (/^[A-Za-z]/.test(n) ? n.split(' ')[0] : n.slice(0, 2));
const chip = (set) => (set ? `<span class="chip" style="background:${esc(set.color)}">${esc(chipName(set.name))}</span>` : '');
// 출근~퇴근 제외 (+추가제외) → 실근무
const four = (x) => `${F(x[0])}~${F(x[1])} 제외 ${F(x[2])}${x[3] ? ' +' + F(x[3]) : ''} → ${F(x[1] - x[0] - x[2])}`;
const setText = (s) => (s.fam ? '의무 8:00 · 실근무 0:00' : four(s.t));

// 시간 칸: 설정의 입력 방식에 따라 숫자칸(950 = 9:50) 또는 시·분 선택
// dur: 제외·추가제외처럼 '시간 길이' 칸 → 숫자 한두 자리는 분(30 → 0:30)
function timeField(id, label, min, dur) {
  if (db.inputMode === 'pick') {
    const h = min == null ? '' : Math.floor(min / 60), m = min == null ? 0 : min % 60;
    const opts = (n, sel, txt) => Array.from({ length: n }, (_, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>${txt(i)}</option>`).join('');
    return `<div><label>${label}</label><span class="tp" id="${id}"><select data-t="h"><option value="">--</option>${opts(24, h, String)}</select>` +
      `<select data-t="m">${opts(60, m, WT.pad)}</select></span></div>`;
  }
  return `<div><label>${label}</label><input id="${id}" class="tnum"${dur ? ' data-dur="1"' : ''} inputmode="numeric" maxlength="5" value="${min == null ? '' : F(min)}" placeholder="0:00"></div>`;
}
function setTime(id, min) {
  const el = $('#' + id);
  if (!el) return;
  if (el.tagName !== 'SPAN') { el.value = F(min); return; }
  el.querySelector('[data-t=h]').value = Math.floor(min / 60); el.querySelector('[data-t=m]').value = min % 60;
}
function readTime(id) {
  const el = $('#' + id);
  if (el.tagName !== 'SPAN') return el.dataset.dur && /^\d{1,2}$/.test(el.value.trim()) ? +el.value.trim() : WT.parseHM(el.value);
  const h = el.querySelector('[data-t=h]').value;
  return h === '' ? null : +h * 60 + +el.querySelector('[data-t=m]').value;
}

function load() {
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
  if (!db || db.v !== 1) db = WT.newDB();
  if (!db.auto) db.auto = { ...WT.AUTO };
  for (const s of db.sets) if (WT.OLD_NAMES[s.name]) s.name = WT.OLD_NAMES[s.name];
  if (!db.rateInit) { for (const M of Object.values(db.months)) if (!M.cfg.rate) M.cfg.rate = WT.RATE; db.rateInit = 1; }
  WT.ensureMonth(db, tym());
  WT.cleanupYears(db, today());
  save();
}
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }
function changed(ym) { WT.touch(db, ym); save(); }
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = bad ? 'bad' : ''; t.style.display = 'block';
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.style.display = 'none'), bad ? 3500 : 1800);
}
// 2개월 이상 지난 달을 고칠 때 한 번 확인 (그 달은 이번 실행 동안 다시 묻지 않음)
function guardOld(ym) {
  if (WT.monthAge(ym, tym()) < 2 || ui.okOld[ym]) return true;
  if (!confirm(`${mLabel(ym)}은 2개월 이상 지난 달입니다.\n고칠까요? (고친 뒤 엑셀로 다시 저장하세요)`)) return false;
  ui.okOld[ym] = true;
  return true;
}

function route() {
  const [p, q] = location.hash.replace(/^#\/?/, '').split('?');
  return { page: p || 'today', q: Object.fromEntries(new URLSearchParams(q || '')) };
}
function go(h) { if (location.hash === h) render(); else location.hash = h; }
const VIEWS = { today: vToday, plan: vPlan, list: vList, month: vMonth, settings: vSettings };
function render() {
  const { page, q } = route();
  if (ui.draft && !(page === 'plan' && (q.m || tym()) === ui.draft.ym)) { // 계획 임시본을 두고 다른 화면으로 갈 때
    if (ui.draft.dirty && confirm(`${mLabel(ui.draft.ym)} 계획을 저장하지 않았습니다. 저장할까요?\n(취소를 누르면 변경을 버립니다)`)) commitPlan(true);
    ui.draft = null; ui.editDay = null;
  }
  if (ui.page !== page) { ui.page = page; ui.editSet = null; ui.open = null; }
  const t = today();
  $('#hdate').textContent = `${t.slice(0, 4)}년 ${+t.slice(5, 7)}월 ${+t.slice(8)}일 (${DOW[WT.dow(t.slice(0, 7), +t.slice(8))]})`;
  $('#view').innerHTML = (VIEWS[page] || vToday)(q);
  const [top, bottom] = banners();
  $('#banners').innerHTML = top; $('#banners2').innerHTML = bottom;
  $('#slack').innerHTML = slackBar(page);
  $('#nav').innerHTML = [['today', '오늘'], ['plan', '계획'], ['list', '기록'], ['month', '월 정리'], ['settings', '설정']]
    .map(([p, t]) => `<a href="#/${p}" class="${(VIEWS[page] ? page : 'today') === p ? 'on' : ''}">${t}</a>`).join('');
  preview();
  if (page === 'plan' && ui.scrollDay && $('#dayed')) { $('#dayed').scrollIntoView({ block: 'center' }); ui.scrollDay = false; }
  if (ui.editSet) setPreview();
}

// ── 공통: 경고 띠(추가제외·월초 확인은 위, 미입력·엑셀 저장은 맨 아래), 아래 여유시간 ──
function banners() {
  const t = today(), out = [], low = [];
  const miss = WT.missingDays(db, t);
  if (miss.length) low.push(['red', `미입력 ${miss.length}일: ${miss.slice(0, 4).map(dLabel).join(', ')}${miss.length > 4 ? ' …' : ''} → 눌러서 입력`, `#/today?d=${miss[0]}`]);
  for (const a of WT.addExAlerts(db, t))
    out.push([a.level, `${+a.ym.slice(5)}월 추가제외 ${a.count}건(${F(a.sum)})${a.level === 'red' ? '이 남아 있습니다. 지우세요' : '을 월말까지 지우세요'}`, `#/month?m=${a.ym}`]);
  const M = db.months[tym()];
  if (M && !M.ok) out.push(['blue', `${+tym().slice(5)}월 달력 확인과 계획 입력을 해 주세요`, `#/plan?m=${tym()}`]);
  for (const b of WT.backupAlerts(db, t, Date.now())) low.push(['gray', b + ' → 설정', '#/settings']);
  const html = (list) => list.map(([c, msg, h]) => `<a class="ban-${c}" href="${h}">${esc(msg)}</a>`).join('');
  return [html(out), html(low)];
}
// 화면 아래 바. 오늘 화면은 위에 그날까지·월말 여유가 있으니 월말 여유 · 추가근무(여유 − 기본초과) · 추가근무수당
function slackBar(page) {
  const s = WT.slack(db, today()), t = WT.calcMonth(db, tym(), today()).total;
  if (page === 'today') return `<div><small>${+tym().slice(5)}월 말 여유</small><b class="${signCls(t.diff)}">${F(t.diff, true)}</b></div>` +
    `<div><small>추가근무</small><b class="${signCls(t.otRecog)}">${F(t.otRecog, true)}</b></div><div><small>추가근무수당</small><b>${WT.won(t.pay)}</b></div>`;
  return `<div><small>오늘까지 여유${t.missing ? ' · 미입력 포함' : ''}</small><b class="${signCls(s)}">${F(s, true)}</b></div>` +
    `<div><small>${+tym().slice(5)}월 말 예상 여유</small><b class="${signCls(t.diff)}">${F(t.diff, true)}</b></div>`;
}
// 그날 값(k: 'a' 실제, 'p' 계획)을 v로 넣었다고 치고 계산: 그날까지 여유시간, 그 달 월말 여유시간
function slackIf(date, v, k) {
  const ym = date.slice(0, 7), M = WT.peekMonth(db, ym), d = +date.slice(8);
  const pdb = { ...db, months: { ...db.months, [ym]: { ...M, days: { ...M.days, [d]: { ...(M.days[d] || {}), [k]: v } } } } };
  const c = WT.calcMonth(pdb, ym, today());
  return { day: c.rows[d - 1].cumDiff, end: c.total.diff };
}

// ── 날짜 카드: 지난날은 실제값 입력, 오늘·앞날은 계획값을 보고 고침 ──
// pre: 칸 id 앞글자(한 화면에 카드가 둘일 때 구분), stay: 저장 뒤 같은 화면에 머묾(기록 화면)
function dayCard(date, pre, stay) {
  const ym = date.slice(0, 7), d = +date.slice(8), M = WT.peekMonth(db, ym), day = M.days[d] || {};
  const kind = WT.kindOf(M, ym, d), set = setOf(day.s), hol = WT.holidayName(ym, d), t = today(), isAct = date < t, k = isAct ? 'a' : 'p';
  const when = date === t ? '오늘 ' : date === WT.prevWorkday(db, t) ? '전일 ' : date === WT.nextWorkday(db, t) ? '내일 ' : '';
  const tone = { '오늘 ': ' d-today', '전일 ': ' d-prev', '내일 ': ' d-next' }[when] || ''; // 오늘이 가장 눈에 띄고 내일이 가장 흐리게
  let h = `<div class="card dcard${tone}"><div class="row"><b>${when}${dLabel(date)} ${isAct ? '실제' : '계획'}</b><span class="badge">${WT.KIND_NAME[kind]}${kind === 'H' && hol ? ' · ' + esc(hol) : ''}</span>` +
    `${set ? `<span class="badge" style="background:${esc(set.color)}">${esc(set.name)}</span>` : ''}<span class="sp"></span>` +
    `${isAct ? (day.a ? `<span class="badge pos">입력됨</span><button class="sm warn" data-act="clearDay" data-date="${date}">지우기</button>` : kind === 'W' ? '<span class="badge neg">미입력</span>' : '') : ''}</div>`;
  if (kind === 'F') return h + '<div class="muted" style="margin-top:6px">패밀리데이: 입력할 것이 없습니다 (의무 8:00, 실근무 0:00)</div></div>';
  if (!isAct && kind !== 'W') return h + `<div class="muted" style="margin-top:6px">${kind === 'O' ? '주말' : '휴일'}이라 계획이 없습니다.</div></div>`;
  const v = (isAct ? day.a || day.p : day.p) || [];
  const auto = kind === 'W' && (!set || set.id === 'normal') ? ' data-auto="1"' : ''; // 출근 입력 시 퇴근·제외 자동
  const res = (cls, label, span) => `<div class="res ${cls}"${span ? ' style="grid-column:span 2"' : ''}><label>${label}</label><b>-</b></div>`;
  return h + `<div class="dform" data-pre="${pre}" data-date="${date}" data-k="${k}"${auto}${stay ? ' data-stay="1"' : ''} style="margin-top:4px">
    <div class="grid5">${timeField(pre + 'in', '출근', v[0])}${timeField(pre + 'out', '퇴근', v[1])}${timeField(pre + 'ex', '제외', v[2], true)}${res('r-wt', '실근무')}${res('r-day', '당일 여유')}</div>
    <div class="grid5" style="margin-top:4px"><div></div><div class="light">${timeField(pre + 'add', '추가제외', v[3], true)}</div>${res('r-end', '월말 여유')}<div></div>
      <div class="res"><label>&nbsp;</label><button class="pri" data-act="saveForm" data-pre="${pre}" data-date="${date}" data-k="${k}"${stay ? ' data-stay="1"' : ''}>저장</button></div></div>
    <div class="pv"></div></div></div>`;
}
// 오늘 화면: 전일 이전에 밀린 날은 날짜만 한 줄씩(누르면 펼침) → 전일(실제) → 오늘(계획) → 내일(계획)
// ?d=날짜 로 들어오면 그날을 펼치거나 맨 위에 보여 줌
function vToday(q) {
  const t = today(), prev = WT.prevWorkday(db, t), sel = q.d && q.d !== prev && q.d !== t ? q.d : null;
  const miss = WT.missingDays(db, t).filter((x) => x !== prev);
  let h = sel && !miss.includes(sel) ? dayCard(sel, 'd-') : '';
  // 밀린 날: 제목과 날짜 칩을 한 줄에, 누른 날만 펼침
  if (miss.length) h += `<div class="card misscard"><div class="mline"><b>밀린 날 ${miss.length}일</b>${miss.map((x) =>
    `<button class="mchip${x === sel ? ' on' : ''}" data-act="nav" data-h="#/today${x === sel ? '' : '?d=' + x}">${dLabel(x)}</button>`).join('')}</div>` +
    (miss.includes(sel) ? dayCard(sel, 'd-') : '') + '</div>';
  return h + dayCard(prev, 'f-') + dayCard(t, 'q-') + dayCard(WT.nextWorkday(db, t), 'n-');
}
const fourVals = (pre) => ['in', 'out', 'ex', 'add'].map((id) => readTime(pre + id));
// 네 칸(출근·퇴근·제외·추가제외) 확인: 오류면 문구, 아니면 [출근, 퇴근, 제외, 추가제외]
function checkFour(v) {
  if (v[0] == null || v[1] == null) return '출근·퇴근을 입력하세요';
  if (v.some(Number.isNaN)) return '시간을 확인하세요 (숫자만: 950 = 9:50)';
  v = [v[0], v[1], v[2] || 0, v[3] || 0];
  if (v[1] <= v[0]) return '퇴근이 출근보다 늦어야 합니다';
  if (v[1] - v[0] - v[2] < 0) return '제외시간이 머문 시간보다 깁니다';
  return v;
}
// 계획 화면 시간 조정 칸 아래 한 줄: 실근무(그날 의무와 차이), 제외 부족 경고
function fourPreview(el, raw, std) {
  if (!el) return;
  const v = checkFour(raw);
  if (typeof v === 'string') { el.textContent = raw[0] == null || raw[1] == null ? '' : v; return; }
  const wt = v[1] - v[0] - v[2], short = WT.exShort(v);
  el.innerHTML = `실근무 <b>${F(wt)}</b> (${F(wt - (std == null ? WT.STD : std), true)})${v[3] ? ` · 추가제외 반영 ${F(wt - v[3])}` : ''}` +
    (short ? `<div class="warn-t">⚠ 제외 최소 ${F(short)} (머문 ${F(v[1] - v[0])})</div>` : '');
}
// 날짜 칸 아래 네 칸(시간 칸과 같은 크기): 실근무 · 당일 여유(그날까지) · 월말 여유 · [저장], 그 아래 경고
function formPreview(f) {
  const { pre, date, k } = f.dataset, raw = fourVals(pre), v = checkFour(raw), ok = typeof v !== 'string';
  const r = ok ? slackIf(date, v, k) : null, wt = ok ? v[1] - v[0] - v[2] : null;
  const put = (cls, val, sign) => { const b = f.querySelector(`.${cls} b`); b.textContent = val; b.className = sign == null ? '' : signCls(sign); };
  put('r-wt', ok ? F(wt) : '-'); put('r-day', ok ? F(r.day, true) : '-', ok ? r.day : null); put('r-end', ok ? F(r.end, true) : '-', ok ? r.end : null);
  const short = ok ? WT.exShort(v) : 0, err = !ok && raw[0] != null && raw[1] != null ? v : '';
  f.querySelector('.pv').innerHTML =
    (err ? `<div class="warn-t" style="margin-top:4px">${err}</div>` : '') +
    (short ? `<div class="warn-t" style="margin-top:4px">⚠ 제외 최소 ${F(short)} (머문 ${F(v[1] - v[0])})</div>` : '') +
    (ok && v[3] ? `<div class="muted" style="margin-top:4px">추가제외 반영 실근무 ${F(wt - v[3])}</div>` : '');
}
function preview() {
  document.querySelectorAll('.dform').forEach(formPreview);
  if ($('#ppv')) fourPreview($('#ppv'), fourVals('p-'), readTime('p-std'));
}

// ── 계획: 세트 고르고 날짜 누르기 / 휴일 지정 ──
function monthNav(ym, page) {
  const first = Object.keys(db.months).sort()[0] || tym(), last = WT.addMonths(tym(), 1);
  return `<div class="row" style="margin-bottom:10px"><button data-act="nav" data-h="#/${page}?m=${WT.addMonths(ym, -1)}" ${ym <= first ? 'disabled' : ''}>‹</button>
    <b class="sp" style="text-align:center">${mLabel(ym)}</b><button data-act="nav" data-h="#/${page}?m=${WT.addMonths(ym, 1)}" ${ym >= last ? 'disabled' : ''}>›</button></div>`;
}
// 계획은 임시본(ui.draft)에서 고치고 [저장]할 때 반영. pdb = 임시본을 끼운 db (WT 함수에 그대로 넘김)
function draftDB(ym) {
  if (!ui.draft || ui.draft.ym !== ym) ui.draft = { ym, M: JSON.parse(JSON.stringify(WT.peekMonth(db, ym))), dirty: false };
  return { ...db, months: { ...db.months, [ym]: ui.draft.M }, modAt: {} };
}
// 계획 합계: 평일의 예정 실근무 합 / 의무 / 차이, 그리고 실제+계획으로 본 월말 차이
function planTotal(pdb, ym) {
  const M = pdb.months[ym], st = WT.monthStats(pdb, ym);
  let wt = 0, n = 0;
  for (const [d, day] of Object.entries(M.days)) if (day.p && WT.kindOf(M, ym, +d) === 'W') { wt += day.p[1] - day.p[0] - day.p[2]; n++; }
  return { wt, n, std: st.std, diff: wt - st.std, end: WT.calcMonth(pdb, ym, today()).total.diff, W: st.W };
}
function commitPlan(showTotal) {
  const { ym, M } = ui.draft;
  if (!guardOld(ym)) return false;
  const t = planTotal(draftDB(ym), ym);
  db.months[ym] = M; changed(ym); ui.draft = null;
  if (showTotal) alert(`${mLabel(ym)} 계획을 저장했습니다.\n\n계획 실근무 ${F(t.wt)} (평일 ${t.W}일 중 ${t.n}일 입력)\n의무 ${F(t.std)}\n차이 ${F(t.diff, true)}\n\n월말 예상 차이(실제+계획) ${F(t.end, true)}`);
  return true;
}
function vPlan(q) {
  const ym = q.m || tym(), pdb = draftDB(ym), M = pdb.months[ym], st = WT.monthStats(pdb, ym), t = planTotal(pdb, ym);
  const mini = (label, val, cls = '') => `<div class="mini"><small>${label}</small><b class="${cls}">${val}</b></div>`;
  let h = `<div class="plan">${monthNav(ym, 'plan')}`;
  h += `<div class="card pcard"><div class="row">${mini('계획', F(t.wt))}${mini('의무', F(t.std))}${mini('차이', F(t.diff, true), signCls(t.diff))}${mini('월말 예상', F(t.end, true), signCls(t.end))}
    ${ui.draft.dirty ? '<button class="sm" data-act="cancelPlan">취소</button>' : ''}<button class="pri" data-act="savePlan" ${ui.draft.dirty ? '' : 'disabled'}>저장</button></div>
    ${ui.draft.dirty ? '<div class="warn-t">저장하지 않은 변경이 있습니다</div>' : ''}</div>`;
  if (!M.ok) {
    h += `<div class="card"><h3>${+ym.slice(5)}월 달력 확인</h3>
      <div>평일 ${st.W}일 · 공휴일 ${st.H.length}일${st.F ? ` · 패밀리데이 ${st.F}일` : ''} · 의무 <b>${F(st.std)}</b></div>
      <div class="muted">${st.H.map((x) => `${x.d}일 ${esc(x.name)}`).join(', ') || '공휴일 없음'}</div>
      <div class="muted" style="margin:6px 0">임시공휴일·회사 휴무일은 아래 [휴일 지정]에서 날짜를 누르세요.</div>
      <div class="row"><span class="sp"></span><button class="pri" data-act="confirmMonth" data-m="${ym}">확인</button></div></div>`;
  }
  h += `<div class="tabs2">${[['kind', '휴일 지정'], ['set', '세트 넣기'], ['time', '시간 조정']].map(([v, t]) =>
    `<button class="${ui.mode === v ? 'on' : ''}" data-act="mode" data-v="${v}">${t}</button>`).join('')}</div>`;
  if (ui.mode === 'set') {
    if (ui.editSet) h += setEditor();
    h += `<div class="sets">${db.sets.map((s) => `<button data-act="pickSet" data-id="${s.id}" class="${ui.setId === s.id ? 'on' : ''}" style="background:${esc(s.color)}"><span>${esc(s.name)}</span>${s.fam ? '<small>출퇴근 없음</small><small>: 0:00</small>' : `<small>${F(s.t[0])}~${F(s.t[1])}</small><small>(-${F(s.t[2])}) : ${F(s.t[1] - s.t[0] - s.t[2])}</small>`}</button>`).join('')}</div>
      <div class="row prow"><span class="muted sp">${ui.setId ? '날짜 누르면 넣기·빼기' : '세트를 고르세요'}</span>
      <button data-act="editSet" data-id="${ui.setId}" ${ui.setId ? '' : 'disabled'}>기본값 수정</button><button data-act="fillEmpty" data-m="${ym}" ${ui.setId ? '' : 'disabled'}>빈 날 모두 입력</button></div>`;
  } else if (ui.mode === 'time') {
    const d = ui.editDay, day = (d && M.days[d]) || {};
    if (d && WT.kindOf(M, ym, d) === 'W') {
      const set = setOf(day.s), v = day.p || (set && set.t) || [];
      h += `<div class="card" id="dayed"><div class="row"><h3 class="sp" style="margin:0">${dLabel(WT.dateStr(ym, d))} 계획 시간</h3>${set ? `<span class="badge" style="background:${esc(set.color)}">${esc(set.name)}</span>` : ''}</div>
        <div class="grid4" style="margin-top:8px">${[['in', '출근'], ['out', '퇴근'], ['ex', '제외'], ['add', '추가제외']].map(([id, t], i) => timeField('p-' + id, t, v[i], i >= 2)).join('')}</div>
        <div class="grid4" style="margin-top:8px">${timeField('p-std', '그날 의무', day.std != null ? day.std : WT.STD)}</div>
        ${set ? `<div class="muted" style="margin-top:6px">세트 값: ${setText(set)}</div>` : ''}<div id="ppv" class="muted" style="margin:8px 0"></div>
        <div class="row"><button data-act="closeDay">닫기</button><span class="sp"></span>${day.p ? `<button class="warn" data-act="clearPlanDay" data-m="${ym}" data-d="${d}">계획 지우기</button>` : ''}
        <button class="pri" data-act="applyDay" data-m="${ym}" data-d="${d}">적용</button></div><div class="muted" style="margin-top:4px">적용한 뒤 위의 [저장]을 눌러야 반영됩니다.</div></div>`;
    } else h += `<div class="muted" style="margin-bottom:8px">계획 시간을 고칠 평일을 누르세요.</div>`;
  } else h += `<div class="muted" style="margin-bottom:8px">평일을 누를 때마다 평일 → 공휴일 → 패밀리데이 → 평일 순으로 바뀝니다.</div>`;
  h += '<div class="cal">' + DOW.split('').map((x) => `<div class="h">${x}</div>`).join('');
  h += '<div></div>'.repeat(WT.dow(ym, 1)); // 일요일부터
  for (let d = 1; d <= WT.daysIn(ym); d++) {
    const day = M.days[d] || {}, kind = WT.kindOf(M, ym, d), hn = kind === 'H' ? WT.holidayName(ym, d) || '휴일' : '', set = setOf(day.s);
    const own = day.p && (!set || !set.t || day.p.join() !== set.t.join()); // 세트와 다르게 고친 날은 *
    h += `<div class="c ${kind}${WT.dateStr(ym, d) === today() ? ' today' : ''}${ui.mode === 'time' && ui.editDay === d ? ' sel' : ''}" data-act="cal" data-m="${ym}" data-d="${d}"><span class="n">${d}</span>${day.a ? ' <span class="done">●</span>' : ''}
      ${hn ? `<span class="hn">${esc(hn)}</span>` : ''}${kind !== 'H' && kind !== 'O' ? chip(set) : ''}${day.p && kind === 'W' ? `<span class="cw">${F(day.p[1] - day.p[0] - day.p[2])}${own ? '*' : ''}</span>` : ''}</div>`;
  }
  h += '</div><div class="muted" style="margin-top:4px;font-size:12px">숫자 = 계획 실근무 · * 세트와 다르게 고친 날 · ● 실제값 입력됨</div></div>';
  return h;
}

// ── 기록: 날짜별 목록 ──
function vList(q) {
  const ym = q.m || tym(), c = WT.calcMonth(db, ym, today());
  let h = monthNav(ym, 'list') + `<div class="muted" style="margin-bottom:6px">회색 기울임 = 계획값(미입력 날은 계획값으로 계산) · 줄을 누르면 바로 수정</div>`;
  h += '<table class="lst"><tr><th>일</th><th>출근~퇴근</th><th>제외</th><th>실근무</th><th>차이</th><th>누적</th></tr>';
  let wk = 0;
  for (const r of c.rows) {
    const set = setOf(r.day.s), cls = r.src === 'p' ? 'plan' : '';
    let cells;
    if (r.kind === 'F') cells = `<td class="l">패밀리데이</td><td></td><td>0:00</td>`;
    else if (r.missing && !r.v) cells = `<td class="l miss" colspan="3">미입력</td>`;
    else if (r.v) cells = `<td class="${cls}">${F(r.v[0])}~${F(r.v[1])}</td><td class="${cls}">${F(r.v[2])}${r.v[3] ? '+' + F(r.v[3]) : ''}</td><td class="${cls}">${F(r.wt)}</td>`;
    else cells = `<td></td><td></td><td></td>`;
    const show = r.v || r.std || r.missing;
    h += `<tr class="${r.kind}" data-act="openRow" data-k="${r.date}"><td>${set ? `<span class="dot" style="background:${esc(set.color)}"></span>` : ''}${r.d} ${DOW[r.dow]}${r.exShort ? ' ⚠' : ''}${r.missing && r.v ? ' <span class="miss">미입력</span>' : ''}</td>${cells}
      <td class="${signCls(r.diff)}">${show ? F(r.diff, true) : ''}</td><td class="${signCls(r.cumDiff)}">${show ? F(r.cumDiff, true) : ''}</td></tr>`;
    if (ui.open === r.date) {
      h += `<tr class="det"><td colspan="6">${r.v ? `<div class="muted">실근무 ${F(r.wt)} · 추가제외 반영 ${F(r.wtGH)} · 누적 실근무 ${F(r.cumWT)}</div>` : ''}
        ${r.exShort ? `<div class="warn-t">⚠ 제외 최소 ${F(r.exShort)} 미달</div>` : ''}${dayCard(r.date, 'f-', true)}</td></tr>`;
    }
    wk += r.wt;
    if (r.dow === 0 || r.d === c.rows.length) { if (wk) h += `<tr class="wk"><td colspan="3">주 합계</td><td>${F(wk)}</td><td colspan="2"></td></tr>`; wk = 0; }
  }
  return h + '</table>';
}

// ── 월 정리 ──
function vMonth(q) {
  const ym = q.m || tym(), c = WT.calcMonth(db, ym, today()), t = c.total, cfg = c.cfg;
  const stat = (label, val, cls = '', sub = '') => `<div class="stat"><div class="muted">${label}</div><b class="${cls}">${val}</b>${sub ? `<div class="muted">${sub}</div>` : ''}</div>`;
  let h = `<div class="mon">${monthNav(ym, 'month')}`;
  h += `<div class="card"><h3>${+ym.slice(5)}월 합계${ym >= tym() ? ' <span class="muted">(남은 날은 계획값)</span>' : ''}</h3><div class="grid3">
    ${stat('월 실근무', F(t.wt), '', cfg.base ? `기본근무 ${F(cfg.base)} 포함` : '')}${stat('월 의무', F(t.std), '', '근무일 × 8:00')}${stat('월말 여유', F(t.diff, true), signCls(t.diff))}
    ${stat('추가근무', F(t.otRecog, true), signCls(t.otRecog), `월말 여유 − 기본초과`)}${stat('추가근무수당', WT.won(t.pay), '', t.otRecog > 0 ? `시간당 ${WT.won(cfg.rate)}` : '0 이하면 0원')}
    ${stat('남은 가능시간', F(t.remain), t.remain < 0 ? 'neg' : '', `최대 − 추가제외반영`)}
    </div>${t.missing ? `<div class="warn-t" style="margin-top:4px">미입력 ${t.missing}일 포함 (계획값으로 계산)</div>` : ''}</div>`;
  h += `<div class="card"><div class="row"><h3 class="sp" style="margin:0">이달 입력값</h3><button class="pri sm" data-act="saveCfg" data-m="${ym}">저장</button></div><div class="grid4" style="margin-top:4px">
    <div><label>기본근무</label><input id="c-base" class="tnum" data-max="5" inputmode="numeric" maxlength="6" value="${F(cfg.base)}"></div>
    <div><label>기본초과</label><input id="c-baseOT" class="tnum" data-max="5" inputmode="numeric" maxlength="6" value="${F(cfg.baseOT)}"></div>
    <div><label>시간당(원)</label><input id="c-rate" class="rnum" inputmode="numeric" maxlength="7" value="${cfg.rate}"></div>
    <div><label>최대가능</label><input id="c-max" class="tnum" data-max="5" inputmode="numeric" maxlength="6" value="${cfg.max == null ? '' : F(cfg.max)}" placeholder="${F(WT.max52(ym))}"></div>
    </div><div class="muted" style="margin-top:4px;font-size:11px">최대가능 ${F(t.max)}${cfg.max == null ? ' (비우면 주 52시간: 52 × ' + WT.daysIn(ym) + '일 ÷ 7)' : ''} · 날짜별 의무는 계획 → 시간 조정 · 최대가능 외 값은 다음 달로 이어짐</div></div>`;
  const adds = c.rows.filter((r) => r.add > 0);
  h += `<div class="card"><h3>추가제외 (월말까지 지우기)</h3>${adds.length ? adds.map((r) =>
    `<div class="setrow"><span>${dLabel(r.date)}</span><b>${F(r.add)}</b><span class="muted">${r.src === 'a' ? '실제' : '예정'}</span><span class="sp"></span>
     <button class="sm" data-act="nav" data-h="#/today?d=${r.date}">고치기</button><button class="sm warn" data-act="delAdd" data-date="${r.date}">삭제</button></div>`).join('') +
    `<div class="muted" style="margin-top:4px">합계 ${F(t.add)}</div>` : '<div class="muted">없음</div>'}</div></div>`;
  return h;
}

// ── 세트 편집 (설정 화면, 계획 화면의 [기본값 수정]) ──
function setEditor() {
  const s = ui.editSet === 'new' ? { name: '', color: '#cfe8ff', t: [540, 1080, 60, 0] } : setOf(ui.editSet);
  if (!s) return '';
  return `<div class="card"><h3>${ui.editSet === 'new' ? '세트 추가' : `'${esc(s.name)}' 기본값 수정`}</h3>
    <div class="grid2"><div><label>이름</label><input id="s-name" value="${esc(s.name)}"></div><div><label>색</label><input id="s-color" type="color" value="${esc(s.color)}"></div></div>
    ${s.fam ? '<div class="muted" style="margin-top:8px">패밀리데이는 출퇴근·제외 시간이 없습니다.</div>' : `<div class="grid4" style="margin-top:8px">
      ${['출근', '퇴근', '제외', '추가제외'].map((t, i) => timeField('s-' + i, t, s.t[i], i >= 2)).join('')}</div>
      <div id="spv" class="muted" style="margin-top:6px"></div>`}
    <div class="muted" style="margin-top:6px">세트를 고쳐도 이미 날짜에 넣은 계획은 바뀌지 않습니다.</div>
    <div class="row" style="margin-top:8px"><span class="sp"></span><button data-act="cancelSet">취소</button><button class="pri" data-act="saveSet">저장</button></div></div>`;
}

// ── 설정: 세트, 엑셀 ──
function vSettings() {
  let h = ui.editSet ? setEditor() : '';
  h += `<div class="card"><h3>출근 입력 시 자동 채우기 (Regular·세트 없는 평일)</h3><div class="grid2">
    ${timeField('au-stay', '퇴근 = 출근 +', db.auto.stay)}${timeField('au-ex', '제외', db.auto.ex, true)}</div>
    <div class="row" style="margin-top:8px"><span class="muted sp">예: 9:50 출근 → 퇴근 ${F(590 + db.auto.stay)}, 제외 ${F(db.auto.ex)}</span><button class="pri" data-act="saveAuto">저장</button></div></div>`;
  h += `<div class="card"><h3>시간 입력 방식</h3><div class="tabs2" style="margin:0">${[['num', '숫자 입력 (950)'], ['pick', '시·분 선택']].map(([v, t]) =>
    `<button class="${(db.inputMode || 'num') === v ? 'on' : ''}" data-act="inputMode" data-v="${v}">${t}</button>`).join('')}</div></div>`;
  h += `<div class="card"><div class="row"><h3 class="sp" style="margin:0">시간세트 (위에서부터 순서)</h3><button class="sm" data-act="editSet" data-id="new">+ 추가</button></div>
    ${db.sets.map((s, i) => `<div class="setrow"><span class="sw" style="background:${esc(s.color)}"></span><div class="sp"><b>${esc(s.name)}</b>
      <div class="muted">${setText(s)}</div></div>
      <button class="sm" data-act="moveSet" data-i="${i}" data-n="-1" ${i ? '' : 'disabled'}>▲</button><button class="sm" data-act="moveSet" data-i="${i}" data-n="1" ${i < db.sets.length - 1 ? '' : 'disabled'}>▼</button>
      <button class="sm" data-act="editSet" data-id="${s.id}">수정</button>${s.fam ? '' : `<button class="sm warn" data-act="delSet" data-id="${s.id}">삭제</button>`}</div>`).join('')}</div>`;
  const y = +today().slice(0, 4), L = db.backup.latest, years = [...new Set(Object.keys(db.months).map((ym) => +ym.slice(0, 4)))].filter((x) => x < y || +today().slice(5, 7) === 12).sort();
  h += `<div class="card"><h3>엑셀 (1년 = 1파일)</h3>
    <button class="pri" data-act="exportYear" data-y="${y}" data-kind="latest">${y}년 최신본 저장</button>
    <div class="muted" style="margin:6px 0 10px">${L ? `마지막 저장: ${esc(L.name)} (${new Date(L.at).toLocaleString('ko-KR')})` : '아직 저장한 적이 없습니다'}</div>
    ${years.map((yy) => { const f = db.backup.finals[yy]; return `<div class="row" style="margin-bottom:8px"><button data-act="exportYear" data-y="${yy}" data-kind="final">${yy}년 연최종본 저장</button>
      <span class="muted">${f ? `저장함 ${new Date(f.at).toLocaleDateString('ko-KR')}${f.at < (db.modAt[yy] || 0) ? ' · 그 뒤 수정됨' : ''}` : '아직 저장 안 함'}</span></div>`; }).join('')}
    <label style="margin-top:6px">엑셀 불러오기 (당월은 앱에 데이터가 있으면 바뀌지 않음)</label><input type="file" id="imp" accept=".xlsx"></div>`;
  h += `<div class="card muted">저장 데이터 ${(JSON.stringify(db).length / 1024).toFixed(1)}KB · 보관 중인 달: ${Object.keys(db.months).sort().map((ym) => ym.replace('-', '.')).join(', ')}<br>프로그램 __BUILD__</div>`;
  return h;
}
function setPreview() {
  const el = $('#spv'); if (!el) return;
  const v = [0, 1, 2, 3].map((i) => readTime('s-' + i));
  if (v[0] == null || v[1] == null || v.some(Number.isNaN)) { el.textContent = ''; return; }
  v[2] = v[2] || 0; v[3] = v[3] || 0;
  const short = WT.exShort(v);
  el.innerHTML = four(v) + (short ? `<div class="warn-t">⚠ 머문 시간 ${F(v[1] - v[0])} → 제외 최소 ${F(short)}</div>` : '');
}

// ── 엑셀 저장·불러오기 ──
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function exportYear(year, kind) {
  const n = new Date(), p = WT.pad, stamp = `${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}_${p(n.getHours())}${p(n.getMinutes())}`;
  const savedAt = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`;
  const name = kind === 'final' ? `근무시간_${year}_연최종본.xlsx` : `근무시간_${year}_최신본_${stamp}.xlsx`;
  download(XLSX_MIN.write(WT.toSheets(db, String(year), kind === 'final' ? '연최종본' : '최신본', savedAt, today())), name);
  if (kind === 'final') {
    db.backup.finals[year] = { name, at: Date.now() }; save();
    alert(`저장했습니다: ${name}\n\n이 연최종본은 지우지 말고 보관하세요(구글드라이브 등 폰 밖에도).\n${year}년 데이터는 ${+year + 1}년 2월부터 앱에서 정리됩니다.`);
  } else {
    const prev = db.backup.latest; db.backup.latest = { name, at: Date.now() }; save();
    const prevY = prev && +(prev.name.match(/_(\d{4})_/) || [])[1];
    let msg = `저장했습니다: ${name}\n\n`;
    if (!prev) msg += '최신본은 하나만 두면 됩니다. 다음에 저장하면 지울 파일 이름을 알려 드립니다.';
    else if (prevY && prevY < year && !db.backup.finals[prevY]) msg += `이전 최신본 ${prev.name}은 ${prevY}년 연최종본을 저장한 뒤에 지우세요.`;
    else msg += `다운로드 폴더에서 이전 최신본 ${prev.name}은 지우세요. 최신본은 하나만 두면 됩니다.`;
    msg += `\n\n단, 근무시간_${year - 1}_연최종본.xlsx 같은 연최종본은 지우면 안 됩니다.`;
    alert(msg);
  }
  render();
}
const inflateRaw = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
async function importFile(input) {
  const f = input.files[0]; input.value = '';
  if (!f) return;
  try {
    const parsed = WT.fromSheets(await XLSX_MIN.read(new Uint8Array(await f.arrayBuffer()), inflateRaw));
    const ms = Object.keys(parsed.months).sort().map((ym) => +ym.slice(5) + '월').join(', ');
    if (!confirm(`${parsed.year}년 ${parsed.kind} (저장 ${parsed.savedAt})\n들어 있는 달: ${ms || '없음'}\n\n불러오면 이 달들의 앱 데이터가 파일 내용으로 바뀝니다.\n당월(${+tym().slice(5)}월)은 앱에 데이터가 있으면 바꾸지 않습니다. 계속할까요?`)) return;
    const r = WT.mergeImport(db, parsed, today());
    if (r.error) return alert(r.error);
    WT.ensureMonth(db, tym()); save();
    alert(`불러왔습니다: ${r.replaced.map((ym) => +ym.slice(5) + '월').join(', ') || '없음'}` + (r.kept.length ? `\n당월(${+tym().slice(5)}월)은 앱 데이터를 그대로 두었습니다.` : ''));
    render();
  } catch (e) { alert('불러오기 실패: ' + e.message); }
}

// ── 동작 ──
const ACT = {
  nav: (el) => go(el.dataset.h),
  // 날짜 카드 저장: k='a' 실제값, k='p' 계획값(오늘·앞날)
  saveForm(el) {
    const { pre, date, k, stay } = el.dataset, ym = date.slice(0, 7), d = +date.slice(8), v = checkFour(fourVals(pre));
    if (typeof v === 'string') return toast(v, 1);
    if (!guardOld(ym)) return;
    const M = WT.ensureMonth(db, ym);
    WT.setDay(M, d, { ...(M.days[d] || {}), [k]: v }); changed(ym);
    const short = WT.exShort(v), c = WT.calcMonth(db, ym, today());
    const sl = `${+ym.slice(5)}/${d}까지 여유 ${F(c.rows[d - 1].cumDiff, true)} · 월말 ${F(c.total.diff, true)}`;
    toast(`${k === 'a' ? '저장했습니다' : '계획을 고쳤습니다'}${short ? ` ⚠ 제외 최소 ${F(short)} 미달` : ''} · ${sl}`, !!short);
    if (stay) { ui.open = null; return render(); }
    go('#/today');
  },
  clearDay(el) {
    const date = el.dataset.date, ym = date.slice(0, 7), d = +date.slice(8);
    if (!guardOld(ym) || !confirm(`${dLabel(date)} 실제값을 지울까요?`)) return;
    const M = WT.ensureMonth(db, ym), day = { ...M.days[d] }; delete day.a;
    WT.setDay(M, d, day); changed(ym); render();
  },
  confirmMonth(el) { draftDB(el.dataset.m); ui.draft.M.ok = true; ui.draft.dirty = true; render(); },
  mode(el) { ui.mode = el.dataset.v; ui.editDay = null; render(); },
  pickSet(el) { ui.setId = ui.setId === el.dataset.id ? null : el.dataset.id; render(); },
  cal(el) {
    const ym = el.dataset.m, d = +el.dataset.d, pdb = draftDB(ym);
    if (ui.mode === 'time') {
      const k = WT.kindOf(pdb.months[ym], ym, d);
      if (k !== 'W') return toast(k === 'F' ? '패밀리데이는 시간이 없습니다' : '평일만 고칠 수 있습니다', 1);
      ui.editDay = d; ui.scrollDay = true; return render();
    }
    if (ui.mode === 'set' && !setOf(ui.setId)) return toast('세트를 먼저 고르세요', 1);
    const err = ui.mode === 'set' ? WT.applySet(pdb, ym, d, setOf(ui.setId)) : WT.cycleKind(pdb, ym, d);
    if (err) return toast(err, 1);
    ui.draft.dirty = true; render();
  },
  fillEmpty(el) {
    const ym = el.dataset.m, s = setOf(ui.setId);
    if (!s) return;
    const n = WT.fillEmpty(draftDB(ym), ym, s);
    if (n) ui.draft.dirty = true;
    toast(`${s.name} ${n}일 입력`); render();
  },
  applyDay(el) {
    const ym = el.dataset.m, d = +el.dataset.d, v = checkFour(fourVals('p-')), std = readTime('p-std');
    if (typeof v === 'string') return toast(v, 1);
    if (std == null || Number.isNaN(std)) return toast('그날 의무시간을 입력하세요', 1);
    const M = draftDB(ym).months[ym], day = { ...(M.days[d] || {}), p: v };
    if (std === WT.STD) delete day.std; else day.std = std;
    WT.setDay(M, d, day); ui.draft.dirty = true; ui.editDay = null;
    const short = WT.exShort(v);
    toast(short ? `적용했습니다. ⚠ 제외 최소 ${F(short)} 미달` : `${d}일 계획 ${F(v[1] - v[0] - v[2])} 적용`, !!short); render();
  },
  clearPlanDay(el) {
    const ym = el.dataset.m, d = +el.dataset.d, M = draftDB(ym).months[ym], day = { ...M.days[d] };
    delete day.p; delete day.s; WT.setDay(M, d, day); ui.draft.dirty = true; ui.editDay = null; render();
  },
  closeDay() { ui.editDay = null; render(); },
  savePlan() { if (ui.draft && commitPlan(true)) render(); },
  cancelPlan() { if (confirm('저장하지 않은 계획 변경을 버릴까요?')) { ui.draft = null; ui.editDay = null; render(); } },
  inputMode(el) { db.inputMode = el.dataset.v; save(); render(); },
  saveAuto() {
    const stay = readTime('au-stay'), ex = readTime('au-ex');
    if ([stay, ex].some((x) => x == null || Number.isNaN(x))) return toast('시간을 확인하세요', 1);
    db.auto = { stay, ex }; save(); toast('저장했습니다'); render();
  },
  openRow(el) { ui.open = ui.open === el.dataset.k ? null : el.dataset.k; render(); },
  saveCfg(el) {
    const ym = el.dataset.m, v = ['base', 'baseOT', 'max'].map((k) => WT.parseHM($('#c-' + k).value)), rate = +$('#c-rate').value.replace(/\D/g, '');
    if (v.some((x) => Number.isNaN(x) || x < 0)) return toast('입력값을 확인하세요 (23000 → 230:00)', 1);
    if (!guardOld(ym)) return;
    WT.ensureMonth(db, ym).cfg = { base: v[0] || 0, baseOT: v[1] || 0, rate, max: v[2] }; changed(ym); toast('저장했습니다'); render();
  },
  delAdd(el) {
    const date = el.dataset.date, ym = date.slice(0, 7), d = +date.slice(8);
    if (!guardOld(ym)) return;
    const M = WT.ensureMonth(db, ym), day = { ...M.days[d] };
    if (day.a) day.a = [...day.a.slice(0, 3), 0];
    if (day.p) day.p = [...day.p.slice(0, 3), 0];
    WT.setDay(M, d, day); changed(ym); toast(`${dLabel(date)} 추가제외 삭제`); render();
  },
  editSet(el) { ui.editSet = el.dataset.id; render(); (document.querySelector('#s-name') || document.body).closest('.card').scrollIntoView({ block: 'start' }); },
  cancelSet() { ui.editSet = null; render(); },
  saveSet() {
    const isNew = ui.editSet === 'new', old = isNew ? {} : setOf(ui.editSet), name = $('#s-name').value.trim();
    if (!name) return toast('이름을 입력하세요', 1);
    if (db.sets.some((s) => s.name === name && s.id !== old.id)) return toast('같은 이름의 세트가 있습니다', 1);
    const s = { ...old, name, color: $('#s-color').value };
    if (!old.fam) {
      const v = checkFour([0, 1, 2, 3].map((i) => readTime('s-' + i)));
      if (typeof v === 'string') return toast(v, 1);
      s.t = v;
      const short = WT.exShort(v);
      if (short) toast(`저장했습니다. ⚠ 제외 최소 ${F(short)} 미달`, 1);
    }
    if (isNew) db.sets.push({ ...s, id: 's' + Date.now().toString(36) }); else db.sets[db.sets.indexOf(old)] = s;
    ui.editSet = null; save(); render();
  },
  moveSet(el) {
    const i = +el.dataset.i, j = i + +el.dataset.n;
    [db.sets[i], db.sets[j]] = [db.sets[j], db.sets[i]]; save(); render();
  },
  delSet(el) {
    const s = setOf(el.dataset.id);
    if (!confirm(`'${s.name}' 세트를 지울까요?\n이미 날짜에 넣은 예정 시간은 그대로 남습니다.`)) return;
    db.sets = db.sets.filter((x) => x !== s); if (ui.setId === s.id) ui.setId = null; save(); render();
  },
  exportYear(el) { exportYear(+el.dataset.y, el.dataset.kind); },
};
