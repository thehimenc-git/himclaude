// ── 모드 전환 (일일보고 ↔ 힘클로바) ──────────────
var activeMode='report'; // 'report' | 'himclova'

var VALID_MODES = ['report','search','himclova','calendar','master'];

// 모드 탭 클릭 핸들러 — 사용자 클릭 트리거에만 사용 (시스템 호출은 switchMode 직접).
// 현재 활성 탭 재클릭 시 confirm → 예면 모드별 reset + input sub-page 복귀.
function onTabClick(name){
  if (activeMode === name){
    var ok = confirm('작성 중이던 내용을 초기화하시겠습니까?');
    if (!ok) return;
    // 일일보고: draft 는 보존하면서 화면만 p1 으로 복귀 + "이어서 작성" 배너 표시
    if (name === 'report')          resetReportToP1();
    else if (name === 'search'   && typeof Chat   !== 'undefined')    Chat.newConv();
    else if (name === 'himclova' && typeof HimClova !== 'undefined')  HimClova.newRecording();
    return;
  }
  switchMode(name);
}

// 일일보고 — 메모리만 비우고 draft 는 보존. p1 복귀 + 이어서 작성 배너 표시.
function resetReportToP1(){
  var mi = document.getElementById('main-input');
  if (mi) mi.value = '';
  files = [];
  var fc = document.getElementById('file-chips');
  if (fc) fc.innerHTML = '';
  currentStructured = null;
  lastAIStructured  = null;
  currentRawText    = '';
  ydExpanded     = true;
  tdExpanded     = false;
  ctxYdExpanded  = true;
  ctxTdExpanded  = false;
  // draft 는 보존하되 manualP1 flag 추가 — F5 자동 복원이 이걸 보고 p2 로 안 보냄.
  // 사용자가 배너 "이어서" 클릭하면 그때 flag 무시하고 p2 복원됨.
  try {
    var s = localStorage.getItem(DRAFT_KEY);
    if (s){
      var d = JSON.parse(s);
      d.manualP1 = true;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    }
  } catch(e){}
  goPage('p1');
  maybeShowDraftBanner();
}

function switchMode(name){
  if(VALID_MODES.indexOf(name) === -1) name='report';
  activeMode=name;
  try{ localStorage.setItem(MODE_KEY, name); }catch(e){}
  var p1=document.getElementById('p1');
  if(p1) p1.setAttribute('data-mode', name);
  var tabs=document.querySelectorAll('.mode-tabs .mode-tab');
  for(var i=0;i<tabs.length;i++){
    if(tabs[i].getAttribute('data-mode')===name) tabs[i].classList.add('on');
    else tabs[i].classList.remove('on');
  }
  updateUserDateLabel();
  // 힘클로바 모드 첫 진입 시 폼 초기화 (lazy + idempotent)
  if(name==='himclova' && typeof HimClova !== 'undefined') HimClova.init();
  // 검색 모드 첫 진입 시 챗 로드 (lazy + idempotent)
  if(name==='search'  && typeof Chat     !== 'undefined') Chat.init();
  // 일정 탭 첫 진입 시 달력 로드 (lazy + idempotent, 2026-08-09)
  if(name==='calendar' && typeof CalTab  !== 'undefined') CalTab.init();
  // 마스터 탭 첫 진입 시 승격 대기 로드 (lazy + idempotent, 2026-08-25). 탭 없는 폼(v1)엔 MasterTab 미정의라 무영향.
  if(name==='master'  && typeof MasterTab !== 'undefined') MasterTab.init();
  // 검색 모드일 때만 body 스크롤 차단 — mode-search 가 fixed 라 페이지 휠 이벤트가 헛동작
  document.body.classList.toggle('search-mode-active', name === 'search');
}

function updateUserDateLabel(){
  var el=document.getElementById('user-date');
  if(!el) return;
  var prefix;
  if(activeMode==='himclova')      prefix='AI 회의록 · ';
  else if(activeMode==='search')  prefix='업무 인사이트 · ';
  else if(activeMode==='calendar')prefix='일정 · ';
  else                            prefix='업무 보고 · ';
  el.textContent=prefix+dateLabel;
}

