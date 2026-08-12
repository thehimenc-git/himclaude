// ── 일일보고 음성 입력 — 상태 머신 (CLOVA STT) ──────────────────────
// "오늘 업무" 헤더 우측 🎤 → 패널 펼침 (권한 확보 + armed)
//   armed:      [● 녹음 시작]
//   recording:  [⏹ 정지 0:23]
//   recorded:   [▶ 재생][↻ 다시] / [✓ 텍스트로 변환]
//   closing:    [✓ 변환 후 닫기][🗑 폐기하고 닫기] / [취소]   ← recorded 에서 ✕ 누를 때 진입
//   converting: [⏳ 변환 중...]   (✕ 비활성)
// 변환 후 textarea append + armed 자동 복귀 (패널 유지) — 추가 녹음 가능
// Claude 후처리는 skip — 분석 단계에서 sonnet 이 정리하므로 STT 만으로 충분
var Voice = {
  state:'idle', stream:null, rec:null, mimeType:'', chunks:[],
  blob:null, blobUrl:null, audio:null, audioPlaying:false,
  startTs:0, durationMs:0, timerId:null, abortCtrl:null,
  closingPending:false   // recording 중 ✕ 클릭 시 onstop 으로 closing 진입
};

function _vmb(){return document.getElementById('voice-mini-btn');}
function _vmbIcon(){return document.getElementById('vmb-icon');}
function _vmbLabel(){return document.getElementById('vmb-label');}
function _voicePanel(){return document.getElementById('voice-panel');}
function _voiceBody(){return document.getElementById('vp-body');}
function _voiceCloseBtn(){return document.getElementById('vp-close');}
function _voiceTitleEl(){return document.getElementById('vp-title');}

function _formatVoiceElapsed(ms){
  var s=Math.floor(ms/1000), m=Math.floor(s/60), ss=s%60;
  return m+':'+(ss<10?'0':'')+ss;
}

