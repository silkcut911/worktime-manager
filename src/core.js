// 계산 규칙 (브라우저·Node 테스트 공용). 시간은 모두 '분' 정수, 날짜 'YYYY-MM-DD', 달 'YYYY-MM', 일은 숫자.
// 데이터: db = { v, sets:[세트], months:{ 'YYYY-MM': { cfg, ok, days:{ 일: { k?, s?, p?, a? } } } }, backup, modAt }
//   k: 날짜 종류를 기본값과 다르게 지정한 경우만 ('W' 평일 'H' 공휴일 'F' 패밀리데이), s: 세트 id, std: 그날 의무시간(8:00과 다를 때만)
//   p: 예정 [출근, 퇴근, 제외, 추가제외], a: 실제 [출근, 퇴근, 제외, 추가제외]
//   cfg: { base 월 기본근무시간, baseOT 기본초과시간, rate 시간당 금액(원), max 월 최대가능시간(null = 주 52시간 기준) }
var WT = (function () {
  const HOL = typeof HOLIDAYS !== 'undefined' ? HOLIDAYS : require('./holidays.js');
  const STD = 480; // 일 의무시간 8:00 (평일·패밀리데이)
  const RATE = 34246; // 시간당 금액 기본값: 2026년 11월 엑셀의 18:55 → 647,820원에서 계산
  const DEFAULT_CFG = { base: 0, baseOT: 840, rate: RATE, max: null }; // max 비어 있으면 주 52시간 기준
  const DEFAULT_SETS = [
    { id: 'fam', name: 'Family Day', color: '#f4a6c6', fam: true },
    { id: 'home', name: 'Home Office', color: '#8fd19e', t: [540, 1080, 60, 0] },
    { id: 'club', name: 'Club Day', color: '#ffd166', t: [590, 1100, 30, 0] },
    { id: 'early', name: 'Early', color: '#7fb3f5', t: [500, 1200, 60, 0] },
    { id: 'edu', name: 'Training', color: '#c3a6f0', t: [500, 1105, 90, 0] },
    { id: 'normal', name: 'Regular', color: '#d9dde3', t: [590, 1122, 45, 0] },
  ];
  const KIND_NAME = { W: '평일', O: '주말', H: '공휴일', F: '패밀리데이' };
  const pad = (n) => String(n).padStart(2, '0');

  // '950' '0950' '9:50' '9' → 분 (숫자 1~2자리는 시, 3자리 이상은 끝 두 자리가 분: '030' = 0:30, '23000' = 230:00). 빈칸 → null, 형식 오류 → NaN
  function parseHM(s) {
    if (s == null) return null;
    s = String(s).trim();
    if (!s) return null;
    let m = s.match(/^(-?)(\d{1,3}):(\d{2})$/);
    if (m) return +m[3] < 60 ? (m[1] ? -1 : 1) * (+m[2] * 60 + +m[3]) : NaN;
    if (!/^\d{1,5}$/.test(s)) return NaN;
    if (s.length <= 2) return +s * 60;
    const mi = +s.slice(-2);
    return mi < 60 ? +s.slice(0, -2) * 60 + mi : NaN;
  }
  const fmt = (min, sign) => (min == null ? '' : (min < 0 ? '-' : sign && min > 0 ? '+' : '') + Math.floor(Math.abs(min) / 60) + ':' + pad(Math.abs(min) % 60));
  const won = (n) => n.toLocaleString('ko-KR') + '원';

  const localToday = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
  const daysIn = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 0)).getUTCDate();
  const dow = (ym, d) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1, d)).getUTCDay(); // 0=일
  const addMonths = (ym, n) => { const t = +ym.slice(0, 4) * 12 + +ym.slice(5) - 1 + n; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`; };
  const monthAge = (ym, cur) => (+cur.slice(0, 4) - +ym.slice(0, 4)) * 12 + (+cur.slice(5) - +ym.slice(5));
  const dateStr = (ym, d) => `${ym}-${pad(d)}`;
  const addDays = (date, n) => { const t = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8) + n)); return t.toISOString().slice(0, 10); };

  const holidayName = (ym, d) => HOL[dateStr(ym, d)] || '';
  const defaultKind = (ym, d) => { const w = dow(ym, d); return w === 0 || w === 6 ? 'O' : holidayName(ym, d) ? 'H' : 'W'; };
  const kindOf = (M, ym, d) => (M && M.days[d] && M.days[d].k) || defaultKind(ym, d);
  const stdOf = (kind) => (kind === 'W' || kind === 'F' ? STD : 0);
  // 그날 의무시간: 근무일(평일·패밀리데이)은 8:00, 직접 바꾼 값이 있으면 그 값
  const stdDay = (day, kind) => (kind === 'W' || kind === 'F' ? (day && day.std != null ? day.std : STD) : 0);
  // 월 최대가능시간 기본값: 주 52시간 × 그달 일수 ÷ 7
  const max52 = (ym) => Math.floor((52 * 60 * daysIn(ym)) / 7);

  // 머문 시간 4:30 이상 → 제외 최소 0:30, 9:00 이상 → 1:00. 부족하면 최소값, 아니면 0
  const exNeed = (stay) => (stay >= 540 ? 60 : stay >= 270 ? 30 : 0);
  const exShort = (v) => { const need = exNeed(v[1] - v[0]); return v[2] < need ? need : 0; };

  const AUTO = { stay: 472, ex: 45 }; // 출근 입력 시 자동: 퇴근 = 출근 + 7:52, 제외 0:45
  const newDB = () => ({ v: 1, auto: { ...AUTO }, sets: DEFAULT_SETS.map((s) => ({ ...s, t: s.t && s.t.slice() })), months: {}, backup: { latest: null, finals: {} }, modAt: {} });
  // 새 달 설정: 전월 값을 가져오되 최대가능시간은 달마다 근무일이 달라 자동(null)으로
  const prevCfg = (db, ym) => { const p = Object.keys(db.months).filter((x) => x < ym).sort().pop(); return { ...(p ? db.months[p].cfg : DEFAULT_CFG), max: null }; };
  const peekMonth = (db, ym) => db.months[ym] || { cfg: prevCfg(db, ym), ok: false, days: {} };
  function ensureMonth(db, ym) {
    if (!db.months[ym]) db.months[ym] = { cfg: prevCfg(db, ym), ok: false, days: {} };
    return db.months[ym];
  }
  const touch = (db, ym) => { db.modAt[ym.slice(0, 4)] = Date.now(); };
  const hasData = (M) => !!M && (M.ok || Object.keys(M.days).length > 0);
  function setDay(M, d, day) { if (Object.keys(day).length) M.days[d] = day; else delete M.days[d]; }

  // 한 달 계산. 실제값이 있으면 실제값, 없으면 계획값(지난날이면 미입력 표시)
  function calcMonth(db, ym, today) {
    const M = peekMonth(db, ym), cfg = M.cfg, tym = today.slice(0, 7), td = +today.slice(8);
    const rows = [];
    let cumWT = cfg.base, cumStd = 0, cumAdd = 0;
    for (let d = 1; d <= daysIn(ym); d++) {
      const day = M.days[d] || {}, kind = kindOf(M, ym, d), std = stdDay(day, kind);
      const rel = ym < tym ? -1 : ym > tym ? 1 : Math.sign(d - td); // -1 지난날, 0 오늘, 1 미래
      let v = null, src = null;
      if (kind !== 'F') { if (day.a) { v = day.a; src = 'a'; } else if (day.p) { v = day.p; src = 'p'; } }
      const wt = v ? v[1] - v[0] - v[2] : 0, add = v ? v[3] : 0;
      cumWT += wt; cumStd += std; cumAdd += add;
      rows.push({ d, date: dateStr(ym, d), dow: dow(ym, d), kind, std, day, v, src, wt, add, wtGH: wt - add, diff: wt - std,
        cumWT, cumStd, cumDiff: cumWT - cumStd, cumAdd, missing: rel < 0 && kind === 'W' && !day.a, exShort: v ? exShort(v) : 0, rel });
    }
    const diff = cumWT - cumStd, otRecog = diff - cfg.baseOT, max = cfg.max == null ? max52(ym) : cfg.max;
    const total = { wt: cumWT, std: cumStd, diff, add: cumAdd, wtGH: cumWT - cumAdd, max, remain: max - (cumWT - cumAdd),
      otRecog, pay: otRecog > 0 ? Math.floor((otRecog * cfg.rate) / 60) : 0, missing: rows.filter((r) => r.missing).length };
    return { ym, M, cfg, rows, total };
  }
  // 전일까지(당월이면 어제까지, 지난달은 월말, 미래 달은 0)
  function untilYesterday(calc, today) {
    const tym = today.slice(0, 7), base = { cumWT: calc.cfg.base, cumStd: 0, cumDiff: calc.cfg.base };
    if (calc.ym < tym) return calc.rows[calc.rows.length - 1];
    if (calc.ym > tym) return base;
    return calc.rows[+today.slice(8) - 2] || base;
  }
  // 오늘 기준 여유시간 = (기본근무 + 어제까지 실제 + 오늘 예정/실제) − 오늘까지 의무
  const slack = (db, today) => calcMonth(db, today.slice(0, 7), today).rows[+today.slice(8) - 1].cumDiff;

  const pastMonths = (db, today) => Object.keys(db.months).filter((ym) => ym <= today.slice(0, 7)).sort();
  const missingDays = (db, today) => pastMonths(db, today).flatMap((ym) => calcMonth(db, ym, today).rows.filter((r) => r.missing).map((r) => r.date));
  function lastWorkdayFrom(db, ym, n) {
    const M = peekMonth(db, ym), w = [];
    for (let d = 1; d <= daysIn(ym); d++) if (kindOf(M, ym, d) === 'W') w.push(d);
    return w[Math.max(0, w.length - n)] || daysIn(ym);
  }
  // 추가제외가 남은 달: 지난달이면 red, 당월 마지막 평일 3일부터 orange
  function addExAlerts(db, today) {
    const out = [], tym = today.slice(0, 7);
    for (const ym of pastMonths(db, today)) {
      const rows = calcMonth(db, ym, today).rows.filter((r) => r.add > 0);
      if (!rows.length) continue;
      const level = ym < tym ? 'red' : +today.slice(8) >= lastWorkdayFrom(db, ym, 3) ? 'orange' : null;
      if (level) out.push({ ym, level, count: rows.length, sum: rows.reduce((a, r) => a + r.add, 0) });
    }
    return out;
  }
  // 전일 = 전 영업일(주말·공휴일·패밀리데이를 건너뛴 직전 평일)
  function prevWorkday(db, today) {
    for (let i = 1; i <= 31; i++) {
      const date = addDays(today, -i), ym = date.slice(0, 7);
      if (kindOf(db.months[ym], ym, +date.slice(8)) === 'W') return date;
    }
    return addDays(today, -1);
  }
  // 내일 = 다음 영업일
  function nextWorkday(db, today) {
    for (let i = 1; i <= 31; i++) {
      const date = addDays(today, i), ym = date.slice(0, 7);
      if (kindOf(db.months[ym], ym, +date.slice(8)) === 'W') return date;
    }
    return addDays(today, 1);
  }
  // 입력할 날: 가장 오래된 미입력일, 없으면 전일
  const defaultEntryDate = (db, today) => missingDays(db, today)[0] || prevWorkday(db, today);

  // 계획: 세트 넣기(같은 세트를 다시 누르면 해제)
  function applySet(db, ym, d, set) {
    const M = ensureMonth(db, ym), day = { ...(M.days[d] || {}) }, kind = kindOf(M, ym, d);
    if (kind === 'O' || kind === 'H') return '휴일에는 세트를 넣을 수 없습니다';
    if (day.s === set.id) { delete day.s; delete day.p; if (day.k === 'F') delete day.k; }
    else if (set.fam) { day.k = 'F'; day.s = set.id; delete day.p; }
    else { day.s = set.id; day.p = set.t.slice(); if (day.k === 'F') delete day.k; }
    setDay(M, d, day); touch(db, ym);
    return null;
  }
  function fillEmpty(db, ym, set) {
    const M = ensureMonth(db, ym); let n = 0;
    for (let d = 1; d <= daysIn(ym); d++) {
      const day = M.days[d] || {};
      if (kindOf(M, ym, d) === 'W' && !day.s && !day.p) { applySet(db, ym, d, set); n++; }
    }
    return n;
  }
  // 휴일 지정: 평일 → 공휴일 → 패밀리데이 → 평일
  function cycleKind(db, ym, d) {
    const dk = defaultKind(ym, d);
    if (dk === 'O') return '주말은 바꿀 수 없습니다';
    const M = ensureMonth(db, ym), day = { ...(M.days[d] || {}) }, next = { W: 'H', H: 'F', F: 'W' }[kindOf(M, ym, d)];
    delete day.s; delete day.p; delete day.std;
    if (next === 'F') { const fam = db.sets.find((s) => s.fam); if (fam) day.s = fam.id; }
    if (next === dk) delete day.k; else day.k = next;
    setDay(M, d, day); touch(db, ym);
    return null;
  }
  function monthStats(db, ym) {
    const M = peekMonth(db, ym), st = { W: 0, F: 0, H: [], std: 0 };
    for (let d = 1; d <= daysIn(ym); d++) {
      const k = kindOf(M, ym, d);
      if (k === 'W') st.W++; else if (k === 'F') st.F++; else if (k === 'H') st.H.push({ d, name: holidayName(ym, d) || '지정 휴일' });
      st.std += stdDay(M.days[d], k);
    }
    return st;
  }

  // 백업 안내: 최신본 7일 경과, 전년 연최종본 미저장(또는 저장 뒤 수정됨)
  function backupAlerts(db, today, now) {
    const out = [], y = +today.slice(0, 4), latest = db.backup.latest;
    const has = (yy) => Object.keys(db.months).some((ym) => ym.startsWith(yy + '-') && hasData(db.months[ym]));
    if (has(y)) {
      if (!latest) out.push('아직 엑셀로 저장한 적이 없습니다');
      else { const days = Math.floor((now - latest.at) / 864e5); if (days >= 7) out.push(`엑셀 최신본을 저장한 지 ${days}일 지났습니다`); }
    }
    for (const yy of [...new Set(Object.keys(db.months).map((ym) => +ym.slice(0, 4)))].filter((x) => x < y)) {
      const f = db.backup.finals[yy];
      if (has(yy) && (!f || f.at < (db.modAt[yy] || 0))) out.push(`${yy}년 연최종본 엑셀을 저장하세요`);
    }
    return out;
  }
  // 지난해 정리: 연최종본을 저장했고(그 뒤 수정 없음) 2월이 되었으면 앱에서 지움
  function cleanupYears(db, today) {
    const y = +today.slice(0, 4), m = +today.slice(5, 7), gone = [];
    for (const ym of Object.keys(db.months)) {
      const yy = +ym.slice(0, 4), f = db.backup.finals[yy];
      if (yy < y && (yy < y - 1 || m >= 2) && f && f.at >= (db.modAt[yy] || 0)) { delete db.months[ym]; gone.push(ym); }
    }
    return gone;
  }

  // ── 엑셀 (1년 = 1파일) ──
  const tcell = (m) => (m == null ? null : { v: m / 1440, s: 'time' });
  const dcell = (m) => ({ v: m / 1440, s: 'dur' });
  const HEAD = ['일', '요일', '구분', '세트', '예정출근', '예정퇴근', '예정제외', '예정추가제외', '출근', '퇴근', '제외', '추가제외',
    '실근무', '의무', '일차이', '누적실근무', '누적차이', '비고'];
  const B = (v) => ({ v, s: 'b' });
  const DOWS = '일월화수목금토';

  function toSheets(db, year, kind, savedAt, today) {
    const yms = Object.keys(db.months).filter((ym) => ym.startsWith(year + '-')).sort();
    const sum = [[B('연도'), +year], [B('종류'), kind], [B('저장일시'), savedAt], [],
      ['월', '실근무', '의무', '누적차이', '추가제외', '초과인정', '초과수당'].map(B)];
    const months = yms.map((ym) => {
      const c = calcMonth(db, ym, today), t = c.total, cfg = c.cfg;
      sum.push([+ym.slice(5) + '월', fmt(t.wt), fmt(t.std), fmt(t.diff), fmt(t.add), fmt(t.otRecog), { v: t.pay, s: 'won' }]);
      const setName = (id) => (db.sets.find((s) => s.id === id) || {}).name || '';
      const rows = [[B(`${year}년 ${+ym.slice(5)}월`)],
        ['기본근무', dcell(cfg.base), '기본초과', dcell(cfg.baseOT), '시간당금액', { v: cfg.rate, s: 'won' }, '최대가능', cfg.max == null ? '' : dcell(cfg.max), '월초확인', c.M.ok ? 'Y' : ''],
        [], HEAD.map(B)];
      for (const r of c.rows) {
        const p = r.day.p || [], a = r.day.a || [];
        rows.push([r.d, DOWS[r.dow], KIND_NAME[r.kind], setName(r.day.s), ...[0, 1, 2, 3].map((i) => tcell(p[i])), ...[0, 1, 2, 3].map((i) => tcell(a[i])),
          fmt(r.wt), r.std ? tcell(r.std) : '', fmt(r.diff), fmt(r.cumWT), fmt(r.cumDiff),
          [r.missing && '미입력', r.src === 'p' && '예정값', r.exShort && `제외 최소 ${fmt(r.exShort)}`].filter(Boolean).join(', ')]);
      }
      rows.push([], [B('월 실근무'), fmt(t.wt)], [B('월 의무'), fmt(t.std)], [B('누적 차이'), fmt(t.diff)], [B('추가제외 합계'), fmt(t.add)],
        [B('남은 가능시간'), fmt(t.remain)], [B('초과인정'), fmt(t.otRecog)], [B('초과수당'), { v: t.pay, s: 'won' }]);
      return { name: ym.slice(5) + '월', rows, cols: [5, 5, 9, 9, 8, 8, 8, 10, 7, 7, 7, 8, 8, 7, 8, 10, 9, 18] };
    });
    const sets = [['순서', '이름', '색', '출근', '퇴근', '제외', '추가제외', '패밀리데이'].map(B),
      ...db.sets.map((s, i) => [i + 1, s.name, s.color, ...(s.t ? s.t.map(tcell) : [null, null, null, null]), s.fam ? 'Y' : ''])];
    return [{ name: '연간요약', rows: sum, cols: [10, 10, 10, 10, 10, 10, 12] }, ...months, { name: '세트', rows: sets, cols: [6, 12, 10, 8, 8, 8, 9, 10] }];
  }

  const cellMin = (v) => (typeof v === 'number' ? Math.round(v * 1440) : v == null || v === '' ? null : parseHM(v));
  // 엑셀 시트 → { year, kind, savedAt, sets, months }. 세트는 이름으로 적혀 있음(mergeImport에서 id로 바꿈)
  function fromSheets(sheets) {
    const info = sheets['연간요약'];
    if (!info || !info[0] || !/^\d{4}$/.test(String(info[0][1]))) throw new Error('근무시간 엑셀이 아닙니다 (연간요약 시트의 연도 확인)');
    const year = String(info[0][1]), errs = [];
    const four = (row, i, label) => {
      const v = [0, 1, 2, 3].map((k) => cellMin(row[i + k]));
      if (v[0] == null && v[1] == null) return null;
      if (v.some(Number.isNaN) || v[0] == null || v[1] == null || v[1] <= v[0]) { errs.push(`${label}: 시간 확인`); return null; }
      return [v[0], v[1], v[2] || 0, v[3] || 0];
    };
    const sets = (sheets['세트'] || []).slice(1).filter((r) => r && r[1]).map((r) => {
      const t = [3, 4, 5, 6].map((i) => cellMin(r[i]));
      return r[7] === 'Y' ? { name: String(r[1]), color: r[2] || '#f4a6c6', fam: true } : { name: String(r[1]), color: r[2] || '#d9dde3', t: t.map((x) => x || 0) };
    });
    const months = {}, KIND = Object.fromEntries(Object.entries(KIND_NAME).map(([k, v]) => [v, k]));
    for (let mm = 1; mm <= 12; mm++) {
      const rows = sheets[pad(mm) + '월'];
      if (!rows) continue;
      const ym = `${year}-${pad(mm)}`, c = rows[1] || [], days = {};
      const mx = cellMin(c[7]), cfg = { base: cellMin(c[1]) || 0, baseOT: cellMin(c[3]) || 0, rate: +c[5] || 0, max: mx == null || Number.isNaN(mx) ? null : mx };
      for (const r of rows.slice(4)) {
        if (!r || typeof r[0] !== 'number' || r[0] < 1 || r[0] > daysIn(ym)) continue;
        const d = r[0], day = {}, k = KIND[r[2]], dk = defaultKind(ym, d);
        if (k && dk !== 'O' && k !== 'O' && k !== dk) day.k = k;
        if (r[3]) day.s = String(r[3]);
        const sd = cellMin(r[13]);
        if ((k || dk) !== 'O' && (k || dk) !== 'H' && sd != null && !Number.isNaN(sd) && sd !== STD) day.std = sd;
        const p = four(r, 4, `${mm}월 ${d}일 예정`), a = four(r, 8, `${mm}월 ${d}일 실제`);
        if (p) day.p = p;
        if (a) day.a = a;
        if (Object.keys(day).length) days[d] = day;
      }
      months[ym] = { cfg, ok: c[9] === 'Y', days };
    }
    if (errs.length) throw new Error(errs.slice(0, 5).join(', ') + (errs.length > 5 ? ` 외 ${errs.length - 5}건` : ''));
    return { year, kind: String(info[1] && info[1][1] || ''), savedAt: String(info[2] && info[2][1] || ''), sets, months };
  }
  // 불러오기: 당월은 앱에 데이터가 없을 때만 채우고, 나머지 달은 파일 내용으로 교체. 세트는 없는 이름만 추가
  function mergeImport(db, parsed, today) {
    const y = +today.slice(0, 4), tym = today.slice(0, 7);
    if (+parsed.year < y - 1) return { error: `${parsed.year}년은 연최종본 엑셀로만 보관하는 해입니다` };
    for (const s of parsed.sets) if (!db.sets.some((x) => x.name === s.name)) db.sets.push({ ...s, id: 's' + Date.now().toString(36) + db.sets.length });
    const byName = Object.fromEntries(db.sets.map((s) => [s.name, s.id])), replaced = [], kept = [];
    for (const [ym, M] of Object.entries(parsed.months)) {
      if (ym === tym && hasData(db.months[ym])) { kept.push(ym); continue; }
      for (const day of Object.values(M.days)) if (day.s != null) { day.s = byName[day.s]; if (!day.s) delete day.s; }
      db.months[ym] = M; replaced.push(ym);
    }
    return { replaced, kept };
  }

  // 예전 한국어 기본 세트 이름 → 영어 (직접 바꾼 이름은 그대로)
  const OLD_NAMES = { '패밀리데이': 'Family Day', '재택근무': 'Home Office', '동호회일': 'Club Day', '조기근무': 'Early', '사내교육': 'Training', '일반근무': 'Regular' };
  return { STD, RATE, AUTO, OLD_NAMES, DEFAULT_CFG, KIND_NAME, parseHM, fmt, won, pad, localToday, daysIn, dow, addMonths, monthAge, dateStr, addDays,
    holidayName, defaultKind, kindOf, stdOf, stdDay, max52, exNeed, exShort, newDB, peekMonth, ensureMonth, touch, hasData, setDay,
    calcMonth, untilYesterday, slack, missingDays, addExAlerts, prevWorkday, nextWorkday, defaultEntryDate, applySet, fillEmpty, cycleKind, monthStats,
    backupAlerts, cleanupYears, toSheets, fromSheets, mergeImport };
})();
if (typeof module !== 'undefined') module.exports = WT;
