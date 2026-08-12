// ── 저장 / 발송 ──────────────────────
function doSave(){
  var blob=new Blob([document.documentElement.outerHTML],{type:'text/html;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=dateStr.replace(/-/g,'')+'_일일보고_'+profile.name+'.html';
  a.click();toast('💾 저장됐습니다');
}

function doFinalSend(){
  // 챗 형식 UX: currentStructured 는 챗 turn 마다 갱신됨. collectStructure (옛 카드 DOM read)·dirty 체크 의미 없음.
  if (!currentStructured) { toast('정리된 보고서가 없습니다'); return; }
  performSend();
}

function openSendDlg(){
  document.getElementById('send-dlg').classList.add('on');
}
function closeSendDlg(){
  document.getElementById('send-dlg').classList.remove('on');
}
function confirmSendDirect(){
  closeSendDlg();
  performSend();
}
function confirmReanalyzeThenSend(){
  closeSendDlg();
  doReanalyze(function(){ performSend(); });
}

// report-done-screen 토글 — 발송 중/완료/test 시 챗 UI 숨기고 결과 화면만 노출.
// 오류 시에는 사용자가 챗에서 재시도할 수 있도록 hideReportDoneScreen 으로 원복.
function showReportDoneScreen(html){
  var body = document.getElementById('report-done-body');
  var screen = document.getElementById('report-done-screen');
  var chat = document.getElementById('report-chat');
  if (body) body.innerHTML = html;
  if (screen) screen.style.display = '';
  if (chat) chat.style.display = 'none';
}
function hideReportDoneScreen(){
  var screen = document.getElementById('report-done-screen');
  var body = document.getElementById('report-done-body');
  var chat = document.getElementById('report-chat');
  if (screen) screen.style.display = 'none';
  if (body) body.innerHTML = '';
  if (chat) chat.style.display = '';
}

function performSend(){
  // 챗 UX: collectStructure (옛 카드 DOM read) 호출 제거. currentStructured 그대로 사용.
  var structured=flattenToFiveFields(currentStructured);
  var dc=dateStr.replace(/-/g,'');

  if(isTestMode()){
    showTestComplete(structured);
    return;
  }

  // 2026-05-22 PM 신설 — 본인 Gmail 로 발송 (OAuth 동의 시). 실패 시 옛 흐름 (GAS GmailApp = thehim180724 발신) fallback.
  if (!_initGmailTokenClient()) {
    _performSendViaGAS(structured, dc, false);
    return;
  }
  requestUserGmailAccess(function(token){
    if (!token) {
      if (!confirm('본인 Gmail 권한 없음 (또는 OAuth 거부됨).\n운영 hub(thehim180724) 발신으로 진행할까요?\n\n참고: 예 = 옛 방식 (본인 Sent 미기록). 아니오 = 발송 취소.')) {
        toast('발송 취소됨');
        return;
      }
      _performSendViaGAS(structured, dc, false);
      return;
    }
    // 본인 Gmail 로 발송 시도
    showReportDoneScreen(
      '<div class="done-wrap">'+
        '<div class="done-brush">📤</div>'+
        '<div class="done-title">본인 Gmail 로 발송 중...</div>'+
      '</div>'
    );
    document.getElementById('report-edit-actions').style.display='none';
    // ★ 본문에 identity 필드 동봉 (name/role/dept/grade/date) — GmailToQueue 가 큐 식별자 컬럼 채우는 근거.
    // 누락 시 큐 row 의 name/role/dept 가 공란 → brfing 생성 시 Claude 가 "미상 보고자"로 처리.
    // 옛 GAS path 는 서버 sendDailyReport 가 structured.name 등을 박은 후 Gmail 발송했음. OAuth path 는 클라가 직접 발송이라 여기서 박아야 함.
    var oauthBody = JSON.stringify(Object.assign({}, structured, {
      name:  profile.name,
      role:  profile.role,
      dept:  profile.dept,
      grade: profile.grade,
      date:  dateStr
    }), null, 2);
    sendViaUserGmail(token,
      'thehim180724@gmail.com', 'taesilkim2@gmail.com',
      '[일일보고] '+profile.name+'_'+dc,
      oauthBody,
      function(success, err){
        if (success) {
          // 시트·Drive 누적만 (GAS GmailApp 스킵)
          _performSendViaGAS(structured, dc, true);
        } else {
          hideReportDoneScreen();
          document.getElementById('report-edit-actions').style.display='flex';
          if (!confirm('본인 Gmail 발송 실패: '+err+'\n\n운영 hub(thehim180724) 발신으로 fallback 할까요?')) {
            toast('❌ 발송 실패: '+err);
            return;
          }
          _performSendViaGAS(structured, dc, false);
        }
      }
    );
  });
}

// 옛 흐름 (GAS GmailApp 발송 + 시트·Drive 누적). 본인 Gmail 발송 성공 시 useUserSend=true 로 GmailApp 만 스킵.
function _performSendViaGAS(structured, dc, useUserSend){
  if (!useUserSend) {   // 옛 흐름이면 "발송 중..." 화면 노출 (본인 Gmail 흐름은 이미 위에서 노출됨)
    showReportDoneScreen(
      '<div class="done-wrap">'+
        '<div class="done-brush">📤</div>'+
        '<div class="done-title">발송 중...</div>'+
      '</div>'
    );
    document.getElementById('report-edit-actions').style.display='none';
  }

  fetch(APPS_SCRIPT_URL,{
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({
      token:APPS_SCRIPT_TOKEN,
      action:'send_daily_report',
      name:profile.name,
      role:profile.role,
      dept:profile.dept,
      grade:profile.grade,
      date:dateStr,
      to:'thehim180724@gmail.com',
      cc:'taesilkim2@gmail.com',
      subject:'[일일보고] '+profile.name+'_'+dc,
      raw:currentRawText,
      structured:structured,
      use_user_send: !!useUserSend   // true 면 GAS GmailApp 스킵 (이미 클라가 본인 Gmail 로 발송)
    })
  })
  .then(function(r){return r.json()})
  .then(function(data){
    if(!data.ok)throw new Error(data.message||'발송 실패');
    clearDraft();
    // 발송 시각이 일일 브리핑 윈도우(08:50~16:00) 안이면 누락 경고.
    // - 오늘 brfing 은 08:50 트리거 1회만 실행되고 alreadyDone 시트로 재실행 차단
    // - 다음날 brfing 의 cutoff = 어제 16:00 이라 08:50~16:00 발송분은 today 윈도우에도 안 잡힘
    // → 자동 brfing 본문에 영영 안 들어가고 history(28일 이력 참고용)로만 처리됨
    var sentNow = new Date();
    var sh = sentNow.getHours(), sm = sentNow.getMinutes();
    var afterBrf  = (sh > 8) || (sh === 8 && sm >= 50);
    var beforeCut = (sh < 16);
    var isLate = afterBrf && beforeCut;
    var hhmm = (sh<10?'0':'')+sh+':'+(sm<10?'0':'')+sm;
    var warnHtml = '';
    if (isLate) {
      warnHtml =
        '<div class="done-warn">'+
          '<div class="done-warn-title">⚠️ 오늘 브리핑에는 반영되지 않았습니다</div>'+
          '<div class="done-warn-desc">'+
            '현재 발송 시각 <b>'+hhmm+'</b> 은 일일 브리핑 자동 생성 시각(<b>오전 8:50</b>) 이후입니다.<br>'+
            '오늘자 브리핑은 이미 생성·발송되어 본 보고는 <b>오늘 브리핑 본문에 포함되지 않습니다</b>.'+
          '</div>'+
        '</div>';
    }
    var senderNote = useUserSend
      ? '<div class="done-desc">'+escapeHtml(profile.name)+' '+escapeHtml(profile.role)+'님의 보고서가<br>본인 Gmail → thehim180724@gmail.com 으로 전송됐습니다.<br><small>(본인 Sent 폴더에 기록 ✓)</small></div>'
      : '<div class="done-desc">'+escapeHtml(profile.name)+' '+escapeHtml(profile.role)+'님의 보고서가<br>thehim180724@gmail.com으로 전송됐습니다.</div>';
    showReportDoneScreen(
      '<div class="done-wrap">'+
        '<div class="done-brush">✅</div>'+
        '<div class="done-title">발송 완료</div>'+
        senderNote+
        warnHtml+
        '<button class="done-new" onclick="newRep()">새 보고서 작성</button>'+
        '<button class="done-new go-himclova" onclick="goToHimClovaFromReport()">🎙️ 힘클로바로 가기</button>'+
      '</div>'
    );
  })
  .catch(function(err){
    // 오류 시: 챗 UI 복원해 사용자가 재시도 가능하도록. toast 로 원인 알림.
    hideReportDoneScreen();
    document.getElementById('report-edit-actions').style.display='flex';
    toast('❌ 발송 실패: '+err);
  });
}

function showTestComplete(structured){
  document.getElementById('report-edit-actions').style.display='none';
  function row(label,val){
    return '<div class="test-row"><div class="test-row-label">'+label+'</div>'+
           '<div class="test-row-val">'+escapeHtml(val||'(비어있음)')+'</div></div>';
  }
  showReportDoneScreen(
    '<div class="done-wrap">'+
      '<div class="done-brush">🧪</div>'+
      '<div class="done-title">테스트 모드 · 발송 스킵됨</div>'+
      '<div class="done-desc">서버로 전송하지 않았습니다.<br>실제 메일·Drive 저장·브리핑 큐 추가 모두 건너뛰었습니다.</div>'+
      '<div class="test-preview">'+
        row('PJ',       structured.pj)+
        row('미팅',     structured.meeting)+
        row('이슈',     structured.issue)+
        row('지시',     structured.dir)+
        row('일정',     structured.schedule)+
      '</div>'+
      '<button class="done-new" onclick="newRep()">새 보고서 작성</button>'+
      '<button class="done-new go-himclova" onclick="goToHimClovaFromReport()">🎙️ 힘클로바로 가기</button>'+
    '</div>'
  );
}

function newRep(){
  document.getElementById('main-input').value='';
  if(typeof dirxClear==='function')dirxClear();
  files=[];document.getElementById('file-chips').innerHTML='';
  currentStructured=null;
  lastAIStructured=null;
  currentRawText='';
  ydExpanded=true;
  tdExpanded=false;
  ctxYdExpanded=true;
  ctxTdExpanded=false;
  clearDraft();
  hideDraftBanner();
  hideReportDoneScreen();
  goPage('p1');
}

// 발송 완료 화면에서 힘클로바 모드로 직행 — 보고 상태 리셋 후 모드 전환
function goToHimClovaFromReport(){
  newRep();
  switchMode('himclova');
}

// ── 유틸 ──────────────────────
// goPage: 페이지 전환. 'p2' 는 호환성 wrapper — 일일보고 모드의 edit sub-page 로 라우팅.
//   ('#p2' 페이지 자체는 mode-report sub-page 로 마이그레이션됨, 2026-04-29)
function goPage(id){
  if (id === 'p2'){
    // 일일보고 편집 페이지 — #p1 활성 + mode-report + edit sub-page
    document.querySelectorAll('.page').forEach(function(p){p.classList.remove('on')});
    document.getElementById('p1').classList.add('on');
    if (typeof switchMode === 'function') switchMode('report');
    Report.showPage('edit');
    window.scrollTo(0,0);
    return;
  }
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('on')});
  document.getElementById(id).classList.add('on');
  // p1 으로 가는 경우 일일보고 sub-page 도 input 으로 복귀
  if (id === 'p1' && typeof Report !== 'undefined') Report.showPage('input');
  window.scrollTo(0,0);
}

