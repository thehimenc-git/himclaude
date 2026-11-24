// 08-master.js — 마스터 탭 「사업」 (승인자 전용, 2026-08-25 → 2026-11-24 새로 짬)
//   한 줄에 질문 하나, 줄마다 바로 누른다. 무엇을 정해야 하는지 · 왜 · 고를 답만 보인다(사용자 결정 "화면은 무조건 단순하게, 빠르게 여러 건").
//   질문과 답은 GAS PjAsk.js 가 만든다(ask). 네 갈래:
//     · NAS 폴더 — 새 폴더가 어느 사업인지          · 새 이름 — AI 가 브리핑에서 찾은 등록 대기(B_학습)
//     · 임시코드 — 최근 보고에 나온 TEMP-             · 오래된 것 — 30일 보고 없는 TEMP- 「아직 하나요?」(아직 해요 → 30일 안 묻는다)
//   비슷한 사업 후보는 자주 틀려 「맞아요」를 기본으로 두지 않는다 — 후보를 직접 누른다.
//   쓰기는 인증코드 로그인 세션으로만(master_resolve_many).
//   활성 조건: #tab-master-btn 이 있고 get_pending_pj_registrations 가 승인자로 인정할 때만 탭 노출.
//   오래된 것은 새로 넘어온 것만 이름 동그라미에 센다(S:).
//   전역 재사용: profile, APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, escapeHtml, toast.
var MasterTab = (function () {
  var _pending = [], _temps = [], _projects = [];
  var _nas = [], _nasRecent = [];   // NAS 폴더 — 확인할 것(애매한 것) · 최근 자동 반영 (2026-10-13, GAS NasSync.js)
  var _sugg = {}, _meaning = {}, _loaded = false, _tempsLoaded = false, _tempsErr = '';
  var _filter = 'todo', _q = '', _shown = 30, _timer = null;
  var _open = {};      // 줄 key → { mode: 'find'|'fresh', kind, letter, code, name, tq, target, err }
  var _gone = {};      // 누른 줄 key — 저장이 끝날 때까지 안 보인다
  var _queue = [], _sending = 0, _qt = null;      // 아직 안 보낸 답
  var HOLD = 5000, BATCH = 15;
  var LETTERS = ['U', 'C', 'E', 'A'];
  var FORMAL_RE = /^\d{2}-[UCEA]\d{2}$/i, REVIEW_RE = /^검토-\d+_\d{6}$/;

  function _post(payload, keep) {
    payload.token = APPS_SCRIPT_TOKEN;
    payload.email = (profile && profile.email) || '';
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload), keepalive: !!keep
    }).then(function (r) { return r.json(); });
  }
  function _esc(s) { return escapeHtml(String(s == null ? '' : s)); }
  function _atText(v) { var d = new Date(v); return isNaN(d) ? String(v || '') : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function _md(d) { var m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? (+m[1]) + '/' + (+m[2]) : ''; }

  // 정리 대상 (2026-10-14) — 30일 동안 보고가 없는 임시코드. 표시만 하고 자동으로 빼지 않는다.
  //   임시코드는 원래 NAS 폴더가 없는 단계라 "폴더 없음"은 따로 안 본다.
  //   보고가 한 번도 없으면 코드의 생성일(TEMP-YYYYMMDD-NNN)부터 센다 — 막 생긴 임시코드가 바로 걸리지 않게.
  var STALE_DAYS = 30;
  function _kstDay(offsetDays) { return new Date(Date.now() + 9 * 3600 * 1000 - (offsetDays || 0) * 86400 * 1000).toISOString().slice(0, 10); }
  function _isStale(t) {
    if (!t || t.stage === '종결' || t.kept) return false;
    var ref = String(t.last || '').slice(0, 10);
    if (!ref) { var m = String(t.code || '').match(/^TEMP-(\d{4})(\d{2})(\d{2})-/); ref = m ? m[1] + '-' + m[2] + '-' + m[3] : ''; }
    return !!ref && ref < _kstDay(STALE_DAYS);
  }

  // ── 불러오기 ─────────────────────────────────────
  // 로그인 직후 1회 — 승인자면 탭 노출 + 데이터 적재.
  function boot() {
    var btn = document.getElementById('tab-master-btn');
    if (!btn) return;
    _injectStyle();
    _post({ action: 'get_pending_pj_registrations' })
      .then(function (resp) {
        if (!resp || !resp.ok || resp.reason === 'not_pj_owner') { btn.style.display = 'none'; _approver = false; _bell(); return; }
        btn.style.display = '';
        _approver = true;
        _applyPending(resp);
        _loadTemps();
        if (typeof OrgCand !== 'undefined') OrgCand.load();   // 「사람」 칩 숫자 · 새 후보 알림 (2026-11-23)
        // 켜 둔 채로 있어도 새 알림을 받게 30분마다 다시 본다 (NAS 동기화는 평일 08:45·16:30)
        if (!_timer) _timer = setInterval(refresh, 30 * 60 * 1000);
      })
      .catch(function (e) { console.error('[master] boot', e); btn.style.display = 'none'; });
  }
  function init() { if (!_loaded) boot(); else _render(); }
  function refresh() {
    _post({ action: 'get_pending_pj_registrations' }).then(function (resp) { if (resp && resp.ok) _applyPending(resp); })
      .catch(function (e) { console.error('[master] refresh', e); });
    _loadTemps();
  }
  function _applyPending(resp) {
    _pending = Array.isArray(resp.items) ? resp.items : [];
    _nas = Array.isArray(resp.nas_notices) ? resp.nas_notices : [];
    _nasRecent = Array.isArray(resp.nas_recent) ? resp.nas_recent : [];
    _sugg = resp.suggestions || {};
    _meaning = resp.prefixMeaning || {};
    _loaded = true;
    _badge();
    _bell();
    _render();
  }
  function _loadTemps() {
    _post({ action: 'master_temp_list' })
      .then(function (resp) {
        if (!resp || !resp.ok) throw new Error((resp && (resp.message || resp.error)) || '응답 없음');
        _temps = Array.isArray(resp.items) ? resp.items : [];
        _projects = Array.isArray(resp.projects) ? resp.projects : [];
        _tempsLoaded = true; _tempsErr = '';
        _render();
        _bell();
      })
      .catch(function (e) { console.error('[master] temp list', e); _tempsLoaded = true; _tempsErr = '임시코드 목록을 불러오지 못했어요'; _render(); });
  }
  function _badge() {
    var b = document.getElementById('tab-master-count');
    var n = _pending.filter(function (p) { return !_gone['P:' + p['키']]; }).length + _nas.filter(function (x) { return !_gone['N:' + x.code]; }).length;
    if (b) b.textContent = n ? String(n) : '';
  }

  // ── 줄 목록 (2026-11-24) — 한 줄에 질문 하나. 질문·답은 GAS PjAsk.js 가 만든다(ask) ──
  var KINDS = [['todo', '전체'], ['nas', 'NAS 폴더'], ['name', '새 이름'], ['temp', '임시코드'], ['stale', '오래된 것'], ['later', '미뤄 둔 것'], ['done', '끝난 것']];
  var RANK = { nas: 0, name: 1, temp: 2, stale: 3, later: 4, done: 5 };
  // AI 메모에 적힌 코드(목록에 있는 것)를 후보 맨 앞으로 — 「서초구 공공디자인심의」 메모에 24-C07 이 있는데 후보엔 없던 것(2026-11-24)
  var CODE_IN_MEMO = /\d{2}-[UCEA]\d{2}(?!\d)|검토-\d+_\d{6}|TEMP-\d{8}-\d{3}/g;
  function _withMemo(ask, memo) {
    if (!memo || !ask.find) return ask;
    var first = [], seen = {};
    (String(memo).match(CODE_IN_MEMO) || []).forEach(function (code) {
      var p = _projByCode(code);
      if (!p || seen[code] || first.length >= 2) return;
      seen[code] = 1;
      first.push({ label: p.name, sub: p.code + ' · 메모에 적힌 코드', body: _with(ask.find.body, { target: p.code }) });
    });
    if (!first.length) return ask;
    return _with(ask, { picks: first.concat(ask.picks.filter(function (x) { return !seen[x.body.target]; })).slice(0, 4) });
  }
  function _cards() {
    var out = [], add = function (key, src, o) { if (!_gone[key] && src.ask) out.push({ key: key, src: src, ask: _withMemo(src.ask, o.memo), kind: src.ask.kind, name: o.name || '', code: o.code || '', memo: o.memo || '', reports: src.reports || 0, last: src.last || '' }); };
    _nas.forEach(function (x) { add('N:' + x.code, x, { name: x.name || x.folder, code: x.code }); });
    _pending.forEach(function (p) { add('P:' + p['키'], p, { name: p['키'], memo: p['값'] }); });
    _temps.forEach(function (t) { add('T:' + t.code, t, { name: t.name, code: t.code }); });
    return out;
  }
  function _visible(all) {
    var q = _q.replace(/\s+/g, '').toLowerCase();
    return all.filter(function (c) {
      if (_filter === 'todo' ? RANK[c.kind] > 3 : c.kind !== _filter) return false;
      return !q || (c.name + c.code + c.memo).replace(/\s+/g, '').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      if (a.kind !== b.kind) return RANK[a.kind] - RANK[b.kind];
      if (a.kind === 'stale') return a.last < b.last ? -1 : a.last > b.last ? 1 : (a.key < b.key ? -1 : 1);   // 오래 잠잠한 것부터
      return (b.reports - a.reports) || (a.key < b.key ? -1 : 1);
    });
  }

  function _render() {
    var body = document.getElementById('mode-master-body');
    if (!body) return;
    if (!body.getAttribute('data-mt')) {
      // 머리(검색·칩)는 한 번만 그린다 — 검색칸을 다시 그리면 입력 중 포커스가 튄다
      body.setAttribute('data-mt', '1');
      if (typeof OrgCand !== 'undefined' && OrgCand.style) OrgCand.style();      // 줄 모양(oc-)은 「사람」과 같은 것을 쓴다
      // 「사업 | 사람」 — 사람은 인명부 후보 정리(js/12-orgcand.js, 2026-11-23)
      //   ⚠ 이 전환 버튼의 data-act 이름은 줄 안 버튼과 겹치면 안 된다(11/23 겹쳐서 화면이 비었다)
      body.innerHTML =
        '<div class="mt-kind" role="tablist" style="display:flex;gap:6px;margin:0 0 12px"><button type="button" class="mt-chip on" data-act="scope" data-k="pj">🗂️ 사업</button>' +
        '<button type="button" class="mt-chip" data-act="scope" data-k="org">👤 사람 <span id="mt-org-n"></span></button></div>' +
        '<div class="mt-pj">' +
        '<div class="mt-bar"><div class="mt-chips"></div>' +
        '<input type="search" class="mt-search" placeholder="이름·코드로 찾기" /></div>' +
        '<div class="mt-list"></div><div class="oc-bar mt-save" hidden></div><div class="mt-foot"></div></div>' +
        '<div class="mt-org" hidden></div>';
      body.querySelector('.mt-search').addEventListener('input', function (e) { _q = String(e.target.value || ''); _shown = 30; _renderList(); });
      body.addEventListener('click', _onClick);
      body.addEventListener('input', _onInput);
      body.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || !e.target.getAttribute || e.target.getAttribute('data-in') !== 'code') return;
        var b = e.target.closest('[data-key]').querySelector('[data-act="save"]'); if (b) b.click();
      });
      window.addEventListener('pagehide', function () { _flush(true); });         // 화면을 떠나면 모아 둔 답을 바로 보낸다
    } else if (_typing()) { _chips(); return; }      // 글자를 적는 중이면 다시 그리지 않는다(끊기지 않게)
    _renderList();
  }

  function _kind(k) {
    var body = document.getElementById('mode-master-body');
    if (!body) return;
    body.querySelectorAll('.mt-kind [data-k]').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-k') === k); });
    body.querySelector('.mt-pj').hidden = k !== 'pj';
    var org = body.querySelector('.mt-org');
    org.hidden = k !== 'org';
    if (k === 'org' && typeof OrgCand !== 'undefined') OrgCand.init(org);
  }
  // 사람 후보 — 알림엔 새로 생긴 것만(처음 본 258건은 기준선으로 본 것 처리, '#O')
  var _org = [];
  function orgAlerts(items) { _org = Array.isArray(items) ? items : []; _bell(); }

  function _typing() { var f = document.activeElement; return !!(f && f.getAttribute && f.getAttribute('data-in') && f.closest('.mt-pj')); }
  function _chips() {
    var body = document.getElementById('mode-master-body');
    if (!body || !body.getAttribute('data-mt')) return;
    var n = { todo: 0 };
    _cards().forEach(function (c) { n[c.kind] = (n[c.kind] || 0) + 1; if (RANK[c.kind] <= 3) n.todo++; });
    body.querySelector('.mt-chips').innerHTML = KINDS.filter(function (x) { return x[0] === 'todo' || n[x[0]] || _filter === x[0]; }).map(function (x) {
      return '<button type="button" class="mt-chip' + (_filter === x[0] ? ' on' : '') + '" data-act="filter" data-f="' + x[0] + '">' + x[1] + ' <span>' + (n[x[0]] || 0) + '</span></button>';
    }).join('');
  }
  function _renderList() {
    var body = document.getElementById('mode-master-body');
    if (!body || !body.getAttribute('data-mt')) return;
    _chips();
    var list = body.querySelector('.mt-list');
    body.querySelector('.mt-foot').innerHTML = _recentHtml() + _guideHtml();
    if (!_loaded || (!_tempsLoaded && !_pending.length)) { list.innerHTML = '<div class="mt-empty">불러오는 중이에요… (처음엔 몇 초 걸려요)</div>'; return; }
    var vis = _visible(_cards()), h = '';
    if (_tempsErr) h += '<div class="mt-empty err">' + _esc(_tempsErr) + ' <button type="button" class="mt-btn" data-act="reload">다시 시도</button></div>';
    if (!vis.length) h += '<div class="mt-empty">' + (_q ? '찾는 이름이 없어요' : '정리할 사업이 없어요') + '</div>';
    else h += '<div class="oc-list">' + vis.slice(0, _shown).map(_rowHtml).join('') + '</div>';
    if (vis.length > _shown) h += '<button type="button" class="mt-btn oc-more" data-act="more">더 보기 (' + (vis.length - _shown) + ')</button>';
    if (!_tempsLoaded) h += '<div class="mt-empty">임시코드 목록을 불러오는 중이에요…</div>';
    list.innerHTML = h;
  }

  function _b(act, label, cls, extra) { return '<button type="button" class="mt-btn' + (cls ? ' ' + cls : '') + '" data-act="' + act + '"' + (extra || '') + '>' + _esc(label) + '</button>'; }
  function _pickBtn(p, act, i) { return '<button type="button" class="mt-btn oc-pick" data-act="' + act + '" data-i="' + i + '"><b>' + _esc(p.label) + '</b><span>' + _esc(p.sub) + '</span></button>'; }
  function _rowHtml(c) {
    var a = c.ask, o = _open[c.key];
    var h = '<div class="oc-row" data-key="' + _esc(c.key) + '"><div class="oc-txt"' + (c.code ? ' title="' + _esc(c.code) + '"' : '') + '><div class="oc-ask">' + _esc(a.q) + '</div>';
    if (a.why) h += '<div class="oc-sub oc-dim">' + _esc(a.why) + '</div>';
    if (c.memo) h += '<div class="oc-sub oc-dim mt-memo" title="' + _esc(c.memo) + '">' + _esc(c.memo) + '</div>';
    h += '</div>';
    if (o) return h + _openHtml(c, a, o) + '</div>';
    h += '<div class="oc-btns">' + a.picks.map(function (p, i) { return _pickBtn(p, 'pick', i); }).join('');
    // 후보가 없는 새 사업만 첫 답이 정해져 있다 — 그 밖엔 후보가 자주 틀려 어느 것도 앞세우지 않는다
    if (a.fresh && a.fresh.label !== '새 사업') h += _b('fresh', a.fresh.label);
    if (a.kind === 'stale') h += a.btns.map(function (x, i) { return _b('btn', x.label, '', ' data-i="' + i + '"'); }).join('') + _b('find', a.find.label);
    else {
      if (a.find) h += _b('find', a.find.label);
      if (a.fresh && a.fresh.label === '새 사업') h += _b('fresh', '새 사업');
      h += a.btns.map(function (x, i) { return _b('btn', x.label, '', ' data-i="' + i + '"'); }).join('');
    }
    return h + '</div></div>';
  }
  function _openHtml(c, a, o) {
    var h = '<div class="oc-open">';
    if (o.err) h += '<div class="oc-err">' + _esc(o.err) + '</div>';
    if (o.mode === 'find') {
      h += '<div class="oc-btns">' + _more(c, o).map(function (p, i) { return _pickBtn(p, 'more-pick', i); }).join('') + '</div>' +
        '<input type="search" class="mt-search oc-name" style="flex:none;width:100%;max-width:none" data-in="tq" placeholder="사업 이름이나 코드" aria-label="사업 찾기" value="' + _esc(o.tq || '') + '" />' +
        '<div class="oc-btns mt-results">' + _resultsHtml(c, o) + '</div>';
    } else if (o.mode === 'fresh') {
      if (a.fresh.name) h += '<input type="text" class="mt-search oc-name" style="flex:none;width:100%;max-width:none" data-in="name" maxlength="80" aria-label="사업 이름" value="' + _esc(o.name != null ? o.name : a.fresh.name) + '" />';
      if (o.kind) {
        h += '<div class="oc-sub oc-dim">' + (o.kind === 'formal' ? '재무 원장 코드와 같아야 해요' : 'NAS 검토 폴더의 번호·날짜 그대로 적어 주세요') + '</div>' +
          '<div class="oc-btns"><input type="text" class="mt-search oc-name" data-in="code" maxlength="24" aria-label="코드" placeholder="' + (o.kind === 'formal' ? 'YY-X##' : '검토-12_260706') + '" value="' + _esc(o.code || '') + '" />' + _b('save', '저장', 'primary') + '</div>';
      } else {
        h += '<div class="oc-btns">' + LETTERS.map(function (L) {
          return '<button type="button" class="mt-btn oc-pick" data-act="letter" data-l="' + L + '"><b>계약 · ' + _esc(_shortMeaning(L)) + '</b><span>' + _esc(_sugg[L] || 'YY-' + L + '##') + '</span></button>'; }).join('') +
          '<button type="button" class="mt-btn oc-pick" data-act="review"><b>검토 중</b><span>검토 폴더 번호</span></button>' +
          (a.fresh.kinds.indexOf('temp') >= 0 ? '<button type="button" class="mt-btn oc-pick" data-act="astemp"><b>아직 몰라요</b><span>임시코드로 올려 둬요</span></button>' : '') + '</div>';
      }
    }
    // 오래된 것은 코드를 정할 일이 드물어 여기 안에 둔다
    return h + '<div class="oc-btns">' + (o.mode === 'find' && a.fresh && (a.kind === 'stale' || a.kind === 'later') ? _b('fresh', '새 코드 정하기', 'oc-quiet') : '') + _b('close', '돌아가기', 'oc-quiet') + '</div></div>';
  }
  function _more(c, o) {
    if (o.target) return [{ label: o.target.name, sub: o.target.code, body: _with(c.ask.find.body, { target: o.target.code }) }];
    return c.ask.more || [];
  }
  function _with(b, x) { var o = {}; Object.keys(b).forEach(function (k) { o[k] = b[k]; }); Object.keys(x).forEach(function (k) { o[k] = x[k]; }); return o; }

  // 최근 자동 반영 — 확실해서 NAS 가 알아서 바꾼 것. 관리자가 모르고 지나가지 않게 (접힘)
  function _recentHtml() {
    if (!_nasRecent.length) return '';
    var label = { register_review: '새 검토 등록', register_formal: '새 정식 등록', formalize: '코드 변경', stage: '단계 변경' };
    return '<details class="mt-guide mt-recent"><summary>NAS가 자동으로 바꾼 것 · 최근 7일 ' + _nasRecent.length + '건</summary><div class="mt-guide-body"><ul>' +
      _nasRecent.map(function (r) {
        return '<li><b>' + _esc(r.code) + '</b> ' + _esc(label[r.op] || r.op) + ' — ' + _esc(r.folder || r.detail) + ' <span class="mt-guide-dim">' + _esc(_atText(r.at)) + '</span></li>';
      }).join('') + '</ul><p class="mt-guide-dim">틀린 게 있으면 이 탭이나 노션에서 바로 고치면 돼요.</p></div></details>';
  }

  function _shortMeaning(L) {
    return { U: '도시 업무', C: '토목', E: '더힘구조', A: 'AI' }[L] || String(_meaning[L] || '');
  }
  function _hits(c, o) {
    var q = String(o.tq || '').replace(/\s+/g, '').toLowerCase(), self = c.code.toUpperCase();
    if (!q) return [];
    return _projects.filter(function (p) {
      return String(p.code).toUpperCase() !== self && (String(p.code) + String(p.name)).replace(/\s+/g, '').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 6);
  }
  function _resultsHtml(c, o) {
    if (!String(o.tq || '').trim()) return '';
    var hits = _hits(c, o);
    if (!hits.length) return '<span class="oc-dim">찾는 사업이 없어요</span>';
    return hits.map(function (p, i) { return _pickBtn({ label: p.name, sub: p.code }, 'hit', i); }).join('');
  }

  // ── 누르기 ─────────────────────────────────────
  function _card(key) { return _cards().filter(function (c) { return c.key === key; })[0]; }
  function _rowEl(key) {
    var all = document.querySelectorAll('#mode-master-body .mt-pj [data-key]');
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-key') === key) return all[i];
    return null;
  }
  function _projByCode(code) {
    var up = String(code).toUpperCase();
    return _projects.filter(function (p) { return String(p.code).toUpperCase() === up; })[0] || null;
  }
  function _redraw(c, focus) {
    var el = _rowEl(c.key);
    if (!el) { _renderList(); return; }
    el.outerHTML = _rowHtml(c);
    var inp = focus && _rowEl(c.key).querySelector(focus);
    if (inp) inp.focus();
  }
  function _onClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act'), i = +(b.getAttribute('data-i') || 0);
    if (act === 'scope') { _kind(b.getAttribute('data-k')); return; }
    if (act === 'filter') { _filter = b.getAttribute('data-f'); _shown = 30; _renderList(); return; }
    if (act === 'more') { _shown += 30; _renderList(); return; }
    if (act === 'undo') { _undo(); return; }
    if (act === 'reload') { _tempsErr = ''; _tempsLoaded = false; _renderList(); _loadTemps(); return; }
    var el = b.closest('[data-key]'); if (!el) return;
    var key = el.getAttribute('data-key'), c = _card(key); if (!c) return;
    var a = c.ask, o = _open[key];
    if (act === 'pick') return _answer(c, a.picks[i].body);
    if (act === 'btn') return _answer(c, a.btns[i].body);
    if (act === 'more-pick') return _answer(c, _more(c, o)[i].body);
    if (act === 'hit') { var h = _hits(c, o)[i]; if (h) _answer(c, _with(a.find.body, { target: h.code })); return; }
    if (act === 'close') { if (o && o.kind) { o.kind = ''; o.err = ''; } else delete _open[key]; _redraw(c); return; }
    if (act === 'find') { _open[key] = { mode: 'find' }; _redraw(c, '[data-in="tq"]'); return; }
    if (act === 'fresh') { _open[key] = { mode: 'fresh' }; _redraw(c); return; }
    if (!o) return;
    if (act === 'letter') { o.kind = 'formal'; o.letter = b.getAttribute('data-l'); o.code = _sugg[o.letter] || ''; o.err = ''; _redraw(c, '[data-in="code"]'); return; }
    if (act === 'review') { o.kind = 'review'; o.code = ''; o.err = ''; _redraw(c, '[data-in="code"]'); return; }
    if (act === 'astemp') { _answer(c, _with(a.fresh.body, { kind: 'temp', name: _freshName(a, o) })); return; }
    if (act === 'save') _save(c, a, o);
  }
  function _freshName(a, o) { return String(o.name != null ? o.name : a.fresh.name || '').replace(/\s+/g, ' ').trim(); }
  function _save(c, a, o) {
    var code = String(o.code || '').trim(), bad = '';
    if (o.kind === 'formal') code = code.toUpperCase();
    if (!(o.kind === 'formal' ? FORMAL_RE : REVIEW_RE).test(code)) bad = o.kind === 'formal' ? '코드는 26-U01 처럼 적어 주세요' : '번호는 검토-12_260706 처럼 적어 주세요';
    else if (a.fresh.name && !_freshName(a, o)) bad = '사업 이름을 적어 주세요';
    if (bad) { o.err = bad; _redraw(c, '[data-in="code"]'); return; }
    var same = _projByCode(code);
    if (same) { _open[c.key] = { mode: 'find', target: same, err: code + ' 는 이미 있어요. 같은 사업이면 눌러 주세요' }; _redraw(c); return; }
    // 같은 추천 번호를 두 사업에 쓰지 않게 다음 번호로 올린다
    if (o.letter && _sugg[o.letter] === code) _sugg[o.letter] = code.slice(0, 4) + ('0' + (+code.slice(4) + 1)).slice(-2);
    _answer(c, a.fresh.body.op === 'formalize' ? _with(a.fresh.body, { new_code: code }) : _with(a.fresh.body, { kind: o.kind, name: _freshName(a, o), code: code }));
  }
  function _onInput(e) {
    var t = e.target, f = t.getAttribute && t.getAttribute('data-in');
    if (!f) return;
    var el = t.closest('[data-key]'); if (!el) return;
    var o = _open[el.getAttribute('data-key')], c = _card(el.getAttribute('data-key'));
    if (!o || !c) return;
    o[f] = String(t.value || '');
    // 입력칸은 그대로 두고 아래 결과만 다시 그린다 (포커스 유지)
    if (f === 'tq') el.querySelector('.mt-results').innerHTML = _resultsHtml(c, o);
    var er = el.querySelector('.oc-err');
    if (er) { er.parentNode.removeChild(er); o.err = ''; }
  }

  // ── 모아서 보내기 ─────────────────────────────────
  //   누르면 줄이 바로 사라지고 5초 모아 여러 건을 한 번에 보낸다(master_resolve_many). 그 사이 되돌릴 수 있다.
  //   한 건씩 사람이 누른 답이다 — 「전부」 버튼은 없다.
  function _sess() { return (typeof getSession === 'function') ? getSession() : ''; }
  function _saveBar() {
    var b = document.querySelector('#mode-master-body .mt-save');
    if (!b) return;
    var n = _queue.length;
    b.hidden = !n && !_sending;
    b.innerHTML = '<span>' + (n ? n + '건 골랐어요' : '') + (_sending ? (n ? ' · ' : '') + _sending + '건 저장하는 중' : '') + '</span>' + (n ? _b('undo', '방금 것 되돌리기') : '');
  }
  function _answer(c, body) {
    if (!_sess()) { toast('인증코드로 로그인한 뒤 정리할 수 있어요'); return; }
    delete _open[c.key];
    _gone[c.key] = 1;
    _queue.push({ c: c, body: body, n: 0 });
    var el = _rowEl(c.key);
    if (el) el.parentNode.removeChild(el);
    var left = _visible(_cards()).length;
    if (document.querySelectorAll('#mode-master-body .mt-pj .oc-row').length < Math.min(12, left) || !left) _renderList(); else _chips();
    _badge(); _saveBar();
    _later(_queue.length >= BATCH ? 0 : HOLD);
  }
  function _later(ms) { clearTimeout(_qt); if (_queue.length) _qt = setTimeout(_flush, ms); }
  function _undo() {
    var q = _queue.pop();
    if (!q) return;
    delete _gone[q.c.key];
    _renderList(); _badge(); _saveBar(); _later(HOLD);
  }
  function _flush(leaving) {
    clearTimeout(_qt);
    leaving = leaving === true;
    if (!_queue.length) return;
    if (_sending && !leaving) { _later(1500); return; }
    var batch = _queue.splice(0, BATCH), wait = 800;
    _sending += batch.length;
    _saveBar();
    var put = function (q, o) { delete _gone[q.c.key]; if (o) _open[q.c.key] = o; };
    _post({ action: 'master_resolve_many', session: _sess(), items: batch.map(function (q) { return _with(q.body, { key: q.c.key }); }) }, leaving)
      .then(function (j) {
        if (!j || !j.ok) {
          // 다른 사람이 정리하는 중 — 잠시 뒤 알아서 다시 보낸다
          if (j && j.reason === 'busy' && batch.every(function (q) { return ++q.n < 6; })) { _queue = batch.concat(_queue); wait = 8000; return; }
          batch.forEach(function (q) { put(q); });
          toast(j && j.reason === 'session_invalid' ? '로그인이 풀렸어요. 다시 로그인한 뒤 눌러 주세요' : j && j.reason === 'not_approver' ? '프로젝트 승인자만 정리할 수 있어요' : '저장하지 못했어요. 다시 눌러 주세요');
          return;
        }
        var by = {}, good = 0, bad = 0, reload = false, msg = '';
        (j.results || []).forEach(function (r) { by[r.key] = r; });
        batch.forEach(function (q) {
          var r = by[q.c.key] || { reason: 'later' }, op = q.body.op;
          if (r.ok || r.reason === 'done') {
            good++;
            if (op === 'keep') _kept(q.c); else _drop(q.c);
            if (op === 'nas' || op === 'register') reload = true;
            if (op === 'formalize') _projects.push({ code: r.code || q.body.new_code, name: q.c.name });
            return;
          }
          bad++;
          var same = r.reason === 'exists' && _projByCode(q.body.new_code);
          if (same) put(q, { mode: 'find', target: same, err: r.message });
          else if (op === 'formalize' || (op === 'register' && q.body.kind !== 'temp')) put(q, { mode: 'fresh', kind: FORMAL_RE.test(q.body.new_code || q.body.code) ? 'formal' : 'review', code: q.body.new_code || q.body.code, name: q.body.name, err: r.message || '저장하지 못했어요' });
          else { put(q); msg = r.message || '저장하지 못했어요'; }
        });
        toast(good + '건 저장했어요' + (bad ? ' · ' + bad + '건은 한 번 더 봐 주세요' + (msg ? ' (' + msg + ')' : '') : ''));
        if (reload) _loadTemps();      // 새로 생긴 줄 · 바뀐 코드가 목록에도 보이게
      })
      .catch(function (e) {
        console.error('[master] resolve_many', e);
        batch.forEach(function (q) { put(q); });
        toast('저장하지 못했어요 — 잠시 뒤 다시 눌러 주세요');
      })
      .then(function () {
        _sending -= batch.length;
        // 글자를 적는 중이면 다시 그리지 않고 돌아온 줄만 위에 붙인다
        if (_typing()) {
          _chips();
          var vis = _visible(_cards()), list = document.querySelector('#mode-master-body .mt-list .oc-list');
          batch.forEach(function (q) {
            var c = vis.filter(function (x) { return x.key === q.c.key; })[0];
            if (c && list && !_rowEl(c.key)) list.insertAdjacentHTML('afterbegin', _rowHtml(c));
          });
        } else _renderList();
        _badge(); _bell(); _saveBar(); _later(wait);
      });
  }
  function _drop(c) {
    delete _gone[c.key];
    if (c.key.charAt(0) === 'N') _nas = _nas.filter(function (x) { return 'N:' + x.code !== c.key; });
    else if (c.key.charAt(0) === 'P') _pending = _pending.filter(function (p) { return 'P:' + p['키'] !== c.key; });
    else _temps = _temps.filter(function (t) { return 'T:' + t.code !== c.key; });
  }
  function _kept(c) {      // 「아직 해요」 — 30일 동안 「미뤄 둔 것」 칩으로
    delete _gone[c.key];
    c.src.kept = _kstDay(0);
    c.src.ask = _with(c.src.ask, { kind: 'later', btns: c.src.ask.btns.filter(function (x) { return x.body.op !== 'keep'; }) });
  }

  // ── 코드가 바뀌는 순서 (접힌 안내) ─────────────────────
  function _guideHtml() {
    return '<details class="mt-guide"><summary>코드가 바뀌는 순서 · NAS 폴더와의 관계</summary><div class="mt-guide-body">' +
      '<ol>' +
      '<li><b>보고에 새 이름이 나오면</b> 목록에 없을 때 <code>TEMP-날짜-번호</code>가 자동으로 붙어요. 직원은 그 코드로 그대로 보고하면 돼요.</li>' +
      '<li><b>실이 NAS 검토 폴더(NN_YYMMDD_이름)를 만들면</b> 자동으로 <code>검토-NN_YYMMDD</code>가 돼요 — 이어지는 임시코드가 하나로 확실하면 그걸 바꾸고, 없으면 새로 등록해요.</li>' +
      '<li><b>계약되어 NAS 프로젝트 폴더(<code>YY-X##</code>)가 생기면</b> 같은 방식으로 정식 코드가 돼요. 옛 코드는 별칭으로 남아 지난 보고도 이어져요.</li>' +
      '<li><b>사업이 아니면</b> [사업 아님] — 목록에서 빠지고, 노션에서 단계를 되돌리면 다시 살아나요.</li>' +
      '<li><b>30일 넘게 보고가 없는 임시코드</b>는 「아직 하나요?」로 물어요. 자동으로 빼지 않아요 — [아직 해요]를 누르면 30일 동안 안 물어요.</li>' +
      '</ol>' +
      '<p><b>NAS 폴더는 평일 08:45·16:30에 읽어요.</b> 비슷한 이름이 여럿이라 애매하면 바꾸지 않고 맨 위에서 물어봐요 — 골라 주세요. 자동으로 바꾼 건 아래 「NAS가 자동으로 바꾼 것」에 남아요. 폴더 이름의 (취소)·미계약 종결도 단계에 반영돼요.</p>' +
      '<p class="mt-guide-dim">반영: 보고창·브리핑 10분 안 · 노션 1시간 안</p>' +
      '</div></details>';
  }

  // ── 알림 (이름 동그라미) ─────────────────────────────
  //   2026-10-13 — 처음엔 팝업이었는데 매번 뜨면 방해된다는 사용자 의견으로 바꿨다:
  //   좌측 위 이름 동그라미에 테두리가 빛나고 숫자가 붙는다 → 누르면 알림 목록 + 직원 변경.
  //   열면 '읽음'(브라우저에 기억) — 빛은 꺼지고, 아직 골라야 할 것(NAS 확인·새로 찾음)은 회색 숫자로 남는다.
  var _approver = false;
  function _seenKey() { return 'mt_seen_' + String((profile && profile.email) || ''); }
  // 본 것 = 알림 키 집합. '#R'·'#T' 는 그 목록의 첫 기준선을 잡았다는 표시 —
  //   처음 쓰는 브라우저에서 이미 쌓인 자동 반영·임시코드 70개를 '새것'이라 부르지 않으려고.
  //   임시코드 목록(master_temp_list)은 늦게 오므로 목록마다 따로 잡는다.
  function _readSeen() {
    var seen = {};
    try { JSON.parse(localStorage.getItem(_seenKey()) || '[]').forEach(function (k) { seen[k] = 1; }); } catch (e) { console.warn('[master] seen', e); }
    return seen;
  }
  function _writeSeen(seen) {
    // 지금 목록에 없는 옛 키는 버린다(표시는 남긴다) — 계속 쌓이지 않게
    var live = {}; _allKeys().forEach(function (k) { live[k] = 1; });
    var keys = Object.keys(seen).filter(function (k) { return k.charAt(0) === '#' || live[k] || (!_tempsLoaded && (k.indexOf('T:') === 0 || k.indexOf('S:') === 0)) || (!_org.length && k.indexOf('O:') === 0); });
    try { localStorage.setItem(_seenKey(), JSON.stringify(keys)); } catch (e) { console.warn('[master] seen', e); }
  }
  function _allKeys() {
    var k = [];
    _nas.forEach(function (x) { k.push('N:' + x.code); });
    _pending.forEach(function (p) { k.push('P:' + p['키']); });
    _nasRecent.forEach(function (r) { k.push('R:' + r.at + r.code); });
    _temps.forEach(function (t) { k.push('T:' + t.code); if (_isStale(t)) k.push('S:' + t.code); });
    _org.forEach(function (c) { k.push('O:' + c.cand_id); });   // 사람 후보 — 빠뜨리면 기준선이 저장되지 않아 쌓인 후보가 늘 새것으로 뜬다
    return k;
  }
  // 알림 한 줄씩 — 확인할 것(act) 먼저, 그다음 알아만 두면 되는 것(NAS 자동 반영·새 임시코드)
  function _alerts() {
    var out = [];
    _nas.forEach(function (x) { out.push({ key: 'N:' + x.code, act: true, tag: 'NAS 폴더', text: x.code + ' ' + (x.name || x.folder || '') + ' — 같은 사업인지 골라 주세요' }); });
    _pending.forEach(function (p) { out.push({ key: 'P:' + p['키'], act: true, tag: '새로 찾음', text: (p['키'] || '') + ' — 사업인지 확인해 주세요' }); });
    _nasRecent.forEach(function (r) { out.push({ key: 'R:' + r.at + r.code, act: false, tag: 'NAS 자동', text: r.code + ' ' + (r.folder || r.detail || '') }); });
    _temps.forEach(function (t) { if (t.stage !== '종결') out.push({ key: 'T:' + t.code, act: false, tag: '새 임시코드', text: t.code + ' ' + (t.name || '') }); });
    // 정리 대상 — 새로 30일을 넘긴 것만 알린다(이미 쌓인 것은 '#S' 기준선으로 본 것 처리 — 늘 켜져 있으면 알림 구실을 못 한다)
    _temps.forEach(function (t) { if (_isStale(t)) out.push({ key: 'S:' + t.code, act: false, tag: '정리 대상', text: t.code + ' ' + (t.name || '') + ' — 30일 보고 없음' }); });
    _org.forEach(function (c) { out.push({ key: 'O:' + c.cand_id, act: false, tag: '사람', text: c.title }); });
    var seen = _readSeen(), changed = false;
    if (_loaded && !seen['#R']) { _nasRecent.forEach(function (r) { seen['R:' + r.at + r.code] = 1; }); seen['#R'] = 1; changed = true; }
    if (_tempsLoaded && !_tempsErr && !seen['#T']) { _temps.forEach(function (t) { seen['T:' + t.code] = 1; }); seen['#T'] = 1; changed = true; }
    if (_tempsLoaded && !_tempsErr && !seen['#S']) { _temps.forEach(function (t) { if (_isStale(t)) seen['S:' + t.code] = 1; }); seen['#S'] = 1; changed = true; }
    if (_org.length && !seen['#O']) { _org.forEach(function (c) { seen['O:' + c.cand_id] = 1; }); seen['#O'] = 1; changed = true; }
    if (changed) _writeSeen(seen);
    // 기준선 잡기 전(목록이 아직 안 옴)엔 그 목록은 새것으로 치지 않는다
    if (!seen['#T']) _temps.forEach(function (t) { seen['T:' + t.code] = 1; });
    if (!seen['#S']) _temps.forEach(function (t) { seen['S:' + t.code] = 1; });
    out.forEach(function (a) { a.fresh = !seen[a.key]; });
    // 알아만 두면 되는 건 새것만 보여 준다 (임시코드 70개를 늘 늘어놓지 않게)
    return out.filter(function (a) { return a.act || a.fresh; });
  }
  function _bell() {
    var dot = document.getElementById('user-dot');
    if (!dot) return;
    var b = dot.querySelector('.ud-badge');
    if (!_approver) { if (b) b.remove(); dot.classList.remove('ud-glow'); return; }
    var list = _alerts(), fresh = list.filter(function (a) { return a.fresh; }).length;
    var n = fresh || list.length;
    if (!b) { b = document.createElement('span'); b.className = 'ud-badge'; dot.appendChild(b); }
    b.textContent = n > 99 ? '99+' : String(n);
    b.style.display = n ? '' : 'none';
    b.classList.toggle('dim', !fresh);
    dot.classList.toggle('ud-glow', !!fresh);
    dot.setAttribute('aria-label', fresh ? '새 알림 ' + fresh + '건' : (n ? '확인 기다리는 알림 ' + n + '건' : '내 메뉴'));
  }
  function _closeMenu() { var m = document.getElementById('ud-menu'); if (m) m.remove(); document.removeEventListener('keydown', _escMenu); }
  function _escMenu(e) { if (e.key === 'Escape') _closeMenu(); }
  // 이름 동그라미를 누르면 — 알림(승인자만) + 직원 변경
  function menu() {
    _injectStyle();
    if (document.getElementById('ud-menu')) { _closeMenu(); return; }
    var dot = document.getElementById('user-dot');
    var list = _approver ? _alerts() : [];
    var h = '<div class="ud-card" role="menu">';
    h += '<div class="ud-who">' + _esc((profile && profile.name) || '') + (profile && profile.dept ? ' <span>' + _esc(profile.dept) + '</span>' : '') + '</div>';
    if (_approver) {
      h += '<div class="ud-sec">알림</div>';
      if (!list.length) h += '<div class="ud-empty">새 알림이 없어요</div>';
      else {
        h += '<ul class="ud-list">';
        list.slice(0, 8).forEach(function (a) {
          h += '<li><button type="button" class="ud-item' + (a.fresh ? ' fresh' : '') + '" data-ud="go"><span class="ud-tag' + (a.act ? ' act' : '') + '">' + _esc(a.tag) + '</span>' + _esc(a.text) + '</button></li>';
        });
        h += '</ul>';
        if (list.length > 8) h += '<div class="ud-empty">외 ' + (list.length - 8) + '건</div>';
      }
      h += '<button type="button" class="ud-go" data-ud="go">🗂️ 마스터 탭에서 확인하기</button>';
    }
    h += '<button type="button" class="ud-out" data-ud="out">직원 변경 (로그아웃)</button></div>';
    var m = document.createElement('div');
    m.id = 'ud-menu'; m.className = 'ud-menu'; m.innerHTML = h;
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ud]');
      if (!b && e.target !== m) return;
      _closeMenu();
      if (!b) return;
      if (b.getAttribute('data-ud') === 'out') { if (typeof resetProfile === 'function') resetProfile(); return; }
      if (typeof onTabClick === 'function') {
        onTabClick('master'); window.scrollTo(0, 0);
        var tab = document.querySelector('.mode-tab.tab-master');   // 폰에선 탭 줄 오른쪽 끝이라 안 보인다
        if (tab) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
    var r = dot ? dot.getBoundingClientRect() : { left: 16, bottom: 56 };
    m.querySelector('.ud-card').style.cssText = 'top:' + Math.round(r.bottom + 8) + 'px;left:' + Math.max(8, Math.round(r.left)) + 'px';
    document.body.appendChild(m);
    document.addEventListener('keydown', _escMenu);
    if (_approver) {   // 열면 읽음 — 임시코드는 목록에 안 보인 옛것까지 전부 본 걸로
      var seen = _readSeen();
      _allKeys().forEach(function (k) { seen[k] = 1; });
      _writeSeen(seen);
      _bell();
    }
  }

  // ── 스타일 (이 탭만 쓰는 것) ─────────────────────────
  function _injectStyle() {
    if (document.getElementById('mt-style')) return;
    var s = document.createElement('style'); s.id = 'mt-style';
    s.textContent = [
      '#mode-master-body{--mt:#8A6D3B;--mt-tint:rgba(138,109,59,.10)}',
      '.mt-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}',
      '.mt-chips{display:flex;gap:6px;flex-wrap:wrap}',
      '.mt-chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;color:var(--ink2);cursor:pointer;min-height:34px}',
      '.mt-chip span{color:var(--ink3);margin-left:2px}',
      '.mt-chip.on{background:var(--ink);border-color:var(--ink);color:#fff}.mt-chip.on span{color:rgba(255,255,255,.75)}',
      '.mt-search{flex:1;min-width:160px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit;font-size:14px;background:#fff}',
      '.mt-list{display:flex;flex-direction:column;gap:10px}',
      '.mt-empty{padding:18px;text-align:center;color:var(--ink3);font-size:14px;background:#fff;border:1px dashed var(--line);border-radius:10px}',
      '.mt-empty.err{color:var(--brush-rose)}',
      '.mt-memo{font-size:13px;color:var(--ink2);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mt-btn{flex:1 1 auto;min-height:40px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;font:inherit;font-size:14px;color:var(--ink);cursor:pointer}',
      '.mt-btn:hover{border-color:var(--mt)}',
      '@media (max-width:560px){.mt-pj .oc-btns .mt-btn:not(.oc-pick):not(.oc-quiet){flex:1 1 auto}}',
      '.mt-guide{margin:0 0 12px;border:1px solid var(--line);border-radius:10px;background:#fff}',
      '.mt-guide summary{cursor:pointer;padding:10px 12px;font-size:14px;color:var(--mt);font-weight:600;min-height:20px}',
      '.mt-guide-body{padding:0 14px 12px;font-size:13.5px;line-height:1.7;color:var(--ink2)}',
      '.mt-guide-body ol{margin:0 0 8px;padding-left:20px}.mt-guide-body li{margin-bottom:4px}',
      '.mt-guide-body code{background:var(--paper2);padding:0 4px;border-radius:4px;font-size:12.5px}',
      '.mt-guide-body p{margin:6px 0 0}.mt-guide-dim{color:var(--ink3);font-size:12.5px}',
      '.mt-recent ul{margin:0;padding-left:18px}.mt-recent li{margin-bottom:3px}',
      '.user-dot{position:relative}',
      '.user-dot.ud-glow{box-shadow:0 0 0 2px #fff,0 0 0 4px #D9822B;animation:udGlow 1.8s ease-in-out infinite}',
      '@keyframes udGlow{0%,100%{box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(217,130,43,.95),0 0 10px 3px rgba(217,130,43,.45)}50%{box-shadow:0 0 0 2px #fff,0 0 0 4px rgba(217,130,43,.55),0 0 2px 0 rgba(217,130,43,0)}}',
      '@media (prefers-reduced-motion:reduce){.user-dot.ud-glow{animation:none}}',
      '.ud-badge{position:absolute;top:-5px;right:-7px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#D2452F;color:#fff;font:600 11px/18px "Noto Sans KR",sans-serif;text-align:center;box-shadow:0 0 0 2px #fff;box-sizing:border-box}',
      '.ud-badge.dim{background:#9A958A}',
      '.ud-menu{position:fixed;inset:0;z-index:9999}',
      '.ud-card{position:absolute;width:min(340px,calc(100vw - 16px));max-height:calc(100vh - 80px);overflow:auto;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:12px;box-sizing:border-box}',
      '.ud-who{font-size:15px;font-weight:600;color:var(--ink);padding:2px 4px 8px;border-bottom:1px solid var(--line)}.ud-who span{font-weight:400;font-size:13px;color:var(--ink3);margin-left:4px}',
      '.ud-sec{font-size:12px;color:var(--ink3);margin:10px 4px 4px}',
      '.ud-empty{font-size:13.5px;color:var(--ink3);padding:6px 4px}',
      '.ud-list{list-style:none;margin:0;padding:0}',
      '.ud-item{display:block;width:100%;text-align:left;border:0;background:transparent;border-radius:8px;padding:8px 6px;font:inherit;font-size:13.5px;line-height:1.5;color:var(--ink2);cursor:pointer;min-height:40px;word-break:keep-all}',
      '.ud-item:hover{background:var(--paper2)}.ud-item.fresh{color:var(--ink);font-weight:500}',
      '.ud-item.fresh::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:#D2452F;margin-right:6px;vertical-align:middle}',
      '.ud-tag{display:inline-block;font-size:11.5px;border:1px solid var(--line);border-radius:999px;padding:0 7px;margin-right:6px;color:var(--ink3)}.ud-tag.act{border-color:#8A6D3B;color:#8A6D3B}',
      '.ud-go{display:block;width:100%;margin-top:8px;min-height:42px;border:0;border-radius:10px;background:#8A6D3B;color:#fff;font:inherit;font-size:14px;font-weight:600;cursor:pointer}',
      '.ud-out{display:block;width:100%;margin-top:8px;min-height:42px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink2);font:inherit;font-size:14px;cursor:pointer}'
    ].join('\n');
    document.head.appendChild(s);
  }

  return { boot: boot, init: init, refresh: refresh, menu: menu, orgAlerts: orgAlerts };
})();
