/* 추천 기록 화면 (브라우저)
 * - 서버(/api/history)가 본인 기록만 돌려줘요. 화면의 모든 글자는 textContent 로만 넣어요.
 * - 대출 상태는 "추천받은 당시" 값이에요(다시 조회하지 않아요).
 * - "다시 추천"은 추천 화면으로 보내서 조건만 채워 줘요. 추천은 사용자가 직접 눌러야 시작돼요(횟수 보호).
 */
(function () {
  'use strict';
  var H = window.HIST_T || {}, T = H.t || {}, LANG = window.HIST_LANG || 'ko';
  var $ = function (id) { return document.getElementById(id); };
  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] != null ? o[k] : m; }); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function say(kind, text) { var m = $('hmsg'); m.className = kind || ''; m.textContent = text || ''; }

  var records = [];
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try { return new Intl.DateTimeFormat(LANG === 'en' ? 'en-US' : 'ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(d); }
    catch (e) { return d.toLocaleString(); }
  }
  function row(dl, label, value) { dl.appendChild(el('dt', '', label)); dl.appendChild(el('dd', '', value)); }

  function card(r) {
    var c = el('article', 'card rec-card');
    c.appendChild(el('p', 'when', when(r.createdAt)));
    var none = T.none || '-';
    var dl = el('dl');
    row(dl, T.library, r.libName ? (r.libSido + ' ' + r.libGu + ' · ' + r.libName) : T.libGone);
    row(dl, T.age, (H.age && H.age[r.ageGroup]) || none);
    row(dl, T.gender, (H.gender && H.gender[r.gender]) || none);
    row(dl, T.genres, (r.genres || []).map(function (g) { return (H.genre && H.genre[g]) || g; }).join(', ') || none);
    row(dl, T.liked, (r.liked || []).map(function (b) { return b.title; }).join(', ') || none);
    c.appendChild(dl);

    var ol = el('ol', 'picks');
    (r.items || []).forEach(function (it) {
      var li = el('li', 'pick');
      li.appendChild(el('h3', '', it.title));
      if (it.author) li.appendChild(el('p', 'by', it.author));
      if (it.reason) li.appendChild(el('p', 'why', it.reason));
      var key = it.available === 'Y' ? 'Y' : it.available === 'N' ? 'N' : 'unknown';
      li.appendChild(el('span', 'badge ' + key, (H.result && H.result[key]) || ''));
      ol.appendChild(li);
    });
    c.appendChild(ol);

    var actions = el('div', 'actions');
    if (r.libCode && UUID.test(r.id)) {
      var again = el('a', 'btn', T.again);
      again.href = (window.HIST_RECOMMEND || '/recommend') + '?from=' + encodeURIComponent(r.id);
      actions.appendChild(again);
    }
    var del = el('button', 'btn ghost', T['delete']); del.type = 'button';
    del.addEventListener('click', function () { removeOne(r.id, del); });
    actions.appendChild(del);
    c.appendChild(actions);
    return c;
  }

  function render() {
    var list = $('hlist'); clear(list);
    $('hloading').hidden = true;
    $('htop').hidden = !records.length;
    $('hempty').hidden = !!records.length;
    $('hcount').textContent = fmt(T.count, { n: records.length });
    records.forEach(function (r) { list.appendChild(card(r)); });
  }

  function api(method, query) {
    return fetch('/api/history' + (query || ''), { method: method, credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }).then(function (d) { return { status: r.status, data: d }; }); });
  }
  function authFail() { location.href = (window.HIST_LOGIN || '/login') + '?next=' + encodeURIComponent(location.pathname); }

  function removeOne(id, btn) {
    if (!window.confirm(T.confirmOne)) return;
    btn.disabled = true; say('', '');
    api('DELETE', '?id=' + encodeURIComponent(id)).then(function (r) {
      if (r.status === 401) return authFail();
      if (r.data && r.data.ok) { records = records.filter(function (x) { return x.id !== id; }); render(); say('ok', T.deleted); }
      else { btn.disabled = false; say('err', T.failed); }
    }).catch(function () { btn.disabled = false; say('err', T.failed); });
  }
  $('hdelall').addEventListener('click', function () {
    if (!window.confirm(T.confirmAll)) return;
    var btn = $('hdelall'); btn.disabled = true; say('', '');
    api('DELETE').then(function (r) {
      if (r.status === 401) return authFail();
      if (r.data && r.data.ok) { records = []; render(); say('ok', T.deleted); }
      else say('err', T.failed);
    }).catch(function () { say('err', T.failed); }).then(function () { btn.disabled = false; });
  });

  api('GET').then(function (r) {
    if (r.status === 401) return authFail();
    if (r.data && r.data.ok) { records = r.data.records || []; render(); }
    else { $('hloading').hidden = true; say('err', T.loadFail); }
  }).catch(function () { $('hloading').hidden = true; say('err', T.loadFail); });
})();
