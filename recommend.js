/* AI 도서 추천 화면 (브라우저)
 * - 화면에 나오는 모든 글자는 textContent 로만 넣어요 (정보나루·AI가 준 글이어도 HTML로 해석되지 않아요).
 * - 서버(/api/recommend, /api/books/search, /api/usage)에는 같은 사이트에서 JSON 으로만 요청해요.
 * - 도서관 목록은 /data/libraries.json (정보나루를 호출하지 않는 정적 파일)에서 읽어요.
 * - 표지 이미지는 쓰지 않아요 (정보나루 이용 조건).
 */
(function () {
  'use strict';
  var T = window.REC_T || {}, LANG = window.REC_LANG || 'ko';
  var MAX_GENRES = 3, MAX_LIKED = 3, MAX_REMAIN = 5;
  var $ = function (id) { return document.getElementById(id); };
  var state = { data: null, sido: '', gu: '', lib: null, genres: [], liked: [], busy: false };

  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? o[k] : m; }); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function err(code) { return (T.errors && (T.errors[code] || T.errors.server)) || ''; }

  var msg = $('msg');
  function say(kind, text) { msg.className = kind || ''; msg.textContent = text || ''; }

  // ── 단계 이동 ──────────────────────────────────────────────
  var STEPS = ['region', 'taste', 'result'];
  function go(step, focus) {
    ['region', 'taste', 'loading', 'result'].forEach(function (s) { $('step-' + s).hidden = s !== step; });
    var cur = step === 'loading' ? 'result' : step;
    var items = $('stepper').querySelectorAll('li');
    for (var i = 0; i < items.length; i++) {
      var idx = STEPS.indexOf(items[i].getAttribute('data-step'));
      items[i].removeAttribute('aria-current');
      items[i].classList.toggle('done', idx < STEPS.indexOf(cur));
      if (idx === STEPS.indexOf(cur)) items[i].setAttribute('aria-current', 'step');
    }
    if (focus !== false) {
      var h = step === 'result' ? $('result-title') : $('step-' + step).querySelector('h2');
      if (h) { h.focus({ preventScroll: false }); }
    }
  }

  // ── 남은 횟수 ──────────────────────────────────────────────
  function showRemaining(n) {
    var u = $('usage');
    u.hidden = false;
    u.textContent = fmt(T.remaining, { n: n, max: MAX_REMAIN });
  }
  function loadUsage() {
    fetch('/api/usage', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok && typeof d.remaining === 'number') showRemaining(d.remaining); })
      .catch(function () {});
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'server' }; }).then(function (d) { return { status: r.status, data: d }; });
    });
  }
  function authFail() { say('err', err('auth')); setTimeout(function () { location.href = (window.REC_LOGIN || '/login') + '?next=' + encodeURIComponent(location.pathname); }, 1500); }

  // ── 1단계: 지역 → 도서관 ───────────────────────────────────
  function fillSelect(sel, items, selected) {
    clear(sel);
    items.forEach(function (it) { var o = el('option', '', it.label); o.value = it.value; if (it.value === selected) o.selected = true; sel.appendChild(o); });
  }
  function initRegion() {
    fetch('/data/libraries.json', { cache: 'force-cache' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) {
        state.data = d;
        var counts = {};
        d.libs.forEach(function (l) { counts[l.s] = (counts[l.s] || 0) + 1; });
        var opts = [{ value: '', label: T.region.choose }];
        d.sido.forEach(function (s) { if (counts[s]) opts.push({ value: s, label: s + ' (' + counts[s] + ')' }); });
        fillSelect($('sido'), opts, '');
      })
      .catch(function () { say('err', T.region.loadFail); });
  }
  function onSido() {
    state.sido = $('sido').value; state.gu = ''; state.lib = null;
    var gu = $('gu'), opts = [{ value: '', label: T.region.choose }];
    if (state.sido && state.data) {
      var seen = {};
      state.data.libs.forEach(function (l) { if (l.s === state.sido && !seen[l.g]) { seen[l.g] = 0; } if (l.s === state.sido) seen[l.g]++; });
      Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).forEach(function (g) { opts.push({ value: g, label: g + ' (' + seen[g] + ')' }); });
    }
    fillSelect(gu, opts, '');
    gu.disabled = !state.sido;
    renderLibs();
  }
  function onGu() { state.gu = $('gu').value; state.lib = null; renderLibs(); }
  function renderLibs() {
    var box = $('libsbox'), list = $('libs'), hint = $('libshint');
    clear(list);
    $('to-taste').disabled = true;
    if (!state.sido) { box.hidden = true; return; }
    box.hidden = false;
    if (!state.gu) { hint.textContent = T.region.pickGu; return; }
    var libs = state.data.libs.filter(function (l) { return l.s === state.sido && l.g === state.gu; });
    hint.textContent = libs.length ? '' : T.region.none;
    libs.forEach(function (l) {
      var label = el('label', 'lib');
      var input = el('input'); input.type = 'radio'; input.name = 'lib'; input.value = l.c;
      input.addEventListener('change', function () { state.lib = l; $('to-taste').disabled = false; });
      var info = el('div');
      info.appendChild(el('b', '', l.n));
      info.appendChild(el('span', '', l.a + (l.b ? ' · ' + fmt(T.region.books, { n: l.b.toLocaleString() }) : '')));
      label.appendChild(input); label.appendChild(info);
      list.appendChild(label);
    });
  }

  // ── 2단계: 취향 ────────────────────────────────────────────
  function initTaste() {
    var ages = Object.keys(T.age).map(function (k) { return { value: k, label: T.age[k] }; });
    var genders = Object.keys(T.gender).map(function (k) { return { value: k, label: T.gender[k] }; });
    fillSelect($('age'), ages, 'any'); fillSelect($('gender'), genders, 'any');
    var box = $('genres');
    Object.keys(T.genre).forEach(function (k) {
      var b = el('button', 'chip', T.genre[k]); b.type = 'button'; b.setAttribute('aria-pressed', 'false'); b.setAttribute('data-genre', k);
      b.addEventListener('click', function () { toggleGenre(k); });
      box.appendChild(b);
    });
  }
  function toggleGenre(k) {
    var i = state.genres.indexOf(k);
    if (i >= 0) state.genres.splice(i, 1);
    else if (state.genres.length < MAX_GENRES) state.genres.push(k);
    else { say('err', T.taste.genresMax); return; }
    say('', '');
    var chips = $('genres').querySelectorAll('.chip');
    for (var j = 0; j < chips.length; j++) {
      var on = state.genres.indexOf(chips[j].getAttribute('data-genre')) >= 0;
      chips[j].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function renderPicked() {
    var ul = $('picked'); clear(ul);
    state.liked.forEach(function (b, i) {
      var li = el('li'); li.appendChild(el('span', '', b.title));
      var x = el('button', '', '×'); x.type = 'button'; x.setAttribute('aria-label', T.taste.remove + ': ' + b.title);
      x.addEventListener('click', function () { state.liked.splice(i, 1); renderPicked(); });
      li.appendChild(x); ul.appendChild(li);
    });
  }
  function renderResults(list) {
    var ul = $('results'); clear(ul);
    if (!list.length) { var li0 = el('li'); li0.appendChild(el('span', '', T.taste.noResults)); ul.appendChild(li0); return; }
    list.forEach(function (b) {
      var li = el('li'), info = el('span');
      info.appendChild(el('b', '', b.title)); info.appendChild(el('small', '', b.author));
      var add = el('button', 'mini'); add.type = 'button';
      var already = state.liked.some(function (x) { return x.isbn13 === b.isbn13; });
      add.textContent = already ? T.taste.added : T.taste.add; add.disabled = already;
      add.addEventListener('click', function () {
        if (state.liked.length >= MAX_LIKED) { say('err', T.taste.likedMax); return; }
        state.liked.push({ isbn13: b.isbn13, title: b.title }); say('', ''); renderPicked(); add.textContent = T.taste.added; add.disabled = true;
      });
      li.appendChild(info); li.appendChild(add); ul.appendChild(li);
    });
  }
  function doSearch() {
    if (state.busy) return;
    var q = $('q').value.replace(/\s+/g, ' ').trim();
    if (!q || q.length > 40) { say('err', err('query')); return; }
    say('', ''); var btn = $('qbtn'); btn.disabled = true; btn.textContent = T.taste.searching; state.busy = true;
    post('/api/books/search', { q: q }).then(function (r) {
      if (r.status === 401) return authFail();
      if (r.data && r.data.ok) { renderResults(r.data.results || []); return; }
      var code = r.data && r.data.error;
      say('err', code === 'limit' ? err('searchLimit') : err(code));
    }).catch(function () { say('err', err('net')); }).then(function () { state.busy = false; btn.disabled = false; btn.textContent = T.taste.searchBtn; });
  }

  // ── 추천 요청 / 결과 ───────────────────────────────────────
  function submit() {
    if (state.busy) return;
    if (!state.lib) { say('err', err('pickLib')); go('region'); return; }
    if (!state.genres.length) { say('err', err('genres')); return; }
    say('', ''); state.busy = true; $('submit').disabled = true; go('loading', false);
    $('step-loading').scrollIntoView({ block: 'center' });
    post('/api/recommend', {
      lang: LANG, libCode: state.lib.c, ageGroup: $('age').value, gender: $('gender').value,
      genres: state.genres.slice(), liked: state.liked.map(function (b) { return b.isbn13; })
    }).then(function (r) {
      if (r.status === 401) { go('taste', false); return authFail(); }
      var d = r.data || {};
      if (d.ok && d.items && d.items.length) { if (typeof d.remaining === 'number') showRemaining(d.remaining); renderPicks(d.items); go('result'); return; }
      go('taste', false);
      if (d.error === 'limit') showRemaining(0);
      say('err', err(d.error || 'server'));
    }).catch(function () { go('taste', false); say('err', err('net')); })
      .then(function () { state.busy = false; $('submit').disabled = false; });
  }
  function renderPicks(items) {
    $('result-title').textContent = fmt(T.result.title, { lib: state.lib.n });
    var ol = $('picks'); clear(ol);
    items.forEach(function (it) {
      var li = el('li', 'pick');
      li.appendChild(el('h3', '', it.title));
      if (it.author) li.appendChild(el('p', 'by', it.author));
      li.appendChild(el('p', 'why', it.reason));
      var key = it.available === 'Y' ? 'Y' : it.available === 'N' ? 'N' : 'unknown';
      li.appendChild(el('span', 'badge ' + key, T.result[key]));
      ol.appendChild(li);
    });
  }

  // ── 연결 ───────────────────────────────────────────────────
  $('sido').addEventListener('change', onSido);
  $('gu').addEventListener('change', onGu);
  $('to-taste').addEventListener('click', function () {
    if (!state.lib) return;
    $('chosen-lib').textContent = T.region.selected + ': ' + state.lib.n; say('', ''); go('taste');
  });
  $('to-region').addEventListener('click', function () { say('', ''); go('region'); });
  $('to-taste2').addEventListener('click', function () { say('', ''); go('taste'); });
  $('restart').addEventListener('click', function () {
    state.lib = null; state.genres = []; state.liked = []; renderPicked(); clear($('results')); $('q').value = '';
    var chips = $('genres').querySelectorAll('.chip'); for (var i = 0; i < chips.length; i++) chips[i].setAttribute('aria-pressed', 'false');
    $('sido').value = ''; onSido(); say('', ''); go('region');
  });
  $('qbtn').addEventListener('click', doSearch);
  $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  $('submit').addEventListener('click', submit);

  initTaste(); initRegion(); loadUsage(); go('region', false);
})();