function initP1(){
  document.getElementById('user-dot').textContent=profile.name.charAt(0);
  document.getElementById('user-name').textContent=profile.name+' '+profile.role+' · '+profile.dept;
  // 저장된 활성 모드 복구 (없으면 'report'). switchMode 가 user-date 라벨도 함께 갱신.
  var savedMode='report';
  try{ var sm=localStorage.getItem(MODE_KEY); if(VALID_MODES.indexOf(sm)!==-1) savedMode=sm; }catch(e){}
  switchMode(savedMode);
  loadContext();
  loadYesterdayRaw();
  loadL2PendingReviews();
  if (typeof MasterTab !== 'undefined') MasterTab.boot();  // 오너면 마스터 탭 노출 (2026-08-25)
  loadTodayRaw();
  bindDraftAutoSave();
  maybeShowDraftBanner();
  autosizeTa(document.getElementById('main-input'));

  // F5 직후 draft 의 stage 가 'p2' 이면 자동으로 p2 복원 (편집 페이지 유지)
  // — 단 manualP1 flag (사용자가 탭 재클릭으로 p1 으로 갔다는 표식) 가 있으면 자동 복원 안 함
  // 반환값: true = p2 로 자동 복원됨 (호출자는 goPage('p1') 호출 X), false = 일반 흐름
  try {
    var d = loadDraft();
    // 2026-08-13 — 알맹이 없는 p2 초안(예: "00" 한 글자 입력 → AI 가 빈 구조 반환)은
    //   자동 복원하지 않는다. 복원하면 그릴 게 없어 본문이 백지가 되는데, 자동 복원은
    //   배너("새로 시작" 버튼)를 숨겨버려서 사용자가 빠져나갈 길이 안 보인다.
    //   → 배너를 띄워 "이어서 / 새로 시작"을 직접 고르게 한다.
    if (d && d.stage === 'p2' && d.structured && savedMode === 'report' && !d.manualP1
        && draftHasBody_(d.structured)){
      restoreDraft(true);  // silent — 자동 복원이라 toast 생략
      return true;
    }
  } catch(e){}
  return false;
}
function bindDraftAutoSave(){
  var mi=document.getElementById('main-input');
  if(mi && !mi._draftBound){
    mi._draftBound=true;
    mi.addEventListener('input', function(){ scheduleDraftSave('p1'); });
  }
  // 2페이지 textarea/input 실시간 동기화 (이벤트 위임, 한 번만 부착)
  var p2body=document.getElementById('p2-body');
  if(p2body && !p2body._draftBound){
    p2body._draftBound=true;
    p2body.addEventListener('input', function(e){
      var t=e.target;
      if(!t)return;
      if(t.tagName==='TEXTAREA') autosizeTa(t);
      // 프로젝트 이름 변경 시 draft 갱신. 자연어 박스(read-only)·draft textarea 는 저장 X (재정리 시점에만 사용)
      if(t.classList && t.classList.contains('proj-name')){
        currentStructured=collectStructure();
        scheduleDraftSave('p2');
      }
    });
  }
}