// ── Report 네임스페이스 — 일일보고 sub-page 전환 ──
// EDIT sub-page 는 fixed viewport 라 (.report-page-edit position:fixed)
// top / bottom 을 헤더·발송버튼 실측해 동적 설정. mode-search 의 Chat.adjustTop 과 동일 패턴.
var Report = (function(){
  var layoutBound = false;
  function adjustEditLayout(){
    var edit = document.getElementById('report-page-edit');
    if (!edit || edit.style.display === 'none') return;
    var run = function(){
      var hd = document.querySelector('.p1-header');
      var bf = document.querySelector('.bottom-fixed.bottom-report');
      if (hd){
        var top = hd.getBoundingClientRect().bottom;
        edit.style.top = Math.max(0, Math.round(top)) + 'px';
      }
      if (bf){
        // bottom-fixed 높이 + 8px 간격 (사용자 요구 "간격을 두고")
        var bh = bf.getBoundingClientRect().height;
        edit.style.bottom = Math.max(0, Math.round(bh + 8)) + 'px';
      }
    };
    run();
    requestAnimationFrame(function(){ requestAnimationFrame(run); });
    setTimeout(run, 100);
  }
  function bindLayoutListeners(){
    if (layoutBound) return;
    layoutBound = true;
    window.addEventListener('resize',          adjustEditLayout);
    window.addEventListener('orientationchange', adjustEditLayout);
  }
  function showPage(name){
    var input = document.getElementById('report-page-input');
    var edit  = document.getElementById('report-page-edit');
    var sendBtn = document.getElementById('report-send-btn');
    var editActs = document.getElementById('report-edit-actions');
    if (!input || !edit) return;
    if (name === 'edit'){
      input.style.display = 'none';
      edit.style.display  = '';
      if (sendBtn)  sendBtn.style.display  = 'none';
      if (editActs) editActs.style.display = '';
      document.body.classList.add('report-edit-active');
      bindLayoutListeners();
      adjustEditLayout();
    } else {
      input.style.display = '';
      edit.style.display  = 'none';
      if (sendBtn)  sendBtn.style.display  = '';
      if (editActs) editActs.style.display = 'none';
      document.body.classList.remove('report-edit-active');
    }
  }
  return { showPage: showPage, adjustEditLayout: adjustEditLayout };
})();

function toast(m){
  var t=document.getElementById('toast');
  t.textContent=m;t.classList.add('on');
  setTimeout(function(){t.classList.remove('on')},2500);
}

// ═══════════════════════════════════════════════════════════
// 챗봇 (mode-search) — 자연어 대화. tool-use 는 서버측 ChatAPI.js 가 담당.
// 인증·세션은 공유. convId 는 클라 발급, localStorage 보관.
// "+ 새 대화" → convId 갈아끼움. 기존 대화는 서버 시트에 7일 만료까지 잔존.
// ═══════════════════════════════════════════════════════════
var CHAT_CONV_KEY = 'himclaude_v2_chat_conv_id';

var Chat = (function(){
  var loaded       = false;
  var sending      = false;
  var convId       = '';
  var abortCtrl    = null;
  var noticeTimer  = null;   // 길어질 때 안내 문구 표시
  var timeoutTimer = null;   // 하드 타임아웃 — 자동 abort
  var CHAT_NOTICE_MS  = 20000;   // 20초 후 안내 문구
  var CHAT_TIMEOUT_MS = 75000;   // 75초 후 자동 중단

  function genConvId(){
    return 'cv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }
  function getOrCreateConvId(){
    var id = '';
    try { id = localStorage.getItem(CHAT_CONV_KEY) || ''; } catch(e){}
    if (!id) {
      id = genConvId();
      try { localStorage.setItem(CHAT_CONV_KEY, id); } catch(e){}
    }
    convId = id;
    return id;
  }

  function init(){
    if (!loaded) {
      loaded = true;
      getOrCreateConvId();
      load();
      // resize 대응 — idempotent (한 번만 바인딩)
      window.addEventListener('resize',          adjustTop);
      window.addEventListener('orientationchange', adjustTop);
    }
    // 모드 진입할 때마다 한 번 측정 (sticky 헤더 높이 변경 대응)
    adjustTop();
  }

  // .p1-header 의 bottom 좌표를 측정해 mode-search 의 top 으로 설정.
  // 빨간 배너 유무·헤더 콘텐츠 변화·뷰포트 리사이즈 모두 자동 대응.
  // 새로고침 직후엔 sticky 위치가 첫 frame 에서 안정화 안 돼 측정 부정확 → rAF 2회 + 100ms 폴백 으로 다중 측정.
  function adjustTop(){
    var run = function(){
      var hd = document.querySelector('.p1-header');
      var sm = document.querySelector('.mode-content.mode-search');
      if (!hd || !sm) return;
      var bottom = hd.getBoundingClientRect().bottom;
      sm.style.top = Math.max(0, Math.round(bottom)) + 'px';
    };
    // 즉시 1회
    run();
    // 다음 paint 직전 + 그 다음 frame (sticky layout 안정화 후)
    requestAnimationFrame(function(){
      requestAnimationFrame(run);
    });
    // 폰트·이미지 로드 등 layout 변동 대비
    setTimeout(run, 100);
  }

  function load(){
    var sess = getSession();
    if (!sess) { forceReauth('로그인이 필요합니다'); return; }

    showInfo('대화 불러오는 중...');
    var url = APPS_SCRIPT_URL
      + '?action=chat_load'
      + '&session=' + encodeURIComponent(sess)
      + '&convId='  + encodeURIComponent(convId);
    fetch(url)
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (d && d.error === 'session_invalid') { forceReauth(d.message || '재인증이 필요합니다'); return; }
        if (!d || !d.ok) { showInfo('⚠️ ' + ((d && d.error) || '대화 불러오기 실패'), true); return; }
        if (!d.turns || d.turns.length === 0) { showWelcome(); return; }
        renderTurns(d.turns);
      })
      .catch(function(e){
        showInfo('⚠️ 네트워크 오류 — ' + e.message, true);
      });
  }

  function renderTurns(turns){
    var el = document.getElementById('chat-messages');
    if (!el) return;
    el.innerHTML = '';
    turns.forEach(function(t){ appendMsg(t.role, t.content, false); });
    scrollBottom();
  }

  function appendMsg(role, content, scroll){
    var el = document.getElementById('chat-messages');
    if (!el) return null;
    var msg = document.createElement('div');
    msg.className = 'chat-msg ' + (role === 'user' ? 'user' : 'assistant');
    msg.innerHTML = renderMessageHtml(content);
    el.appendChild(msg);
    if (scroll !== false) scrollBottom();
    return msg;
  }

  // 가벼운 마크다운 — search-answer 패턴 차용 (**bold**, ---, > 인용)
  function renderMessageHtml(text){
    var s = escapeHtml(String(text || ''));
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/^---+$/gm, '<hr>');
    s = s.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  function showInfo(msg, isError){
    var el = document.getElementById('chat-messages');
    if (!el) return;
    el.innerHTML = '<div class="chat-empty' + (isError ? ' error' : '') + '">'
      + escapeHtml(msg).replace(/\n/g, '<br>') + '</div>';
  }
  function showWelcome(){
    showInfo('힘클로드에게 자유롭게 물어보세요.\n\n예) "4월 셋째 주에 회의가 있었던 날", "지난주 내 일정", "더케이호텔 최근 진행상황"');
  }

  function clearEmptyPlaceholder(){
    var el = document.querySelector('#chat-messages .chat-empty');
    if (el) el.remove();
  }

  function scrollBottom(){
    var el = document.getElementById('chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  // 답변 풍선이 추가됐을 때, 직전 사용자 풍선 위에 16px 여유를 두고 스크롤.
  // getBoundingClientRect 기반 — offsetTop 은 offsetParent 의존이라 turn 누적 시 부정확.
  // viewport 좌표 + container.scrollTop 으로 정확한 상대 위치 계산.
  function scrollAnswerToTop(msgEl){
    var container = document.getElementById('chat-messages');
    if (!msgEl || !container) return;
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        var target = msgEl.previousElementSibling || msgEl;
        var tRect = target.getBoundingClientRect();
        var cRect = container.getBoundingClientRect();
        var relTop = tRect.top - cRect.top + container.scrollTop;
        var top = Math.max(0, relTop - 10);   // 풍선 간 gap(10px) 과 통일
        try {
          container.scrollTo({top: top, behavior: 'smooth'});
        } catch(e) {
          container.scrollTop = top;
        }
      });
    });
  }

  function sendFromInput(){
    // 검색 중에 같은 버튼 누르면 → 멈춤
    if (sending) { cancelSend(); return; }
    var ta = document.getElementById('chat-input');
    if (!ta) return;
    var msg = (ta.value || '').trim();
    if (!msg) return;
    ta.value = '';
    autosizeTa(ta);
    send(msg);
  }

  // 보내기 ↔ 멈추기 버튼 모드 토글
  function setSendBtnMode(mode){
    var btn = document.getElementById('chat-send-btn');
    if (!btn) return;
    if (mode === 'cancel') {
      btn.textContent = '멈추기';
      btn.classList.add('cancel');
      btn.disabled = false;
    } else {
      btn.textContent = '보내기';
      btn.classList.remove('cancel');
      btn.disabled = false;
    }
  }

  function cancelSend(){
    if (!sending || !abortCtrl) return;
    try { abortCtrl.abort(); } catch(e) {}
  }

  function clearTimers(){
    if (noticeTimer)  { clearTimeout(noticeTimer);  noticeTimer  = null; }
    if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
  }

  function send(message){
    if (sending) return;
    sending = true;
    var sess = getSession();
    if (!sess) { forceReauth('로그인이 필요합니다'); sending = false; return; }

    clearEmptyPlaceholder();
    appendMsg('user', message, true);

    var loadingEl = document.createElement('div');
    loadingEl.className = 'chat-msg loading';
    loadingEl.textContent = '🤔 힘클로드가 검토 중...';
    document.getElementById('chat-messages').appendChild(loadingEl);
    scrollBottom();

    setSendBtnMode('cancel');

    abortCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var fetchOpts = abortCtrl ? {signal: abortCtrl.signal} : {};

    // 길어질 때 안내 문구 (loadingEl 텍스트 교체)
    noticeTimer = setTimeout(function(){
      if (loadingEl && loadingEl.parentNode) {
        loadingEl.textContent = '⏳ 검색량이 많아 시간이 걸려요... 더 기다리시거나 멈추고 범위를 좁혀주세요';
      }
    }, CHAT_NOTICE_MS);

    // 하드 타임아웃 — 자동 abort
    timeoutTimer = setTimeout(function(){
      if (sending && abortCtrl) {
        try { abortCtrl.abort(); } catch(e) {}
      }
    }, CHAT_TIMEOUT_MS);

    var url = APPS_SCRIPT_URL
      + '?action=chat_send'
      + '&session=' + encodeURIComponent(sess)
      + '&convId='  + encodeURIComponent(convId)
      + '&message=' + encodeURIComponent(message);

    fetch(url, fetchOpts)
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (loadingEl.parentNode) loadingEl.remove();
        if (d && d.error === 'session_invalid') { forceReauth(d.message || '재인증이 필요합니다'); return; }
        var msgEl;
        if (!d || !d.ok) {
          msgEl = appendMsg('assistant', '⚠️ ' + ((d && d.error) || '응답 오류'), false);
        } else {
          msgEl = appendMsg('assistant', d.reply || '(빈 응답)', false);
        }
        scrollAnswerToTop(msgEl);
      })
      .catch(function(e){
        if (loadingEl.parentNode) loadingEl.remove();
        var msgEl;
        if (e && e.name === 'AbortError') {
          // 사용자가 멈췄거나 하드 타임아웃
          msgEl = appendMsg('assistant', '🛑 검색을 중단했어요. 범위를 좁혀서 다시 물어봐 주세요.', false);
        } else {
          msgEl = appendMsg('assistant', '⚠️ 네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.', false);
        }
        scrollAnswerToTop(msgEl);
      })
      .then(function(){
        clearTimers();
        sending   = false;
        abortCtrl = null;
        setSendBtnMode('send');
      });
  }

  function newConv(){
    if (sending) { toast('답변을 받은 뒤에 새로 시작해 주세요'); return; }
    var newId = genConvId();
    try { localStorage.setItem(CHAT_CONV_KEY, newId); } catch(e){}
    convId = newId;
    showWelcome();
    var ta = document.getElementById('chat-input');
    if (ta) { ta.value = ''; autosizeTa(ta); ta.focus(); }
  }

  function onKeyDown(e){
    // Enter 보내기, Shift+Enter 줄바꿈, IME 조합 중엔 무시
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendFromInput();
    }
  }

  return {
    init: init, load: load, newConv: newConv,
    sendFromInput: sendFromInput, send: send, onKeyDown: onKeyDown
  };
})();