// 권한 진단 — secure context 부재·권한 거부·장치 문제 등 환경별로 가이드 분기
function _voicePermDiagnose(err){
  var ua=navigator.userAgent || '';
  var isiOS=/iPhone|iPad|iPod/i.test(ua);
  var isAndroid=/Android/i.test(ua);
  var isEdge=/Edg\//i.test(ua);
  var isFirefox=/Firefox|FxiOS/i.test(ua);
  var isSafari=/Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/i.test(ua);

  // 1) 보안 컨텍스트 부재 — file:// 또는 http:// (모바일에서 가장 흔한 막힘)
  if (!window.isSecureContext || location.protocol==='file:'){
    var httpsUrl='https://thehimenc-git.github.io/himclaude/힘클로드_v1.html';
    return [
      '<b>📢 HTTPS 환경이 필요합니다</b>','',
      '현재 페이지를 <code>'+location.protocol+'</code> 로 열고 계셔서 모바일 브라우저가 마이크 사용을 거부합니다.','',
      '<b>해결</b> — 아래 URL 로 다시 접속해 주세요',
      '<small style="word-break:break-all;display:inline-block;margin-top:4px">'+httpsUrl+'</small>'
    ].join('<br>');
  }

  // 2) 권한 거부
  var name = err ? (err.name || '') : '';
  var msg  = err ? String(err.message || '') : '';
  if (name==='NotAllowedError' || name==='SecurityError' || /permission|denied/i.test(msg)){
    var lines=['<b>🔒 마이크 권한이 차단되어 있어요</b>',''];
    if (isiOS){
      lines.push('<b>iPhone / iPad Safari</b>');
      lines.push('1. 주소창 좌측의 <b>aA</b> 아이콘 탭');
      lines.push('2. <b>웹사이트 설정</b> → <b>마이크</b> → <b>허용</b>');
      lines.push('3. 페이지 새로고침 후 다시 시도');
      lines.push('');
      lines.push('<small>또는 <b>설정 앱 → Safari → 카메라 및 마이크</b></small>');
    } else if (isAndroid){
      lines.push('<b>Android Chrome</b>');
      lines.push('1. 주소창 좌측 🔒 (또는 ⓘ) 아이콘 탭');
      lines.push('2. <b>권한</b> → <b>마이크</b> → <b>허용</b>');
      lines.push('3. 페이지 새로고침 후 다시 시도');
      lines.push('');
      lines.push('<small>또는 <b>설정 → 앱 → Chrome → 권한 → 마이크</b></small>');
    } else if (isSafari){
      lines.push('<b>Mac Safari</b>');
      lines.push('1. 메뉴바 <b>Safari → 환경설정 (⌘,)</b>');
      lines.push('2. <b>웹사이트</b> 탭 → 좌측 <b>마이크</b>');
      lines.push('3. 현재 사이트를 <b>허용</b> 으로 변경');
      lines.push('4. 페이지 새로고침');
    } else if (isFirefox){
      lines.push('<b>Firefox</b>');
      lines.push('1. 주소창 좌측 🛡 또는 🎤 아이콘 클릭');
      lines.push('2. 차단된 권한 표시 → <b>차단 해제</b>');
      lines.push('3. 페이지 새로고침 후 다시 시도');
    } else {
      lines.push('<b>PC Chrome / Edge</b>');
      lines.push('1. 주소창 좌측 🔒 자물쇠 아이콘 클릭');
      lines.push('2. <b>마이크</b> 항목을 <b>허용</b> 으로 변경');
      lines.push('3. 페이지 새로고침 후 다시 시도');
    }
    return lines.join('<br>');
  }

  // 3) 장치 없음
  if (name==='NotFoundError' || name==='OverconstrainedError'){
    return '<b>🎙️ 마이크 장치를 찾을 수 없어요</b><br><br>외장 마이크가 있다면 다시 꽂아보세요. 노트북 내장 마이크가 비활성화돼 있는지 확인해 주세요.';
  }
  // 4) 다른 앱 점유
  if (name==='NotReadableError' || name==='AbortError'){
    return '<b>🎙️ 마이크가 다른 앱에서 사용 중이에요</b><br><br>Zoom·Teams·Discord·통화 등 다른 앱을 종료하고 다시 시도해 주세요.';
  }
  // 5) MediaRecorder 미지원
  if (typeof MediaRecorder==='undefined'){
    return '<b>이 브라우저는 마이크 녹음을 지원하지 않습니다</b><br><br>최신 Chrome·Safari·Firefox 또는 Edge 에서 시도해 주세요.';
  }
  return '<b>마이크 사용 중 오류가 발생했어요</b><br><br><small>'+(msg || name || '알 수 없는 오류')+'</small>';
}

function _showVoicePermModal(html){
  var m=document.getElementById('voice-perm-modal');
  if(!m){
    m=document.createElement('div');
    m.id='voice-perm-modal';
    m.className='voice-perm-modal';
    m.innerHTML='<div class="vpm-backdrop"></div>'+
      '<div class="vpm-card" role="dialog" aria-modal="true">'+
        '<div class="vpm-title">🎤 마이크 권한 안내</div>'+
        '<div class="vpm-body" id="vpm-body"></div>'+
        '<button type="button" class="vpm-close" id="vpm-close-btn">확인</button>'+
      '</div>';
    document.body.appendChild(m);
    m.querySelector('.vpm-backdrop').addEventListener('click',_closeVoicePermModal);
    m.querySelector('#vpm-close-btn').addEventListener('click',_closeVoicePermModal);
  }
  document.getElementById('vpm-body').innerHTML=html;
  m.classList.add('show');
}
function _closeVoicePermModal(){
  var m=document.getElementById('voice-perm-modal');
  if(m) m.classList.remove('show');
}

// ── 패널 토글 (마이크 버튼 진입점) ──
function toggleVoicePanel(){
  if (Voice.state==='idle') openVoicePanel();
  else requestCloseVoicePanel();
}