// L2 owner 확인 요청 로딩 (Phase 6, 2026-05-08 / 2026-05-12 인명 병합 확장)
// L2 grade 만 렌더. PJ 확인 + 인명 merge + 인명 distinct 카드 분기 (순서 = PJ → merge → distinct)
function loadL2PendingReviews(){
  var card = document.getElementById('ctx-l2-review');
  if (!card) return;
  var grade = profile && profile.grade ? String(profile.grade).toUpperCase() : '';
  if (grade !== 'L2') { card.style.display = 'none'; return; }
  card.style.display = '';
  var body = document.getElementById('ctx-l2-review-body');
  body.innerHTML = '<div class="ctx-loading-inline">🌿 불러오는 중...</div>';

  var fetchPj = fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      token: APPS_SCRIPT_TOKEN,
      action: 'get_pending_confirmations',
      email: profile.email || ''
    })
  }).then(function(r){ return r.json(); }).catch(function(){ return { ok: false, items: [] }; });

  var fetchPerson = fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      token: APPS_SCRIPT_TOKEN,
      action: 'get_pending_person_reviews',
      email: profile.email || ''
    })
  }).then(function(r){ return r.json(); }).catch(function(){ return { ok: false, items: [] }; });

  // 2026-05-22 — AI 인덱스 B_학습 "PJ 약칭" → L2 즉시 등록 카드 source
  // 2026-08-25 — 마스터 탭(.tab-master)이 이식된 폼에선 PJ 등록을 그 탭이 전담 → 여기선 스킵(중복 제거).
  var _hasMasterTab = !!document.querySelector('.mode-tab.tab-master');
  var fetchRegister = _hasMasterTab ? Promise.resolve({ ok: false, items: [] }) : fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      token: APPS_SCRIPT_TOKEN,
      action: 'get_pending_pj_registrations',
      email: profile.email || ''
    })
  }).then(function(r){ return r.json(); }).catch(function(){ return { ok: false, items: [] }; });

  Promise.all([fetchPj, fetchPerson, fetchRegister]).then(function(results){
    var pjResp = results[0] || { ok: false, items: [] };
    var pnResp = results[1] || { ok: false, items: [] };
    var rgResp = results[2] || { ok: false, items: [] };
    var countEl = document.getElementById('ctx-l2-count');

    if (!pjResp.ok && !pnResp.ok && !rgResp.ok) {
      body.innerHTML = '<div class="ctx-loading-inline">⚠️ ' + escapeHtml((pjResp.message || pnResp.message || rgResp.message) || '오류') + '</div>';
      return;
    }
    var pjItems       = (pjResp.ok && Array.isArray(pjResp.items)) ? pjResp.items : [];
    var personItems   = (pnResp.ok && Array.isArray(pnResp.items)) ? pnResp.items : [];
    var registerItems = (rgResp.ok && Array.isArray(rgResp.items)) ? rgResp.items : [];
    var suggestions   = (rgResp.ok && rgResp.suggestions) ? rgResp.suggestions : { U:'26-U01', C:'26-C01', S:'26-S01', E:'26-E01', A:'26-A01' };
    var prefixMax     = (rgResp.ok && rgResp.prefixMax) ? rgResp.prefixMax : { U:0, C:0, S:0, E:0, A:0 };
    // 인명 카드 정렬 — merge 먼저, distinct 나중
    personItems.sort(function(a, b){ return (a.kind === 'merge' ? 0 : 1) - (b.kind === 'merge' ? 0 : 1); });

    var totalCount = pjItems.length + personItems.length + registerItems.length;
    if (totalCount === 0) {
      body.innerHTML = '<div class="ctx-loading-inline">✅ 확인 요청 없음</div>';
      if (countEl) countEl.textContent = '';
      window._l2Items = [];
      window._l2PersonItems = [];
      window._l2RegisterItems = [];
      return;
    }
    if (countEl) countEl.textContent = totalCount + '건';

    var html = '';
    // ⓪ 신규 PJ 등록 요청 (2026-05-22) — AI 인덱스 B_학습 "PJ 약칭" → 즉시 마스터 등록
    if (registerItems.length){
      var prefixMeaning = (rgResp.ok && rgResp.prefixMeaning) ? rgResp.prefixMeaning : { U:'도시계획', S:'구조', C:'공간기획', E:'검토·임시', A:'AI' };
      // prefix 의미 + 다음 추천 코드 — 카드 공통 헤더로 1회 표시 (각 entry 위)
      var prefixHintHtml = '<div class="l2-pj-prefix-legend">';
      ['U','S','C','E','A'].forEach(function(p){
        prefixHintHtml += '<span><b>' + p + '</b>=' + escapeHtml(prefixMeaning[p] || '') + ' (현재 최신 ' + (prefixMax[p] || 0) + ' / 다음 ' + escapeHtml(suggestions[p] || '') + ')</span>';
      });
      prefixHintHtml += '</div>';

      registerItems.forEach(function(item, i){
        var defaultCode = suggestions.U;   // 기본 추천 = U prefix (도시계획 가장 많음). L2 가 수정 가능
        html += '<div class="l2-review-item l2-review-register" data-kind="register" data-idx="' + i + '">';
        html += '<div class="l2-review-head"><strong>📌 신규 PJ 등록</strong> ';
        html += '<span class="l2-review-status">' + escapeHtml(item['키'] || '') + '</span></div>';
        var ctxParts = [];
        if (item['값'])     ctxParts.push('학습 값: ' + item['값']);
        if (item['출처'])   ctxParts.push('출처: ' + item['출처']);
        if (item['갱신일']) ctxParts.push(item['갱신일']);
        if (ctxParts.length) html += '<div class="l2-review-context">' + escapeHtml(ctxParts.join(' / ')) + '</div>';
        // 첫 entry 에만 prefix 안내 (반복 노출 방지)
        if (i === 0) html += prefixHintHtml;
        html += '<div class="l2-pj-register-form">';
        html += '<input type="text" id="l2-pj-code-' + i + '" placeholder="코드 (예: ' + escapeHtml(defaultCode) + ')" value="' + escapeHtml(defaultCode) + '" />';
        html += '<input type="text" id="l2-pj-name-' + i + '" placeholder="공식명칭 (별칭만 추가 시 빈 칸 가능)" value="' + escapeHtml(item['키'] || '') + '" />';
        html += '</div>';
        html += '<div class="l2-review-actions">';
        html += '<button onclick="respondRegisterPj(' + i + ', \'new\')">✓ 신규 등록</button>';
        html += '<button onclick="respondRegisterPj(' + i + ', \'alias\')">별칭만 추가</button>';
        html += '<button onclick="respondRegisterPj(' + i + ', \'reject\')">기각</button>';
        html += '</div></div>';
      });
    }
    // ① PJ 카드 (기존 형식)
    pjItems.forEach(function(item, i){
      html += '<div class="l2-review-item l2-review-pj" data-kind="pj" data-idx="' + i + '">';
      html += '<div class="l2-review-head">';
      html += '<strong>' + escapeHtml(item.pj_code || '신규') + '</strong> ';
      html += escapeHtml(item.pj_name || '');
      html += '<span class="l2-review-status">' + escapeHtml(item.confirmation_status) + '</span>';
      html += '</div>';
      var ctxText = (item['비고'] || '') + (item['담당자'] && item['담당자'].length ? ' (담당: ' + item['담당자'].join(', ') + ')' : '');
      if (ctxText) html += '<div class="l2-review-context">' + escapeHtml(ctxText) + '</div>';
      html += '<div class="l2-review-actions">';
      html += '<button onclick="respondL2(' + i + ', \'confirm\')">✓ 맞음</button>';
      html += '<button onclick="respondL2(' + i + ', \'different\')">다른 PJ</button>';
      html += '<button onclick="respondL2(' + i + ', \'new\')">신규 PJ</button>';
      html += '</div></div>';
    });

    // ② 인명 카드 (merge → distinct 순)
    personItems.forEach(function(item, i){
      var isMerge = item.kind === 'merge';
      var icon = isMerge ? '👤' : '👥';
      var heading = isMerge ? '인명 병합 제안' : '동명이인 확정 제안';
      html += '<div class="l2-review-item l2-review-person" data-kind="person" data-idx="' + i + '">';
      html += '<div class="l2-review-head"><strong>' + icon + ' ' + heading + '</strong> ';
      html += '<span class="l2-review-status">' + escapeHtml(item.name_raw || '') + '</span></div>';

      var details = Array.isArray(item.candidates_detail) ? item.candidates_detail : [];
      if (details.length) {
        var detailHtml = '<ul class="l2-person-details">';
        details.forEach(function(d){
          var line = (d.name || '') + ' / ' + (d.company || '회사 미상');
          if (d.role)   line += ' / ' + d.role;
          if (d.mobile) line += ' / ' + d.mobile;
          detailHtml += '<li>' + escapeHtml(line) + '</li>';
        });
        detailHtml += '</ul>';
        html += '<div class="l2-review-context">' + detailHtml + '</div>';
      }

      var noteText = '';
      if (isMerge && item.merge_proposal && item.merge_proposal.transition_note) {
        noteText = 'L3 메모: ' + item.merge_proposal.transition_note;
      } else if (!isMerge) {
        noteText = '전부 다른 사람으로 확정 제안';
      }
      if (noteText) html += '<div class="l2-review-context">' + escapeHtml(noteText) + '</div>';

      html += '<div class="l2-review-actions">';
      html += '<button onclick="respondL2Person(' + i + ', \'approve\')">✓ 승인</button>';
      html += '<button onclick="respondL2Person(' + i + ', \'reject\')">거부</button>';
      html += '</div></div>';
    });

    body.innerHTML = html;
    window._l2Items = pjItems;
    window._l2BrfingDate = pjResp.brfing_date || pnResp.brfing_date || '';
    window._l2PersonItems = personItems;
    window._l2RegisterItems = registerItems;
  });
}

