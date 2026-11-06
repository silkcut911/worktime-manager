// 화면 테스트: dist/worktime.html 을 headless Chrome(폰 폭 384px)으로 열어 주요 기능을 확인한다. 오늘은 2026-11-06으로 고정.
// 준비: 아무 폴더에서 `npm i puppeteer-core` 후 NODE_PATH 로 그 node_modules 를 지정하거나, 이 폴더에 설치.
//       Chrome 경로가 다르면 CHROME_PATH 환경변수로 지정. SHOT_DIR 를 주면 화면 사진을 저장.
// 실행: node build.js && node tools/calc-test.js && node tools/smoke-test.js   → 마지막 줄이 "OK" 이면 통과
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const puppeteer = require('puppeteer-core');
const WT = require('../src/core.js');
const X = require('../src/xlsx.js');

const URL = 'file:///' + path.resolve(__dirname, '../dist/worktime.html').replace(/\\/g, '/');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); if (!ok) fails.push(name); };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worktime-test-'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: tmp, args: process.env.CI ? ['--no-sandbox'] : [] });
  const page = await browser.newPage();
  await page.setViewport({ width: 384, height: 780, deviceScaleFactor: 2, isMobile: true });
  const errors = [], dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  let TODAY = '2026-11-06';
  await page.exposeFunction('__today', () => TODAY);
  await page.evaluateOnNewDocument(() => {
    window.WT_TODAY = '2026-11-06';
    const o = HTMLAnchorElement.prototype.click; // 다운로드는 실제로 받지 않고 기록만
    HTMLAnchorElement.prototype.click = function () { if (this.download) { (window.__downloads = window.__downloads || []).push(this.download); return; } return o.call(this); };
  });
  let numMode = true; // 1~8번은 숫자 입력으로 시험(기본은 휠 선택), 9번에서 휠 시험
  const open = async (h) => { // 매번 새로 읽음(데이터·날짜 바꾼 것 반영)
    await page.goto('about:blank'); await page.goto(URL + h); await wait(150);
    if (numMode) await page.evaluate(() => { if (db.inputMode !== 'num') { db.inputMode = 'num'; save(); render(); } });
  };
  const text = (sel) => page.$eval(sel, (e) => e.innerText);
  const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const shot = async (name) => { if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, name + '.png'), fullPage: true }); };
  const setDB = async (db) => { await page.evaluate((s) => localStorage.setItem('worktime-db', s), JSON.stringify(db)); };

  // 1. 처음 실행: 모든 화면이 오류 없이 열리고 폰 폭을 넘지 않음
  await open('');
  const widths = [];
  for (const h of ['#/today', '#/plan', '#/list', '#/month', '#/settings']) { await open(h); widths.push(await page.evaluate(() => document.documentElement.scrollWidth)); }
  check('모든 화면 오류 없음', errors.length === 0, errors.join(' | '));
  check('384px 폭 안에 들어감', widths.every((w) => w <= 384), JSON.stringify(widths));
  check('월초 확인 안내', (await text('#banners')).includes('11월 달력 확인'));
  check('맨 위 = 오늘 날짜', (await text('#hdate')) === '2026년 11월 6일 (금)', await text('#hdate'));

  // 2. 계획: 확인 → 일반근무 고르고 빈 날 모두 → 재택근무 하나, 패밀리데이 하나 → 11일 시간 조정 → [저장]
  await open('#/plan');
  await click('[data-act=confirmMonth]');
  await click('[data-act=pickSet][data-id=normal]'); await click('[data-act=fillEmpty]');
  await click('[data-act=pickSet][data-id=home]'); await click('[data-act=cal][data-d="10"]');
  await click('[data-act=pickSet][data-id=fam]'); await click('[data-act=cal][data-d="20"]');
  check('저장 전에는 반영 안 됨', await page.evaluate(() => Object.keys(db.months['2026-11'].days).length === 0 && ui.draft.dirty));
  await click('[data-act=mode][data-v=time]'); await click('[data-act=cal][data-d="11"]');
  check('시간 조정: 11일 일반근무 값이 채워짐', (await page.$eval('#p-in', (e) => e.value)) === '9:50');
  await page.$eval('#p-in', (e) => (e.value = '')); await page.type('#p-in', '8a2:0'); // 숫자만 받고 ':'는 자동
  check('숫자만 입력, : 자동', (await page.$eval('#p-in', (e) => e.value)) === '8:20');
  check('달력은 일요일부터', (await page.$eval('.cal .h', (e) => e.innerText)) === '일');
  await page.$eval('#p-out', (e) => { e.value = '1700'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  check('시간 조정 미리보기', (await text('#ppv')).includes('실근무 7:55'), await text('#ppv'));
  await click('[data-act=applyDay]');
  check('달력에 고친 날 표시(*)', (await page.$eval('[data-act=cal][data-d="11"]', (e) => e.innerText)).includes('7:55*'));
  check('계획 합계 표시', (await text('#view')).includes('계획 실근무'));
  await click('[data-act=mode][data-v=set]');
  check('세트 버튼에 값 표시', /9:50~18:42\s*\(-0:45\) : 8:07/.test(await text('.sets')), await text('.sets'));
  await click('[data-act=mode][data-v=time]'); await click('[data-act=cal][data-d="13"]');
  check('시간 조정에 세트 값 표시', (await text('#dayed')).includes('세트 값: 9:50~18:42'));
  await shot('2-plan');
  dialogs.length = 0;
  await click('[data-act=savePlan]'); await wait(100);
  check('저장 시 합계 안내', dialogs.some((m) => m.includes('계획 실근무') && m.includes('의무 168:00') && m.includes('차이')), dialogs[0]);
  const plan = await page.evaluate(() => { const d = db.months['2026-11'].days; return [Object.keys(d).length, d[10].s, d[20].k, d[11].p, d[12].p, db.months['2026-11'].ok]; });
  check('계획 저장 (21일, 10일 재택, 20일 패밀리데이, 11일 조정)', JSON.stringify(plan) === JSON.stringify([21, 'home', 'F', [500, 1020, 45, 0], [590, 1122, 45, 0], true]), JSON.stringify(plan));
  // 저장하지 않고 다른 화면으로 가면 묻기 (테스트는 '확인' → 저장)
  await click('[data-act=mode][data-v=set]'); await click('[data-act=pickSet][data-id=edu]'); await click('[data-act=cal][data-d="12"]');
  dialogs.length = 0;
  await page.evaluate(() => { location.hash = '#/list'; }); await wait(150);
  check('저장 안 하고 나가면 물어봄', dialogs.some((m) => m.includes('저장하지 않았습니다')) && (await page.evaluate(() => db.months['2026-11'].days[12].s)) === 'edu', dialogs[0]);
  check('미입력 띠는 맨 아래 (11/2~11/5)', (await text('#banners2')).includes('미입력 4일') && !(await text('#banners')).includes('미입력'));

  // 3. 오늘: 밀린 날(11/2~11/4)은 한 줄씩, 전일(11/5)은 실제, 오늘(11/6)은 계획
  await open('#/today');
  const t3 = await text('#view');
  check('밀린 날 한 줄 + 전일 + 오늘', t3.includes('밀린 날 3일') && t3.includes('전일 11/5(목) 실제') && t3.includes('오늘 11/6(금) 계획') && t3.includes('내일 11/9(월) 계획') && !t3.includes('전일까지 합계') && !t3.includes('계획: ') && (await page.$('#d-in')) === null, t3.slice(0, 120));
  await click('[data-act=nav][data-h="#/today?d=2026-11-02"]'); await wait(150);
  check('밀린 날 누르면 펼침, 계획값 채워짐', (await page.$eval('#d-in', (e) => e.value)) === '9:50');
  await page.$eval('#d-in', (e) => (e.value = ''));
  await page.type('#d-in', '807'); await page.$eval('#d-out', (e) => (e.value = '1826')); await page.$eval('#d-ex', (e) => (e.value = '130'));
  await page.$eval('#d-ex', (e) => e.dispatchEvent(new Event('input', { bubbles: true })));
  const pv3 = () => text('.dform[data-pre="d-"]');
  check('미리보기 계산', /실근무\s*8:49/.test(await pv3()), await pv3());
  check('미리보기: 당일 여유 · 월말 여유 · 저장 (시간 칸 아래 네 칸)', /당일 여유\s*\+0:49/.test(await pv3()) && /월말 여유\s*[+-]\d+:\d\d/.test(await pv3()) && (await page.$('.dform[data-pre="d-"] .grid5 [data-act=saveForm]')) !== null, await pv3());
  await page.$eval('#d-ex', (e) => { e.value = '45'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  check('제외 45 = 0:45, 최소 경고 (머문 10:19 → 1:00)', (await pv3()).includes('제외 최소 1:00') && /실근무\s*9:34/.test(await pv3()), await pv3());
  await page.$eval('#d-ex', (e) => (e.value = '130'));
  await click('[data-act=saveForm][data-pre="d-"]'); await wait(150);
  check('저장 후 밀린 날 2일', (await text('#view')).includes('밀린 날 2일'));
  check('11/2 실제값', JSON.stringify(await page.evaluate(() => db.months['2026-11'].days[2].a)) === '[487,1106,90,0]');
  await page.$eval('#f-ex', (e) => (e.value = '30')); await page.$eval('#f-ex', (e) => e.dispatchEvent(new Event('focusout', { bubbles: true })));
  check('제외 칸 30 → 0:30', (await page.$eval('#f-ex', (e) => e.value)) === '0:30');
  await shot('3-today');

  // 4. 사진의 11월 데이터로 합계 확인
  const NOV = [[2, 487, 1106, 90], [3, 500, 1112, 91], [4, 496, 1145, 76], [5, 492, 1103, 84], [6, 490, 1110, 100], [9, 540, 1080, 100], [10, 540, 1080, 100],
    [11, 501, 1080, 75], [12, 540, 1080, 60], [13, 501, 1110, 100], [16, 501, 1110, 100], [17, 501, 1080, 75], [18, 540, 1080, 60], [19, 540, 1080, 60],
    [20, 501, 1110, 100], [23, 540, 1080, 60], [24, 540, 1080, 60], [25, 590, 780, 45], [26, 540, 1020, 60], [27, 540, 795, 0], [30, 540, 1080, 60]];
  const nov = WT.newDB(); const M = WT.ensureMonth(nov, '2026-11');
  M.cfg = { base: 0, baseOT: 840, rate: 34246, max: 13800 }; M.ok = true;
  for (const [d, i, o, e] of NOV) M.days[d] = { s: d === 25 || d === 27 ? 'club' : 'normal', [d < 6 || d === 12 ? 'a' : 'p']: [i, o, e, d === 12 ? 60 : 0] }; // 12일: 추가제외 1:00을 실제값으로 미리 입력
  nov.backup.latest = { name: '근무시간_2026_최신본_20261105_0900.xlsx', at: Date.now() };
  await setDB(nov);
  await open('#/month');
  const mv = await text('#view');
  check('월 정리: 163:05 / 168:00 / -4:55', ['163:05', '168:00', '-4:55'].every((s) => mv.includes(s)), mv.replace(/\n/g, ' ').slice(0, 200));
  check('월 정리: 남은 가능 67:55 (추가제외 1:00 반영), 추가근무 -18:55, 0원', ['67:55', '-18:55', '0원'].every((s) => mv.includes(s)));
  const mfit = await page.evaluate(() => [Math.round(document.querySelector('.mon').getBoundingClientRect().bottom), Math.round(document.querySelector('#slack').getBoundingClientRect().top)]);
  check('월 정리: 한 화면에', mfit[0] <= mfit[1], JSON.stringify(mfit));
  check('여유시간 바 +4:30, 월말 예상 -4:55', (await text('#slack')).includes('+4:30') && (await text('#slack')).includes('월 말 예상') && (await text('#slack')).includes('-4:55'), await text('#slack'));
  check('백업 최근이면 안내 없음', !(await text('#banners2')).includes('엑셀'));
  await page.$eval('#c-max', (e) => (e.value = '')); await click('[data-act=saveCfg]'); await wait(100);
  check('최대가능시간 비우면 주 52시간 (222:51)', (await text('#view')).includes('최대가능 222:51 (비우면 주 52시간') && (await page.evaluate(() => db.months['2026-11'].cfg.max)) === null);
  await page.$eval('#c-max', (e) => { e.value = ''; }); await page.type('#c-max', '23000');
  check('월 입력값 : 자동 (23000 → 230:00)', (await page.$eval('#c-max', (e) => e.value)) === '230:00');
  await click('[data-act=saveCfg]'); await wait(100);
  await shot('4-month');
  await open('#/list');
  check('기록 화면 주 합계·예정 표시', (await text('#view')).includes('주 합계') && (await page.$$('.lst .plan')).length > 0);
  await click('[data-act=openRow][data-k="2026-11-12"]');
  check('줄 펼치기: 추가제외 반영', (await text('#view')).includes('추가제외 반영 7:00'));
  await shot('4-list');
  // 기록에서 바로 수정 (지난날 = 실제값), 저장 뒤에도 기록 화면
  await click('[data-act=openRow][data-k="2026-11-03"]');
  await page.$eval('#f-out', (e) => { e.value = '19:00'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('[data-act=saveForm][data-pre="f-"]'); await wait(100);
  check('기록에서 바로 수정', (await page.evaluate(() => [db.months['2026-11'].days[3].a[1], location.hash])).join() === '1140,#/list');
  // 오늘 화면: 어제(실제) + 오늘(계획). 오늘 칸을 고치면 계획값만 바뀜
  await open('#/today');
  const t2 = await text('#view');
  check('오늘 화면: 전일 실제 + 오늘 계획', t2.includes('전일 11/5(목) 실제') && t2.includes('오늘 11/6(금) 계획'));
  await page.$eval('#q-out', (e) => { e.value = '19:00'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  check('오늘 계획 미리보기: 11/6까지 여유', /당일 여유\s*\+5:28/.test(await text('.dform[data-pre="q-"]')), await text('.dform[data-pre="q-"]'));
  await click('[data-act=saveForm][data-pre="q-"]'); await wait(100);
  check('오늘 칸 저장 = 계획값', JSON.stringify(await page.evaluate(() => db.months['2026-11'].days[6])) === JSON.stringify({ s: 'normal', p: [490, 1140, 100, 0] }));
  await shot('4-today2');
  const rows = await page.$$eval('.dform[data-pre="q-"] .grid5', (g) => g.map((x) => x.innerText.replace(/\s+/g, ' ')));
  check('첫 줄 출근·퇴근·제외·실근무·당일 여유 / 둘째 줄 추가제외·월말 여유·저장', /출근.*퇴근.*제외.*실근무.*당일 여유/.test(rows[0]) && /추가제외.*월말 여유.*저장/.test(rows[1]), JSON.stringify(rows));
  const fit = await page.evaluate(() => { const c = document.querySelectorAll('.dcard'); return [c.length, Math.round(c[c.length - 1].getBoundingClientRect().bottom), Math.round(document.querySelector('#slack').getBoundingClientRect().top)]; });
  check('전일·오늘·내일이 한 화면에 (폰 780px)', fit[0] === 3 && fit[1] <= fit[2], JSON.stringify(fit));
  check('카드 강조: 오늘 > 전일 > 내일', (await page.$$eval('.dcard', (c) => c.map((x) => x.className.split(' ').pop()))).join() === 'd-prev,d-today,d-next');
  check('추가제외 칸은 보통 글씨', (await page.$eval('#q-add', (e) => getComputedStyle(e).fontWeight)) === '400');
  const bar = await text('#slack');
  check('오늘 화면 아래 바: 월말 여유 · 추가근무 · 수당', bar.includes('월 말 여유') && bar.includes('추가근무') && bar.includes('추가근무수당') && !bar.includes('오늘까지'), bar);
  await page.$eval('#q-in', (e) => (e.value = '')); await page.type('#q-in', '900');
  check('출근 9:00 → 퇴근 16:52, 제외 0:45 자동 (오늘 칸)', [await page.$eval('#q-out', (e) => e.value), await page.$eval('#q-ex', (e) => e.value)].join() === '16:52,0:45');
  await page.$eval('#f-in', (e) => (e.value = '')); await page.type('#f-in', '815');
  check('전일 칸도 자동 (8:15 → 16:07)', (await page.$eval('#f-out', (e) => e.value)) === '16:07');
  // 계획 화면에서 세트 기본값 수정
  await open('#/plan');
  await click('[data-act=pickSet][data-id=normal]'); await click('[data-act=editSet][data-id=normal]');
  await page.$eval('#s-2', (e) => (e.value = '1:00')); await click('[data-act=saveSet]');
  check('계획 화면에서 세트 기본값 수정', (await page.evaluate(() => setOf('normal').t.join())) === '590,1122,60,0' && /9:50~18:42\s*\(-1:00\) : 7:52/.test(await text('.sets')));
  await click('[data-act=mode][data-v=set]');
  await shot('4-plan-sets');
  const pfit = await page.evaluate(() => [Math.round(document.querySelector('.cal').getBoundingClientRect().bottom), Math.round(document.querySelector('#slack').getBoundingClientRect().top)]);
  check('계획 화면: 달력까지 한 화면에', pfit[0] <= pfit[1], JSON.stringify(pfit));
  await setDB(nov); // 아래 확인은 원래 11월 데이터로
  await open('#/today');
  check('전일(11/5) 당일 여유 +3:50', /당일 여유\s*\+3:50/.test(await text('.dform[data-pre="f-"]')), await text('.dform[data-pre="f-"]'));

  // 5. 추가제외: 월말(11/26) 주황 띠 → 삭제하면 사라짐
  TODAY = '2026-11-26';
  await page.evaluateOnNewDocument(() => { window.WT_TODAY = '2026-11-26'; });
  await open('#/month');
  check('추가제외 주황 띠', (await page.$('#banners .ban-orange')) !== null);
  await click('[data-act=delAdd]'); await wait(100);
  check('추가제외 삭제 → 띠 없어짐', (await page.$('#banners .ban-orange')) === null);

  // 6. 엑셀: 저장(다운로드 이름), 압축된 엑셀 불러오기(브라우저 압축 해제), 당월 보호
  await open('#/settings');
  dialogs.length = 0;
  await click('[data-act=exportYear][data-kind=latest]'); await wait(150);
  const dl = await page.evaluate(() => window.__downloads || []);
  check('최신본 파일 이름', /^근무시간_2026_최신본_\d{8}_\d{4}\.xlsx$/.test(dl[0] || ''), dl[0]);
  check('저장 안내: 이전 최신본 지우기 + 연최종본은 지우지 말 것', dialogs.some((m) => m.includes('근무시간_2026_최신본_20261105_0900.xlsx') && m.includes('연최종본') && m.includes('지우면 안 됩니다')), dialogs[0]);
  const oct = WT.newDB(); WT.applySet(oct, '2026-10', 6, oct.sets[1]); WT.applySet(oct, '2026-11', 3, oct.sets[1]);
  const file = path.join(tmp, 'oct.xlsx');
  fs.writeFileSync(file, X.write(WT.toSheets(oct, '2026', '최신본', '2026-10-31 18:00', TODAY), (b) => new Uint8Array(zlib.deflateRawSync(b))));
  const before = await page.evaluate(() => JSON.stringify(db.months['2026-11']));
  const input = await page.$('#imp'); await input.uploadFile(file); await wait(400);
  if (process.env.DEBUG) console.log(dialogs);
  const after = await page.evaluate(() => [JSON.stringify(db.months['2026-11']), db.months['2026-10'] && db.months['2026-10'].days[6] && db.months['2026-10'].days[6].s]);
  check('불러오기: 10월 들어옴, 당월(11월) 그대로', after[0] === before && after[1] === 'home', JSON.stringify(after[1]));
  check('불러오기 오류 없음', !dialogs.some((m) => m.includes('실패')), dialogs.join(' | '));

  // 7. 2개월 지난 달 수정 경고 (오늘 2027-01-10 에 2026-11 수정)
  await page.evaluateOnNewDocument(() => { window.WT_TODAY = '2027-01-10'; });
  await open('#/today?d=2026-11-09');
  await page.$eval('#d-add', (e) => { e.value = '0:05'; e.dispatchEvent(new Event('input', { bubbles: true })); }); // 값을 바꿔야 [저장]이 켜짐
  dialogs.length = 0;
  await click('[data-act=saveForm][data-pre="d-"]'); await wait(100);
  check('2개월 지난 달 고칠 때 확인 창', dialogs.some((m) => m.includes('2개월 이상 지난 달')), dialogs[0]);
  check('1월: 전년 연최종본 안내 (맨 아래)', (await text('#banners2')).includes('2026년 연최종본'));
  await shot('7-jan');

  // 8. 세트 추가·순서·경고
  await open('#/settings');
  await click('[data-act=editSet][data-id=new]');
  await page.type('#s-name', '야근'); await page.$eval('#s-0', (e) => (e.value = '900')); await page.$eval('#s-1', (e) => (e.value = '2100')); await page.$eval('#s-2', (e) => (e.value = '030'));
  await page.$eval('#s-2', (e) => e.dispatchEvent(new Event('input', { bubbles: true })));
  check('세트 제외 경고', (await text('#spv')).includes('제외 최소 1:00'));
  await click('[data-act=saveSet]');
  const n = await page.evaluate(() => db.sets.length);
  await click(`[data-act=moveSet][data-i="${n - 1}"][data-n="-1"]`);
  check('세트 추가 후 위로 이동', JSON.stringify(await page.evaluate(() => db.sets.slice(-2).map((s) => s.name))) === JSON.stringify(['야근', 'Regular']));
  await shot('8-settings');

  // 9. 휠 선택 입력 (기본값)
  numMode = false;
  await click('[data-act=inputMode][data-v=wheel]');
  await open('#/today?d=2026-11-09');
  check('휠 선택: 키보드 없는 칸', await page.$eval('#d-out', (e) => e.readOnly && e.inputMode === 'none'));
  await click('#d-out');
  const sel = () => page.evaluate(() => [wheelVal($('#wheel'), 'h'), wheelVal($('#wheel'), 'm')].join(':'));
  check('휠: 칸의 값이 가운데', (await sel()) === '18:0', await sel());
  await page.evaluate(() => { const c = (t) => $(`#wheel .wcol[data-t=${t}]`); c('h').scrollTop += 2 * 44; c('m').scrollTop += 15 * 44; });
  await shot('9-wheel');
  await click('#wheel [data-w=ok]'); await wait(50);
  check('휠 확인 → 칸·미리보기', (await page.$eval('#d-out', (e) => e.value)) === '20:15' && /실근무\s*9:35/.test(await text('.dform[data-pre="d-"]')), await text('.dform[data-pre="d-"]'));
  { // 당일 여유(GH) = 당일 여유 − 그날까지 추가제외 합 → 추가제외 1:00 넣으면 GH만 1:00 줄어듦
    const g = (c) => page.$eval(`.dform[data-pre="d-"] .${c} b`, (e) => WT.parseHM(e.textContent.replace('+', '')));
    const setAdd = (x) => page.$eval('#d-add', (e, x) => { e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); }, x);
    await setAdd('0:00'); const d0 = await g('r-day'), g0 = await g('r-gh');
    await setAdd('1:00'); const d1 = await g('r-day'), g1 = await g('r-gh');
    check('당일 여유(GH) = 당일 여유 − 추가제외', d1 === d0 && g1 === g0 - 60 && g0 <= d0, `${d0} ${g0} → ${d1} ${g1}`);
    await setAdd('0:00');
  }
  await click('#d-ex');
  await page.evaluate(() => { $('#wheel .wcol[data-t=m]').scrollTop -= 2 * 44; }); // 1:40 에서 분을 2칸 위로 → 1:38
  check('휠: 분 돌리기', (await sel()) === '1:38', await sel());
  await page.evaluate(() => { const c = $('#wheel .wcol[data-t=m]'); c.scrollTop -= 38 * 44; recenter(c); c.scrollTop -= 44; });
  check('휠: 00 위는 59 (이어서 돎)', (await sel()) === '1:59', await sel());
  await click('#wheel [data-w=cancel]');
  check('휠 취소 → 그대로', (await page.$eval('#d-ex', (e) => e.value)) === '1:40');
  dialogs.length = 0;
  await click('[data-act=saveForm][data-pre="d-"]'); await wait(100);
  check('휠 입력 저장', JSON.stringify(await page.evaluate(() => db.months['2026-11'].days[9].a)) === '[540,1215,100,0]', JSON.stringify(await page.evaluate(() => db.months['2026-11'].days[9].a)));
  // [저장]은 저장할 것이 있을 때만 켜짐
  await open('#/today?d=2026-11-09');
  const btn = '.dform[data-date="2026-11-09"] [data-act=saveForm]', dis = () => page.$eval(btn, (e) => e.disabled);
  const fpre = await page.$eval('.dform[data-date="2026-11-09"]', (e) => e.dataset.pre);
  const b0 = await dis();
  await page.$eval('#' + fpre + 'add', (e) => { e.value = '0:30'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  const b1 = await dis();
  await page.$eval('#' + fpre + 'add', (e) => { e.value = '0:00'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  check('저장 버튼: 같으면 꺼짐 · 바뀌면 켜짐 · 되돌리면 꺼짐', b0 && !b1 && (await dis()), `${b0} ${b1} ${await dis()}`);
  await page.evaluate(() => { db.months['2026-11'].days[5] = { p: [590, 1122, 45, 0] }; save(); }); // 11/5: 계획만 있고 실제 없음
  await open('#/today?d=2026-11-05');
  const b5 = () => page.$eval('.dform[data-date="2026-11-05"] [data-act=saveForm]', (e) => e.disabled);
  const c0 = await b5(), s0 = await page.$eval('.dform[data-date="2026-11-05"] [data-act=saveForm]', (e) => e.classList.contains('soft'));
  await page.$eval('.dform[data-date="2026-11-05"] [id$=add]', (e) => { e.value = '0:10'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  const soft5 = () => page.$eval('.dform[data-date="2026-11-05"] [data-act=saveForm]', (e) => e.classList.contains('soft'));
  await page.$eval('.dform[data-date="2026-11-05"] [id$=out]', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
  const e5 = [await b5(), await soft5()];
  await page.$eval('.dform[data-date="2026-11-05"] [id$=out]', (e) => { e.value = '18:42'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  check('저장 버튼: 퇴근 빈칸이면 흐린색(켜짐)', !e5[0] && e5[1], JSON.stringify(e5));
  check('저장 버튼: 미입력 지난날은 안 바꿔도 흐린색으로 켜짐, 바꾸면 남색', !c0 && s0 && !(await b5()) && !(await soft5()), `${c0} ${s0} ${await b5()} ${await soft5()}`);
  // 한 카드를 저장해도 다른 카드에 넣던 값은 남음, 다른 탭으로 갈 때 묻기
  await open('#/today?d=2026-11-09');
  const fd = '.dform[data-pre="f-"]', fdate = await page.$eval(fd, (f) => f.dataset.date);
  const put = (sel, v) => page.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  await put('#f-in', '9:00'); await put('#f-out', '18:00'); await put('#d-add', '0:15');
  await click('[data-act=saveForm][data-pre="d-"]'); await wait(150);
  const kept = await page.$eval(fd, (f) => [f.querySelector('#f-in').value, f.querySelector('#f-out').value, f.querySelector('[data-act=saveForm]').disabled, f.querySelector('[data-act=saveForm]').classList.contains('soft')]);
  check('다른 카드 저장 뒤에도 넣던 값·남색 버튼 유지', JSON.stringify(kept) === '["9:00","18:00",false,false]', JSON.stringify(kept));
  check('다른 카드 값은 저장 안 됨', await page.evaluate((d) => { const M = db.months[d.slice(0, 7)]; const a = M && M.days[+d.slice(8)] && M.days[+d.slice(8)].a; return !a || a[0] !== 540 || a[1] !== 1080; }, fdate));
  dialogs.length = 0;
  await page.evaluate(() => { location.hash = '#/plan'; }); await wait(150);
  check('저장 안 한 값 두고 다른 탭 → 확인 창', dialogs.some((m) => m.includes('저장하지 않은 값')), dialogs[0]);
  const w9 = await page.evaluate(() => document.documentElement.scrollWidth);
  check('휠 입력도 384px 안', w9 <= 384, String(w9));

  // 10. 달 중간(12/10)에 처음 열어 아무것도 없을 때: 세트로 계획 채움 → 밀린 날을 하나씩 확정 / 고쳐서 확정
  await page.evaluateOnNewDocument(() => { window.WT_TODAY = '2026-12-10'; });
  const fresh = WT.newDB(); fresh.inputMode = 'wheel';
  WT.fillEmpty(fresh, '2026-12', fresh.sets.find((x) => x.id === 'normal'));
  await setDB(fresh);
  await open('#/today');
  const chips = await page.$$eval('.misscard .mchip', (b) => b.map((x) => x.textContent));
  check('12/10: 밀린 날 칩 6개(12/1~12/8 평일, 전일 12/9는 카드)', chips.length === 6 && chips[0].startsWith('12/1'), chips.join(' '));
  await click('.misscard .mchip');
  const card = '.dform[data-date="2026-12-01"]';
  const st1 = await page.$eval(card, (f) => [f.querySelector('[id$=in]').value, f.querySelector('[data-act=saveForm]').classList.contains('soft')]);
  check('밀린 날 카드: 계획값이 채워져 있고 [저장] 흐린 남색', JSON.stringify(st1) === '["9:50",true]', JSON.stringify(st1));
  await click(card + ' [data-act=saveForm]'); await wait(150);
  check('계획대로 확정 → 실제값 저장, 칩 하나 줄어듦', JSON.stringify(await page.evaluate(() => db.months['2026-12'].days[1].a)) === '[590,1122,45,0]' && (await page.$$('.misscard .mchip')).length === 5);
  await click('.misscard .mchip');
  await page.$eval('.dform[data-date="2026-12-02"] [id$=out]', (e) => { e.value = '19:30'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('.dform[data-date="2026-12-02"] [data-act=saveForm]'); await wait(150);
  check('고쳐서 확정 → 고친 값 저장', JSON.stringify(await page.evaluate(() => db.months['2026-12'].days[2].a)) === '[590,1170,45,0]');

  check('끝까지 화면 오류 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(fails.length ? `\n${fails.length}개 실패` : '\nOK');
  process.exit(fails.length ? 1 : 0);
})();
