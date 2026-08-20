// ── 분석 → P2 (챗 형식 UX, 2026-05-07) ──────────
function doAnalyze(){
  var txt=document.getElementById('main-input').value.trim();
  var dirBlock=dirxCollect();   // 지시·요청 칸 → [지시사항] 블록으로 본문에 합류 (2026-08-07)
  if(!txt&&!dirBlock){toast('업무 내용을 입력해주세요');return;}
  if(dirBlock)txt=(txt?txt+'\n\n':'')+'[지시사항]\n'+dirBlock;

  currentRawText=txt;
  goPage('p2');
  loadTodayRaw();

  document.getElementById('report-edit-actions').style.display='none';

  // 챗 영역 로딩 표시 (1차 분류 응답 대기)
  var chatBox=document.getElementById('report-chat-messages');
  if(chatBox){
    chatBox.innerHTML=
      '<div class="report-chat-typing" id="report-chat-loading">'+
        '🖌️ 힘클로드가 정리하고 있습니다 — 프로젝트·인물·요청사항을 분리하는 중'+
      '</div>';
  }

  fetch(APPS_SCRIPT_URL,{
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({
      token:APPS_SCRIPT_TOKEN,
      action:'structure_report',
      email:(profile&&profile.email)||'',   // 개인 확정 사전 조회용 (2026-08-20)
      raw:txt
    })
  })
  .then(function(r){return r.json()})
  .then(function(data){
    if(!data.ok)throw new Error(data.message||'구조화 실패');
    currentStructured=data.structured;
    lastAIStructured=JSON.stringify(currentStructured);
    ReportChat.start(currentStructured);   // 챗 시작 (renderStructuredReport 도 동일 호출)
    saveDraft('p2');
  })
  .catch(function(err){
    var box=document.getElementById('report-chat-messages');
    if(box){
      box.innerHTML=
        '<div class="report-chat-msg assistant">⚠️ 분석 실패: '+escapeHtml(String(err))+
          '<br><br>p1 으로 돌아가서 다시 시도해주세요.</div>';
    }
  });
}

function isTestMode(){
  return /^\s*\[테스트\]/.test(currentRawText||'');
}

// ── 브리핑 조회 (세션 + Haiku 분석 + Sonnet 검색) ───
// 흐름: doSearch() → 분석 → 검색 → 결과 (중간 확인 없음, 한 번에 완료)
// 결과가 불만족스러우면 사용자가 검색창에서 다시 입력하면 됨.

var MAX_RANGES = 5;
var SEARCH_HARD_TIMEOUT_MS = 60000; // Sonnet 단계 하드 타임아웃 (60s)
var searchStage = 'idle';   // 'idle' | 'analyzing' | 'searching'
var searchAbortCtrl = null; // 검색 단계 중단용
var searchTimeoutTimer = null;
var searchTimedOut = false;
var searchOriginal  = '';   // 사용자 원본 입력 (Sonnet 호출 시 같이 보냄)
var DATE_RANGE_MIN = null;  // 브리핑 데이터 최초 날짜 (서버에서 받음)
var DATE_RANGE_MAX = null;  // 브리핑 데이터 최신 날짜

function getSession(){
  try{ return localStorage.getItem(SESSION_KEY) || ''; }catch(e){ return ''; }
}

// ── 다중 기간 UI ────────────────────────────────
function initSearchRanges(){
  var container = document.getElementById('search-ranges');
  if(!container) return;
  if(container.children.length > 0) return; // 이미 초기화됨
  container.appendChild(makeRangeRow(true));
  fetchDateRange(); // 브리핑 데이터 날짜 범위 비동기 가져오기
}

function makeRangeRow(isFirst){
  var row = document.createElement('div');
  row.className = 'search-range';
  row.innerHTML =
    '<input type="date" class="range-from">'
    + '<span class="rng-sep">~</span>'
    + '<input type="date" class="range-to">'
    + '<button class="range-btn add" onclick="addRange()" title="기간 추가">+</button>'
    + '<button class="range-btn rm hidden" onclick="removeRange(this)" title="이 기간 제거">×</button>';
  applyDateRangeToRow(row);
  return row;
}

// 서버에서 브리핑 날짜 범위 받아 date picker min/max 에 적용
function fetchDateRange(){
  var sess = getSession();
  if(!sess) return;
  fetch(APPS_SCRIPT_URL + '?action=get_range&session=' + encodeURIComponent(sess))
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(!d.ok) return;
      DATE_RANGE_MIN = d.earliest || null;
      DATE_RANGE_MAX = d.latest   || null;
      applyDateRangeToAll();
    })
    .catch(function(){});
}

function applyDateRangeToRow(row){
  if(!DATE_RANGE_MIN || !DATE_RANGE_MAX) return;
  var f = row.querySelector('.range-from');
  var t = row.querySelector('.range-to');
  if(f){ f.min = DATE_RANGE_MIN; f.max = DATE_RANGE_MAX; }
  if(t){ t.min = DATE_RANGE_MIN; t.max = DATE_RANGE_MAX; }
}

function applyDateRangeToAll(){
  var rows = document.querySelectorAll('#search-ranges .search-range');
  rows.forEach(applyDateRangeToRow);
}

function addRange(){
  var container = document.getElementById('search-ranges');
  var rows = container.querySelectorAll('.search-range');
  if(rows.length >= MAX_RANGES){
    toast('기간은 최대 ' + MAX_RANGES + '개까지');
    return;
  }
  container.appendChild(makeRangeRow(false));
  updateRangeButtons();
}

function removeRange(btn){
  var row = btn.closest('.search-range');
  if(!row) return;
  row.parentNode.removeChild(row);
  updateRangeButtons();
}

function updateRangeButtons(){
  var rows = document.querySelectorAll('#search-ranges .search-range');
  rows.forEach(function(row, idx){
    var addBtn = row.querySelector('.range-btn.add');
    var rmBtn  = row.querySelector('.range-btn.rm');
    // + 는 마지막 행에만 + 개수 제한 미달일 때만
    if(idx === rows.length - 1 && rows.length < MAX_RANGES){
      addBtn.classList.remove('hidden');
    } else {
      addBtn.classList.add('hidden');
    }
    // × 는 2번째 이상 행부터
    if(idx === 0){
      rmBtn.classList.add('hidden');
    } else {
      rmBtn.classList.remove('hidden');
    }
  });
}

function collectRanges(){
  var rows = document.querySelectorAll('#search-ranges .search-range');
  var ranges = [];
  for(var i = 0; i < rows.length; i++){
    var f = rows[i].querySelector('.range-from').value;
    var t = rows[i].querySelector('.range-to').value;
    if(!f || !t) continue;
    if(f > t) return {error: (i+1) + '번째 기간: 시작일이 종료일보다 뒤입니다'};
    ranges.push({from: f, to: t});
  }
  if(ranges.length === 0) return {error: '기간을 선택해 주세요'};
  return {list: ranges};
}

function rangesToQuery(rangesList){
  return rangesList.map(function(r){ return r.from + '~' + r.to; }).join(',');
}

// 검색 textarea — Enter 검색, Shift+Enter 줄바꿈
function searchKwKeydown(e){
  if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){
    e.preventDefault();
    doSearch();
  }
}

