// ━━ 텔레그램 외부브리핑 탭 (2026-08-25 실서버 이관 — 테스트웹 검증본, 김려원 최종) ━━
//   서버 짝: TelegramBrief.js (tg_candidates/select/send/set_text/gen_draft/history/recipients)
//   열람·발송권은 서버 TG_SELECTORS 가 판정 — 비권한자는 카드에 안내만 표시

// ── 외부브리핑 선정 (텔레그램, 2026-08-10) — 부서장 전용 카드 ─────────
//   서버(tg_candidates)가 권한을 판정 — 선정자가 아니면 카드 숨김 유지.
//   체크 상태는 '외부브리핑 선정' 장부에 저장돼 다음 주에도 이월.
function loadTgSelection(){
  if(!profile)return;
  fetch(APPS_SCRIPT_URL+'?action=tg_candidates&name='+encodeURIComponent(profile.name))
    .then(function(r){return r.json()})
    .then(function(res){
      var body=document.getElementById('ctx-tgsel-body');if(!body)return;
      if(res&&res.reason==='not_selector'){
        body.innerHTML='<div class="ctx-row ctx-empty">부서장(강중구·최락현) 전용 화면입니다.</div>';
        return;
      }
      if(!res||!res.ok||!res.items||!res.items.length){
        body.innerHTML='<div class="ctx-row ctx-empty">'+escapeHtml((res&&res.error)||'불러올 업무건이 없습니다.')+'</div>';
        return;
      }
      renderTgSelection(res);
    })
    .catch(function(){});
}
// 발송 이력 (텔레그램 탭 하단 카드)
function loadTgHistory(){
  if(!profile)return;
  fetch(APPS_SCRIPT_URL+'?action=tg_history&name='+encodeURIComponent(profile.name))
    .then(function(r){return r.json()})
    .then(function(res){
      var body=document.getElementById('ctx-tghist-body');if(!body)return;
      if(!res||!res.ok||!res.history||!res.history.length){
        body.innerHTML='<div class="ctx-row ctx-empty">아직 발송 이력이 없습니다.</div>';
        return;
      }
      var html='';
      res.history.forEach(function(h){
        html+='<div style="padding:6px 4px;border-bottom:1px dashed rgba(0,0,0,.06)">'+
          '<b>'+escapeHtml(h.at)+'</b> · '+escapeHtml(h.by)+' · '+h.picked+'건'+
          (h.mode==='미리보기'?' <span style="color:#b09a80;font-size:11.5px">(미리보기 — 실발송 없음)</span>':' <span style="color:#3d5a3d;font-size:11.5px">(→ '+escapeHtml(h.recipients||h.sent+'명')+')</span>')+
          (h.pjs?'<br><span style="color:#8a7a63;font-size:12px">'+escapeHtml(h.pjs)+'</span>':'')+
          '</div>';
      });
      body.innerHTML=html;
    })
    .catch(function(){});
}
// 업무보고 탭 요약 카드 — 부서장에게만 표시, 누르면 텔레그램 탭으로
function loadTgStatus(){
  if(!profile)return;
  fetch(APPS_SCRIPT_URL+'?action=tg_history&name='+encodeURIComponent(profile.name))
    .then(function(r){return r.json()})
    .then(function(res){
      var card=document.getElementById('ctx-tgstat');if(!card)return;
      if(!res||!res.ok||!res.is_selector){card.style.display='none';return;}
      card.style.display='';
      var body=document.getElementById('ctx-tgstat-body');if(!body)return;
      var last=(res.history&&res.history.length)?res.history[0]:null;
      body.innerHTML='<div class="ctx-row" style="cursor:pointer" onclick="switchMode(\'telegram\')">'+
        '현재 선정 <b>'+(res.selected_count||0)+'건</b>'+
        (last?' · 최근: '+escapeHtml(last.at)+' '+escapeHtml(last.by)+' '+last.picked+'건'+(last.mode==='미리보기'?' (미리보기)':''):' · 발송 이력 없음')+
        ' <span style="color:#2A9DD6">→ 텔레그램 탭에서 관리</span></div>';
    })
    .catch(function(){});
}
var TGSEL_ITEMS=[];   // 문안 수정칸이 참조 (2026-08-12)
var TG_ROW_CHECKED_BG='rgba(143,175,138,.16)';   // [2026-08-24] 체크된 줄 배경색 — 앱 기존 그린 톤에 맞춤
function renderTgSelection(res){
  var body=document.getElementById('ctx-tgsel-body');if(!body)return;
  TGSEL_ITEMS=res.items||[];
  var head=document.querySelector('#ctx-tgsel .ctx-head span');
  if(head)head.textContent='외부브리핑 선정 (텔레그램) — '+res.date+' 기준 '+res.count+'건';
  var html='<div style="font-size:12.5px;color:#8a7a63;margin-bottom:8px">보낼 건을 체크하고 [보내기]를 누르면 등록된 수신자 전원에게 발송됩니다. <b>직전에 보낸 건은 미리 체크</b>돼 있으니 이번에 보낼 것만 다시 고르세요. [✏️ 문안]으로 발송 문구를 직접 고칠 수 있어요.<br>현안에 <b>“긴급”</b>이라고 적으면 목록·발송문 <b>맨 위에 🚨로 강조</b>됩니다. 문안이 없는 건은 보낼 때 AI가 <b>문제·결정사항·담당부서</b> 기준으로 초안을 만들어 저장합니다.</div>';
  html+='<div style="position:relative;margin-bottom:8px">'+
    '<input type="text" id="tgsel-search" placeholder="🔍 프로젝트 이름 검색" autocomplete="off" '+
    'style="width:100%;box-sizing:border-box;padding:8px 28px 8px 10px;font-size:13px;border:1px solid rgba(0,0,0,.15);border-radius:8px;font-family:inherit" '+
    'oninput="tgFilterItems()">'+
    '<span id="tgsel-search-clear" onclick="tgClearSearch()" style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;color:#a99a86;font-size:14px;line-height:1;padding:2px 4px;user-select:none">✕</span>'+
    '</div>'+
    '<div style="font-size:11px;color:#a99a86;margin:-4px 0 8px">검색창을 클릭하시면 프로젝트명을 검색하실 수 있습니다.</div>';
  html+='<div style="margin-bottom:8px;display:flex;gap:6px;align-items:center">'+
    '<button type="button" class="calx-mini" onclick="tgSelectAll(true)">전체 선택</button>'+
    '<button type="button" class="calx-mini" onclick="tgSelectAll(false)">전체 해제</button>'+
    '<span id="tgsel-count" style="font-size:12px;color:#C4907A;font-weight:600;margin-left:auto"></span>'+
    '</div>';
  // [2026-09-07] 두 구역: 이전에 보낸 건(마지막 발송일 내림차순) 위 / 아직 안 보낸 건 아래. TGSEL_ITEMS 순서도 이에 맞춤(행 index 일치)
  // [2026-09-08] 세 구역: 🚨 긴급(현안에 '긴급') 맨 위 → 이전에 보낸 건 → 아직 안 보낸 건
  var urgentItems=(res.items||[]).filter(function(it){return !!it.urgent;});
  var sentItems=(res.items||[]).filter(function(it){return !it.urgent && !!it.last_sent;}).sort(function(a,b){return String(b.last_sent||'').localeCompare(String(a.last_sent||''));});
  var newItems=(res.items||[]).filter(function(it){return !it.urgent && !it.last_sent;});
  TGSEL_ITEMS=urgentItems.concat(sentItems).concat(newItems);
  var secHtml=function(t,color){return '<div class="tgsel-sec" style="margin:10px 0 4px;padding:4px 6px;font-weight:700;color:'+(color||'#4a5d4b')+';font-size:12.5px;border-left:3px solid '+(color||'#8faf8a')+'">'+t+'</div>';};
  if(urgentItems.length) html+=secHtml('🚨 긴급 '+urgentItems.length+'건 — 발송문 맨 위에 굵게 표시','#c05a5a');
  TGSEL_ITEMS.forEach(function(it,i){
    if(sentItems.length && i===urgentItems.length) html+=secHtml('📤 이전에 보낸 건 '+sentItems.length+'건 — 직전 발송분은 미리 체크됨');
    if(i===urgentItems.length+sentItems.length) html+=secHtml('🆕 아직 안 보낸 건 '+newItems.length+'건');
    // [2026-08-24] 체크박스 중앙 = 이름줄 중앙: 체크박스+이름(+배지)+문안버튼만 별도 flex줄로 묶어
    //   align-items:center 로 중앙정렬(폰트 leading 배분에 안 흔들리는 방식).
    //   문안 줄 들여쓰기 = 체크박스 폭(16px)만큼 투명한 여백을 앞에 똑같이 둬서, 값을 감으로 안 정하고
    //   항상 이름 시작 위치와 정확히 일치하게 함. 이름↔문안, 문안↔발송기록 줄간격은 6px로 통일(_tgDetailHtml_).
    var detail=_tgDetailHtml_(it);
    // [2026-08-24] 체크된 줄은 배경색으로 강조(TG_ROW_CHECKED_BG) — 초기 렌더 시 it.selected 기준으로 미리 칠해둠
    html+='<div id="tgsel-row-'+i+'" style="padding:6px 4px;border-bottom:1px dashed rgba(0,0,0,.06);border-radius:8px;background:'+(it.selected?TG_ROW_CHECKED_BG:'transparent')+'">'+
      '<div style="display:flex;align-items:center;gap:8px">'+
      '<input type="checkbox" class="tgsel-chk" data-pj="'+escapeHtml(it.pj)+'"'+(it.selected?' checked':'')+' style="flex:none;width:16px" onchange="tgUpdateSelCount();tgUpdateRowHighlight(this)">'+
      '<span class="tgsel-name" style="flex:1;cursor:pointer" onclick="var c=this.parentNode.querySelector(\x27input\x27);c.checked=!c.checked;tgUpdateSelCount();tgUpdateRowHighlight(c)"><b>'+escapeHtml(it.pj)+'</b>'+
      (it.urgent?' <span style="font-size:10.5px;background:#fce4e4;color:#c62828;border-radius:4px;padding:1px 5px;white-space:nowrap;display:inline-block;font-weight:700">🚨 긴급</span>':'')+
      (it.custom_text?' <span style="font-size:10.5px;background:#e4ebf7;color:#2A6DA6;border-radius:4px;padding:1px 5px;white-space:nowrap;display:inline-block">'+(it.auto_draft?'🤖 AI 초안':'✏️ 수정된 문안')+'</span>':'')+
      (it.last_sent?' <span style="font-size:10.5px;background:#e9f1e6;color:#4a5d4b;border-radius:4px;padding:1px 5px;white-space:nowrap;display:inline-block">📤 '+escapeHtml(String(it.last_sent).slice(5,10).replace('-','/'))+' 발송'+(it.in_last_send?' · 직전':'')+'</span>':'')+
      '</span>'+
      '<button type="button" class="calx-mini" style="flex:none" onclick="tgEditText('+i+')">✏️ 문안</button>'+
      '</div>'+
      '<div class="tgsel-detail" style="display:'+(detail?'flex':'none')+';gap:8px;margin-top:6px">'+
      '<span style="flex:none;width:16px"></span>'+
      '<span class="tgsel-detail-text" style="flex:1;color:#8a7a63;font-size:12px">'+detail+'</span>'+
      '</div>'+
      '</div>';
  });
  html+='<div id="tgsel-empty" class="ctx-row ctx-empty" style="display:none;margin:6px 4px">검색 결과가 없습니다.</div>';
  html+='<div id="tgsel-editor" style="display:none;margin-top:10px;padding:10px;border:1px solid rgba(42,157,214,.4);border-radius:8px;background:rgba(42,157,214,.05)">'+
    '<div style="font-weight:600;margin-bottom:6px" id="tgsel-editor-title"></div>'+
    '<textarea id="tgsel-editor-text" style="width:100%;min-height:110px;box-sizing:border-box;font-size:13px;padding:8px;border:1px solid rgba(0,0,0,.15);border-radius:6px" placeholder="현안 :\n1) 문제 또는 결정 필요 사항\n2) …\n주관부서 : 기관·담당자\n\n※ 어딘가에 “긴급”이라고 적으면 맨 위에 🚨로 올라갑니다"></textarea>'+
    '<div id="tgsel-editor-hint" style="font-size:11.5px;color:#8a7a63;margin-top:4px">받는 사람이 알아야 할 것만: 무슨 문제인지 · 뭘 결정해야 하는지 · 어느 부서가 도와줘야 하는지. 진행 나열은 빼주세요.</div>'+
    '<div style="margin-top:6px;text-align:right;display:flex;gap:6px;justify-content:flex-end">'+
    '<button type="button" class="calx-mini" id="tgsel-draft-btn" style="margin-right:auto" onclick="tgGenDraft()">🤖 AI 초안 (문제·결정·담당부서)</button>'+
    '<button type="button" class="calx-mini" onclick="document.getElementById(\x27tgsel-editor\x27).style.display=\x27none\x27">닫기</button>'+
    '<button type="button" class="calx-mini" style="color:#c05a5a" onclick="saveTgText(true)">자동 문안으로 원복</button>'+
    '<button type="button" class="calx-mini" style="background:#3d5a3d;color:#fff;border-radius:6px;padding:4px 12px" onclick="saveTgText(false)">문안 저장</button>'+
    '</div></div>';
  html+='<div style="margin:10px 0;display:flex;gap:6px;align-items:center">'+   // [2026-08-21] 목록 바로 밑 · 받는사람 위로 이동
    '<button type="button" class="calx-mini" onclick="tgSelectAll(true)">전체 선택</button>'+
    '<button type="button" class="calx-mini" onclick="tgSelectAll(false)">전체 해제</button>'+
    '<span id="tgsel-count2" style="font-size:12px;color:#C4907A;font-weight:600;margin-left:auto"></span>'+
    '</div>';
  html+='<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(0,0,0,.08)">'+
    '<div style="font-weight:600;margin-bottom:6px">👤 받는 사람 <span style="font-weight:400;color:#8a7a63;font-size:12px">(같은 건을 나중에 다른 사람에게 또 보낼 수 있어요)</span></div>'+
    '<div id="tgsel-recips" style="display:flex;flex-wrap:wrap;gap:6px"><span style="color:#a99a86;font-size:12.5px">수신자 목록 불러오는 중...</span></div></div>';
  html+='<div style="margin-top:10px;display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap">'+
    '<button type="button" id="tgsel-send" onclick="sendTgSelection()" style="padding:7px 16px;font-size:13px;border:1px solid rgba(0,0,0,.15);border-radius:8px;background:#3d5a3d;color:#fff;cursor:pointer">📨 체크한 건 보내기</button>'+
    '</div>';
  html+='<pre id="tgsel-preview" style="display:none;margin-top:10px;padding:10px;background:rgba(0,0,0,.04);border-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-all"></pre>';
  body.innerHTML=html;
  tgUpdateSelCount();
  loadTgRecipients();
}
// [2026-08-24] 검색어(띄어쓰기 무시) 비교용 — GAS 쪽 _tgNormName_ 과 동일한 규칙을 화면(JS)에서도 적용
function _tgSearchNorm_(s){
  return String(s||'').replace(/\s+/g,'').toLowerCase();
}
// [2026-08-24] 문안(note)·발송기록(by) 줄 HTML 조립 — renderTgSelection·refreshTgTextsOnly 공용.
//   둘 다 있으면 사이에 margin-top:6px 로 줄간격을 둠(이름↔문안 간격 6px와 통일).
function _tgDetailHtml_(it){
  var shown=it.custom_text||it.note;
  var parts=[];
  if(shown) parts.push('<span style="white-space:pre-line;line-height:17px;display:inline-block">'+escapeHtml(shown)+'</span>');
  if(it.selected&&it.by) parts.push('<span style="color:#b09a80;font-size:11px">✔ '+escapeHtml(it.by)+' · '+escapeHtml(it.at)+'</span>');
  return parts.map(function(p,idx){ return idx===0?p:'<div style="margin-top:6px">'+p+'</div>'; }).join('');
}
// [2026-08-24] 검색창에 입력한 글자로 목록을 걸러 보여줌 — 행을 다시 그리지 않고 안 맞는 것만 숨김(display:none)
//   그래서 체크 상태·문안 수정창은 그대로 유지됨. 포커스가 빠져도 필터 유지, 검색어를 지워야 전체 목록으로 복귀.
function tgFilterItems(){
  var searchEl=document.getElementById('tgsel-search');
  var q=_tgSearchNorm_(searchEl?searchEl.value:'');
  var anyVisible=false;
  TGSEL_ITEMS.forEach(function(it,i){
    var row=document.getElementById('tgsel-row-'+i); if(!row) return;
    var match=!q || _tgSearchNorm_(it.pj).indexOf(q)>=0;
    row.style.display=match?'':'none';
    if(match) anyVisible=true;
  });
  var emptyEl=document.getElementById('tgsel-empty');
  if(emptyEl) emptyEl.style.display=(q&&!anyVisible)?'':'none';
  var clearEl=document.getElementById('tgsel-search-clear');
  if(clearEl) clearEl.style.display=(searchEl&&searchEl.value)?'':'none';
}
// [2026-08-24] 검색창 옆 X 버튼 — 검색어 비우고 목록 원복 + 검색창 포커스 유지
function tgClearSearch(){
  var searchEl=document.getElementById('tgsel-search'); if(!searchEl) return;
  searchEl.value='';
  tgFilterItems();
  searchEl.focus();
}
// [2026-08-24] 체크박스가 속한 줄을 찾아 배경색을 켜고/끔 — 체크박스 클릭·라벨 클릭·전체선택 세 경로에서 공용으로 사용
function tgUpdateRowHighlight(chk){
  var row=chk&&chk.closest?chk.closest('[id^="tgsel-row-"]'):null;
  if(!row) return;
  row.style.background=chk.checked?TG_ROW_CHECKED_BG:'transparent';
}
// [2026-08-21] 전체 선택/해제 — [2026-08-24] 검색으로 걸러진 상태면 "보이는 것만" 대상,
//   검색 안 했거나 아무것도 안 걸러졌으면 보이는 게 전부이므로 자연히 "전체"와 동일 (별도 분기 불필요)
function tgSelectAll(all){
  TGSEL_ITEMS.forEach(function(it,i){
    var row=document.getElementById('tgsel-row-'+i); if(!row||row.style.display==='none') return;
    var chk=row.querySelector('input.tgsel-chk');
    if(chk){ chk.checked=all; tgUpdateRowHighlight(chk); }
  });
  tgUpdateSelCount();
}
function tgUpdateSelCount(){
  var body=document.getElementById('ctx-tgsel-body'); if(!body) return;
  var n=body.querySelectorAll('input.tgsel-chk:checked').length;
  var txt=n+'건 선택됨';
  var cnt=document.getElementById('tgsel-count'); if(cnt) cnt.textContent=txt;
  var cnt2=document.getElementById('tgsel-count2'); if(cnt2) cnt2.textContent=txt;   // [2026-08-21] 목록 길 때 하단(보내기 버튼 옆)에도 동일 표시
}
// 문안 수정칸 (2026-08-12) — 건별 발송 문구를 부서장이 직접 수정, 저장 시 다음 발송부터 적용·이월
var TGSEL_EDIT_PJ='';
function tgEditText(i){
  var it=TGSEL_ITEMS[i];if(!it)return;
  TGSEL_EDIT_PJ=it.pj;
  var box=document.getElementById('tgsel-editor');if(!box)return;
  var row=document.getElementById('tgsel-row-'+i);   // [2026-08-20] 해당 프로젝트 줄 바로 밑으로 문안창 이동
  if(row&&row.parentNode)row.parentNode.insertBefore(box,row.nextSibling);
  var title=document.getElementById('tgsel-editor-title');
  if(title)title.textContent='✏️ 발송 문안 — '+it.pj;
  var ta=document.getElementById('tgsel-editor-text');
  if(ta)ta.value=it.custom_text||'';   // [2026-09-08] 장부 현안만. 브리핑 비고(진행 나열)는 기본값에서 제외 — 필요하면 [AI 초안]
  box.style.display='';
  box.scrollIntoView({behavior:'smooth',block:'center'});
}
// [2026-09-08] AI 초안 — 새 기준(문제·결정사항·담당부서)으로 현안 초안을 받아 편집칸에 채움 (저장은 [문안 저장]으로)
function tgGenDraft(){
  if(!TGSEL_EDIT_PJ||!profile){alert('수정할 항목을 먼저 열어주세요.');return;}
  var btn=document.getElementById('tgsel-draft-btn');
  if(btn){btn.disabled=true;btn.textContent='초안 만드는 중...';}
  fetch(APPS_SCRIPT_URL,{method:'POST',body:JSON.stringify({action:'tg_gen_draft',token:APPS_SCRIPT_TOKEN,name:profile.name,pj:TGSEL_EDIT_PJ})})
    .then(function(r){return r.json()})
    .then(function(res){
      if(btn){btn.disabled=false;btn.textContent='🤖 AI 초안 (문제·결정·담당부서)';}
      if(!res||!res.ok){alert('초안 실패: '+((res&&res.message)||'알 수 없는 오류'));return;}
      var ta=document.getElementById('tgsel-editor-text');
      if(ta){ta.value=res.issue||'';ta.focus();}
      toast('🤖 초안을 채웠습니다 — 확인·수정 후 [문안 저장]');
    })
    .catch(function(e){alert('통신 오류: '+e.message);if(btn){btn.disabled=false;btn.textContent='🤖 AI 초안 (문제·결정·담당부서)';}});
}
function saveTgText(reset){
  if(!TGSEL_EDIT_PJ){alert('수정할 항목이 선택되지 않았습니다. 다시 열어주세요.');return;}
  if(!profile){alert('로그인 정보가 없습니다. 새로고침 후 다시 로그인해주세요.');return;}   // [2026-08-20] 조용한 실패 방지 — profile 없을 때도 알림 표시
  var ta=document.getElementById('tgsel-editor-text');
  var text=reset?'':(ta?ta.value.trim():'');
  if(!reset&&!text){alert('문구를 입력하거나 [자동 문안으로 원복]을 눌러주세요.');return;}
  fetch(APPS_SCRIPT_URL,{method:'POST',body:JSON.stringify({action:'tg_set_text',token:APPS_SCRIPT_TOKEN,name:profile.name,pj:TGSEL_EDIT_PJ,text:text})})
    .then(function(r){return r.json()})
    .then(function(res){
      if(res&&res.ok){
        var box=document.getElementById('tgsel-editor');if(box)box.style.display='none';
        toast('✅ 문안이 저장되었습니다'+(res.urgent?' · 🚨 긴급으로 맨 위에 올라갑니다':''));
        var wasUrgent=false; for(var q=0;q<TGSEL_ITEMS.length;q++){ if(TGSEL_ITEMS[q].pj===TGSEL_EDIT_PJ){ wasUrgent=!!TGSEL_ITEMS[q].urgent; break; } }
        if(!!res.urgent!==wasUrgent) loadTgSelection();   // [2026-09-08] 긴급 여부가 바뀌면 구역이 달라지므로 목록 재구성
        else refreshTgTextsOnly();   // [2026-08-24] 문안만 갱신 — 검색·체크 상태 유지
      } else {
        alert('저장 실패: '+((res&&res.message)||'알 수 없는 오류'));
      }
    })
    .catch(function(e){alert('통신 오류: '+e.message);});
}
// [2026-08-24] 문안 저장 후 목록 전체를 다시 그리지 않고, 프로젝트 이름으로 매칭해 그 줄의
//   이름·문안·"수정된 문안" 배지만 갈아끼움 — 검색 필터·체크박스(아직 미발송 상태)를 그대로 보존하려는 목적.
//   체크 상태(selected)는 실제 발송 확정 전까진 서버에 저장되지 않으므로, 여기서 절대 덮어쓰지 않음.
function refreshTgTextsOnly(){
  if(!profile) return;
  fetch(APPS_SCRIPT_URL+'?action=tg_candidates&name='+encodeURIComponent(profile.name))
    .then(function(r){return r.json()})
    .then(function(res){
      if(!res||!res.ok||!res.items) return;
      res.items.forEach(function(it){
        var idx=-1;
        for(var i=0;i<TGSEL_ITEMS.length;i++){ if(TGSEL_ITEMS[i].pj===it.pj){ idx=i; break; } }
        if(idx<0) return;   // 그 사이 새로 나타난 프로젝트는 이번엔 반영 안 함(다음 재입장 때 자연히 보임)
        TGSEL_ITEMS[idx]=it;   // 문안 재조회용 데이터만 최신화 — 체크 상태는 여전히 DOM(checkbox)이 진짜 소스
        var row=document.getElementById('tgsel-row-'+idx); if(!row) return;
        var nameEl=row.querySelector('.tgsel-name');
        if(nameEl){
          nameEl.innerHTML='<b>'+escapeHtml(it.pj)+'</b>'+
            (it.urgent?' <span style="font-size:10.5px;background:#fce4e4;color:#c62828;border-radius:4px;padding:1px 5px;white-space:nowrap;display:inline-block;font-weight:700">🚨 긴급</span>':'')+
            (it.custom_text?' <span style="font-size:10.5px;background:#e4ebf7;color:#2A6DA6;border-radius:4px;padding:1px 5px;white-space:nowrap;display:inline-block">'+(it.auto_draft?'🤖 AI 초안':'✏️ 수정된 문안')+'</span>':'')+
            (it.last_sent?' <span style="font-size:10.5px;background:#e9f1e6;color:#4a5d4b;border-radius:4px;padding:1px 5px;white-space:nowrap;display:inline-block">📤 '+escapeHtml(String(it.last_sent).slice(5,10).replace('-','/'))+' 발송'+(it.in_last_send?' · 직전':'')+'</span>':'');
        }
        var detailEl=row.querySelector('.tgsel-detail');
        var detailTextEl=row.querySelector('.tgsel-detail-text');
        if(detailEl&&detailTextEl){
          var detail=_tgDetailHtml_(it);
          detailTextEl.innerHTML=detail;
          detailEl.style.display=detail?'flex':'none';
        }
      });
    })
    .catch(function(){});
}

