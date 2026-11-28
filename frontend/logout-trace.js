/* TEMP v3: logout tracer (debug ke baad hata denge) */
(function () {
  'use strict';
  var K = 'milan_trace_logout', F = 'milan_trace_fetch';
  function t() { return new Date().toTimeString().slice(0, 8); }
  function short(u) { return String(u).replace(/https?:\/\/[^/]+/, ''); }
  function push(k, s) { try { var a = JSON.parse(localStorage.getItem(k) || '[]'); a.push(s); localStorage.setItem(k, JSON.stringify(a.slice(-30))); } catch (e) {} }
  function get(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }
  function stk() { return String(new Error().stack || '').split('\n').slice(1, 6).map(function (x) { return short(x.trim()); }).filter(function (x) { return x.indexOf('logout-trace') < 0; }).slice(0, 3).join(' | '); }
  var skipTrace = /[?&]trace=1(&|$)/.test(location.search);

  if (!skipTrace) {
    try { push(K, t() + ' LOAD ' + location.pathname + ' token=' + (localStorage.getItem('milan_token') ? 'yes' : 'NO')); } catch (e) {}
    var rm = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (k) {
      try { if (/^milan_/.test(String(k)) && String(k).indexOf('milan_trace') !== 0) push(K, t() + ' removeItem(' + k + ') <- ' + stk()); } catch (e) {}
      return rm.apply(this, arguments);
    };
    var cl = Storage.prototype.clear;
    Storage.prototype.clear = function () { try { push(K, t() + ' CLEAR() <- ' + stk()); } catch (e) {} return cl.apply(this, arguments); };
    if (window.navigation && navigation.addEventListener) {
      navigation.addEventListener('navigate', function (e) {
        try { push(K, t() + ' NAVIGATE -> ' + short(e.destination.url) + ' <- ' + stk()); } catch (x) {}
      });
    }
    document.addEventListener('click', function (e) {
      try {
        var d = e.target && e.target.closest && e.target.closest('#logoutBtn,.m8-logout');
        if (d) push(K, t() + ' CLICK-LOGOUT trusted=' + e.isTrusted + ' x=' + Math.round(e.clientX) + ' y=' + Math.round(e.clientY) + ' el=' + (d.id || d.className));
      } catch (x) {}
    }, true);
    window.addEventListener('error', function (e) {
      if (e && e.message) push(K, t() + ' JS-ERROR ' + String(e.message).slice(0, 100) + ' @ ' + short(e.filename || '') + ':' + e.lineno);
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
      push(K, t() + ' REJECTION ' + String((e.reason && e.reason.message) || e.reason).slice(0, 100));
    });
    if (/\/app\.html/.test(location.pathname)) {
      var of = window.fetch;
      window.fetch = function (input, init) {
        var u = '', a = '';
        try {
          u = typeof input === 'string' ? input : ((input && input.url) || '');
          var h = (init && init.headers) || (input && input.headers) || {};
          a = (typeof h.get === 'function') ? (h.get('Authorization') || '') : (h.Authorization || h.authorization || '');
        } catch (e) {}
        var isApi = String(u).indexOf('/api/') > -1;
        var tag = a ? (/null|undefined|Bearer\s*$/.test(a) ? 'BEARER-EMPTY' : 'auth:yes') : 'auth:NO';
        return of.apply(this, arguments).then(function (r) {
          if (isApi) push(F, t() + ' ' + r.status + ' ' + short(u) + ' ' + tag);
          return r;
        }, function (e) { if (isApi) push(F, t() + ' NETFAIL ' + short(u) + ' ' + tag); throw e; });
      };
    }
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      var p = document.createElement('pre');
      p.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:70vh;overflow:auto;margin:0;padding:8px;background:#000;color:#0f0;font:10px/1.35 monospace;z-index:2147483646;white-space:pre-wrap;word-break:break-all';
      p.textContent = 'LOGOUT TRACE:\n' + (get(K).join('\n') || '(khali)') + '\n\nFETCH TRACE:\n' + (get(F).join('\n') || '(khali)') + '\n\n[tap karke saaf karein]';
      p.onclick = function () { try { localStorage.removeItem(K); localStorage.removeItem(F); } catch (e) {} p.textContent = 'saaf ho gaya'; };
      document.body.appendChild(p);
    });
  }
})();