// 공용 textarea autosize — 내용 길이에 따라 박스 높이 조정
// main-textarea / rep-textarea / proj-field / 검색창 모두 사용
function autosizeTa(el){
  if(!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
// 검색창 전용 — 하위호환 alias
function autosizeSearchKw(el){ autosizeTa(el); }

// ── 검색 파이프라인 — 원클릭, 분석→검색 연쇄 ─────
function doSearch(){
  if(searchStage === 'analyzing' || searchStage === 'searching'){
    cancelActiveSearch();
    return;
  }

  var sess = getSession();
  if(!sess){ forceReauth('재인증이 필요합니다'); return; }

  var rObj = collectRanges();
  if(rObj.error){ toast(rObj.error); return; }
  var raw = (document.getElementById('search-keyword').value || '').trim();
  if(!raw){ toast('검색 내용을 입력해 주세요'); return; }

  searchOriginal = raw;
  setSearchStage('analyzing');

  var res = document.getElementById('search-results');
  res.innerHTML = '<div class="search-loading">🧠 검색어 분석 중...</div>';

  // Stage A: Haiku 로 검색어 추출 (사용자에게는 보이지 않음)
  var analyzeUrl = APPS_SCRIPT_URL
    + '?action=analyze_query'
    + '&session=' + encodeURIComponent(sess)
    + '&raw='     + encodeURIComponent(raw);

  fetch(analyzeUrl)
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(d.ok === false && d.error === 'session_invalid'){
        forceReauth('🔐 인증이 만료되었습니다');
        return;
      }
      if(!d.ok){
        setSearchStage('idle');
        res.innerHTML = '<div class="search-results-empty">⚠️ 검색어 분석 실패<br><span style="font-size:11px">' + escapeHtml(d.error || '') + '</span></div>';
        return;
      }
      var keywords = d.keywords && d.keywords.length ? d.keywords : [raw];
      runFinalSearch(sess, rObj.list, keywords);
    })
    .catch(function(e){
      setSearchStage('idle');
      res.innerHTML = '<div class="search-results-empty">⚠️ 네트워크 오류 (분석 단계)<br><span style="font-size:11px">' + escapeHtml(e.message || '') + '</span></div>';
    });
}

// Stage B: Sonnet 검색 — 추출된 키워드로 실제 조회·답변 생성
function runFinalSearch(sess, rangesList, keywords){
  setSearchStage('searching');
  searchTimedOut = false;

  var res = document.getElementById('search-results');
  res.innerHTML = '<div class="search-loading">🔍 힘클로드 검색 중... (최대 1분)<br><span style="font-size:11px;color:var(--ink3)">오래 걸리면 위 🛑 검색 중단 버튼</span></div>';

  searchAbortCtrl = ('AbortController' in window) ? new AbortController() : null;
  var fetchOpts = searchAbortCtrl ? {signal: searchAbortCtrl.signal} : {};

  // 하드 타임아웃 — 60초 초과 시 자동 abort
  clearSearchTimeout();
  if(searchAbortCtrl){
    searchTimeoutTimer = setTimeout(function(){
      searchTimedOut = true;
      try{ searchAbortCtrl.abort(); }catch(e){}
    }, SEARCH_HARD_TIMEOUT_MS);
  }

  var url = APPS_SCRIPT_URL
    + '?action=query'
    + '&session='   + encodeURIComponent(sess)
    + '&ranges='    + encodeURIComponent(rangesToQuery(rangesList))
    + '&keywords='  + encodeURIComponent(keywords.join(','))
    + '&original='  + encodeURIComponent(searchOriginal);

  fetch(url, fetchOpts)
    .then(function(r){ return r.json(); })
    .then(function(d){
      clearSearchTimeout();
      setSearchStage('idle');
      if(!d.ok){
        if(d.error === 'session_invalid'){
          forceReauth('🔐 인증이 만료되었습니다');
          return;
        }
        res.innerHTML = '<div class="search-results-empty">⚠️ ' + escapeHtml(d.error || '오류가 발생했습니다') + '</div>';
        return;
      }
      renderSearchAnswer(d);
    })
    .catch(function(e){
      clearSearchTimeout();
      setSearchStage('idle');
      if(e && e.name === 'AbortError'){
        if(searchTimedOut){
          res.innerHTML = '<div class="search-results-empty">⏱️ 검색이 60초를 초과했습니다<br>'
            + '<span style="font-size:11px">기간을 좁히거나 키워드를 구체화해서 다시 시도해 주세요</span></div>';
        } else {
          res.innerHTML = '<div class="search-results-empty">🛑 검색이 중단되었습니다</div>';
        }
        return;
      }
      res.innerHTML = '<div class="search-results-empty">⚠️ 네트워크 오류<br>'
        + '<span style="font-size:11px">' + escapeHtml(e.message || '') + '</span></div>';
    });
}

function clearSearchTimeout(){
  if(searchTimeoutTimer){
    clearTimeout(searchTimeoutTimer);
    searchTimeoutTimer = null;
  }
}

function cancelActiveSearch(){
  clearSearchTimeout();
  if(searchAbortCtrl){
    try{ searchAbortCtrl.abort(); }catch(e){}
  }
  // analyzing 단계는 abort 없이 stage 리셋만 (Haiku 는 빨라서 그냥 무시)
  setSearchStage('idle');
  var res = document.getElementById('search-results');
  if(res && ((res.innerHTML||'').indexOf('검색 중') !== -1 || (res.innerHTML||'').indexOf('분석 중') !== -1)){
    res.innerHTML = '<div class="search-results-empty">🛑 검색이 중단되었습니다</div>';
  }
}

// ── 버튼 상태 갱신 ────────────────────────────
function setSearchStage(next){
  searchStage = next;
  var btn = document.getElementById('search-btn-main');
  if(!btn) return;
  if(next === 'analyzing'){
    btn.innerHTML = '🛑 중단 (분석 중...)';
    btn.classList.add('cancel');
    btn.disabled = false;
  } else if(next === 'searching'){
    btn.innerHTML = '🛑 검색 중단';
    btn.classList.add('cancel');
    btn.disabled = false;
  } else { // idle
    btn.innerHTML = '🔍 검색';
    btn.classList.remove('cancel');
    btn.disabled = false;
  }
}

// ── 결과 렌더 ────────────────────────────────
function renderSearchAnswer(d){
  var res = document.getElementById('search-results');
  var meta = '해당 기간 브리핑 총 ' + (d.scanned||0) + '건 중 매칭 ' + (d.matched||0) + '건';
  if(d.dates && d.dates.length){
    var first = d.dates[0], last = d.dates[d.dates.length-1];
    meta += '<br>' + first + (first === last ? '' : ' ~ ' + last);
  }
  var noticeHtml = d.notice
    ? '<div class="search-notice">💡 ' + escapeHtml(d.notice) + '</div>'
    : '';
  res.innerHTML =
    '<div class="search-answer">' + renderAnswerHtml(d.answer || '') + '</div>'
    + noticeHtml
    + '<div class="search-meta">' + meta + '</div>';
}

// 작은 마크다운 렌더러 — **bold**, --- 구분선, > 인용
// (HTML escape 먼저 → 마크다운 변환 순서 중요)
function renderAnswerHtml(text){
  if(!text) return '';
  var html = escapeHtml(text);
  // **bold** — non-greedy, 별표·줄바꿈 사이 금지
  html = html.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  // 단독 줄에 --- 또는 ---- (3개 이상)
  html = html.replace(/^---+\s*$/gm, '<hr class="ans-sep">');
  // > 인용 (escape 후 &gt; 가 됨)
  html = html.replace(/^&gt;\s?(.*)$/gm, '<div class="ans-quote">$1</div>');
  return html;
}

// ── 드래프트 (localStorage + 서버 동기화) ──────────────────────
// 2026-05-07: 서버 동기화 추가. 다른 기기/브라우저에서 이어쓰기 가능.
//   서버 저장소: Drive 의 직원 draft/{이름}.json
//   timestamp 비교: 서버가 1초 이상 더 최신이면 충돌 다이얼로그 표시
//   session 은 디바이스 단위 유지 (의도적) — 동기화 X
var DRAFT_KEY='himclaude_v2_draft';
var DRAFT_SERVER_DEBOUNCE_MS = 3000;  // 서버 push 디바운스 (작성 중 매번 보내지 않음)
var _draftServerTimer = null;

function getDeviceLabel(){
  try{
    var ua = navigator.userAgent || '';
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return '휴대폰';
    return 'PC';
  } catch(e) { return '기기'; }
}

