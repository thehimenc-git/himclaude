// ── 상태 ──────────────────────
var profile=null,files=[],voiceOn=false,mediaRec=null,editMode=false;
var currentStructured=null;
var lastAIStructured=null; // AI 분석/재정리 직후 스냅샷 (JSON 문자열). 발송 시 dirty 감지용
var currentRawText='';
var _draftSaveTimer=null;  // main-input 디바운스 타이머
// 어제(직전 근무일) 본인 보고 전체 — [{raw, time, submitted_at, filename}]
var yesterdayItems=[];
var yesterdayDate='';
var yesterdayLoaded=false;  // false=아직 미조회, true=조회 완료(내용 유무 무관)
var yesterdayLoadError=null;  // null | 'retrying' | 'network' | 'timeout' | 'server'
// 오늘 이미 발송된 본인 보고 전체 (작성 중인 건은 currentRawText)
var todayItems=[];
var todayLoaded=false;
var todayLoadError=null;
// 2페이지 접기/펼치기 상태 — 어제는 기본 펼침, 오늘은 기본 접힘(작성 중만 보이도록)
var ydExpanded=true;
var tdExpanded=false;
// 1페이지 컨텍스트 카드 접기/펼치기 상태 — 어제 기본 펼침, 오늘(발송분) 기본 접힘
var ctxYdExpanded=true;
var ctxTdExpanded=false;
var now=new Date();
var days=['일','월','화','수','목','금','토'];
var dateStr=now.getFullYear()+'-'+p2(now.getMonth()+1)+'-'+p2(now.getDate());
var dateLabel=dateStr+'('+days[now.getDay()]+')';
function p2(n){return String(n).padStart(2,'0')}

// ── 초기화 ──────────────────────
(function(){ loadStaff(); })();

// 버전 bump 감지 → profile + session 클리어 (draft 는 그대로 유지)
function enforceAuthGen(){
  var saved;
  try{ saved=localStorage.getItem(AUTH_GEN_KEY); }catch(e){ saved=null; }
  if(String(saved)!==String(AUTH_RESET_GEN)){
    try{
      localStorage.removeItem('himclaude_v2');
      localStorage.removeItem(SESSION_KEY);
      localStorage.setItem(AUTH_GEN_KEY, String(AUTH_RESET_GEN));
    }catch(e){}
  }
}

function loadStaff(){
  enforceAuthGen();
  var list=document.getElementById('staff-list');
  list.innerHTML='<div style="text-align:center;padding:30px;color:var(--ink3);font-size:13px;">🌿 직원 목록 불러오는 중...</div>';
  fetch(APPS_SCRIPT_URL+'?action=get_staff')
    .then(function(r){return r.json()})
    .then(function(data){
      if(!data.ok)throw new Error(data.error||'오류');
      STAFF=data.staff;
      buildStaffList();
      // 복구 분기:
      //   profile + session 둘 다 → 바로 p1
      //   profile 있고 session 없음 → p0 email 단계 pre-select
      //   둘 다 없음 → p0 staff 단계 (기본)
      var saved=null;
      try{ var s=localStorage.getItem('himclaude_v2'); if(s) saved=JSON.parse(s); }catch(e){}
      if(saved){
        var found=STAFF.find(function(st){return st.email===saved.email});
        if(found){
          profile=found;
          if(getSession()){
            if (!initP1()) goPage('p1');
            return;
          }
          // 세션만 없음 → email 단계로
          p0ShowStage('email');
          return;
        }
      }
      p0ShowStage('staff');
    })
    .catch(function(){
      list.innerHTML=
        '<div style="text-align:center;padding:30px;color:var(--brush-rose);font-size:13px;">'+
        '직원 목록을 불러오지 못했습니다.<br>네트워크를 확인해주세요.<br><br>'+
        '<button onclick="loadStaff()" style="padding:8px 16px;border-radius:8px;border:1px solid var(--line);background:white;cursor:pointer;font-family:inherit">다시 시도</button>'+
        '</div>';
    });
}

var currentDept='all';
function selectDept(btn, dept){
  currentDept=dept;
  document.querySelectorAll('.dept-tab').forEach(function(t){t.classList.remove('active')});
  if(btn) btn.classList.add('active');
  buildStaffList();
}

