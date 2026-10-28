/* 계정 페이지: 임시 체험 계정이면 안내 카드를 보여주고 이메일 칸은 숨겨요 (브라우저)
 * - 서버(/api/auth/me)가 알려 준 값만 써요. 화면의 글자는 서버가 만든 문구(i18n)이고 별도 입력은 없어요.
 */
(function () {
  'use strict';
  var card = document.getElementById('anon-card'), email = document.getElementById('email-card');
  if (!card) return;
  (window.__authMe || fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }))
    .then(function (d) {
      if (d && d.loggedIn && d.anonymous === true) { card.hidden = false; if (email) email.hidden = true; }
    })
    .catch(function () {});
})();