function saveDraft(stage){
  if(!profile)return;
  try{
    var mi=document.getElementById('main-input');
    var d={
      email: profile.email,
      date: dateStr,
      stage: stage,  // 'p1' | 'p2'
      raw: mi?mi.value:'',
      currentRaw: currentRawText,
      structured: currentStructured,
      lastAI: lastAIStructured,
      savedAt: Date.now(),
      device: getDeviceLabel()
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    // 서버 push 디바운스 — 작성 중엔 로컬만 반복, 일시 멈춤 시 서버에 1회
    if (_draftServerTimer) clearTimeout(_draftServerTimer);
    _draftServerTimer = setTimeout(function(){ saveDraftToServer(d); }, DRAFT_SERVER_DEBOUNCE_MS);
  }catch(e){}
}

function saveDraftToServer(d){
  if(!profile||!profile.name) return;
  try{
    fetch(APPS_SCRIPT_URL,{
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({
        token: APPS_SCRIPT_TOKEN,
        action: 'save_draft',
        name: profile.name,
        email: d.email,
        date: d.date,
        stage: d.stage,
        raw: d.raw,
        currentRaw: d.currentRaw,
        structured: d.structured,
        lastAI: d.lastAI,
        savedAt: d.savedAt,
        device: d.device
      })
    }).catch(function(){ /* 네트워크 실패 — 다음 디바운스에 재시도 */ });
  }catch(e){}
}

function loadDraftFromServer(){
  return new Promise(function(resolve){
    if(!profile||!profile.name){resolve(null);return;}
    var url = APPS_SCRIPT_URL + '?action=load_draft&name=' + encodeURIComponent(profile.name);
    fetch(url)
      .then(function(r){return r.json()})
      .then(function(d){
        if(!d||!d.ok||!d.draft){resolve(null);return;}
        // 자기 email 확인 + 옛 날짜는 무시 (오늘 날짜만)
        if(profile.email && d.draft.email && d.draft.email !== profile.email){resolve(null);return;}
        if(d.draft.date && d.draft.date !== dateStr){resolve(null);return;}
        resolve(d.draft);
      })
      .catch(function(){resolve(null);});
  });
}

function scheduleDraftSave(stage){
  if(_draftSaveTimer)clearTimeout(_draftSaveTimer);
  _draftSaveTimer=setTimeout(function(){saveDraft(stage)}, 400);
}
function loadDraft(){
  try{
    var s=localStorage.getItem(DRAFT_KEY);
    if(!s)return null;
    var d=JSON.parse(s);
    if(!d||!profile||d.email!==profile.email)return null;
    if(d.date!==dateStr){clearDraft();return null;}
    return d;
  }catch(e){return null}
}
function clearDraft(){
  try{localStorage.removeItem(DRAFT_KEY);}catch(e){}
  // 서버에서도 삭제 (best-effort, 실패 무시)
  try{
    if(profile && profile.name){
      fetch(APPS_SCRIPT_URL,{
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body: JSON.stringify({
          token: APPS_SCRIPT_TOKEN,
          action: 'delete_draft',
          name: profile.name
        })
      }).catch(function(){});
    }
  }catch(e){}
}
function describeDraftAge(ts){
  var diff=Math.floor((Date.now()-ts)/60000);
  if(diff<1)return '방금 저장됨';
  if(diff<60)return diff+'분 전 저장됨';
  var h=Math.floor(diff/60);
  var m=diff%60;
  return h+'시간'+(m?' '+m+'분':'')+' 전 저장됨';
}
function maybeShowDraftBanner(){
  // 서버 비교는 비동기 — 결과 도착 후 충돌 다이얼로그 또는 일반 배너
  var local = loadDraft();
  var banner = document.getElementById('draft-banner');
  loadDraftFromServer().then(function(server){
    decideDraftReconcile_(local, server, banner);
  });
}
function decideDraftReconcile_(local, server, banner){
  // 1) 둘 다 없음 → 배너 숨김
  if (!local && !server) {
    banner.classList.remove('on');
    return;
  }
  // 2) 서버가 명확히 더 최신 (1초 이상 차이) → 충돌 다이얼로그
  var localTs  = local  ? (local.savedAt  || 0) : 0;
  var serverTs = server ? (server.savedAt || 0) : 0;
  if (server && serverTs > localTs + 1000) {
    showDraftConflictDlg(local, server);
    return;
  }
  // 3) 서버만 있고 로컬 없음 → 서버 데이터 로컬에 복사 후 일반 배너
  if (server && !local) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(server)); } catch(e){}
  }
  // 4) 일반 배너 (기존 흐름)
  showLocalDraftBanner_();
}
function showLocalDraftBanner_(){
  var d = loadDraft();
  var banner = document.getElementById('draft-banner');
  if(!d){banner.classList.remove('on');return;}
  var hasRaw = d.raw && d.raw.trim();
  var hasStructured = d.structured && d.stage==='p2';
  if(!hasRaw && !hasStructured){clearDraft(); banner.classList.remove('on'); return;}
  var label = '이어서 작성하시겠어요?';
  if(d.stage==='p2') label = '정리된 보고서가 있어요. 이어서 편집하시겠어요?';
  banner.querySelector('b').textContent = label;
  document.getElementById('draft-time').textContent = describeDraftAge(d.savedAt);
  banner.classList.add('on');
}
function showDraftConflictDlg(local, server){
  var dlg = document.getElementById('draft-conflict-dlg');
  if(!dlg) return;
  function snippet(s){
    s = String(s||'').replace(/\s+/g,' ').trim();
    if(!s) return '(작성 내용 없음)';
    if(s.length <= 40) return s;
    return s.slice(0,40) + '…';
  }
  function fmt(ts){
    if(!ts) return '';
    var d = new Date(ts);
    var mo = d.getMonth()+1, dd = d.getDate();
    var hh = String(d.getHours()).padStart(2,'0');
    var mm = String(d.getMinutes()).padStart(2,'0');
    return mo+'월 '+dd+'일 '+hh+':'+mm;
  }
  document.getElementById('conflict-server-head').textContent =
    (server.device || '다른 기기') + ' · ' + fmt(server.savedAt);
  document.getElementById('conflict-server-body').textContent = snippet(server.raw || '');
  document.getElementById('conflict-server-row').style.display = '';
  if (local && (local.raw || (local.structured && local.stage==='p2'))) {
    document.getElementById('conflict-local-head').textContent =
      (local.device || '이 기기') + ' · ' + fmt(local.savedAt);
    document.getElementById('conflict-local-body').textContent = snippet(local.raw || '');
    document.getElementById('conflict-local-row').style.display = '';
  } else {
    document.getElementById('conflict-local-row').style.display = 'none';
  }
  dlg.classList.add('on');
}
function closeDraftConflictDlg(){
  document.getElementById('draft-conflict-dlg').classList.remove('on');
}
function useServerDraft(){
  loadDraftFromServer().then(function(server){
    closeDraftConflictDlg();
    if(!server){ return; }
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(server)); } catch(e){}
    showLocalDraftBanner_();
  });
}
function useLocalDraft(){
  closeDraftConflictDlg();
  // 로컬이 진실 — 서버 덮어쓰기
  var d = loadDraft();
  if (d) saveDraftToServer(d);
  showLocalDraftBanner_();
}
// 2026-08-13 — p2 초안에 실제로 복원할 알맹이가 있는지 판정.
//   projects 가 비고 meeting/issue/dir/schedule 도 전부 비면 화면에 그릴 게 없다.
//   common.content 는 판정에서 뺀다 — AI 가 입력이 부실할 때 "보고 내용이 명확하지
//   않아…" 같은 안내문을 여기 채워 넣기 때문에, 이걸 알맹이로 치면 빈 초안을
//   걸러내지 못한다(실제 사고 원인).
function draftHasBody_(s){
  if(!s) return false;
  if(s.projects && s.projects.length) return true;
  var c=s.common||{};
  return ['meeting','issue','dir','schedule'].some(function(k){
    return String(c[k]||'').trim() !== '';
  });
}
function restoreDraft(silent){
  var d=loadDraft();
  if(!d){hideDraftBanner();return;}
  // 알맹이 없는 p2 초안을 복원하면 백지 화면에 갇힌다 → 복원 대신 p1 으로 되돌리고 폐기.
  if(d.stage==='p2' && d.structured && !draftHasBody_(d.structured)){
    clearDraft();
    hideDraftBanner();
    goPage('p1');
    toast('정리된 내용이 비어 있어 새로 시작합니다');
    return;
  }
  // 사용자가 배너 "이어서" 클릭 시 manualP1 flag 자동 reset (의지 변경)
  if (d.manualP1){
    delete d.manualP1;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch(e){}
  }
  var mi=document.getElementById('main-input');
  if(mi&&d.raw){mi.value=d.raw; autosizeTa(mi);}
  if(d.stage==='p2'&&d.structured){
    currentRawText=d.currentRaw||'';
    currentStructured=d.structured;
    lastAIStructured=d.lastAI||null;
    goPage('p2');
    loadTodayRaw();
    // 2026-05-21 v2 — restoreDraft = 이어쓰기 케이스. resumed flag 전달해서 Claude 가 진행 요약 양식으로 시작.
    renderStructuredReport({ resumed: true });
  }
  hideDraftBanner();
  if (!silent) toast('💾 이어서 작성');
}
function discardDraft(){
  clearDraft();
  hideDraftBanner();
}
function hideDraftBanner(){
  document.getElementById('draft-banner').classList.remove('on');
}

