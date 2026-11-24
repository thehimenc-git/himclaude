// 12-orgcand.js — 마스터 탭 「사람」: 인명부 후보 정리 (승인자 전용, 2026-11-23)
//   「인명부 마스터」 「후보」 탭을 하나씩 고른다. 규칙은 GAS OrgCandidates.js 한 곳(org_cand_list · org_cand_resolve),
//   힘내자 대시보드 데이터 정리도 같은 창구를 부른다 — 프로젝트 코드 정리(마스터 탭 「사업」)와 같은 구조.
//   카드:
//     · 사람이 바뀌었나요? 보고 · 공식 조직도에서 찾은 외부 인사이동(GAS OrgMoves.js, 2026-11-24). 눌러야 바뀐다
//     · 지금 담당?        사업 조직도 줄의 지금 담당 자리를 후보 2~3개 중에서 고른다
//     · 같은 사람?        같은 이름이 여럿 — 같은 사람만 골라 한 사람으로 묶는다(합침 칸만 채움, 지우지 않음)
//     · 명함과 같은 사람? 리멤버 명함과 같은 사람인지
//     · 사업에 더할까?    보고에 나온 사람을 그 사업 조직도에 더할지(힘내자가 하루 한 번 올린다, 2026-11-23)
//   자동으로 합치지 않는다 — 한 장에 한 번 누르는 것까지는 사람이 한다.
//   읽기 · 처리 모두 인증코드 로그인 세션(누가 정리했는지 서버가 직원목록 이름으로 남긴다). 이메일만으로는 안 열린다.
//   전역 재사용: profile, APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, escapeHtml, toast, getSession, MasterTab.
var OrgCand = (function () {
  var _items = [], _loaded = false, _loading = false, _err = '';
  var _box = null, _filter = 'all', _q = '', _shown = 30;
  var _skip = {};       // 나중에 — 이 화면에서만 뒤로 미룬다
  var _sel = {};        // cand_id → { keys: {사람키: true}, seat: 자리ID }
  var _busy = {};
  var KINDS = [['all', '전체'], ['사람이 바뀌었나요?', '인사이동'], ['지금 담당?', '지금 담당'], ['사업에 더할까?', '보고에서'], ['같은 사람?', '같은 사람'], ['명함과 같은 사람?', '명함']];

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
    // 목록에 전화번호가 있어 읽기도 인증코드 로그인 세션으로만 받는다(2026-11-24, GAS @289)
    var sess = (typeof getSession === 'function') ? getSession() : '';
    if (!sess) { _err = '인증코드로 로그인하면 사람 목록이 보여요'; _render(); return; }
    _loading = true; _err = '';
    _post({ action: 'org_cand_list', session: sess })
      .then(function (j) {
        if (j && j.reason === 'session_invalid') { _err = '로그인이 풀렸어요 — 인증코드로 다시 로그인해 주세요'; return; }
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
        '<p class="mt-intro">담당이 바뀐 것 같거나, 인명부에 같은 이름이 여럿이거나, 사업 조직도의 지금 담당을 못 고른 것들이에요. 한 장씩 골라 주세요 — 같은 사람이면 한 사람으로 묶이고(지우지 않아요), 누가 골랐는지 변경이력에 남아요.</p>' +
        '<div class="mt-bar"><div class="mt-chips oc-chips"></div><input type="search" class="mt-search oc-search" placeholder="이름·사업 코드로 찾기" /></div>' +
        '<div class="oc-list"></div>';
      box.querySelector('.oc-search').addEventListener('input', function (e) { _q = String(e.target.value || ''); _shown = 30; _renderList(); });
      box.addEventListener('click', _onClick);
      box.addEventListener('change', _onChange);
      box.addEventListener('input', _onName);
    }
    if (!_loaded) load(); else _render();
  }

  // ── 그리기 ──
  function _visible() {
    var q = _q.replace(/\s+/g, '').toLowerCase();
    return _items.filter(function (it) {
      if (_filter !== 'all' && it.kind !== _filter) return false;
      if (!q) return true;
      var hay = it.title + ' ' + (it.people || []).map(function (p) { return p.name + ' ' + p.projects.join(' '); }).join(' ') + ' ' + ((it.link && it.link.code) || '') + ' ' + ((it.move && it.move.codes) || []).join(' ');
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
    if (!_sel[it.cand_id] && it.kind === '사람이 바뀌었나요?') {
      var mv = it.move || {};
      _sel[it.cand_id] = { keys: {}, name: mv.new_name || '', who: '', choices: (it.people || []).length ? it.people : null, line: '', code: (mv.codes || []).length === 1 ? mv.codes[0] : '' };
    }
    if (!_sel[it.cand_id] && it.kind === '사업에 더할까?') {
      // 기본 — 지금 자리의 사람 > 같은 이름이 없으면 새 사람. 같은 이름이 있으면 사람이 고르게 비워 둔다
      _sel[it.cand_id] = { keys: {}, seat: '', who: (it.seat && it.seat.person_key) || ((it.people || []).length ? '' : 'new'), line: (it.report && it.report.line) || '' };
    }
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
    if (it.kind === '사람이 바뀌었나요?') {
      h += _moveHtml(it, sel, busy);
    } else if (it.kind === '사업에 더할까?') {
      var r = it.report || {}, rn = 'oc-' + _esc(it.cand_id);
      var choice = function (val, inner) {
        return '<label class="oc-p"><input type="radio" name="' + rn + '" data-oc="who" value="' + _esc(val) + '"' + (sel.who === val ? ' checked' : '') + ' /><span class="oc-pb">' + inner + '</span></label>';
      };
      h += '<p class="oc-line"><b>' + _esc(r.code) + '</b> 보고에 <b>' + _esc(r.name) + '</b>' + (r.org || r.role ? ' (' + _esc([r.org, r.role].filter(Boolean).join(' ')) + ')' : '') +
           ' — ' + _esc(r.reports) + '번 나왔어요' + (r.last ? ' · 마지막 ' + _esc(r.last) : '') + '</p>';
      h += '<p class="oc-q">사업 조직도에 누구로 더할까요?</p>';
      if (it.seat) h += choice(it.seat.person_key, '<b>' + _esc(it.seat.name) + '</b> <span class="oc-dim">' + _esc(it.seat.role || '') + '</span>' +
                               '<span class="oc-line oc-now">지금 조직도 · ' + _esc(_tail(it.seat.path, 2)) + (it.seat.ext ? ' · ☎' + _esc(it.seat.ext) : '') + '</span>');
      (it.people || []).forEach(function (p) {
        if (it.seat && p.person_key === it.seat.person_key) return;
        h += choice(p.person_key, '<b>' + _esc(p.name) + '</b> <span class="oc-dim">' + _esc(p.org || '') + ' ' + _esc(p.role || '') + '</span>' +
                    (p.where && p.where.length ? '<span class="oc-line">인명부 · ' + _esc(_tail(p.where, 3)) + '</span>' : '') +
                    (p.projects.length ? '<span class="oc-line oc-dim">사업 ' + _esc(p.projects.join(' · ')) + '</span>' : ''));
      });
      h += choice('new', '<b>새 사람으로</b><span class="oc-line">' + _esc(r.name) + (r.org ? ' · ' + _esc(r.org) : '') + ' — 인명부에 새로 만들어요</span>');
      h += '<div class="oc-lines"><span class="oc-dim">라인</span>' + ['유관부서', '협업사'].map(function (ln) {
        return '<button type="button" class="mt-chip' + (sel.line === ln ? ' on' : '') + '" data-oc="line" data-l="' + ln + '">' + ln + '</button>';
      }).join('') + '</div>';
      h += '<div class="oc-acts"><button type="button" class="mt-btn primary" data-oc="add"' + (sel.who && !busy ? '' : ' disabled') + '>사업 조직도에 더해요</button>' +
           '<button type="button" class="mt-btn" data-oc="skip"' + (busy ? ' disabled' : '') + '>안 더해요</button>' +
           '<button type="button" class="mt-btn" data-oc="later">나중에</button></div>';
    } else if (it.kind === '지금 담당?') {
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
    } else if (it.kind !== '같은 사람?' && it.kind !== '명함과 같은 사람?') {
      // 모르는 종류를 "같은 사람" 카드로 그리면 엉뚱하게 닫힌다
      h += '<p class="oc-line">새 종류예요. 화면을 새로고침해 주세요.</p><div class="oc-acts"><button type="button" class="mt-btn" data-oc="later">나중에</button></div>';
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

  // 사람이 바뀌었나요? — 자리(자리의 사람) · 줄(사업 조직도) · 확인(기관 예고)
  function _moveOk(it, sel) {
    var m = it.move || {};
    var needLine = m.branch === '줄' && !(m.lines || []).length;
    return !_busy[it.cand_id] && !m.changed && !!sel.name && !(sel.choices && !sel.who) && !(m.branch === '줄' && !sel.code) && !(needLine && !sel.line);
  }
  function _moveHtml(it, sel, busy) {
    var m = it.move || {}, lines = m.lines || [], codes = m.codes || [], dis = busy ? ' disabled' : '', h = '';
    var btn = function (act, label, cls, off) { return '<button type="button" class="mt-btn' + (cls ? ' ' + cls : '') + '" data-oc="' + act + '"' + (off || busy ? ' disabled' : '') + '>' + label + '</button>'; };
    h += '<p class="oc-line">' + (m.branch === '자리' ? _esc(_tail((m.seat && m.seat.path) || m.unit_path, 3)) + ' ' + _esc(m.role) + ' · 지금 <b>' + _esc((m.seat && m.seat.name) || '공석') + '</b>'
                                                     : _esc((m.unit_path || []).join(' › ')) + ' ' + _esc(m.role) + (codes.length ? ' · 사업 ' + _esc(codes.join(' · ')) : '')) + '</p>';
    if (m.changed) h += '<p class="oc-line oc-now">후보가 올라온 뒤에 이 자리가 바뀌었어요. 맞는지 보고 「아직 그대로예요」나 「아니에요」로 닫아 주세요.</p>';
    if (lines.length) {
      h += '<p class="oc-line oc-dim">걸린 사업 조직도 ' + _esc(m.lines_total) + '줄 · ' + _esc(lines.slice(0, 6).map(function (l) { return [l.code, l.role, l.name].filter(Boolean).join(' '); }).join(' / ')) + (m.lines_total > 6 ? ' …' : '') + '</p>';
    }
    if (m.branch === '확인') {
      return h + '<p class="oc-q">담당이 바뀌었으면 사업 조직도에서 고친 뒤 눌러 주세요</p><div class="oc-acts">' + btn('keep', '확인했어요', 'primary') + btn('wrong', '아니에요') + btn('later', '나중에') + '</div>';
    }
    h += '<p class="oc-q">새로 맡은 사람은 누구인가요?</p><input type="text" class="mt-search oc-name" data-oc="name" maxlength="20" placeholder="이름" aria-label="새로 맡은 사람 이름" value="' + _esc(sel.name) + '"' + dis + ' />';
    if (sel.choices) {
      var opt = function (val, inner) {
        return '<label class="oc-p"><input type="radio" name="oc-' + _esc(it.cand_id) + '" data-oc="who" value="' + _esc(val) + '"' + (sel.who === val ? ' checked' : '') + ' /><span class="oc-pb">' + inner + '</span></label>';
      };
      h += '<div class="oc-choices"><p class="oc-line">인명부에 같은 이름이 있어요. 누구인지 골라 주세요.</p>';
      sel.choices.forEach(function (p) {
        h += opt(p.person_key, '<b>' + _esc(p.name) + '</b> <span class="oc-dim">' + _esc(p.org || '') + ' ' + _esc(p.role || '') + '</span>' +
                 (p.where && p.where.length ? '<span class="oc-line">' + _esc(_tail(p.where, 3)) + '</span>' : '') +
                 (p.projects && p.projects.length ? '<span class="oc-line oc-dim">사업 ' + _esc(p.projects.join(' · ')) + '</span>' : ''));
      });
      h += opt('new', '<b>새 사람으로</b><span class="oc-line">같은 이름의 다른 사람이에요</span>') + '</div>';
    }
    var chips = function (label, list, key) {
      return '<div class="oc-lines"><span class="oc-dim">' + label + '</span>' + list.map(function (v) {
        return '<button type="button" class="mt-chip' + (sel[key] === v ? ' on' : '') + '" data-oc="' + (key === 'line' ? 'line' : 'code') + '" data-l="' + _esc(v) + '">' + _esc(v) + '</button>';
      }).join('') + '</div>';
    };
    if (m.branch === '줄' && codes.length > 1) h += chips('사업', codes, 'code');
    if (m.branch === '줄' && !lines.length) h += chips('라인', ['유관부서', '협업사'], 'line');
    h += '<div class="oc-acts">' + btn('move', m.branch === '자리' ? '이 사람으로 바꿔요' : '새 사람을 더해요', 'primary', !_moveOk(it, sel));
    if (m.branch === '자리') h += btn('vacate', '비었어요', '', m.changed);
    else if (lines.length) h += btn('leave', '옛 사람만 빠졌어요', '', !sel.code);
    return h + btn('keep', '아직 그대로예요') + btn('wrong', '아니에요') + btn('later', '나중에') + '</div>';
  }
  // 이름을 적는 동안 카드를 다시 그리지 않는다(글자가 끊기지 않게) — 단추만 켜고 끈다
  function _onName(e) {
    if (e.target.getAttribute('data-oc') !== 'name') return;
    var card = e.target.closest('[data-cid]'), it = card && _find(card.getAttribute('data-cid'));
    if (!it) return;
    var sel = _selOf(it);
    sel.name = e.target.value.trim(); sel.who = ''; sel.choices = null;
    var ch = card.querySelector('.oc-choices');
    if (ch) ch.parentNode.removeChild(ch);
    var go = card.querySelector('[data-oc="move"]');
    if (go) go.disabled = !_moveOk(it, sel);
  }

  // ── 고르기 ──
  function _find(cid) { return _items.filter(function (x) { return x.cand_id === cid; })[0]; }
  function _onChange(e) {
    var t = e.target, card = t.closest('[data-cid]');
    if (!card) return;
    var it = _find(card.getAttribute('data-cid')); if (!it) return;
    var sel = _selOf(it), act = t.getAttribute('data-oc');
    if (act === 'name') return;
    if (act === 'key') sel.keys[t.getAttribute('data-k')] = t.checked;
    if (act === 'seat') sel.seat = t.value;
    if (act === 'who') sel.who = t.value;
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
    if (act === 'code') { _selOf(it).code = b.getAttribute('data-l'); card.outerHTML = _cardHtml(it); return; }
    if (act === 'line') { _selOf(it).line = b.getAttribute('data-l'); card.outerHTML = _cardHtml(it); return; }
    var sel = _selOf(it), payload = { action: 'org_cand_resolve', cand_id: it.cand_id, decision: act };
    if (act === 'same') {
      payload.keys = Object.keys(sel.keys).filter(function (k) { return sel.keys[k]; });
      payload.target = _target(it, sel);
    }
    if (act === 'pick') payload.seat_id = sel.seat;
    if (act === 'move' || act === 'vacate' || act === 'leave') {
      payload.decision = 'move';
      if (sel.code) payload.code = sel.code;
      if (sel.line) payload.line = sel.line;
      if (act === 'vacate') payload.vacate = true;
      else if (act === 'leave') payload.leave = true;
      else {
        payload.person = sel.who && sel.who !== 'new' ? { person_key: sel.who } : { name: sel.name };
        if (sel.who === 'new') payload.person['new'] = true;
      }
    }
    if (act === 'add') { payload.line = sel.line; if (sel.who === 'new') payload['new'] = true; else payload.person_key = sel.who; }
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
          toast(j.ok ? ({ '같은 사람': '한 사람으로 묶었어요', '자리 고름': '지금 담당을 이었어요', '더함': '사업 조직도에 더했어요', '안 더함': '더하지 않았어요', '바꿈': '인명부를 바꿨어요', '아직 그대로': '그대로 두었어요', '확인함': '확인했어요', '아니에요': '아닌 것으로 닫았어요' }[j.status] || '다른 사람으로 두었어요') : j.message);
          _count();
          return;
        }
        if (j && j.reason === 'needs_choice' && j.candidates) { var s = _selOf(it); s.choices = j.candidates; s.who = ''; }
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
      '.oc-name{width:100%;max-width:260px;min-height:40px;box-sizing:border-box;margin:2px 0 4px}',
      '.oc-q{font-size:13px;font-weight:600;margin:8px 0 2px}',
      '.oc-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
      '.oc-list{display:flex;flex-direction:column;gap:10px}',
      '.oc-acts .mt-btn.primary{background:var(--mt);border-color:var(--mt);color:#fff;font-weight:600}',
      '.oc-acts .mt-btn:disabled{opacity:.45;cursor:default}',
      '.oc-lines{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0 0;font-size:12.5px}',
      '.oc-basis{font-size:11.5px;color:var(--ink3,#888);margin:6px 0 0}',
      '.oc-more{width:100%;margin-top:8px;min-height:40px}'
    ].join('\n');
    document.head.appendChild(s);
  }

  return { init: init, load: load, count: count };
})();
