/* 회원 인증 화면 공용 스크립트 (브라우저)
 * - 토큰은 다루지 않아요. 세션은 서버가 httpOnly 쿠키로만 관리해서 이 코드는 볼 수 없어요.
 * - 서버(/api/auth/*)에는 같은 사이트에서 JSON으로만 요청해요.
 * - 문구는 페이지가 넣어 주는 window.AUTH_T / AUTH_H / AUTH_URLS (i18n/*.json) 를 써요.
 */
(function () {
  'use strict';
  var T = window.AUTH_T || {}, H = window.AUTH_H || {}, U = window.AUTH_URLS || {}, LANG = window.AUTH_LANG || 'ko';
  var E = T.errors || {};
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function errText(code) { return E[code] || E.generic || ''; }
  // 서버와 같은 비밀번호 규칙 (서버에서도 다시 검사해요): 8자 이상, 영문과 숫자 포함
  function passwordOk(pw) { return typeof pw === 'string' && pw.length >= 8 && pw.length <= 72 && /[A-Za-z]/.test(pw) && /\d/.test(pw); }

  // ── Cloudflare Turnstile ───────────────────────────────────────
  var ts = { id: null, token: '', loading: false };
  function loadTurnstile(cb) {
    if (window.turnstile) return cb();
    if (ts.loading) { document.addEventListener('turnstile-ready', cb, { once: true }); return; }
    ts.loading = true;
    window.__tsReady = function () { document.dispatchEvent(new Event('turnstile-ready')); };
    document.addEventListener('turnstile-ready', cb, { once: true });
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__tsReady';
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }
  window.BBTurnstile = {
    enabled: function () { return !!window.TURNSTILE_SITE_KEY; },
    mount: function (el) {
      if (!el || !window.TURNSTILE_SITE_KEY) return;
      loadTurnstile(function () {
        ts.id = window.turnstile.render(el, {
          sitekey: window.TURNSTILE_SITE_KEY,
          language: LANG === 'en' ? 'en' : 'ko',
          callback: function (t) { ts.token = t; },
          'expired-callback': function () { ts.token = ''; },
          'error-callback': function () { ts.token = ''; }
        });
      });
    },
    token: function () { return ts.token; },
    reset: function () { ts.token = ''; if (window.turnstile && ts.id !== null) { try { window.turnstile.reset(ts.id); } catch (e) {} } }
  };

  // ── 서버 호출 ─────────────────────────────────────────────────
  function post(path, body) {
    return fetch(path, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'generic' }; });
    });
  }

  // ── 헤더의 로그인/로그아웃 버튼 ───────────────────────────────────
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text) n.textContent = text;
    return n;
  }
  // 화면 표시용 힌트: "로그인했었는지" 여부만 브라우저에 기억해요 (토큰이 아니에요. 보호 페이지는 항상 서버가 확인해요)
  var HINT_KEY = 'bb-auth';
  function readHint() { try { return localStorage.getItem(HINT_KEY) === '1'; } catch (e) { return false; } }
  function writeHint(v) { try { if (v) localStorage.setItem(HINT_KEY, '1'); else localStorage.removeItem(HINT_KEY); } catch (e) {} }

  function doLogout() {
    writeHint(false);
    post('/api/auth/logout', {}).then(function () { location.href = U.home || '/'; });
  }
  var shown = null;
  function renderSlots(loggedIn) {
    if (shown === loggedIn) return; // 이미 같은 모습이면 다시 그리지 않아요 (깜빡임 방지)
    shown = loggedIn;
    var slots = document.querySelectorAll('[data-auth-slot]');
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      while (s.firstChild) s.removeChild(s.firstChild);
      if (loggedIn) {
        s.appendChild(el('a', { href: U.account || '/account' }, H.account));
        var b = el('button', { type: 'button' }, H.logout);
        b.addEventListener('click', doLogout);
        s.appendChild(b);
      } else {
        s.appendChild(el('a', { href: U.login || '/login' }, H.login));
      }
    }
  }
  function initHeader() {
    if (!document.querySelector('[data-auth-slot]')) return;
    renderSlots(readHint()); // 서버 응답을 기다리지 않고 마지막 상태로 먼저 그려요
    // 페이지 맨 앞에서 미리 시작한 요청(window.__authMe)이 있으면 그 결과를 써요
    var p = window.__authMe || fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
    p.then(function (d) {
      if (d && typeof d.loggedIn === 'boolean') { writeHint(d.loggedIn); renderSlots(d.loggedIn); } // 서버가 확인한 결과로 바로잡기
    });
  }

  // 언어 전환: 보던 자리(#섹션)와 ?next 같은 값을 그대로 유지해요
  function keepLocation() {
    var links = document.querySelectorAll('#langs a');
    for (var i = 0; i < links.length; i++) {
      var base = links[i].getAttribute('href').split('#')[0].split('?')[0];
      links[i].href = base + location.search + location.hash;
    }
  }

  // ── 폼 처리 ──────────────────────────────────────────────────
  function initForm(form) {
    var kind = form.getAttribute('data-auth-form');
    var btn = form.querySelector('#submit'), msg = form.querySelector('#msg');
    var btnText = btn ? btn.textContent : '';
    var needsCaptcha = !!form.querySelector('[data-turnstile]');
    function show(kind2, text) { if (!msg) return; msg.className = kind2 || ''; msg.textContent = text || ''; }
    function busy(on) {
      if (!btn) return;
      btn.disabled = on; // 제출 중 중복 요청 방지
      btn.setAttribute('aria-busy', on ? 'true' : 'false');
      btn.textContent = on ? (T.sending || '...') : btnText;
    }
    function field(name) { var f = form.elements[name]; return f ? f.value : ''; }

    if (needsCaptcha) window.BBTurnstile.mount(form.querySelector('[data-turnstile]'));

    // 메일 링크가 잘못됐을 때(?error=link) 안내
    var q = new URLSearchParams(location.search);
    if (q.get('error') === 'link') show('err', errText('link'));

    var inFlight = false;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (inFlight) return;
      show('', '');

      var email = field('email').trim(), password = field('password'), confirm = field('passwordConfirm');
      var body = { lang: LANG };

      // 브라우저 쪽 검사 (서버에서 같은 규칙으로 다시 검사해요)
      if (kind === 'login' || kind === 'signup' || kind === 'forgot') {
        if (!EMAIL_RE.test(email)) return show('err', errText('email'));
        body.email = email;
      }
      if (kind === 'login') {
        if (!password) return show('err', errText('credentials'));
        body.password = password;
        body.next = q.get('next') || '';
      }
      if (kind === 'signup' || kind === 'reset') {
        if (!passwordOk(password)) return show('err', errText('weak'));
        if (password !== confirm) return show('err', errText('mismatch'));
        body.password = password; body.passwordConfirm = confirm;
      }
      if (kind === 'profile') {
        var name = field('displayName').trim();
        if (name.length > 40) return show('err', errText('name'));
        body.displayName = name;
      }
      if (needsCaptcha && window.BBTurnstile.enabled()) {
        var token = window.BBTurnstile.token();
        if (!token) return show('err', errText('captcha'));
        body.captchaToken = token;
      }

      inFlight = true; busy(true);
      var path = { login: '/api/auth/login', signup: '/api/auth/signup', forgot: '/api/auth/forgot', reset: '/api/auth/update-password', profile: '/api/auth/profile' }[kind];
      post(path, body).then(function (d) {
        if (!d || !d.ok) {
          show('err', errText(d && d.error));
          if (d && d.error === 'auth') setTimeout(function () { location.href = U.login || '/login'; }, 1500);
          return;
        }
        if (kind === 'login') { writeHint(true); show('ok', T.loginDone); location.href = d.redirect || U.account || '/'; return; }
        if (kind === 'signup') {
          form.reset();
          document.getElementById('signup-form-area').hidden = true;
          var done = document.getElementById('signup-done'); done.hidden = false;
          var h = done.querySelector('h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
          return;
        }
        if (kind === 'forgot') { form.reset(); show('ok', T.forgotDone); return; }
        if (kind === 'reset') { show('ok', T.resetDone); setTimeout(function () { location.href = d.redirect || U.account || '/'; }, 1200); return; }
        if (kind === 'profile') { show('ok', T.saved); }
      }).catch(function () {
        show('err', errText('net'));
      }).then(function () {
        inFlight = false; busy(false);
        // 캡차 토큰은 한 번만 쓸 수 있어서 요청이 끝나면 새로 받아요
        if (needsCaptcha) window.BBTurnstile.reset();
        if (kind === 'login' || kind === 'signup' || kind === 'reset') { var pw = form.elements.password; if (pw) pw.value = ''; var pc = form.elements.passwordConfirm; if (pc) pc.value = ''; }
      });
    });
  }

  initHeader(); // 헤더 버튼은 가능한 한 빨리 (DOMContentLoaded를 기다리지 않아요)

  document.addEventListener('DOMContentLoaded', function () {
    keepLocation();
    window.addEventListener('hashchange', keepLocation);
    var forms = document.querySelectorAll('form[data-auth-form]');
    for (var i = 0; i < forms.length; i++) initForm(forms[i]);
    var outs = document.querySelectorAll('[data-auth-logout]');
    for (var j = 0; j < outs.length; j++) outs[j].addEventListener('click', doLogout);
  });
})();
