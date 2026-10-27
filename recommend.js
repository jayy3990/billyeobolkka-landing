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
  var state = { shelfCount: 0, historyId: null, onShelf: {}, data: null, sido: '', gu: '', lib: null, genres: [], liked: [], busy: false, saved: null };

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
    return fetch('/data/libraries.json', { cache: 'force-cache' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (d) {
        state.data = d;
        var counts = {};
        d.libs.forEach(function (l) { counts[l.s] = (counts[l.s] || 0) + 1; });
        var opts = [{ value: '', label: T.region.choose }];
        d.sido.forEach(function (s) { if (counts[s]) opts.push({ value: s, label: s + ' (' + counts[s] + ')' }); });
        fillSelect($('sido'), opts, '');
        return d;
      })
      .catch(function () { say('err', T.region.loadFail); return null; });
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
  function syncChips() {
    var chips = $('genres').querySelectorAll('.chip');
    for (var j = 0; j < chips.length; j++) {
      var on = state.genres.indexOf(chips[j].getAttribute('data-genre')) >= 0;
      chips[j].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }
  function toggleGenre(k) {
    var i = state.genres.indexOf(k);
    if (i >= 0) state.genres.splice(i, 1);
    else if (state.genres.length < MAX_GENRES) state.genres.push(k);
    else { say('err', T.taste.genresMax); return; }
    say('', '');
    syncChips();
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
      genres: state.genres.slice(), liked: state.liked.map(function (b) { return b.isbn13; }),
      saveHistory: $('save-history').checked
    }).then(function (r) {
      if (r.status === 401) { go('taste', false); return authFail(); }
      var d = r.data || {};
      if (d.ok && d.items && d.items.length) { if (typeof d.remaining === 'number') showRemaining(d.remaining); state.historyId = d.historyId || null; if (typeof d.shelfCount === 'number') showShelfNote(d.shelfCount); renderPicks(d.items); go('result'); showHistoryNote(d.historySaved); savePrefs(); return; }
      go('taste', false);
      if (d.error === 'limit') showRemaining(0);
      say('err', err(d.error || 'server'));
    }).catch(function () { go('taste', false); say('err', err('net')); })
      .then(function () { state.busy = false; $('submit').disabled = false; });
  }
  // 결과 화면의 기록 안내: 저장됐으면 링크, 저장을 켰는데 실패했으면 알려 줘요 (추천 결과는 그대로)
  function showHistoryNote(saved) {
    $('history-note').hidden = !saved;
    if (!saved && $('save-history').checked) say('err', T.history.saveFail);
  }
  // "읽었어요": 추천받은 책을 내 서재에 담아요. 기록이 저장돼 있으면 기록 id로(정보나루·검색 횟수 없이), 아니면 ISBN만 보내요.
  function readButton(it) {
    var done = !!state.onShelf[it.isbn13];
    var b = el('button', 'readbtn', done ? T.shelf.done : T.shelf.read); b.type = 'button'; b.disabled = done;
    b.addEventListener('click', function () {
      b.disabled = true; say('', '');
      var body = { isbn13: it.isbn13 }; if (state.historyId) body.historyId = state.historyId;
      post('/api/library', body).then(function (r) {
        if (r.status === 401) return authFail();
        if (r.data && r.data.ok) { state.onShelf[it.isbn13] = true; b.textContent = T.shelf.done; if (!r.data.already) showShelfNote(state.shelfCount + 1); }
        else { b.disabled = false; var c = r.data && r.data.error; say('err', c === 'full' ? T.shelf.full : c === 'limit' ? T.shelf.limit : T.shelf.fail); }
      }).catch(function () { b.disabled = false; say('err', T.shelf.fail); });
    });
    return b;
  }
  function showShelfNote(n) {
    state.shelfCount = n;
    $('shelf-note').hidden = !n;
    $('shelf-note-text').textContent = fmt(T.shelf.note, { n: n });
  }
  function loadShelfCount() {
    fetch('/api/library', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.status === 200 ? r.json() : null; })
      .then(function (d) { if (d && d.ok) { (d.books || []).forEach(function (b) { state.onShelf[b.isbn13] = true; }); showShelfNote((d.books || []).length); } })
      .catch(function () {});
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
      li.appendChild(readButton(it));
      ol.appendChild(li);
    });
  }

  // ── 저장된 내 설정 ─────────────────────────────────────────
  function summarize(p) {
    var parts = [];
    if (p.libName) parts.push(p.libName);
    if (p.ageGroup && p.ageGroup !== 'any') parts.push(T.age[p.ageGroup]);
    if (p.gender && p.gender !== 'any') parts.push(T.gender[p.gender]);
    if ((p.genres || []).length) parts.push(p.genres.map(function (g) { return T.genre[g] || g; }).join(', '));
    return parts.join(' · ');
  }
  // 저장된 설정을 화면 상태에 채워 넣어요 (서버는 추천할 때 값을 다시 검증해요)
  function applySaved(p) {
    state.saved = p;
    $('age').value = T.age[p.ageGroup] ? p.ageGroup : 'any';
    $('gender').value = T.gender[p.gender] ? p.gender : 'any';
    state.genres = (p.genres || []).filter(function (g) { return !!T.genre[g]; }).slice(0, MAX_GENRES);
    syncChips();
    state.liked = (p.liked || []).slice(0, MAX_LIKED).map(function (b) { return { isbn13: b.isbn13, title: b.title }; });
    renderPicked();
    $('save-prefs').checked = true; // 이미 저장에 동의한 사람은 기본으로 켜 둬요
    var lib = p.libCode && state.data ? state.data.libs.filter(function (l) { return l.c === p.libCode; })[0] : null;
    if (lib) {
      $('sido').value = lib.s; onSido(); $('gu').value = lib.g; onGu();
      var radios = $('libs').querySelectorAll('input[type=radio]');
      for (var i = 0; i < radios.length; i++) if (radios[i].value === lib.c) { radios[i].checked = true; }
      state.lib = lib; $('to-taste').disabled = false;
    } else if (p.libName === null) {
      say('err', T.prefs.libGone);
    }
    $('saved-summary').textContent = fmt(T.prefs.found, { summary: summarize(p) });
    $('saved-banner').hidden = false;
    $('use-saved').hidden = !(lib && state.genres.length);
  }
  // 추천 기록의 "이 조건으로 다시 추천" (?from=<기록 id>): 조건만 채우고 2단계로 보내요. 추천은 사용자가 직접 눌러요.
  function loadFrom(id) {
    return fetch('/api/history?id=' + encodeURIComponent(id), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.status === 200 ? r.json() : null; })
      .then(function (d) {
        if (!(d && d.ok && d.record && d.record.libCode)) { say('err', T.history.fromFail); return false; }
        var rec = d.record;
        applySaved({ libCode: rec.libCode, libName: rec.libName, ageGroup: rec.ageGroup, gender: rec.gender, genres: rec.genres, liked: rec.liked });
        $('saved-banner').hidden = true; state.saved = null; $('save-prefs').checked = false;
        if (!state.lib) { say('err', T.history.fromFail); return false; }
        $('chosen-lib').textContent = T.region.selected + ': ' + state.lib.n;
        go('taste', false); say('ok', T.history.fromLoaded);
        return true;
      })
      .catch(function () { say('err', T.history.fromFail); return false; });
  }
  function loadSaved() {
    return fetch('/api/preferences', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.status === 200 ? r.json() : null; })
      .then(function (d) { if (d && d.ok && d.prefs) applySaved(d.prefs); })
      .catch(function () {});
  }
  // 추천이 성공한 뒤에만 저장해요 (체크했을 때만). 저장이 실패해도 추천 결과는 그대로 보여요.
  // 지금 고른 설정이 이미 저장된 것과 같은지 (같으면 다시 저장하지 않아요: 불필요한 요청·횟수 사용 방지)
  function sameAsSaved() {
    var p = state.saved;
    if (!p || !state.lib || p.libCode !== state.lib.c || p.ageGroup !== $('age').value || p.gender !== $('gender').value) return false;
    var a = (p.genres || []).slice().sort().join(','), b = state.genres.slice().sort().join(',');
    var x = (p.liked || []).map(function (l) { return l.isbn13; }).sort().join(','), y = state.liked.map(function (l) { return l.isbn13; }).sort().join(',');
    return a === b && x === y;
  }
  function savePrefs() {
    if (!$('save-prefs').checked || !state.lib || sameAsSaved()) return;
    fetch('/api/preferences', {
      method: 'PUT', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ libCode: state.lib.c, ageGroup: $('age').value, gender: $('gender').value, genres: state.genres.slice(), liked: state.liked.map(function (b) { return b.isbn13; }) })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok && d && d.ok, d: d }; }); })
      .then(function (r) {
        if (r.ok) { state.saved = r.d.prefs; say('ok', T.prefs.saved); }
        else say('err', r.d && r.d.error === 'limit' ? T.prefs.saveLimit : T.prefs.saveFail);
      })
      .catch(function () { say('err', T.prefs.saveFail); });
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
    $('sido').value = ''; onSido(); say('', ''); $('save-prefs').checked = !!state.saved; go('region');
  });
  $('qbtn').addEventListener('click', doSearch);
  $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  $('submit').addEventListener('click', submit);
  $('use-saved').addEventListener('click', function () { if (state.lib && state.genres.length) submit(); });

  initTaste(); loadUsage(); loadShelfCount(); go('region', false);
  var fromId = (/[?&]from=([0-9a-fA-F-]{36})(?:&|$)/.exec(location.search) || [])[1];
  initRegion().then(function (d) {
    if (d === null) return;
    if (fromId) { loadFrom(fromId).then(function (ok) { if (!ok) loadSaved(); }); return; }
    loadSaved();
  });
})();