// ── disambiguation 챗 (2026-05-07) ──────────
// 'AI로 정리' 후 p2 진입 시 시작. ambiguities 가 있으면 사용자에게 한 개씩 묻고,
// 없으면 발송 가능 메시지로 마무리. 사용자 자유 수정도 챗 안에서 처리.
var ReportChat = {
  history: [],
  busy: false,
  _session: 0,          // 시작·재시작마다 증가. 응답 처리 시 토큰 비교로 stale 응답 차단.
  _abortCtrl: null,     // 진행 중 fetch — start 호출 시 abort.

  start: function(structured, opts) {
    // 진행 중 fetch 가 있으면 abort + session 증가 → 늦게 도착하는 응답은 _send 핸들러가 무시.
    // 2026-05-11 — start 가 빠르게 여러 번 호출되거나 (loadTodayRaw 등 비동기 갱신 race)
    // 늦은 응답이 도착해 메시지가 중복 그려지는 버그 차단.
    opts = opts || {};
    this._session++;
    if (this._abortCtrl) { try { this._abortCtrl.abort(); } catch(e){} }
    this._abortCtrl = null;
    this.history = [];
    this.busy    = false;
    var box = document.getElementById('report-chat-messages');
    if (box) box.innerHTML = '';
    document.getElementById('report-edit-actions').style.display='none';
    // 첫 turn — 자동으로 시작 메시지 보내서 Claude 의 첫 질문 받기
    // 2026-05-21 v2 — opts.resumed=true 일 때만 이어쓰기 양식 (restoreDraft 호출 케이스).
    // 1차 분류 직후의 Tier 자동 confirm 은 "이어쓰기" 가 아니므로 일반 첫 turn 으로 시작.
    var startMsg = opts.resumed
      ? '이어쓰기로 시작합니다. 이전에 확정된 항목들을 한 번 요약해 알려주시고, 남은 항목들을 확인해주세요.'
      : '정리 시작해주세요. 첫 항목부터 확인해주세요.';
    this._send(startMsg, /*hideUser*/ true);
  },

  // batch UI — 다중 선택 그룹 렌더 (Phase 2, 2026-05-21)
  // groups = [{ token, category, label, options:[{label,value},...] }, ...]
  addChoiceGroups: function(groups) {
    var box = document.getElementById('report-chat-messages');
    if (!box || !Array.isArray(groups) || groups.length === 0) return;
    var self = this;
    var container = document.createElement('div');
    container.className = 'report-chat-choice-groups';
    var groupEls = [];
    groups.forEach(function(g, idx) {
      var fs = document.createElement('fieldset');
      fs.className = 'choice-group';
      var legend = document.createElement('legend');
      legend.textContent = g.label || ((idx+1) + '. ' + g.token);
      fs.appendChild(legend);
      (g.options || []).forEach(function(o) {
        var lbl = document.createElement('label');
        lbl.className = 'choice-option';
        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'cg-' + idx;
        radio.value = o.value;
        radio.setAttribute('data-label', o.label);
        lbl.appendChild(radio);
        var span = document.createElement('span');
        span.textContent = o.label;
        lbl.appendChild(span);
        fs.appendChild(lbl);
      });
      container.appendChild(fs);
      groupEls.push({ token: g.token, element: fs });
    });
    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'choice-confirm-btn';
    confirmBtn.textContent = '확인';
    confirmBtn.onclick = function() {
      var parts = [];
      groupEls.forEach(function(ge) {
        var checked = ge.element.querySelector('input[type=radio]:checked');
        if (!checked) return;
        var lbl = checked.getAttribute('data-label') || checked.value;
        parts.push(ge.token + ': ' + lbl);
      });
      if (parts.length === 0) {
        toast('하나 이상 선택해주세요.');
        return;
      }
      confirmBtn.disabled = true;
      container.style.opacity = '0.6';
      container.style.pointerEvents = 'none';
      var text = parts.join(', ');
      self.addMsg('user', text);
      self._send(text, /*hideUser*/ true);
    };
    container.appendChild(confirmBtn);
    box.appendChild(container);
    box.scrollTop = box.scrollHeight;
  },

  addMsg: function(role, text, quickReplies) {
    var box = document.getElementById('report-chat-messages');
    if (!box) return;
    var div = document.createElement('div');
    div.className = 'report-chat-msg ' + role;
    var formatted = String(text || '').replace(/\s*([①②③④⑤⑥⑦⑧⑨⑩])\s*/g, '\n$1 ').replace(/^\n+/, '');
    div.textContent = formatted;
    box.appendChild(div);

    // quick_replies 버튼 list (assistant 메시지 + 비어있지 않을 때만)
    if (role === 'assistant' && Array.isArray(quickReplies) && quickReplies.length) {
      var btnBox = document.createElement('div');
      btnBox.className = 'report-chat-quick-replies';
      var self = this;
      quickReplies.forEach(function(qr) {
        var label = String(qr.label || qr.value || '');
        var value = String(qr.value || qr.label || '');
        if (!label && !value) return;
        var btn = document.createElement('button');
        btn.className = 'report-chat-quick-btn';
        btn.type = 'button';
        btn.textContent = label;
        btn.onclick = function() {
          // 버튼 클릭 시 — value 를 사용자 답변으로 send (사용자 풍선에는 label 표시)
          self.addMsg('user', label);
          self._send(value, /*hideUser*/ true);
        };
        btnBox.appendChild(btn);
      });
      box.appendChild(btnBox);
    }

    box.scrollTop = box.scrollHeight;
  },

  addTyping: function() {
    var box = document.getElementById('report-chat-messages');
    if (!box) return null;
    var div = document.createElement('div');
    div.className = 'report-chat-typing';
    div.textContent = '응답 중...';
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  },

  removeTyping: function(el) { if (el && el.parentNode) el.parentNode.removeChild(el); },

  onKeyDown: function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendFromInput(); }
  },

  sendFromInput: function() {
    var ta = document.getElementById('report-chat-input');
    if (!ta) return;
    var text = ta.value.trim();
    if (!text) return;
    ta.value = '';
    autosizeTa(ta);
    this._send(text, false);
  },

  _send: function(text, hideUser) {
    if (this.busy) return;
    this.busy = true;
    var btn = document.getElementById('report-chat-send-btn');
    if (btn) btn.disabled = true;
    if (!hideUser) this.addMsg('user', text);
    var typing = this.addTyping();
    var self = this;
    // 응답 시점에 session 비교해서 stale 응답(start 재호출로 이전 fetch 가 폐기된 경우) 차단.
    var session = self._session;
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    self._abortCtrl = ctrl;

    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        token:       APPS_SCRIPT_TOKEN,
        action:      'chat_disambiguate',
        email:       (profile && profile.email) || '',   // 개인 확정 사전 조회·저장용 (2026-08-20)
        raw:         currentRawText || '',
        structured:  currentStructured,
        history:     self.history,
        userMessage: text
      }),
      signal: ctrl ? ctrl.signal : undefined
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      // stale 응답 가드 — start 가 재호출되어 session 이 증가했다면 이 응답은 무시 (중복 메시지·요금 누적 차단).
      if (session !== self._session) { return; }
      self.removeTyping(typing);
      if (!d.ok) { self.addMsg('assistant', '⚠️ ' + (d.message || '오류')); return; }
      // race condition 가드 — fetch 진행 중 사용자가 newRep 등으로 INPUT 복귀했다면
      // edit-actions 토글이 INPUT 화면에 발송 버튼을 노출시키는 버그 (2026-05-11 수정).
      // chat 자체가 hidden 인 경우(완료 화면·INPUT)에는 응답 메시지·버튼 토글 모두 skip.
      var editPage = document.getElementById('report-page-edit');
      if (!editPage || editPage.style.display === 'none') { return; }
      self.history.push({ role: 'user',      content: text });
      self.history.push({ role: 'assistant', content: d.message || '' });
      if (d.updated_structured) {
        currentStructured = d.updated_structured;
        lastAIStructured  = JSON.stringify(currentStructured);
        try { saveDraft('p2'); } catch(e){}
      }
      // 2026-05-21 Phase 2 — choice_groups 가 있으면 batch UI 렌더, 없으면 기존 quick_replies
      var cg = Array.isArray(d.choice_groups) ? d.choice_groups : [];
      if (cg.length > 0) {
        self.addMsg('assistant', d.message || '(응답 없음)', []);
        self.addChoiceGroups(cg);
      } else {
        self.addMsg('assistant', d.message || '(응답 없음)', d.quick_replies || []);
      }
      if (d.ready_to_send) {
        document.getElementById('report-edit-actions').style.display = 'flex';
        self.addMsg('system', '✓ 확인 완료. 화면 하단의 "일일보고 발송" 버튼을 눌러주세요.');
      } else {
        document.getElementById('report-edit-actions').style.display = 'none';
      }
      // edit-actions 표시 토글로 bottom-fixed 높이가 변했으므로 chat-input 위치 재조정.
      // 이 호출 없으면 chat-input 이 viewport bottom 고정 상태로 남아 발송 버튼과 겹침.
      if (typeof Report !== 'undefined' && Report.adjustEditLayout) Report.adjustEditLayout();
    })
    .catch(function(err){
      // abort 는 정상적인 폐기 — 사용자에게 노출 X
      if (err && (err.name === 'AbortError' || /aborted/i.test(String(err.message||'')))) { return; }
      if (session !== self._session) { return; }
      self.removeTyping(typing);
      self.addMsg('assistant', '⚠️ 네트워크 오류: ' + err);
    })
    .then(function(){
      if (session !== self._session) { return; }
      self.busy = false;
      if (btn) btn.disabled = false;
      if (self._abortCtrl === ctrl) self._abortCtrl = null;
    });
  }
};

