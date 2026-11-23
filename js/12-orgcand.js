// 12-orgcand.js — 마스터 탭 「사람」: 인명부 후보 정리 (승인자 전용, 2026-11-23)
//   「인명부 마스터」 「후보」 탭을 하나씩 고른다. 규칙은 GAS OrgCandidates.js 한 곳(org_cand_list · org_cand_resolve),
//   힘내자 대시보드 데이터 정리도 같은 창구를 부른다 — 프로젝트 코드 정리(마스터 탭 「사업」)와 같은 구조.
//   카드 세 가지:
//     · 지금 담당?        사업 조직도 줄의 지금 담당 자리를 후보 2~3개 중에서 고른다
//     · 같은 사람?        같은 이름이 여럿 — 같은 사람만 골라 한 사람으로 묶는다(합침 칸만 채움, 지우지 않음)
//     · 명함과 같은 사람? 리멤버 명함과 같은 사람인지
//   자동으로 합치지 않는다 — 한 장에 한 번 누르는 것까지는 사람이 한다.
//   읽기는 이메일(마스터 탭 다른 목록과 같음), 처리는 인증코드 로그인 세션(누가 정리했는지 서버가 직원목록 이름으로 남긴다).
//   전역 재사용: profile, APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, escapeHtml, toast, getSession, MasterTab.
var OrgCand = (function () {
  var _items = [], _loaded = false, _loading = false, _err = '';
  var _box = null, _filter = 'all', _q = '', _shown = 30;
  var _skip = {};       // 나중에 — 이 화면에서만 뒤로 미룬다
  var _sel = {};        // cand_id → { keys: {사람키: true}, seat: 자리ID }
  var _busy = {};
  var KINDS = [['all', '전체'], ['지금 담당?', '지금 담당'], ['같은 사람?', '같은 사람'], ['명함과 같은 사람?', '명함']];

  function _esc(s) { return escapeHtml(String(s == null ? '' : s)); }
  function _post(payload) {
    payload.token = APPS_SCRIPT_TOKEN;
    payload.email = (profile && profile.email) || '';
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }
  function _tail(path, n) { return (path || []).slice(1).slice(-(n || 3)).join(' › '); }

  // ── 불러오기 ── 승인자 확인 뒤 마스터 탭이 한 번 부른다(칩 숫자 · 알림용), 「사람」을 열 때 다시 그린다
  function load(force) {
    if (_loading || (_loaded && !force)) return;
    _loading = true; _err = '';
    _post({ action: 'org_cand_list' })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.message) || '응답 없음');
        _items = j.items || [];
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
        '<p class="mt-intro">인명부에 같은 이름이 여럿이거나, 사업 조직도의 지금 담당을 못 고른 것들이에요. 한 장씩 골라 주세요 — 같은 사람이면 한 사람으로 묶이고(지우지 않아요), 누가 골랐는지 변경이력에 남아요.</p>' +
        '<div class="mt-bar"><div class="mt-chips oc-chips"></div><input type="search" class="mt-search oc-search" placeholder="이름·사업 코드로 찾기" /></div>' +
        '<div class="oc-list"></div>';
      box.querySelector('.oc-search').addEventListener('input', function (e) { _q = String(e.target.value || ''); _shown = 30; _renderList(); });
      box.addEventListener('click', _onClick);
      box.addEventListener('change', _onChange);
    }
    if (!_loaded) load(); else _render();
  }

  // ── 그리기 ──
  function _visible() {
    var q = _q.replace(/\s+/g, '').toLowerCase();
    return _items.filter(function (it) {
      if (_filter !== 'all' && it.kind !== _filter) return false;
      if (!q) return true;
      var hay = it.title + ' ' + (it.people || []).map(function (p) { return p.name + ' ' + p.projects.join(' '); }).join(' ') + ' ' + ((it.link && it.link.code) || '');
      return hay.replace(/\s+/g, '').toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return (_skip[a.cand_id] ? 1 : 0) - (_skip[b.cand_id] ? 1 : 0); });   // 나머지 순서는 서버 순서(쓸모 큰 것부터)
  }
  function _render() { if (_box && _box.getAttribute('data-oc')) _renderList(); }
  function _renderList() {
    var cnt = { all: _items.length };
    _items.forEach(function (it) { cnt[it.kind] = (cnt[it.kind] || 0) + 1; });
    _box.querySelector('.oc-chips').innerHTML = KINDS.map(function (k) {
      return '<button type="button" class="mt-chip' + (_filter === k[0] ? ' on' : '') + '" data-oc="filter" data-f="' + _esc(k[0]) + '">' + k[1] + ' <span>' + (cnt[k[0]] || 0) + '</span></button>';
    }).join('');
    var list = _box.querySelector('.oc-list');
    if (_err) { list.innerHTML = '<div class="mt-empty err">' + _esc(_err) + ' <button type="button" class="mt-btn" data-oc="reload">다시 시도</button></div>'; return; }
    if (!_loaded) { list.innerHTML = '<div class="mt-empty">불러오는 중이에요… (처음엔 몇 초 걸려요)</div>'; return; }
    var vis = _visible();
    if (!vis.length) { list.innerHTML = '<div class="mt-empty">' + (_q ? '찾는 이름이 없어요' : '정리할 사람이 없어요 — 같은 이름이 새로 생기면 여기에 떠요') + '</div>'; return; }
    var h = '';
    vis.slice(0, _shown).forEach(function (it) { h += _cardHtml(it); });
    if (vis.length > _shown) h += '<button type="button" class="mt-btn oc-more" data-oc="more">더 보기 (' + (vis.length - _shown) + ')</button>';
    list.innerHTML = h;
  }

  function _personHtml(it, p, sel, target) {
    var seat = p.seat;
    return '<label class="oc-p">' +
      '<input type="checkbox" data-oc="key" data-k="' + _esc(p.person_key) + '"' + (sel.keys[p.person_key] ? ' checked' : '') + ' />' +
      '<span class="oc-pb"><b>' + _esc(p.name) + '</b> <span class="oc-dim">' + _esc(p.role || '') + '</span>' +
      (p.person_key === target ? ' <span class="oc-tag">기준</span>' : '') +
      (seat ? '<span class="oc-line oc-now">지금 조직도 · ' + _esc(_tail(seat.path, 2)) + ' ' + _esc(seat.role) + (seat.ext ? ' · ☎' + _esc(seat.ext) : '') + '</span>' : '') +
      (p.where && p.where.length ? '<span class="oc-line">' + (seat ? '사업 조직도 · ' : '') + _esc(_tail(p.where, 3)) + '</span>' : '') +
      (p.projects.length ? '<span class="oc-line oc-dim">사업 ' + _esc(p.projects.join(' · ')) + '</span>' : '') +
      (p.phone ? '<span class="oc-line oc-dim">' + _esc(p.phone) + '</span>' : '') +
      '</span></label>';
  }
  // 합칠 기준 — 지금 조직도에 앉은 사람 > 사업이 많은 사람 > 앞 사람. 명함 후보는 명함 키
  function _target(it, sel) {
    if (it.kind === '명함과 같은 사람?' && it.remember) return it.remember.person_key;
    var on = (it.people || []).filter(function (p) { return sel.keys[p.person_key]; });
    on.sort(function (a, b) { return (b.seat ? 1 : 0) - (a.seat ? 1 : 0) || b.projects.length - a.projects.length; });
    return on.length ? on[0].person_key : '';
  }
  function _selOf(it) {
    if (!_sel[it.cand_id]) {
      var keys = {};
      (it.people || []).forEach(function (p) { keys[p.person_key] = true; });
      if (it.remember) keys[it.remember.person_key] = true;
      _sel[it.cand_id] = { keys: keys, seat: '' };
    }
    return _sel[it.cand_id];
  }
  function _cardHtml(it) {
    var sel = _selOf(it), busy = !!_busy[it.cand_id];
    var h = '<div class="mt-card oc-card' + (_skip[it.cand_id] ? ' oc-skipped' : '') + '" data-cid="' + _esc(it.cand_id) + '">';
    h += '<div class="oc-head"><span class="oc-kind">' + _esc(it.kind.replace('?', '')) + '</span> <b>' + _esc(it.title) + '</b></div>';
    if (it.kind === '지금 담당?') {
      var l = it.link || {}, p = l.person;
      h += '<p class="oc-line">' + _esc(l.code || '') + ' 사업 조직도 · ' + _esc(_tail(l.path, 3)) + ' — 당시 <b>' + _esc((p && p.name) || '이름 없음') + '</b> ' + _esc(l.role || '') + '</p>';
      if (l.duties) h += '<p class="oc-line oc-dim">' + _esc(l.duties) + '</p>';
      h += '<p class="oc-q">지금은 누가 맡나요?</p>';
      (it.seats || []).forEach(function (s) {
        h += '<label class="oc-p"><input type="radio" name="oc-' + _esc(it.cand_id) + '" data-oc="seat" value="' + _esc(s.seat_id) + '"' + (sel.seat === s.seat_id ? ' checked' : '') + ' />' +
             '<span class="oc-pb"><b>' + _esc(s.name || '공석') + '</b> <span class="oc-dim">' + _esc(s.role) + ' · ' + _esc(_tail(s.path, 1)) + (s.ext ? ' · ☎' + _esc(s.ext) : '') + '</span>' +
             (s.duties ? '<span class="oc-line oc-dim">' + _esc(String(s.duties).replace(/\n/g, ' · ')) + '</span>' : '') + '</span></label>';
      });
      h += '<div class="oc-acts"><button type="button" class="mt-btn primary" data-oc="pick"' + (sel.seat && !busy ? '' : ' disabled') + '>이 사람이 맡아요</button>' +
           '<button type="button" class="mt-btn" data-oc="later">나중에</button></div>';
    } else {
      var target = _target(it, sel);
      (it.people || []).forEach(function (p) { h += _personHtml(it, p, sel, target); });
      if (it.remember) {
        h += '<label class="oc-p"><input type="checkbox" checked disabled /><span class="oc-pb"><b>리멤버 명함</b> <span class="oc-tag">기준</span>' +
             '<span class="oc-line">' + _esc(it.remember.text) + '</span></span></label>';
      }
      var n = Object.keys(sel.keys).filter(function (k) { return sel.keys[k]; }).length;
      if (it.people && it.people.length > 2) h += '<p class="oc-line oc-dim">같은 사람만 체크해 두고 [같은 사람이에요]를 누르면, 체크 안 한 사람은 그대로 남아요.</p>';
      h += '<div class="oc-acts"><button type="button" class="mt-btn primary" data-oc="same"' + (n >= 2 && target && !busy ? '' : ' disabled') + '>같은 사람이에요</button>' +
           '<button type="button" class="mt-btn" data-oc="different"' + (busy ? ' disabled' : '') + '>다른 사람이에요</button>' +
           '<button type="button" class="mt-btn" data-oc="later">나중에</button></div>';
    }
    if (it.basis) h += '<p class="oc-basis">' + _esc(it.basis) + '</p>';
    return h + '</div>';
  }

  // ── 고르기 ──
  function _find(cid) { return _items.filter(function (x) { return x.cand_id === cid; })[0]; }
  function _onChange(e) {
    var t = e.target, card = t.closest('[data-cid]');
    if (!card) return;
    var it = _find(card.getAttribute('data-cid')); if (!it) return;
    var sel = _selOf(it), act = t.getAttribute('data-oc');
    if (act === 'key') sel.keys[t.getAttribute('data-k')] = t.checked;
    if (act === 'seat') sel.seat = t.value;
    card.outerHTML = _cardHtml(it);
  }
  function _onClick(e) {
    var b = e.target.closest('[data-oc]');
    if (!b || b.disabled || b.tagName === 'INPUT') return;
    var act = b.getAttribute('data-oc');
    if (act === 'filter') { _filter = b.getAttribute('data-f'); _shown = 30; _renderList(); return; }
    if (act === 'reload') { load(true); _renderList(); return; }
    if (act === 'more') { _shown += 30; _renderList(); return; }
    var card = b.closest('[data-cid]'); if (!card) return;
    var it = _find(card.getAttribute('data-cid')); if (!it) return;
    if (act === 'later') { _skip[it.cand_id] = true; _renderList(); return; }
    var sel = _selOf(it), payload = { action: 'org_cand_resolve', cand_id: it.cand_id, decision: act };
    if (act === 'same') {
      payload.keys = Object.keys(sel.keys).filter(function (k) { return sel.keys[k]; });
      payload.target = _target(it, sel);
    }
    if (act === 'pick') payload.seat_id = sel.seat;
    _resolve(it, payload);
  }
  function _resolve(it, payload) {
    var sess = (typeof getSession === 'function') ? getSession() : '';
    if (!sess) { toast('인증코드로 로그인한 뒤 정리할 수 있어요'); return; }
    payload.session = sess;
    _busy[it.cand_id] = true;
    _renderList();
    _post(payload)
      .then(function (j) {
        if (j && (j.ok || j.reason === 'done')) {
          _items = _items.filter(function (x) { return x.cand_id !== it.cand_id; });
          toast(j.ok ? (j.status === '같은 사람' ? '한 사람으로 묶었어요' : j.status === '자리 고름' ? '지금 담당을 이었어요' : '다른 사람으로 두었어요') : j.message);
          _count();
          return;
        }
        toast(j && j.reason === 'session_invalid' ? '로그인이 풀렸어요 — 다시 로그인해 주세요' : (j && j.message) || '저장하지 못했어요');
      })
      .catch(function (e) { console.error('[orgcand] resolve', e); toast('저장하지 못했어요 — 잠시 뒤 다시 해 주세요'); })
      .then(function () { delete _busy[it.cand_id]; _renderList(); });
  }

  function _injectStyle() {
    if (document.getElementById('oc-style')) return;
    var s = document.createElement('style'); s.id = 'oc-style';
    s.textContent = [
      '.oc-card{padding:12px 14px}',
      '.oc-card.oc-skipped{opacity:.55}',
      '.oc-head{font-size:14px;line-height:1.5;margin-bottom:6px}',
      '.oc-kind{display:inline-block;font-size:11px;padding:1px 7px;border-radius:9px;background:var(--mt-tint);color:var(--mt);margin-right:4px;vertical-align:1px}',
      '.oc-p{display:flex;gap:8px;align-items:flex-start;padding:8px 6px;border-radius:8px;cursor:pointer;min-height:44px}',
      '.oc-p:hover{background:var(--mt-tint)}',
      '.oc-p input{margin-top:3px;flex:none;width:18px;height:18px}',
      '.oc-pb{display:flex;flex-direction:column;gap:2px;min-width:0;font-size:14px;overflow-wrap:anywhere}',
      '.oc-line{display:block;font-size:12.5px;color:var(--ink2);line-height:1.5;margin:0}',
      '.oc-now{color:var(--mt);font-weight:600}',
      '.oc-dim{color:var(--ink3,#888)}',
      '.oc-tag{font-size:11px;padding:0 6px;border-radius:8px;border:1px solid var(--mt);color:var(--mt)}',
      '.oc-q{font-size:13px;font-weight:600;margin:8px 0 2px}',
      '.oc-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
      '.oc-list{display:flex;flex-direction:column;gap:10px}',
      '.oc-acts .mt-btn.primary{background:var(--mt);border-color:var(--mt);color:#fff;font-weight:600}',
      '.oc-acts .mt-btn:disabled{opacity:.45;cursor:default}',
      '.oc-basis{font-size:11.5px;color:var(--ink3,#888);margin:6px 0 0}',
      '.oc-more{width:100%;margin-top:8px;min-height:40px}'
    ].join('\n');
    document.head.appendChild(s);
  }

  return { init: init, load: load, count: count };
})();
