/* MILAN: post composer (photo / video / audio / file upload) + home feed */
(function () {
  'use strict';
  var MAX = 500 * 1024 * 1024;
  var MODES = { private: ['🔒', 'Only me'], friends: ['👥', 'Friends'], public: ['🌍', 'Public'] };
  var EXT = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', pdf: 'application/pdf', txt: 'text/plain' };
  var input, textarea, pubBtn, vis, prev, prog, err, objUrl = null, busy = false, pubLabel = 'Publish';
  var F = { scope: 'home', before: null, loading: false, done: false, rid: 0, count: 0 };
  var feedList, feedState;

  var CSS = [
    '#selectedFileName{display:none!important}',
    '#milanFeedList{display:none!important}',
    '#mcVis{height:40px;border-radius:999px;border:1px solid var(--line,rgba(127,127,127,.3));background:var(--card,rgba(127,127,127,.12));color:inherit;font:inherit;font-size:13px;font-weight:700;padding:0 10px;margin-right:8px;max-width:140px}',
    '#mcPreview{display:none;position:relative;margin:10px 0 0;border-radius:14px;overflow:hidden;border:1px solid var(--line,rgba(127,127,127,.3));background:rgba(127,127,127,.12)}',
    '#mcPreview img,#mcPreview video{display:block;width:100%;max-height:320px;object-fit:contain;background:#000}',
    '#mcPreview audio{display:block;width:100%}',
    '#mcPreview .mc-file{display:flex;gap:10px;align-items:center;padding:14px;font-size:14px;font-weight:700;word-break:break-all}',
    '#mcPreview .mc-x{position:absolute;top:8px;right:8px;width:34px;height:34px;border-radius:50%;border:0;background:rgba(0,0,0,.65);color:#fff;font-size:16px;cursor:pointer}',
    '#mcProg{display:none;height:6px;border-radius:99px;background:rgba(127,127,127,.25);overflow:hidden;margin-top:10px}',
    '#mcProg i{display:block;height:100%;width:0;background:linear-gradient(90deg,#f59e0b,#d946ef);transition:width .15s}',
    '#mcErr{display:none;color:#ef4444;font-size:13px;font-weight:700;margin-top:8px}',
    '#mcFeed{margin-top:12px}',
    '#mcFeed .mc-tabs{display:flex;gap:8px;margin-bottom:12px;overflow-x:auto}',
    '#mcFeed .mc-tab{flex:0 0 auto;min-height:36px;padding:0 14px;border-radius:999px;border:1px solid var(--line,rgba(127,127,127,.3));background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:800;cursor:pointer}',
    '#mcFeed .mc-tab.on{background:linear-gradient(135deg,#f59e0b,#d946ef);color:#fff;border-color:transparent}',
    '#mcFeed .mc-post{margin-bottom:14px;padding:14px;border-radius:18px;background:var(--card,rgba(127,127,127,.1));border:1px solid var(--line,rgba(127,127,127,.25))}',
    '#mcFeed .mc-ph{display:flex;align-items:center;gap:10px}',
    '#mcFeed .mc-pav{width:42px;height:42px;flex:0 0 42px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:linear-gradient(135deg,#f59e0b,#d946ef);color:#fff;font-weight:800}',
    '#mcFeed .mc-pav img{width:100%;height:100%;object-fit:cover;display:block}',
    '#mcFeed .mc-who{flex:1;min-width:0}',
    '#mcFeed .mc-pn{font-size:15px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#mcFeed .mc-pt{font-size:13px;color:var(--muted,#9aa7c2)}',
    '#mcFeed .mc-del{border:0;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:700;padding:8px;min-height:40px;cursor:pointer;opacity:.8}',
    '#mcFeed .mc-text{margin-top:10px;font-size:15px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}',
    '#mcFeed .mc-media{margin-top:10px;border-radius:14px;overflow:hidden;background:#000}',
    '#mcFeed .mc-media img,#mcFeed .mc-media video{display:block;width:100%;max-height:70vh;object-fit:contain;background:#000}',
    '#mcFeed .mc-media audio{display:block;width:100%;background:transparent}',
    '#mcFeed .mc-fcard{display:flex;gap:10px;align-items:center;padding:14px;margin-top:10px;border-radius:14px;border:1px solid var(--line,rgba(127,127,127,.3));color:inherit;text-decoration:none;font-weight:700;font-size:14px;word-break:break-all}',
    '#mcFeed .mc-fstate{text-align:center;padding:14px 8px;font-size:13px;color:var(--muted,#9aa7c2)}'
  ].join('');

  function token() { try { return localStorage.getItem('milan_token') || ''; } catch (e) { return ''; } }
  function H(x) { var h = { Authorization: 'Bearer ' + token(), Accept: 'application/json' }; for (var k in (x || {})) h[k] = x[k]; return h; }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function fmtBytes(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString();
  }
  function mimeOf(f) {
    if (f.type) return f.type.split(';')[0];
    var m = /\.([A-Za-z0-9]+)$/.exec(f.name || '');
    return (m && EXT[m[1].toLowerCase()]) || 'application/octet-stream';
  }
  function kindOf(mime) {
    return /^image\/(jpeg|png|webp|gif|avif)$/.test(mime) ? 'image'
      : /^video\/(mp4|webm|quicktime|3gpp)$/.test(mime) ? 'video'
      : /^audio\/(mpeg|mp3|mp4|aac|wav|webm|ogg|x-m4a)$/.test(mime) ? 'audio' : 'file';
  }
  function toast(text, bad) {
    var old = document.getElementById('mc-toast'); if (old) old.remove();
    var t = el('div', null, text); t.id = 'mc-toast'; t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 24px);transform:translate(-50%,24px);opacity:0;z-index:2147483000;max-width:90vw;box-sizing:border-box;padding:12px 18px;border-radius:14px;color:#fff;font:700 14px/1.3 sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5);transition:transform .35s cubic-bezier(.2,1.1,.3,1),opacity .25s ease;pointer-events:none;text-align:center;background:' + (bad ? '#7f1d1d' : '#14532d');
    document.body.appendChild(t);
    requestAnimationFrame(function () { requestAnimationFrame(function () { t.style.opacity = '1'; t.style.transform = 'translate(-50%,0)'; }); });
    setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 300); }, 2600);
  }
  function showErr(msg) { if (!err) return; err.textContent = msg ? '\u26A0 ' + msg : ''; err.style.display = msg ? 'block' : 'none'; }
  function setProg(p, on) { if (!prog) return; prog.style.display = on ? 'block' : 'none'; prog.firstChild.style.width = Math.round(p * 100) + '%'; }
  function setBtn(text, dis) { pubBtn.textContent = text; pubBtn.disabled = dis; }
  function setVis(mode) { vis.value = mode; try { localStorage.setItem('milan_post_vis', mode); } catch (e) {} toast('Who can see: ' + MODES[mode][1]); }
  function block(e) { e.preventDefault(); e.stopImmediatePropagation(); }

  function clearPreview() {
    if (objUrl) { try { URL.revokeObjectURL(objUrl); } catch (e) {} objUrl = null; }
    if (prev) { prev.textContent = ''; prev.style.display = 'none'; }
  }
  function onPick() {
    var f = input.files && input.files[0];
    clearPreview();
    if (!f) return;
    if (f.size > MAX) { showErr('This file is too large (max 500 MB).'); input.value = ''; return; }
    showErr('');
    var mime = mimeOf(f), kind = kindOf(mime);
    objUrl = URL.createObjectURL(f);
    if (kind === 'image') { var im = el('img'); im.src = objUrl; im.alt = ''; prev.appendChild(im); }
    else if (kind === 'video') { var v = el('video'); v.src = objUrl + '#t=0.1'; v.controls = true; v.muted = true; v.playsInline = true; v.preload = 'metadata'; prev.appendChild(v); }
    else if (kind === 'audio') { var a = el('audio'); a.src = objUrl; a.controls = true; prev.appendChild(a); }
    else { var fr = el('div', 'mc-file'); fr.appendChild(el('span', null, '📄')); fr.appendChild(el('span', null, f.name + ' · ' + fmtBytes(f.size))); prev.appendChild(fr); }
    var x = el('button', 'mc-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Remove');
    x.addEventListener('click', function () { input.value = ''; clearPreview(); });
    prev.appendChild(x);
    prev.style.display = 'block';
  }
  function pick(accept) { input.accept = accept; input.click(); }

  function putFile(url, file, onProg) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('PUT', url, true);
      x.timeout = 1800000;
      x.setRequestHeader('Authorization', 'Bearer ' + token());
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.upload.onprogress = function (e) { if (e.lengthComputable) onProg(e.loaded / e.total); };
      x.onload = function () {
        var j = {}; try { j = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300) return resolve(j);
        var m = j.error || (x.status === 413 ? 'File is too large for the server.' : 'Upload failed (' + x.status + ').');
        if (j.upgrade) m += ' Upgrade your storage to continue.';
        reject(new Error(m));
      };
      x.onerror = function () { reject(new Error('Network error during upload. Please try again.')); };
      x.ontimeout = function () { reject(new Error('Upload timed out.')); };
      x.send(file);
    });
  }

  async function publish() {
    if (busy) return;
    var text = textarea.value.trim(), f = input.files && input.files[0];
    if (!text && !f) { showErr('Write something or choose a photo/video first.'); return; }
    busy = true; showErr(''); setBtn('Publishing…', true); setProg(0, !!f);
    var postId = null;
    try {
      var r = await fetch('/api/posts', { method: 'POST', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify({ text: text, accessMode: vis.value, media: f ? { name: f.name, mime: mimeOf(f), size: f.size } : null }) });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error((j.error || 'Could not publish (' + r.status + ').') + (j.upgrade ? ' Upgrade your storage to continue.' : ''));
      postId = j.id;
      if (f) await putFile('/api/posts/' + postId + '/media', f, function (p) { setBtn('Uploading ' + Math.round(p * 100) + '%', true); setProg(p, true); });
      textarea.value = ''; textarea.dispatchEvent(new Event('input', { bubbles: true }));
      input.value = ''; clearPreview();
      toast('Posted \u2713');
      loadFeed(true);
    } catch (e) {
      if (postId && f) fetch('/api/posts/' + postId, { method: 'DELETE', headers: H() }).catch(function () {});
      showErr(e && e.message ? e.message : 'Publish failed.');
    } finally { busy = false; setBtn(pubLabel, false); setProg(0, false); }
  }

  function mountComposer() {
    var comp = document.querySelector('.composer');
    input = document.getElementById('mediaFile'); textarea = document.getElementById('postText'); pubBtn = document.getElementById('publishBtn');
    if (!comp || !input || !textarea || !pubBtn) return false;
    if (document.getElementById('mcVis')) return true;
    pubLabel = pubBtn.textContent || 'Publish';
    vis = el('select'); vis.id = 'mcVis'; vis.setAttribute('aria-label', 'Who can see this post');
    Object.keys(MODES).forEach(function (k) { var o = el('option', null, MODES[k][0] + ' ' + MODES[k][1]); o.value = k; vis.appendChild(o); });
    try { vis.value = localStorage.getItem('milan_post_vis') || 'private'; } catch (e) { vis.value = 'private'; }
    if (!vis.value) vis.value = 'private';
    vis.addEventListener('change', function () { try { localStorage.setItem('milan_post_vis', vis.value); } catch (e) {} });
    pubBtn.parentNode.insertBefore(vis, pubBtn);
    prev = el('div'); prev.id = 'mcPreview';
    var row = comp.querySelector('.composer-row') || textarea.parentNode;
    row.parentNode.insertBefore(prev, row.nextSibling);
    var bottom = comp.querySelector('.composer-bottom') || pubBtn.parentNode;
    prog = el('div'); prog.id = 'mcProg'; prog.appendChild(el('i'));
    err = el('div'); err.id = 'mcErr';
    bottom.parentNode.insertBefore(prog, bottom.nextSibling);
    bottom.parentNode.insertBefore(err, prog.nextSibling);
    input.addEventListener('change', onPick);
    return true;
  }

  /* ---------- feed ---------- */
  function mediaEl(m) {
    var src = m.url + '?t=' + encodeURIComponent(token());
    var box = el('div', 'mc-media');
    function asFile() {
      var a = el('a', 'mc-fcard'); a.href = src; a.setAttribute('download', m.name || 'file');
      a.appendChild(el('span', null, '📄')); a.appendChild(el('span', null, (m.name || 'File') + ' · ' + fmtBytes(m.bytes) + ' · Download'));
      return a;
    }
    if (m.kind === 'image') {
      var im = el('img'); im.loading = 'lazy'; im.alt = ''; im.src = src;
      im.addEventListener('click', function () { window.open(src, '_blank'); });
      im.onerror = function () { box.replaceWith(asFile()); };
      box.appendChild(im);
    } else if (m.kind === 'video') {
      var v = el('video'); v.controls = true; v.playsInline = true; v.preload = 'metadata'; v.src = src + '#t=0.1';
      v.onerror = function () { box.replaceWith(asFile()); };
      box.appendChild(v);
    } else if (m.kind === 'audio') {
      var a = el('audio'); a.controls = true; a.preload = 'none'; a.src = src; box.appendChild(a);
    } else { return asFile(); }
    return box;
  }
  function card(p) {
    var c = el('article', 'mc-post');
    var head = el('div', 'mc-ph'), av = el('div', 'mc-pav');
    var ini = String(p.name || 'M').trim().charAt(0).toUpperCase() || 'M';
    if (p.avatar) {
      var im = new Image(); im.alt = ''; im.src = p.avatar;
      im.onerror = function () { im.remove(); av.textContent = ini; };
      av.appendChild(im);
    } else { av.textContent = ini; }
    var who = el('div', 'mc-who');
    who.appendChild(el('div', 'mc-pn', p.name || 'MILAN user'));
    var md = MODES[p.accessMode] || MODES.private;
    who.appendChild(el('div', 'mc-pt', ago(p.createdAt) + ' · ' + md[0] + ' ' + md[1]));
    head.appendChild(av); head.appendChild(who);
    if (p.mine) {
      var del = el('button', 'mc-del', '🗑'); del.type = 'button'; del.title = 'Delete post'; var armed = false;
      del.addEventListener('click', function () {
        if (!armed) { armed = true; del.textContent = 'Tap again to delete'; setTimeout(function () { armed = false; del.textContent = '🗑'; }, 3000); return; }
        fetch('/api/posts/' + p.id, { method: 'DELETE', headers: H() }).then(function (r) {
          if (r.ok) { c.remove(); toast('Post deleted'); } else { toast('Could not delete', true); }
        }).catch(function () { toast('Could not delete', true); });
      });
      head.appendChild(del);
    }
    c.appendChild(head);
    if (p.text) c.appendChild(el('div', 'mc-text', p.text));
    if (p.media) c.appendChild(mediaEl(p.media));
    return c;
  }
  function emptyText() { return F.scope === 'mine' ? 'You have not posted yet.' : (F.scope === 'public' ? 'No public posts yet.' : 'No posts yet. Share something above!'); }
  function loadFeed(reset) {
    if (!feedList) return;
    if (reset) { F.rid++; F.before = null; F.done = false; F.loading = false; F.count = 0; feedList.textContent = ''; }
    if (F.loading || F.done) return;
    F.loading = true;
    var rid = F.rid;
    feedState.textContent = F.count ? 'Loading more…' : 'Loading…';
    fetch('/api/posts?scope=' + F.scope + '&limit=10' + (F.before ? '&before=' + F.before : ''), { headers: H(), cache: 'no-store' })
      .then(function (r) { if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; } return r.json(); })
      .then(function (j) {
        if (rid !== F.rid) return;
        (j.items || []).forEach(function (p) { feedList.appendChild(card(p)); F.count++; });
        if (j.nextBefore) F.before = j.nextBefore;
        F.done = !j.hasMore; F.loading = false;
        feedState.textContent = F.count ? (F.done ? 'You\u2019re all caught up' : '') : emptyText();
        feedState.onclick = null;
        setTimeout(checkMore, 50);
      })
      .catch(function (e) {
        if (rid !== F.rid) return;
        F.loading = false;
        feedState.textContent = (e && e.status === 401) ? 'Could not verify login. Please refresh the page.' : 'Could not load posts. Tap to retry.';
        if (!(e && e.status === 401)) feedState.onclick = function () { feedState.onclick = null; loadFeed(false); };
      });
  }
  function checkMore() {
    if (F.done || F.loading || !feedState || feedState.offsetParent === null) return;
    if (feedState.getBoundingClientRect().top < window.innerHeight + 600) loadFeed(false);
  }
  function mountFeed() {
    var sec = document.getElementById('milanHomeFeed'), old = document.getElementById('milanFeedList');
    if (!sec || !old) return false;
    if (document.getElementById('mcFeed')) return true;
    var root = el('div'); root.id = 'mcFeed';
    var tabs = el('div', 'mc-tabs');
    [['home', 'Home'], ['mine', 'My posts'], ['public', 'Public']].forEach(function (t) {
      var b = el('button', 'mc-tab' + (t[0] === F.scope ? ' on' : ''), t[1]); b.type = 'button';
      b.addEventListener('click', function () {
        F.scope = t[0];
        Array.prototype.forEach.call(tabs.children, function (x) { x.classList.remove('on'); });
        b.classList.add('on'); loadFeed(true);
      });
      tabs.appendChild(b);
    });
    feedList = el('div'); feedState = el('div', 'mc-fstate');
    root.appendChild(tabs); root.appendChild(feedList); root.appendChild(feedState);
    old.parentNode.insertBefore(root, old);
    window.addEventListener('scroll', checkMore, { passive: true });
    loadFeed(true);
    return true;
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('#publishBtn,#photoUploadBtn,#fileUploadBtn,#composerGlobeBtn,.composer-tools .tool,#milanFeedRefresh') : null;
    if (!t || !input) return;
    if (t.id === 'publishBtn') { block(e); publish(); }
    else if (t.id === 'photoUploadBtn') { block(e); pick('image/*,video/*'); }
    else if (t.id === 'fileUploadBtn') { block(e); pick('audio/*,video/*,image/*,.pdf,.txt,.zip,.doc,.docx,.xls,.xlsx,.csv'); }
    else if (t.id === 'composerGlobeBtn') { block(e); setVis('public'); }
    else if (t.id === 'milanFeedRefresh') { block(e); loadFeed(true); }
    else if ((t.textContent || '').trim() === '🔒') { block(e); setVis('private'); }
  }, true);
  document.addEventListener('play', function (e) {
    if (!e.target || !e.target.closest || !e.target.closest('#mcFeed')) return;
    Array.prototype.forEach.call(document.querySelectorAll('#mcFeed video,#mcFeed audio'), function (m) { if (m !== e.target) m.pause(); });
  }, true);

  function init() {
    var s = document.createElement('style'); s.id = 'mc-post-css'; s.textContent = CSS; document.head.appendChild(s);
    var a = mountComposer(), b = mountFeed();
    if (a && b) return;
    var n = 0, iv = setInterval(function () {
      a = a || mountComposer(); b = b || mountFeed();
      if ((a && b) || ++n > 40) clearInterval(iv);
    }, 500);
  }
  window.mcFeedReload = function () { loadFeed(true); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