// ── 챗 음성입력 (2026-05-21) ──────────────────────
// Toggle 클릭 시작·종료 + VAD 침묵 자동 종료 + 자동 챗 전송.
// CLOVA STT 호출은 raw 입력의 _voiceSendSTT 재사용 (Voice 객체 + Voice.target='chat' 분기).
var ChatVoice = {
  active:            false,
  audioContext:      null,
  analyser:          null,
  vadRafId:          null,
  silenceStart:      null,
  SILENCE_THRESHOLD: 18,
  SILENCE_DURATION_MS: 2000,
  MIN_RECORD_MS:     1500,

  toggle: function(){
    if (Voice.state === 'converting') return;
    if (this.active) this.stop();
    else             this.start();
  },

  start: function(){
    var self = this;
    if (Voice.state !== 'idle' && Voice.target !== 'chat') {
      toast('raw 입력 음성 패널이 열려있습니다. 먼저 종료해주세요');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('이 브라우저는 음성 입력을 지원하지 않습니다');
      return;
    }
    navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
      Voice.stream = stream;
      Voice.target = 'chat';
      self._startRecording();
      self._setupVAD(stream);
      self.active = true;
      self._updateButton('recording');
    }).catch(function(err){
      console.warn('[ChatVoice] getUserMedia', err);
      toast('⚠️ 마이크 권한이 필요합니다');
      Voice.target = null;
    });
  },

  _startRecording: function(){
    var candidates = ['audio/webm;codecs=opus','audio/webm','audio/mp4'];
    var mt = '';
    for (var i=0; i<candidates.length; i++){
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidates[i])){ mt=candidates[i]; break; }
    }
    Voice.mimeType = mt || '';
    Voice.chunks = [];
    Voice.blob = null;
    try {
      Voice.rec = mt ? new MediaRecorder(Voice.stream,{mimeType:mt}) : new MediaRecorder(Voice.stream);
    } catch(e){
      console.warn('[ChatVoice] rec init', e);
      toast('녹음 시작 실패');
      this._cleanup();
      return;
    }
    var self = this;
    Voice.rec.ondataavailable = function(e){ if (e.data && e.data.size>0) Voice.chunks.push(e.data); };
    Voice.rec.onstop = function(){
      var type = Voice.mimeType || (Voice.chunks[0] && Voice.chunks[0].type) || 'audio/webm';
      var blob = new Blob(Voice.chunks, {type:type});
      if (blob.size < 2000){
        toast('음성이 너무 짧습니다');
        self._cleanup();
        return;
      }
      Voice.blob = blob;
      Voice.durationMs = Date.now() - Voice.startTs;
      self._updateButton('converting');
      Voice.state = 'converting';
      _voiceSendSTT('close');
    };
    Voice.startTs = Date.now();
    Voice.rec.start();
    Voice.state = 'recording';
  },

  _setupVAD: function(stream){
    var self = this;
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      var source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      var dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      function check(){
        if (!self.active) return;
        self.analyser.getByteFrequencyData(dataArray);
        var sum = 0;
        for (var i=0; i<dataArray.length; i++) sum += dataArray[i];
        var avg = sum / dataArray.length;
        var elapsed = Date.now() - Voice.startTs;
        if (elapsed < self.MIN_RECORD_MS){
          // warm-up
        } else if (avg < self.SILENCE_THRESHOLD){
          if (!self.silenceStart) self.silenceStart = Date.now();
          else if (Date.now() - self.silenceStart > self.SILENCE_DURATION_MS){
            self.stop();
            return;
          }
        } else {
          self.silenceStart = null;
        }
        self.vadRafId = requestAnimationFrame(check);
      }
      this.vadRafId = requestAnimationFrame(check);
    } catch(e){
      console.warn('[ChatVoice] VAD setup failed', e);
    }
  },

  stop: function(){
    if (!this.active) return;
    this.active = false;
    if (this.vadRafId){ cancelAnimationFrame(this.vadRafId); this.vadRafId = null; }
    this.silenceStart = null;
    if (this.audioContext){
      try { this.audioContext.close(); } catch(e){}
      this.audioContext = null;
    }
    if (Voice.rec && Voice.rec.state !== 'inactive'){
      try { Voice.rec.stop(); } catch(e){}
    }
  },

  _onSTTResult: function(text){
    var self = this;
    var ta = document.getElementById('report-chat-input');
    if (ta){
      ta.value = text;
      if (typeof autosizeTa === 'function') autosizeTa(ta);
    }
    setTimeout(function(){
      if (typeof ReportChat !== 'undefined' && ReportChat.sendFromInput){
        ReportChat.sendFromInput();
      }
      self._cleanup();
    }, 500);
  },

  _cleanup: function(){
    if (this.vadRafId){ cancelAnimationFrame(this.vadRafId); this.vadRafId = null; }
    this.silenceStart = null;
    if (this.audioContext){
      try { this.audioContext.close(); } catch(e){}
      this.audioContext = null;
    }
    if (Voice.rec){
      try { if (Voice.rec.state !== 'inactive') Voice.rec.stop(); } catch(e){}
      Voice.rec = null;
    }
    if (Voice.stream){
      try { Voice.stream.getTracks().forEach(function(t){ t.stop(); }); } catch(e){}
      Voice.stream = null;
    }
    Voice.blob = null;
    Voice.chunks = [];
    Voice.target = null;
    Voice.state = 'idle';
    this.active = false;
    this._updateButton('idle');
  },

  _updateButton: function(state){
    var btn = document.getElementById('report-chat-mic-btn');
    if (!btn) return;
    btn.classList.remove('recording','converting');
    if (state === 'recording'){
      btn.classList.add('recording');
      btn.textContent = '⏹';
      btn.title = '녹음 중 — 클릭 시 종료 (또는 2초 침묵 시 자동 종료)';
    } else if (state === 'converting'){
      btn.classList.add('converting');
      btn.textContent = '⏳';
      btn.title = 'CLOVA 변환 중...';
    } else {
      btn.textContent = '🎤';
      btn.title = '음성 입력 (클릭하여 녹음 시작·종료 / 침묵 시 자동 종료)';
    }
  }
};

