// 08-master.js — 프로젝트 마스터 승격 탭 (오너 전용, 2026-08-25)
//   기존 ctx-l2-review 카드에 섞여 있던 PJ 등록/별칭/기각을 독립 오너 탭으로 분리.
//   활성 조건: HTML 에 .mode-tab.tab-master 버튼(#tab-master-btn)이 있고(=이 폼에 탭 이식됨),
//              get_pending_pj_registrations 가 오너로 인정(reason !== 'not_pj_owner')할 때만 탭 노출.
//   비오너/미연결 → 탭 계속 숨김. 마스터 탭 버튼이 없는 폼(v1)에선 boot()이 즉시 return → 무영향.
//   전역 재사용: profile, APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, escapeHtml.
var MasterTab = (function () {
  var _items = [], _sugg = {}, _prefixMax = {}, _prefixMeaning = {}, _loaded = false;
  // 2026-10-07 — 임시코드(TEMP-) 목록 + 삭제(제외 표시). 실장·팀장은 노션 마스터에 못 들어가므로 여기서 정리한다
  var _temps = [], _tempQ = '', _projects = [];   // _projects = 합치기 대상 고르기(자동완성)용 살아 있는 프로젝트

  function _post(payload) {
    payload.token = APPS_SCRIPT_TOKEN;
    payload.email = (profile && profile.email) || '';
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  // 로그인 직후 1회 — 오너면 탭 노출 + 데이터 적재.
  function boot() {
    var btn = document.getElementById('tab-master-btn');
    if (!btn) return;                       // 이 폼엔 마스터 탭 없음(v1) → 아무것도 안 함
    _post({ action: 'get_pending_pj_registrations' })
      .then(function (resp) {
        if (!resp || !resp.ok || resp.reason === 'not_pj_owner') { btn.style.display = 'none'; return; }
        btn.style.display = '';             // 오너 → 탭 노출
        _apply(resp);
        _loadTemps();
      })
      .catch(function () { btn.style.display = 'none'; });
  }

  function _apply(resp) {
    _items         = Array.isArray(resp.items) ? resp.items : [];
    _sugg          = resp.suggestions || { U: '26-U01', C: '26-C01', E: '26-E01', A: '26-A01' };
    _prefixMax     = resp.prefixMax || { U: 0, C: 0, E: 0, A: 0 };
    _prefixMeaning = resp.prefixMeaning || { U: '도시 업무 전반', C: '토목', E: '더힘구조 계약분', A: 'AI' };
    _loaded = true;
    var badge = document.getElementById('tab-master-count');
    if (badge) badge.textContent = _items.length ? String(_items.length) : '';
    _render();
  }

  // 탭 진입 시(lazy). 아직 안 불렀으면 boot, 불렀으면 렌더만.
  function init() { if (!_loaded) boot(); else _render(); }

  function refresh() {
    _post({ action: 'get_pending_pj_registrations' })
      .then(function (resp) { if (resp && resp.ok) _apply(resp); });
  }

  function _loadTemps() {
    _post({ action: 'master_temp_list' })
      .then(function (resp) {
        _temps = (resp && resp.ok && Array.isArray(resp.items)) ? resp.items : [];
        _projects = (resp && resp.ok && Array.isArray(resp.projects)) ? resp.projects : [];
        _render();
      })
      .catch(function () {});
  }

  function _tempHtml() {
    var q = _tempQ.toLowerCase();
    var list = _temps.filter(function (t) { return !q || (t.code + ' ' + t.name + ' ' + (t.note || '')).toLowerCase().indexOf(q) >= 0; });
    var h = '<div class="master-intro" style="margin-top:18px"><b>임시코드 ' + _temps.length + '건</b> — 보고에서 자동 등록됐거나 옛 보고에서 옮겨 온 미확정 프로젝트.<br>' +
            '• <b>정식화</b>: 칸에 정식 코드(계약됨) 또는 검토 폴더 번호 <code>검토-NN_YYMMDD</code> 를 넣고 누름. 검토 번호는 폴더 번호·날짜 그대로(지어내지 않기)<br>' +
            '• <b>합치기</b>: 같은 사업이 이미 있으면 칸에 그 프로젝트(이름·코드로 찾기)를 고르고 누름 — 보고·일정은 다음 날 새벽 그쪽으로 옮겨짐<br>' +
            '• <b>삭제</b>: 프로젝트가 아니거나 끝난 건 (목록·AI 후보에서 빠짐, 되돌릴 수 있음)</div>';
    var hint = ['U', 'C', 'E', 'A'].map(function (p) { return p + ' 다음 ' + (_sugg[p] || '-'); }).join(' · ');
    h += '<div class="l2-review-context" style="margin:4px 0">정식 코드 다음 번호 — ' + escapeHtml(hint) + '</div>';
    h += '<datalist id="m-proj-list">' + _projects.map(function (p) {
      return '<option value="' + escapeHtml(p.code) + '">' + escapeHtml(p.name) + '</option>';
    }).join('') + '</datalist>';
    h += '<input type="text" id="m-temp-q" placeholder="검색 (코드·이름·메모)" value="' + escapeHtml(_tempQ) + '" oninput="MasterTab.filterTemps(this.value)" style="width:100%;margin:6px 0 8px" />';
    if (!list.length) return h + '<div class="ctx-loading-inline">' + (_temps.length ? '검색 결과 없음' : '✅ 임시코드 없음') + '</div>';
    list.forEach(function (t) {
      var c = escapeHtml(t.code);
      h += '<div class="l2-review-item" data-temp="' + c + '">';
      h += '<div class="l2-review-head"><strong>' + escapeHtml(t.name || '(이름 없음)') + '</strong> <span class="l2-review-status">' + c + (t.track ? ' · ' + escapeHtml(t.track) : '') + '</span></div>';
      if (t.note) h += '<div class="l2-review-context">' + escapeHtml(t.note) + '</div>';
      h += '<div class="l2-pj-register-form"><input type="text" class="m-tc" list="m-proj-list" placeholder="새 코드(정식화) 또는 합칠 프로젝트(합치기)" /></div>';
      h += '<div class="l2-review-actions">' +
           '<button data-code="' + c + '" onclick="MasterTab.formalizeTemp(this)">✓ 정식화</button>' +
           '<button data-code="' + c + '" onclick="MasterTab.mergeTemp(this)">⇢ 합치기</button>' +
           '<button data-code="' + c + '" onclick="MasterTab.removeTemp(this.getAttribute(&quot;data-code&quot;))">🗑 삭제</button></div></div>';
    });
    return h;
  }

  function _inputOf(btn) {
    var item = btn.closest('[data-temp]');
    var el = item ? item.querySelector('input.m-tc') : null;
    return el ? String(el.value || '').trim() : '';
  }
  function _projName(code) {
    var p = _projects.filter(function (x) { return String(x.code).toUpperCase() === String(code).toUpperCase(); })[0];
    return p ? p.name : '';
  }
  function _done(code) { _temps = _temps.filter(function (x) { return x.code !== code; }); filterTemps(_tempQ); }

  function formalizeTemp(btn) {
    var code = btn.getAttribute('data-code'), nc = _inputOf(btn);
    var t = _temps.filter(function (x) { return x.code === code; })[0] || {};
    if (!nc) { alert('칸에 새 코드를 넣어주세요 — 정식 코드(예: ' + (_sugg.U || '26-U01') + ') 또는 검토-NN_YYMMDD'); return; }
    if (!/^\d{2}-[UCEA]\d{2}(-\d+)?$/i.test(nc) && !/^검토-\d+_\d{6}$/.test(nc)) { alert('코드 형식이 맞지 않습니다\n정식: YY-X## (X=U·C·E·A)\n검토: 검토-NN_YYMMDD (검토 폴더 번호·날짜)'); return; }
    if (_projName(nc)) { alert(nc + ' 는 이미 있습니다 (' + _projName(nc) + ')\n같은 사업이면 \'합치기\'를 쓰세요'); return; }
    if (!confirm('정식화할까요?\n' + (t.name || '') + '\n' + code + ' → ' + nc)) return;
    _post({ action: 'master_formalize', code: code, new_code: nc }).then(function (resp) {
      if (resp && resp.ok) { _projects.push({ code: resp.code, name: t.name || '' }); _done(code); }
      else alert('정식화 실패: ' + ((resp && (resp.message || resp.error)) || '오류'));
    }).catch(function () { alert('네트워크 오류'); });
  }

  function mergeTemp(btn) {
    var code = btn.getAttribute('data-code'), tg = _inputOf(btn);
    var t = _temps.filter(function (x) { return x.code === code; })[0] || {};
    if (!tg) { alert('칸에서 합칠 프로젝트를 골라주세요 (이름이나 코드를 치면 목록이 뜹니다)'); return; }
    var tn = _projName(tg);
    if (!tn) { alert(tg + ' 를 목록에서 찾지 못했습니다 — 목록에서 골라주세요'); return; }
    if (String(tg).toUpperCase() === String(code).toUpperCase()) { alert('자기 자신과는 합칠 수 없습니다'); return; }
    if (!confirm('합칠까요?\n' + (t.name || '') + ' (' + code + ')\n  ⇢ ' + tn + ' (' + tg + ')\n\n이 임시코드는 목록에서 빠지고, 연결된 보고·일정은 다음 날 새벽 대상으로 옮겨집니다.')) return;
    _post({ action: 'master_merge', code: code, target: tg }).then(function (resp) {
      if (resp && resp.ok) { _done(code); }
      else alert('합치기 실패: ' + ((resp && (resp.message || resp.error)) || '오류'));
    }).catch(function () { alert('네트워크 오류'); });
  }

  function filterTemps(q) {
    _tempQ = String(q || '');
    var box = document.getElementById('m-temp-box');
    if (box) { box.innerHTML = _tempHtml(); var el = document.getElementById('m-temp-q'); if (el) { el.focus(); el.setSelectionRange(_tempQ.length, _tempQ.length); } }
  }

  function removeTemp(code) {
    var t = _temps.filter(function (x) { return x.code === code; })[0];
    if (!t) return;
    if (!confirm('삭제할까요?\n' + (t.name || '') + ' (' + code + ')\n\n목록과 AI 후보에서 빠집니다. 연결된 보고는 그대로이고, 나중에 되돌릴 수 있습니다.')) return;
    _post({ action: 'master_exclude', code: code }).then(function (resp) {
      if (resp && resp.ok && resp.changed) { _temps = _temps.filter(function (x) { return x.code !== code; }); filterTemps(_tempQ); }
      else alert('삭제 실패: ' + ((resp && (resp.message || resp.error)) || '이미 처리됐을 수 있습니다 — 새로고침'));
    }).catch(function () { alert('네트워크 오류'); });
  }

  function _render() {
    var body = document.getElementById('mode-master-body');
    if (!body) return;
    if (!_items.length) {
      body.innerHTML = '<div class="ctx-loading-inline">✅ 승격 대기 없음</div><div id="m-temp-box">' + _tempHtml() + '</div>';
      return;
    }
    var legend = '<div class="l2-pj-prefix-legend">';
    ['U', 'C', 'E', 'A'].forEach(function (p) {   // 2026-10-07 S 폐지(→ E)
      legend += '<span><b>' + p + '</b>=' + escapeHtml(_prefixMeaning[p] || '') +
                ' (현재 ' + (_prefixMax[p] || 0) + ' / 다음 ' + escapeHtml(_sugg[p] || '') + ')</span>';
    });
    legend += '</div>';

    var html = '<div class="master-intro">프로젝트 마스터 등록 대기 — 전사 공유 마스터에 반영됩니다. ' +
               '별칭은 고유명사만(지명·역명·단지·발주처), 상용구(지하연결통로·설계용역·검토 등)는 금지.</div>' + legend;
    _items.forEach(function (item, i) {
      var def = _sugg.U || '26-U01';
      html += '<div class="l2-review-item l2-review-register" data-idx="' + i + '">';
      html += '<div class="l2-review-head"><strong>📌 신규 PJ 등록</strong> ' +
              '<span class="l2-review-status">' + escapeHtml(item['키'] || '') + '</span></div>';
      var ctx = [];
      if (item['값'])   ctx.push('학습 값: ' + item['값']);
      if (item['출처']) ctx.push('출처: ' + item['출처']);
      if (item['갱신일']) ctx.push(item['갱신일']);
      if (ctx.length) html += '<div class="l2-review-context">' + escapeHtml(ctx.join(' / ')) + '</div>';
      html += '<div class="l2-pj-register-form">';
      html += '<input type="text" id="m-pj-code-' + i + '" placeholder="코드 (예: ' + escapeHtml(def) + ')" value="' + escapeHtml(def) + '" />';
      html += '<input type="text" id="m-pj-name-' + i + '" placeholder="공식명칭 (별칭만 추가 시 빈 칸 가능)" value="' + escapeHtml(item['키'] || '') + '" />';
      html += '</div>';
      html += '<div class="l2-review-actions">';
      html += '<button onclick="MasterTab.respond(' + i + ', \'new\')">✓ 신규 등록</button>';
      html += '<button onclick="MasterTab.respond(' + i + ', \'alias\')">별칭만 추가</button>';
      html += '<button onclick="MasterTab.respond(' + i + ', \'reject\')">기각</button>';
      html += '</div></div>';
    });
    body.innerHTML = html + '<div id="m-temp-box">' + _tempHtml() + '</div>';
  }

  function respond(idx, mode) {
    var item = _items[idx];
    if (!item) return;
    var codeEl = document.getElementById('m-pj-code-' + idx);
    var nameEl = document.getElementById('m-pj-name-' + idx);
    var pjCode = codeEl ? String(codeEl.value || '').trim() : '';
    var pjName = nameEl ? String(nameEl.value || '').trim() : '';
    var payload = { source_key: item['키'] || '', source_value: item['값'] || '' };
    var action = '';

    if (mode === 'new') {
      if (!pjCode) { alert('코드를 입력해주세요 (예: 26-U25)'); return; }
      if (!pjName) { alert('공식명칭을 입력해주세요'); return; }
      if (!/^\d{2}-[UCSEA]\d{1,3}$/i.test(pjCode)) { alert('코드 형식 오류 (YY-PNN 예: 26-U25)'); return; }
      if (!confirm('신규 PJ 등록\n코드: ' + pjCode + '\n명칭: ' + pjName + '\n진행할까요?')) return;
      action = 'register_new_pj'; payload.pj_code = pjCode; payload.official_name = pjName;
    } else if (mode === 'alias') {
      if (!pjCode) { alert('어느 PJ 의 별칭인지 코드를 입력해주세요'); return; }
      if (!confirm('"' + (item['키'] || '') + '" 를 ' + pjCode + ' 의 별칭으로만 추가할까요?')) return;
      action = 'register_pj_alias_only'; payload.pj_code = pjCode;
    } else if (mode === 'reject') {
      if (!confirm('이 학습을 기각할까요? AI 인덱스에서 제거됩니다.')) return;
      action = 'reject_pj_learning';
    } else { return; }
    payload.action = action;

    _post(payload).then(function (resp) {
      if (resp && resp.ok) { refresh(); }
      else { alert('처리 실패: ' + ((resp && resp.message) || '오류')); }
    }).catch(function () { alert('네트워크 오류'); });
  }

  return { boot: boot, init: init, refresh: refresh, respond: respond, filterTemps: filterTemps, removeTemp: removeTemp,
           formalizeTemp: formalizeTemp, mergeTemp: mergeTemp };
})();
