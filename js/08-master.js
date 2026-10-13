// 08-master.js — 새 사업 정리 탭 (승인자 전용, 2026-08-25 → 2026-10-13 개편)
//   보고에서 새로 나온 사업 이름을 하나씩 확인한다. 두 갈래가 같은 카드로 보인다:
//     · 새로 찾음 — AI 가 브리핑에서 찾은 등록 대기 (AI 인덱스 B_학습, get_pending_pj_registrations)
//     · 임시코드 — 이미 TEMP- 를 받은 사업 (프로젝트 목록 시트, master_temp_list)
//   카드마다 판단 재료(보고 몇 번·마지막·누가, 비슷한 사업)와 세 갈래 질문을 둔다:
//     [이미 있는 사업이에요] → 합치기(임시코드) / 별칭으로 연결(새로 찾음)
//     [새 사업이 맞아요]     → 계약됨(정식 코드) · 검토 중(검토 폴더 번호) · 아직 몰라요(임시코드로, 새로 찾음만)
//     [사업이 아니에요]     → 목록에서 빼기(되돌릴 수 있음) / 등록 대기에서 지우기
//   예전엔 코드 칸에 늘 U 다음 번호가 미리 들어가 있었고(토목도 그대로 누르면 U), 칸 하나를 새 코드·합칠 대상
//   두 용도로 같이 썼다. 확인·오류는 전부 alert 였다.
//   활성 조건: #tab-master-btn 이 있고 get_pending_pj_registrations 가 승인자로 인정할 때만 탭 노출.
//   전역 재사용: profile, APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, escapeHtml, toast.
var MasterTab = (function () {
  var _pending = [], _temps = [], _projects = [];
  var _sugg = {}, _meaning = {}, _loaded = false, _tempsLoaded = false, _tempsErr = '';
  var _filter = 'todo', _q = '';
  var _open = {};      // 카드 key → { choice: 'exist'|'new'|'not', kind, letter, target, tq }
  var _err = {};       // 카드 key → 오류 문구
  var _busy = {};      // 카드 key → 요청 중
  var LETTERS = ['U', 'C', 'E', 'A'];
  var FORMAL_RE = /^\d{2}-[UCEA]\d{2}$/i, REVIEW_RE = /^검토-\d+_\d{6}$/;

  function _post(payload) {
    payload.token = APPS_SCRIPT_TOKEN;
    payload.email = (profile && profile.email) || '';
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }
  function _esc(s) { return escapeHtml(String(s == null ? '' : s)); }
  function _md(d) { var m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? (+m[1]) + '/' + (+m[2]) : ''; }

  // ── 불러오기 ─────────────────────────────────────
  // 로그인 직후 1회 — 승인자면 탭 노출 + 데이터 적재.
  function boot() {
    var btn = document.getElementById('tab-master-btn');
    if (!btn) return;
    _injectStyle();
    _post({ action: 'get_pending_pj_registrations' })
      .then(function (resp) {
        if (!resp || !resp.ok || resp.reason === 'not_pj_owner') { btn.style.display = 'none'; return; }
        btn.style.display = '';
        _applyPending(resp);
        _loadTemps();
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
    _sugg = resp.suggestions || {};
    _meaning = resp.prefixMeaning || {};
    _loaded = true;
    _badge();
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
        _maybePopup();
      })
      .catch(function (e) { console.error('[master] temp list', e); _tempsLoaded = true; _tempsErr = '임시코드 목록을 불러오지 못했어요'; _render(); });
  }
  function _badge() {
    var b = document.getElementById('tab-master-count');
    if (b) b.textContent = _pending.length ? String(_pending.length) : '';
  }

  // ── 카드 목록 ─────────────────────────────────────
  function _cards() {
    var out = [];
    _pending.forEach(function (p) {
      out.push({ key: 'P:' + p['키'], type: 'pending', name: p['키'] || '', memo: p['값'] || '', src: p,
                 reports: p.reports || 0, last: p.last || '', who: p.who || [], similar: p.similar || [], done: false });
    });
    _temps.forEach(function (t) {
      out.push({ key: 'T:' + t.code, type: 'temp', code: t.code, name: t.name || '', note: t.note || '', stage: t.stage || '',
                 reports: t.reports || 0, last: t.last || '', who: t.who || [], similar: t.similar || [], done: t.stage === '종결' });
    });
    return out;
  }
  function _visible(all) {
    var q = _q.toLowerCase();
    return all.filter(function (c) {
      if (_filter === 'todo' && c.done) return false;
      if (_filter === 'done' && !c.done) return false;
      if (!q) return true;
      return (c.name + ' ' + (c.code || '') + ' ' + (c.note || '') + ' ' + (c.memo || '')).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'pending' ? -1 : 1;              // 새로 찾음 먼저
      return (b.reports - a.reports) || (b.last > a.last ? 1 : b.last < a.last ? -1 : 0) || (a.key < b.key ? 1 : -1);
    });
  }

  function _render() {
    var body = document.getElementById('mode-master-body');
    if (!body) return;
    if (!body.getAttribute('data-mt')) {
      // 머리(검색·칩)는 한 번만 그린다 — 검색칸을 다시 그리면 입력 중 포커스가 튄다
      body.setAttribute('data-mt', '1');
      body.innerHTML =
        '<p class="mt-intro">보고에서 새로 나온 사업 이름이에요. 하나씩 같은 사업이 있는지, 새 사업인지 확인해 주세요.</p>' +
        _guideHtml() +
        '<div class="mt-bar"><div class="mt-chips"></div>' +
        '<input type="search" class="mt-search" placeholder="이름·코드로 찾기" /></div>' +
        '<div class="mt-list"></div>';
      body.querySelector('.mt-search').addEventListener('input', function (e) { _q = String(e.target.value || ''); _renderList(); });
      body.addEventListener('click', _onClick);
      body.addEventListener('input', _onInput);
    }
    _renderList();
  }

  function _renderList() {
    var body = document.getElementById('mode-master-body');
    if (!body || !body.getAttribute('data-mt')) return;
    var all = _cards();
    var n = { todo: 0, done: 0, all: all.length };
    all.forEach(function (c) { if (c.done) n.done++; else n.todo++; });
    body.querySelector('.mt-chips').innerHTML = [['todo', '확인 필요'], ['done', '끝난 것'], ['all', '전체']].map(function (x) {
      return '<button type="button" class="mt-chip' + (_filter === x[0] ? ' on' : '') + '" data-act="filter" data-f="' + x[0] + '">' +
             x[1] + ' <span>' + n[x[0]] + '</span></button>';
    }).join('');
    var list = body.querySelector('.mt-list');
    if (!_loaded || (!_tempsLoaded && !_pending.length)) { list.innerHTML = '<div class="mt-empty">불러오는 중이에요… (처음엔 몇 초 걸려요)</div>'; return; }
    var vis = _visible(all);
    var h = '';
    if (_tempsErr) h += '<div class="mt-empty err">' + _esc(_tempsErr) + ' <button type="button" class="mt-btn" data-act="reload">다시 시도</button></div>';
    if (!vis.length) {
      h += '<div class="mt-empty">' + (_q ? '찾는 이름이 없어요' : _filter === 'done' ? '끝난 것이 없어요' : '확인할 새 사업이 없어요 — 보고에 새 이름이 나오면 여기에 떠요') + '</div>';
    } else {
      if (!_tempsLoaded) h += '<div class="mt-empty">임시코드 목록을 불러오는 중이에요…</div>';
      vis.forEach(function (c) { h += _cardHtml(c); });
    }
    list.innerHTML = h;
  }

  function _cardHtml(c) {
    var k = _esc(c.key), op = _open[c.key] || {}, busy = !!_busy[c.key];
    var tag = c.type === 'pending'
      ? '<span class="mt-tag new">새로 찾음</span>'
      : '<span class="mt-tag temp">임시 · ' + _esc(c.code) + '</span>' + (c.done ? '<span class="mt-tag">끝남</span>' : '');
    var meta = c.reports
      ? '보고 ' + c.reports + '번 · 마지막 ' + _md(c.last) + (c.who.length ? ' · ' + _esc(c.who.join('·')) : '')
      : '아직 보고에 안 나왔어요';
    var h = '<div class="mt-card' + (busy ? ' busy' : '') + '" data-key="' + k + '">';
    h += '<div class="mt-tags">' + tag + '</div>';
    h += '<div class="mt-name">' + _esc(c.name || '(이름 없음)') + '</div>';
    h += '<div class="mt-meta">' + meta + '</div>';
    if (c.memo) h += '<div class="mt-memo" title="' + _esc(c.memo) + '">AI 메모: ' + _esc(c.memo) + '</div>';
    var sim = c.similar[0];
    if (sim && !op.choice) {
      h += '<button type="button" class="mt-sim" data-act="sim" data-code="' + _esc(sim.code) + '">혹시 같은 사업인가요? <b>' + _esc(sim.code) + '</b> ' + _esc(sim.name) + '</button>';
    }
    h += '<div class="mt-choices">' +
         '<button type="button" class="mt-btn' + (op.choice === 'exist' ? ' on' : '') + '" data-act="choose" data-c="exist">이미 있는 사업이에요</button>' +
         '<button type="button" class="mt-btn' + (op.choice === 'new' ? ' on' : '') + '" data-act="choose" data-c="new">새 사업이 맞아요</button>' +
         '<button type="button" class="mt-btn' + (op.choice === 'not' ? ' on' : '') + '" data-act="choose" data-c="not">사업이 아니에요</button></div>';
    if (op.choice) h += '<div class="mt-panel">' + _panelHtml(c, op) + '</div>';
    if (_err[c.key]) h += '<div class="mt-err">' + _esc(_err[c.key]) + '</div>';
    return h + '</div>';
  }

  function _panelHtml(c, op) {
    var busy = _busy[c.key] ? ' disabled' : '';
    if (op.choice === 'exist') {
      var opts = c.similar.slice();
      if (op.target && !opts.some(function (s) { return s.code === op.target.code; })) opts.unshift(op.target);
      var h = '<div class="mt-label">어느 사업인가요?</div><div class="mt-opts">';
      opts.forEach(function (s) {
        var on = op.target && op.target.code === s.code;
        h += '<button type="button" class="mt-opt' + (on ? ' on' : '') + '" data-act="pick" data-code="' + _esc(s.code) + '"><b>' + _esc(s.code) + '</b> ' + _esc(s.name) + '</button>';
      });
      h += '</div><input type="search" class="mt-input" data-in="tq" placeholder="다른 사업 찾기 — 이름이나 코드" value="' + _esc(op.tq || '') + '" />';
      h += '<div class="mt-opts mt-results">' + _resultsHtml(c, op) + '</div>';
      h += '<p class="mt-hint">' + (c.type === 'temp'
        ? '이 임시코드를 고른 사업으로 합쳐요. 연결된 보고·일정은 내일 새벽에 그쪽으로 옮겨져요.'
        : '고른 사업에 이 이름을 별칭으로 남겨요. 다음부터 이 표기로 보고해도 그 사업으로 붙어요.') + '</p>';
      h += '<button type="button" class="mt-go" data-act="do-exist"' + (op.target ? '' : ' disabled') + busy + '>' +
           (op.target ? _esc(op.target.code) + ' 로 ' + (c.type === 'temp' ? '합치기' : '연결하기') : '사업을 골라 주세요') + '</button>';
      return h;
    }
    if (op.choice === 'new') {
      var kinds = [['formal', '계약됐어요'], ['review', '검토 중이에요']];
      if (c.type === 'pending') kinds.push(['temp', '아직 몰라요']);
      var h2 = '';
      if (c.type === 'pending') h2 += '<div class="mt-label">사업 이름</div><input type="text" class="mt-input" data-in="name" value="' + _esc(op.name != null ? op.name : c.name) + '" />';
      h2 += '<div class="mt-label">지금 어떤 상태인가요?</div><div class="mt-opts">';
      kinds.forEach(function (x) { h2 += '<button type="button" class="mt-opt' + (op.kind === x[0] ? ' on' : '') + '" data-act="kind" data-k="' + x[0] + '">' + x[1] + '</button>'; });
      h2 += '</div>';
      if (op.kind === 'formal') {
        h2 += '<div class="mt-label">어느 쪽 사업인가요?</div><div class="mt-opts">';
        LETTERS.forEach(function (L) {
          h2 += '<button type="button" class="mt-opt' + (op.letter === L ? ' on' : '') + '" data-act="letter" data-l="' + L + '"><b>' + L + '</b> ' + _esc(_shortMeaning(L)) + '</button>';
        });
        h2 += '</div>';
        if (op.letter) h2 += '<div class="mt-label">정식 코드 — 재무 원장 코드와 같아야 해요</div><input type="text" class="mt-input" data-in="code" value="' + _esc(op.code || '') + '" placeholder="' + _esc(_sugg[op.letter] || 'YY-X##') + '" />';
      } else if (op.kind === 'review') {
        h2 += '<div class="mt-label">검토 폴더 번호 — NAS 검토 폴더의 번호·날짜 그대로</div><input type="text" class="mt-input" data-in="code" value="' + _esc(op.code || '') + '" placeholder="검토-12_260706" />';
      } else if (op.kind === 'temp') {
        h2 += '<p class="mt-hint">임시코드를 받아 목록에 올려 둬요. 계약·검토가 정해지면 그때 바꾸면 돼요.</p>';
      }
      var ready = op.kind === 'temp' || (op.kind === 'formal' && FORMAL_RE.test(op.code || '')) || (op.kind === 'review' && REVIEW_RE.test(op.code || ''));
      if (op.kind) h2 += '<button type="button" class="mt-go" data-act="do-new"' + (ready ? '' : ' disabled') + busy + '>' + (ready ? '등록하기' : '코드를 확인해 주세요') + '</button>';
      return h2;
    }
    // not
    return '<p class="mt-hint">' + (c.type === 'temp'
      ? '목록과 AI 후보에서 빠져요. 연결된 보고는 그대로고, 나중에 되돌릴 수 있어요.'
      : '등록 대기에서 지워요. 사업 목록에는 아무것도 바뀌지 않아요.') + '</p>' +
      '<button type="button" class="mt-go danger" data-act="do-not"' + busy + '>' + (c.type === 'temp' ? '목록에서 빼기' : '등록 대기에서 지우기') + '</button>';
  }

  function _shortMeaning(L) {
    return { U: '도시 업무', C: '토목', E: '더힘구조', A: 'AI' }[L] || String(_meaning[L] || '');
  }
  function _resultsHtml(c, op) {
    var q = String(op.tq || '').replace(/\s+/g, '').toLowerCase();
    if (!q) return '';
    var self = (c.code || '').toUpperCase();
    var hits = _projects.filter(function (p) {
      return String(p.code).toUpperCase() !== self && (String(p.code) + String(p.name)).replace(/\s+/g, '').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 6);
    if (!hits.length) return '<span class="mt-hint">찾는 사업이 없어요</span>';
    return hits.map(function (p) {
      return '<button type="button" class="mt-opt" data-act="pick" data-code="' + _esc(p.code) + '"><b>' + _esc(p.code) + '</b> ' + _esc(p.name) + '</button>';
    }).join('');
  }

  // ── 이벤트 ─────────────────────────────────────
  function _card(key) { return _cards().filter(function (c) { return c.key === key; })[0]; }
  function _projByCode(code) {
    var up = String(code).toUpperCase();
    return _projects.filter(function (p) { return String(p.code).toUpperCase() === up; })[0] || null;
  }
  function _onClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.getAttribute('data-act');
    if (act === 'filter') { _filter = b.getAttribute('data-f'); _renderList(); return; }
    if (act === 'reload') { _tempsErr = ''; _tempsLoaded = false; _renderList(); _loadTemps(); return; }
    var el = b.closest('[data-key]'); if (!el) return;
    var key = el.getAttribute('data-key'), c = _card(key); if (!c) return;
    var op = _open[key] || (_open[key] = {});
    delete _err[key];
    if (act === 'choose') { var ch = b.getAttribute('data-c'); op.choice = op.choice === ch ? '' : ch; }
    else if (act === 'sim') {
      var sc = b.getAttribute('data-code'), s = c.similar.filter(function (x) { return x.code === sc; })[0];
      op.choice = 'exist'; op.target = s ? { code: s.code, name: s.name } : null;
    }
    else if (act === 'pick') {
      var pc = b.getAttribute('data-code');
      var hit = c.similar.filter(function (x) { return x.code === pc; })[0] || _projByCode(pc);
      op.target = hit ? { code: hit.code, name: hit.name } : null;
    }
    else if (act === 'kind') { op.kind = b.getAttribute('data-k'); op.code = ''; op.letter = ''; }
    else if (act === 'letter') { op.letter = b.getAttribute('data-l'); op.code = _sugg[op.letter] || ''; }
    else if (act === 'do-exist') { _doExist(c, op); return; }
    else if (act === 'do-new') { _doNew(c, op); return; }
    else if (act === 'do-not') { _doNot(c); return; }
    _rerenderCard(key);
  }
  function _onInput(e) {
    var t = e.target, f = t.getAttribute && t.getAttribute('data-in');
    if (!f) return;
    var el = t.closest('[data-key]'); if (!el) return;
    var key = el.getAttribute('data-key'), op = _open[key] || (_open[key] = {});
    op[f] = String(t.value || '').trim();
    if (f === 'code' && op.kind === 'formal') op.code = op.code.toUpperCase();
    // 입력칸은 그대로 두고 아래 결과·버튼만 다시 그린다 (포커스 유지)
    var c = _card(key); if (!c) return;
    if (f === 'tq') { var r = el.querySelector('.mt-results'); if (r) r.innerHTML = _resultsHtml(c, op); }
    var go = el.querySelector('.mt-go');
    if (go && f === 'code') {
      var ok = (op.kind === 'formal' && FORMAL_RE.test(op.code)) || (op.kind === 'review' && REVIEW_RE.test(op.code));
      go.disabled = !ok; go.textContent = ok ? '등록하기' : '코드를 확인해 주세요';
    }
  }
  function _rerenderCard(key) {
    var c = _card(key), el = document.querySelector('#mode-master-body .mt-card[data-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
    if (!c || !el) { _renderList(); return; }
    var tmp = document.createElement('div'); tmp.innerHTML = _cardHtml(c);
    el.parentNode.replaceChild(tmp.firstChild, el);
  }

  // ── 처리 ─────────────────────────────────────
  function _run(c, payload, okMsg, after) {
    _busy[c.key] = true; delete _err[c.key]; _rerenderCard(c.key);
    _post(payload).then(function (resp) {
      if (resp && resp.ok) { _finish(c, typeof okMsg === 'function' ? okMsg(resp) : okMsg); if (after) after(resp); return; }
      if (resp && resp.reason === 'not_alias' && c.type === 'pending') {
        // 업무 문장이라 별칭은 못 남긴다 — 등록 대기만 지우고 연결한 걸로 친다
        return _post({ action: 'reject_pj_learning', source_key: c.src['키'] || '', source_value: c.src['값'] || '' }).then(function (r2) {
          if (r2 && r2.ok) _finish(c, '업무 문장이라 별칭은 남기지 않고 정리했어요');
          else _fail(c, r2, payload.action);
        });
      }
      _fail(c, resp, payload.action);
    }).catch(function (e) { _fail(c, { message: '' }, payload.action, e); });
  }
  function _fail(c, resp, action, e) {
    console.error('[master] ' + action, resp, e || '');
    _busy[c.key] = false;
    _err[c.key] = (resp && (resp.message || resp.error)) ? '처리하지 못했어요 — ' + (resp.message || resp.error) : '처리하지 못했어요. 잠시 뒤 다시 눌러 주세요';
    _rerenderCard(c.key);
  }
  function _finish(c, msg) {
    delete _busy[c.key]; delete _open[c.key]; delete _err[c.key];
    if (c.type === 'pending') _pending = _pending.filter(function (p) { return 'P:' + p['키'] !== c.key; });
    else _temps = _temps.filter(function (t) { return t.code !== c.code; });
    _badge();
    if (typeof toast === 'function') toast(msg);
    _renderList();
  }

  function _doExist(c, op) {
    if (!op.target) return;
    if (c.type === 'temp') {
      _run(c, { action: 'master_merge', code: c.code, target: op.target.code }, c.code + ' 를 ' + op.target.code + ' 로 합쳤어요');
    } else {
      _run(c, { action: 'register_pj_alias_only', pj_code: op.target.code, source_key: c.src['키'] || '', source_value: c.src['값'] || '' },
           op.target.code + ' 에 연결했어요');
    }
  }
  function _doNew(c, op) {
    var code = String(op.code || '').trim();
    if (op.kind === 'formal') code = code.toUpperCase();
    if (code && _projByCode(code)) { _err[c.key] = code + ' 는 이미 있어요 (' + _projByCode(code).name + ') — 같은 사업이면 \'이미 있는 사업이에요\'를 눌러 주세요'; _rerenderCard(c.key); return; }
    if (c.type === 'temp') {
      _run(c, { action: 'master_formalize', code: c.code, new_code: code }, function (r) {
        _projects.push({ code: r.code || code, name: c.name }); return c.code + ' → ' + (r.code || code) + ' 로 바꿨어요';
      });
    } else {
      var name = String(op.name != null ? op.name : c.name).trim();
      _run(c, { action: 'master_register', kind: op.kind, name: name, code: code, source_key: c.src['키'] || '', source_value: c.src['값'] || '' }, function (r) {
        var nc = r.code || r.pj_code || code;
        if (nc) _projects.push({ code: nc, name: name });
        return r.existed ? '이미 목록에 있어 ' + nc + ' 로 연결했어요' : nc + ' 로 등록했어요';
      }, function () { _loadTemps(); });   // 임시코드로 등록했으면 아래 목록에도 보이게
    }
  }
  function _doNot(c) {
    if (c.type === 'temp') _run(c, { action: 'master_exclude', code: c.code }, c.code + ' 를 목록에서 뺐어요');
    else _run(c, { action: 'reject_pj_learning', source_key: c.src['키'] || '', source_value: c.src['값'] || '' }, '등록 대기에서 지웠어요');
  }

  // ── 코드가 바뀌는 순서 (접힌 안내) ─────────────────────
  // 정본: HIMNAEJA reference/PROJECT_CODE_SPEC.md '한눈에 보기' — 고칠 땐 거기부터
  function _guideHtml() {
    return '<details class="mt-guide"><summary>코드가 바뀌는 순서 · NAS 폴더와의 관계</summary><div class="mt-guide-body">' +
      '<ol>' +
      '<li><b>보고에 새 이름이 나오면</b> 목록에 없을 때 <code>TEMP-날짜-번호</code>가 자동으로 붙어요. 직원은 그 코드로 그대로 보고하면 돼요.</li>' +
      '<li><b>실이 NAS 검토 폴더(NN_YYMMDD_이름)를 만들면</b> 여기서 [새 사업이 맞아요 › 검토 중이에요]에 폴더 번호·날짜 그대로 <code>검토-NN_YYMMDD</code>를 넣어 주세요.</li>' +
      '<li><b>계약되면</b> 재무 원장 코드(= NAS 프로젝트 폴더 <code>YY-X##</code>)로 [계약됐어요]. 옛 코드는 별칭으로 남아 지난 보고도 이어져요.</li>' +
      '<li><b>사업이 아니면</b> [사업이 아니에요] — 나중에 되돌릴 수 있어요.</li>' +
      '</ol>' +
      '<p><b>NAS에 폴더만 만들어서는 아무것도 바뀌지 않아요.</b> 서버가 NAS에 닿지 않아요 — 여기서 코드를 바꿔 주셔야 해요. 빠진 건 매주 월요일 점검이 찾아 알려요.</p>' +
      '<p class="mt-guide-dim">반영: 보고창·브리핑 10분 안 · 노션 1시간 안 · 힘내자 대시보드 다음 날 새벽</p>' +
      '</div></details>';
  }

  // ── 하루 한 번 안내 팝업 (승인자, 확인할 게 있을 때만) ─────────
  //   2026-10-13 — 탭을 열어 보지 않으면 임시코드가 쌓이기만 했다. 매번 뜨면 무시하게 되니 하루 한 번.
  function _maybePopup() {
    var nNew = _pending.length, nTemp = _temps.filter(function (t) { return t.stage !== '종결'; }).length;
    if (!nNew && !nTemp) return;
    if (typeof activeMode !== 'undefined' && activeMode === 'master') return;     // 이미 탭에 있음
    var key = 'mt_popup_' + String((profile && profile.email) || ''), today = new Date();
    var ymd = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
    try { if (localStorage.getItem(key) === ymd) return; localStorage.setItem(key, ymd); } catch (e) {}
    if (document.getElementById('mt-pop')) return;
    var box = document.createElement('div');
    box.id = 'mt-pop'; box.className = 'mt-pop';
    box.innerHTML =
      '<div class="mt-pop-card" role="dialog" aria-modal="true" aria-labelledby="mt-pop-t">' +
        '<div class="mt-pop-t" id="mt-pop-t">🗂️ 새 사업 확인 부탁드려요</div>' +
        '<p>보고에서 새로 나온 사업이 있어요. 마스터 탭에서 같은 사업이 있는지, 새 사업인지 확인해 주세요 — 브리핑과 프로젝트 화면이 정확해져요.</p>' +
        '<div class="mt-pop-n">' + (nNew ? '<span>새로 찾음 <b>' + nNew + '</b>건</span>' : '') + '<span>확인 기다리는 임시코드 <b>' + nTemp + '</b>건</span></div>' +
        '<button type="button" class="mt-go" data-pop="go">마스터 탭에서 확인하기</button>' +
        '<button type="button" class="mt-pop-later" data-pop="later">오늘은 나중에</button>' +
      '</div>';
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pop]');
      if (!b && e.target !== box) return;
      box.remove();
      if (b && b.getAttribute('data-pop') === 'go' && typeof onTabClick === 'function') { onTabClick('master'); window.scrollTo(0, 0); }
    });
    document.body.appendChild(box);
  }

  // ── 스타일 (이 탭만 쓰는 것) ─────────────────────────
  function _injectStyle() {
    if (document.getElementById('mt-style')) return;
    var s = document.createElement('style'); s.id = 'mt-style';
    s.textContent = [
      '#mode-master-body{--mt:#8A6D3B;--mt-tint:rgba(138,109,59,.10)}',
      '.mt-intro{font-size:14px;color:var(--ink2);margin:0 0 10px;line-height:1.6}',
      '.mt-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}',
      '.mt-chips{display:flex;gap:6px;flex-wrap:wrap}',
      '.mt-chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;color:var(--ink2);cursor:pointer;min-height:34px}',
      '.mt-chip span{color:var(--ink3);margin-left:2px}',
      '.mt-chip.on{background:var(--ink);border-color:var(--ink);color:#fff}.mt-chip.on span{color:rgba(255,255,255,.75)}',
      '.mt-search{flex:1;min-width:160px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit;font-size:14px;background:#fff}',
      '.mt-list{display:flex;flex-direction:column;gap:10px}',
      '.mt-empty{padding:18px;text-align:center;color:var(--ink3);font-size:14px;background:#fff;border:1px dashed var(--line);border-radius:10px}',
      '.mt-empty.err{color:var(--brush-rose)}',
      '.mt-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px}',
      '.mt-card.busy{opacity:.6;pointer-events:none}',
      '.mt-tags{display:flex;gap:6px;margin-bottom:6px}',
      '.mt-tag{font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid var(--line);color:var(--ink3)}',
      '.mt-tag.new{background:var(--mt-tint);border-color:var(--mt);color:var(--mt);font-weight:600}',
      '.mt-tag.temp{border-style:dashed}',
      '.mt-name{font-size:16px;font-weight:600;line-height:1.45;word-break:keep-all}',
      '.mt-meta{font-size:13px;color:var(--ink3);margin-top:2px}',
      '.mt-memo{font-size:13px;color:var(--ink2);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mt-sim{display:block;width:100%;text-align:left;margin-top:10px;padding:8px 10px;border-radius:8px;border:1px solid var(--mt);background:var(--mt-tint);color:var(--ink);font:inherit;font-size:13px;cursor:pointer}',
      '.mt-sim b{color:var(--mt)}',
      '.mt-choices{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}',
      '.mt-btn{flex:1 1 auto;min-height:40px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;font:inherit;font-size:14px;color:var(--ink);cursor:pointer}',
      '.mt-btn:hover{border-color:var(--mt)}',
      '.mt-btn.on{border-color:var(--mt);background:var(--mt-tint);color:var(--mt);font-weight:600}',
      '.mt-panel{margin-top:10px;padding:12px;border-radius:10px;background:var(--paper2)}',
      '.mt-label{font-size:13px;color:var(--ink2);margin:8px 0 6px}.mt-panel .mt-label:first-child{margin-top:0}',
      '.mt-opts{display:flex;flex-direction:column;gap:6px}',
      '.mt-opt{text-align:left;min-height:40px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;font:inherit;font-size:14px;color:var(--ink);cursor:pointer;word-break:keep-all}',
      '.mt-opt b{color:var(--ink2);margin-right:2px}',
      '.mt-opt.on{border-color:var(--mt);background:var(--mt-tint)}.mt-opt.on b{color:var(--mt)}',
      '.mt-input{display:block;width:100%;box-sizing:border-box;margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:9px 10px;font:inherit;font-size:15px;background:#fff}',
      '.mt-results{margin-top:6px}',
      '.mt-hint{font-size:13px;color:var(--ink3);margin:8px 0 0;line-height:1.55}',
      '.mt-go{display:block;width:100%;margin-top:10px;min-height:44px;border:0;border-radius:8px;background:var(--mt);color:#fff;font:inherit;font-size:15px;font-weight:600;cursor:pointer}',
      '.mt-go:disabled{background:var(--line);color:var(--ink3);cursor:default}',
      '.mt-go.danger{background:var(--brush-rose)}',
      '.mt-err{margin-top:8px;font-size:13px;color:#B5533C}',
      '.mt-guide{margin:0 0 12px;border:1px solid var(--line);border-radius:10px;background:#fff}',
      '.mt-guide summary{cursor:pointer;padding:10px 12px;font-size:14px;color:var(--mt);font-weight:600;min-height:20px}',
      '.mt-guide-body{padding:0 14px 12px;font-size:13.5px;line-height:1.7;color:var(--ink2)}',
      '.mt-guide-body ol{margin:0 0 8px;padding-left:20px}.mt-guide-body li{margin-bottom:4px}',
      '.mt-guide-body code{background:var(--paper2);padding:0 4px;border-radius:4px;font-size:12.5px}',
      '.mt-guide-body p{margin:6px 0 0}.mt-guide-dim{color:var(--ink3);font-size:12.5px}',
      '.mt-pop{position:fixed;inset:0;z-index:9999;background:rgba(30,30,25,.45);display:flex;align-items:center;justify-content:center;padding:16px}',
      '.mt-pop-card{background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px;box-shadow:0 10px 30px rgba(0,0,0,.2);--mt:#8A6D3B}',
      '.mt-pop-t{font-size:17px;font-weight:700;margin-bottom:8px;color:var(--ink)}',
      '.mt-pop-card p{font-size:14px;line-height:1.65;color:var(--ink2);margin:0 0 10px}',
      '.mt-pop-n{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:13.5px;color:var(--ink2);margin-bottom:4px}.mt-pop-n b{color:#8A6D3B}',
      '.mt-pop-later{display:block;width:100%;margin-top:6px;min-height:40px;border:0;background:transparent;color:var(--ink3);font:inherit;font-size:14px;cursor:pointer}',
      '@media (max-width:600px){.mt-choices{flex-direction:column}.mt-btn{width:100%}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  return { boot: boot, init: init, refresh: refresh };
})();
