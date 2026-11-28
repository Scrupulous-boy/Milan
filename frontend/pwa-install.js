/* MILAN PWA install banner v2: native prompt, Android fallback, iOS guide */
(function () {
  'use strict';
  try{if(!document.querySelector('link[rel="manifest"]')){var ml=document.createElement('link');ml.rel='manifest';ml.href='/manifest.json';(document.head||document.documentElement).appendChild(ml);}}catch(e){}
  try{if('serviceWorker' in navigator)window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(){});},{once:true});}catch(e){}
  var KEY = 'milan_pwa_snooze_until', DAY = 864e5;
  var deferred = null, shown = false, domReady = false, host = null, card = null, evFired = false;
  var ua = navigator.userAgent || '';
  var qs = location.search || '';
  var force = /[?&]pwa=1(&|$)/.test(qs);
  var debug = /[?&]pwadebug=1(&|$)/.test(qs);
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);
  var inApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|Twitter|LinkedInApp|GSA\/|; wv\)/.test(ua);

  function standalone() {
    try {
      return window.matchMedia('(display-mode: standalone)').matches ||
             window.matchMedia('(display-mode: fullscreen)').matches ||
             window.matchMedia('(display-mode: minimal-ui)').matches ||
             window.navigator.standalone === true;
    } catch (e) { return false; }
  }
  function snoozed() {
    if (force) return false;
    try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function snooze(d) { try { sessionStorage.setItem(KEY, '1'); } catch (e) {} }
  try { localStorage.removeItem(KEY); } catch (e) {}
  function checkInstalled(cb) {
    try {
      if (navigator.getInstalledRelatedApps) {
        navigator.getInstalledRelatedApps().then(function (a) { cb(!!(a && a.length)); }, function () { cb(false); });
        return;
      }
    } catch (e) {}
    cb(false);
  }

  var CSS = ":host{all:initial}.wrap{display:flex;justify-content:center;align-items:flex-start;width:100%;box-sizing:border-box;padding:calc(env(safe-area-inset-top,0px) + 10px) 12px 0;pointer-events:none;font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}.card{pointer-events:auto;width:100%;max-width:440px;margin:0 auto;box-sizing:border-box;overflow:hidden;color:#eef3ff;background:linear-gradient(135deg,#0e163e,#1d1146);border:1px solid rgba(255,255,255,.12);border-radius:18px;box-shadow:0 14px 40px rgba(0,0,0,.5);padding:12px;transform:translateY(-140%);opacity:0;transition:transform .55s cubic-bezier(.22,1,.36,1),opacity .3s ease;touch-action:pan-y}.card.in{transform:none;opacity:1}.row{display:flex;align-items:center;gap:10px}.ico{width:44px;height:44px;flex:0 0 44px;background:none;box-shadow:none;display:block}.ico img{width:100%;height:100%;object-fit:contain;display:block}.txt{flex:1;min-width:0}.t{font-size:14.5px;font-weight:800;line-height:1.25;margin:0;color:#fff}.s{font-size:12px;line-height:1.35;color:#aab6d8;margin:2px 0 0}.btn{flex:0 0 auto;border:0;border-radius:999px;padding:9px 16px;min-height:38px;font:inherit;font-size:14px;font-weight:800;color:#fff;background:linear-gradient(135deg,#f59e0b,#d946ef);cursor:pointer;box-shadow:0 6px 16px rgba(217,70,239,.3)}.btn:active{transform:scale(.96)}.x{flex:0 0 auto;width:30px;height:30px;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:#cdd6f4;font-size:14px;line-height:1;cursor:pointer;display:grid;place-items:center}.steps{max-height:0;overflow:hidden;transition:max-height .45s ease,margin .45s ease;margin:0}.card.open .steps{max-height:300px;margin-top:12px}.steps ol{margin:0;padding:0;list-style:none;display:grid;gap:8px}.steps li{display:flex;align-items:center;gap:10px;font-size:13px;line-height:1.4;background:rgba(255,255,255,.06);border-radius:12px;padding:9px 11px}.steps b{flex:0 0 22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#d946ef);display:grid;place-items:center;font-size:12px}.steps svg{vertical-align:-4px}.ok{margin-top:10px;width:100%}@media (prefers-reduced-motion:reduce){.card{transition:opacity .2s}}";
  var SHARE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';

  function stepsHTML() {
    if (!isIOS && !isAndroid) return '<ol><li><b>1</b><span>Click the <strong>Install</strong> icon in the address bar, or open the browser menu.</span></li><li><b>2</b><span>Choose <strong>Install MILAN</strong> (or <strong>Add to Home screen</strong>).</span></li></ol>';
    if (isIOS) {
      return inApp
        ? '<ol><li><b>1</b><span>Open this page in <strong>Safari</strong> (tap the menu, then <strong>Open in Browser</strong>).</span></li><li><b>2</b><span>Tap Share ' + SHARE + ' then <strong>Add to Home Screen</strong>.</span></li></ol>'
        : '<ol><li><b>1</b><span>Tap the Share button ' + SHARE + ' in your browser bar.</span></li><li><b>2</b><span>Scroll and tap <strong>Add to Home Screen</strong>.</span></li><li><b>3</b><span>Tap <strong>Add</strong>. MILAN is now an app.</span></li></ol>';
    }
    return '<ol><li><b>1</b><span>Tap the browser menu <strong>&#8942;</strong> (top-right corner).</span></li><li><b>2</b><span>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</span></li><li><b>3</b><span>Tap <strong>Install</strong>. MILAN is now an app.</span></li></ol>';
  }

  function hide(days) {
    if (days) snooze(days);
    if (!card) return;
    card.classList.remove('in');
    setTimeout(function () { if (host && host.parentNode) host.parentNode.removeChild(host); host = card = null; }, 650);
  }

  function build() {
    host = document.createElement('div');
    host.id = 'milan-pwa-host';
    host.style.cssText = 'position:fixed;top:0;left:0;right:0;width:100%;max-width:100vw;margin:0;padding:0;border:0;background:none;display:block;pointer-events:none;z-index:2147483647;';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var title = isIOS ? 'Install MILAN on your iPhone' : 'Install MILAN App';
    var sub = isIOS
      ? 'Add it to your Home Screen in 3 taps. It opens full-screen like an app.'
      : 'Faster, full-screen and free.';
    root.innerHTML = '<style>' + CSS + '</style><div class="wrap"><div class="card" role="dialog" aria-label="Install MILAN">' +
      '<div class="row"><div class="ico"><img alt="" src="/assets/milan-logo-circle.png"></div>' +
      '<div class="txt"><p class="t">' + title + '</p><p class="s">' + sub + '</p></div>' +
      '<button class="btn main" type="button">Install</button>' +
      '<button class="x" type="button" aria-label="Close">&#10005;</button></div>' +
      '<div class="steps">' + stepsHTML() + '<button class="btn ok" type="button">Got it</button></div>' +
      '</div></div>';
    document.documentElement.appendChild(host);
    card = root.querySelector('.card');
    var img = root.querySelector('.ico img');
    if (img) { img.onerror = function () { img.parentNode.textContent = 'M'; }; }

    root.querySelector('.main').addEventListener('click', function () {
      if (deferred) {
        var d = deferred; deferred = null;
        d.prompt();
        d.userChoice.then(function (c) { hide(c && c.outcome === 'accepted' ? 0 : 3); }, function () { hide(3); });
      } else {
        card.classList.toggle('open');
      }
    });
    root.querySelector('.ok').addEventListener('click', function () { hide(30); });
    root.querySelector('.x').addEventListener('click', function () { hide(3); });

    var y0 = null;
    card.addEventListener('touchstart', function (e) { y0 = e.touches[0].clientY; }, { passive: true });
    card.addEventListener('touchend', function (e) {
      if (y0 !== null && e.changedTouches[0].clientY - y0 < -40) hide(3);
      y0 = null;
    }, { passive: true });

    requestAnimationFrame(function () { if (card) void card.offsetWidth; requestAnimationFrame(function () { if (card) card.classList.add('in'); }); });
  }

  function show() {
    if (shown || standalone() || snoozed()) return;
        shown = true;
    build();
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    evFired = true;
    deferred = e;
    show();
  }, true);

  window.addEventListener('appinstalled', function () { deferred = null; hide(0); });

  function ready() {
    domReady = true;
    if (standalone()) return;
    {
      show();
      if (!force) checkInstalled(function (installed) { if (installed && !deferred) hide(0); });
    }
  }
  ready();

  if (debug) {
    setInterval(function () {
      var d = document.getElementById('milan-pwa-dbg');
      if (!d) {
        d = document.createElement('pre');
        d.id = 'milan-pwa-dbg';
        d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;margin:0;padding:8px;background:#000;color:#0f0;font:11px/1.3 monospace;z-index:2147483646;white-space:pre-wrap';
        document.documentElement.appendChild(d);
      }
      var base = 'ios=' + isIOS + ' android=' + isAndroid + ' inApp=' + inApp + ' standalone=' + standalone() + ' snoozed=' + snoozed() +
        '\nbeforeinstallprompt=' + evFired + ' bannerShown=' + shown + ' https=' + (location.protocol === 'https:') +
        ' sw.controller=' + !!(navigator.serviceWorker && navigator.serviceWorker.controller);
      d.textContent = base;
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then(function (r) {
          d.textContent = base + '\nsw.registration=' + (r ? (r.active ? 'active' : (r.installing ? 'installing' : 'waiting')) + ' scope=' + r.scope : 'NONE');
        });
      }
    }, 1500);
  }

  window.milanShowInstall = function () { try { localStorage.removeItem(KEY); } catch (e) {} shown = false; show(); };
})();
