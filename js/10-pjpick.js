// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 10-pjpick.js — 보고창 프로젝트 고르기 · 새 프로젝트 등록 · 지난 보고 카드 (2026-10-07 박제형)
//   서버 창구: pj_pick_list · pj_pick_register · pj_pick_last (ProjectPick.js). 고른 프로젝트는 structure_report 에 picked 로 같이 간다.
//   화면 조각(.pjx-wrap)은 힘클로드_v1.html 의 오늘 업무 입력칸 위에 있다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

var PjPick={
  KEY:'himclaude_v2_pjpick',
  list:null, loading:false, picks:[], shown:[], sel:-1, _blurT:null, _restored:false,
  norm:function(s){ return String(s||'').toLowerCase().replace(/[\s\-_·.,()\[\]\/]/g,''); },
  today:function(){ var t=new Date(); return t.getFullYear()+'-'+('0'+(t.getMonth()+1)).slice(-2)+'-'+('0'+t.getDate()).slice(-2); },
  status:function(msg){ var el=document.getElementById('pjx-status'); if(el) el.textContent=msg; },

  load:function(){
    var self=this;
    if(self.loading||self.list) return;
    self.loading=true;
    self.status('프로젝트 목록을 불러오는 중입니다...');
    gasPostRetry({token:APPS_SCRIPT_TOKEN,action:'pj_pick_list'},{tries:3})
    .then(function(d){
      self.loading=false;
      if(!d||!d.ok) throw new Error((d&&(d.error||d.message))||'목록을 받지 못했습니다');
      self.list=(d.projects||[]).filter(function(p){ return p.stage!=='시스템'; });
      self.list.forEach(function(p){
        p._n=self.norm(p.name); p._c=self.norm(p.code);
        p._k=self.norm([p.code,p.name,p.client,(p.alt||[]).join(' ')].join(' '));
      });
      var nn=self.list.filter(function(p){ return p.notion; }).length;
      self.status('프로젝트 '+self.list.length+'건 중에서 검색합니다. 목록에 없으면 "새 프로젝트 등록"을 눌러 주세요.');
      self.onInput();
      self.loadLast();   // 지난 보고 내용
      if(self._allWait){ self._allWait=false; var _ab=document.getElementById('pjx-all'); if(_ab&&!_ab.hidden){ _ab.hidden=true; self.openAll(); } }
    })
    .catch(function(e){
      self.loading=false; self.list=null;
      self.status('⚠️ 프로젝트 목록을 불러오지 못했습니다. 검색창을 다시 눌러 주세요. ('+String((e&&e.message)||e)+')');
    });
  },

  search:function(q){
    var self=this;
    var words=String(q||'').trim().split(/\s+/).map(self.norm).filter(Boolean);
    if(!words.length||!self.list) return [];
    var have={}; self.picks.forEach(function(p){ have[p.code]=1; });
    var out=[];
    self.list.forEach(function(p,i){
      if(have[p.code]) return;
      for(var k=0;k<words.length;k++){ if(p._k.indexOf(words[k])<0) return; }
      var w=words[0], sc;
      if(p._c===w) sc=0;                         // 코드가 정확히 같음
      else if(p._n.indexOf(w)===0) sc=1;         // 이름이 그 말로 시작
      else if(p._c.indexOf(w)>=0) sc=2;          // 코드에 들어 있음
      else if(p._n.indexOf(w)>=0) sc=3;          // 이름 중간에 있음
      else sc=4;                                 // 별칭·발주처에 있음
      out.push({p:p,sc:sc,i:i});
    });
    out.sort(function(a,b){ return a.sc-b.sc || a.i-b.i; });
    return out.slice(0,12).map(function(x){ return x.p; });
  },

  onFocus:function(){ if(this._blurT){clearTimeout(this._blurT);this._blurT=null;} this.load(); this.onInput(); },
  onBlur:function(){ var self=this; self._blurT=setTimeout(function(){ self.hide(); },180); },
  hide:function(){ var box=document.getElementById('pjx-results'); if(box){ box.hidden=true; box.innerHTML=''; } this.shown=[]; this.sel=-1; this.infoCode=null; },

  onInput:function(){
    var inp=document.getElementById('pjx-q'), box=document.getElementById('pjx-results');
    if(!inp||!box) return;
    var q=inp.value.trim();
    if(!q||document.activeElement!==inp){ this.hide(); return; }
    if(!this.list){ box.hidden=false; box.innerHTML='<div class="pjx-none">프로젝트 목록을 불러오는 중입니다...</div>'; return; }
    this.shown=this.search(q); this.sel=this.shown.length?0:-1;
    this.renderResults();
  },

  renderResults:function(){
    var self=this, box=document.getElementById('pjx-results');
    if(!box) return;
    var inp=document.getElementById('pjx-q'), q=inp?inp.value.trim():'';
    // 2026-10-01 — 목록 맨 아래에 "새 프로젝트로 등록" 줄
    var newRow='<div class="pjx-item pjx-newrow" onmousedown="event.preventDefault();PjPick.openNew()">＋ <b>'+escapeHtml(q)+'</b> — 새 프로젝트로 등록</div>';
    box.hidden=false;
    if(!self.shown.length){
      box.innerHTML='<div class="pjx-none">검색 결과가 없습니다. 아래 줄을 눌러 새 프로젝트로 등록할 수 있습니다.</div>'+newRow;
      return;
    }
    box.innerHTML=self.shown.map(function(p,i){
      var meta=[p.dept,p.status||p.stage,p.client?('발주 '+p.client):''].filter(Boolean).join(' · ');
      var open=(self.infoCode===p.code);
      return '<div class="pjx-item'+(i===self.sel?' on':'')+'" onmousedown="event.preventDefault();PjPick.add('+i+')">'+
               '<span class="pjx-infobtn" title="프로젝트 목록 시트의 내용 보기" onmousedown="event.preventDefault();event.stopPropagation();PjPick.toggleInfo('+i+')">'+(open?'접기':'자세히')+'</span>'+
               '<span class="pjx-code">'+escapeHtml(p.code)+'</span>'+escapeHtml(p.name)+
               self.tagHtml(p)+
               (meta?'<div class="pjx-meta">'+escapeHtml(meta.length>90?meta.slice(0,90)+'…':meta)+'</div>':'')+
               (open?'<div onmousedown="event.preventDefault();event.stopPropagation()">'+self.infoHtml(p)+'</div>':'')+
             '</div>';
    }).join('')+newRow;
  },

  // ── 2026-10-01 시트 칸 보기 ──
  tagHtml:function(p){
    return (p.temp?'<span class="pjx-tag new">임시 코드</span>':'')+(p.notion?'<span class="pjx-tag">노션</span>':'<span class="pjx-tag off">노션 외 목록</span>');
  },
  infoHtml:function(p){
    var rows=[];
    var add=function(k,v){ v=String(v==null?'':v).trim(); if(v) rows.push('<div class="pjx-info-row"><span class="k">'+k+'</span><span class="v">'+escapeHtml(v)+'</span></div>'); };
    add('코드',(p.codes&&p.codes.length?p.codes:[p.code]).join(', '));
    add('정식 이름',p.name);
    add('본부',p.dept);
    add('단계',[p.stage,p.status].filter(Boolean).join(' · '));
    add('발주처',p.client);
    add('별칭',(p.aliases||[]).join(', '));
    add('키워드',(p.kws||[]).join(', '));
    add('진행상황',p.progress);
    add('메모',p.memo);
    return '<div class="pjx-info">'+(rows.join('')||'시트에 적힌 내용이 없습니다.')+'</div>';
  },
  toggleInfo:function(i){ var p=this.shown[i]; if(!p) return; this.infoCode=(this.infoCode===p.code?null:p.code); this.renderResults(); },
  byCode:function(code){ var l=this.list||[]; for(var i=0;i<l.length;i++){ if(l[i].code===code) return l[i]; } return null; },
  addToList:function(p){
    if(!this.list||!p||this.byCode(p.code)) return;
    p._n=this.norm(p.name); p._c=this.norm(p.code);
    p._k=this.norm([p.code,p.name,p.client,(p.alt||[]).join(' ')].join(' '));
    this.list.unshift(p);
  },
  deptList:function(){
    var out=[];
    try{ (STAFF||[]).forEach(function(s){ if(s.dept&&out.indexOf(s.dept)<0) out.push(s.dept); }); }catch(e){}
    if(!out.length) out=['대표단','기획본부','도시계획본부','설계본부'];
    return out;
  },

  // ── 2026-10-01 새 프로젝트 등록 칸 (채팅으로 묻지 않고 칸에 적어서 등록) ──
  openNew:function(){
    var inp=document.getElementById('pjx-q'), q=inp?inp.value.trim():'';
    var box=document.getElementById('pjx-new'); if(!box) return;
    this.hide();
    var myDept=(profile&&profile.dept)||'';
    box.hidden=false;
    box.innerHTML=
      '<div class="pjx-new-title">＋ 새 프로젝트 등록</div>'+
      '<label class="pjx-lab">프로젝트 이름</label>'+
      '<input type="text" class="pjx-q" id="pjx-new-name" maxlength="80" value="'+escapeHtml(q)+'" placeholder="예: ○○역 연결통로 타당성조사 용역" oninput="PjPick.liveSim()">'+
      '<div class="pjx-new-grid">'+
        '<div><label class="pjx-lab">본부</label><select class="pjx-q" id="pjx-new-dept">'+
          this.deptList().map(function(d){ return '<option'+(d===myDept?' selected':'')+'>'+escapeHtml(d)+'</option>'; }).join('')+'</select></div>'+
        '<div><label class="pjx-lab">발주처 (안 적어도 됩니다)</label><input type="text" class="pjx-q" id="pjx-new-client" maxlength="40" placeholder="예: 해안건축"></div>'+
      '</div>'+
      '<div id="pjx-new-sim"></div>'+
      '<div class="pjx-new-btns">'+
        '<button type="button" class="pjx-btn main" id="pjx-new-go" onclick="PjPick.submitNew(false)">등록</button>'+
        '<button type="button" class="pjx-btn" onclick="PjPick.closeNew()">취소</button>'+
      '</div>'+
      '<div class="pjx-status">등록하면 바로 이 프로젝트로 보고할 수 있습니다. 임시 코드(TEMP-날짜-번호)가 붙고 노션 프로젝트 마스터에 올라갑니다. 정식 코드는 담당자가 정합니다.</div>';
    var n=document.getElementById('pjx-new-name'); if(n) n.focus();
    this.liveSim();
  },
  // 2026-10-02 이름을 적는 동안(등록을 누르기 전에) 비슷한 프로젝트를 보여 준다 — 받아 둔 목록에서 바로 찾는다
  liveSim:function(){
    var self=this, el=document.getElementById('pjx-new-name'), box=document.getElementById('pjx-new-sim');
    if(!el||!box||!self.list) return;
    var words=String(el.value||'').trim().split(/\s+/).map(self.norm).filter(function(w){ return w.length>=2; });
    if(!words.length){ box.innerHTML=''; self._sim=null; return; }
    var out=[];
    self.list.forEach(function(p,i){
      var n=0;
      words.forEach(function(w){
        if(p._k.indexOf(w)>=0) n+=1;
        else if(w.length>=4 && p._k.indexOf(w.slice(0,w.length-2))>=0) n+=0.5;   // 끝 두 글자가 달라도(용역/사업 등) 반쯤 맞은 것으로
      });
      if(n>0) out.push({p:p,n:n,i:i});
    });
    out.sort(function(a,b){ return b.n-a.n || a.i-b.i; });
    var sim=out.slice(0,5).map(function(x){ return x.p; });
    if(!sim.length){ self._sim=null; box.innerHTML='<div class="pjx-status">비슷한 이름의 프로젝트가 없습니다. 새로 등록하시면 됩니다.</div>'; return; }
    self._sim=sim;
    box.innerHTML='<div class="pjx-sim-title">비슷한 프로젝트가 이미 있습니다. 이 중에 있으면 눌러서 고르세요 (새로 등록하지 않습니다).</div>'+
      sim.map(function(p,i){
        var meta=[p.dept,p.status||p.stage,p.client?('발주 '+p.client):''].filter(Boolean).join(' · ');
        return '<div class="pjx-item pjx-sim" onclick="PjPick.pickSimilar('+i+')">'+
                 '<span class="pjx-code">'+escapeHtml(p.code)+'</span>'+escapeHtml(p.name)+self.tagHtml(p)+
                 (meta?'<div class="pjx-meta">'+escapeHtml(meta)+'</div>':'')+'</div>';
      }).join('');
  },
  closeNew:function(){ var box=document.getElementById('pjx-new'); if(box){ box.hidden=true; box.innerHTML=''; } this._newBusy=false; this._sim=null; },
  submitNew:function(force){
    var self=this;
    if(self._newBusy) return;
    var name=String((document.getElementById('pjx-new-name')||{}).value||'').replace(/\s+/g,' ').trim();
    var dept=String((document.getElementById('pjx-new-dept')||{}).value||'');
    var client=String((document.getElementById('pjx-new-client')||{}).value||'').trim();
    if(name.replace(/\s/g,'').length<3){ toast('프로젝트 이름을 3글자 이상 적어 주세요'); return; }
    if(!profile||!profile.email){ toast('로그인 정보가 없습니다'); return; }
    self._newBusy=true;
    var go=document.getElementById('pjx-new-go'); if(go){ go.disabled=true; go.textContent='확인하는 중...'; }
    var done=function(){ self._newBusy=false; var g=document.getElementById('pjx-new-go'); if(g){ g.disabled=false; g.textContent='등록'; } };
    // 응답이 유실돼 다시 보내져도 서버가 "이미 있는 줄"로 답하므로 두 줄이 생기지 않는다
    gasPostRetry({token:APPS_SCRIPT_TOKEN,action:'pj_pick_register',name:name,dept:dept,client:client,email:profile.email,force:!!force},{tries:3})
    .then(function(d){
      done();
      if(!d||!d.ok){ toast('⚠️ '+((d&&(d.error||d.message))||'등록하지 못했습니다')); return; }
      if(d.need_confirm){ self.renderSimilar(d.similar||[]); return; }
      var p=d.project; if(!p) return;
      self.addToList(p);
      self.closeNew();
      var inp=document.getElementById('pjx-q'); if(inp) inp.value='';
      self.pick(self.byCode(p.code)||p);
      toast(d.existed?('이미 등록된 프로젝트입니다 — '+p.code+' 로 골랐습니다')
            :d.notion_created?('✅ 등록했습니다 — '+p.code+' (노션 프로젝트 마스터에도 올라감)')
            :d.notion_error?('✅ 등록했습니다 ('+p.code+') · 노션에는 잠시 뒤 자동으로 올라갑니다')
            :('✅ 등록했습니다 — '+p.code));
    })
    .catch(function(){ done(); toast('⚠️ 등록하지 못했습니다. 다시 눌러 주세요'); });
  },
  renderSimilar:function(sim){
    var self=this, box=document.getElementById('pjx-new-sim'); if(!box) return;
    self._sim=sim;
    box.innerHTML='<div class="pjx-sim-title">비슷한 프로젝트가 이미 있습니다. 이 중에 있으면 눌러서 고르세요.</div>'+
      sim.map(function(p,i){
        var meta=[p.dept,p.status||p.stage,p.client?('발주 '+p.client):''].filter(Boolean).join(' · ');
        return '<div class="pjx-item pjx-sim" onclick="PjPick.pickSimilar('+i+')">'+
                 '<span class="pjx-code">'+escapeHtml(p.code)+'</span>'+escapeHtml(p.name)+self.tagHtml(p)+
                 (meta?'<div class="pjx-meta">'+escapeHtml(meta)+'</div>':'')+'</div>';
      }).join('')+
      '<button type="button" class="pjx-btn warn" onclick="PjPick.submitNew(true)">이 중에 없음 — 그래도 새로 등록</button>';
  },
  pickSimilar:function(i){
    var p=(this._sim||[])[i]; if(!p) return;
    this.closeNew();
    var inp=document.getElementById('pjx-q'); if(inp) inp.value='';
    this.pick(this.byCode(p.code)||p);
  },

  // ── 2026-10-01 프로젝트 목록 전체 보기 (시트를 표로 훑어보기) ──
  openAll:function(){
    var self=this, box=document.getElementById('pjx-all'); if(!box) return;
    if(!box.hidden){ box.hidden=true; box.innerHTML=''; return; }
    box.hidden=false;
    if(!self.list){ box.innerHTML='<div class="pjx-none">프로젝트 목록을 불러오는 중입니다...</div>'; self._allWait=true; self.load(); return; }
    var depts=[]; self.list.forEach(function(p){ if(p.dept&&depts.indexOf(p.dept)<0) depts.push(p.dept); });
    self.allOpen=null;
    box.innerHTML=
      '<div class="pjx-all-head">'+
        '<select class="pjx-q" id="pjx-all-dept" onchange="PjPick.renderAll()"><option value="">본부 전체</option>'+
          depts.map(function(d){ return '<option>'+escapeHtml(d)+'</option>'; }).join('')+'</select>'+
        '<select class="pjx-q" id="pjx-all-kind" onchange="PjPick.renderAll()"><option value="">구분 전체</option><option value="notion">노션</option><option value="sheet">노션 외 목록</option><option value="new">임시 코드</option></select>'+
        '<input type="text" class="pjx-q" id="pjx-all-q" placeholder="이 안에서 찾기" oninput="PjPick.renderAll()" style="flex:1;min-width:120px">'+
        '<button type="button" class="pjx-btn" onclick="PjPick.openAll()">닫기</button>'+
      '</div>'+
      '<div class="pjx-all-count" id="pjx-all-count"></div>'+
      '<div class="pjx-all-body" id="pjx-all-body"></div>';
    self.renderAll();
  },
  renderAll:function(){
    var self=this, body=document.getElementById('pjx-all-body'); if(!body||!self.list) return;
    var dept=String((document.getElementById('pjx-all-dept')||{}).value||'');
    var kind=String((document.getElementById('pjx-all-kind')||{}).value||'');
    var words=String((document.getElementById('pjx-all-q')||{}).value||'').trim().split(/\s+/).map(self.norm).filter(Boolean);
    var rows=self.list.filter(function(p){
      if(dept && p.dept!==dept) return false;
      if(kind==='notion' && !p.notion) return false;
      if(kind==='sheet' && p.notion) return false;
      if(kind==='new' && !p.temp) return false;
      for(var k=0;k<words.length;k++){ if(p._k.indexOf(words[k])<0) return false; }
      return true;
    });
    self._allRows=rows;
    var cnt=document.getElementById('pjx-all-count');
    if(cnt) cnt.textContent='프로젝트 목록 시트 '+self.list.length+'건 중 '+rows.length+'건. 줄을 누르면 시트에 적힌 내용이 펼쳐집니다.';
    body.innerHTML='<table class="pjx-tbl"><thead><tr><th>코드</th><th>이름</th><th>본부</th><th>단계</th><th>발주처</th><th>구분</th></tr></thead><tbody>'+
      rows.map(function(p,i){
        var open=(self.allOpen===p.code);
        return '<tr class="pjx-tr'+(open?' on':'')+'" onclick="PjPick.toggleAll('+i+')">'+
                 '<td><span class="pjx-code">'+escapeHtml(p.code)+'</span></td>'+
                 '<td>'+escapeHtml(p.name)+'</td>'+
                 '<td>'+escapeHtml(p.dept||'')+'</td>'+
                 '<td>'+escapeHtml(p.status||p.stage||'')+'</td>'+
                 '<td>'+escapeHtml(p.client||'')+'</td>'+
                 '<td>'+self.tagHtml(p)+'</td>'+
               '</tr>'+
               (open?'<tr><td colspan="6">'+self.infoHtml(p)+
                 '<button type="button" class="pjx-btn main" style="margin-top:8px" onclick="PjPick.pickFromAll('+i+')">이 프로젝트로 보고하기</button></td></tr>':'');
      }).join('')+
      (rows.length?'':'<tr><td colspan="6" class="pjx-none">해당하는 프로젝트가 없습니다.</td></tr>')+
      '</tbody></table>';
  },
  toggleAll:function(i){ var p=(this._allRows||[])[i]; if(!p) return; this.allOpen=(this.allOpen===p.code?null:p.code); this.renderAll(); },
  pickFromAll:function(i){
    var p=(this._allRows||[])[i]; if(!p) return;
    var box=document.getElementById('pjx-all'); if(box){ box.hidden=true; box.innerHTML=''; }
    this.pick(p);
  },

  onKey:function(ev){
    var k=ev.key;
    if(k==='ArrowDown'||k==='ArrowUp'){
      if(!this.shown.length) return;
      ev.preventDefault();
      this.sel=(this.sel+(k==='ArrowDown'?1:-1)+this.shown.length)%this.shown.length;
      this.renderResults();
      var on=document.querySelector('#pjx-results .pjx-item.on'); if(on&&on.scrollIntoView) on.scrollIntoView({block:'nearest'});
    } else if(k==='Enter'){
      if(ev.isComposing) return;                  // 한글 조합 중 Enter 는 글자 확정
      ev.preventDefault();
      if(this.shown.length) this.add(this.sel>=0?this.sel:0);
      else if(String((document.getElementById('pjx-q')||{}).value||'').trim() && this.list) this.openNew();   // 결과 없음 → 새 프로젝트 등록 칸
    } else if(k==='Escape'){ this.hide(); }
  },

  add:function(i){ this.pick(this.shown[i]); },
  pick:function(p){
    if(!p) return;
    if(this.picks.some(function(x){ return x.code===p.code; })){ toast('이미 고른 프로젝트입니다'); this.hide(); return; }
    this.syncTexts();
    var _lt=(this.last&&this.last[p.code])||null;   // 2026-10-03 이 프로젝트에 지난번 쓴 내용이 있으면 채워 둔다
    this.picks.push({code:p.code,name:p.name,dept:p.dept||'',status:p.status||p.stage||'',text:_lt?_lt.text:'',lastDate:_lt?_lt.date:''});
    var inp=document.getElementById('pjx-q'); if(inp) inp.value='';
    this.hide(); this.renderCards(); this.save();
    var tas=document.querySelectorAll('#pjx-cards .pjx-ta'); if(tas.length) tas[tas.length-1].focus();
  },

  remove:function(i){ this.syncTexts(); this.picks.splice(i,1); this.renderCards(); this.save(); },

  syncTexts:function(){
    var self=this;
    Array.prototype.forEach.call(document.querySelectorAll('#pjx-cards .pjx-ta'),function(ta){
      var i=parseInt(ta.getAttribute('data-i'),10); if(self.picks[i]) self.picks[i].text=ta.value;
    });
  },
  onText:function(ta){ var i=parseInt(ta.getAttribute('data-i'),10); if(this.picks[i]){ this.picks[i].text=ta.value; this.save(); } if(typeof autosizeTa==='function') autosizeTa(ta); },

  renderCards:function(){
    var box=document.getElementById('pjx-cards'); if(!box) return;
    box.innerHTML=this.picks.map(function(p,i){
      var meta=[p.dept,p.status].filter(Boolean).join(' · ');
      return '<div class="pjx-card">'+
               '<div class="pjx-card-head"><span class="nm"><span class="pjx-code">'+escapeHtml(p.code)+'</span>'+escapeHtml(p.name)+
                 (meta?'<div class="pjx-meta" style="font-weight:400">'+escapeHtml(meta)+'</div>':'')+'</span>'+
                 '<button type="button" class="pjx-del" title="이 프로젝트 빼기" onclick="PjPick.remove('+i+')">✕</button></div>'+
               (p.lastDate?'<div class="pjx-meta" style="color:#8a5a00">지난 보고('+escapeHtml(p.lastDate)+')에 쓴 내용을 채워 두었습니다. 오늘 내용으로 고쳐서 보내세요.</div>':'')+
               '<textarea class="pjx-ta" data-i="'+i+'" rows="'+(p.lastDate?5:3)+'" placeholder="이 프로젝트에서 오늘 한 일을 적어 주세요 (회의·이슈·요청·일정 모두 편하게)" oninput="PjPick.onText(this)">'+escapeHtml(p.text||'')+'</textarea>'+
             '</div>';
    }).join('');
  },

  // ── 2026-10-03 지난 보고 내용 불러오기: 가장 최근 보고한 날의 프로젝트는 칸을 미리 만들어 내용을 채워 둔다 ──
  loadLast:function(){
    var self=this;
    if(self.last||self._lastBusy||!profile||!profile.email) return;
    self._lastBusy=true;
    gasPostRetry({token:APPS_SCRIPT_TOKEN,action:'pj_pick_last',email:profile.email},{tries:2})
    .then(function(d){
      self._lastBusy=false;
      if(!d||!d.ok) return;
      self.last=d.by_code||{};
      var flag=self.KEY+'_auto';
      var done=false; try{ done=(localStorage.getItem(flag)===self.today()); }catch(e){}
      if(done||self.picks.length||!(d.recent||[]).length) return;      // 하루에 한 번만, 이미 고른 것이 있으면 건드리지 않는다
      (d.recent||[]).forEach(function(code){
        var p=self.byCode(code), lt=self.last[code]; if(!p||!lt) return;
        self.picks.push({code:p.code,name:p.name,dept:p.dept||'',status:p.status||p.stage||'',text:lt.text,lastDate:lt.date});
      });
      try{ localStorage.setItem(flag,self.today()); }catch(e){}
      self.renderCards(); self.save();
      if(self.picks.length) self.status('지난 보고('+d.recent_date+')의 프로젝트 '+self.picks.length+'건을 불러와 내용을 채워 두었습니다. 고쳐서 보내거나 ✕ 로 빼 주세요.');
    })
    .catch(function(){ self._lastBusy=false; });
  },
  save:function(){ try{ localStorage.setItem(this.KEY,JSON.stringify({date:this.today(),picks:this.picks})); }catch(e){} },
  restore:function(){
    if(this._restored) return; this._restored=true;
    try{
      var d=JSON.parse(localStorage.getItem(this.KEY)||'null');
      if(d&&d.date===this.today()&&Array.isArray(d.picks)) this.picks=d.picks.filter(function(p){ return p&&p.code&&p.name; });
    }catch(e){}
    this.renderCards();
  },
  clear:function(){ this.picks=[]; this.renderCards(); try{ localStorage.removeItem(this.KEY); }catch(e){} var inp=document.getElementById('pjx-q'); if(inp) inp.value=''; },

  // 정리 요청용. 고른 프로젝트 중 내용이 빈 것이 있으면 안내하고 null.
  collect:function(){
    this.syncTexts();
    for(var i=0;i<this.picks.length;i++){
      if(!String(this.picks[i].text||'').trim()){
        toast('고른 프로젝트 "'+this.picks[i].code+'"에 내용을 적어 주세요 (안 쓸 거면 ✕ 로 빼 주세요)');
        var tas=document.querySelectorAll('#pjx-cards .pjx-ta'); if(tas[i]) tas[i].focus();
        return null;
      }
    }
    this.save();
    return this.picks.map(function(p){ return {code:p.code,name:p.name,text:String(p.text).trim()}; });
  },
  codes:function(){ return this.picks.map(function(p){ return {code:p.code,name:p.name}; }); }
};
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){ PjPick.restore(); });
else setTimeout(function(){ PjPick.restore(); },0);
