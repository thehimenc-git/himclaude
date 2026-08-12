// ── 직원 데이터 (Apps Script에서 동적 로드) ──────────────────────
var STAFF=[];

// ── 설정 ──────────────────────
var APPS_SCRIPT_URL='https://script.google.com/macros/s/AKfycbzmZxOy4mzgudsmdFrdBMvlkw5WpPse5zE0IRM1jS9x8RGWMaKBoWx2MPdCc7pBZuE/exec';
var APPS_SCRIPT_TOKEN='thehim2026';

// ── GAS 간헐 응답 실패 방어 (2026-08-13 신설) ───────────────────────────────
//   증상: /exec 이 302 로 넘기는 콘텐츠 URL 이 드물게 404 HTML 을 돌려준다(실측 ~8%).
//         호출부가 r.json() 을 그대로 부르면 "Unexpected token '<'" 로 화면이 죽는다.
//   대응: APPS_SCRIPT_URL 요청만 가로채서
//         · 읽기 전용 액션(GAS_RETRY_SAFE) = 최대 3회 재시도 → 사용자는 실패를 못 느낌
//         · 그 외(부작용·과금 있는 GET + 모든 POST) = 재시도 금지.
//           대신 HTML 쓰레기를 깔끔한 JSON 오류로 바꿔 호출부가 정상 실패 처리를 하게 한다.
//   ★재시도 금지 목록이 핵심★ otp_request 는 인증메일을 보내고, chat_send·query·
//     analyze_query 는 Claude API 를 호출한다. GET 이라고 무조건 재시도하면
//     인증메일 3통 발송 + API 비용 3배가 된다. 액션 추가 시 이 목록부터 확인할 것.
(function(){
  if (typeof window === 'undefined' || !window.fetch || !window.Response) return;
  var _rawFetch = window.fetch.bind(window);

  // 읽기 전용 = 몇 번을 불러도 서버 상태가 안 변하는 액션만 나열
  var GAS_RETRY_SAFE = [
    'get_staff','get_context','get_yesterday_raw','get_today_raw','get_range',
    'get_schedule','get_schedule_all','load_draft','get_candidate_pool',
    'get_my_sheet_url','chat_load','get_pending_confirmations',
    'get_pending_person_reviews','get_pending_pj_registrations'
  ];
  var GAS_RETRY_DELAY_MS = [250, 700];   // 1차 재시도 250ms 후, 2차 700ms 후

  function isGasUrl(u){
    try { return String(u).indexOf(APPS_SCRIPT_URL) === 0; } catch(e){ return false; }
  }
  function actionOf(u){
    var m = /[?&]action=([A-Za-z_]+)/.exec(String(u));
    return m ? m[1] : '';
  }
  function looksJson(t){
    var s = String(t == null ? '' : t).trim();
    return s.charAt(0) === '{' || s.charAt(0) === '[';
  }
  function jsonResponse(text){
    return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  window.fetch = function(input, init){
    var url = (input && input.url) ? input.url : input;
    if (!isGasUrl(url)) return _rawFetch(input, init);

    var method   = String((init && init.method) || 'GET').toUpperCase();
    var retryable = (method === 'GET') && GAS_RETRY_SAFE.indexOf(actionOf(url)) !== -1;
    var maxTry   = retryable ? 3 : 1;

    function attempt(n){
      return _rawFetch(input, init).then(function(r){
        return r.text().then(function(t){
          if (!r.ok || !looksJson(t)) throw new Error('GAS 응답 이상 (HTTP ' + r.status + ')');
          JSON.parse(t);              // 파싱까지 되는지 여기서 검증 — 호출부에서 터지지 않게
          return jsonResponse(t);
        });
      }).catch(function(err){
        if (n + 1 < maxTry) {
          return new Promise(function(res){ setTimeout(res, GAS_RETRY_DELAY_MS[n] || 700); })
            .then(function(){ return attempt(n + 1); });
        }
        if (retryable) throw err;     // 조회 실패 = 기존 .catch 흐름 그대로 (재시도 다 쓴 뒤)
        // 부작용 가능 요청: 서버에 이미 반영됐을 수 있으므로 "다시 누르세요"라고 하지 않는다.
        return jsonResponse(JSON.stringify({
          ok: false, error: 'GAS_TRANSIENT',
          message: '통신이 일시적으로 끊겼습니다. 이미 처리됐을 수 있으니, 다시 시도하기 전에 새로고침해서 반영 여부를 먼저 확인해주세요.'
        }));
      });
    }
    return attempt(0);
  };
})();

// ─── Google OAuth + Gmail API (2026-05-22 PM 신설) ─────────────────────────
// 직원 본인 Gmail 로 보고 발송 → 본인 Sent 폴더에 기록 축적 (대표님 요청).
// GCP project `him-claude`, OAuth client `힘클로드 test` (test·prod 공유).
var GOOGLE_OAUTH_CLIENT_ID = '78944797082-812csuhf14psu3pakcmqd236h7s9lcea.apps.googleusercontent.com';
var GMAIL_SEND_SCOPE       = 'https://www.googleapis.com/auth/gmail.send';
var _gmailTokenClient = null;
var _gmailAccessToken = '';

// GIS 페이지 load 후 1회 초기화 — 발송 첫 시도 직전 lazy init
function _initGmailTokenClient() {
  if (_gmailTokenClient) return true;
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) return false;
  if (GOOGLE_OAUTH_CLIENT_ID.indexOf('PLACEHOLDER') === 0) return false;   // 미등록 = fallback
  _gmailTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    scope: GMAIL_SEND_SCOPE,
    callback: function(){}   // dynamic callback — 매 호출 시 덮어쓰기
  });
  return true;
}