// 받는 사람 목록 (등록된 수신자 → 체크박스 칩)
function loadTgRecipients(){
  if(!profile)return;
  fetch(APPS_SCRIPT_URL+'?action=tg_recipients&name='+encodeURIComponent(profile.name))
    .then(function(r){return r.json()})
    .then(function(res){
      var box=document.getElementById('tgsel-recips');if(!box)return;
      if(!res||!res.ok||!res.recipients||!res.recipients.length){
        box.innerHTML='<span style="color:#a99a86;font-size:12.5px">등록된 수신자가 없습니다 — 등록 전까지는 [보내기]가 미리보기로 동작해요.</span>';
        return;
      }
      // [2026-08-20] 체크박스 선택 → 읽기 전용 표시로 변경. 등록된 활성 수신자 전원에게 자동 발송됨.
      box.innerHTML='<div style="font-size:12.5px;color:#8a7a63;margin-bottom:4px;flex-basis:100%">아래 등록된 수신자 전원에게 자동 발송됩니다</div>'+
        res.recipients.map(function(r){
          return '<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border:1px solid rgba(0,0,0,.12);border-radius:16px;font-size:12.5px;background:'+(r.ready?'#fff':'#fdf3f3')+'">'+
            escapeHtml(r.name)+(r.memo?' <span style="color:#8a7a63">('+escapeHtml(r.memo)+')</span>':'')+
            (r.ready?'':' <span style="color:#c05a5a;font-size:11px">봇 미연결</span>')+
            '</span>';
        }).join('');
    })
    .catch(function(){});
}
// [2026-08-20] 1단계: 미리보기 요청 (즉시 발송 X). dry_run:true 로 서버에 문구·대상만 물어봄.
var TG_PENDING_ITEMS=null;
function sendTgSelection(){
  var body=document.getElementById('ctx-tgsel-body');if(!body||!profile)return;
  // [2026-08-24] 검색으로 화면에서 숨겨진(display:none) 행도 DOM에는 그대로 남아있어
  //   체크박스 상태를 그대로 읽어올 수 있음 — 검색 중이었어도 이전에 체크해둔 건 안 빠짐
  var items=Array.prototype.map.call(body.querySelectorAll('input.tgsel-chk'),function(c){
    return {pj:c.getAttribute('data-pj'),selected:c.checked};
  });
  var picked=items.filter(function(it){return it.selected;}).length;
  if(!picked){alert('보낼 건을 먼저 체크해주세요.');return;}
  TG_PENDING_ITEMS=items;
  var btn=document.getElementById('tgsel-send');
  if(btn){btn.disabled=true;btn.textContent='불러오는 중...';}
  fetch(APPS_SCRIPT_URL,{method:'POST',body:JSON.stringify({action:'tg_send',token:APPS_SCRIPT_TOKEN,name:profile.name,items:items,dry_run:true})})
    .then(function(r){return r.json()})
    .then(function(res){
      if(btn){btn.disabled=false;btn.textContent='📨 체크한 건 보내기';}
      if(!res||!res.ok){alert('미리보기 생성 실패: '+((res&&res.message)||'알 수 없는 오류'));return;}
      var tgt=document.getElementById('tg-preview-targets');
      if(tgt)tgt.textContent=((res.targets&&res.targets.length)
        ?('발송 대상: '+res.targets.join(', ')+' ('+res.targets.length+'명)')
        :'⚠️ 등록된 수신자가 없습니다 — 이대로 발송해도 실제 발송은 되지 않습니다')
        +((res.urgent&&res.urgent.length)?' · 🚨 긴급 '+res.urgent.length+'건 맨 위':'')
        +((res.auto_drafted&&res.auto_drafted.length)?' · 🤖 AI 초안 '+res.auto_drafted.length+'건(장부에 저장됨, 문안에서 수정 가능)':'');
      var pv=document.getElementById('tg-preview-text');
      if(pv)pv.textContent=res.preview||'';
      var dlg=document.getElementById('tg-preview-dlg');
      if(dlg)dlg.classList.add('on');
    })
    .catch(function(e){alert('통신 오류: '+e.message);if(btn){btn.disabled=false;btn.textContent='📨 체크한 건 보내기';}});
}
// [2026-08-20] 2단계: 미리보기 모달의 [이대로 발송] — 이때 비로소 실제 발송
function tgConfirmSend(){
  var dlg=document.getElementById('tg-preview-dlg');
  if(dlg)dlg.classList.remove('on');
  if(!TG_PENDING_ITEMS||!profile)return;
  fetch(APPS_SCRIPT_URL,{method:'POST',body:JSON.stringify({action:'tg_send',token:APPS_SCRIPT_TOKEN,name:profile.name,items:TG_PENDING_ITEMS})})
    .then(function(r){return r.json()})
    .then(function(res){
      if(res&&res.ok){
        if(res.sent>0){
          alert('✅ '+res.picked+'건 → '+((res.sent_to&&res.sent_to.length)?res.sent_to.join(', '):res.sent+'명')+' 발송 완료'+(res.fails&&res.fails.length?'\n실패: '+res.fails.join(', '):''));
        } else if(res.preview){
          var pv=document.getElementById('tgsel-preview');
          if(pv){pv.style.display='';pv.textContent='── 발송 미리보기 (등록된 수신자 없음 — 실제 발송 안 됨) ──\n\n'+res.preview;}
          alert('등록된 수신자가 없어 실제 발송 없이 미리보기만 표시했어요.\n(체크 상태는 저장됨)');
        }
        loadTgHistory();
        loadTgSelection();   // [2026-09-07] 발송 직후 목록 재구성(이전 발송 구역·직전 발송 체크 갱신)
      } else {
        alert('발송 실패: '+((res&&res.message)||'알 수 없는 오류'));
      }
    })
    .catch(function(e){alert('통신 오류: '+e.message);});
}
// [2026-08-20] 미리보기 모달의 [취소] — 모달만 닫힘, 체크·문안은 그대로 유지돼서 바로 수정 이어갈 수 있음
function tgCancelPreview(){
  var dlg=document.getElementById('tg-preview-dlg');
  if(dlg)dlg.classList.remove('on');
}

