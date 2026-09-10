// ── 지시·요청사항 별도 입력칸 (2026-08-07) ──────────
function dirxAddRow(){
  var box=document.getElementById('dirx-rows');
  if(!box)return;
  var row=document.createElement('div');
  row.className='dirx-row';
  row.innerHTML=
    '<input type="text" class="dirx-text" placeholder="예: 박민준 — 회의록 정리 요청" maxlength="200">'+
    '<input type="date" class="dirx-date" title="완료 기한 (비우면 정리 단계에서 질문)">'+
    '<button type="button" class="dirx-del" title="삭제" onclick="this.parentNode.remove()">✕</button>';
  box.appendChild(row);
  try{row.querySelector('.dirx-text').focus();}catch(e){}
}
function dirxCollect(){
  var box=document.getElementById('dirx-rows');
  if(!box)return '';
  var lines=[];
  var rows=box.querySelectorAll('.dirx-row');
  for(var i=0;i<rows.length;i++){
    var t=rows[i].querySelector('.dirx-text').value.trim();
    if(!t)continue;
    var d=rows[i].querySelector('.dirx-date').value;  // yyyy-mm-dd
    if(d){
      var p=d.split('-');
      t+=' (기한 '+parseInt(p[1],10)+'/'+parseInt(p[2],10)+')';
    }
    lines.push('- '+t);
  }
  return lines.length?lines.join('\n'):'';
}
function dirxClear(){
  var box=document.getElementById('dirx-rows');
  if(box)box.innerHTML='';
}