// 신규 PJ 등록 응답 (2026-05-22) — 'new' / 'alias' / 'reject'
function respondRegisterPj(idx, mode){
  var item = (window._l2RegisterItems || [])[idx];
  if (!item) return;
  var codeEl = document.getElementById('l2-pj-code-' + idx);
  var nameEl = document.getElementById('l2-pj-name-' + idx);
  var pjCode = codeEl ? String(codeEl.value || '').trim() : '';
  var pjName = nameEl ? String(nameEl.value || '').trim() : '';

  var action = '';
  var payload = {
    token: APPS_SCRIPT_TOKEN,
    email: profile.email || '',
    source_key:   item['키']  || '',
    source_value: item['값'] || ''
  };

  if (mode === 'new') {
    if (!pjCode) { alert('코드를 입력해주세요 (예: 26-U25)'); return; }
    if (!pjName) { alert('공식명칭을 입력해주세요'); return; }
    if (!/^\d{2}-[UCSEA]\d{1,3}$/i.test(pjCode)) {
      alert('코드 형식 오류 (YY-PNN 예: 26-U25)'); return;
    }
    if (!window.confirm('신규 PJ 등록\n코드: ' + pjCode + '\n명칭: ' + pjName + '\n진행할까요?')) return;
    action = 'register_new_pj';
    payload.pj_code = pjCode;
    payload.official_name = pjName;
  } else if (mode === 'alias') {
    if (!pjCode) { alert('어느 PJ 의 별칭인지 코드를 입력해주세요'); return; }
    if (!window.confirm('"' + (item['키']||'') + '" 를 ' + pjCode + ' 의 별칭으로만 추가할까요?')) return;
    action = 'register_pj_alias_only';
    payload.pj_code = pjCode;
  } else if (mode === 'reject') {
    if (!window.confirm('이 학습을 기각할까요? AI 인덱스에서 row 제거됩니다.')) return;
    action = 'reject_pj_learning';
  } else {
    return;
  }
  payload.action = action;

  fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (!d.ok) { alert(d.message || '응답 실패'); return; }
    var el = document.querySelector('.l2-review-item[data-kind="register"][data-idx="' + idx + '"]');
    var doneMsg = (mode === 'new')  ? '✓ 등록 완료 (' + (d.pj_code || pjCode) + ')'
                : (mode === 'alias') ? '✓ 별칭 추가 완료 (' + (d.pj_code || pjCode) + ')'
                : '✓ 기각 처리됨';
    if (el) el.innerHTML = '<div class="l2-review-done">' + doneMsg + '</div>';
  })
  .catch(function(err){ alert('네트워크 오류: ' + err); });
}

function respondL2(idx, response){
  var item = (window._l2Items || [])[idx];
  if (!item) return;
  var correctedCode = '';
  if (response === 'different') {
    correctedCode = window.prompt('정정할 PJ 코드를 입력해주세요 (예: 25-U10):', '');
    if (!correctedCode) return;
  }
  fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      token: APPS_SCRIPT_TOKEN,
      action: 'respond_confirmation',
      email: profile.email || '',
      brfing_date: window._l2BrfingDate || '',
      pj_code: item.pj_code || '',
      pj_name: item.pj_name || '',
      response: response,
      corrected_pj_code: correctedCode,
      comment: ''
    })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (!d.ok) { alert(d.message || '응답 실패'); return; }
    var el = document.querySelector('.l2-review-item[data-kind="pj"][data-idx="' + idx + '"]');
    if (el) el.innerHTML = '<div class="l2-review-done">✓ 응답 완료</div>';
  })
  .catch(function(err){ alert('네트워크 오류: ' + err); });
}

// 인명 병합·동명이인 확정 응답 (2026-05-12)
function respondL2Person(idx, response){
  var item = (window._l2PersonItems || [])[idx];
  if (!item) return;
  if (response === 'reject') {
    if (!window.confirm('이 제안을 거부하시겠어요? 시트는 변경되지 않습니다.')) return;
  }
  var comment = '';
  fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      token: APPS_SCRIPT_TOKEN,
      action: 'respond_person_review',
      email: profile.email || '',
      brfing_date: window._l2BrfingDate || '',
      kind: item.kind,
      name_raw: item.name_raw || '',
      response: response,
      merge_proposal: item.merge_proposal || null,
      distinct_proposal: item.distinct_proposal || null,
      comment: comment
    })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (!d.ok) { alert(d.message || '응답 실패'); return; }
    var el = document.querySelector('.l2-review-item[data-kind="person"][data-idx="' + idx + '"]');
    if (el) {
      var appliedTxt = '';
      if (d.applied && (d.applied.merge || d.applied.distinct)) {
        appliedTxt = ' (시트 ' + (d.applied.merge || d.applied.distinct) + ' 행 갱신)';
      }
      el.innerHTML = '<div class="l2-review-done">✓ 응답 완료' + appliedTxt + '</div>';
    }
  })
  .catch(function(err){ alert('네트워크 오류: ' + err); });
}

function loadYesterdayRaw(){
  if(!profile)return;
  yesterdayLoaded=false;
  yesterdayLoadError=null;
  renderYesterdayRawCard();
  doLoadYesterdayRaw(1); // 재시도 1회 허용
}

