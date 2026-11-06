// 계산·엑셀 테스트 (Node만 있으면 됨). 기준: 2026년 11월 엑셀 사진의 값
// 실행: node tools/calc-test.js   → 마지막 줄이 "OK" 이면 통과
const zlib = require('zlib');
const WT = require('../src/core.js');
const X = require('../src/xlsx.js');

const fails = [];
const norm = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const check = (name, got, want) => {
  const ok = norm(got) === norm(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  if (!ok) fails.push(name);
};
const F = WT.fmt, H = WT.parseHM;

// 2026-11 사진: [일, 출근, 퇴근, 제외]. 오늘 11/6 → 2~5일 실제, 6일부터 예정
const NOV = [[2, '8:07', '18:26', '1:30'], [3, '8:20', '18:32', '1:31'], [4, '8:16', '19:05', '1:16'], [5, '8:12', '18:23', '1:24'],
  [6, '8:10', '18:30', '1:40'], [9, '9:00', '18:00', '1:40'], [10, '9:00', '18:00', '1:40'], [11, '8:21', '18:00', '1:15'],
  [12, '9:00', '18:00', '1:00'], [13, '8:21', '18:30', '1:40'], [16, '8:21', '18:30', '1:40'], [17, '8:21', '18:00', '1:15'],
  [18, '9:00', '18:00', '1:00'], [19, '9:00', '18:00', '1:00'], [20, '8:21', '18:30', '1:40'], [23, '9:00', '18:00', '1:00'],
  [24, '9:00', '18:00', '1:00'], [25, '9:50', '13:00', '0:45'], [26, '9:00', '17:00', '1:00'], [27, '9:00', '13:15', '0:00'],
  [30, '9:00', '18:00', '1:00']];
const TODAY = '2026-11-06';
function novDB() {
  const db = WT.newDB(), M = WT.ensureMonth(db, '2026-11');
  M.cfg = { base: 0, baseOT: H('14:00'), rate: 34246, max: H('230:00') };
  M.ok = true;
  for (const [d, i, o, e] of NOV) M.days[d] = { s: 'normal', [d < 6 ? 'a' : 'p']: [H(i), H(o), H(e), 0] };
  return db;
}

// 1. 시간 입력 형식
check('시간 입력', ['9:50', '950', '0950', '9', '18:42', '', '9:60', 'ab', '-4:55'].map(H), [590, 590, 590, 540, 1122, null, NaN, NaN, -295]);
check('시간 표시', [F(9785), F(-295), F(270, true), F(0)], ['163:05', '-4:55', '+4:30', '0:00']);

// 2. 11월 사진 값
let db = novDB();
let c = WT.calcMonth(db, '2026-11', TODAY);
check('일 실근무 2일·25일·27일', [2, 25, 27].map((d) => F(c.rows[d - 1].wt)), ['8:49', '2:25', '4:15']);
check('일 차이 9일·25일', [9, 25].map((d) => F(c.rows[d - 1].diff)), ['-0:40', '-5:35']);
check('월 합계 (WT Tot / Std Tot / OT Tot)', [F(c.total.wt), F(c.total.std), F(c.total.diff)], ['163:05', '168:00', '-4:55']);
check('평일 수', WT.monthStats(db, '2026-11').W, 21);
const y = WT.untilYesterday(c, TODAY);
check('전일(11/5)까지 실근무·의무·차이', [F(y.cumWT), F(y.cumStd), F(y.cumDiff)], ['35:50', '32:00', '3:50']);
check('오늘(11/6) 여유시간', F(WT.slack(db, TODAY), true), '+4:30');
check('남은 가능시간 (230:00 기준)', F(c.total.remain), '66:55');
check('초과인정 (기본초과 14:00)', F(c.total.otRecog), '-18:55');
check('초과수당 음수 → 0원', c.total.pay, 0);
db.months['2026-11'].cfg.baseOT = -H('23:50'); // 초과인정 +18:55 로 만들어 금액 공식 확인
check('초과수당 공식 18:55 × 34,246원', WT.calcMonth(db, '2026-11', TODAY).total.pay, 647820);

// 3. 기본근무시간은 누적 실근무에 더해짐
db = novDB(); db.months['2026-11'].cfg.base = 600;
c = WT.calcMonth(db, '2026-11', TODAY);
check('기본근무 10:00 반영', [F(c.total.wt), F(WT.slack(db, TODAY), true)], ['173:05', '+14:30']);

// 4. 추가제외: 회사 시스템에 기록되는 시간을 줄이므로 남은 가능시간만 늘고, 차이·초과는 그대로
db = novDB(); db.months['2026-11'].days[12].a = [540, 1080, 60, 60];
c = WT.calcMonth(db, '2026-11', TODAY);
check('추가제외 1:00 → 남은 가능만 늘고 차이·초과는 그대로', [F(c.total.remain), F(c.total.diff), F(c.total.otRecog), F(c.rows[11].wtGH)], ['67:55', '-4:55', '-18:55', '7:00']);
check('추가제외 경고: 11/24 전 없음', WT.addExAlerts(db, '2026-11-24').length, 0);
check('추가제외 경고: 11/26(마지막 평일 3일) 주황', WT.addExAlerts(db, '2026-11-26').map((a) => a.level), ['orange']);
check('추가제외 경고: 12/1 빨강', WT.addExAlerts(db, '2026-12-01').map((a) => [a.level, a.count, F(a.sum)]), [['red', 1, '1:00']]);

// 5. 미입력, 입력할 날
db = novDB(); delete db.months['2026-11'].days[4].a;
check('미입력 11/4', WT.missingDays(db, TODAY), ['2026-11-04']);
db.months['2026-11'].days[4].p = [496, 1145, 76, 0];
c = WT.calcMonth(db, '2026-11', TODAY);
check('미입력 날은 계획값으로 계산 (미입력 표시는 남음)', [c.rows[3].missing, c.rows[3].src, F(c.total.wt)], [true, 'p', '163:05']);
check('입력할 날 = 가장 오래된 미입력', WT.defaultEntryDate(db, TODAY), '2026-11-04');
db = novDB();
check('입력할 날 = 직전 평일 (월요일 11/9 → 금요일 11/6)', WT.defaultEntryDate(db, '2026-11-09'), '2026-11-06');
check('내일 = 다음 영업일 (10/2 금 → 10/6 화, 10/5 대체공휴일)', WT.nextWorkday(WT.newDB(), '2026-10-02'), '2026-10-06');
check('전일 = 전 영업일 (10/5 대체공휴일 다음날 10/6 → 10/2 금)', WT.prevWorkday(WT.newDB(), '2026-10-06'), '2026-10-02');

// 6. 제외시간 최소 기준
check('제외 경고', [['9:00', '13:15', '0:00'], ['9:00', '13:30', '0:00'], ['9:50', '18:42', '0:45'], ['9:00', '18:00', '0:45'], ['9:00', '18:00', '1:00']]
  .map(([i, o, e]) => F(WT.exShort([H(i), H(o), H(e), 0]))), ['0:00', '0:30', '0:00', '1:00', '0:00']);
check('시간당 금액 기본값 = 사진 기준 34,246원', WT.newDB() && WT.DEFAULT_CFG.rate, 34246);
check('기본 세트는 모두 기준 통과', WT.newDB().sets.filter((s) => s.t && WT.exShort(s.t)).length, 0);

// 7. 패밀리데이: 의무 8:00, 실근무 0
db = novDB(); WT.applySet(db, '2026-11', 13, db.sets[0]);
c = WT.calcMonth(db, '2026-11', TODAY);
check('패밀리데이 13일', [c.rows[12].kind, F(c.rows[12].wt), F(c.rows[12].diff), F(c.total.diff)], ['F', '0:00', '-8:00', '-13:24']);

// 8. 계획: 세트 토글, 빈 날 모두, 휴일 지정
db = WT.newDB();
const normal = db.sets.find((s) => s.id === 'normal'), home = db.sets.find((s) => s.id === 'home');
WT.applySet(db, '2026-12', 2, home);
check('빈 날 모두 (12월 평일 22일 중 1일 이미 입력)', WT.fillEmpty(db, '2026-12', normal), 21);
check('같은 세트 다시 누르면 해제', [WT.applySet(db, '2026-12', 2, home), db.months['2026-12'].days[2]], [null, undefined]);
check('공휴일(12/25)엔 세트 불가', WT.applySet(db, '2026-12', 25, normal), '휴일에는 세트를 넣을 수 없습니다');
WT.cycleKind(db, '2026-12', 3);
check('휴일 지정 12/3 → 공휴일, 예정 지움', [WT.kindOf(db.months['2026-12'], '2026-12', 3), db.months['2026-12'].days[3]], ['H', { k: 'H' }]);
WT.cycleKind(db, '2026-12', 3); WT.cycleKind(db, '2026-12', 3);
check('휴일 지정 한 바퀴 → 평일', db.months['2026-12'].days[3], undefined);
check('12월 의무', F(WT.monthStats(db, '2026-12').std), '176:00');

// 8-1. 날짜별 의무시간: 12/4를 4:00으로 → 월 의무 172:00
db.months['2026-12'].days[4].std = 240;
check('날짜별 의무 반영', [F(WT.monthStats(db, '2026-12').std), F(WT.calcMonth(db, '2026-12', '2026-12-01').rows[3].diff)], ['172:00', '4:07']);

// 9. 새 달 설정은 전월 값을 가져옴
db = novDB(); WT.ensureMonth(db, '2026-12');
check('12월 설정 = 11월 설정 (최대가능시간만 자동)', db.months['2026-12'].cfg, { ...db.months['2026-11'].cfg, max: null });
db.months['2026-11'].cfg.max = null;
c = WT.calcMonth(db, '2026-11', TODAY);
check('최대가능시간 자동 = 주 52시간 (52 × 30일 ÷ 7)', [F(c.total.max), F(c.total.remain)], ['222:51', '59:46']);

// 10. 2개월 지난 달
check('달 차이', [WT.monthAge('2026-11', '2026-11'), WT.monthAge('2026-10', '2026-11'), WT.monthAge('2026-09', '2026-11'), WT.monthAge('2025-12', '2026-02')], [0, 1, 2, 2]);

// 11. 지난해 정리
db = novDB(); WT.ensureMonth(db, '2027-01');
db.modAt[2026] = 1000;
check('연최종본 없으면 안 지움', WT.cleanupYears(db, '2027-02-01'), []);
check('백업 안내: 연최종본', WT.backupAlerts(db, '2027-01-10', Date.now()), ['2026년 연최종본 엑셀을 저장하세요']);
db.backup.finals[2026] = { name: 'x', at: 2000 };
check('1월에는 안 지움', WT.cleanupYears(db, '2027-01-31'), []);
check('2월에 지움', WT.cleanupYears(db, '2027-02-01'), ['2026-11']);

(async () => {
  // 12. 엑셀 저장 → 불러오기 (무압축, 엑셀이 다시 저장한 것처럼 압축한 것 둘 다)
  const inflate = async (b) => new Uint8Array(zlib.inflateRawSync(b));
  db = novDB(); db.months['2026-11'].days[12].p[3] = 60; WT.cycleKind(db, '2026-11', 19); WT.applySet(db, '2026-11', 20, db.sets[0]);
  db.months['2026-11'].cfg.base = 90; db.months['2026-11'].days[13].std = 300; // 날짜별 의무도 엑셀로 왕복
  const sheets = WT.toSheets(db, '2026', '최신본', '2026-11-06 09:05', TODAY);
  for (const [label, deflate] of [['무압축', null], ['압축', (b) => new Uint8Array(zlib.deflateRawSync(b))]]) {
    const bytes = X.write(sheets, deflate);
    const parsed = WT.fromSheets(await X.read(bytes, inflate));
    const db2 = WT.newDB(); const r = WT.mergeImport(db2, parsed, '2026-12-01');
    check(`엑셀 왕복(${label}) 데이터 같음`, [r, parsed.year, parsed.kind, db2.months['2026-11']], [{ replaced: ['2026-11'], kept: [] }, '2026', '최신본', db.months['2026-11']]);
    if (label === '무압축') console.log('      파일 크기', (bytes.length / 1024).toFixed(1) + 'KB');
  }
  // 불러와도 당월은 바뀌지 않음
  const parsed = WT.fromSheets(await X.read(X.write(sheets), inflate));
  const db3 = novDB(); db3.months['2026-11'].days[2].a[0] = 0;
  check('당월에 데이터가 있으면 불러와도 그대로', [WT.mergeImport(db3, parsed, TODAY), db3.months['2026-11'].days[2].a[0]], [{ replaced: [], kept: ['2026-11'] }, 0]);
  const db4 = WT.newDB(); WT.ensureMonth(db4, '2026-11');
  check('당월이 비어 있으면 채움', WT.mergeImport(db4, parsed, TODAY), { replaced: ['2026-11'], kept: [] });
  check('2년 전 파일 거부', WT.mergeImport(WT.newDB(), parsed, '2028-01-05').error, '2026년은 연최종본 엑셀로만 보관하는 해입니다');
  // 엑셀에서 시간을 글자로 고쳐 넣은 경우
  sheets[1].rows[4 + 1][8] = '8:00';
  check('엑셀에 글자로 쓴 시간도 읽음', WT.fromSheets(await X.read(X.write(sheets), inflate)).months['2026-11'].days[2].a[0], 480);

  // 13. 데이터 크기 (1년 꽉 채움)
  db = WT.newDB();
  for (let m = 1; m <= 12; m++) { const ym = '2026-' + WT.pad(m); WT.fillEmpty(db, ym, db.sets[5]); for (const d of Object.keys(db.months[ym].days)) db.months[ym].days[d].a = db.months[ym].days[d].p.slice(); }
  const kb = JSON.stringify(db).length / 1024;
  console.log('      1년치 저장 데이터', kb.toFixed(1) + 'KB');
  check('1년치 데이터 40KB 이하', kb < 40, true);

  // 계획은 제외 규칙에 맞게 고침: 9:00 이상 머물면 1:00, 4:30 이상이면 0:30. 실제값은 그대로
  check('fixEx: 9:50~19:10 제외 0:45 → 1:00', WT.fixEx([590, 1150, 45, 30]), [590, 1150, 60, 30]);
  check('fixEx: 규칙에 맞으면 그대로', WT.fixEx([590, 1122, 45, 0]), [590, 1122, 45, 0]);
  { const d2 = WT.newDB(), M = WT.ensureMonth(d2, '2026-11'); M.days[3] = { p: [540, 1140, 0, 0], a: [540, 1140, 0, 0] }; M.days[4] = { p: [590, 1122, 45, 0] };
    check('fixPlans: 안 맞는 계획만 고침, 실제값은 그대로', [WT.fixPlans(d2), M.days[3].p[2], M.days[3].a[2], WT.fixPlans(d2)], [1, 60, 0, 0]); }

  console.log(fails.length ? `\n${fails.length}개 실패` : '\nOK');
  process.exit(fails.length ? 1 : 0);
})();
