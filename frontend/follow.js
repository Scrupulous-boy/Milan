(function () {
  var ICON_COPY = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var ICON_OK = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#34d399" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  var css = ''
    + '#peopleConnectList .pc-row,#peopleList .pc-row{display:flex!important;align-items:center!important;gap:10px!important;flex-wrap:nowrap!important;padding:10px 0!important;margin:0!important;border:0!important;border-bottom:1px solid rgba(148,163,184,.14)!important;background:transparent!important;box-shadow:none!important}'
    + '#peopleConnectList .pc-row:last-child,#peopleList .pc-row:last-child{border-bottom:0!important}'
    + '.pc-avatar{width:40px;height:40px;flex:0 0 40px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#2a3a5a;color:#fff;font-weight:700;font-size:14px}'
    + '.pc-avatar img{width:100%;height:100%;object-fit:cover;display:block}'
    + '.pc-info{flex:1 1 auto;min-width:0}'
    + '.pc-name{display:block;font-size:14px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.pc-did{display:flex;align-items:center;gap:4px;min-width:0;margin-top:2px;font-size:11px;opacity:.75}'
    + '.pc-did-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.pc-copy{flex:0 0 auto;display:inline-grid;place-items:center;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}'
    + '.pc-copy:hover{background:rgba(148,163,184,.22)}'
    + '.pc-note{font-size:11px;margin-top:2px;color:#f59e0b}'
    + '.pc-action{flex:0 0 auto}'
    + '.pc-btn{border:0;border-radius:999px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}'
    + '.pc-follow{background:#f59e0b;color:#111827}'
    + '.pc-follow:active{transform:scale(.97)}'
    + '.pc-follow:disabled{opacity:.6}'
    + '.pc-sent{background:rgba(148,163,184,.2);color:inherit;cursor:default;opacity:.85}'
    + '.pc-friends{font-size:12px;font-weight:600;color:#34d399;white-space:nowrap}'
    + '.pc-req{display:flex;gap:6px}'
    + '.pc-round{width:30px;height:30px;border:0;border-radius:50%;font-size:15px;font-weight:700;cursor:pointer;display:grid;place-items:center}'
    + '.pc-ok{background:#16a34a;color:#fff}'
    + '.pc-no{background:rgba(148,163,184,.25);color:inherit}'
    + '/*pc-ui-v2*/'
    + '#peopleConnectList .pc-row,#peopleList .pc-row{align-items:center!important;gap:12px!important;padding:12px 2px!important}'
    + '.pc-avatar{width:44px!important;height:44px!important;flex:0 0 44px!important;box-shadow:0 0 0 2px rgba(255,255,255,.08)}'
    + '.pc-info{position:relative;top:2px}'
    + '.pc-name{font-size:14.5px!important;font-weight:700!important;line-height:1.3!important}'
    + '.pc-did{margin-top:3px!important;gap:3px!important;font-size:11px!important;opacity:.7!important}'
    + '.pc-copy{width:16px!important;height:16px!important;border-radius:5px!important;opacity:.8}'
    + '.pc-copy svg{width:11px!important;height:11px!important}'
    + '.pc-btn{min-height:34px;padding:0 16px!important}'
    + '.pc-friends{display:inline-flex!important;align-items:center;gap:4px;min-height:30px;padding:0 12px;border-radius:999px;background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.35);font-size:12px!important;font-weight:700!important;color:#34d399!important}'
    + '.pc-sent{min-height:30px;padding:0 12px!important;border:1px solid rgba(148,163,184,.3)!important;font-size:12px!important}';
  css += '/*pc-ui-v3*/'
    + '#peopleConnectList .pc-copy,#peopleList .pc-copy,.pc-did .pc-copy{box-sizing:border-box!important;width:18px!important;height:18px!important;min-width:18px!important;min-height:18px!important;max-width:18px!important;max-height:18px!important;aspect-ratio:1/1!important;flex:0 0 18px!important;align-self:center!important;padding:0!important;margin:0 0 0 2px!important;line-height:1!important;border-radius:5px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;background:rgba(148,163,184,.14)!important;border:0!important}'
    + '.pc-did .pc-copy svg{width:10px!important;height:10px!important;min-width:0!important;min-height:0!important;display:block!important;margin:0!important}'
    + '.pc-did{align-items:center!important;height:auto!important}';
  var st = document.createElement("style");
  st.id = "milan-follow-css";
  st.textContent = css;
  document.head.appendChild(st);

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function initials(n) {
    var p = String(n || "M").trim().split(/\s+/);
    return ((p[0] || "M").charAt(0) + (p[1] ? p[1].charAt(0) : "")).toUpperCase();
  }
  function shortDid(d) {
    d = String(d || "");
    return d.length > 28 ? d.slice(0, 18) + "…" + d.slice(-6) : d;
  }
  function note(m) { try { if (typeof toast === "function") toast(m); } catch (e) {} }

  function actionHtml(p) {
    var s = p.connectionStatus;
    if (s === "sent") return '<button class="pc-btn pc-sent" type="button" disabled>Requested</button>';
    if (s === "friends") return '<span class="pc-friends">✓ Friends</span>';
    if (s === "received") {
      return '<div class="pc-req">'
        + '<button class="pc-round pc-ok" type="button" data-act="accept" data-id="' + esc(p.connectionId) + '" title="Accept" aria-label="Accept follow request">✓</button>'
        + '<button class="pc-round pc-no" type="button" data-act="reject" data-id="' + esc(p.connectionId) + '" title="Decline" aria-label="Decline follow request">✕</button></div>';
    }
    return '<button class="pc-btn pc-follow" type="button" data-act="follow" data-did="' + esc(p.did) + '">Follow</button>';
  }

  function card(p) {
    var av = /^(https?:\/\/|data:image\/|\/api\/)/.test(p.avatar || "")
      ? '<img src="' + esc(p.avatar) + '" alt="" loading="lazy">'
      : esc(initials(p.name));
    return '<div class="person pc-row">'
      + '<div class="pc-avatar">' + av + '</div>'
      + '<div class="pc-info"><b class="pc-name">' + esc(p.name || "MILAN User") + '</b>'
      + '<div class="pc-did"><span class="pc-did-text" title="' + esc(p.did) + '">' + esc(shortDid(p.did)) + '</span>'
      + '<button type="button" class="pc-copy" data-did="' + esc(p.did) + '" title="Copy DID" aria-label="Copy DID">' + ICON_COPY + '</button></div>'
      + (p.connectionStatus === "received" ? '<div class="pc-note">wants to follow you</div>' : '')
      + '</div><div class="pc-action">' + actionHtml(p) + '</div></div>';
  }

  var last = { box: null, list: null };
  function put(el, key, html, isEmpty) {
    if (!el) return;
    if (last[key] !== html) { el.innerHTML = html; last[key] = html; }
    el.classList.toggle("empty", !!isEmpty);
  }

  function authToken() {
    var keys = ["milan_token", "token", "milanToken", "authToken", "jwt"];
    try {
      for (var i = 0; i < keys.length; i++) {
        var v = localStorage.getItem(keys[i]) || sessionStorage.getItem(keys[i]);
        if (v && v.indexOf("eyJ") === 0) return v;
      }
      for (var j = 0; j < localStorage.length; j++) {
        var v2 = localStorage.getItem(localStorage.key(j));
        if (v2 && /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v2)) return v2;
      }
    } catch (e) {}
    return "";
  }
  async function peopleFetch() {
    var tk = authToken();
    var r = await fetch("/api/social/people", { headers: tk ? { Authorization: "Bearer " + tk } : {}, cache: "no-store" });
    if (!r.ok) { var e = new Error("people " + r.status); e.status = r.status; throw e; }
    return r.json();
  }

  async function apiAuth(path, options) {
    options = options || {};
    var tk = authToken();
    var h = { "Content-Type": "application/json" };
    if (tk) h.Authorization = "Bearer " + tk;
    var r = await fetch("/api" + path, { method: options.method || "GET", headers: h, body: options.body, cache: "no-store" });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(d.error || ("Request failed " + r.status)); e.status = r.status; throw e; }
    return d;
  }

  async function loadPeople() {
    var box = document.getElementById("peopleConnectList");
    var list = document.getElementById("peopleList");
    try {
      var all = await peopleFetch();
      if (!Array.isArray(all)) all = [];
      try { localStorage.setItem("milan_people_cache_" + (localStorage.getItem("milan_did") || ""), JSON.stringify(all)); } catch (x) {}
      var qEl = document.getElementById("peopleSearch"), gEl = document.getElementById("globalSearch");
      var q = String((qEl && qEl.value) || (gEl && gEl.value) || "").trim().toLowerCase();
      var shown = q ? all.filter(function (p) {
        return String(p.name || "").toLowerCase().indexOf(q) > -1 || String(p.did || "").toLowerCase().indexOf(q) > -1;
      }) : all;
      try { people = shown; } catch (e) {}
      var empty = '<div class="empty">No people found.</div>';
      put(box, "box", all.length ? all.map(card).join("") : empty, !all.length);
      put(list, "list", shown.length ? shown.map(card).join("") : empty, !shown.length);
    } catch (e) {
      var cached = null;
      try { cached = JSON.parse(localStorage.getItem("milan_people_cache_" + (localStorage.getItem("milan_did") || "")) || "null"); } catch (x) {}
      if (Array.isArray(cached) && cached.length) {
        put(box, "box", cached.map(card).join(""), false);
        put(list, "list", cached.map(card).join(""), false);
      } else if (box && !box.querySelector(".person")) { box.classList.add("empty"); box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; last.box = null; }
    }
  }

  async function refresh() {
    await loadPeople();
    try { if (typeof loadNotifications === "function") await loadNotifications(); } catch (e) {}
  }
  async function follow(did, btn) {
    if (btn) btn.disabled = true;
    try {
      var r = await apiAuth("/connections", { method: "POST", body: JSON.stringify({ toDid: did }) });
      note(r && r.status === "accepted" ? "You are now friends" : "Follow request sent");
    } catch (e) { note(e.message); }
    await refresh();
  }
  async function accept(id) {
    try { await apiAuth("/connections/" + encodeURIComponent(id) + "/approve", { method: "POST", body: "{}" }); note("You are now friends"); }
    catch (e) { note(e.message); }
    await refresh();
  }
  async function reject(id) {
    try { await apiAuth("/connections/" + encodeURIComponent(id) + "/reject", { method: "POST", body: "{}" }); note("Request declined"); }
    catch (e) { note(e.message); }
    await refresh();
  }
  function copy(text, btn) {
    function done() {
      if (btn) { var o = btn.innerHTML; btn.innerHTML = ICON_OK; setTimeout(function () { btn.innerHTML = o; }, 1200); }
      note("DID copied");
    }
    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
        done();
      } catch (e) { note("Copy failed"); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  document.addEventListener("click", function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest("[data-act],.pc-copy") : null;
    if (!t) return;
    if (t.classList.contains("pc-copy")) { copy(t.getAttribute("data-did") || "", t); return; }
    var act = t.getAttribute("data-act");
    if (act === "follow") follow(t.getAttribute("data-did"), t);
    else if (act === "accept") accept(t.getAttribute("data-id"));
    else if (act === "reject") reject(t.getAttribute("data-id"));
  });

  window.peopleActions = actionHtml;
  window.sendConnect = function (did) { return follow(did); };
  window.approveConnect = function (id) { return accept(id); };
  window.rejectConnect = function (id) { return reject(id); };
  window.loadPeople = loadPeople;

  window.addEventListener("focus", loadPeople);
  setTimeout(loadPeople, 1500);
  setInterval(function () { if (!document.hidden) loadPeople(); }, 20000);
})();