// ── 일정 탭 (2026-08-07) — 전직원 일정·지시 달력 (`프로젝트 일정` 시트, get_schedule_all) ──
var CalTab={
  _loaded:false,_entries:[],_ym:null,_inited:false,
  init:function(){
    if(!this._inited){
      var now=new Date();this._ym=[now.getFullYear(),now.getMonth()];this._inited=true;
    }
    if(!this._loaded)this.load();
    else this.render();
  },
  load:function(force){
    var self=this;
    var grid=document.getElementById('calx-grid');
    if(grid&&(!self._loaded||force))grid.innerHTML='<div style="grid-column:1/8;padding:30px;text-align:center;color:#a99a86">📅 일정을 불러오는 중...</div>';
    fetch(APPS_SCRIPT_URL+'?action=get_schedule_all&name='+encodeURIComponent((typeof profile!=='undefined'&&profile&&profile.name)||''))
      .then(function(r){return r.json()})
      .then(function(d){
        if(!d.ok)throw new Error(d.error||'일정 로드 실패');
        self._entries=d.entries||[];
        self._loaded=true;
        self.fillPersons();
        self.render();
      })
      .catch(function(e){
        if(grid)grid.innerHTML='<div style="grid-column:1/8;padding:30px;text-align:center;color:#c06a5a">⚠️ '+escapeHtml(String(e.message||e))+'</div>';
      });
  },
  fillPersons:function(){
    var sel=document.getElementById('calx-person');if(!sel)return;
    var cur=sel.value;
    var names={};
    this._entries.forEach(function(e){if(e.to)names[e.to]=1;});
    var opts='<option value="">전체 직원</option>';
    Object.keys(names).sort().forEach(function(n){opts+='<option value="'+escapeHtml(n)+'">'+escapeHtml(n)+'</option>';});
    sel.innerHTML=opts;
    sel.value=cur||'';
  },
  move:function(d){
    var dt=new Date(this._ym[0],this._ym[1]+d,1);
    this._ym=[dt.getFullYear(),dt.getMonth()];
    this.render();
  },
  _filtered:function(){
    var person=(document.getElementById('calx-person')||{}).value||'';
    return this._entries.filter(function(e){
      if(person&&e.to!==person)return false;
      if(e.status==='completed')return false;
      return true;
    });
  },
  // 중복 접기 — 같은 사람 + 사실상 같은 내용(공백·문장부호 차이 무시)은 1건으로 (2026-08-08)
  _dedup:function(list){
    var seen={},out=[];
    list.forEach(function(e){
      var key;
      if(e.redacted){ key=(e.to||'')+'|R'+(e.kind||'')+'|'+(e.time||'미정'); }
      else { key=(e.to||'')+'|'+String(e.title||'').replace(/[\s·,\.\-–—()\[\]\/:;'"~]/g,'').toLowerCase().substring(0,40); }
      if(seen[key]){seen[key].dup++;return;}
      var c={e:e,dup:1};seen[key]=c;out.push(c);
    });
    return out;   // [{e, dup}]
  },
  // 제목에서 시각 추출 (11:30 / 14시 / 점심) — 없으면 null
  _timeOf:function(t){
    t=String(t||'');
    var m=t.match(/(\d{1,2}):(\d{2})/);
    if(m)return parseInt(m[1],10)*60+parseInt(m[2],10);
    m=t.match(/(\d{1,2})시/);
    if(m&&parseInt(m[1],10)<=24)return parseInt(m[1],10)*60;
    if(/점심/.test(t))return 12*60;
    return null;
  },
  // 하루치 정리: [시간 일정(시간순)] / [지시] / [할 일] 3그룹 (전부 중복 접힘)
  _dayGroups:function(ds){
    var self=this;
    var list=this._filtered().filter(function(e){return (e.due_date||e.issued_date)===ds;});
    var dd=this._dedup(list);
    var timed=[],dirs=[],tasks=[];
    dd.forEach(function(c){
      var tm=self._timeOf(c.e.title);
      c.tm=tm;
      if(c.e.origin==='schedule'||tm!==null)timed.push(c);
      else if(c.e.origin==='directive')dirs.push(c);
      else tasks.push(c);
    });
    timed.sort(function(a,b){
      var x=a.tm===null?9999:a.tm, y=b.tm===null?9999:b.tm;
      return x-y;
    });
    return {timed:timed,dirs:dirs,tasks:tasks};
  },
  render:function(){
    var grid=document.getElementById('calx-grid');if(!grid||!this._ym)return;
    var y=this._ym[0],m=this._ym[1];
    var title=document.getElementById('calx-title');
    if(title)title.textContent=y+'년 '+(m+1)+'월';
    var byDate={};
    this._filtered().forEach(function(e){
      var d=e.due_date||e.issued_date;if(!d)return;
      (byDate[d]=byDate[d]||[]).push(e);
    });
    var t=new Date();
    var todayStr=t.getFullYear()+'-'+('0'+(t.getMonth()+1)).slice(-2)+'-'+('0'+t.getDate()).slice(-2);
    var startDow=new Date(y,m,1).getDay();
    var days=new Date(y,m+1,0).getDate();
    var dows=['일','월','화','수','목','금','토'];
    var html='';
    for(var i=0;i<7;i++)html+='<div class="calx-dow">'+dows[i]+'</div>';
    for(var b=0;b<startDow;b++)html+='<div class="calx-day other"></div>';
    for(var day=1;day<=days;day++){
      var ds=y+'-'+('0'+(m+1)).slice(-2)+'-'+('0'+day).slice(-2);
      var dow=(startDow+day-1)%7;
      var cls='calx-day'+(ds===todayStr?' today':'')+(dow===0?' sun':(dow===6?' sat':''));
      var list=byDate[ds]||[];
      // 칩도 중복 접기 + 시간 일정 우선 (2026-08-08)
      var dd=this._dedup(list);
      // 2026-08-10 fix: 칩은 일정만 + 직원 명단 내 인물만 (할일·지시·외부인 제외 — 상세줄과 기준 통일)
      var staffSet=null;
      if(typeof STAFF!=='undefined'&&STAFF&&STAFF.length){staffSet={};STAFF.forEach(function(s){staffSet[s.name]=1;});}
      dd=dd.filter(function(x){
        if(x.e.origin!=='schedule')return false;
        var kk=x.e.kind||'';
        if(kk!=='외부'&&kk!=='내부')return false;   // 외부/내부일정만 표시 — 업무·근태 제외 (2026-08-10)
        if(staffSet&&!staffSet[x.e.to||''])return false;
        return true;
      });
      var self2=this;
      dd.sort(function(a,b){
        var pa=(a.e.origin==='schedule'||self2._timeOf(a.e.title)!==null)?0:(a.e.origin==='directive'?1:2);
        var pb=(b.e.origin==='schedule'||self2._timeOf(b.e.title)!==null)?0:(b.e.origin==='directive'?1:2);
        return pa-pb;
      });
      var chips='';
      for(var c=0;c<dd.length&&c<3;c++){
        var e2=dd[c].e;
        var oc=e2.origin==='directive'?'directive':(e2.origin==='schedule'?'schedule':'task');
        var chipLabel=e2.redacted?((e2.to?e2.to+' · ':'')+(e2.time?e2.time+' ':'')+(e2.kind==='내부'?'내부일정':'외부일정')):((e2.to?e2.to+' · ':'')+e2.title);
        chips+='<div class="calx-chip '+oc+'">'+escapeHtml(chipLabel)+'</div>';
      }
      if(dd.length>3)chips+='<div class="calx-more">+'+(dd.length-3)+'건</div>';
      html+='<div class="'+cls+'" onclick="CalTab.showDay(\''+ds+'\')"><div class="calx-dnum">'+day+'</div>'+chips+'</div>';
    }
    grid.innerHTML=html;
    var det=document.getElementById('calx-detail');if(det)det.innerHTML='';
  },
  // 날짜 클릭 → 직원별 아코디언 (2026-08-08 재설계)
  //   목적: "이 사람 오늘 회사에 있나 / 몇 시에 나가나" — 시간·외부 일정만, 사람당 한 줄.
  //   같은 사람 + 같은 시각 = 같은 일정 취급 (재생성 문구 변형 중복 자동 병합).
  showDay:function(ds){
    var det=document.getElementById('calx-detail');if(!det)return;
    this._lastDay=ds;   // 내 일정 등록 날짜 기본값 (2026-08-08)
    var self=this;
    var person=(document.getElementById('calx-person')||{}).value||'';
    var byName={};
    var staffSet2=null;
    if(typeof STAFF!=='undefined'&&STAFF&&STAFF.length){staffSet2={};STAFF.forEach(function(s){staffSet2[s.name]=1;});}
    this._entries.forEach(function(e){
      if(e.status==='completed')return;
      if(staffSet2&&!staffSet2[e.to||''])return;   // 직원 명단 밖 인물(외부인) 제외 (2026-08-10)
      if((e.due_date||e.issued_date)!==ds)return;
      if(e.redacted){   // 타인 비공개 일정 (2026-08-10) — 딱지만
        if(e.origin!=='schedule')return;
        var rkk=e.kind||'';
        if(rkk!=='외부'&&rkk!=='내부')return;   // 업무·근태성은 딱지도 X (2026-08-10 스펙)
        var rtm=self._timeOf(e.time||'');
        var rname=e.to||'';if(!rname)return;
        var rb=(byName[rname]=byName[rname]||{});
        var rkey=((rtm!==null)?('t'+rtm):'xredacted')+'|'+rkk;
        if(rb[rkey]){rb[rkey].dup++;return;}
        rb[rkey]={id:e.id,redacted:true,tm:rtm,kind:rkk,dup:1};
        return;
      }
      if(e.origin!=='schedule')return;   // 할 일·지시는 일정탭 미표시 (2026-08-10 스펙: 외부·내부일정만)
      var kk2=e.kind||'';
      if(kk2!=='외부'&&kk2!=='내부')return;   // 업무·근태성 제외
      var tm=self._timeOf(e.title);
      var name=e.to||'';if(!name)return;
      var bucket=(byName[name]=byName[name]||{});
      var key=(tm!==null)?('t'+tm):('x'+String(e.title||'').replace(/[\s·,\.\-–—()\[\]\/:;'"~]/g,'').toLowerCase().substring(0,30));
      if(bucket[key]){bucket[key].dup++;return;}
      bucket[key]={id:e.id,title:String(e.title||''),tm:tm,pj:e.pj_code||'',kind:kk2,dup:1};
    });
    function itemsOf(name){
      var b=byName[name];if(!b)return [];
      var arr=Object.keys(b).map(function(k){return b[k];});
      arr.sort(function(a,c){var x=a.tm===null?9999:a.tm,y=c.tm===null?9999:c.tm;return x-y;});
      return arr;
    }
    function fmt(tm){var h=Math.floor(tm/60),mi=tm%60;return h+':'+('0'+mi).slice(-2);}
    var roster=(typeof STAFF!=='undefined'&&Array.isArray(STAFF)&&STAFF.length)?STAFF.slice():[];
    if(person)roster=roster.filter(function(s){return s.name===person;});
    Object.keys(byName).forEach(function(n){   // 명단 밖 인물(옛 데이터)도 뒤에 표시
      if(person&&n!==person)return;
      if(!roster.some(function(s){return s.name===n;}))roster.push({name:n,role:''});
    });
    // 직급 서열순 정렬 (2026-08-08) — 같은 직급끼리는 직원목록 시트 순서 유지
    var RANK={'대표':0,'사장':1,'부사장':2,'본부장':3,'상무':4,'이사':5,'실장':6,'팀장':7,'차장':8,'과장':9,'대리':10,'주임':11,'사원':12,'외주':13};
    roster.forEach(function(s,i){s._i=i;});
    roster.sort(function(a,b){
      var ra=(RANK[a.role]!==undefined)?RANK[a.role]:99;
      var rb=(RANK[b.role]!==undefined)?RANK[b.role]:99;
      return ra!==rb?ra-rb:a._i-b._i;
    });
    var html='<div class="cd-head">📅 '+ds+' — 직원별 일정 (외부·내부) <span style="font-weight:400;color:#a99a86;font-size:12px">(줄을 누르면 상세)</span></div>';
    roster.forEach(function(s,i){
      var arr=itemsOf(s.name);
      if(!arr.length){
        html+='<div class="cd-item" style="opacity:.45;padding:7px 12px"><b>'+escapeHtml(s.name)+'</b> '+escapeHtml(s.role||'')+' — 등록된 일정 없음</div>';
        return;
      }
      var bodyId='calx-pb-'+i;
      var times=arr.map(function(a){return a.tm!==null?fmt(a.tm):'시간미정';}).join(' · ');
      html+='<div class="cd-item" style="padding:7px 12px;cursor:pointer" '+
        'onclick="var b=document.getElementById(\''+bodyId+'\');if(b)b.style.display=(b.style.display===\'none\'?\'block\':\'none\');">'+
        '<b>'+escapeHtml(s.name)+'</b> '+escapeHtml(s.role||'')+
        ' — <span style="color:#5a7ac0;font-weight:600">⏰ '+times+'</span> <span style="color:#8a7a63">('+arr.length+'건)</span>'+
        '<span style="float:right;color:#b09a80">▼</span>'+
        '<div id="'+bodyId+'" style="display:none;margin-top:6px;border-top:1px dashed rgba(0,0,0,.08);padding-top:6px" onclick="event.stopPropagation()">'+
        arr.map(function(a){
          var klabel=(a.kind==='내부')?'내부일정':'외부일정';
          if(a.redacted){
            return '<div style="margin-bottom:3px;color:#8a7a63">'+
              (a.tm!==null?'⏰ <b style="color:#5a7ac0">'+fmt(a.tm)+'</b> '+klabel+' 있음':'시간 미정인 '+klabel+' 있음')+
              (a.dup>1?' ('+a.dup+'건)':'')+'</div>';
          }
          var ktag=(a.kind==='내부')
            ?'<span style="font-size:10.5px;background:#e9f0e3;color:#5c7a4b;border-radius:4px;padding:1px 5px;margin-right:4px">내부</span>'
            :'<span style="font-size:10.5px;background:#e4ebf7;color:#5a7ac0;border-radius:4px;padding:1px 5px;margin-right:4px">외부</span>';
          var mine=(typeof profile!=='undefined'&&profile&&profile.name===s.name);
          var btns=mine?(' <button type="button" class="calx-mini" onclick="event.stopPropagation();calxEditMine(\x27'+a.id+'\x27,\x27'+ds+'\x27,\x27'+(a.tm===null?'':a.tm)+'\x27,\x27'+encodeURIComponent(a.title)+'\x27)">수정</button>'+
            '<button type="button" class="calx-mini" style="color:#c05a5a" onclick="event.stopPropagation();calxDeleteMine(\x27'+a.id+'\x27)">삭제</button>'):'';
          return '<div style="margin-bottom:3px">'+ktag+(a.tm!==null?'<b style="color:#5a7ac0">'+fmt(a.tm)+'</b> ':'')+escapeHtml(a.title)+
            (a.pj?' <span style="color:#8a7a63;font-size:11.5px">· '+escapeHtml(a.pj)+'</span>':'')+
            (a.dup>1?' <span style="color:#b09a80;font-size:11px">(중복 '+a.dup+'벌 접힘)</span>':'')+btns+'</div>';
        }).join('')+
        '</div></div>';
    });
    if(!roster.length){
      html+='<div style="color:#a99a86">해당 날짜의 일정이 없습니다.</div>';
    }
    det.innerHTML=html;
  }
};

// ── 내 일정 등록 (일정 탭, 2026-08-08) ──────────
function myxTodayStr(){
  var t=new Date();
  return t.getFullYear()+'-'+('0'+(t.getMonth()+1)).slice(-2)+'-'+('0'+t.getDate()).slice(-2);
}
function myxDefaultDate(){
  if(typeof CalTab!=='undefined'&&CalTab._lastDay)return CalTab._lastDay;
  return myxTodayStr();
}
function myxAddRow(){
  var box=document.getElementById('myx-rows');if(!box)return;
  var row=document.createElement('div');
  row.className='myx-row';
  row.innerHTML=
    '<input type="date" class="myx-date" value="'+myxDefaultDate()+'">'+
    '<input type="time" class="myx-time" title="대략적인 시간 (비우면 시간미정)">'+
    '<button type="button" class="myx-clr" title="시간 지우기 (시간미정으로)" onclick="this.previousElementSibling.value=\'\'">⌫</button>'+
    '<input type="text" class="myx-text" placeholder="예: 국민은행 방문 (오후) / 서울시 협의 — 다음 주 / 미정" maxlength="120">'+
    '<button type="button" class="dirx-del" title="삭제" onclick="this.parentNode.remove()">✕</button>';
  box.appendChild(row);
  try{row.querySelector('.myx-text').focus();}catch(e){}
}
function myxSubmit(){
  var box=document.getElementById('myx-rows');if(!box)return;
  var rows=box.querySelectorAll('.myx-row'),items=[];
  for(var i=0;i<rows.length;i++){
    var date=rows[i].querySelector('.myx-date').value;
    var time=rows[i].querySelector('.myx-time').value;   // "14:00" 또는 ""
    var text=rows[i].querySelector('.myx-text').value.trim();
    if(!text)continue;
    if(!date)date=myxTodayStr();   // 날짜 비우면 오늘 날짜로 등록 (내용칸에 "다음 주" 등으로 시기 표기)
    items.push({date:date,time:time,text:text,replace_id:(rows[i].dataset&&rows[i].dataset.replaceId)||''});
  }
  if(!items.length){toast('등록할 일정을 입력해주세요');return;}
  if(!profile||!profile.name){toast('로그인 정보가 없습니다 — 처음 화면에서 본인 선택 후 이용해주세요');return;}
  var btn=document.getElementById('myx-submit');
  if(btn){btn.disabled=true;btn.textContent='등록 중...';}
  var done=function(){if(btn){btn.disabled=false;btn.textContent='제출하기';}};
  fetch(APPS_SCRIPT_URL,{
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({token:APPS_SCRIPT_TOKEN,action:'add_my_schedule',name:profile.name,items:items})
  })
  .then(function(r){return r.json()})
  .then(function(d){
    done();
    if(!d.ok)throw new Error(d.message||d.error||'등록 실패');
    toast('✅ 일정 '+items.length+'건 등록 완료');
    box.innerHTML='';
    if(typeof CalTab!=='undefined')CalTab.load(true);
  })
  .catch(function(e){done();toast('❌ '+String(e.message||e));});
}

// ── 일정 수정·삭제 (일정 탭, 2026-08-09) — 본인 일정 한정 ──────────
function calxDeleteMine(id){
  if(!profile||!profile.name){toast('로그인 정보가 없습니다');return;}
  if(!confirm('이 일정을 삭제할까요?'))return;
  fetch(APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({token:APPS_SCRIPT_TOKEN,action:'delete_my_schedule',name:profile.name,id:id})})
  .then(function(r){return r.json()})
  .then(function(d){
    if(!d.ok)throw new Error(d.message||'삭제 실패');
    toast('🗑 일정 삭제됨');
    if(typeof CalTab!=='undefined')CalTab.load(true);
  })
  .catch(function(e){toast('❌ '+String(e.message||e));});
}
function calxEditMine(id, ds, tm, titleEnc){
  var title='';
  try{title=decodeURIComponent(titleEnc||'');}catch(e){title=String(titleEnc||'');}
  title=title.replace(/^\s*\d{1,2}:\d{2}\s*/,'');   // 제목 앞머리 시간 표기는 시간칸으로 옮기므로 제거
  myxAddRow();
  var box=document.getElementById('myx-rows');
  var row=box&&box.lastElementChild;if(!row)return;
  row.querySelector('.myx-date').value=ds;
  if(tm!==''&&tm!==null){
    var t=parseInt(tm,10);
    if(!isNaN(t))row.querySelector('.myx-time').value=('0'+Math.floor(t/60)).slice(-2)+':'+('0'+(t%60)).slice(-2);
  }
  row.querySelector('.myx-text').value=title;
  row.dataset.replaceId=id;
  toast('✏️ 수정 모드 — 고친 뒤 [제출하기]를 누르면 이 일정이 교체됩니다');
  try{document.getElementById('myx-wrap').scrollIntoView({behavior:'smooth',block:'center'});}catch(e){}
  try{row.querySelector('.myx-text').focus();}catch(e){}
}