function doLoadYesterdayRaw(retriesLeft){
  var controller=('AbortController' in window)?new AbortController():null;
  var timedOut=false;
  var timer=setTimeout(function(){
    timedOut=true;
    if(controller)controller.abort();
  },10000);

  var fetchOpts=controller?{signal:controller.signal}:{};
  fetch(APPS_SCRIPT_URL+'?action=get_yesterday_raw&name='+encodeURIComponent(profile.name),fetchOpts)
    .then(function(r){return r.json()})
    .then(function(data){
      clearTimeout(timer);
      if(data.ok){
        yesterdayItems=Array.isArray(data.items)?data.items:[];
        yesterdayDate=data.date||'';
        yesterdayLoadError=null;
      }else{
        yesterdayLoadError='server';
      }
      yesterdayLoaded=true;
      renderYesterdayRawCard();
      refreshP2YesterdayIfVisible();
    })
    .catch(function(){
      clearTimeout(timer);
      var errType=timedOut?'timeout':'network';
      if(retriesLeft>0){
        // 1차 실패 → 조용히 1회 재시도
        yesterdayLoadError='retrying';
        renderYesterdayRawCard();
        refreshP2YesterdayIfVisible();
        setTimeout(function(){ doLoadYesterdayRaw(retriesLeft-1); },500);
      }else{
        yesterdayLoadError=errType;
        yesterdayLoaded=true;
        renderYesterdayRawCard();
        refreshP2YesterdayIfVisible();
      }
    });
}

// 오늘 이미 발송된 본인 보고 전체 (p2 진입 시 호출)
function loadTodayRaw(){
  if(!profile)return;
  todayLoaded=false;
  todayLoadError=null;
  doLoadTodayRaw(1);
}
function doLoadTodayRaw(retriesLeft){
  var controller=('AbortController' in window)?new AbortController():null;
  var timedOut=false;
  var timer=setTimeout(function(){
    timedOut=true;
    if(controller)controller.abort();
  },10000);

  var fetchOpts=controller?{signal:controller.signal}:{};
  fetch(APPS_SCRIPT_URL+'?action=get_today_raw&name='+encodeURIComponent(profile.name),fetchOpts)
    .then(function(r){return r.json()})
    .then(function(data){
      clearTimeout(timer);
      if(data.ok){
        todayItems=Array.isArray(data.items)?data.items:[];
        todayLoadError=null;
      }else{
        todayLoadError='server';
      }
      todayLoaded=true;
      renderTodayRawCardP1();
      refreshP2YesterdayIfVisible();
    })
    .catch(function(){
      clearTimeout(timer);
      var errType=timedOut?'timeout':'network';
      if(retriesLeft>0){
        todayLoadError='retrying';
        refreshP2YesterdayIfVisible();
        setTimeout(function(){ doLoadTodayRaw(retriesLeft-1); },500);
      }else{
        todayLoadError=errType;
        todayLoaded=true;
        refreshP2YesterdayIfVisible();
      }
    });
}

// 5상태 공용 렌더: 로딩 / 타임아웃 / 네트워크 오류 / 서버 오류 / 데이터(1건 이상) / 빈 상태
function buildYesterdayBodyHtml(){
  if(!yesterdayLoaded){
    if(yesterdayLoadError==='retrying'){
      return '<div class="ctx-loading-inline">🔄 재시도 중...</div>';
    }
    return '<div class="ctx-loading-inline">🌿 불러오는 중...</div>';
  }
  if(yesterdayLoadError==='timeout'){
    return '<div class="raw-box error">⏱️ 응답 지연 (10초 초과) — 서버가 느릴 수 있어요.<br>새로고침해 보시고, 그래도 해결되지 않으면 관리자에게 문의해 주세요.</div>';
  }
  if(yesterdayLoadError==='network'){
    return '<div class="raw-box error">⚠️ 불러오기 실패 — 네트워크 오류.<br>새로고침해 보시고, 그래도 해결되지 않으면 관리자에게 문의해 주세요.</div>';
  }
  if(yesterdayLoadError==='server'){
    return '<div class="raw-box error">⚠️ 서버 응답 오류.<br>새로고침해 보시고, 그래도 해결되지 않으면 관리자에게 문의해 주세요.</div>';
  }
  if(yesterdayItems.length>0){
    return renderRawItemsHtml(yesterdayItems, '📝');
  }
  return '<div class="raw-box empty">📭 이전 보고 기록이 없습니다</div>';
}

// 공용: items 배열을 시간 라벨 + raw-box 반복으로 렌더
function renderRawItemsHtml(items, icon){
  var multi=items.length>1;
  return items.map(function(it, idx){
    var timeTxt=it.time||'';
    var head='<div class="raw-item-head">'+icon+' '+(timeTxt?escapeHtml(timeTxt):'')+
             (multi?' <span class="raw-item-no">#'+(idx+1)+'</span>':'')+'</div>';
    return head+'<div class="raw-box">'+escapeHtml(it.raw||'')+'</div>';
  }).join('<div class="raw-item-gap"></div>');
}