function openVoicePanel(){
  // secure context / mediaDevices 사전 진단
  if (!window.isSecureContext || location.protocol==='file:'
      || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia
      || typeof MediaRecorder==='undefined'){
    _showVoicePermModal(_voicePermDiagnose(null));
    return;
  }
  // 권한 + stream 확보 → armed
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
    Voice.stream=stream;
    _showVoicePanel();
    _voiceTransition('armed');
  }).catch(function(err){
    console.warn('[voice] getUserMedia error',err);
    _showVoicePermModal(_voicePermDiagnose(err));
  });
}

function _showVoicePanel(){
  var p=_voicePanel(); if(p) p.hidden=false;
  var btn=_vmb(); if(btn) btn.classList.add('open');
  var lbl=_vmbLabel(); if(lbl) lbl.textContent='닫기';
  var ic=_vmbIcon(); if(ic) ic.textContent='✕';
  var cb=_voiceCloseBtn();
  if (cb && !cb.dataset.bound){
    cb.addEventListener('click',requestCloseVoicePanel);
    cb.dataset.bound='1';
  }
}

function _hideVoicePanel(){
  var p=_voicePanel(); if(p) p.hidden=true;
  var btn=_vmb(); if(btn) btn.classList.remove('open');
  var lbl=_vmbLabel(); if(lbl) lbl.textContent='음성으로 작성';
  var ic=_vmbIcon(); if(ic) ic.textContent='🎤';
}

// ── ✕ 닫기 요청 (상태별 분기) ──
function requestCloseVoicePanel(){
  if (Voice.state==='converting') return;          // 변환 중엔 닫기 비활성
  if (Voice.state==='closing') return;              // 이미 닫기 확인 중
  if (Voice.state==='recording'){
    // 녹음 중 ✕ → stop → onstop 콜백에서 closing 진입
    Voice.closingPending=true;
    if (Voice.timerId){clearInterval(Voice.timerId);Voice.timerId=null;}
    if (Voice.rec && Voice.rec.state!=='inactive'){
      try{Voice.rec.stop();}catch(e){}
    }
    return;
  }
  if (Voice.state==='recorded'){
    _voiceTransition('closing');
    return;
  }
  // armed / idle → 즉시 폐기 닫기
  _voiceFullCleanup();
}

// ── 전체 정리 (idle 복귀) ──
function _voiceFullCleanup(){
  if (Voice.timerId){clearInterval(Voice.timerId);Voice.timerId=null;}
  if (Voice.audio){try{Voice.audio.pause();}catch(e){} Voice.audio=null;}
  if (Voice.blobUrl){try{URL.revokeObjectURL(Voice.blobUrl);}catch(e){} Voice.blobUrl=null;}
  if (Voice.rec){
    try{ if (Voice.rec.state!=='inactive') Voice.rec.stop(); }catch(e){}
    Voice.rec=null;
  }
  if (Voice.stream){
    try{Voice.stream.getTracks().forEach(function(t){t.stop();});}catch(e){}
    Voice.stream=null;
  }
  if (Voice.abortCtrl){try{Voice.abortCtrl.abort();}catch(e){} Voice.abortCtrl=null;}
  Voice.blob=null; Voice.chunks=[]; Voice.audioPlaying=false;
  Voice.durationMs=0; Voice.closingPending=false;
  Voice.state='idle';
  _hideVoicePanel();
}

// ── 상태 전환 + 본문 렌더 ──
function _voiceTransition(next){
  Voice.state=next;
  _renderVoicePanel();
}

