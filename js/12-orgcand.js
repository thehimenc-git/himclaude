// 12-orgcand.js — 마스터 탭 「사람」: 인명부 후보 정리 (승인자 전용, 2026-11-24 새로 짬)
//   한 줄에 질문 하나, 줄마다 바로 누른다. 무엇이 문제인지 · 무엇으로 고칠지 · 아니면 누구인지만 보인다.
//   질문과 기본 답은 GAS OrgAsk.js 가 만든다(it.ask). 힘내자 「인명부 정리」도 같은 것을 그린다 — 규칙이 두 벌이 되지 않게.
//   누르면 줄이 바로 사라지고, 몇 초 모았다가 여러 건을 한 번에 보낸다(org_cand_resolve items). 그 사이 되돌릴 수 있다.
//   한 건씩 사람이 누른다 — 「전부 맞아요」는 없다. 같은 이름이면 누구인지 한 번 더 묻는다.
//   읽기 · 처리 모두 인증코드 로그인 세션. 이메일만으로는 안 열린다.
//   전역 재사용: profile, APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, escapeHtml, toast, getSession, MasterTab.
var OrgCand = (function () {
  var _items = [], _loaded = false, _loading = false, _err = '';
  var _box = null, _filter = 'all', _q = '', _shown = 30;
  var _open = {};       // cand_id → { mode: 'choose' | 'name' | 'part', body, choices, keys, err }
  var _queue = [];      // 아직 안 보낸 답 [{ it, body, at }]
  var _sending = 0, _timer = null, _saved = 0;
  var HOLD = 5000, BATCH = 15;
  var KINDS = [['all', '전체'], ['사람이 바뀌었나요?', '담당 바뀜'], ['지금 담당?', '지금 담당'], ['사업에 더할까?', '사업에 넣기'], ['같은 사람?', '같은 사람'], ['명함과 같은 사람?', '명함']];

  function _esc(s) { return escapeHtml(String(s == null ? '' : s)); }
  function _post(payload, keep) {
    payload.token = APPS_SCRIPT_TOKEN;
    payload.email = (profile && profile.email) || '';
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), keepalive: !!keep
    }).then(function (r) { return r.json(); });
  }
  function _sess() { return (typeof getSession === 'function') ? getSession() : ''; }
  function _find(cid) { return _items.filter(function (x) { return x.cand_id === cid; })[0]; }

  // ── 불러오기 ──
  function load(force) {
    if (_loading || (_loaded && !force)) return;
    var sess = _sess();
    if (!sess) { _err = '인증코드로 로그인하면 사람 목록이 보여요'; _render(); return; }
    _loading = true; _err = '';
    _post({ action: 'org_cand_list', session: sess })
      .then(function (j) {
        if (j && j.reason === 'session_invalid') { _err = '로그인이 풀렸어요 — 인증코드로 다시 로그인해 주세요'; return; }
        if (!j || !j.ok) throw new Error((j && j.message) || '응답 없음');
        var waiting = {};
        _queue.forEach(function (q) { waiting[q.it.cand_id] = 1; });       // 보내기 전인 답은 다시 보이지 않게
        _items = (j.items || []).filter(function (x) { return !waiting[x.cand_id]; });
        _loaded = true;
      })
      .catch(function (e) { console.error('[orgcand] list', e); _err = '사람 후보를 불러오지 못했어요'; })
      .then(function () {
        _loading = false;
        _count();
        if (typeof MasterTab !== 'undefined' && MasterTab.orgAlerts) MasterTab.orgAlerts(_items);
        _render();
      });
  }
  function count() { return _items.length; }
  function _count() {
    var n = document.getElementById('mt-org-n');
    if (n) n.textContent = _loaded ? String(_items.length) : '';
  }
  function init(box) {
    _box = box;
    _injectStyle();
    if (!box.getAttribute('data-oc')) {
      box.setAttribute('data-oc', '1');
      box.innerHTML =
        '<div class="mt-bar"><div class="mt-chips oc-chips"></div><input type="search" class="mt-search oc-search" placeholder="이름·사업 코드로 찾기" /></div>' +
        '<div class="oc-list"></div><div class="oc-bar" hidden></div>';
      box.querySelector('.oc-search').addEventListener('input', function (e) { _q = String(e.target.value || ''); _shown = 30; _renderList(); });
      box.addEventListener('click', _onClick);
      box.addEventListener('input', _onInput);
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.getAttribute('data-oc') === 'name') { var b = e.target.closest('[data-cid]').querySelector('[data-oc="nameok"]'); if (b) b.click(); }
      });
      // 화면을 떠나면 모아 둔 답을 바로 보낸다
      window.addEventListener('pagehide', function () { _flush(true); });
    }
    if (!_loaded) load(); else _render();
  }

  // ── 그리기 ──
  function _visible() {
    var q = _q.replace(/\s+/g, '').toLowerCase();
    return _items.filter(function (it) {
      if (_filter !== 'all' && it.kind !== _filter) return false;
      return !q || JSON.stringify([it.title, it.ask]).replace(/\s+/g, '').toLowerCase().indexOf(q) >= 0;
    });
  }
  function _render() { if (_box && _box.getAttribute('data-oc')) _renderList(); }
  function _chips() {
    var cnt = { all: _items.length };
    _items.forEach(function (it) { cnt[it.kind] = (cnt[it.kind] || 0) + 1; });
    _box.querySelector('.oc-chips').innerHTML = KINDS.filter(function (k) { return k[0] === 'all' || cnt[k[0]]; }).map(function (k) {
      return '<button type="button" class="mt-chip' + (_filter === k[0] ? ' on' : '') + '" data-oc="filter" data-f="' + _esc(k[0]) + '">' + k[1] + ' <span>' + (cnt[k[0]] || 0) + '</span></button>';
    }).join('');
  }
  function _renderList() {
    _chips();
    var list = _box.querySelector('.oc-list');
    if (_err) { list.innerHTML = '<div class="mt-empty err">' + _esc(_err) + ' <button type="button" class="mt-btn" data-oc="reload">다시 시도</button></div>'; return; }
    if (!_loaded) { list.innerHTML = '<div class="mt-empty">불러오는 중이에요… (처음엔 몇 초 걸려요)</div>'; return; }
    var vis = _visible();
    if (!vis.length) { list.innerHTML = '<div class="mt-empty">' + (_q ? '찾는 이름이 없어요' : '정리할 사람이 없어요') + '</div>'; return; }
    var h = '';
    vis.slice(0, _shown).forEach(function (it) { h += _rowHtml(it); });
    if (vis.length > _shown) h += '<button type="button" class="mt-btn oc-more" data-oc="more">더 보기 (' + (vis.length - _shown) + ')</button>';
    list.innerHTML = h;
  }
  function _redraw(it) {
    var el = _box && _box.querySelector('[data-cid="' + it.cand_id + '"]');
    if (el) el.outerHTML = _rowHtml(it);
  }
  function _bar() {
    var b = _box && _box.querySelector('.oc-bar');
    if (!b) return;
    var n = _queue.length;
    b.hidden = !n && !_sending;
    b.innerHTML = '<span>' + (n ? n + '건 골랐어요' : '') + (_sending ? (n ? ' · ' : '') + _sending + '건 저장하는 중' : '') + '</span>' +
      (n ? '<button type="button" class="mt-btn" data-oc="undo">방금 것 되돌리기</button>' : '');
  }

  function _btn(act, label, cls, extra) { return '<button type="button" class="mt-btn' + (cls ? ' ' + cls : '') + '" data-oc="' + act + '"' + (extra || '') + '>' + _esc(label) + '</button>'; }
  function _who(x) { return '<b>' + _esc(x.name) + '</b>' + (x.sub ? ' <span class="oc-dim">' + _esc(x.sub) + '</span>' : ''); }
  function _rowHtml(it) {
    var a = it.ask, o = _open[it.cand_id];
    var h = '<div class="oc-row" data-cid="' + _esc(it.cand_id) + '">';
    if (!a) return h + '<div class="oc-ask">' + _esc(it.title) + '</div><div class="oc-sub oc-dim">이 화면에서 못 다루는 후보예요. 새로고침해 주세요.</div></div>';
    h += '<div class="oc-txt"><div class="oc-ask">' + _esc(a.q) + '</div>';
    if (a.from && a.to) h += '<div class="oc-sub">' + _who(a.from) + ' <span class="oc-arr">' + (it.kind === '같은 사람?' || it.kind === '명함과 같은 사람?' ? '=' : '→') + '</span> ' + _who(a.to) + '</div>';
    else if (a.from) h += '<div class="oc-sub">' + _esc(a.from.label) + ' ' + _who(a.from) + '</div>';
    if (a.many && !(o && o.mode === 'part')) h += a.many.map(function (p) { return '<div class="oc-sub">· ' + _who(p) + '</div>'; }).join('');
    if (a.why) h += '<div class="oc-sub oc-dim">' + _esc(a.why) + '</div>';
    h += '</div>';
    if (o) return h + _openHtml(it, a, o) + '</div>';
    h += '<div class="oc-btns">';
    if (a.first) (a.choose || []).forEach(function (c, i) { h += '<button type="button" class="mt-btn oc-pick" data-oc="pick" data-i="' + i + '"><b>' + _esc(c.label) + '</b><span>' + _esc(c.sub) + '</span></button>'; });
    if (a.yes) h += _btn('yes', a.yesShort || '맞아요', 'primary');
    if (a.nameFirst && (a.extra || []).length) a._ex = 1;
    if (a.nameFirst) h += '<input type="text" class="mt-search oc-name" data-oc="name" maxlength="20" placeholder="새 담당 이름" aria-label="새 담당 이름" />' + _btn('nameok', '저장', 'primary');
    else if (a.other) h += _btn('other', '다른 사람');
    if (a.many) h += _btn('part', '일부만');
    h += _btn('no', a.noShort || '아니에요');
    if (a._ex) h += _btn('other', '⋯', 'oc-quiet', ' aria-label="다른 답"');
    return h + '</div></div>';
  }
  function _openHtml(it, a, o) {
    var h = '<div class="oc-open">';
    if (o.err) h += '<div class="oc-err">' + _esc(o.err) + '</div>';
    if (o.mode === 'choose') {
      h += '<div class="oc-sub"><b>' + _esc(o.title || a.chooseQ || '누구인가요?') + '</b></div><div class="oc-btns">';
      (o.choices || []).forEach(function (c, i) { h += '<button type="button" class="mt-btn oc-pick" data-oc="choice" data-i="' + i + '"><b>' + _esc(c.label) + '</b><span>' + _esc(c.sub) + '</span></button>'; });
      h += '</div>';
    } else if (o.mode === 'name') {
      h += '<div class="oc-btns"><input type="text" class="mt-search oc-name" data-oc="name" maxlength="20" placeholder="' + _esc(o.title || '누구인가요? 이름') + '" aria-label="이름" value="' + _esc(o.name || '') + '" />' + _btn('nameok', '저장', 'primary') + '</div>';
      // 자주 안 쓰는 답(비었어요 · 빠지기만 했어요)은 여기 안에 둔다
      if ((a.extra || []).length && !a.first) h += '<div class="oc-btns">' + a.extra.map(function (x, i) { return _btn('extra', x.label, '', ' data-i="' + i + '"'); }).join('') + '</div>';
    } else if (o.mode === 'part') {
      h += a.many.map(function (p) { return '<label class="oc-p"><input type="checkbox" data-oc="key" data-k="' + _esc(p.person_key) + '"' + (o.keys[p.person_key] ? ' checked' : '') + ' /><span>' + _who(p) + '</span></label>'; }).join('') +
        '<div class="oc-btns">' + _btn('partok', '체크한 사람만 합쳐요', 'primary') + '</div>';
    }
    return h + '<div class="oc-btns">' + _btn('close', '돌아가기', 'oc-quiet') + '</div></div>';
  }

  // ── 누르기 ──
  function _onInput(e) {
    var act = e.target.getAttribute('data-oc'), row = e.target.closest('[data-cid]');
    if (!row) return;
    var o = _open[row.getAttribute('data-cid')];
    if (act === 'key' && o) o.keys[e.target.getAttribute('data-k')] = e.target.checked;
    if (act === 'name' && o) { o.name = e.target.value; var er = row.querySelector('.oc-err'); if (er) er.parentNode.removeChild(er); }
  }
  function _onClick(e) {
    var b = e.target.closest('[data-oc]');
    if (!b || b.tagName === 'INPUT') return;
    var act = b.getAttribute('data-oc');
    if (act === 'filter') { _filter = b.getAttribute('data-f'); _shown = 30; _renderList(); return; }
    if (act === 'reload') { load(true); _renderList(); return; }
    if (act === 'more') { _shown += 30; _renderList(); return; }
    if (act === 'undo') { _undo(); return; }
    var row = b.closest('[data-cid]'), it = row && _find(row.getAttribute('data-cid'));
    if (!it) return;
    var a = it.ask, o = _open[it.cand_id], i = Number(b.getAttribute('data-i') || 0);
    var open = function (x) { _open[it.cand_id] = x; _redraw(it); var n = _box.querySelector('[data-cid="' + it.cand_id + '"] .oc-name'); if (n) n.focus(); };
    if (act === 'close') { delete _open[it.cand_id]; _redraw(it); return; }
    if (act === 'yes') { if (a.yes.choose) open({ mode: 'choose', choices: a.choose }); else _answer(it, a.yes.body); return; }
    if (act === 'no') { _answer(it, a.no.body); return; }
    if (act === 'extra') { _answer(it, a.extra[i].body); return; }
    if (act === 'other') { open({ mode: 'name', base: a.other.mode === 'seat' ? { decision: 'pick' } : { decision: a.other.decision }, seat: a.other.mode === 'seat' }); return; }
    if (act === 'pick') { var c = a.choose[i]; if (c.ask) open({ mode: 'name', title: c.ask, base: c.body }); else _answer(it, c.body); return; }
    if (act === 'choice') { _answer(it, o.choices[i].body); return; }
    if (act === 'part') { var keys = {}; a.many.forEach(function (p) { keys[p.person_key] = true; }); open({ mode: 'part', keys: keys }); return; }
    if (act === 'partok') {
      var on = a.many.filter(function (p) { return o.keys[p.person_key]; }).map(function (p) { return p.person_key; });
      if (on.length < 2) { o.err = '두 사람 이상 체크해 주세요'; _redraw(it); return; }
      _answer(it, { decision: 'same', keys: on, target: on.indexOf(a.target) >= 0 ? a.target : on[0] });
      return;
    }
    if (act === 'nameok') {
      var nm = (row.querySelector('.oc-name').value || '').trim();
      if (!nm) { if (o) { o.err = '이름을 적어 주세요'; _redraw(it); } else open({ mode: 'name', base: { decision: 'move' }, err: '이름을 적어 주세요' }); return; }
      var base = (o && o.base) || { decision: (a.other && a.other.decision) || 'move' }, body = {};
      Object.keys(base).forEach(function (k) { body[k] = base[k]; });
      if (o && o.seat) body.seat_name = nm; else body.person = { name: nm };
      _answer(it, body);
    }
  }

  // ── 모아서 보내기 ──
  function _answer(it, body) {
    if (!_sess()) { toast('인증코드로 로그인한 뒤 정리할 수 있어요'); return; }
    delete _open[it.cand_id];
    _items = _items.filter(function (x) { return x !== it; });
    _queue.push({ it: it, body: body });
    var el = _box.querySelector('[data-cid="' + it.cand_id + '"]');
    if (el) el.parentNode.removeChild(el);
    if (_box.querySelectorAll('.oc-row').length < Math.min(12, _visible().length)) _renderList(); else _chips();
    _count(); _bar();
    clearTimeout(_timer);
    if (_queue.length >= BATCH) _flush(); else _timer = setTimeout(_flush, HOLD);
  }
  function _undo() {
    var q = _queue.pop();
    if (!q) return;
    _items.unshift(q.it);
    _renderList(); _count(); _bar();
    clearTimeout(_timer);
    if (_queue.length) _timer = setTimeout(_flush, HOLD);
  }
  function _back(q, o) { _items.unshift(q.it); _open[q.it.cand_id] = o; }
  function _flush(leaving) {
    clearTimeout(_timer);
    if (!_queue.length || (_sending && leaving !== true)) { if (_queue.length) _timer = setTimeout(_flush, 1500); return; }
    var sess = _sess();
    var batch = _queue.splice(0, BATCH);
    _sending += batch.length;
    _bar();
    var items = batch.map(function (q) { var x = { cand_id: q.it.cand_id }; Object.keys(q.body).forEach(function (k) { x[k] = q.body[k]; }); return x; });
    _post({ action: 'org_cand_resolve', session: sess, items: items }, leaving === true)
      .then(function (j) {
        if (!j || !j.ok) {
          var msg = j && j.reason === 'session_invalid' ? '로그인이 풀렸어요. 다시 로그인한 뒤 눌러 주세요' : (j && j.message) || '저장하지 못했어요. 다시 눌러 주세요';
          batch.slice().reverse().forEach(function (q) { _items.unshift(q.it); });
          toast(msg);
          return;
        }
        var by = {}, bad = 0;
        (j.results || []).forEach(function (r) { by[r.cand_id] = r; });
        batch.slice().reverse().forEach(function (q) {
          var r = by[q.it.cand_id] || { reason: 'later', message: '다시 눌러 주세요' };
          if (r.ok || r.reason === 'done') { if (r.ok) _saved++; return; }
          bad++;
          if (r.reason === 'needs_choice' && r.candidates) {
            _back(q, { mode: 'choose', title: '어느 분인가요?', choices: r.candidates.map(function (c) {
              var body = {}; Object.keys(q.body).forEach(function (k) { body[k] = q.body[k]; });
              if (c.seat_id) body.seat_id = c.seat_id; else body.person = { person_key: c.person_key };
              return { label: c.name, sub: [c.org, c.memo, c.phone].filter(Boolean).join(' · '), body: body };
            }).concat(r.candidates[0] && r.candidates[0].seat_id ? [] : [{ label: '새 사람이에요', sub: '이름만 같은 다른 사람', body: (function () {
              var body = {}; Object.keys(q.body).forEach(function (k) { body[k] = q.body[k]; });
              body.person = { name: (q.body.person || {}).name, 'new': true }; return body; })() }]) });
          } else if (r.reason === 'need_code' && r.codes) {
            _back(q, { mode: 'choose', title: '어느 사업인가요?', choices: r.codes.map(function (c) {
              var body = {}; Object.keys(q.body).forEach(function (k) { body[k] = q.body[k]; }); body.code = c; return { label: c, sub: '', body: body }; }) });
          } else if (q.body.person || q.body.seat_name) {
            _back(q, { mode: 'name', base: _strip(q.body), seat: !!q.body.seat_name, name: q.body.seat_name || (q.body.person || {}).name || '', err: r.message || '저장하지 못했어요' });
          } else { _items.unshift(q.it); toast(r.message || '저장하지 못했어요'); }
        });
        toast((batch.length - bad) + '건 저장했어요' + (bad ? ' · ' + bad + '건은 한 번 더 봐 주세요' : ''));
      })
      .catch(function (e) {
        console.error('[orgcand] resolve', e);
        batch.slice().reverse().forEach(function (q) { _items.unshift(q.it); });
        toast('저장하지 못했어요 — 잠시 뒤 다시 눌러 주세요');
      })
      .then(function () {
        _sending -= batch.length;
        if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('oc-name')) _chips(); else _render();
        _count(); _bar();
        if (_queue.length) _timer = setTimeout(_flush, 800);
      });
  }
  function _strip(body) { var b = {}; Object.keys(body).forEach(function (k) { if (k !== 'person' && k !== 'seat_name' && k !== 'seat_id') b[k] = body[k]; }); return b; }

  function _injectStyle() {
    if (document.getElementById('oc-style')) return;
    var s = document.createElement('style'); s.id = 'oc-style';
    s.textContent = [
      '.oc-list{display:flex;flex-direction:column;background:#fff;border:1px solid var(--line,#e5e5e5);border-radius:12px;padding:0 12px}','.oc-row:last-child{border-bottom:0}',
      '.oc-row{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;padding:12px 4px;border-bottom:1px solid var(--line,#e5e5e5)}',
      '.oc-txt{flex:1 1 280px;min-width:0}',
      '.oc-ask{font-size:15px;font-weight:600;line-height:1.45;word-break:keep-all;overflow-wrap:anywhere}',
      '.oc-sub{font-size:13.5px;line-height:1.5;color:var(--ink2);overflow-wrap:anywhere;margin-top:2px}',
      '.oc-sub b{color:var(--ink,inherit)}',
      '.oc-arr{color:var(--mt);font-weight:700;margin:0 2px}',
      '.oc-dim{color:var(--ink3,#888)}',
      '.oc-btns{display:flex;flex-wrap:wrap;gap:6px;align-items:stretch}',
      '.oc-btns .mt-btn{min-height:42px;min-width:72px;font-size:14px;white-space:nowrap}','.oc-btns .oc-pick{white-space:normal}',
      '.oc-btns .mt-btn.primary{background:var(--mt);border-color:var(--mt);color:#fff;font-weight:600}',
      '.oc-btns .oc-quiet{border-color:transparent;background:none;color:var(--ink3,#888);min-width:0}',
      '.oc-pick{display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:1px;max-width:260px}',
      '.oc-pick span{font-size:12px;color:var(--ink3,#888);font-weight:400;overflow-wrap:anywhere}',
      '.oc-open{flex:1 1 100%;display:flex;flex-direction:column;gap:8px;padding:8px 10px;border-radius:10px;background:var(--mt-tint)}',
      '.oc-err{font-size:13px;color:#c0392b}',
      '.oc-name{flex:1 1 140px;min-height:42px;max-width:240px;box-sizing:border-box}',
      '.oc-p{display:flex;gap:8px;align-items:center;min-height:40px;font-size:13.5px;cursor:pointer}',
      '.oc-p input{width:18px;height:18px;flex:none}',
      '.oc-bar{position:sticky;bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;padding:8px 14px;border-radius:12px;background:var(--mt);color:#fff;font-size:14px;z-index:3}',
      '.oc-bar[hidden]{display:none}',
      '.oc-bar .mt-btn{min-height:36px}',
      '.oc-more{width:100%;margin-top:10px;min-height:42px}',
      '@media (max-width:560px){.oc-btns{flex:1 1 100%}.oc-btns .mt-btn{flex:1 1 0}.oc-btns .oc-pick{flex:1 1 100%;max-width:none}.oc-btns .oc-quiet{flex:0 0 auto}.oc-name{max-width:none}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  return { init: init, load: load, count: count };
})();