// ── SearchVoice — 인사이트(mode-search) 챗 음성 입력. ChatVoice 복제.
// target='search', textarea='#chat-input', 자동 전송 = Chat.sendFromInput().
// CLOVA STT 호출은 _voiceSendSTT 재사용 (Voice.target === 'search' 분기로 SearchVoice._onSTTResult 호출).
var SearchVoice = {
  active:            false,
  audioContext:      null,
  analyser:          null,
  vadRafId:          null,
  silenceStart:      null,
  SILENCE_THRESHOLD: 18,
  SILENCE_DURATION_MS: 2000,
  MIN_RECORD_MS:     1500,

  toggle: function(){
    if (Voice.state === 'converting') return;
    if (this.active) this.stop();
    else             this.start();
  },

  start: function(){
    var self = this;
    if (Voice.state !== 'idle' && Voice.target !== 'search') {
      toast('다른 음성 패널이 열려있습니다. 먼저 종료해주세요');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('이 브라우저는 음성 입력을 지원하지 않습니다');
      return;
    }
    navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
      Voice.stream = stream;
      Voice.target = 'search';
      self._startRecording();
      self._setupVAD(stream);
      self.active = true;
      self._updateButton('recording');
    }).catch(function(err){
      console.warn('[SearchVoice] getUserMedia', err);
      toast('⚠️ 마이크 권한이 필요합니다');
      Voice.target = null;
    });
  },

  _startRecording: function(){
    var candidates = ['audio/webm;codecs=opus','audio/webm','audio/mp4'];
    var mt = '';
    for (var i=0; i<candidates.length; i++){
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidates[i])){ mt=candidates[i]; break; }
    }
    Voice.mimeType = mt || '';
    Voice.chunks = [];
    Voice.blob = null;
    try {
      Voice.rec = mt ? new MediaRecorder(Voice.stream,{mimeType:mt}) : new MediaRecorder(Voice.stream);
    } catch(e){
      console.warn('[SearchVoice] rec init', e);
      toast('녹음 시작 실패');
      this._cleanup();
      return;
    }
    var self = this;
    Voice.rec.ondataavailable = function(e){ if (e.data && e.data.size>0) Voice.chunks.push(e.data); };
    Voice.rec.onstop = function(){
      var type = Voice.mimeType || (Voice.chunks[0] && Voice.chunks[0].type) || 'audio/webm';
      var blob = new Blob(Voice.chunks, {type:type});
      if (blob.size < 2000){
        toast('음성이 너무 짧습니다');
        self._cleanup();
        return;
      }
      Voice.blob = blob;
      Voice.durationMs = Date.now() - Voice.startTs;
      self._updateButton('converting');
      Voice.state = 'converting';
      _voiceSendSTT('close');
    };
    Voice.startTs = Date.now();
    Voice.rec.start();
    Voice.state = 'recording';
  },

  _setupVAD: function(stream){
    var self = this;
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      var source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      var dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      function check(){
        if (!self.active) return;
        self.analyser.getByteFrequencyData(dataArray);
        var sum = 0;
        for (var i=0; i<dataArray.length; i++) sum += dataArray[i];
        var avg = sum / dataArray.length;
        var elapsed = Date.now() - Voice.startTs;
        if (elapsed < self.MIN_RECORD_MS){
          // warm-up
        } else if (avg < self.SILENCE_THRESHOLD){
          if (!self.silenceStart) self.silenceStart = Date.now();
          else if (Date.now() - self.silenceStart > self.SILENCE_DURATION_MS){
            self.stop();
            return;
          }
        } else {
          self.silenceStart = null;
        }
        self.vadRafId = requestAnimationFrame(check);
      }
      this.vadRafId = requestAnimationFrame(check);
    } catch(e){
      console.warn('[SearchVoice] VAD setup failed (수동 종료만 가능)', e);
    }
  },

  stop: function(){
    if (!this.active) return;
    this.active = false;
    if (this.vadRafId){ cancelAnimationFrame(this.vadRafId); this.vadRafId = null; }
    this.silenceStart = null;
    if (this.audioContext){
      try { this.audioContext.close(); } catch(e){}
      this.audioContext = null;
    }
    if (Voice.rec && Voice.rec.state !== 'inactive'){
      try { Voice.rec.stop(); } catch(e){}
    }
  },

  _onSTTResult: function(text){
    var self = this;
    var ta = document.getElementById('chat-input');
    if (ta){
      ta.value = text;
      if (typeof autosizeTa === 'function') autosizeTa(ta);
    }
    setTimeout(function(){
      if (typeof Chat !== 'undefined' && Chat.sendFromInput){
        Chat.sendFromInput();
      }
      self._cleanup();
    }, 500);
  },

  _cleanup: function(){
    if (this.vadRafId){ cancelAnimationFrame(this.vadRafId); this.vadRafId = null; }
    this.silenceStart = null;
    if (this.audioContext){
      try { this.audioContext.close(); } catch(e){}
      this.audioContext = null;
    }
    if (Voice.rec){
      try { if (Voice.rec.state !== 'inactive') Voice.rec.stop(); } catch(e){}
      Voice.rec = null;
    }
    if (Voice.stream){
      try { Voice.stream.getTracks().forEach(function(t){ t.stop(); }); } catch(e){}
      Voice.stream = null;
    }
    Voice.blob = null;
    Voice.chunks = [];
    Voice.target = null;
    Voice.state = 'idle';
    this.active = false;
    this._updateButton('idle');
  },

  _updateButton: function(state){
    var btn = document.getElementById('chat-voice-mini-btn');
    if (!btn) return;
    btn.classList.remove('recording','converting');
    if (state === 'recording'){
      btn.classList.add('recording');
      btn.textContent = '⏹';
      btn.title = '녹음 중 — 클릭 시 종료 (또는 2초 침묵 시 자동 종료)';
    } else if (state === 'converting'){
      btn.classList.add('converting');
      btn.textContent = '⏳';
      btn.title = 'CLOVA 변환 중...';
    } else {
      btn.textContent = '🎤';
      btn.title = '음성 입력 (클릭하여 녹음 시작·종료 / 침묵 시 자동 종료)';
    }
  }
};