// ═══════════════════════════════════════════════════════════
// 힘클로바 (녹취록) — 별도 네임스페이스. 일일보고 흐름과 완전 격리.
// 인증·세션·STAFF 등 공유 자원은 외부 함수/변수 그대로 재사용.
// ═══════════════════════════════════════════════════════════
var HimClova = {
  audioFile: null,
  selectedLevel: 'auto',
  _initialized: false,
  _draftSaveTimer: null,
  DRAFT_KEY:  'himclaude_v2_himclova_draft',
  RESULT_KEY: 'himclaude_v2_himclova_result',

  init: function(){
    // 첫 호출에만: draft 복구 → 자동저장 핸들러 바인딩.
    // 이후 호출은 모드 재진입에 해당 (사용자 입력 보존을 위해 복구 안 함).
    if (!HimClova._initialized){
      HimClova.restoreDraft();      // draft 가 있으면 빈 필드만 채움
      HimClova.bindDraftAutoSave(); // input/change → scheduleDraftSave
    }
    // 일자 기본값 — restoreDraft 가 채웠으면 그대로, 비어있으면 오늘
    var dInp = document.getElementById('m-date');
    if (dInp && !dInp.value) dInp.value = dateStr;
    // 등급 버튼 상태 — 현재 selectedLevel(restoreDraft 가 변경했을 수도) 기준 동기화
    document.querySelectorAll('.mode-himclova .lv-btn').forEach(function(b){
      b.classList.toggle('on', b.getAttribute('data-lv') === HimClova.selectedLevel);
    });
    // 드롭존 바인딩 (idempotent — _bound 플래그로 중복 방지)
    HimClova.bindDropZone();
    // sub-page 초기화는 첫 진입 시에만 — 이후 모드 재진입 시엔 마지막 sub-page (input/result) 보존
    // F5 후 캐시된 결과가 있으면 result page 로 자동 복원, 없으면 input page 기본.
    if (!HimClova._initialized){
      if (!HimClova.restoreResult()){
        HimClova.showPage('input');
        HimClova._setSendBtnMode('idle');
      }
    }
    HimClova._initialized = true;
  },

  selectLevel: function(btn, lv){
    HimClova.selectedLevel = lv;
    document.querySelectorAll('.mode-himclova .lv-btn').forEach(function(b){ b.classList.remove('on'); });
    if (btn) btn.classList.add('on');
    HimClova.scheduleDraftSave();
  },

  // 음성 파일 1회 1개 — 이미 칩 있으면 picker 안 열림. 제거(×) 후 다시 선택.
  openFilePicker: function(){
    if (HimClova.audioFile){
      toast('💡 이미 파일이 선택돼있어요. 변경하려면 × 로 먼저 제거해주세요');
      return;
    }
    document.getElementById('audio-inp').click();
  },

  // 파일 타입 분류 — 'audio' (변환+후처리) | 'text' (후처리만) | null (지원 안함)
  _classifyFile: function(f){
    var name = (f && f.name || '').toLowerCase();
    var type = (f && f.type || '');
    if (/^audio\//.test(type) || /\.(mp3|m4a|wav|webm|mp4|ogg)$/.test(name)) return 'audio';
    if (/^text\//.test(type)
        || type === 'application/msword'
        || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || /\.(txt|md|markdown|doc|docx)$/.test(name)) return 'text';
    return null;
  },

  handleAudioFile: function(inp){
    var f = inp.files && inp.files[0];
    if (!f) { return; }
    var mode = HimClova._classifyFile(f);
    if (!mode){
      toast('⚠️ 지원하지 않는 형식. 음성(mp3/m4a/wav/webm/mp4) 또는 텍스트(txt/md/doc/docx)');
      inp.value = '';
      return;
    }
    HimClova.audioFile = f;
    HimClova._fileMode = mode;
    HimClova.renderFileChip();
    inp.value = '';  // 같은 파일 재선택 가능
  },

  renderFileChip: function(){
    var chips = document.getElementById('hc-file-chips');
    var zone  = document.getElementById('hc-upload-zone');
    if (!chips || !zone) return;
    chips.innerHTML = '';
    if (!HimClova.audioFile){
      zone.classList.remove('has-file');
      return;
    }
    var sizeMB = (HimClova.audioFile.size/1024/1024).toFixed(1);
    var ext = (HimClova.audioFile.name.split('.').pop()||'').toLowerCase();
    var isText = (HimClova._fileMode === 'text');
    var icon;
    if (isText)             icon = '📄';
    else if (ext === 'mp4') icon = '🎬';
    else if (ext === 'webm') icon = '🎙️';
    else                    icon = '🎵';
    var modeLabel = isText ? '텍스트 (후처리만)' : '선택됨';
    var chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.innerHTML =
      '<div class="file-chip-icon">'+icon+'</div>'+
      '<div class="file-chip-info">'+
        '<div class="file-chip-name">✅ '+escapeHtml(HimClova.audioFile.name)+'</div>'+
        '<div class="file-chip-meta">'+sizeMB+' MB · '+escapeHtml(ext.toUpperCase())+' · '+modeLabel+'</div>'+
      '</div>'+
      '<button class="file-chip-del" onclick="HimClova.removeAudioFile(event)" title="제거">×</button>';
    chips.appendChild(chip);
    zone.classList.add('has-file');
  },

  removeAudioFile: function(ev){
    if (ev) ev.stopPropagation();
    HimClova.audioFile = null;
    HimClova._fileMode = null;
    HimClova.renderFileChip();
  },

  bindDropZone: function(){
    var zone = document.getElementById('hc-upload-zone');
    if (!zone || zone._bound) return;
    zone._bound = true;
    ['dragenter','dragover'].forEach(function(evt){
      zone.addEventListener(evt, function(e){
        e.preventDefault(); e.stopPropagation();
        zone.classList.add('dragover');
      });
    });
    ['dragleave','drop'].forEach(function(evt){
      zone.addEventListener(evt, function(e){
        e.preventDefault(); e.stopPropagation();
        zone.classList.remove('dragover');
      });
    });
    zone.addEventListener('drop', function(e){
      if (HimClova.audioFile){
        toast('💡 이미 파일이 선택돼있어요. 변경하려면 × 로 먼저 제거해주세요');
        return;
      }
      var dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files[0]) return;
      var f = dt.files[0];
      var mode = HimClova._classifyFile(f);
      if (!mode){
        toast('⚠️ 음성(mp3/m4a/wav/webm/mp4) 또는 텍스트(txt/md/doc/docx) 파일만 업로드 가능');
        return;
      }
      HimClova.audioFile = f;
      HimClova._fileMode = mode;
      HimClova.renderFileChip();
    });
  },

  // 진행 중이면 중지, 아니면 시작
  toggleSubmit: function(){
    if (HimClova._inFlight){
      HimClova.cancelSubmit();
    } else {
      HimClova.doUpload();
    }
  },

  cancelSubmit: function(){
    if (HimClova._abortCtrl){
      HimClova._abortCtrl.abort();
    }
  },

  // 모드: 'idle'|'stopping'|'done'|'saving'|'saved'
  _setSendBtnMode: function(mode){
    var sendBtn     = document.getElementById('hc-send-btn');
    var saveBtn     = document.getElementById('hc-save-btn');
    var icon        = document.getElementById('hc-send-icon');
    var label       = document.getElementById('hc-send-label');
    var saveIcon    = document.getElementById('hc-save-icon');
    var saveLabel   = document.getElementById('hc-save-label');
    var progressBox = document.getElementById('progress-box');
    var resultArea  = document.getElementById('result-area');
    var savedScreen = document.getElementById('hc-saved-screen');
    if (!sendBtn || !saveBtn) return;

    // 모든 버튼 hide + state 초기화
    sendBtn.style.display = 'none';
    saveBtn.style.display = 'none';
    saveBtn.disabled = false;
    sendBtn.classList.remove('stopping');

    // saved 외 모드 → saved-screen hide + progress-box 정상 흐름 복귀
    // (result-area 는 showResult / newRecording 가 직접 관리하므로 여기서 건드리지 않음)
    if (mode !== 'saved'){
      if (savedScreen) savedScreen.style.display = 'none';
      if (progressBox) progressBox.style.display = '';
    }

    if (mode === 'stopping'){
      // 진행 중 — 빨간 중지 버튼
      sendBtn.style.display = '';
      sendBtn.classList.add('stopping');
      if (icon)  icon.textContent  = '⏹';
      if (label) label.textContent = '진행 중지';
    } else if (mode === 'saving'){
      // 저장 진행 중 — 비활성 + ⏳
      saveBtn.style.display = '';
      saveBtn.disabled = true;
      if (saveIcon)  saveIcon.textContent  = '⏳';
      if (saveLabel) saveLabel.textContent = '저장 중...';
    } else if (mode === 'done'){
      // 변환 완료 — 메인 = 저장하기 (Drive 영구 보관)
      saveBtn.style.display = '';
      if (saveIcon)  saveIcon.textContent  = '📤';
      if (saveLabel) saveLabel.textContent = '저장하기';
    } else if (mode === 'saved'){
      // 저장 완료 — 진행 박스·결과 영역 모두 hide. 화면 = saved-screen 단독 (bottom 비어있음).
      if (progressBox) progressBox.style.display = 'none';
      if (resultArea)  resultArea.style.display  = 'none';
      if (savedScreen) savedScreen.style.display = '';
    } else {
      // idle (input page) — 텍스트화 진행
      sendBtn.style.display = '';
      if (icon)  icon.textContent  = '▶';
      if (label) label.textContent = '텍스트화 진행';
    }
  },

  // Drive 영구 저장 (Step F) — localStorage 의 result 를 GAS 로 POST.
  // 응답에 docContent (HTML→.doc) 포함 → _lastSavedDoc 보관, '내 기기 저장' 버튼이 다운로드 트리거.
  saveToDrive: function(){
    var p = HimClova.loadResult();
    if (!p || !p.data){
      toast('⚠️ 저장할 결과가 없습니다');
      return;
    }
    if (!getSession()){ forceReauth('세션이 만료되었습니다'); return; }

    HimClova._setSendBtnMode('saving');

    fetch(APPS_SCRIPT_URL, {
      method:  'POST',
      headers: {'Content-Type':'text/plain;charset=utf-8'},
      body:    JSON.stringify({
        token:   APPS_SCRIPT_TOKEN,
        action:  'meeting_save',
        session: getSession(),
        payload: {
          data:       p.data,
          meta:       p.meta,
          level:      p.levelAtComplete,
          elapsedSec: p.elapsedSec
        }
      })
    })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (!res || !res.ok) throw new Error((res && (res.message || res.error)) || '저장 실패');
      HimClova._lastSavedDoc = {
        content:  res.docContent  || '',
        filename: res.docFilename || 'meeting.doc'
      };
      HimClova.clearResult();   // localStorage 폐기 — 재저장 방지 + F5 시 input page
      HimClova._setSendBtnMode('saved');
      toast('✅ 저장되었습니다');
    })
    .catch(function(err){
      console.error('[힘클로바] save error:', err);
      toast('⚠️ ' + (err && err.message || '저장 실패'));
      HimClova._setSendBtnMode('done');  // 다시 시도 가능
    });
  },

  // .doc 다운로드 — 저장 응답에서 받은 HTML 을 Blob 으로 (UTF-8 BOM 포함, Word·한글 자동 인식)
  downloadAsDoc: function(){
    if (!HimClova._lastSavedDoc || !HimClova._lastSavedDoc.content){
      toast('⚠️ 다운로드할 내용이 없습니다');
      return;
    }
    var BOM  = '﻿';
    var blob = new Blob([BOM + HimClova._lastSavedDoc.content], { type: 'application/msword' });
    var url  = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href     = url;
    a.download = HimClova._lastSavedDoc.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  },

  // 첫 화면으로 — saved 흔적 정리 후 newRecording (input page 복귀)
  goHome: function(){
    HimClova._lastSavedDoc = null;
    HimClova.newRecording();
  },

  // sub-page 전환 (input ↔ result)
  showPage: function(pageName){
    var input  = document.getElementById('hc-page-input');
    var result = document.getElementById('hc-page-result');
    if (!input || !result) return;
    if (pageName === 'result'){
      input.style.display  = 'none';
      result.style.display = '';
    } else {
      input.style.display  = '';
      result.style.display = 'none';
    }
    window.scrollTo({top:0, behavior:'auto'});
  },

  // 새 녹취록 변환 — 폼 리셋 후 input page 로 복귀
  newRecording: function(){
    HimClova.clearResult();
    HimClova._lastSavedDoc = null;
    HimClova._hideWarn();
    HimClova.audioFile = null;
    HimClova._fileMode = null;
    HimClova.renderFileChip();
    document.getElementById('m-title').value   = '';
    document.getElementById('m-project').value = '';
    document.getElementById('m-memo').value    = '';
    HimClova.selectedLevel = 'auto';
    document.querySelectorAll('.mode-himclova .lv-btn').forEach(function(b){
      b.classList.toggle('on', b.getAttribute('data-lv') === 'auto');
    });
    // 결과 영역 + 저장 완료 화면 모두 정리, progress-box 정상 흐름 복귀
    document.getElementById('result-area').style.display = 'none';
    var pb = document.getElementById('progress-box');
    if (pb){ pb.classList.remove('done'); pb.style.display = ''; }
    var ss = document.getElementById('hc-saved-screen');
    if (ss) ss.style.display = 'none';
    // 페이지 복귀
    HimClova.showPage('input');
    HimClova._setSendBtnMode('idle');
  },

  doUpload: function(){
    var title = (document.getElementById('m-title').value||'').trim();
    var date    = (document.getElementById('m-date').value    ||'').trim();
    var project = (document.getElementById('m-project').value ||'').trim();
    var memo    = (document.getElementById('m-memo').value    ||'').trim();

    if (!title)          { toast('⚠️ 녹취 제목을 입력해주세요'); return; }
    if (!date)           { toast('⚠️ 녹취 일자를 선택해주세요'); return; }
    if (!HimClova.audioFile) { toast('⚠️ 파일을 선택해주세요'); return; }
    if (!getSession())   { forceReauth('세션이 만료되었습니다'); return; }
    if (!HIMCLOVA_URL){
      toast('⚠️ 힘클로바 서버 URL 미설정 — 콘솔에서 localStorage.setItem("himclaude_v2_himclova_url","http://localhost:8080") 로 임시 설정');
      return;
    }

    // 텍스트 파일이면 후처리만 진행 (음성 변환 단계 건너뜀)
    if (HimClova._fileMode === 'text'){
      return HimClova.doTextPostprocess(title, date, project, memo);
    }

    var engine = 'clova'; // CLOVA 단독 정책 (2026-04-28). Whisper·GCP STT 폐기.

    // step-transcribe 라벨 reset (이전이 텍스트 모드였을 가능성)
    var lbl = document.querySelector('#step-transcribe .ps-label');
    if (lbl) lbl.textContent = 'CLOVA 텍스트 변환';

    // 진행 시작 시점에 이전 결과 폐기 — 곧 새 결과로 덮어씀. 실패해도 이전 결과 복원 의도 없음.
    HimClova.clearResult();

    var fd = new FormData();
    fd.append('audio', HimClova.audioFile);
    fd.append('engine', engine);
    fd.append('title', title);
    fd.append('meeting_date', date);
    fd.append('project', project);
    fd.append('memo', memo);
    fd.append('level_hint', HimClova.selectedLevel);
    fd.append('user_email', (profile&&profile.email)||'');  // 개인 사전 조회 키

    // result sub-page 로 전환 + 진행 박스 활성
    HimClova.showPage('result');
    document.getElementById('result-area').style.display = 'none';
    var pb = document.getElementById('progress-box');
    if (pb) pb.classList.remove('done');
    HimClova.showStatus('upload');
    HimClova._inFlight = true;
    HimClova._setSendBtnMode('stopping');

    // 장시간 경고 배지 — 임계값 이상 파일이면 즉시 transcribe 옆 표시
    // (60초 경과·240초 analyze 자동 전환은 ticker 가 담당)
    HimClova._hideWarn();
    HimClova._switchedToAnalyze = false;
    if (HimClova.audioFile && HimClova.audioFile.size >= HimClova.WARN_SIZE_BYTES){
      HimClova._showWarn('transcribe');
    }

    var ctrl = new AbortController();
    HimClova._abortCtrl = ctrl;
    var timeoutId = setTimeout(function(){ ctrl.abort(); }, UPLOAD_TIMEOUT_MS);
    var t0 = Date.now();
    HimClova._startElapsedTicker(t0);

    console.log('[힘클로바] POST '+HIMCLOVA_URL+'/transcribe', {engine:engine, file:HimClova.audioFile.name, size:HimClova.audioFile.size, title:title});

    HimClova.showStatus('transcribe');

    fetch(HIMCLOVA_URL + '/transcribe', {
      method: 'POST',
      body: fd,
      signal: ctrl.signal
    }).then(function(resp){
      clearTimeout(timeoutId);
      if (!resp.ok){
        return resp.text().then(function(t){
          throw new Error('서버 오류 ('+resp.status+'): '+(t || resp.statusText));
        });
      }
      return resp.json();
    }).then(function(data){
      var elapsed = Math.round((Date.now() - t0) / 1000);
      if (!data || data.ok === false){
        throw new Error((data && data.message) || '알 수 없는 응답');
      }
      console.log('[힘클로바] 변환 완료', data);
      HimClova.clearDraft();  // 업로드 성공 시 draft 즉시 폐기
      // 후처리는 서버에서 이미 완료된 상태로 응답이 옴 → analyze 표시 짧게
      HimClova.showStatus('save');
      setTimeout(function(){
        HimClova.showStatus('done');
        HimClova.showResult(data, elapsed);
        HimClova._inFlight = false;
        HimClova._abortCtrl = null;
        HimClova._stopElapsedTicker();
        HimClova._setSendBtnMode('done');
      }, 300);
    }).catch(function(err){
      clearTimeout(timeoutId);
      HimClova._inFlight = false;
      HimClova._abortCtrl = null;
      HimClova._stopElapsedTicker();
      if (err && err.name === 'AbortError'){
        toast('🛑 진행을 중지했습니다');
        // 중지 시 input page 로 복귀 (폼 보존)
        HimClova.showPage('input');
        HimClova._setSendBtnMode('idle');
      } else {
        toast('⚠️ ' + (err && err.message ? err.message : '업로드 실패'));
        console.error('[힘클로바] upload error:', err);
        // 에러 시 진행 박스에 error 단계 표시 + 경고 배지 정리
        HimClova.showStatus('error');
        HimClova._hideWarn();
        // result page 에 머무르되 새 녹취록 버튼으로 복귀 가능하게
        HimClova._setSendBtnMode('done');
      }
    });
  },

  // 텍스트 파일 후처리만 진행 (input page 의 _fileMode === 'text' 케이스).
  // 음성 변환 단계 건너뛰고 Cloud Run /postprocess 로 multipart 전송.
  doTextPostprocess: function(title, date, project, memo){
    HimClova.clearResult();

    // step-transcribe 라벨을 '텍스트 추출' 로 변경 (UX 명확화)
    var lbl = document.querySelector('#step-transcribe .ps-label');
    if (lbl) lbl.textContent = '텍스트 추출';

    // result sub-page 전환 + 진행 박스 활성 (upload→analyze 흐름)
    HimClova.showPage('result');
    document.getElementById('result-area').style.display = 'none';
    var pb = document.getElementById('progress-box');
    if (pb) pb.classList.remove('done');
    HimClova.showStatus('upload');
    HimClova._inFlight = true;
    HimClova._setSendBtnMode('stopping');
    HimClova._hideWarn();
    HimClova._switchedToAnalyze = true;   // 텍스트 모드는 transcribe 단계 거치지 않으니 ticker 휴리스틱 비활성
    // 텍스트 50KB 이상이면 즉시 analyze 옆 경고
    if (HimClova.audioFile && HimClova.audioFile.size >= HimClova.WARN_TEXT_SIZE_BYTES){
      HimClova._showWarn('analyze', '⏱ 용량이 커서 3분 이상 걸릴 수 있어요');
    }

    var ctrl = new AbortController();
    HimClova._abortCtrl = ctrl;
    var timeoutId = setTimeout(function(){ ctrl.abort(); }, UPLOAD_TIMEOUT_MS);
    var t0 = Date.now();
    HimClova._startElapsedTicker(t0);

    var fd = new FormData();
    fd.append('document', HimClova.audioFile);
    fd.append('title', title);
    fd.append('meeting_date', date);
    fd.append('project', project);
    fd.append('memo', memo);
    fd.append('level_hint', HimClova.selectedLevel);
    fd.append('user_email', (profile&&profile.email)||'');  // 개인 사전 조회 키

    console.log('[힘클로바] POST '+HIMCLOVA_URL+'/postprocess (text)', {file:HimClova.audioFile.name, size:HimClova.audioFile.size, title:title});

    HimClova.showStatus('analyze');

    fetch(HIMCLOVA_URL + '/postprocess', {
      method: 'POST',
      body: fd,
      signal: ctrl.signal
    }).then(function(resp){
      clearTimeout(timeoutId);
      if (!resp.ok){
        return resp.text().then(function(t){
          throw new Error('서버 오류 ('+resp.status+'): '+(t || resp.statusText));
        });
      }
      return resp.json();
    }).then(function(data){
      var elapsed = Math.round((Date.now() - t0) / 1000);
      if (!data.ok) throw new Error(data.message || '후처리 실패');
      HimClova.clearDraft();
      HimClova.showStatus('save');
      setTimeout(function(){
        HimClova.showStatus('done');
        HimClova.showResult(data, elapsed);
        HimClova._inFlight = false;
        HimClova._abortCtrl = null;
        HimClova._stopElapsedTicker();
        HimClova._setSendBtnMode('done');
      }, 300);
    }).catch(function(err){
      clearTimeout(timeoutId);
      HimClova._inFlight = false;
      HimClova._abortCtrl = null;
      HimClova._stopElapsedTicker();
      if (err && err.name === 'AbortError'){
        toast('🛑 진행을 중지했습니다');
        HimClova.showPage('input');
        HimClova._setSendBtnMode('idle');
      } else {
        toast('⚠️ ' + (err && err.message ? err.message : '후처리 실패'));
        console.error('[힘클로바] postprocess error:', err);
        HimClova.showStatus('error');
        HimClova._hideWarn();
        HimClova._setSendBtnMode('done');
      }
    });
  },

  // 결과 페이지에서 '↻ 후처리 재진행' 클릭 시 — 현재 transcript 만 다시 Claude 후처리.
  // CLOVA 변환 비용 0, 30~60초 + ~$0.30. 후처리 실패 케이스 회복용.
  reprocess: function(){
    var p = HimClova.loadResult();
    if (!p || !p.data){
      toast('⚠️ 후처리할 결과가 없습니다');
      return;
    }
    // raw transcript 우선 (corrected 가 fallback 으로 raw 와 동일하므로 둘 중 아무거나 OK)
    var transcript = (p.data.transcript || p.data.corrected_transcript || '').trim();
    if (!transcript){
      toast('⚠️ transcript 가 비어있습니다');
      return;
    }
    if (!getSession()){ forceReauth('세션이 만료되었습니다'); return; }
    if (!HIMCLOVA_URL){
      toast('⚠️ 힘클로바 서버 URL 미설정');
      return;
    }
    if (HimClova._inFlight){
      toast('💡 이미 진행 중입니다');
      return;
    }

    // 진행 박스를 analyze 단계 active 로
    var pb = document.getElementById('progress-box');
    if (pb) pb.classList.remove('done');
    document.getElementById('result-area').style.display = 'none';
    HimClova.showStatus('analyze');
    HimClova._inFlight = true;
    HimClova._setSendBtnMode('stopping');
    HimClova._hideWarn();
    HimClova._switchedToAnalyze = true;   // reprocess 는 analyze 단계 — ticker 의 transcribe 트리거 비활성
    // transcript 50KB 이상이면 즉시 analyze 옆 경고
    if (transcript.length >= HimClova.WARN_TEXT_SIZE_BYTES){
      HimClova._showWarn('analyze', '⏱ 용량이 커서 3분 이상 걸릴 수 있어요');
    }

    var ctrl = new AbortController();
    HimClova._abortCtrl = ctrl;
    var t0 = Date.now();
    HimClova._startElapsedTicker(t0);

    fetch(HIMCLOVA_URL + '/postprocess', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        transcript:   transcript,
        title:        (p.meta && p.meta.title) || '',
        meeting_date: (p.meta && p.meta.meetingDate) || '',
        project:      (p.meta && p.meta.project) || '',
        memo:         (p.meta && p.meta.memo) || '',
        level_hint:   p.levelAtComplete || HimClova.selectedLevel || 'auto',
        user_email:   (profile&&profile.email)||''
      }),
      signal: ctrl.signal
    }).then(function(r){
      if (!r.ok) return r.text().then(function(t){ throw new Error('서버 오류 ('+r.status+'): '+(t||r.statusText)); });
      return r.json();
    }).then(function(data){
      var elapsed = Math.round((Date.now() - t0) / 1000);
      if (!data.ok) throw new Error(data.message || '후처리 실패');

      // 새 후처리 결과를 기존 STT 데이터 (segments/speakers/duration) 위에 병합
      var merged = Object.assign({}, p.data, {
        corrected_transcript: data.corrected_transcript,
        summary:              data.summary,
        kb_applied:           data.kb_applied,
        suggested_level:      data.suggested_level,
        level_rationale:      data.level_rationale,
        postprocess_meta:     data.postprocess_meta,
        postprocess_applied:  true,
        postprocess_error:    null
      });

      HimClova.showStatus('done');
      HimClova.showResult(merged, p.elapsedSec || elapsed);   // saveResult 가 안에서 자동 호출
      HimClova._inFlight = false;
      HimClova._abortCtrl = null;
      HimClova._stopElapsedTicker();
      HimClova._setSendBtnMode('done');
      toast('✅ 후처리 재진행 완료');
    }).catch(function(err){
      HimClova._inFlight = false;
      HimClova._abortCtrl = null;
      HimClova._stopElapsedTicker();
      HimClova._hideWarn();
      if (err && err.name === 'AbortError'){
        toast('🛑 후처리 중지');
      } else {
        toast('⚠️ ' + (err && err.message || '후처리 실패'));
        console.error('[힘클로바] reprocess error:', err);
      }
      // 어떤 경우든 이전 결과 화면 복원 (사용자가 결과 잃지 않게)
      HimClova.showStatus('done');
      HimClova.showResult(p.data, p.elapsedSec || 0);
      HimClova._setSendBtnMode('done');
    });
  },

  showResult: function(data, elapsedSec){
    var area = document.getElementById('result-area');
    if (!area) return;
    HimClova._hideWarn();   // 변환 끝났으므로 경고 hide
    // 진행 박스를 done 상태로 변환 (체크 표시 + 초록 톤)
    var pb = document.getElementById('progress-box');
    if (pb) pb.classList.add('done');
    var ptitle = document.getElementById('progress-title');
    var psub   = document.getElementById('progress-sub');
    if (ptitle) ptitle.textContent = '✅ 변환 완료';
    if (psub)   psub.textContent   = '결과를 확인해주세요';

    // ── 1) 변환된 텍스트 — corrected 우선, 없으면 raw ───────────
    var displayed = data.corrected_transcript || data.transcript || '';
    document.getElementById('transcript-box').textContent = displayed;
    document.getElementById('rs-postproc-tag').style.display = data.postprocess_applied ? '' : 'none';

    // ── 2) 회의 요약 (안건 / 결정 / 액션아이템) ──────────────────
    var summarySec = document.getElementById('rs-summary');
    var summaryEl  = document.getElementById('result-summary');
    var s = data.summary;
    var hasSummary = s && (
      (Array.isArray(s.agenda) && s.agenda.length) ||
      (Array.isArray(s.decisions) && s.decisions.length) ||
      (Array.isArray(s.action_items) && s.action_items.length)
    );
    if (hasSummary){
      summaryEl.innerHTML = HimClova._renderSummary(s);
      summarySec.style.display = '';
    } else {
      summarySec.style.display = 'none';
    }

    // ── 3) KB 적용 단어 ─────────────────────────────────────────
    var kbSec = document.getElementById('rs-kb');
    var kbEl  = document.getElementById('result-kb');
    if (Array.isArray(data.kb_applied) && data.kb_applied.length > 0){
      kbEl.innerHTML = data.kb_applied.map(function(w){
        return '<span class="kb-chip">'+escapeHtml(w)+'</span>';
      }).join('');
      kbSec.style.display = '';
    } else {
      kbSec.style.display = 'none';
    }

    // ── 4) 추천 등급 ────────────────────────────────────────────
    var lvSec = document.getElementById('rs-level');
    var lvEl  = document.getElementById('result-level');
    var lv = data.suggested_level;
    if (lv && /^L[123]$/.test(lv)){
      var lvLabel = (lv === 'L1') ? 'L1 기밀' : (lv === 'L2') ? 'L2 제한' : 'L3 일반';
      var note = HimClova.selectedLevel === 'auto'
        ? '자동 등급으로 적용됨 (수동 변경 가능)'
        : '추천 등급. 현재 수동 선택값 ('+HimClova.selectedLevel+') 우선.';
      var rationaleHtml = data.level_rationale
        ? '<div class="level-rationale">📌 판단 근거: '+escapeHtml(data.level_rationale)+'</div>'
        : '';
      lvEl.innerHTML = '<span class="level-badge lv-'+lv+'">'+escapeHtml(lvLabel)+'</span>'+
                       '<span class="level-note">'+escapeHtml(note)+'</span>'+
                       rationaleHtml;
      lvSec.style.display = '';
      // 자동 모드면 선택값에 추천 적용 + 등급 버튼 시각 동기화
      if (HimClova.selectedLevel === 'auto'){
        HimClova.selectedLevel = lv;
        document.querySelectorAll('.mode-himclova .lv-btn').forEach(function(b){
          b.classList.toggle('on', b.getAttribute('data-lv') === lv);
        });
      }
    } else {
      lvSec.style.display = 'none';
    }

    // ── 5) 처리 정보 ────────────────────────────────────────────
    var info = document.getElementById('result-info');
    var rows = [];
    if (data.duration){
      var mins = Math.floor(data.duration/60);
      var secs = Math.round(data.duration%60);
      rows.push(['녹음 길이', mins+'분 '+secs+'초']);
    }
    rows.push(['처리 시간', elapsedSec+'초']);
    if (data.segments) rows.push(['세그먼트', data.segments.length+'개']);
    if (data.speakers) rows.push(['화자', data.speakers.length+'명']);
    if (data.postprocess_applied === false){
      rows.push(['후처리', '실패 (원본 표시)']);
    }
    info.innerHTML = rows.map(function(r){
      return '<div class="result-info-row">'+
        '<span class="result-info-key">'+escapeHtml(r[0])+'</span>'+
        '<span class="result-info-val">'+escapeHtml(String(r[1]))+'</span>'+
        '</div>';
    }).join('');

    area.style.display = '';
    area.scrollIntoView({behavior:'smooth', block:'start'});

    // 결과를 localStorage 에 저장 (F5/탭 새로고침 보존). slim 화는 saveResult 안에서.
    HimClova.saveResult(data, elapsedSec);
  },

  // 요약 객체 → HTML
  _renderSummary: function(s){
    var html = '';
    if (Array.isArray(s.agenda) && s.agenda.length){
      html += '<div class="summary-block">'+
              '<div class="summary-h">📋 안건</div>'+
              '<ul class="summary-list">'+
              s.agenda.map(function(a){ return '<li>'+escapeHtml(String(a))+'</li>'; }).join('')+
              '</ul></div>';
    }
    if (Array.isArray(s.decisions) && s.decisions.length){
      html += '<div class="summary-block">'+
              '<div class="summary-h">✅ 결정사항</div>'+
              '<ul class="summary-list">'+
              s.decisions.map(function(d){ return '<li>'+escapeHtml(String(d))+'</li>'; }).join('')+
              '</ul></div>';
    }
    if (Array.isArray(s.action_items) && s.action_items.length){
      html += '<div class="summary-block">'+
              '<div class="summary-h">▶ 액션아이템</div>'+
              '<ul class="summary-list">';
      s.action_items.forEach(function(a){
        var who  = a && a.who  ? '<b>'+escapeHtml(String(a.who))+'</b> · ' : '';
        var what = escapeHtml(String((a && a.what) || ''));
        var due  = a && a.due  ? '<span class="action-due">('+escapeHtml(String(a.due))+')</span>' : '';
        html += '<li>'+who+what+' '+due+'</li>';
      });
      html += '</ul></div>';
    }
    return html;
  },

  // 진행 박스 단계 갱신 — activeStep: 'upload'|'transcribe'|'analyze'|'save'|'done'|'error'
  showStatus: function(activeStep){
    var steps = ['upload','transcribe','analyze','save'];
    var labels = {
      upload:     ['📤 음성 업로드 중...',     '파일을 서버로 전송하고 있어요'],
      transcribe: ['🎙️ 텍스트 변환 중...',     'CLOVA 가 음성을 텍스트로 바꾸는 중'],
      analyze:    ['🤖 힘클로드 분석 중...',   '고유명사 교정과 회의 요약을 만드는 중'],
      save:       ['💫 마무리 중...',          '결과를 정리하는 중'],
      done:       ['✅ 변환 완료',             '결과를 확인해주세요'],
      error:      ['⚠️ 오류 발생',             '아래 메시지를 확인해주세요'],
    };
    var ptitle = document.getElementById('progress-title');
    var psub   = document.getElementById('progress-sub');
    if (ptitle && labels[activeStep]) ptitle.textContent = labels[activeStep][0];
    if (psub   && labels[activeStep]) psub.textContent   = labels[activeStep][1];

    var activeIdx = steps.indexOf(activeStep);
    if (activeStep === 'done') activeIdx = steps.length;  // 모두 done
    if (activeStep === 'error') activeIdx = -1;            // 모두 그대로 + error 표시 따로

    steps.forEach(function(s, i){
      var el = document.getElementById('step-'+s);
      if (!el) return;
      el.classList.remove('done','active','pending','error');
      if (activeStep === 'error'){
        // 현재 active 였던 단계를 error 로 (가장 마지막 active 추정)
        el.classList.add('pending');
      } else if (i < activeIdx)      el.classList.add('done');
      else if (i === activeIdx) el.classList.add('active');
      else                     el.classList.add('pending');
    });
  },

  // 경과 시간 ticker (진행 박스 우상단).
  // - 60초 경과: transcribe 옆 경고 표시 (음성 모드만; 텍스트 모드는 보통 빨라서 안 띄움)
  // - 240초 경과 + 음성 큰 파일: analyze 단계로 자동 전환 + 경고 위치 이동 (변환 거의 끝났을 추정)
  _startElapsedTicker: function(t0){
    HimClova._stopElapsedTicker();
    var el = document.getElementById('progress-elapsed');
    if (!el) return;
    var update = function(){
      var sec = Math.floor((Date.now() - t0) / 1000);
      el.textContent = sec + '초';

      // 60초 경과 — transcribe 경고 (음성 모드만; 텍스트 모드는 doTextPostprocess 가 자체 처리)
      if (sec >= 60 && HimClova._fileMode === 'audio' && !HimClova._switchedToAnalyze){
        HimClova._showWarn('transcribe');
      }

      // 240초 경과 + 음성 큰 파일 → analyze 단계로 자동 전환
      var isBigAudio = HimClova._fileMode === 'audio'
        && HimClova.audioFile
        && HimClova.audioFile.size >= HimClova.WARN_SIZE_BYTES;
      if (sec >= HimClova.ANALYZE_SWITCH_SEC && isBigAudio && !HimClova._switchedToAnalyze){
        HimClova._switchedToAnalyze = true;
        HimClova.showStatus('analyze');
        HimClova._hideWarn('transcribe');
        HimClova._showWarn('analyze', '⏱ 용량이 커서 3분 이상 추가로 걸릴 수 있어요');
      }
    };
    update();
    HimClova._elapsedTimer = setInterval(update, 1000);
  },

  // 장시간 경고 배지 — transcribe / analyze 단계 옆
  // 음성 ≥ 10MB 또는 60초 경과 시 transcribe 옆 / 텍스트 ≥ 50KB 또는 음성 큰파일 4분 경과 후 analyze 단계 진입 시 analyze 옆.
  WARN_SIZE_BYTES:      10 * 1024 * 1024,   // 음성: 10MB
  WARN_TEXT_SIZE_BYTES: 50 * 1024,          // 텍스트: 50KB
  ANALYZE_SWITCH_SEC:   240,                // 음성 큰파일 4분 경과 시 analyze 단계로 자동 전환

  // step = 'transcribe' | 'analyze'. 인자 없으면 transcribe (하위 호환).
  _showWarn: function(step, message){
    var s = step || 'transcribe';
    var w = document.getElementById('ps-warn-' + s);
    if (!w) return;
    if (message) w.textContent = message;
    w.style.display = '';
  },
  // 인자 없으면 두 단계 모두 hide
  _hideWarn: function(step){
    if (!step){
      var t = document.getElementById('ps-warn-transcribe');
      var a = document.getElementById('ps-warn-analyze');
      if (t) t.style.display = 'none';
      if (a) a.style.display = 'none';
      return;
    }
    var w = document.getElementById('ps-warn-' + step);
    if (w) w.style.display = 'none';
  },
  _stopElapsedTicker: function(){
    if (HimClova._elapsedTimer){
      clearInterval(HimClova._elapsedTimer);
      HimClova._elapsedTimer = null;
    }
  },

  // ── Draft 시스템 ────────────────────────
  // 메모·제목·일자·프로젝트·등급을 localStorage 에 자동저장. audioFile 은 binary 라 제외.
  // 업로드 성공 시 clearDraft, 첫 init() 시 빈 필드만 복구 (사용자 입력 덮어쓰지 않음).
  saveDraft: function(){
    if (!profile) return;
    try {
      localStorage.setItem(HimClova.DRAFT_KEY, JSON.stringify({
        email:       profile.email,
        title:       (document.getElementById('m-title').value    || ''),
        meetingDate: (document.getElementById('m-date').value     || ''),
        project:     (document.getElementById('m-project').value  || ''),
        memo:        (document.getElementById('m-memo').value     || ''),
        level:       HimClova.selectedLevel,
        savedAt:     Date.now()
      }));
    } catch(e) {}
  },

  scheduleDraftSave: function(){
    if (HimClova._draftSaveTimer) clearTimeout(HimClova._draftSaveTimer);
    HimClova._draftSaveTimer = setTimeout(HimClova.saveDraft, 400);
  },

  loadDraft: function(){
    try {
      var s = localStorage.getItem(HimClova.DRAFT_KEY);
      if (!s) return null;
      var d = JSON.parse(s);
      if (!d || !profile || d.email !== profile.email) return null;
      return d;
    } catch(e) { return null; }
  },

  clearDraft: function(){
    try { localStorage.removeItem(HimClova.DRAFT_KEY); } catch(e) {}
  },

  restoreDraft: function(){
    var d = HimClova.loadDraft();
    if (!d) return;
    var ti = document.getElementById('m-title');   if (ti && !ti.value && d.title)       ti.value = d.title;
    var dt = document.getElementById('m-date');    if (dt && !dt.value && d.meetingDate) dt.value = d.meetingDate;
    var pj = document.getElementById('m-project'); if (pj && !pj.value && d.project)     pj.value = d.project;
    var mo = document.getElementById('m-memo');    if (mo && !mo.value && d.memo) { mo.value = d.memo; autosizeTa(mo); }
    if (d.level) HimClova.selectedLevel = d.level;
  },

  bindDraftAutoSave: function(){
    ['m-title','m-date','m-project','m-memo'].forEach(function(id){
      var el = document.getElementById(id);
      if (el && !el._hcDraftBound){
        el._hcDraftBound = true;
        el.addEventListener('input',  HimClova.scheduleDraftSave);
        el.addEventListener('change', HimClova.scheduleDraftSave);
      }
    });
  },

  // ── Result 캐시 ──────────────────────────
  // 변환 결과를 localStorage 에 저장. F5/탭 새로고침 후 init() 첫 호출에서 자동 복원.
  // segments/speakers 배열은 .length 만 사용되므로 array-like {length:N} 으로 슬림화.
  saveResult: function(data, elapsedSec){
    if (!data) return;
    try {
      var slim = {};
      for (var k in data) {
        if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
        if (k === 'segments' || k === 'speakers'){
          slim[k] = (data[k] && typeof data[k].length === 'number')
            ? { length: data[k].length }
            : data[k];
        } else {
          slim[k] = data[k];
        }
      }
      var meta = {
        title:       (document.getElementById('m-title')   || {}).value || '',
        meetingDate: (document.getElementById('m-date')    || {}).value || '',
        project:     (document.getElementById('m-project') || {}).value || '',
        memo:        (document.getElementById('m-memo')    || {}).value || ''
      };
      localStorage.setItem(HimClova.RESULT_KEY, JSON.stringify({
        data:            slim,
        elapsedSec:      elapsedSec || 0,
        levelAtComplete: HimClova.selectedLevel,
        meta:            meta,
        savedAt:         Date.now()
      }));
    } catch(e) {}
  },

  loadResult: function(){
    try {
      var s = localStorage.getItem(HimClova.RESULT_KEY);
      if (!s) return null;
      var p = JSON.parse(s);
      if (!p || !p.data) return null;
      return p;
    } catch(e) { return null; }
  },

  clearResult: function(){
    try { localStorage.removeItem(HimClova.RESULT_KEY); } catch(e) {}
  },

  // F5 후 결과 복원 — 결과가 있으면 result page 로 자동 이동 + showResult 재실행. 성공 시 true.
  restoreResult: function(){
    var p = HimClova.loadResult();
    if (!p || !p.data) return false;
    if (p.levelAtComplete){
      HimClova.selectedLevel = p.levelAtComplete;
      document.querySelectorAll('.mode-himclova .lv-btn').forEach(function(b){
        b.classList.toggle('on', b.getAttribute('data-lv') === HimClova.selectedLevel);
      });
    }
    var pb = document.getElementById('progress-box');
    if (pb) pb.classList.add('done');
    HimClova.showStatus('done');
    HimClova.showPage('result');
    HimClova.showResult(p.data, p.elapsedSec || 0);
    HimClova._setSendBtnMode('done');
    return true;
  }
};