// 캐시된 토큰 우선(만료 5분 전까지), 없거나 만료 임박이면 조용히 재발급(prompt:''). callback(token|null).
function requestUserGmailAccess(callback) {
  if (!_initGmailTokenClient()) { callback(null); return; }
  // sessionStorage 캐시 — access_token(~1시간) + 만료시각 동반 저장.
  // 2026-06-05 추가2 — 옛 코드는 만료된 토큰을 그대로 반환 → 1시간 후 첫 발송 401 실패 → fallback confirm.
  //   만료 5분 전부터 캐시 무효 처리 → prompt:'' 로 조용히 재발급 (사용자 개입 X) → 그 friction 제거.
  var cached = sessionStorage.getItem('him_v4_gmail_token');
  var exp    = parseInt(sessionStorage.getItem('him_v4_gmail_token_exp') || '0', 10);
  if (cached && Date.now() < exp) { _gmailAccessToken = cached; callback(cached); return; }
  _gmailTokenClient.callback = function(resp) {
    if (resp && resp.access_token) {
      _gmailAccessToken = resp.access_token;
      sessionStorage.setItem('him_v4_gmail_token', resp.access_token);
      // expires_in(초, 보통 3599) - 300초(5분 마진). 응답에 없으면 보수적으로 50분.
      var ttlMs = (resp.expires_in ? resp.expires_in - 300 : 3000) * 1000;
      sessionStorage.setItem('him_v4_gmail_token_exp', String(Date.now() + ttlMs));
      callback(resp.access_token);
    } else {
      callback(null);
    }
  };
  // 2026-06-05 — prompt:'consent'(매 세션 전체 동의 강제) → prompt:''(이미 동의한 사용자는 조용히 재발급).
  //   GIS token model 은 refresh_token 이 없어 매 세션 access_token 재발급인데, consent 강제라 직원이
  //   브라우저 닫을 때마다(다음날) 전체 동의 화면을 다시 봤음. ''(빈 prompt)=동의 필요 시만 노출 → "매일 재동의" 해소.
  //   hint=본인 이메일 → 계정 선택 화면까지 스킵 (재방문 사용자 무클릭).
  try { _gmailTokenClient.requestAccessToken({prompt: '', hint: (profile && profile.email) || ''}); }
  catch(e) { callback(null); }
}