function _renderVoicePanel(){
  var body=_voiceBody(); if(!body) return;
  var cb=_voiceCloseBtn();
  if (cb) cb.disabled=(Voice.state==='converting');
  var title=_voiceTitleEl();

  if (Voice.state==='armed'){
    if (title) title.textContent='🎤 음성 입력';
    body.innerHTML=
      '<button type="button" class="vp-btn vp-primary" id="vp-rec-start">'+
        '<span>●</span><span>녹음 시작</span>'+
      '</button>';
    document.getElementById('vp-rec-start').addEventListener('click',_voiceStartRec);
    return;
  }
  if (Voice.state==='recording'){
    if (title) title.textContent='🎤 녹음 중';
    body.innerHTML=
      '<button type="button" class="vp-btn vp-danger" id="vp-rec-stop">'+
        '<span>⏹</span><span>정지</span>'+
        '<span class="vp-elapsed" id="vp-elapsed">0:00</span>'+
      '</button>';
    document.getElementById('vp-rec-stop').addEventListener('click',_voiceStopRec);
    return;
  }
  if (Voice.state==='recorded'){
    if (title) title.textContent='🎤 녹음 완료 ('+_formatVoiceElapsed(Voice.durationMs)+')';
    var playLbl = Voice.audioPlaying ? '⏸ 일시정지' : '▶ 재생';
    body.innerHTML=
      '<div class="vp-row">'+
        '<button type="button" class="vp-btn" id="vp-play">'+playLbl+'</button>'+
        '<button type="button" class="vp-btn" id="vp-rerec">↻ 다시</button>'+
      '</div>'+
      '<button type="button" class="vp-btn vp-primary" id="vp-convert">'+
        '<span>✓</span><span>텍스트로 변환</span>'+
      '</button>';
    document.getElementById('vp-play').addEventListener('click',_voiceTogglePlay);
    document.getElementById('vp-rerec').addEventListener('click',_voiceReRec);
    document.getElementById('vp-convert').addEventListener('click',_voiceConvert);
    return;
  }
  if (Voice.state==='closing'){
    if (title) title.textContent='🎤 녹음한 음성이 있어요';
    body.innerHTML=
      '<div class="vp-row">'+
        '<button type="button" class="vp-btn vp-primary" id="vp-close-conv">'+
          '<span>✓</span><span>변환 후 닫기</span>'+
        '</button>'+
        '<button type="button" class="vp-btn" id="vp-close-discard">'+
          '<span>🗑</span><span>폐기하고 닫기</span>'+
        '</button>'+
      '</div>'+
      '<button type="button" class="vp-btn" id="vp-close-cancel" style="background:transparent;border-color:transparent;color:var(--ink3)">취소</button>';
    document.getElementById('vp-close-conv').addEventListener('click',_voiceConvertThenClose);
    document.getElementById('vp-close-discard').addEventListener('click',_voiceFullCleanup);
    document.getElementById('vp-close-cancel').addEventListener('click',function(){_voiceTransition('recorded');});
    return;
  }
  if (Voice.state==='converting'){
    if (title) title.textContent='🎤 변환 중...';
    body.innerHTML=
      '<button type="button" class="vp-btn vp-busy" disabled>'+
        '<span>⏳</span><span>CLOVA 변환 중...</span>'+
      '</button>';
    return;
  }
}