// 오늘 원문 — 확정분(접기/펼치기 대상)과 작성 중(항상 표시) 파트로 분리해 반환
function buildTodayBodyParts(){
  var confirmedCount=todayLoaded&&!todayLoadError?todayItems.length:0;
  var confirmed='';

  if(!todayLoaded){
    confirmed='<div class="ctx-loading-inline">🌿 기존 오늘자 보고 불러오는 중...</div>';
  } else if(todayLoadError==='timeout'){
    confirmed='<div class="raw-box error">⏱️ 오늘자 보고 응답 지연.<br>새로고침해 보시고, 그래도 해결되지 않으면 관리자에게 문의해 주세요.</div>';
  } else if(todayLoadError==='network'){
    confirmed='<div class="raw-box error">⚠️ 오늘자 보고 불러오기 실패 — 네트워크 오류.<br>새로고침해 보시고, 그래도 해결되지 않으면 관리자에게 문의해 주세요.</div>';
  } else if(todayLoadError==='server'){
    confirmed='<div class="raw-box error">⚠️ 오늘자 보고 서버 오류.<br>새로고침해 보시고, 그래도 해결되지 않으면 관리자에게 문의해 주세요.</div>';
  } else if(confirmedCount>0){
    confirmed=renderRawItemsHtml(todayItems, '✅');
  }

  var drafting='';
  if(currentRawText){
    var nextNo=confirmedCount+1;
    drafting=
      '<div class="raw-item-head drafting">✏️ 작성 중 <span class="raw-item-no">#'+nextNo+'</span></div>'+
      '<div class="raw-box drafting">'+escapeHtml(currentRawText)+'</div>';
  }

  return {confirmed:confirmed, drafting:drafting, confirmedCount:confirmedCount};
}

function renderYesterdayRawCard(){
  var card=document.getElementById('ctx-yd-raw');
  var head=document.getElementById('ctx-yd-raw-head');
  var body=document.getElementById('ctx-yd-raw-body');
  if(!head||!body)return;
  var ydCount=(yesterdayLoaded&&!yesterdayLoadError)?yesterdayItems.length:0;
  var headTxt='어제 원문'+(yesterdayDate?' ('+fmtDate(yesterdayDate)+')':'');
  if(ydCount>1)headTxt+=' · '+ydCount+'건';
  head.textContent=headTxt;
  body.innerHTML=buildYesterdayBodyHtml();
  if(card)card.classList.toggle('collapsed', !ctxYdExpanded);
}

// 1페이지 — 오늘 이미 발송한 원문 카드. 발송분 없으면 카드 자체를 숨김.
function renderTodayRawCardP1(){
  var card=document.getElementById('ctx-td-raw');
  var body=document.getElementById('ctx-td-raw-body');
  var head=document.getElementById('ctx-td-raw-head');
  if(!card||!body||!head)return;
  var count=(todayLoaded&&!todayLoadError)?todayItems.length:0;
  if(count===0){
    card.style.display='none';
    return;
  }
  card.style.display='';
  head.textContent='오늘 이미 작성한 원문 · '+count+'건';
  body.innerHTML=renderRawItemsHtml(todayItems, '✅');
  card.classList.toggle('collapsed', !ctxTdExpanded);
}

function toggleCtxYdRaw(){
  ctxYdExpanded=!ctxYdExpanded;
  var card=document.getElementById('ctx-yd-raw');
  if(card)card.classList.toggle('collapsed', !ctxYdExpanded);
}
function toggleCtxTdRaw(){
  ctxTdExpanded=!ctxTdExpanded;
  var card=document.getElementById('ctx-td-raw');
  if(card)card.classList.toggle('collapsed', !ctxTdExpanded);
}

// 어제 원문 접기/펼치기 — 상태 변수 + 카드 클래스 토글만. 재렌더 없이 textarea 편집값 보존.
function toggleYdCard(){
  ydExpanded=!ydExpanded;
  var card=document.getElementById('rep-yd');
  if(card)card.classList.toggle('collapsed', !ydExpanded);
}
function toggleTdCard(){
  tdExpanded=!tdExpanded;
  var card=document.getElementById('rep-td');
  if(card)card.classList.toggle('collapsed', !tdExpanded);
}

function refreshP2YesterdayIfVisible(){
  // 2026-05-11 — no-op 으로 변경.
  // 챗 UX 도입(2026-05-07) 후 renderStructuredReport() 는 ReportChat.start() 만 호출하고
  // 옛 어제 원문 카드 코드는 dead. 그런데 loadYesterdayRaw / loadTodayRaw 가 비동기 응답마다
  // 이 함수를 호출 → ReportChat.start 중복 발동 → API 호출 누적·메시지 중복 그려짐 (요금 과청구).
  // 어제·오늘 원문은 별도 UI 가 없으므로 갱신할 게 없다 — 함수 자체를 no-op 처리.
}

// ── 프로젝트 일정 카드 (Phase 6, 2026-05-15) ─────────────────
// 옛 loadContext / renderContextCards (#ctx-today + getContextForPerson) 폐기.
// 새 흐름: GAS WebhookHandler 의 action=get_schedule → ProjectScheduleStore.getScheduleForUser()
// 응답 = { ok, name, today, window, entries:[{id, pj_code, origin, title, from, to,
//   issued_date, due_date, status, completed_at, source_briefing, view_type, d_offset }] }
//
//   view_type: task / schedule / received / sent
//   d_offset (영업일): 양수 = 미래, 0 = 오늘, 음수 = 과거
//
// 3 카드 분리:
//   카드 1 (#ctx-task)      = task + schedule. 오늘+미래 통합 (preview 2개 + 더 보기).
//   카드 2 (#ctx-directive) = received. 오늘+미래. 어제 제외.
//   카드 3 (#ctx-sent)      = sent (지시자 mirror). 빈 경우 카드 자체 hide.
//
// D-N 표기 (카운트다운식):
//   미래 (d_offset > 0) → D-N (예: 내일 = D-1, 모레 = D-2)
//   오늘 → D-day
//   과거 (d_offset < 0) → D+N (예: 어제 = D+1) — 표시 X (window 미포함)