function renderStructuredReport(opts){
  // 2026-05-07: 챗 형식 UX 로 교체. 옛 카드 생성 코드는 아래 dead code 로 보존 (rollback 시 'return;' 1줄 제거).
  // 2026-05-21 v2: opts.resumed=true 면 이어쓰기 양식 (restoreDraft 호출 케이스).
  ReportChat.start(currentStructured, opts || {});
  return;

  // ↓↓↓ 옛 카드 UI 생성 (dead code, 실행 안 됨) ↓↓↓
  // (p2-name 제거됨 — sticky bar 의 user-bar 가 작성자 표시)

  document.getElementById('report-edit-actions').style.display='flex';

  var s=normalizeStructured(currentStructured);
  currentStructured=s;

  var html='<div class="report-wrap">';

  if(isTestMode()){
    html+='<div class="test-badge">🧪 테스트 모드 · 발송 시 실제 메일·Drive 저장·브리핑 반영이 모두 스킵됩니다</div>';
  }

  // (작성자 카드 제거됨 — sticky bar 의 user-bar 가 작성자·부서·날짜 표시. 2026-04-29)

  // 어제 원문 — 다건 표시. 항목 있을 때만 접기/펼치기 토글 제공 (기본: 펼침)
  var ydLabel='어제 원문'+(yesterdayDate?' ('+fmtDate(yesterdayDate)+')':'');
  var ydCount=(yesterdayLoaded&&!yesterdayLoadError)?yesterdayItems.length:0;
  if(ydCount>1)ydLabel+=' · '+ydCount+'건';
  var ydBody=buildYesterdayBodyHtml();
  var ydCanCollapse=ydCount>0;
  var ydCollapsedCls=(ydCanCollapse && !ydExpanded)?' collapsed':'';
  var ydHeadCls=ydCanCollapse?'rep-head clickable':'rep-head';
  var ydHeadAttr=ydCanCollapse?' onclick="toggleYdCard()"':'';
  var ydToggleHtml=ydCanCollapse?'<span class="rep-toggle">▼</span>':'';
  html+='<div class="rep-card'+ydCollapsedCls+'" id="rep-yd">'+
    '<div class="'+ydHeadCls+'"'+ydHeadAttr+'>'+
      '<span class="rep-label">'+escapeHtml(ydLabel)+'</span>'+ydToggleHtml+
    '</div>'+
    '<div class="rep-body"><div class="collapsible">'+ydBody+'</div></div>'+
  '</div>';

  // 오늘 원문 — 확정분(접힘 대상) + 작성 중(항상 표시). 기본: 접힘
  var tdParts=buildTodayBodyParts();
  var tdCanCollapse=tdParts.confirmedCount>0;
  var tdCollapsedCls=(tdCanCollapse && !tdExpanded)?' collapsed':'';
  var tdLabelSuffix=tdParts.confirmedCount>0?' ('+tdParts.confirmedCount+'건 발송 완료'+(currentRawText?' + 작성 중':'')+')'
                    :(currentRawText?' (작성 중)':'');
  var tdHeadCls=tdCanCollapse?'rep-head clickable':'rep-head';
  var tdHeadAttr=tdCanCollapse?' onclick="toggleTdCard()"':'';
  var tdToggleHtml=tdCanCollapse?'<span class="rep-toggle">▼</span>':'';
  var tdBodyInner='';
  if(tdParts.confirmed){
    tdBodyInner+='<div class="collapsible">'+tdParts.confirmed;
    if(tdParts.drafting)tdBodyInner+='<div class="raw-item-gap"></div>';
    tdBodyInner+='</div>';
  }
  tdBodyInner+=tdParts.drafting;
  if(!tdBodyInner)tdBodyInner='<div class="raw-box empty">📭 오늘의 보고가 없습니다</div>';
  html+='<div class="rep-card'+tdCollapsedCls+'" id="rep-td">'+
    '<div class="'+tdHeadCls+'"'+tdHeadAttr+'>'+
      '<span class="rep-label">오늘 원문'+tdLabelSuffix+'</span>'+tdToggleHtml+
    '</div>'+
    '<div class="rep-body">'+tdBodyInner+'</div>'+
  '</div>';

  // 프로젝트별 카드
  s.projects.forEach(function(p,idx){
    html+=renderProjectCard(p,idx);
  });

  // 공통 카드 (항상 표시)
  html+=renderCommonCard(s.common);

  // 프로젝트 추가 버튼
  html+='<button class="proj-add-btn" onclick="addProject()">+ 프로젝트 추가</button>';

  html+='</div>';
  document.getElementById('p2-body').innerHTML=html;
  // 초기 autosize — 복구/재렌더 시에도 proj-field 들이 내용에 맞춰 확장되도록
  document.querySelectorAll('#p2-body textarea').forEach(autosizeTa);
}

function renderProjectCard(p,idx){
  // content 우선 — 없으면 4필드 join 으로 fallback (옛 백엔드 호환)
  var displayContent = p.content || buildContentFallback(p);
  var contentHtml = displayContent
    ? '<div class="proj-content">'+escapeHtml(displayContent)+'</div>'
    : '<div class="proj-content"><span class="proj-empty">(작성된 내용 없음 — 아래 + 버튼으로 추가)</span></div>';
  return '<div class="rep-card proj-card" data-proj-idx="'+idx+'">'+
    '<div class="rep-head proj-head">'+
      '<input class="proj-name" data-proj-idx="'+idx+'" value="'+escapeHtml(p.name||'')+'" placeholder="프로젝트명">'+
      '<button class="proj-del" onclick="removeProject('+idx+')" title="이 프로젝트 제거">×</button>'+
    '</div>'+
    '<div class="rep-body">'+
      contentHtml+
      '<div class="proj-add-row">'+
        '<button class="proj-add-btn-inline" onclick="toggleProjAdd('+idx+')">+ 내용 추가/수정</button>'+
        '<div class="proj-draft-wrap" id="proj-draft-wrap-'+idx+'" style="display:none">'+
          '<textarea class="proj-draft" data-proj-idx="'+idx+'" rows="3" placeholder="자유롭게 입력해주세요" oninput="autosizeTa(this)"></textarea>'+
          '<div class="proj-draft-actions">'+
            '<button class="proj-reanalyze-btn" onclick="doReanalyze()">🔄 수정사항 재정리</button>'+
            '<button class="proj-cancel-btn" onclick="cancelProjAdd('+idx+')">취소</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>'+
  '</div>';
}

function renderCommonCard(c){
  var displayContent = c.content || buildContentFallback(c);
  var contentHtml = displayContent
    ? '<div class="proj-content">'+escapeHtml(displayContent)+'</div>'
    : '<div class="proj-content"><span class="proj-empty">(공통 사항 없음)</span></div>';
  return '<div class="rep-card common-card">'+
    '<div class="rep-head"><span class="rep-label">공통 (프로젝트 무관·근태 등)</span></div>'+
    '<div class="rep-body">'+
      contentHtml+
      '<div class="proj-add-row">'+
        '<button class="proj-add-btn-inline" onclick="toggleCommonAdd()">+ 내용 추가/수정</button>'+
        '<div class="proj-draft-wrap" id="common-draft-wrap" style="display:none">'+
          '<textarea class="proj-draft common-draft" id="common-draft" rows="3" placeholder="자유롭게 입력해주세요" oninput="autosizeTa(this)"></textarea>'+
          '<div class="proj-draft-actions">'+
            '<button class="proj-reanalyze-btn" onclick="doReanalyze()">🔄 수정사항 재정리</button>'+
            '<button class="proj-cancel-btn" onclick="cancelCommonAdd()">취소</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>'+
  '</div>';
}

function normalizeStructured(s){
  s=s||{};
  var projects=Array.isArray(s.projects)?s.projects:[];
  var common=(s.common&&typeof s.common==='object')?s.common:{};
  return {
    projects:projects.map(function(p){
      p=p||{};
      return {
        name:    typeof p.name    ==='string'?p.name:'',
        content: typeof p.content ==='string'?p.content:'',
        meeting: typeof p.meeting ==='string'?p.meeting:'',
        issue:   typeof p.issue   ==='string'?p.issue:'',
        dir:     typeof p.dir     ==='string'?p.dir:'',
        schedule:typeof p.schedule==='string'?p.schedule:''
      };
    }),
    common:{
      content: typeof common.content ==='string'?common.content:'',
      meeting: typeof common.meeting ==='string'?common.meeting:'',
      issue:   typeof common.issue   ==='string'?common.issue:'',
      dir:     typeof common.dir     ==='string'?common.dir:'',
      schedule:typeof common.schedule==='string'?common.schedule:''
    }
  };
}

// content 필드 비었을 때 4필드 자연어 join (fallback) — 옛 백엔드 호환
function buildContentFallback(p){
  var parts=[];
  if(p.meeting)  parts.push('· 미팅: '+p.meeting);
  if(p.issue)    parts.push('· 이슈: '+p.issue);
  if(p.dir)      parts.push('· 지시: '+p.dir);
  if(p.schedule) parts.push('· 일정: '+p.schedule);
  return parts.join('\n');
}

// DOM 의 변경 가능 필드 (.proj-name) 만 읽고, 나머지 (content/meeting/issue/dir/schedule)
// 는 메모리의 currentStructured 에서 보존. 자연어 박스는 read-only — Claude 결과만.
function collectStructure(){
  var prevS = normalizeStructured(currentStructured);
  var prevP = prevS.projects;
  var projects=[];
  document.querySelectorAll('.proj-card').forEach(function(card){
    var idx = parseInt(card.getAttribute('data-proj-idx'));
    var nameEl = card.querySelector('.proj-name');
    var prev = prevP[idx] || {name:'',content:'',meeting:'',issue:'',dir:'',schedule:''};
    projects.push({
      name:    nameEl ? nameEl.value.trim() : (prev.name||''),
      content: prev.content||'',
      meeting: prev.meeting||'',
      issue:   prev.issue||'',
      dir:     prev.dir||'',
      schedule:prev.schedule||''
    });
  });
  return {projects:projects, common:prevS.common};
}

