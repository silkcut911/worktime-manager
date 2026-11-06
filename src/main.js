// 시작: 데이터 읽기 → 화면 그리기. 클릭·입력은 data-act 로 한 곳에서 처리
load();
render();
addEventListener('hashchange', render);
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled && ACT[el.dataset.act]) ACT[el.dataset.act](el, e);
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.classList.contains('tnum')) { // 숫자만 받고 끝 두 자리 앞에 ':' 자동 (950 → 9:50, 23000 → 230:00)
    const d = el.value.replace(/\D/g, '').slice(0, +(el.dataset.max || 4));
    el.value = d.length > 2 ? d.slice(0, -2) + ':' + d.slice(-2) : d;
  }
  if (el.classList.contains('rnum')) el.value = el.value.replace(/\D/g, '');
  const id = (el.closest('[id]') || {}).id || '';
  // 그날 출근을 넣으면 퇴근 = 출근 + 설정값(7:52), 제외 = 설정값(0:45) 을 먼저 채움 (일반근무·세트 없는 평일)
  const form = el.closest('.dform');
  if (form && form.dataset.auto && id === form.dataset.pre + 'in') {
    const m = readTime(id);
    if (m != null && !Number.isNaN(m) && (el.tagName !== 'INPUT' || el.value.replace(/\D/g, '').length >= 3)) {
      setTime(form.dataset.pre + 'out', m + db.auto.stay); setTime(form.dataset.pre + 'ex', db.auto.ex);
    }
  }
  if (/^[fpqdn]-/.test(id)) preview(); // f 전일 · q 오늘 · n 내일 · d 밀린 날 · p 계획 시간 조정
  if (id.startsWith('s-')) setPreview();
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'imp') importFile(e.target);
});
// 시간 칸을 벗어나면 정리해서 보여 줌 (30 → 0:30, 9 → 9:00)
document.addEventListener('focusout', (e) => {
  const el = e.target;
  if (!el.classList || !el.classList.contains('tnum') || !el.id) return;
  const m = readTime(el.id);
  if (m != null && !Number.isNaN(m)) { el.value = WT.fmt(m); preview(); }
});
// 날짜가 바뀐 채로 열려 있으면 다시 그림
document.addEventListener('visibilitychange', () => { if (!document.hidden) { WT.ensureMonth(db, tym()); save(); render(); } });
// 저장하지 않은 계획이 있으면 창을 닫기 전에 묻기
addEventListener('beforeunload', (e) => { if (ui.draft && ui.draft.dirty) e.preventDefault(); });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js');