function loadContext(){
  if(!profile)return;
  renderContextLoading();

  fetch(APPS_SCRIPT_URL+'?action=get_schedule&name='+encodeURIComponent(profile.name)+'&days_before=10&days_after=30')
    .then(function(r){return r.json()})
    .then(function(data){
      if(!data || !data.ok){
        renderScheduleCard({entries:[]});
        return;
      }
      renderScheduleCard(data);
    })
    .catch(function(){
      renderContextError();
    });
}

function setCtxBody(bodyId, html){
  var body=document.getElementById(bodyId);
  if(body)body.innerHTML=html;
}
function setEmptyRow(bodyId, msg){
  setCtxBody(bodyId, '<div class="ctx-row ctx-empty">'+msg+'</div>');
}
function setLoadingRow(bodyId){
  setCtxBody(bodyId, '<div class="ctx-loading-inline">🌿 불러오는 중...</div>');
}

function renderContextLoading(){
  setLoadingRow('ctx-task-body');
  setLoadingRow('ctx-directive-body');
  setLoadingRow('ctx-sent-body');
}
function renderContextError(){
  setEmptyRow('ctx-task-body',      '일정을 불러오지 못했어요... 잠시 후 새로고침 해보세요.');
  setEmptyRow('ctx-directive-body', '지시사항을 불러오지 못했어요...');
  setEmptyRow('ctx-sent-body',      '시킨 지시를 불러오지 못했어요...');
}

// D-N 표기 (카운트다운식)
function formatDOffset(n){
  if(n===0)return 'D-day';
  if(n>0) return 'D-'+n;
  return 'D+'+(-n);
}

function entryIcon(vt){
  if(vt==='task')     return '📝';
  if(vt==='schedule') return '📅';
  if(vt==='received') return '📥';
  if(vt==='sent')     return '📤';
  return '•';
}

function buildEntryRow(e){
  var icon=entryIcon(e.view_type);
  var dLabel=formatDOffset(e.d_offset||0);
  var dueMissing=!e.due_date;
  var pj=(e.pj_code||'기타');
  var title=e.title||'';
  var fromHint='';
  if(e.view_type==='received' && e.from)              fromHint=' (from '+e.from+')';
  else if(e.view_type==='sent' && e.to && e.to!==e.from)fromHint=' (→ '+e.to+')';

  var color='blue';
  if((e.d_offset||0)<0)         color='rose';
  else if(e.view_type==='sent') color='green';

  var d=document.createElement('div');
  d.className='ctx-row '+color;
  d.setAttribute('data-entry-id', e.id||'');
  d.innerHTML=
    '<span class="sch-icon">'+icon+'</span>'+
    '<span class="sch-pj">['+pj+']</span> '+
    '<span class="sch-title">'+title+'</span>'+
    '<span class="sch-from">'+fromHint+'</span>'+
    '<span class="sch-d">'+dLabel+(dueMissing?' ⚠️':'')+'</span>';
  return d;
}

function renderCardSections(bodyId, entries, options){
  options=options||{};
  var body=document.getElementById(bodyId);
  if(!body)return;
  body.innerHTML='';

  var card = options.cardId ? document.getElementById(options.cardId) : null;

  var today=[], future=[];
  entries.forEach(function(e){
    var d=e.d_offset||0;
    if(d === 0) today.push(e);
    else if(d > 0) future.push(e);
    else if(options.includePast) today.push(e);   // 2026-07-23 받은 지시: 기한 지난 미완료도 표시 (완료 체크 대상)
  });

  future.sort(function(a,b){ return a.d_offset - b.d_offset; });

  var futureNear = future.filter(function(e){ return e.d_offset <= 2; });
  if(futureNear.length === 0 && future.length > 0){
    futureNear = [future[0]];
  }

  var combined = today.concat(futureNear);
  combined.sort(function(a,b){ return (a.d_offset||0) - (b.d_offset||0); });

  if(combined.length === 0){
    if(options.hideCardIfEmpty){
      if(card) card.style.display='none';
      return;
    }
    if(card) card.style.display='';
    body.innerHTML='<div class="ctx-row ctx-empty">'+(options.emptyMessage||'표시할 항목이 없습니다')+'</div>';
    return;
  }

  if(card) card.style.display='';

  var box=document.createElement('div');
  box.className='ctx-subbox';

  var previewLimit = options.previewLimit || 0;
  var needsPreview = previewLimit > 0 && combined.length > previewLimit;

  var mkRow = options.completable ? buildCompletableRow : buildEntryRow;   // 2026-07-23 완료 체크 카드
  if(needsPreview){
    var rows = combined.map(function(it){ return mkRow(it); });
    var expanded = false;

    var toggle = document.createElement('button');
    toggle.className = 'ctx-more-btn';
    toggle.type = 'button';

    function applyState(){
      rows.forEach(function(r, i){
        r.style.display = (expanded || i < previewLimit) ? '' : 'none';
      });
      toggle.textContent = expanded
        ? '▲ 접기'
        : '▼ 더 보기 (+' + (combined.length - previewLimit) + ')';
    }
    toggle.onclick = function(){ expanded = !expanded; applyState(); };

    rows.forEach(function(r){ box.appendChild(r); });
    box.appendChild(toggle);
    applyState();
  }else{
    combined.forEach(function(it){ box.appendChild(mkRow(it)); });
  }

  body.appendChild(box);

  // 2026-07-23 — 받은 지시 완료 체크 카드 (테스트서버 검증 후 이식)
  if(options.completable && combined.length){
    var hint=document.createElement('div');
    hint.style.cssText='font-size:11px;color:#8a8578;line-height:1.6;margin:8px 2px 4px;';
    hint.innerHTML='완료한 지시는 체크 후 아래 버튼으로 제출해주세요.<br>아직 진행 중인 지시는 오늘 업무보고 본문에 진행사항을 적어주세요.';
    var doneBtn=document.createElement('button');
    doneBtn.id='dir-done-btn'; doneBtn.type='button'; doneBtn.className='ctx-more-btn';
    doneBtn.textContent='✓ 체크한 지시 완료 제출';
    doneBtn.onclick=submitCompletedDirectives;
    body.appendChild(hint);
    body.appendChild(doneBtn);
  }
}