// ── 녹음 시작 / 정지 ──
function _voiceStartRec(){
  if (!Voice.stream){
    // 비정상 — 권한 재요청
    _voiceFullCleanup();
    openVoicePanel();
    return;
  }
  // 이전 녹음 폐기 (다시 녹음 케이스)
  if (Voice.audio){try{Voice.audio.pause();}catch(e){} Voice.audio=null;}
  if (Voice.blobUrl){try{URL.revokeObjectURL(Voice.blobUrl);}catch(e){} Voice.blobUrl=null;}
  Voice.blob=null; Voice.chunks=[]; Voice.audioPlaying=false; Voice.durationMs=0;

  var candidates=['audio/webm;codecs=opus','audio/webm','audio/mp4'];
  var mt='';
  for (var i=0;i<candidates.length;i++){
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidates[i])){mt=candidates[i];break;}
  }
  Voice.mimeType=mt||'';
  try{
    Voice.rec = mt ? new MediaRecorder(Voice.stream,{mimeType:mt}) : new MediaRecorder(Voice.stream);
  }catch(e){
    console.warn('[voice] MediaRecorder init',e);
    toast('녹음 시작 실패');
    return;
  }
  Voice.rec.ondataavailable=function(e){if (e.data && e.data.size>0) Voice.chunks.push(e.data);};
  Voice.rec.onstop=function(){
    var type=Voice.mimeType || (Voice.chunks[0] && Voice.chunks[0].type) || 'audio/webm';
    var blob=new Blob(Voice.chunks,{type:type});
    Voice.durationMs=Date.now()-Voice.startTs;
    if (blob.size<2000){
      Voice.blob=null; Voice.chunks=[]; Voice.closingPending=false;
      _voiceTransition('armed');
      toast('녹음이 너무 짧습니다');
      return;
    }
    Voice.blob=blob;
    Voice.blobUrl=URL.createObjectURL(blob);
    if (Voice.closingPending){
      Voice.closingPending=false;
      _voiceTransition('closing');
    }else{
      _voiceTransition('recorded');
    }
  };
  Voice.startTs=Date.now();
  Voice.rec.start();
  _voiceTransition('recording');
  if (Voice.timerId) clearInterval(Voice.timerId);
  Voice.timerId=setInterval(function(){
    var el=document.getElementById('vp-elapsed');
    if (el) el.textContent=_formatVoiceElapsed(Date.now()-Voice.startTs);
  },500);
}

function _voiceStopRec(){
  if (Voice.timerId){clearInterval(Voice.timerId);Voice.timerId=null;}
  if (Voice.rec && Voice.rec.state!=='inactive'){
    try{Voice.rec.stop();}catch(e){console.warn('[voice] stop',e);}
  }
}

// ── 재생 / 다시 / 변환 ──
function _voiceTogglePlay(){
  if (!Voice.blobUrl) return;
  if (!Voice.audio){
    Voice.audio=new Audio(Voice.blobUrl);
    Voice.audio.addEventListener('ended',function(){
      Voice.audioPlaying=false;
      if (Voice.state==='recorded') _renderVoicePanel();
    });
  }
  if (Voice.audioPlaying){
    try{Voice.audio.pause();}catch(e){}
    Voice.audioPlaying=false;
  }else{
    var p=Voice.audio.play();
    if (p && typeof p.catch==='function'){
      p.catch(function(){Voice.audioPlaying=false;_renderVoicePanel();});
    }
    Voice.audioPlaying=true;
  }
  _renderVoicePanel();
}

function _voiceReRec(){
  if (Voice.audio){try{Voice.audio.pause();}catch(e){} Voice.audio=null;}
  if (Voice.blobUrl){try{URL.revokeObjectURL(Voice.blobUrl);}catch(e){} Voice.blobUrl=null;}
  Voice.blob=null; Voice.chunks=[]; Voice.audioPlaying=false; Voice.durationMs=0;
  _voiceTransition('armed');
}

function _voiceConvert(){
  if (!Voice.blob){toast('녹음된 음성이 없습니다');return;}
  _voiceTransition('converting');
  _voiceSendSTT('armed');   // 변환 후 armed 복귀 (패널 유지)
}

function _voiceConvertThenClose(){
  if (!Voice.blob){_voiceFullCleanup();return;}
  _voiceTransition('converting');
  _voiceSendSTT('close');
}

