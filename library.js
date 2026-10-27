/* 내 서재 화면 (브라우저)
 * - 서버(/api/library)가 본인 서재만 돌려줘요. 화면의 모든 글자는 textContent 로만 넣어요.
 * - 책 담기는 ISBN만 서버로 보내요. 제목·저자는 서버가 정보나루에서 가져와 저장해요.
 */
(function () {
  'use strict';
  var T = (window.SHELF_T || {}).t || {};
  var $ = function (id) { return document.getElementById(id); };
  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? o[k] : m; }); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function say(kind, text) { var m = $('smsg'); m.className = kind || ''; m.textContent = text || ''; }

  var books = [], max = 300, busy = false;
  var RATINGS = ['liked', 'ok', 'disliked'];

  function api(method, path, body) {
    var opt = { method: method, credentials: 'same-origin', cache: 'no-store' };
    if (body) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return { ok: false }; }).then(function (d) { return { status: r.status, data: d }; });
    });
  }
  function authFail() { location.href = (window.SHELF_LOGIN || '/login') + '?next=' + encodeURIComponent(location.pathname); }
  function errText(r) {
    var c = r.data && r.data.error;
    if (c === 'full') return fmt(T.full, { max: max });
    if (c === 'limit') return T.limit;
    return T.failed;
  }

  function render() {
    $('sloading').hidden = true;
    var c = $('scount'); c.hidden = false; c.textContent = fmt(T.count, { n: books.length, max: max });
    $('sempty').hidden = books.length > 0;
    var ol = $('books'); clear(ol);
    books.forEach(function (b) {
      var li = el('li', 'book');
      li.appendChild(el('h3', '', b.title));
      if (b.author) li.appendChild(el('p', 'by', b.author));
      var rate = el('div', 'rate'); rate.appendChild(el('span', '', T.rate));
      RATINGS.forEach(function (k) {
        var chip = el('button', 'chip', T.rating[k]); chip.type = 'button';
        chip.setAttribute('aria-pressed', b.rating === k ? 'true' : 'false');
        chip.addEventListener('click', function () { rateBook(b, b.rating === k ? null : k); });
        rate.appendChild(chip);
      });
      li.appendChild(rate);
      var rm = el('button', 'remove', T.remove); rm.type = 'button';
      rm.addEventListener('click', function () { removeBook(b, rm); });
      li.appendChild(rm);
      ol.appendChild(li);
    });
  }

  function rateBook(b, rating) {
    if (busy) return; busy = true; say('', '');
    api('PUT', '/api/library', { isbn13: b.isbn13, rating: rating }).then(function (r) {
      if (r.status === 401) return authFail();
      if (r.data && r.data.ok) { b.rating = rating; render(); } else say('err', T.failed);
    }).catch(function () { say('err', T.net); }).then(function () { busy = false; });
  }
  function removeBook(b, btn) {
    if (!window.confirm(T.confirmRemove)) return;
    btn.disabled = true; say('', '');
    api('DELETE', '/api/library?isbn13=' + encodeURIComponent(b.isbn13)).then(function (r) {
      if (r.status === 401) return authFail();
      if (r.data && r.data.ok) { books = books.filter(function (x) { return x.isbn13 !== b.isbn13; }); render(); say('ok', T.removed); }
      else { btn.disabled = false; say('err', T.failed); }
    }).catch(function () { btn.disabled = false; say('err', T.net); });
  }

  // ── 검색해서 담기 ──────────────────────────────────────────
  function renderResults(list) {
    var ul = $('results'); clear(ul);
    if (!list.length) { var li0 = el('li'); li0.appendChild(el('span', '', T.noResults)); ul.appendChild(li0); return; }
    list.forEach(function (b) {
      var li = el('li'), info = el('span');
      info.appendChild(el('b', '', b.title)); info.appendChild(el('small', '', b.author));
      var add = el('button', 'mini', T.add); add.type = 'button';
      var have = books.some(function (x) { return x.isbn13 === b.isbn13; });
      if (have) { add.textContent = T.added; add.disabled = true; }
      add.addEventListener('click', function () {
        add.disabled = true; say('', '');
        api('POST', '/api/library', { isbn13: b.isbn13 }).then(function (r) {
          if (r.status === 401) return authFail();
          if (r.data && r.data.ok) { add.textContent = T.added; say('ok', T.addedMsg); load(); }
          else { add.disabled = false; say('err', errText(r)); }
        }).catch(function () { add.disabled = false; say('err', T.net); });
      });
      li.appendChild(info); li.appendChild(add); ul.appendChild(li);
    });
  }
  function doSearch() {
    if (busy) return;
    var q = $('q').value.replace(/\s+/g, ' ').trim();
    if (!q || q.length > 40) { say('err', T.query); return; }
    say('', ''); var btn = $('qbtn'); btn.disabled = true; btn.textContent = T.searching; busy = true;
    api('POST', '/api/books/search', { q: q }).then(function (r) {
      if (r.status === 401) return authFail();
      if (r.data && r.data.ok) renderResults(r.data.results || []);
      else say('err', r.data && r.data.error === 'limit' ? T.limit : r.data && r.data.error === 'query' ? T.query : T.failed);
    }).catch(function () { say('err', T.net); }).then(function () { busy = false; btn.disabled = false; btn.textContent = T.searchBtn; });
  }
  $('qbtn').addEventListener('click', doSearch);
  $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });

  function load() {
    return api('GET', '/api/library').then(function (r) {
      if (r.status === 401) return authFail();
      if (r.data && r.data.ok) { books = r.data.books || []; max = r.data.max || max; render(); }
      else { $('sloading').hidden = true; say('err', T.loadFail); }
    }).catch(function () { $('sloading').hidden = true; say('err', T.loadFail); });
  }
  load();
})();
