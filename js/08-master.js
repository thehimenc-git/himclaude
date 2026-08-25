// 08-master.js — 프로젝트 마스터 승격 탭 (오너 전용, 2026-08-25)
//   기존 ctx-l2-review 카드에 섞여 있던 PJ 등록/별칭/기각을 독립 오너 탭으로 분리.
//   활성 조건: HTML 에 .mode-tab.tab-master 버튼(#tab-master-btn)이 있고(=이 폼에 탭 이식됨),
//              get_pending_pj_registrations 가 오너로 인정(reason !== 'not_pj_owner')할 때만 탭 노출.
//   비오너/미연결 → 탭 계속 숨김. 마스터 탭 버튼이 없는 폼(v1)에선 boot()이 즉시 return → 무영향.
//   전역 재사용: profile, APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN, escapeHtml.
var MasterTab = (function () {
  var _items = [], _sugg = {}, _prefixMax = {}, _prefixMeaning = {}, _loaded = false;

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
      })
      .catch(function () { btn.style.display = 'none'; });
  }

  function _apply(resp) {
    _items         = Array.isArray(resp.items) ? resp.items : [];
    _sugg          = resp.suggestions || { U: '26-U01', C: '26-C01', S: '26-S01', E: '26-E01', A: '26-A01' };
    _prefixMax     = resp.prefixMax || { U: 0, C: 0, S: 0, E: 0, A: 0 };
    _prefixMeaning = resp.prefixMeaning || { U: '도시계획', S: '구조', C: '공간기획', E: '검토·임시', A: 'AI' };
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

  function _render() {
    var body = document.getElementById('mode-master-body');
    if (!body) return;
    if (!_items.length) {
      body.innerHTML = '<div class="ctx-loading-inline">✅ 승격 대기 없음</div>';
      return;
    }
    var legend = '<div class="l2-pj-prefix-legend">';
    ['U', 'S', 'C', 'E', 'A'].forEach(function (p) {
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
    body.innerHTML = html;
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

  return { boot: boot, init: init, refresh: refresh, respond: respond };
})();