// MIME 메일 빌드 + base64url 인코딩 + Gmail API send.
// callback(success, errorMsg).
function sendViaUserGmail(token, to, cc, subject, body, callback) {
  if (!token) { callback(false, 'no_token'); return; }

  // 본문 base64 인코딩 (한글 UTF-8 안전 — line wrapping 영향 받지 않음).
  // 2026-05-26 신설: 옛 흐름은 transfer-encoding 미설정 → SMTP 76자 line wrap 시 한글 multibyte 중간 split →
  //                  수신측 getPlainBody 디코드 실패 → JSON.parse 실패 (5/26 brfing 17 row ✗parse 원인).
  // base64 transfer-encoding 으로 영구 해결.
  var bodyBase64 = btoa(unescape(encodeURIComponent(body)));
  // RFC 2045 권장 — 76자마다 CRLF (선택사항이지만 호환성 ↑)
  var bodyB64Wrapped = (bodyBase64.match(/.{1,76}/g) || [bodyBase64]).join('\r\n');

  var lines = [];
  lines.push('To: ' + to);
  if (cc) lines.push('Cc: ' + cc);
  // 한글 subject → RFC 2047 encoded-word
  lines.push('Subject: =?UTF-8?B?' + btoa(unescape(encodeURIComponent(subject))) + '?=');
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(bodyB64Wrapped);
  var mime = lines.join('\r\n');
  // 전체 MIME 을 Gmail API raw 필드용 base64url 인코딩. mime 은 이제 ASCII only (subject/body 모두 인코딩됨) 라 안전.
  var raw = btoa(unescape(encodeURIComponent(mime)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({raw: raw})
  })
  .then(function(r){
    if (!r.ok) {
      if (r.status === 401) {
        sessionStorage.removeItem('him_v4_gmail_token');
        sessionStorage.removeItem('him_v4_gmail_token_exp');
        _gmailAccessToken = '';
      }
      return r.text().then(function(t){ throw new Error('Gmail API ' + r.status + ': ' + t); });
    }
    return r.json();
  })
  .then(function(){ callback(true, ''); })
  .catch(function(e){ callback(false, e.message); });
}

// 힘클로바 STT 서버 URL — localhost/127.0.0.1 호스트만 로컬 서버, 그 외 (file:// 포함) Cloud Run.
// 로컬 개발 시 강제로 localhost:8080 쓰고 싶으면 콘솔에서:
//   localStorage.setItem('himclaude_v2_himclova_url','http://localhost:8080')
var HIMCLOVA_URL = (function(){
  var override = (function(){ try { return localStorage.getItem('himclaude_v2_himclova_url'); } catch(e){ return null; } })();
  if (override) return override.replace(/\/$/, '');
  if (/^(localhost|127\.0\.0\.1)/.test(location.hostname)) {
    return 'http://localhost:8080';
  }
  return 'https://himclova-server-production.up.railway.app';
})();
var UPLOAD_TIMEOUT_MS = 25 * 60 * 1000;  // 25분 (1시간 회의 처리 여유)

// ★ 재인증 강제할 때만 이 값을 올리세요. 버그 수정·UI 개선 배포에는 그대로 두세요.
//   마지막 bump: 2026-04-24 (초기 도입)
var AUTH_RESET_GEN = 1;

// ── 옛 키 → 새 키 마이그레이션 (1회 실행, 멱등) ─────────────────
// 2026-05-07: him_v4_* → himclaude_v2_*
// 옛 키 있고 새 키 없으면 복사 후 옛 키 삭제. 이미 마이그된 사용자엔 무동작.
(function migrateLegacyKeys(){
  try {
    var pairs = [
      ['him_v4',                 'himclaude_v2'],
      ['him_v4_session',         'himclaude_v2_session'],
      ['him_v4_authGen',         'himclaude_v2_authGen'],
      ['him_v4_active_mode',     'himclaude_v2_active_mode'],
      ['him_v4_draft',           'himclaude_v2_draft'],
      ['him_v4_chat_conv_id',    'himclaude_v2_chat_conv_id'],
      ['him_v4_himclova_draft',  'himclaude_v2_himclova_draft'],
      ['him_v4_himclova_result', 'himclaude_v2_himclova_result'],
      ['him_v4_himclova_url',    'himclaude_v2_himclova_url']
    ];
    pairs.forEach(function(p){
      var oldK = p[0], newK = p[1];
      if (localStorage.getItem(newK) !== null) return;
      var v = localStorage.getItem(oldK);
      if (v === null) return;
      localStorage.setItem(newK, v);
      localStorage.removeItem(oldK);
    });
  } catch(e) { /* localStorage 비활성 환경 */ }
})();

var SESSION_KEY    ='himclaude_v2_session';
var AUTH_GEN_KEY   ='himclaude_v2_authGen';
var MODE_KEY       ='himclaude_v2_active_mode';

