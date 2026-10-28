/* 계정 페이지의 "체험 데이터 초기화" 카드 (브라우저)
 * - 서버(/api/auth/me)가 알려 준 "체험 계정" 일 때만 카드를 보여줘요. 실제 권한 확인은 서버(/api/auth/demo-reset)가 다시 해요.
 * - 화면의 글자는 textContent 로만 넣어요.
 */
(function () {
  'use strict';
  var T = window.DEMO_T || {};
  var card = document.getElementById('demo-card'), btn = document.getElementById('demo-reset'), msg = document.getElementById('demo-msg');
  if (!card || !btn) return;
  function say(kind, text) { msg.className = 'inline-msg ' + kind; msg.textContent = text; msg.hidden = false; }

  fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.loggedIn && d.demo === true) card.hidden = false; })
    .catch(function () {});

  btn.addEventListener('click', function () {
    if (!window.confirm(T.confirm)) return;
    btn.disabled = true; msg.hidden = true;
    fetch('/api/auth/demo-reset', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (d) {
        if (d && d.ok) { say('ok', T.done); var list = document.getElementById('prefs-list'), empty = document.getElementById('prefs-empty'), act = document.getElementById('prefs-actions'); if (list) list.hidden = true; if (act) act.hidden = true; if (empty) empty.hidden = false; }
        else say('err', T.fail);
      })
      .catch(function () { say('err', T.fail); })
      .then(function () { btn.disabled = false; });
  });
})();