function buildStaffList(){
  var ul=document.getElementById('staff-list');
  if(!ul)return;
  ul.innerHTML='';
  STAFF.forEach(function(s){
    if(currentDept!=='all' && s.dept!==currentDept) return;
    var d=document.createElement('div');
    d.className='staff-card';
    if(profile && profile.email===s.email) d.classList.add('on');
    d.innerHTML=
      '<div class="staff-initial">'+s.name.charAt(0)+'</div>'+
      '<div class="staff-info"><div class="sname">'+s.name+' '+s.role+'</div>'+
      '<div class="sdept">'+s.dept+'</div></div>';
    d.onclick=function(){
      document.querySelectorAll('.staff-card').forEach(function(c){c.classList.remove('on')});
      d.classList.add('on');profile=s;
      updateStaffNextBtn();
    };
    ul.appendChild(d);
  });
  updateStaffNextBtn();
}

function updateStaffNextBtn(){
  var btn=document.getElementById('p0-btn-next-staff');
  if(btn) btn.disabled = !profile;
}

// ── p0 3단계 전환 ──────────────────────
var p0OtpAttempts = 0;

function p0ShowStage(name){
  var staff=document.getElementById('p0-stage-staff');
  var email=document.getElementById('p0-stage-email');
  var code =document.getElementById('p0-stage-code');
  if(!staff||!email||!code)return;
  staff.style.display=(name==='staff')?'':'none';
  email.style.display=(name==='email')?'':'none';
  code .style.display=(name==='code') ?'':'none';
  if(name==='email') renderPickedStaffCard();
  if(name==='code'){
    p0OtpAttempts=0;
    p0ResetCodeBoxes();
  }
  window.scrollTo(0,0);
}

// 6개 박스 전체 클리어 + 활성화 + feedback 제거 + 첫 칸 포커스
function p0ResetCodeBoxes(){
  for(var i=0;i<6;i++){
    var el=document.getElementById('p0-digit-'+i);
    if(el){ el.value=''; el.disabled=false; }
  }
  p0HideOtpFeedback();
  setTimeout(function(){
    var first=document.getElementById('p0-digit-0');
    if(first) first.focus();
  },40);
}

function p0LockCodeBoxes(){
  for(var i=0;i<6;i++){
    var el=document.getElementById('p0-digit-'+i);
    if(el) el.disabled=true;
  }
}

function p0GetEnteredCode(){
  var code='';
  for(var i=0;i<6;i++){
    var el=document.getElementById('p0-digit-'+i);
    code += el ? (el.value||'').replace(/\D/g,'') : '';
  }
  return code;
}

function p0SetOtpFeedback(msg, kind){
  var fb=document.getElementById('p0-otp-feedback');
  if(!fb) return;
  fb.textContent=msg;
  fb.className='otp-feedback'+(kind==='lock'?' lock':'');
  fb.style.display='';
}
function p0HideOtpFeedback(){
  var fb=document.getElementById('p0-otp-feedback');
  if(!fb) return;
  fb.style.display='none';
  fb.textContent='';
}

// 숫자 입력 — 자동 포커스 이동 + 6자리 완성 시 자동 검증
// (붙여넣기는 p0HandlePaste 에서 처리. maxlength="1" 때문에 oninput 로는 1자만 들어옴.)
function p0HandleDigitInput(ev, idx){
  var el=ev.target;
  var v=(el.value||'').replace(/\D/g,'');
  el.value=v;
  if(v && idx<5){
    var next=document.getElementById('p0-digit-'+(idx+1));
    if(next) next.focus();
  }
  p0HideOtpFeedback();
  if(p0GetEnteredCode().length===6){
    p0AutoVerifyOtp();
  }
}

// 붙여넣기 — 클립보드 데이터를 직접 읽어 여러 칸에 분산 (maxlength 우회)
function p0HandlePaste(ev, idx){
  ev.preventDefault();
  var cb=ev.clipboardData||window.clipboardData;
  if(!cb)return;
  var txt=cb.getData('text')||'';
  var digits=txt.replace(/\D/g,'').substring(0, 6-idx).split('');
  if(digits.length===0)return;
  for(var i=0;i<digits.length;i++){
    var box=document.getElementById('p0-digit-'+(idx+i));
    if(box) box.value=digits[i];
  }
  var focusIdx=Math.min(idx+digits.length, 5);
  var focusEl=document.getElementById('p0-digit-'+focusIdx);
  if(focusEl) focusEl.focus();
  p0HideOtpFeedback();
  if(p0GetEnteredCode().length===6){
    p0AutoVerifyOtp();
  }
}

// 빈 칸에서 Backspace → 이전 칸으로 포커스 + 이전 칸 값 제거
function p0HandleDigitKeydown(ev, idx){
  if(ev.key==='Backspace' && !ev.target.value && idx>0){
    var prev=document.getElementById('p0-digit-'+(idx-1));
    if(prev){
      prev.focus();
      prev.value='';
      ev.preventDefault();
    }
  }
}