// ── Claude 셋업 모달 (2026-05-22) ───────────────────────────────────
// 우상단 ✦ 버튼 클릭 시 진입. MCP URL 복사 + 이름→instruction_block 생성.
// GAS doGet?action=get_staff 호출 후 클라이언트 매칭 (setup_me 동일 로직).
function openClaudeSetup(){
  document.getElementById('cs-overlay').classList.add('open');
  setTimeout(function(){ var i=document.getElementById('cs-name'); if(i) i.focus(); }, 80);
}
function closeClaudeSetup(){
  document.getElementById('cs-overlay').classList.remove('open');
}
function csMsg(id, txt, kind){
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = txt;
  el.className = 'cs-msg' + (kind ? ' ' + kind : '');
}
function csSetResult(txt){
  var ta = document.getElementById('cs-result');
  ta.value = txt;
  ta.classList.toggle('empty', !txt);
}
// clipboard API → execCommand fallback → 그래도 실패면 텍스트 선택 상태로 두고 Ctrl+C 안내
function csTryCopy(text, srcEl, msgId, okMsg){
  function execFallback(){
    try {
      var el = srcEl;
      var temp = null;
      if (!el) {
        temp = document.createElement('textarea');
        temp.value = text;
        temp.style.position = 'fixed';
        temp.style.top = '-9999px';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        el = temp;
      }
      el.removeAttribute('readonly');
      el.focus();
      el.select();
      if (el.setSelectionRange) el.setSelectionRange(0, text.length);
      var ok = document.execCommand && document.execCommand('copy');
      el.setAttribute('readonly','');
      if (temp) document.body.removeChild(temp);
      if (ok) {
        // 성공 시 selection 풀기 (시각적으로 파란 하이라이트 남는 거 방지)
        try {
          if (el.setSelectionRange) el.setSelectionRange(0, 0);
          if (window.getSelection) window.getSelection().removeAllRanges();
          el.blur();
        } catch(_){}
        csMsg(msgId, okMsg, 'ok');
      } else if (srcEl) csMsg(msgId, '자동 복사 차단됨 — 텍스트 선택돼 있음. Ctrl+C 눌러주세요', 'err');
      else csMsg(msgId, '복사 실패 — 텍스트 선택 후 Ctrl+C', 'err');
    } catch(e) {
      csMsg(msgId, '복사 실패: ' + e.message, 'err');
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      function(){ csMsg(msgId, okMsg, 'ok'); },
      function(){ execFallback(); }
    );
  } else {
    execFallback();
  }
}
function csCopyUrl(){
  var el = document.getElementById('cs-mcp-url');
  csTryCopy(el.value, el, 'cs-msg-url', '복사됨');
}
function csCopyResult(){
  var ta = document.getElementById('cs-result');
  if (!ta.value.trim()) { csMsg('cs-msg-name','먼저 [생성] 으로 텍스트 만들기','err'); return; }
  csTryCopy(ta.value, ta, 'cs-msg-name', '복사됨 — 프로젝트 지침에 붙여넣기');
}
function csLookupAndBuild(){
  var name = String((document.getElementById('cs-name').value)||'').trim();
  if (!name) { csMsg('cs-msg-name','이름을 입력해주세요','err'); return; }
  var tplEl = document.getElementById('cs-tpl');
  if (!tplEl || !tplEl.textContent.trim()) { csMsg('cs-msg-name','지침 템플릿 로드 실패','err'); return; }
  csMsg('cs-msg-name','조회 중...','');
  fetch(APPS_SCRIPT_URL + '?action=get_staff')
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (!data.ok || !Array.isArray(data.staff)) {
        csMsg('cs-msg-name','직원목록 조회 실패','err'); return;
      }
      var matches = data.staff.filter(function(s){ return s.name && s.name.indexOf(name) >= 0; });
      if (matches.length === 0) {
        csMsg('cs-msg-name','\'' + name + '\' 에 해당하는 직원 없음','err');
        csSetResult(''); return;
      }
      if (matches.length > 1) {
        csMsg('cs-msg-name','여러 명 매칭: ' + matches.map(function(m){return m.name}).join(', ') + ' — 정확한 이름 입력','err');
        csSetResult(''); return;
      }
      var me = matches[0];
      var tpl = tplEl.textContent;
      var filled = tpl
        .replace(/\{\{NAME\}\}/g,  me.name  || '')
        .replace(/\{\{ROLE\}\}/g,  me.role  || '')
        .replace(/\{\{DEPT\}\}/g,  me.dept  || '')
        .replace(/\{\{GRADE\}\}/g, me.grade || '')
        .replace(/\{\{EMAIL\}\}/g, me.email || '');
      csSetResult(filled);
      csMsg('cs-msg-name','매칭 완료 (' + me.name + ' / ' + me.dept + ') — [결과 복사] 누르세요','ok');
    })
    .catch(function(e){ csMsg('cs-msg-name','오류: ' + e.message,'err'); });
}
// Esc 로 모달 닫기
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') {
    var ov = document.getElementById('cs-overlay');
    if (ov && ov.classList.contains('open')) closeClaudeSetup();
  }
});
// ── 셋업 선택 메뉴 (2026-05-29) — ✦ 버튼 1개에서 힘보고/후처리 분기 ──────────
function openSetupMenu(){
  document.getElementById('setup-menu-overlay').classList.add('open');
}
function closeSetupMenu(){
  document.getElementById('setup-menu-overlay').classList.remove('open');
}
function chooseSetup(which){
  closeSetupMenu();
  if (which === 'voice') openVoicePost();
  else if (which === 'oauth') openOauthConsent();
  else openClaudeSetup();
}
function openVoicePost(){
  document.getElementById('vp-overlay').classList.add('open');
  setTimeout(function(){ var i=document.getElementById('vp-name'); if(i) i.focus(); }, 80);
}
function closeVoicePost(){
  document.getElementById('vp-overlay').classList.remove('open');
}
function vpSetResult(txt){
  var ta = document.getElementById('vp-result');
  ta.value = txt; ta.classList.toggle('empty', !txt);
}
function vpCopyUrl(){
  var el = document.getElementById('vp-mcp-url');
  csTryCopy(el.value, el, 'vp-msg-url', '복사됨');
}
function vpCopyResult(){
  var ta = document.getElementById('vp-result');
  if (!ta.value.trim()) { csMsg('vp-msg-name','먼저 [생성] 으로 텍스트 만들기','err'); return; }
  csTryCopy(ta.value, ta, 'vp-msg-name', '복사됨 — 프로젝트 지침에 붙여넣기');
}
// ── txt 다운로드 (지침을 파일로 저장 → 프로젝트에 자료로 첨부) ────────────────
function csDownloadText(text, filename){
  var blob = new Blob([text], {type:'text/plain;charset=utf-8'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}
function vpDownloadTxt(){
  var ta = document.getElementById('vp-result');
  if (!ta.value.trim()) { csMsg('vp-msg-name','먼저 [생성] 으로 텍스트 만들기','err'); return; }
  var nm = String((document.getElementById('vp-name').value)||'').trim() || '음성후처리';
  csDownloadText(ta.value, nm + '_음성후처리지침.txt');
  csMsg('vp-msg-name','txt 저장됨 — 프로젝트에 자료로 첨부하세요','ok');
}
function csDownloadTxt(){
  var ta = document.getElementById('cs-result');
  if (!ta.value.trim()) { csMsg('cs-msg-name','먼저 [생성] 으로 텍스트 만들기','err'); return; }
  var nm = String((document.getElementById('cs-name').value)||'').trim() || '힘보고';
  csDownloadText(ta.value, nm + '_힘보고지침.txt');
  csMsg('cs-msg-name','txt 저장됨','ok');
}
function vpLookupAndBuild(){
  var name = String((document.getElementById('vp-name').value)||'').trim();
  if (!name) { csMsg('vp-msg-name','이름을 입력해주세요','err'); return; }
  var tplEl = document.getElementById('vp-tpl');
  if (!tplEl || !tplEl.textContent.trim()) { csMsg('vp-msg-name','지침 템플릿 로드 실패','err'); return; }
  csMsg('vp-msg-name','조회 중...','');
  fetch(APPS_SCRIPT_URL + '?action=get_staff')
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (!data.ok || !Array.isArray(data.staff)) {
        csMsg('vp-msg-name','직원목록 조회 실패','err'); return;
      }
      var matches = data.staff.filter(function(s){ return s.name && s.name.indexOf(name) >= 0; });
      if (matches.length === 0) {
        csMsg('vp-msg-name','\'' + name + '\' 에 해당하는 직원 없음','err'); vpSetResult(''); return;
      }
      if (matches.length > 1) {
        csMsg('vp-msg-name','여러 명 매칭: ' + matches.map(function(m){return m.name}).join(', ') + ' — 정확한 이름 입력','err');
        vpSetResult(''); return;
      }
      var me = matches[0];
      var filled = tplEl.textContent
        .replace(/\{\{NAME\}\}/g,  me.name  || '')
        .replace(/\{\{ROLE\}\}/g,  me.role  || '')
        .replace(/\{\{DEPT\}\}/g,  me.dept  || '')
        .replace(/\{\{GRADE\}\}/g, me.grade || '')
        .replace(/\{\{EMAIL\}\}/g, me.email || '');
      vpSetResult(filled);
      csMsg('vp-msg-name','매칭 완료 (' + me.name + ' / ' + me.dept + ') — [결과 복사] 누르세요','ok');
    })
    .catch(function(e){ csMsg('vp-msg-name','오류: ' + e.message,'err'); });
}

