// 11-org.js — 유관부서 탭: 가로 조직도 (2026-11-23 유성원 → 2026-11-24 가로 트리로 새로 짬)
//   "이 사업은 어느 기관 누구랑 하지?" — 사업을 고르면 기관 › 과 › 사람이 왼쪽에서 오른쪽으로 펼쳐진다(사용자 결정). 폰은 세로로.
//   · 첫 화면: 사업 고르기 · 기관으로 보기 · 찾기(업무 · 부서 · 이름 · 번호 — 낱말을 띄어 쓰면 모두 든 사람만)
//   · 한 자리에 한 줄 — 자리로 이은 사업 줄은 지금 앉은 사람을 크게, 전 담당은 옆에 흐리게
//   · 사람을 누르면 담당업무 · 사업 · 기준일, 자리가 있으면 「고치기 · 인사이동」
//   서버: GAS OrgChart.js org_chart 한 벌(인증코드 로그인 세션). 한 번 받아 두고 화면에서 거른다. 고치기는 org_write.
//   ★이 저장소는 공개다 — 이름 · 번호 같은 데이터를 이 파일에 적지 않는다. 전부 서버에서 받아 온다.★
//   전역 재사용: profile, APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, escapeHtml, toast, getSession.
var OrgTab = (function () {
  var _d = null, _loading = false, _err = '', _styled = false;
  var _U = {}, _P = {}, _bySeat = {}, _byId = {};      // 부서 · 사람 · 자리ID → 사업 줄 · 자리ID → 자리
  var _view = { mode: 'home' };                         // home | pj(code) | org(unit)
  var _q = '', _timer = null, _open = {}, _openP = {}, _all = null, _moreOrg = false;
  var STALE_DAYS = 90, OPEN_ALL = 70, SEARCH_MAX = 150;
  var NO_ORG = '기관 모름';

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
  function _norm(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }

  // ── 받아 오기 ──────────────────────────────────
  function init() {
    _style();
    if (_d || _loading) { _paint(); return; }
    _load(false);
  }
  function _load(refresh) {
    var sess = (typeof getSession === 'function') ? getSession() : '';
    if (!sess) { _err = '인증코드로 로그인하면 조직도가 보여요'; _paint(); return; }
    _loading = true; _err = '';
    if (!_d) _paint();
    _post({ action: 'org_chart', session: sess, refresh: !!refresh }).then(function (d) {
      if (!d.ok) throw new Error(d.reason === 'session_invalid' ? '로그인이 풀렸어요 — 인증코드로 다시 로그인해 주세요' : (d.message || '응답 없음'));
      _index(d);
    }).catch(function (e) { console.error('[org] chart', e); _err = String(e.message || e); })
      .then(function () { _loading = false; _paint(); });
  }
  function _index(d) {
    _d = d; _U = {}; _P = d.people || {}; _bySeat = {}; _byId = {};
    d.units.forEach(function (u) { _U[u[0]] = { id: u[0], up: u[1], name: u[2], floor: u[3] }; });
    d.links.forEach(function (l) { if (l.s) (_bySeat[l.s] = _bySeat[l.s] || []).push(l); });
    d.seats.forEach(function (s) {
      s.ids = _path(s.unit_id);
      s.path = s.ids.map(function (u) { return u.name; });
      for (var i = s.ids.length - 1; i >= 0 && !s.floor; i--) s.floor = s.ids[i].floor;
      _byId[s.seat_id] = s;
    });
  }
  function _path(uid) {
    var out = [], seen = {};
    while (uid && _U[uid] && !seen[uid]) { seen[uid] = 1; out.unshift(_U[uid]); uid = _U[uid].up; }
    return out;
  }
  function _canon(key) { return (_P[key] && _P[key][2]) || key || ''; }
  function _nm(key) { return (_P[key] && _P[key][0]) || ''; }

  // ── 줄 만들기 — 자리 하나 · 사람 하나가 한 줄 ─────────
  function _seatRow(s, links, withCodes) {
    var links2 = links || [], now = s.vacant ? '' : s.name, prev = {}, role = s.role, pd = '';
    links2.forEach(function (l) {
      var same = !s.vacant && (_canon(l.p) === _canon(s.person_key) || (now && _nm(l.p) === now));
      if (!same && _nm(l.p) && _nm(l.p) !== now) prev[_nm(l.p)] = 1;
      if (l.d && !pd) pd = l.d;
      // 자리의 직책은 「직원」처럼 뭉뚱그려진 게 있다 → 사업 조직도에 적힌 직책을 쓴다
      if (l.r && (!role || role === '직원' || role === '지원')) role = l.r;
    });
    return { key: 'S:' + s.seat_id, ids: s.ids, name: now, vacant: s.vacant, role: role, tel: s.ext, duties: s.duties, pduties: pd, prev: Object.keys(prev),
             seat: s, codes: withCodes ? _codes(_bySeat[s.seat_id]) : [], org: '' };
  }
  function _codes(links) { var o = {}; (links || []).forEach(function (l) { o[l.c] = 1; }); return Object.keys(o); }
  function _linkRow(l, i) {
    var p = _P[l.p] || [], ids = _path(l.u);
    return { key: 'L:' + i, ids: ids, name: p[0] || '', role: l.r, tel: p[1] || '', duties: l.d, pduties: '', prev: [], seat: null, codes: [], note: l.n, line: l.l,
             org: ids.length ? '' : (p[3] || NO_ORG) };
  }
  // 사업 하나 — 라인(유관부서 · 협업사)마다 줄
  function _pjRows(code) {
    var out = [], seats = {};
    _d.links.forEach(function (l, i) {
      if (l.c !== code) return;
      var s = l.s && _byId[l.s];
      if (!s) { out.push(_linkRow(l, i)); return; }
      if (seats[l.s]) return;
      seats[l.s] = 1;
      var r = _seatRow(s, _bySeat[l.s].filter(function (x) { return x.c === code; }), false);
      r.line = l.l;
      out.push(r);
    });
    return out;
  }
  // 기관 전부 — 자리 + 자리에 안 이은 사업 줄(같은 부서 같은 사람은 한 줄, 사업 코드를 모음)
  function _allRows() {
    if (_allCache && _allCache.d === _d) return _allCache.rows;
    var out = _d.seats.map(function (s) { return _seatRow(s, _bySeat[s.seat_id], true); }), by = {};
    var here = {};
    _d.seats.forEach(function (s) { if (!s.vacant) here[s.unit_id + '|' + _canon(s.person_key)] = 'S:' + s.seat_id; });
    _d.links.forEach(function (l, i) {
      if (l.s && _byId[l.s]) return;
      var k = l.u + '|' + (l.p ? _canon(l.p) : 'x' + i), r;
      if (here[k]) return;                                       // 지금 자리에 앉아 있는 사람이면 자리 줄로 충분하다
      if (by[k]) { r = by[k]; if (r.codes.indexOf(l.c) < 0) r.codes.push(l.c); if (!r.duties) r.duties = l.d; return; }
      r = by[k] = _linkRow(l, i); r.codes = [l.c]; out.push(r);
    });
    _allCache = { d: _d, rows: out };
    return out;
  }
  var _allCache = null;
  function _hay(r) {
    return _norm(r.ids.map(function (u) { return u.name; }).join('') + r.org + r.name + r.role + r.duties + r.pduties + r.prev.join('') + r.codes.join(''));
  }
  function _match(rows, q) {
    var toks = q.split(/\s+/).map(_norm).filter(Boolean);
    return rows.filter(function (r) {
      var h = _hay(r), tel = String(r.tel || '').replace(/\D/g, '');
      return toks.every(function (t) { return h.indexOf(t) >= 0 || (/^\d{3,}$/.test(t) && tel.indexOf(t) >= 0); });
    });
  }

  // ── 나무 ──────────────────────────────────────
  function _tree(rows) {
    var root = { kids: {}, order: [], rows: [], n: 0 };
    rows.forEach(function (r) {
      var cur = root;
      cur.n++;
      var ids = r.ids.length ? r.ids : [{ id: 'x:' + r.org, name: r.org || NO_ORG }];
      ids.forEach(function (u) {
        if (!cur.kids[u.id]) { cur.kids[u.id] = { id: u.id, name: u.name, kids: {}, order: [], rows: [], n: 0 }; cur.order.push(u.id); }
        cur = cur.kids[u.id]; cur.n++;
      });
      cur.rows.push(r);
    });
    return root;
  }
  function _isOpen(key, dflt) { return _open[key] !== undefined ? _open[key] : (_all !== null ? _all : dflt); }
  function _node(n, pre, depth, openAll) {
    var label = n.name;
    // 하나뿐인 단계는 「도시공간본부 › 도시공간기획관」처럼 한 칸으로 줄인다(기관 이름은 그대로)
    while (depth > 0 && !n.rows.length && n.order.length === 1) { n = n.kids[n.order[0]]; label += ' › ' + n.name; }
    var key = pre + '/' + n.id, open = _isOpen(key, openAll);
    var h = '<li><button type="button" class="ct-nd' + (open ? ' on' : '') + '" data-ct="node" data-k="' + esc(key) + '" data-o="' + (open ? 1 : 0) + '" aria-expanded="' + open + '">' +
      '<span>' + esc(label) + '</span><small>' + n.n + '명</small></button>';
    if (open) {
      h += '<ul>' + (n.rows.length ? '<li class="ct-pp"><div class="ct-box">' + n.rows.map(_rowHtml).join('') + '</div></li>' : '') +
        _sorted(n).map(function (k) { return _node(k, key, depth + 1, openAll); }).join('') + '</ul>';
    }
    return h + '</li>';
  }
  function _sorted(n) {      // 「기관 모름」은 맨 뒤로
    return n.order.map(function (id) { return n.kids[id]; }).sort(function (a, b) { return (a.name === NO_ORG) - (b.name === NO_ORG); });
  }
  function _treeHtml(rows, pre, openAll) {
    var t = _tree(rows);
    return '<div class="ct"><ul>' + _sorted(t).map(function (k) { return _node(k, pre, 0, openAll); }).join('') + '</ul></div>';
  }

  function _tel(ext) {
    var d = String(ext || '').split(/[,\/]/)[0].replace(/\D/g, '');
    return /^(0\d{8,10}|1\d{7})$/.test(d) ? 'tel:' + d : '';      // 온전한 번호일 때만 건다("7000~1" 같은 표기는 글자로만)
  }
  function _stale(asOf) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(asOf || ''));
    if (!m) return false;
    return (Date.now() - new Date(+m[1], +m[2] - 1, +m[3]).getTime()) / 86400000 > STALE_DAYS;
  }
  function _rowHtml(r) {
    var open = !!_openP[r.key], tel = _tel(r.tel), telT = String(r.tel || '').split(/[,\/]/)[0].trim();
    var h = '<div class="ct-p' + (open ? ' open' : '') + '"><div class="ct-line"><button type="button" class="ct-pb" data-ct="person" data-k="' + esc(r.key) + '" aria-expanded="' + open + '">' +
      (r.vacant ? '<b class="orgx-vacant">공석</b>' : '<b>' + esc(r.name || '이름 없음') + '</b>') + ' <span>' + esc(r.role || '') + '</span>' +
      (r.prev.length ? ' <i>전 ' + esc(r.prev.slice(0, 2).join('·')) + '</i>' : '') + '</button>' +
      (telT ? (tel ? '<a class="ct-tel" href="' + tel + '">' + esc(telT) + '</a>' : '<span class="ct-tel">' + esc(telT) + '</span>') : '') + '</div>';
    if (!open) return h + '</div>';
    var s = r.seat, bits = [];
    if (s && s.floor) bits.push('<span>' + esc(s.floor) + '층</span>');
    if (s && s.as_of) bits.push('<span' + (_stale(s.as_of) ? ' class="warn"' : '') + '>' + esc(s.as_of) + ' 기준' + (_stale(s.as_of) ? ' · 확인한 지 오래됐어요' : '') + '</span>');
    h += '<div class="ct-more">' +
      (r.pduties ? '<div class="orgx-duties"><b>이 사업</b> ' + esc(r.pduties) + '</div>' : '') +
      (r.duties ? '<div class="orgx-duties">' + esc(r.duties) + '</div>' : (r.pduties ? '' : '<div class="orgx-dim">담당업무가 적혀 있지 않아요</div>')) +
      (r.note ? '<div class="orgx-dim">' + esc(r.note) + '</div>' : '') +
      (s && s.needs_check ? '<div class="orgx-check">확인 필요 — ' + esc(s.needs_check) + '</div>' : '') +
      (r.codes.length ? '<div class="ct-codes">' + r.codes.map(function (c) { return '<button type="button" class="orgx-chip" data-ct="pj" data-c="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>' : '') +
      (bits.length ? '<div class="orgx-meta">' + bits.join('') + '</div>' : '') +
      (s ? '<button type="button" class="orgx-btn orgx-edit" data-ct="edit" data-k="' + esc(s.seat_id) + '">고치기 · 인사이동</button>' : '') + '</div>';
    return h + '</div>';
  }

  // ── 화면 ──────────────────────────────────────
  function _paint() {
    var box = $('orgx-list'), cnt = $('orgx-count'), home = $('orgx-home');
    if (!box) return;
    if (!box.getAttribute('data-ct-on')) { box.setAttribute('data-ct-on', '1'); box.addEventListener('click', _onClick); }
    if (cnt) cnt.textContent = '';
    if (home) home.hidden = _view.mode === 'home' && !_q.trim();
    if (_err && !_d) { box.innerHTML = '<div class="orgx-empty">' + esc(_err) + '<br><button type="button" class="orgx-btn" data-ct="retry">다시 시도</button></div>'; return; }
    if (!_d) { box.innerHTML = '<div class="orgx-empty">조직도를 불러오는 중이에요… (처음엔 10초쯤 걸려요)</div>'; return; }
    var q = _q.replace(/\s+/g, ' ').trim();
    if (_view.mode === 'pj') return _paintPj(box, q);
    if (_view.mode === 'org') return _paintOrg(box, q);
    if (q) return _paintSearch(box, q);
    _paintHome(box);
  }
  function _bar(title, sub, n, dflt) {
    var on = _all === null ? dflt : _all;
    return '<div class="ct-head"><div><b>' + esc(title) + '</b>' + (sub ? ' <span>' + esc(sub) + '</span>' : '') + '</div>' +
      (n ? '<button type="button" class="orgx-btn" data-ct="all" data-o="' + (on ? 0 : 1) + '">' + (on ? '모두 접기' : '모두 펼치기') + '</button>' : '') + '</div>';
  }
  function _paintPj(box, q) {
    var rows = _pjRows(_view.code), all = rows.length;
    if (q) rows = _match(rows, q);
    var h = _bar(_view.code, (_d.projects || {})[_view.code] || '', q ? 0 : rows.length, all <= OPEN_ALL);
    if (!rows.length) h += '<div class="orgx-empty">' + (q ? '이 사업에는 맞는 사람이 없어요<br><button type="button" class="orgx-btn" data-ct="home">모든 기관에서 찾기</button>' : '조직도가 비어 있어요') + '</div>';
    [['유관부서', '유관부서'], ['협업사', '협업사'], ['', '그 밖']].forEach(function (x) {
      var part = rows.filter(function (r) { return (r.line === '유관부서' || r.line === '협업사') ? r.line === x[0] : !x[0]; });
      if (part.length) h += '<div class="orgx-team">' + x[1] + ' ' + part.length + '명</div>' + _treeHtml(part, 'p:' + _view.code + x[0], q ? true : all <= OPEN_ALL);
    });
    box.innerHTML = h;
  }
  function _paintOrg(box, q) {
    var rows = _allRows().filter(function (r) { return (r.ids.length ? r.ids[0].id : 'x:' + r.org) === _view.unit; }), all = rows.length;
    if (q) rows = _match(rows, q);
    var key = 'o:/' + _view.unit;
    if (_open[key] === undefined) _open[key] = true;      // 고른 기관의 첫 칸은 펼쳐 둔다
    box.innerHTML = _bar(_view.name, all + '명', q ? 0 : rows.length, all <= OPEN_ALL) + (rows.length ? _treeHtml(rows, 'o:', q ? true : all <= OPEN_ALL) : '<div class="orgx-empty">맞는 사람이 없어요</div>');
  }
  function _paintSearch(box, q) {
    var pj = Object.keys(_d.projects || {}).filter(function (c) { return _norm(c + _d.projects[c]).indexOf(_norm(q)) >= 0; });
    var rows = _match(_allRows(), q), n = rows.length;
    var h = pj.length ? '<div class="orgx-team">사업</div>' + _pjBtns(pj.slice(0, 8)) : '';
    if (n) h += '<div class="orgx-team">사람 ' + n + '명' + (n > SEARCH_MAX ? ' (' + SEARCH_MAX + '명만 보여요 — 낱말을 더해 보세요)' : '') + '</div>' + _treeHtml(rows.slice(0, SEARCH_MAX), 'q:', true);
    if (!h) h = '<div class="orgx-empty">맞는 곳이 없어요<br><span class="orgx-dim">낱말을 줄이거나 다른 말로 찾아 보세요. 아직 등록 안 된 부서일 수 있어요.</span></div>';
    box.innerHTML = h;
  }
  function _pjBtns(codes) {
    return '<div class="ct-btns">' + codes.map(function (c) {
      return '<button type="button" class="ct-go" data-ct="pj" data-c="' + esc(c) + '"><b>' + esc(c) + '</b><span>' + esc((_d.projects || {})[c] || '') + '</span></button>'; }).join('') + '</div>';
  }
  function _paintHome(box) {
    var codes = Object.keys(_d.projects || {}).sort().reverse(), orgs = {}, list;
    _allRows().forEach(function (r) {
      var id = r.ids.length ? r.ids[0].id : 'x:' + r.org, nm = r.ids.length ? r.ids[0].name : r.org;
      if (!orgs[id]) orgs[id] = { id: id, name: nm, n: 0 };
      orgs[id].n++;
    });
    list = Object.keys(orgs).map(function (k) { return orgs[k]; }).filter(function (o) { return o.name !== NO_ORG; }).sort(function (a, b) { return b.n - a.n; });
    var show = _moreOrg ? list : list.slice(0, 18);
    box.innerHTML = '<div class="orgx-team">사업으로 보기</div>' + _pjBtns(codes) +
      '<div class="orgx-team">기관으로 보기</div><div class="ct-orgs">' + show.map(function (o) {
        return '<button type="button" class="orgx-chip" data-ct="org" data-c="' + esc(o.id) + '" data-n="' + esc(o.name) + '">' + esc(o.name) + ' ' + o.n + '</button>'; }).join('') +
      (list.length > show.length ? '<button type="button" class="orgx-chip" data-ct="moreorg">더 보기 ' + (list.length - show.length) + '</button>' : '') + '</div>';
  }

  function _go(v) { _view = v; _open = {}; _openP = {}; _all = null; var i = $('orgx-q'); _q = ''; if (i) i.value = ''; _paint(); }
  function home() { _go({ mode: 'home' }); }
  function _onClick(e) {
    var b = e.target.closest('[data-ct]');
    if (!b) return;
    var act = b.getAttribute('data-ct'), k = b.getAttribute('data-k');
    if (act === 'retry') { _err = ''; _load(false); return; }
    if (act === 'home') { var keep = _q; _go({ mode: 'home' }); var i = $('orgx-q'); _q = keep; if (i) i.value = keep; _paint(); return; }
    if (act === 'pj') { _go({ mode: 'pj', code: b.getAttribute('data-c') }); return; }
    if (act === 'org') { _go({ mode: 'org', unit: b.getAttribute('data-c'), name: b.getAttribute('data-n') }); return; }
    if (act === 'moreorg') { _moreOrg = true; _paint(); return; }
    if (act === 'all') { _all = b.getAttribute('data-o') === '1'; _open = {}; _paint(); return; }
    if (act === 'node') { _open[k] = b.getAttribute('data-o') !== '1'; _paint(); return; }
    if (act === 'person') { _openP[k] = !_openP[k]; _paint(); return; }
    if (act === 'edit') edit(k);
  }
  function onInput(v) { _q = v; clearTimeout(_timer); _timer = setTimeout(function () { _open = {}; _all = null; _paint(); }, 200); }

  function _style() {
    if (_styled) return;
    _styled = true;
    var s = document.createElement('style');
    s.textContent = [
      '.mode-org .orgx-wrap{max-width:1280px}',
      '.ct-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:10px 2px 4px;font-size:15px}.ct-head span{color:#7a6a55;font-size:13.5px}.ct-head .orgx-btn{margin:0;flex:none}',
      '.ct{overflow-x:auto;padding:4px 2px 12px}',
      '.ct ul{list-style:none;margin:0;padding:0 0 0 28px;position:relative}.ct>ul{padding-left:0}',
      '.ct li{display:flex;align-items:flex-start;position:relative;padding:4px 0}.ct li>ul{margin:-4px 0}',
      '.ct ul ul>li::before{content:"";position:absolute;left:-14px;top:22px;width:14px;border-top:1px solid #cbbfa9}',
      '.ct ul ul>li::after{content:"";position:absolute;left:-14px;top:0;bottom:0;border-left:1px solid #cbbfa9}',
      '.ct ul ul>li:first-child::after{top:22px}.ct ul ul>li:last-child::after{bottom:auto;height:22px}.ct ul ul>li:only-child::after{display:none}',
      '.ct li>ul::before{content:"";position:absolute;left:0;top:22px;width:14px;border-top:1px solid #cbbfa9}',
      '.ct-nd{flex:none;display:flex;gap:8px;align-items:center;max-width:230px;min-height:36px;padding:6px 10px;border:1px solid rgba(0,0,0,.14);border-radius:9px;background:#fffdf9;font:inherit;font-size:13.5px;line-height:1.35;color:var(--ink);text-align:left;cursor:pointer;word-break:keep-all}',
      '.ct-nd small{flex:none;font-size:11.5px;color:#8a7a63}.ct-nd:not(.on) small::after{content:" ▸"}.ct-nd.on{border-color:rgba(63,127,134,.5)}.ct-nd:hover{border-color:#3F7F86}',
      '.ct-pp{flex:none}.ct-box{width:300px;border:1px solid rgba(0,0,0,.08);border-radius:9px;background:#fff;padding:0 4px}',
      '.ct-p+.ct-p{border-top:1px solid rgba(0,0,0,.06)}.ct-line{display:flex;align-items:center;gap:4px}',
      '.ct-pb{flex:1;min-width:0;min-height:36px;border:0;background:none;text-align:left;padding:5px 6px;font:inherit;font-size:13.5px;color:var(--ink);cursor:pointer;overflow-wrap:anywhere}',
      '.ct-pb span{color:#7a6a55;font-size:12.5px}.ct-pb i{font-style:normal;color:#a99a86;font-size:12px}.ct-pb:hover{background:rgba(0,0,0,.03)}',
      '.ct-tel{flex:none;font-size:12.5px;font-variant-numeric:tabular-nums;color:#8a7a63;padding:8px 4px;text-decoration:none;white-space:nowrap}a.ct-tel{color:#2f6f76}',
      '.ct-more{padding:2px 6px 10px;display:flex;flex-direction:column;gap:6px}.ct-more .orgx-meta{margin:0}.ct-more .orgx-edit{margin:0;align-self:flex-start}',
      '.ct-codes,.ct-orgs{display:flex;flex-wrap:wrap;gap:6px}.ct-orgs .orgx-chip{min-height:36px}',
      '.ct-btns{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px}',
      '.ct-go{display:flex;flex-direction:column;gap:1px;min-height:48px;padding:8px 12px;border:1px solid rgba(0,0,0,.1);border-radius:10px;background:#fffdf9;font:inherit;text-align:left;cursor:pointer;color:var(--ink)}',
      '.ct-go b{font-size:13.5px}.ct-go span{font-size:12.5px;color:#7a6a55;line-height:1.4;word-break:keep-all;overflow-wrap:anywhere}.ct-go:hover{border-color:#3F7F86}',
      /* 폰 — 같은 나무를 세로로 */
      '@media (max-width:760px){.ct{overflow-x:visible}.ct ul{padding-left:14px}.ct li{display:block}.ct li>ul{margin:2px 0 0}.ct ul ul>li::before{left:-8px;width:8px}.ct ul ul>li::after{left:-8px}.ct li>ul::before{display:none}',
      '.ct ul ul>li:first-child::after{top:-4px}.ct ul ul>li:only-child::after{display:block;top:-4px;height:26px}.ct ul ul>li:last-child:not(:only-child)::after{top:0}.ct-nd{max-width:100%;min-height:42px}.ct-box{width:auto}.ct-pb{min-height:44px}.ct-btns{grid-template-columns:1fr}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ── 고치기 · 인사이동 (2026-11-23) ─────────────────────────
  //   GAS org_write(OrgWrite.js) 하나로 쓴다 — 규칙은 서버 한 곳(자리이력 · 변경이력 · 같은 이름 확인).
  //   누가 고쳤는지는 인증코드 로그인 세션으로 서버가 정한다(직원목록 이름). 한 번에 10초 안팎.
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
        _load(true);                                  // 서버 캐시는 고칠 때 지워졌다 — 바로 다시 받는다(보던 곳 그대로)
      });
    });
  }

  return { init: init, home: home, onInput: onInput, edit: edit };
})();
