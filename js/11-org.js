// 11-org.js — 유관부서 탭 (2026-11-23 유성원)
//   "이 건 누구랑 협의하지?" — 구글 시트 「인명부 마스터」의 기관 · 부서 · 자리를 찾아본다. 읽기만 한다.
//   · 검색: 담당업무 · 이름 · 내선 · 부서. 낱말을 띄어 쓰면 전부 들어 있는 자리만 (예: "지구단위 마포")
//   · 고르기: 본부 → 과 를 고르면 그 과의 자리가 팀별로 나온다
//   · 줄을 누르면 담당업무 전체 · 층 · 기준일이 펼쳐진다. 내선은 눌러서 바로 건다
//   서버: GAS OrgDirectory.js 의 org_tree · org_search (요청의 email 이 직원목록에 있어야 열린다)
//   ★이 저장소는 공개다 — 이름 · 내선 같은 데이터를 이 파일에 적지 않는다. 전부 서버에서 받아 온다.★
//   · 펼친 줄의 「고치기 · 인사이동」 — 사람 바꾸기 · 담당업무 등 · 공석으로 (2026-11-23, GAS org_write · 인증코드 로그인 세션)
//   전역 재사용: profile, APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, escapeHtml, toast, getSession.
var OrgTab = (function () {
  var _inited = false, _units = null, _byId = {}, _kids = {};
  var _q = '', _bureau = '', _dept = '', _items = [], _total = 0, _open = {};
  var _seq = 0, _timer = null, _busy = false, _err = '';
  var STALE_DAYS = 90;

  function _post(payload) {
    payload.token = APPS_SCRIPT_TOKEN;
    payload.email = (typeof profile !== 'undefined' && profile && profile.email) || '';
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return escapeHtml(String(s == null ? '' : s)); }

  function init() {
    if (_inited) { _paint(); return; }
    _inited = true;
    _status('부서 목록을 불러오는 중이에요…');
    _post({ action: 'org_tree' }).then(function (d) {
      if (!d.ok) throw new Error(d.reason === 'not_staff' ? '직원목록에 있는 계정으로 로그인해야 볼 수 있어요' : (d.message || '불러오지 못했어요'));
      _units = d.units || []; _byId = {}; _kids = {};
      _units.forEach(function (u) {
        _byId[u.unit_id] = u;
        (_kids[u.parent_id || ''] = _kids[u.parent_id || ''] || []).push(u);
      });
      _fillBureaus(); _paint();
    }).catch(function (e) { _inited = false; _err = String(e.message || e); _paint(); });
  }

  // 자리가 하나라도 있는 곳만 고르게 한다(아직 사람을 안 넣은 부서는 빼 둔다)
  function _fillBureaus() {
    var sel = $('orgx-bureau'); if (!sel) return;
    var opts = '<option value="">본부 · 실 · 국</option>';
    _units.filter(function (u) { return u.kind === '실·국·본부' && u.seats > 0; })
      .forEach(function (u) { opts += '<option value="' + esc(u.unit_id) + '">' + esc(u.name) + ' (' + u.seats + ')</option>'; });
    sel.innerHTML = opts; sel.value = _bureau;
    _fillDepts();
  }
  function _under(uid, out) {
    (_kids[uid] || []).forEach(function (u) { out.push(u); _under(u.unit_id, out); });
    return out;
  }
  function _fillDepts() {
    var sel = $('orgx-dept'); if (!sel) return;
    var opts = '<option value="">과</option>';
    if (_bureau) {
      _under(_bureau, []).filter(function (u) { return u.kind === '과' && u.seats > 0; })
        .forEach(function (u) { opts += '<option value="' + esc(u.unit_id) + '">' + esc(u.name) + ' (' + u.seats + ')</option>'; });
    }
    sel.innerHTML = opts; sel.value = _dept; sel.disabled = !_bureau;
  }

  function onBureau(v) { _bureau = v; _dept = ''; _fillDepts(); _search(0); }
  function onDept(v) { _dept = v; _search(0); }
  function onInput(v) { _q = v; _search(450); }
  function clearAll() {
    _q = ''; _bureau = ''; _dept = ''; _items = []; _total = 0; _open = {};
    var i = $('orgx-q'); if (i) i.value = '';
    _fillBureaus(); _paint();
  }

  function _search(delay) {
    clearTimeout(_timer);
    var unit = _dept || _bureau, q = _q.replace(/\s+/g, ' ').trim();
    if (!q && !unit) { _items = []; _total = 0; _busy = false; _err = ''; _paint(); return; }
    _busy = true; _err = ''; _paint();
    var my = ++_seq;
    _timer = setTimeout(function () {
      _post({ action: 'org_search', q: q, unit_id: unit, limit: 200 }).then(function (d) {
        if (my !== _seq) return;                      // 늦게 온 옛 답은 버린다
        if (!d.ok) throw new Error(d.message || '찾지 못했어요');
        _items = d.items || []; _total = d.total || 0; _open = {}; _busy = false;
        _items.forEach(function (s) { _byId[s.seat_id] = s; });
        _paint();
      }).catch(function (e) { if (my !== _seq) return; _busy = false; _err = String(e.message || e); _paint(); });
    }, delay || 0);
  }

  function toggle(id) { _open[id] = !_open[id]; _paint(); }

  function _tel(ext) {
    var d = String(ext || '').replace(/\D/g, '');
    return /^0\d{8,10}$/.test(d) ? 'tel:' + d : '';      // 온전한 번호일 때만 건다("7000~1" 같은 표기는 글자로만)
  }
  function _stale(asOf) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(asOf || ''));
    if (!m) return false;
    return (Date.now() - new Date(+m[1], +m[2] - 1, +m[3]).getTime()) / 86400000 > STALE_DAYS;
  }
  function _status(msg) { var b = $('orgx-list'); if (b) b.innerHTML = '<div class="orgx-empty">' + esc(msg) + '</div>'; }

  function _row(s) {
    var p = s.path || [], tail = p.slice(-2).join(' › '), up = p.slice(1, -2).join(' › ');
    var tel = _tel(s.ext), open = !!_open[s.seat_id];
    var name = s.vacant ? '<span class="orgx-vacant">공석</span>' : esc(s.name || '이름 미확인');
    var h = '<div class="orgx-row' + (open ? ' open' : '') + '">' +
      '<button type="button" class="orgx-main" onclick="OrgTab.toggle(\'' + esc(s.seat_id) + '\')" aria-expanded="' + open + '">' +
        '<span class="orgx-name">' + name + ' <span class="orgx-role">' + esc(s.role || '') + '</span></span>' +
        '<span class="orgx-where">' + esc(tail) + '</span>' +
      '</button>' +
      (s.ext ? (tel ? '<a class="orgx-tel" href="' + tel + '">' + esc(s.ext) + '</a>' : '<span class="orgx-tel plain">' + esc(s.ext) + '</span>') : '<span class="orgx-tel plain">내선 없음</span>');
    if (open) {
      h += '<div class="orgx-more">' +
        (up ? '<div class="orgx-up">' + esc(up) + '</div>' : '') +
        (s.duties ? '<div class="orgx-duties">' + esc(s.duties) + '</div>' : '<div class="orgx-dim">담당업무가 적혀 있지 않아요</div>') +
        '<div class="orgx-meta">' +
          (s.floor ? '<span>' + esc(s.floor) + '층</span>' : '') +
          (s.grade ? '<span>' + esc(s.grade) + '</span>' : '') +
          (s.email ? '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>' : '') +
          (s.as_of ? '<span' + (_stale(s.as_of) ? ' class="warn"' : '') + '>' + esc(s.as_of) + ' 기준' + (_stale(s.as_of) ? ' · 확인한 지 오래됐어요' : '') + '</span>' : '') +
        '</div>' +
        (s.needs_check ? '<div class="orgx-check">확인 필요 — ' + esc(s.needs_check) + '</div>' : '') +
        '<button type="button" class="orgx-btn orgx-edit" onclick="OrgTab.edit(\'' + esc(s.seat_id) + '\')">✎ 고치기 · 인사이동</button>' +
      '</div>';
    }
    return h + '</div>';
  }

  function _paint() {
    var box = $('orgx-list'), cnt = $('orgx-count'); if (!box) return;
    if (cnt) cnt.textContent = '';
    if (_err) {
      box.innerHTML = '<div class="orgx-empty">불러오지 못했어요. ' + esc(_err) + '<br><button type="button" class="orgx-btn" onclick="OrgTab.retry()">다시 시도</button></div>';
      return;
    }
    if (!_units) return;
    var unit = _dept || _bureau, q = _q.trim();
    if (_busy) { _status('찾는 중이에요…'); return; }
    if (!q && !unit) {
      box.innerHTML = '<div class="orgx-empty">담당업무나 구 이름으로 찾아 보세요.<br><span class="orgx-dim">예: 역세권 · 지구단위 마포 · 내선 뒤 네 자리</span><br><span class="orgx-dim">또는 위에서 본부와 과를 골라요.</span></div>';
      return;
    }
    if (!_items.length) {
      box.innerHTML = '<div class="orgx-empty">맞는 자리가 없어요.<br><span class="orgx-dim">낱말을 줄이거나 다른 말로 찾아 보세요. 아직 등록 안 된 부서일 수 있어요.</span></div>';
      return;
    }
    if (cnt) cnt.textContent = _total > _items.length ? (_items.length + '명 보임 (전체 ' + _total + '명)') : (_total + '명');
    // 부서를 골랐을 땐 팀별로 묶고, 검색일 땐 맞은 순서 그대로
    var h = '';
    if (!q && unit) {
      var last = null;
      _items.forEach(function (s) {
        var team = (s.path || []).slice(-1)[0] || '';
        if (team !== last) { h += '<div class="orgx-team">' + esc(team) + '</div>'; last = team; }
        h += _row(s);
      });
    } else {
      _items.forEach(function (s) { h += _row(s); });
    }
    box.innerHTML = h;
  }


  // ── 고치기 · 인사이동 (2026-11-23) ─────────────────────────
  //   GAS org_write(OrgWrite.js) 하나로 쓴다 — 힘내자 대시보드와 같은 창구 · 같은 규칙(자리이력 · 변경이력 · 같은 이름 확인).
  //   누가 고쳤는지는 인증코드 로그인 세션으로 서버가 정한다(직원목록 이름). 한 번에 10초 안팎.
  var _byId = {};
  function _write(payload) {
    payload.session = (typeof getSession === 'function') ? getSession() : '';
    payload.action = 'org_write';
    return _post(payload);
  }
  function _modal(title, inner, onSave, saveLabel) {
    var wrap = document.createElement('div');
    wrap.className = 'orgx-scrim';
    wrap.innerHTML = '<div class="orgx-modal" role="dialog" aria-modal="true">' +
      '<div class="orgx-mhead"><b>' + esc(title) + '</b><button type="button" class="orgx-x" aria-label="닫기">×</button></div>' +
      '<div class="orgx-mbody"></div>' +
      '<div class="orgx-mfoot"><span class="orgx-saving" hidden>저장하는 중이에요 — 10초쯤 걸려요</span>' +
      '<button type="button" class="orgx-btn orgx-cancel">취소</button><button type="button" class="orgx-btn orgx-save">' + esc(saveLabel || '저장') + '</button></div></div>';
    var body = wrap.querySelector('.orgx-mbody');
    if (typeof inner === 'string') body.innerHTML = inner; else body.appendChild(inner);
    var close = function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
    wrap.querySelector('.orgx-x').onclick = close;
    wrap.querySelector('.orgx-cancel').onclick = close;
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    var save = wrap.querySelector('.orgx-save'), hint = wrap.querySelector('.orgx-saving');
    if (onSave) {
      save.onclick = function () {
        if (save.disabled) return;
        save.disabled = true; hint.hidden = false;
        Promise.resolve(onSave(body, close)).catch(function (e) {
          toast('저장하지 못했어요 — ' + (e && e.message || e));
        }).then(function () { save.disabled = false; hint.hidden = true; });
      };
    } else save.hidden = true;
    document.body.appendChild(wrap);
    return { body: body, close: close };
  }
  function _val(body, name) { var n = body.querySelector('[name="' + name + '"]'); return n ? String(n.value || '').trim() : ''; }

  // 같은 이름 후보 — 이 사람 / 새 사람으로 / 그만두기 → {person_key} · 'new' · null
  function _choose(cands, name) {
    return new Promise(function (resolve) {
      var h = '<p class="orgx-p">인명부에 <b>' + esc(name) + '</b> 이(가) 이미 있어요. 같은 사람인가요?</p>';
      cands.forEach(function (c, i) {
        h += '<button type="button" class="orgx-cand" data-i="' + i + '"><b>' + esc(c.name) + '</b> <span class="orgx-role">' + esc(c.org || '기관 모름') + '</span>' +
             '<span class="orgx-where">' + esc([c.memo, c.phone].filter(Boolean).join(' · ') || c.person_key) + '</span><span class="orgx-pick">이 사람이에요</span></button>';
      });
      h += '<p class="orgx-dim">다른 사람이면 「새 사람으로」. 잘못 고르면 두 사람이 한 사람으로 묶여요.</p>' +
           '<button type="button" class="orgx-btn orgx-new">새 사람으로</button>';
      var done = false;
      var m = _modal('같은 사람인가요?', h, null);
      var fin = function (v) { if (done) return; done = true; m.close(); resolve(v); };
      Array.prototype.forEach.call(m.body.querySelectorAll('.orgx-cand'), function (b) {
        b.onclick = function () { fin({ person_key: cands[+b.getAttribute('data-i')].person_key }); };
      });
      m.body.querySelector('.orgx-new').onclick = function () { fin('new'); };
      var x = m.body.parentNode.querySelector('.orgx-x'), c = m.body.parentNode.querySelector('.orgx-cancel');
      x.onclick = c.onclick = function () { fin(null); };
    });
  }
  function _writePerson(payload) {
    return _write(payload).then(function (j) {
      if (j.ok || j.reason !== 'needs_choice') return j;
      return _choose(j.candidates || [], payload.person.name).then(function (pick) {
        if (!pick) return null;
        var p2 = {}; for (var k in payload) p2[k] = payload[k];
        if (pick === 'new') { var np = {}; for (var q in payload.person) np[q] = payload.person[q]; np['new'] = true; p2.person = np; }
        else p2.person = pick;
        return _write(p2);
      });
    });
  }

  function edit(seatId) {
    var s = _byId[seatId];
    if (!s) return;
    if (!getSession || !getSession()) { toast('인증코드로 로그인한 뒤 고칠 수 있어요'); return; }
    var mode = 'person';
    var box = document.createElement('div');
    var paint = function () {
      var tabs = [['person', '사람 바꾸기(인사이동)'], ['edit', '담당업무 · 내선 등'], ['vacate', '공석으로']].map(function (t) {
        return '<button type="button" class="orgx-chip' + (mode === t[0] ? ' on' : '') + '" data-m="' + t[0] + '">' + t[1] + '</button>';
      }).join('');
      var f = '';
      if (mode === 'person') {
        f = '<label class="orgx-l">새로 온 사람 이름 *<input class="orgx-in" name="name"></label>' +
            '<label class="orgx-l">전화(있으면)<input class="orgx-in" name="phone"></label>' +
            '<label class="orgx-l">이메일(있으면)<input class="orgx-in" name="email"></label>' +
            '<p class="orgx-dim">' + (s.vacant ? '' : esc(s.name || '지금 사람') + ' 은(는) 자리이력에 「끝」으로 남아요. ') + '같은 이름이 있으면 같은 사람인지 물어봐요.</p>';
      } else if (mode === 'edit') {
        f = '<label class="orgx-l">직책<input class="orgx-in" name="직책" value="' + esc(s.role || '') + '"></label>' +
            '<label class="orgx-l">내선(전화)<input class="orgx-in" name="내선" value="' + esc(s.ext || '') + '"></label>' +
            '<label class="orgx-l">이메일<input class="orgx-in" name="이메일" value="' + esc(s.email || '') + '"></label>' +
            '<label class="orgx-l">담당업무<textarea class="orgx-in" name="담당업무" rows="5">' + esc(s.duties || '') + '</textarea></label>' +
            '<label class="orgx-l">확인 필요 메모<input class="orgx-in" name="확인필요" value="' + esc(s.needs_check || '') + '"></label>';
      } else {
        f = '<p class="orgx-p">' + esc(s.name || '지금 사람') + ' 을(를) 이 자리에서 빼고 공석으로 둬요. 자리는 남고 자리이력에 「끝」으로 기록돼요.</p>';
      }
      box.innerHTML = '<p class="orgx-dim">' + esc((s.path || []).slice(-2).join(' › ')) + ' · ' + esc(s.role || '') + ' — 지금 ' + esc(s.vacant ? '공석' : (s.name || '이름 미확인')) + '</p>' +
                      '<div class="orgx-chips">' + tabs + '</div>' + f;
      Array.prototype.forEach.call(box.querySelectorAll('.orgx-chip'), function (b) { b.onclick = function () { mode = b.getAttribute('data-m'); paint(); }; });
    };
    paint();
    _modal('자리 고치기', box, function (body, close) {
      var p;
      if (mode === 'person') {
        var nm = _val(body, 'name');
        if (!nm) { toast('이름을 적어 주세요'); return; }
        p = _writePerson({ op: 'seat_person', seat_id: s.seat_id, person: { name: nm, phone: _val(body, 'phone'), email: _val(body, 'email') } });
      } else if (mode === 'edit') {
        var now = { '직책': s.role, '내선': s.ext, '이메일': s.email, '담당업무': s.duties, '확인필요': s.needs_check }, fields = {}, n = 0;
        Object.keys(now).forEach(function (k) { var v = _val(body, k); if ((now[k] || '') !== v) { fields[k] = v; n++; } });
        if (!n) { toast('바뀐 칸이 없어요'); return; }
        p = _write({ op: 'seat_edit', seat_id: s.seat_id, fields: fields });
      } else {
        p = _write({ op: 'seat_vacate', seat_id: s.seat_id });
      }
      return p.then(function (j) {
        if (!j) return;                               // 같은 사람 고르기에서 그만둠
        if (!j.ok) { toast(j.reason === 'session_invalid' ? '로그인이 풀렸어요 — 다시 로그인해 주세요' : (j.message || '저장하지 못했어요')); return; }
        toast('고쳤어요 — 변경이력에 남았어요');
        close();
        _search(0);                                   // 서버 캐시는 고칠 때 지워졌다 — 바로 다시 찾는다
      });
    });
  }

  function retry() { _err = ''; if (!_units) init(); else _search(0); }

  return { init: init, onBureau: onBureau, onDept: onDept, onInput: onInput, clear: clearAll, toggle: toggle, retry: retry, edit: edit };
})();
