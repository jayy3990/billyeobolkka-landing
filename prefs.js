/* 계정 페이지의 "내 추천 설정" 칸 (브라우저)
 * - 서버(/api/preferences)가 본인 설정만 돌려줘요. 화면의 모든 글자는 textContent 로만 넣어요.
 * - 수정은 추천 화면에서 하고, 여기서는 요약을 보여 주고 지울 수 있어요.
 */
(function () {
  'use strict';
  var P = window.PREF_T || {}, T = P.t || {};
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, text) { var n = document.createElement(tag); if (text != null) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function say(kind, text) { var m = $('prefs-msg'); m.className = kind || ''; m.textContent = text || ''; }

  function row(dl, label, value) { dl.appendChild(el('dt', label)); dl.appendChild(el('dd', value)); }

  function render(prefs) {
    var list = $('prefs-list'), empty = $('prefs-empty'), actions = $('prefs-actions');
    clear(list);
    if (!prefs) { empty.hidden = false; list.hidden = true; actions.hidden = true; return; }
    empty.hidden = true; list.hidden = false; actions.hidden = false;
    var none = T.none || '-';
    row(list, T.library, prefs.libName ? (prefs.libSido + ' ' + prefs.libGu + ' · ' + prefs.libName) : none);
    row(list, T.age, (P.age && P.age[prefs.ageGroup]) || none);
    row(list, T.gender, (P.gender && P.gender[prefs.gender]) || none);
    row(list, T.genres, (prefs.genres || []).map(function (g) { return (P.genre && P.genre[g]) || g; }).join(', ') || none);
    row(list, T.liked, (prefs.liked || []).map(function (b) { return b.title; }).join(', ') || none);
  }

  function load() {
    fetch('/api/preferences', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) render(d.prefs); else say('err', T.loadFail); })
      .catch(function () { say('err', T.loadFail); });
  }

  $('prefs-delete').addEventListener('click', function () {
    if (!window.confirm(T.confirm)) return;
    var btn = $('prefs-delete'); btn.disabled = true; say('', '');
    fetch('/api/preferences', { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) { render(null); say('ok', T.deleted); } else say('err', T.failed); })
      .catch(function () { say('err', T.failed); })
      .then(function () { btn.disabled = false; });
  });

  load();
})();
