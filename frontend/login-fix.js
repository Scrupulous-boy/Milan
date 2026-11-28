/* MILAN login v2: unregistered email -> inline red "Invalid email" (no popup) */
(function () {
  'use strict';
  var MATCH = /not\s*(yet\s*)?(registered|found|exist)|no\s+(such\s+)?(account|user)|n[o']?t\s*exist|unknown\s*(user|email|account)|user\s*not|account\s*not|create\s+(an\s+)?account|please\s+register|register\s+first|sign\s*-?\s*up\s+first|invalid\s*(email|user)/i;
  var SKIP = /password|passcode|otp|verif|already|success|welcome|created|sent|check your|logged in|saved|too many|network|server|timeout/i;
  var WIDE = /invalid|email|regist|account|user|login|sign/i;
  var NARROW = /invalid\s*email|not\s*(yet\s*)?(registered|found)|no\s+(such\s+)?(account|user)|register/i;
  var until = 0;
  function flagOn() { return Date.now() < until; }

  function visible(el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }
  function emailInput() {
    var list = document.querySelectorAll('#loginEmail,input[type="email"],input[name*="email" i],input[id*="email" i],input[autocomplete="username"],input[id*="user" i],input[id*="login" i]');
    for (var i = 0; i < list.length; i++) {
      var t = (list[i].type || '').toLowerCase();
      if (t === 'password' || t === 'hidden' || t === 'checkbox' || t === 'radio' || t === 'submit' || t === 'button') continue;
      if (visible(list[i]) && !list[i].disabled) return list[i];
    }
    return null;
  }
  function showInvalid() {
    var inp = emailInput();
    if (!inp) return false;
    var msg = document.getElementById('milan-invalid-email');
    if (!msg) {
      msg = document.createElement('div');
      msg.id = 'milan-invalid-email';
      msg.setAttribute('role', 'alert');
      msg.style.cssText = 'color:#ef4444;font-size:13px;font-weight:700;line-height:1.3;margin:6px 2px 0;text-align:left;display:block;width:100%';
    }
    msg.textContent = '\u26A0 Invalid email';
    var anchor = (inp.closest && inp.closest('.input-wrapper')) || inp;
    if (anchor.parentNode) anchor.parentNode.insertBefore(msg, anchor.nextSibling);
    inp.style.setProperty('border-color', '#ef4444', 'important');
    var clear = function () {
      inp.style.removeProperty('border-color');
      if (msg.parentNode) msg.parentNode.removeChild(msg);
      inp.removeEventListener('input', clear);
    };
    inp.addEventListener('input', clear);
    return true;
  }
  function intercept(m) {
    m = String(m == null ? '' : m);
    var hit = flagOn() ? WIDE.test(m) : (MATCH.test(m) && !SKIP.test(m));
    return hit && showInvalid();
  }

  /* 1) fetch: login ka 401 "Invalid email" page se pehle pehchano */
  var of = window.fetch;
  if (of) {
    window.fetch = function (input) {
      var args = arguments;
      return of.apply(this, args).then(function (res) {
        try {
          var u = typeof input === 'string' ? input : ((input && input.url) || '');
          if (res && res.status === 401 && /\/auth\/login(\?|$)/.test(u)) {
            return res.clone().json().then(function (j) {
              if (j && /invalid\s*email/i.test(String(j.error || ''))) {
                until = Date.now() + 4000;
                setTimeout(showInvalid, 40);
              }
              return res;
            }, function () { return res; });
          }
        } catch (e) {}
        return res;
      });
    };
  }

  /* 2) alert / confirm / toast */
  function install() {
    if (!window.alert.__mi) {
      var a = window.alert;
      window.alert = function (m) { if (intercept(m)) return; return a.apply(this, arguments); };
      window.alert.__mi = 1;
    }
    if (!window.confirm.__mi) {
      var c = window.confirm;
      window.confirm = function (m) { if (intercept(m)) return false; return c.apply(this, arguments); };
      window.confirm.__mi = 1;
    }
    if (typeof window.toast === 'function' && !window.toast.__mi) {
      var t = window.toast;
      window.toast = function (m) { if (intercept(m)) return; return t.apply(this, arguments); };
      window.toast.__mi = 1;
    }
  }
  install();
  document.addEventListener('DOMContentLoaded', install);
  window.addEventListener('load', function () { install(); setTimeout(install, 1500); });

  /* 3) page ke khud ke banaye toast / modal popup */
  function watch() {
    new MutationObserver(function (list) {
      if (!flagOn()) return;
      list.forEach(function (r) {
        Array.prototype.forEach.call(r.addedNodes, function (n) {
          if (n.nodeType !== 1 || n.id === 'milan-invalid-email' || n.id === 'milan-pwa-host' || n.id === 'milan-login-toast') return;
          var tx = (n.textContent || '').trim();
          if (!tx || tx.length > 200 || !NARROW.test(tx)) return;
          if (n.querySelector && n.querySelector('input,textarea')) return;
          var cn = (typeof n.className === 'string') ? n.className : '';
          var pop = false;
          try { pop = getComputedStyle(n).position === 'fixed'; } catch (e) {}
          pop = pop || /alert|dialog/.test(n.getAttribute('role') || '') || /toast|snack|modal|dialog|popup|notice|alert/i.test(cn + ' ' + n.id);
          if (pop) {
            n.style.setProperty('display', 'none', 'important');
            setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 50);
          }
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  watch();
})();