// ── 메일 권한 동의 (2026-06-01 복구·확장) — 이메일 직접 입력 → /oauth/start?email= 새 탭.
// /oauth/start 가 Google authorize 로 redirect → callback 에서 refresh_token 을 GAS 에 저장.
// 1회 동의로 Claude.ai 측 메일 읽기·검색·첨부·발송 + Drive 가 모두 켜짐 (gmail.readonly+send+drive.file+drive.readonly).
var OAUTH_START_BASE = 'https://himreport-mcp-prod-production.up.railway.app/oauth/start';
function openOauthConsent(){
  document.getElementById('oauth-overlay').classList.add('open');
  setTimeout(function(){ var i=document.getElementById('oauth-email'); if(i) i.focus(); }, 80);
}
function closeOauthConsent(){
  document.getElementById('oauth-overlay').classList.remove('open');
}
function oauthOpenConsent(){
  var email = String((document.getElementById('oauth-email').value)||'').trim();
  if (!email || email.indexOf('@') < 1 || email.indexOf('.') < 0) {
    csMsg('oauth-msg','올바른 이메일을 입력하세요 (예: thehimenc180724@gmail.com)','err'); return;
  }
  var url = OAUTH_START_BASE + '?email=' + encodeURIComponent(email);
  window.open(url, '_blank', 'noopener');
  csMsg('oauth-msg','새 탭 열림 — Google 동의를 마치면 이 창을 닫으세요. Testing 모드라 약 7일마다 재동의가 필요합니다.','ok');
}
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape') {
    var ov = document.getElementById('vp-overlay');
    if (ov && ov.classList.contains('open')) closeVoicePost();
    var mv = document.getElementById('setup-menu-overlay');
    if (mv && mv.classList.contains('open')) closeSetupMenu();
    var au = document.getElementById('oauth-overlay');
    if (au && au.classList.contains('open')) closeOauthConsent();
  }
});
// ── 통합 셋업 생성기 (2026-06-01) — ub-*. csTryCopy/csMsg/csDownloadText/APPS_SCRIPT_URL 재사용 ──
var ubFilled = null; // { name, box, report, prepare, voice, tools, briefing, makebrief }
function openUnifiedSetup(){
  document.getElementById('ub-overlay').classList.add('open');
  setTimeout(function(){ var i=document.getElementById('ub-name'); if(i) i.focus(); }, 80);
}
function closeUnifiedSetup(){ document.getElementById('ub-overlay').classList.remove('open'); }
function ubSetBox(txt){ var ta=document.getElementById('ub-box'); ta.value=txt; ta.classList.toggle('empty', !txt); }
function ubCopyUrl(){ var el=document.getElementById('ub-mcp-url'); csTryCopy(el.value, el, 'ub-msg-url', '복사됨'); }
function ubCopyUrl2(){ var el=document.getElementById('ub-mcp-url2'); csTryCopy(el.value, el, 'ub-msg-url', '복사됨'); }
function ubCopyBox(){
  var ta=document.getElementById('ub-box');
  if(!ta.value.trim()){ csMsg('ub-msg-name','먼저 [생성] 으로 만들기','err'); return; }
  csTryCopy(ta.value, ta, 'ub-msg-name', '박스 복사됨 — 프로젝트 지침란에 붙여넣기');
}
function ubFill(tplId, me){
  var el=document.getElementById(tplId);
  if(!el) return '';
  return el.textContent
    .replace(/\{\{NAME\}\}/g,  me.name  || '')
    .replace(/\{\{ROLE\}\}/g,  me.role  || '')
    .replace(/\{\{DEPT\}\}/g,  me.dept  || '')
    .replace(/\{\{GRADE\}\}/g, me.grade || '')
    .replace(/\{\{EMAIL\}\}/g, me.email || '');
}
function ubDl(which){
  if(!ubFilled){ csMsg('ub-msg-name','먼저 [생성] 으로 만들기','err'); return; }
  var map={ box:['box','지침(박스)'], report:['report','보고모드'], prepare:['prepare','업무보고준비'], voice:['voice','음성텍스트화'], tools:['tools','도구컨텍스트'], briefing:['briefing','브리핑읽기'], makebrief:['makebrief','브리핑만들기'] };
  var m=map[which]; if(!m) return;
  csDownloadText(ubFilled[m[0]], ubFilled.name + '_' + m[1] + '.txt');
  csMsg('ub-msg-name', m[1] + '.txt 저장됨', 'ok');
}
function ubLookupAndBuild(){
  var name = String((document.getElementById('ub-name').value)||'').trim();
  if(!name){ csMsg('ub-msg-name','이름을 입력해주세요','err'); return; }
  csMsg('ub-msg-name','조회 중...','');
  fetch(APPS_SCRIPT_URL + '?action=get_staff')
    .then(function(r){ return r.json(); })
    .then(function(data){
      if(!data.ok || !Array.isArray(data.staff)){ csMsg('ub-msg-name','직원목록 조회 실패','err'); return; }
      var matches = data.staff.filter(function(s){ return s.name && s.name.indexOf(name) >= 0; });
      if(matches.length === 0){ csMsg('ub-msg-name','\'' + name + '\' 에 해당하는 직원 없음','err'); ubSetBox(''); ubFilled=null; return; }
      if(matches.length > 1){ csMsg('ub-msg-name','여러 명 매칭: ' + matches.map(function(m){return m.name}).join(', ') + ' — 정확한 이름 입력','err'); ubSetBox(''); ubFilled=null; return; }
      var me = matches[0];
      ubFilled = {
        name:    me.name,
        box:     ubFill('ub-tpl-box', me),
        report:  ubFill('ub-tpl-report', me),
        prepare: ubFill('ub-tpl-prepare', me),
        voice:   ubFill('ub-tpl-voice', me),
        tools:   ubFill('ub-tpl-tools', me),
        briefing: ubFill('ub-tpl-briefing', me),
        makebrief: ubFill('ub-tpl-makebrief', me)
      };
      ubSetBox(ubFilled.box);
      csMsg('ub-msg-name','생성 완료 (' + me.name + ' / ' + me.dept + ') — 박스 복사 + txt 6개 저장하세요','ok');
    })
    .catch(function(e){ csMsg('ub-msg-name','오류: ' + e.message,'err'); });
}
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape'){
    var ov=document.getElementById('ub-overlay');
    if(ov && ov.classList.contains('open')) closeUnifiedSetup();
  }
});