function flattenToFiveFields(s){
  s=normalizeStructured(s);
  var validProjects=s.projects.filter(function(p){return p.name;});
  var multi=validProjects.length>1;
  function agg(field){
    var parts=validProjects
      .map(function(p){
        if(!p[field])return '';
        return multi?'['+p.name+'] '+p[field]:p[field];
      })
      .filter(Boolean);
    if(s.common[field])parts.push(s.common[field]);
    return parts.join(' / ');
  }
  return {
    pj:       validProjects.map(function(p){return p.name;}).join(', '),
    content:  agg('content'),   // 2026-06-04 — content 누락 버그 fix. 4분류(meeting/issue/dir/schedule) 밖 업무가 content 에만 담겨 송신 시 증발하던 것 차단.
    meeting:  agg('meeting'),
    issue:    agg('issue'),
    dir:      agg('dir'),
    schedule: agg('schedule')
  };
}

function escapeHtml(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(yyyymmdd){
  if(!yyyymmdd||yyyymmdd.length!==8)return yyyymmdd||'';
  return yyyymmdd.substr(0,4)+'-'+yyyymmdd.substr(4,2)+'-'+yyyymmdd.substr(6,2);
}

function addProject(){
  currentStructured=collectStructure();
  currentStructured.projects.push({name:'',content:'',meeting:'',issue:'',dir:'',schedule:''});
  renderStructuredReport();
  saveDraft('p2');
  // 새 카드의 textarea 자동 펼침 + 이름 input focus
  setTimeout(function(){
    var newIdx = currentStructured.projects.length - 1;
    toggleProjAdd(newIdx);
    var nameEl = document.querySelector('.proj-card[data-proj-idx="'+newIdx+'"] .proj-name');
    if(nameEl){nameEl.focus();nameEl.scrollIntoView({behavior:'smooth',block:'center'});}
  },100);
}

// + 내용 추가/수정 토글 — 프로젝트 카드의 textarea 펼치기
function toggleProjAdd(idx){
  var wrap = document.getElementById('proj-draft-wrap-'+idx);
  if(!wrap) return;
  var isOpen = wrap.style.display !== 'none';
  if(isOpen){
    wrap.style.display = 'none';
  } else {
    wrap.style.display = '';
    var ta = wrap.querySelector('.proj-draft');
    if(ta){ ta.focus(); autosizeTa(ta); }
  }
}
function cancelProjAdd(idx){
  var wrap = document.getElementById('proj-draft-wrap-'+idx);
  if(!wrap) return;
  var ta = wrap.querySelector('.proj-draft');
  if(ta) ta.value = '';
  wrap.style.display = 'none';
}

// 공통 카드의 + 내용 추가
function toggleCommonAdd(){
  var wrap = document.getElementById('common-draft-wrap');
  if(!wrap) return;
  var isOpen = wrap.style.display !== 'none';
  if(isOpen){
    wrap.style.display = 'none';
  } else {
    wrap.style.display = '';
    var ta = document.getElementById('common-draft');
    if(ta){ ta.focus(); autosizeTa(ta); }
  }
}
function cancelCommonAdd(){
  var wrap = document.getElementById('common-draft-wrap');
  if(!wrap) return;
  var ta = document.getElementById('common-draft');
  if(ta) ta.value = '';
  wrap.style.display = 'none';
}

function removeProject(idx){
  currentStructured=collectStructure();
  currentStructured.projects.splice(idx,1);
  renderStructuredReport();
  saveDraft('p2');
}

function doReanalyze(onSuccess){
  var s = collectStructure();
  var combined = '';

  // 각 프로젝트: 이름 + 기존 content (또는 4필드 fallback) + 사용자가 + 버튼으로 추가한 draft
  s.projects.forEach(function(p, idx){
    var draftEl = document.querySelector('.proj-card[data-proj-idx="'+idx+'"] .proj-draft');
    var draft = draftEl ? draftEl.value.trim() : '';
    var existing = p.content || buildContentFallback(p);
    if (!p.name && !existing && !draft) return;
    combined += '['+(p.name||'(이름없음)')+']\n';
    if (existing) combined += existing + '\n';
    if (draft)    combined += draft + '\n';
    combined += '\n';
  });

  // 공통: 기존 content + draft
  var c = s.common;
  var commonDraftEl = document.getElementById('common-draft');
  var commonDraft = commonDraftEl ? commonDraftEl.value.trim() : '';
  var commonExisting = c.content || buildContentFallback(c);
  if (commonExisting || commonDraft){
    combined += '[공통]\n';
    if (commonExisting) combined += commonExisting + '\n';
    if (commonDraft)    combined += commonDraft + '\n';
  }

  if(!combined.trim()){toast('수정된 내용이 없습니다');return;}

  document.getElementById('p2-body').innerHTML=
    '<div class="loading-wrap">'+
      '<div class="loading-brush">🔄</div>'+
      '<div class="loading-text">AI가 다시 정리하고 있습니다</div>'+
      '<div class="loading-sub">수정한 내용을 반영하는 중...</div>'+
    '</div>';
  document.getElementById('report-edit-actions').style.display='none';

  fetch(APPS_SCRIPT_URL,{
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({
      token:APPS_SCRIPT_TOKEN,
      action:'structure_report',
      email:(profile&&profile.email)||'',   // 개인 확정 사전 조회용 (2026-08-20)
      raw:combined
    })
  })
  .then(function(r){return r.json()})
  .then(function(data){
    if(!data.ok)throw new Error(data.message||'재정리 실패');
    currentStructured=data.structured;
    lastAIStructured=JSON.stringify(normalizeStructured(data.structured));
    renderStructuredReport();
    saveDraft('p2');
    if(onSuccess){onSuccess();return;}
    toast('🔄 재정리 완료');
  })
  .catch(function(err){
    toast('❌ 오류: '+err);
    renderStructuredReport();
  });
}

function repCard(id,label,bodyHtml){
  return '<div class="rep-card" id="card-'+id+'">'+
    '<div class="rep-head">'+
      '<span class="rep-label">'+label+'</span>'+
      '<button class="rep-edit" onclick="editCard(\''+id+'\')">수정</button>'+
    '</div>'+
    '<div class="rep-body" id="body-'+id+'">'+bodyHtml+'</div>'+
  '</div>';
}

function submitAns(){
  var ans=document.getElementById('ai-ans');
  if(!ans||!ans.value.trim()){toast('내용을 입력해주세요');return}
  document.querySelector('.ai-card').style.opacity='.5';
  document.querySelector('.ai-card').style.pointerEvents='none';
  toast('✅ 반영됐습니다');
}

var editMode=false;
function toggleEdit(){
  editMode=!editMode;
  var btn=document.getElementById('edit-btn');
  btn.textContent=editMode?'완료':'수정';
  btn.className=editMode?'edit-btn active':'edit-btn';
  document.querySelectorAll('.rep-edit').forEach(function(b){
    b.style.display=editMode?'block':'none';
  });
  if(!editMode)toast('저장됐습니다');
}

function editCard(id){
  var body=document.getElementById('body-'+id);
  var ta=body.querySelector('textarea');
  if(ta){
    var t=body.querySelector('.rep-text');
    if(t)t.textContent=ta.value;
    else{
      var tasks=body.querySelectorAll('.rep-task');
      tasks.forEach(function(el){el.remove()});
      ta.value.split('\n').filter(function(l){return l.trim()}).forEach(function(l){
        var d=document.createElement('div');d.className='rep-task';d.textContent=l;
        body.insertBefore(d,ta);
      });
    }
    ta.style.display='none';
    body.querySelector('.rep-save').style.display='none';
    toast('✅ 수정됐습니다');
    return;
  }
  var existing=body.innerHTML;
  var text='';
  body.querySelectorAll('.rep-text,.rep-task').forEach(function(el){text+=el.innerText+'\n'});
  var newTa=document.createElement('textarea');
  newTa.className='rep-textarea';newTa.rows=4;newTa.value=text.trim();
  newTa.style.display='block';
  var btn=document.createElement('button');
  btn.className='rep-save';btn.style.display='block';
  btn.textContent='저장';btn.onclick=function(){editCard(id)};
  body.appendChild(newTa);body.appendChild(btn);
  autosizeTa(newTa);
  newTa.focus();
}