// 6자리 자동 검증 — 성공 시 p1 진입 / 실패 시 attempt++ / 5회 초과 시 잠금
function p0AutoVerifyOtp(){
  if(!profile||!profile.email){p0ShowStage('staff');return;}
  var code=p0GetEnteredCode();
  if(code.length!==6) return;
  // 중복 호출 방지
  p0LockCodeBoxes();
  fetch(APPS_SCRIPT_URL+'?action=otp_verify&email='+encodeURIComponent(profile.email)+'&code='+encodeURIComponent(code))
    .then(function(r){return r.json()})
    .then(function(d){
      if(d.ok){
        try{
          localStorage.setItem('himclaude_v2',JSON.stringify(profile));
          localStorage.setItem(SESSION_KEY, d.session);
          localStorage.setItem(AUTH_GEN_KEY, String(AUTH_RESET_GEN));
        }catch(e){}
        toast('✅ 인증 완료');
        if (!initP1()) goPage('p1');
        return;
      }
      p0OtpAttempts++;
      if(p0OtpAttempts>=5){
        p0SetOtpFeedback('5회 입력에 실패했습니다. 재발송 버튼으로 인증코드를 다시 보내주세요','lock');
        p0LockCodeBoxes();
      } else {
        p0SetOtpFeedback('인증코드가 틀렸습니다. 다시 확인해주세요');
        // 박스 클리어 + 재활성화 + 첫 칸 포커스
        for(var i=0;i<6;i++){
          var el=document.getElementById('p0-digit-'+i);
          if(el){ el.value=''; el.disabled=false; }
        }
        setTimeout(function(){
          var first=document.getElementById('p0-digit-0');
          if(first) first.focus();
        },40);
      }
    })
    .catch(function(){
      // 네트워크 오류 — 재시도 가능하도록 박스만 재활성화 (값 유지)
      for(var i=0;i<6;i++){
        var el=document.getElementById('p0-digit-'+i);
        if(el) el.disabled=false;
      }
      toast('⚠️ 네트워크 오류');
    });
}

// OTP 재발송 — attempts 리셋 + 박스 재활성화
function p0ResendOtp(){
  if(!profile||!profile.email){p0ShowStage('staff');return;}
  toast('📧 인증코드 재발송 중...');
  fetch(APPS_SCRIPT_URL+'?action=otp_request&email='+encodeURIComponent(profile.email))
    .then(function(r){return r.json()})
    .then(function(d){
      if(!d.ok){toast('⚠️ '+(d.error||'오류'));return;}
      p0OtpAttempts=0;
      p0ResetCodeBoxes();
      toast('✅ 새 인증코드가 발송되었습니다');
    })
    .catch(function(){toast('⚠️ 네트워크 오류');});
}

function renderPickedStaffCard(){
  if(!profile)return;
  var card=document.getElementById('p0-picked-card');
  if(!card)return;
  card.innerHTML=
    '<div class="staff-initial">'+escapeHtml(profile.name.charAt(0))+'</div>'+
    '<div class="staff-info">'+
      '<div class="sname">'+escapeHtml(profile.name)+' '+escapeHtml(profile.role||'')+'</div>'+
      '<div class="sdept">'+escapeHtml(profile.email||'')+'</div>'+
    '</div>';
}

function completeSetupToOtp(){
  if(!profile){toast('본인을 선택해주세요');return;}
  p0ShowStage('email');
}

function p0BackToStaff(){
  profile=null;
  document.querySelectorAll('.staff-card').forEach(function(c){c.classList.remove('on')});
  p0ShowStage('staff');
  updateStaffNextBtn();
}

function p0RequestOtp(){
  if(!profile||!profile.email){toast('이메일 정보가 없습니다'); p0ShowStage('staff'); return;}
  toast('📧 인증코드 발송 중...');
  fetch(APPS_SCRIPT_URL+'?action=otp_request&email='+encodeURIComponent(profile.email))
    .then(function(r){return r.json()})
    .then(function(d){
      if(!d.ok){toast('⚠️ '+(d.error||'오류')); return;}
      var echo=document.getElementById('p0-code-email-echo');
      if(echo) echo.textContent=profile.email;
      p0ShowStage('code');
    })
    .catch(function(){toast('⚠️ 네트워크 오류');});
}

// 세션이 서버 측에서 무효화된 경우 — profile 은 유지, 세션만 날리고 email 단계로
function forceReauth(reason){
  try{ localStorage.removeItem(SESSION_KEY); }catch(e){}
  if(reason) toast(reason);
  // p1 상태 잔존 요소 정리
  hideDraftBanner();
  goPage('p0');
  // profile 존재하면 email 단계, 없으면 staff 단계
  if(profile) p0ShowStage('email'); else p0ShowStage('staff');
}

