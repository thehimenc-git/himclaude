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
  var _nas = [], _nasRecent = [];   // NAS 폴더 — 확인할 것(애매한 것) · 최근 자동 반영 (2026-10-13, GAS NasSync.js)
  var _sugg = {}, _meaning = {}, _loaded = false, _tempsLoaded = false, _tempsErr = '';
  var _filter = 'todo', _q = '', _timer = null;
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
  function _atText(v) { var d = new Date(v); return isNaN(d) ? String(v || '') : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function _md(d) { var m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? (+m[1]) + '/' + (+m[2]) : ''; }

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
    var n = _pending.length + _nas.length;
    if (b) b.textContent = n ? String(n) : '';
  }

  // ── 카드 목록 ─────────────────────────────────────
  function _cards() {
    var out = [];
    _nas.forEach(function (x) {
      out.push({ key: 'N:' + x.code, type: 'nas', code: x.code, name: x.name || x.folder || '', folder: x.folder || '', cands: x.cands || [],
                 nasKind: x.kind || '', reports: 0, last: '', who: [], similar: [], done: false });
    });
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
      var rank = { nas: 0, pending: 1, temp: 2 };                                   // NAS 확인 → 새로 찾음 → 임시코드
      if (a.type !== b.type) return rank[a.type] - rank[b.type];
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
    var h = _recentHtml();
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
    if (c.type === 'nas') return _nasCardHtml(c);
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

  // NAS 에 폴더가 생겼는데 이어지는 사업이 애매할 때 — 후보 하나를 고르거나 '새 사업' (2026-10-13)
  function _nasCardHtml(c) {
    var k = _esc(c.key), op = _open[c.key] || {}, busy = _busy[c.key] ? ' disabled' : '';
    var what = c.nasKind === 'project' ? '계약 프로젝트 폴더' : '검토 폴더';
    var h = '<div class="mt-card mt-nas' + (_busy[c.key] ? ' busy' : '') + '" data-key="' + k + '">';
    h += '<div class="mt-tags"><span class="mt-tag nas">NAS 폴더</span><span class="mt-tag">' + _esc(c.code) + '</span></div>';
    h += '<div class="mt-name">' + _esc(c.name) + '</div>';
    h += '<div class="mt-meta">NAS에 새 ' + what + '가 생겼어요. 이미 목록에 있는 사업과 같은지 확인해 주세요.</div>';
    h += '<div class="mt-panel"><div class="mt-label">어느 쪽인가요?</div><div class="mt-opts">';
    c.cands.forEach(function (x) {
      var on = op.picked === x.code;
      h += '<button type="button" class="mt-opt' + (on ? ' on' : '') + '" data-act="nas-pick" data-code="' + _esc(x.code) + '"><b>' + _esc(x.code) + '</b> ' + _esc(x.name) + ' 와 같은 사업이에요</button>';
    });
    h += '<button type="button" class="mt-opt' + (op.picked === '' ? ' on' : '') + '" data-act="nas-pick" data-code="">새 사업이에요 — ' + _esc(c.code) + ' 로 새로 등록</button>';
    h += '</div>';
    if (op.picked != null) {
      h += '<button type="button" class="mt-go" data-act="do-nas"' + busy + '>' +
           (op.picked ? _esc(op.picked) + ' → ' + _esc(c.code) + ' 로 바꾸기' : _esc(c.code) + ' 새로 등록하기') + '</button>';
    }
    h += '</div>';
    if (_err[c.key]) h += '<div class="mt-err">' + _esc(_err[c.key]) + '</div>';
    return h + '</div>';
  }

  // 최근 자동 반영 — 확실해서 NAS 가 알아서 바꾼 것. 관리자가 모르고 지나가지 않게 (접힘)
  function _recentHtml() {
    if (!_nasRecent.length) return '';
    var label = { register_review: '새 검토 등록', register_formal: '새 정식 등록', formalize: '코드 변경', stage: '단계 변경' };
    return '<details class="mt-guide mt-recent"><summary>NAS가 자동으로 바꾼 것 · 최근 7일 ' + _nasRecent.length + '건</summary><div class="mt-guide-body"><ul>' +
      _nasRecent.map(function (r) {
        return '<li><b>' + _esc(r.code) + '</b> ' + _esc(label[r.op] || r.op) + ' — ' + _esc(r.folder || r.detail) + ' <span class="mt-guide-dim">' + _esc(_atText(r.at)) + '</span></li>';
      }).join('') + '</ul><p class="mt-guide-dim">틀린 게 있으면 이 탭이나 노션에서 바로 고치면 돼요.</p></div></details>';
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
    else if (act === 'nas-pick') { op.picked = b.getAttribute('data-code'); }
    else if (act === 'do-nas') {
      _run(c, { action: 'nas_resolve', code: c.code, target: op.picked || '' },
           op.picked ? op.picked + ' → ' + c.code + ' 로 바꿨어요' : c.code + ' 를 새로 등록했어요',
           function () { _loadTemps(); });   // 바뀐 임시코드·새 행이 아래 목록에도 보이게
      return;
    }
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
    if (c.type === 'nas') _nas = _nas.filter(function (x) { return x.code !== c.code; });
    else if (c.type === 'pending') _pending = _pending.filter(function (p) { return 'P:' + p['키'] !== c.key; });
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
      '<li><b>실이 NAS 검토 폴더(NN_YYMMDD_이름)를 만들면</b> 자동으로 <code>검토-NN_YYMMDD</code>가 돼요 — 이어지는 임시코드가 하나로 확실하면 그걸 바꾸고, 없으면 새로 등록해요.</li>' +
      '<li><b>계약되어 NAS 프로젝트 폴더(<code>YY-X##</code>)가 생기면</b> 같은 방식으로 정식 코드가 돼요. 옛 코드는 별칭으로 남아 지난 보고도 이어져요.</li>' +
      '<li><b>사업이 아니면</b> [사업이 아니에요] — 나중에 되돌릴 수 있어요.</li>' +
      '</ol>' +
      '<p><b>NAS 폴더는 평일 08:45·16:30에 읽어요.</b> 비슷한 이름이 여럿이라 애매하면 바꾸지 않고 맨 위 [NAS 폴더] 카드로 물어봐요 — 골라 주세요. 자동으로 바꾼 건 아래 「NAS가 자동으로 바꾼 것」에 남아요. 폴더 이름의 (취소)·미계약 종결도 단계에 반영돼요.</p>' +
      '<p class="mt-guide-dim">반영: 보고창·브리핑 10분 안 · 노션 1시간 안 · 힘내자 대시보드 다음 날 새벽</p>' +
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
    var keys = Object.keys(seen).filter(function (k) { return k.charAt(0) === '#' || live[k] || (!_tempsLoaded && k.indexOf('T:') === 0); });
    try { localStorage.setItem(_seenKey(), JSON.stringify(keys)); } catch (e) { console.warn('[master] seen', e); }
  }
  function _allKeys() {
    var k = [];
    _nas.forEach(function (x) { k.push('N:' + x.code); });
    _pending.forEach(function (p) { k.push('P:' + p['키']); });
    _nasRecent.forEach(function (r) { k.push('R:' + r.at + r.code); });
    _temps.forEach(function (t) { k.push('T:' + t.code); });
    return k;
  }
  // 알림 한 줄씩 — 확인할 것(act) 먼저, 그다음 알아만 두면 되는 것(NAS 자동 반영·새 임시코드)
  function _alerts() {
    var out = [];
    _nas.forEach(function (x) { out.push({ key: 'N:' + x.code, act: true, tag: 'NAS 폴더', text: x.code + ' ' + (x.name || x.folder || '') + ' — 같은 사업인지 골라 주세요' }); });
    _pending.forEach(function (p) { out.push({ key: 'P:' + p['키'], act: true, tag: '새로 찾음', text: (p['키'] || '') + ' — 사업인지 확인해 주세요' }); });
    _nasRecent.forEach(function (r) { out.push({ key: 'R:' + r.at + r.code, act: false, tag: 'NAS 자동', text: r.code + ' ' + (r.folder || r.detail || '') }); });
    _temps.forEach(function (t) { if (t.stage !== '종결') out.push({ key: 'T:' + t.code, act: false, tag: '새 임시코드', text: t.code + ' ' + (t.name || '') }); });
    var seen = _readSeen(), changed = false;
    if (_loaded && !seen['#R']) { _nasRecent.forEach(function (r) { seen['R:' + r.at + r.code] = 1; }); seen['#R'] = 1; changed = true; }
    if (_tempsLoaded && !_tempsErr && !seen['#T']) { _temps.forEach(function (t) { seen['T:' + t.code] = 1; }); seen['#T'] = 1; changed = true; }
    if (changed) _writeSeen(seen);
    // 기준선 잡기 전(목록이 아직 안 옴)엔 그 목록은 새것으로 치지 않는다
    if (!seen['#T']) _temps.forEach(function (t) { seen['T:' + t.code] = 1; });
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
      '.mt-tag.nas{background:#E8F0F7;border-color:#5B7FA3;color:#2F5F8A;font-weight:600}',
      '.mt-card.mt-nas{border-color:#9DB6CF}',
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
      '.ud-out{display:block;width:100%;margin-top:8px;min-height:42px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink2);font:inherit;font-size:14px;cursor:pointer}',
      '@media (max-width:600px){.mt-choices{flex-direction:column}.mt-btn{width:100%}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  return { boot: boot, init: init, refresh: refresh, menu: menu };
})();