function _voiceSendSTT(then){
  var blob=Voice.blob;
  var type=blob.type || 'audio/webm';
  var ext=type.indexOf('mp4')>=0?'m4a':'webm';
  var d=new Date();
  var fname='voice_'+d.getFullYear()+p2(d.getMonth()+1)+p2(d.getDate())+'_'+p2(d.getHours())+p2(d.getMinutes())+p2(d.getSeconds())+'.'+ext;
  var file=new File([blob],fname,{type:type});

  var fd=new FormData();
  fd.append('audio',file,fname);
  fd.append('skip_postprocess','1');
  fd.append('title','일일보고 음성 메모');
  fd.append('level_hint','auto');

  var url=(typeof HIMCLOVA_URL==='string' && HIMCLOVA_URL) ? HIMCLOVA_URL : 'https://himclova-server-production.up.railway.app';
  var ctrl=new AbortController();
  Voice.abortCtrl=ctrl;
  // 2026-07-20: 5분 → 25분 (UPLOAD_TIMEOUT_MS 와 통일). 서버 heartbeat 로 Railway 엣지 300초 절단도 해소됨.
  var timeoutId=setTimeout(function(){try{ctrl.abort();}catch(e){}}, 25*60*1000);

  fetch(url+'/transcribe',{method:'POST',body:fd,signal:ctrl.signal})
    .then(function(resp){
      clearTimeout(timeoutId);
      if (!resp.ok){
        return resp.text().then(function(t){throw new Error('서버 오류 ('+resp.status+')');});
      }
      return resp.json();
    })
    .then(function(data){
      Voice.abortCtrl=null;
      if (!data || data.ok===false){
        throw new Error((data && data.message) || '변환 실패');
      }
      var text='';
      if (typeof data.raw_transcript==='string' && data.raw_transcript.trim()){
        text=data.raw_transcript.trim();
      }else if (typeof data.transcript==='string'){
        text=data.transcript.replace(/^\[화자 [^\]]*\]\s*/gm,'').trim();
      }
      if (text){
        // 2026-05-21 — target 분기. 'chat' = 일일보고 챗 input + 자동 전송, 'search' = 인사이트 챗 input + 자동 전송, 그 외 = raw main-input append
        if (Voice.target === 'chat' && typeof ChatVoice !== 'undefined') {
          ChatVoice._onSTTResult(text);
        } else if (Voice.target === 'search' && typeof SearchVoice !== 'undefined') {
          SearchVoice._onSTTResult(text);
        } else {
          _appendToMainInput(text);
          toast('🎤 변환 완료');
        }
      }else{
        toast('음성을 인식하지 못했습니다');
        if (Voice.target === 'chat' && typeof ChatVoice !== 'undefined') ChatVoice._cleanup();
        else if (Voice.target === 'search' && typeof SearchVoice !== 'undefined') SearchVoice._cleanup();
      }
      // blob 폐기
      if (Voice.audio){try{Voice.audio.pause();}catch(e){} Voice.audio=null;}
      if (Voice.blobUrl){try{URL.revokeObjectURL(Voice.blobUrl);}catch(e){} Voice.blobUrl=null;}
      Voice.blob=null; Voice.chunks=[]; Voice.audioPlaying=false; Voice.durationMs=0;
      if (then==='close') _voiceFullCleanup();
      else _voiceTransition('armed');
    })
    .catch(function(err){
      clearTimeout(timeoutId);
      Voice.abortCtrl=null;
      console.warn('[voice] STT error',err);
      var msg=(err && err.name==='AbortError') ? '⏱ 변환 시간 초과/취소'
            : '⚠️ '+(err && err.message ? err.message : '변환 실패');
      toast(msg);
      // 실패 시 recorded 로 복귀 — 사용자가 재시도 가능
      _voiceTransition('recorded');
    });
}

function _appendToMainInput(text){
  if (!text) return;
  var ta=document.getElementById('main-input');
  if (!ta) return;
  var cur=ta.value || '';
  var sep='';
  if (cur){
    if (/\n$/.test(cur)) sep='';
    else if (/\s$/.test(cur)) sep='';
    else sep=' ';
  }
  ta.value=cur+sep+text;
  if (typeof autosizeTa==='function') autosizeTa(ta);
  try{ta.dispatchEvent(new Event('input',{bubbles:true}));}catch(e){}
}