// 받은 지시 row 앞에 완료 체크박스 부착 (2026-07-23)
function buildCompletableRow(e){
  var row=buildEntryRow(e);
  var chk=document.createElement('input');
  chk.type='checkbox'; chk.className='dir-done-chk';
  chk.setAttribute('data-id', e.id||'');
  chk.style.cssText='margin-right:6px;width:15px;height:15px;flex-shrink:0;cursor:pointer;accent-color:#7C5BC8;';
  row.insertBefore(chk, row.firstChild);
  return row;
}

// 체크한 지시 완료 제출 → sync_schedule → 완료 기록 + 지시자·본부장 알림(서버측) (2026-07-23)
function submitCompletedDirectives(){
  var body=document.getElementById('ctx-directive-body');
  if(!body||!profile)return;
  var checks=body.querySelectorAll('input.dir-done-chk:checked');
  var ids=Array.prototype.map.call(checks,function(c){return c.getAttribute('data-id');}).filter(Boolean);
  if(!ids.length){alert('완료할 지시를 먼저 체크해주세요.');return;}
  if(!confirm('체크한 '+ids.length+'건을 완료 처리할까요?\n완료 시 지시자·본부장에게 알림이 전송됩니다.'))return;
  var btn=document.getElementById('dir-done-btn');
  if(btn){btn.disabled=true;btn.textContent='처리 중...';}
  fetch(APPS_SCRIPT_URL,{method:'POST',body:JSON.stringify({action:'sync_schedule',token:'thehim2026',name:profile.name,completed_ids:ids})})
    .then(function(r){return r.json()})
    .then(function(res){
      if(res&&res.ok){alert('\u2705 '+res.count+'건 완료 처리됐습니다.\n내일 브리핑·아침 알림에서 자동으로 빠집니다.');loadContext();}
      else{alert('처리 실패: '+((res&&res.error)||'알 수 없는 오류'));if(btn){btn.disabled=false;btn.textContent='✓ 체크한 지시 완료 제출';}}
    })
    .catch(function(e){alert('통신 오류: '+e.message);if(btn){btn.disabled=false;btn.textContent='✓ 체크한 지시 완료 제출';}});
}

function renderScheduleCard(data){
  var entries=(data && data.entries)||[];
  var today=data && data.today ? data.today : '';

  var hTask=document.querySelector('#ctx-task .ctx-head span');
  if(hTask) hTask.textContent='일정 확인'+(today?' ('+today+' 기준)':'');

  var taskEntries=[], receivedEntries=[], sentEntries=[];
  entries.forEach(function(e){
    if(e.view_type==='task' || e.view_type==='schedule') taskEntries.push(e);
    else if(e.view_type==='received') receivedEntries.push(e);
    else if(e.view_type==='sent')     sentEntries.push(e);
  });

  renderCardSections('ctx-task-body', taskEntries, {
    cardId: 'ctx-task',
    previewLimit: 2
  });
  renderCardSections('ctx-directive-body', receivedEntries, {
    cardId: 'ctx-directive',
    emptyMessage: '지시받은 사항이 없습니다',
    includePast: true,     // 기한 지난 미완료 지시도 표시 (완료 체크 대상)
    completable: true      // 완료 체크박스 + 제출 버튼 (2026-07-23)
  });
  renderCardSections('ctx-sent-body', sentEntries, {
    cardId: 'ctx-sent',
    hideCardIfEmpty: true
  });
}

function resetProfile(){
  if(!confirm('다른 직원으로 변경할까요? 재인증이 필요합니다.'))return;
  try{
    localStorage.removeItem('himclaude_v2');
    localStorage.removeItem(SESSION_KEY);
  }catch(e){}
  clearDraft();
  hideDraftBanner();
  profile=null;files=[];
  currentStructured=null;lastAIStructured=null;currentRawText='';
  document.getElementById('file-chips').innerHTML='';
  document.getElementById('main-input').value='';
  if(typeof dirxClear==='function')dirxClear();
  goPage('p0');loadStaff();
}

// ── 파일 ──────────────────────
function handleFiles(inp){
  Array.from(inp.files).forEach(function(f){
    if(files.find(function(x){return x.name===f.name}))return;
    files.push(f);
    var ext=f.name.split('.').pop().toLowerCase();
    var icons={pdf:'📄',xlsx:'📊',xls:'📊',doc:'📝',docx:'📝',hwp:'📝',png:'🖼',jpg:'🖼',jpeg:'🖼',mp3:'🎵',m4a:'🎵',wav:'🎵'};
    var chips=document.getElementById('file-chips');
    var c=document.createElement('div');
    c.className='file-chip';c.id='chip-'+f.name;
    c.innerHTML='<span>'+(icons[ext]||'📎')+' '+f.name+'</span><button class="chip-del" onclick="rmFile(\''+f.name+'\')">✕</button>';
    chips.appendChild(c);
  });
  inp.value='';
}
function rmFile(name){
  files=files.filter(function(f){return f.name!==name});
  var c=document.getElementById('chip-'+name);
  if(c)c.remove();
}

