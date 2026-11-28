/* MILAN posts: text / photo / video / audio / file posts + feed.
   Media lives in the owner's DWN space (posts/). The post index lives in MySQL table `posts`. */
var jwt = require("jsonwebtoken");

module.exports = function (app, pool, dwnSpaceDir, path, fs, checkQuota) {
  var JWT_SECRET = process.env.JWT_SECRET || "milan-secret-2026";
  var MAX_BYTES = 500 * 1024 * 1024;
  var MODES = { private: 1, friends: 1, public: 1 };
  var TYPES = {
    "image/jpeg": ["image", "jpg"], "image/png": ["image", "png"], "image/webp": ["image", "webp"], "image/gif": ["image", "gif"], "image/avif": ["image", "avif"],
    "video/mp4": ["video", "mp4"], "video/webm": ["video", "webm"], "video/quicktime": ["video", "mov"], "video/3gpp": ["video", "3gp"],
    "audio/mpeg": ["audio", "mp3"], "audio/mp3": ["audio", "mp3"], "audio/mp4": ["audio", "m4a"], "audio/x-m4a": ["audio", "m4a"],
    "audio/aac": ["audio", "aac"], "audio/wav": ["audio", "wav"], "audio/webm": ["audio", "weba"], "audio/ogg": ["audio", "ogg"]
  };
  function typeOf(mime) {
    mime = String(mime || "").toLowerCase().split(";")[0].trim();
    var t = TYPES[mime];
    return t ? { mime: mime, kind: t[0], ext: t[1] } : { mime: "application/octet-stream", kind: "file", ext: "bin" };
  }
  async function db(fn) {
    var c = await pool.getConnection();
    try { await c.query("SET NAMES utf8mb4"); return await fn(c); } finally { c.release(); }
  }
  db(function (c) {
    return c.query("CREATE TABLE IF NOT EXISTS posts (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, did VARCHAR(255) NOT NULL, space_id VARCHAR(255) NOT NULL, body TEXT NULL, access_mode VARCHAR(16) NOT NULL DEFAULT 'private', media_name VARCHAR(255) NULL, media_mime VARCHAR(100) NULL, media_kind VARCHAR(16) NULL, media_file VARCHAR(120) NULL, media_bytes BIGINT NULL, status VARCHAR(12) NOT NULL DEFAULT 'ready', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_user (user_id, id), KEY idx_status (status, id)) DEFAULT CHARSET=utf8mb4");
  }).catch(function (e) { console.error("posts table:", e.message); });

  function userFrom(req, allowQuery) {
    var t = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!t && allowQuery) t = String(req.query.t || "");
    if (!t) return null;
    try {
      var d = jwt.verify(t, JWT_SECRET);
      return d && d.id && d.did ? d : null;
    } catch (e) { return null; }
  }
  async function friendDids(c, did) {
    var r = await c.query("SELECT from_did, to_did FROM connections WHERE status = 'accepted' AND (from_did = ? OR to_did = ?)", [did, did]);
    return r[0].map(function (x) { return x.from_did === did ? x.to_did : x.from_did; });
  }
  function toItem(r, me) {
    return {
      id: r.id, did: r.did, name: r.name || "MILAN user",
      avatar: "/api/social/avatar/" + encodeURIComponent(r.did),
      text: r.body || "", accessMode: r.access_mode,
      createdAt: new Date(r.created_at).toISOString(), mine: r.user_id === me.id,
      media: r.media_file ? { kind: r.media_kind, mime: r.media_mime, bytes: Number(r.media_bytes || 0), name: r.media_name, url: "/api/posts/" + r.id + "/media" } : null
    };
  }
  function dropRow(id) { return db(function (c) { return c.query("DELETE FROM posts WHERE id = ?", [id]); }).catch(function () {}); }

  /* 1) create a post (text-only is final; with media it waits for the upload) */
  app.post("/api/posts", async function (req, res) {
    var d = userFrom(req);
    if (!d) return res.status(401).json({ error: "Please sign in again." });
    var dir = dwnSpaceDir(d);
    if (!dir) return res.status(400).json({ error: "Invalid space" });
    try {
      var b = req.body || {};
      var text = String(b.text || "").slice(0, 5000).trim();
      var mode = MODES[b.accessMode] ? b.accessMode : "private";
      var m = b.media && typeof b.media === "object" ? b.media : null;
      if (!text && !m) return res.status(400).json({ error: "Write something or choose media first." });
      var t = null, size = 0, name = null;
      if (m) {
        t = typeOf(m.mime);
        size = Number(m.size);
        if (!(size > 0) || size > MAX_BYTES) return res.status(413).json({ error: "File is too large (max 500 MB)." });
        var qerr = checkQuota(dir, size, 0);
        if (qerr) return res.status(qerr.code).json(qerr.body);
        name = String(m.name || "file").replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200);
      }
      var r = await db(function (c) {
        return c.query("INSERT INTO posts (user_id, did, space_id, body, access_mode, media_name, media_mime, media_kind, media_bytes, status) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [d.id, d.did, d.space_id, text, mode, name, m ? t.mime : null, m ? t.kind : null, m ? size : null, m ? "uploading" : "ready"]);
      });
      var id = r[0].insertId;
      res.json({ id: id, status: m ? "uploading" : "ready", upload: m ? "/api/posts/" + id + "/media" : null });
    } catch (e) { console.error("posts create:", e.message); res.status(500).json({ error: "Could not publish. Try again." }); }
  });

  /* 2) stream the media file straight to disk */
  app.put("/api/posts/:id/media", async function (req, res) {
    var d = userFrom(req);
    if (!d) return res.status(401).json({ error: "Please sign in again." });
    var id = parseInt(req.params.id, 10), dir = dwnSpaceDir(d);
    if (!id || !dir) return res.status(400).json({ error: "Bad request" });
    var p = null;
    try {
      var rows = await db(function (c) { return c.query("SELECT * FROM posts WHERE id = ? AND user_id = ?", [id, d.id]); });
      p = rows[0][0];
    } catch (e) { return res.status(500).json({ error: "Server error" }); }
    if (!p || p.status !== "uploading") return res.status(404).json({ error: "Upload not found" });
    var t = typeOf(p.media_mime);
    var limit = Math.min(MAX_BYTES, Number(p.media_bytes) + 1024);
    var cl = parseInt(req.headers["content-length"], 10) || 0;
    if (cl > limit) { dropRow(id); return res.status(413).json({ error: "File is larger than declared." }); }
    var postsDir = path.join(dir, "posts");
    try { fs.mkdirSync(postsDir, { recursive: true }); } catch (e) {}
    var file = "media-" + id + "." + t.ext, target = path.join(postsDir, file), tmp = target + ".part";
    var done = false, n = 0;
    var ws = fs.createWriteStream(tmp);
    function fail(code, msg) {
      if (done) return;
      done = true;
      try { req.unpipe(ws); req.resume(); } catch (e) {}
      try { ws.destroy(); } catch (e) {}
      try { fs.unlinkSync(tmp); } catch (e) {}
      dropRow(id);
      if (!res.headersSent) res.status(code).json({ error: msg });
    }
    ws.on("error", function () { fail(500, "Could not save the file."); });
    req.on("data", function (ch) { n += ch.length; if (n > limit) fail(413, "File is larger than declared."); });
    req.on("close", function () { if (!req.complete) fail(400, "Upload interrupted."); });
    ws.on("finish", async function () {
      if (done) return;
      if (!n) return fail(400, "The file is empty.");
      done = true;
      try {
        fs.renameSync(tmp, target);
        await db(function (c) { return c.query("UPDATE posts SET media_file = ?, media_bytes = ?, status = 'ready' WHERE id = ?", [file, n, id]); });
        try {
          fs.writeFileSync(path.join(postsDir, "post-" + id + ".json"), JSON.stringify({ id: id, text: p.body, accessMode: p.access_mode, media: { file: file, name: p.media_name, mime: t.mime, bytes: n }, createdAt: new Date().toISOString() }));
        } catch (e) {}
        res.json({ ok: true, id: id, bytes: n });
      } catch (e) {
        console.error("posts upload:", e.message);
        try { fs.unlinkSync(target); } catch (x) {}
        dropRow(id);
        if (!res.headersSent) res.status(500).json({ error: "Could not save the file." });
      }
    });
    req.pipe(ws);
  });

  /* 3) feed */
  app.get("/api/posts", async function (req, res) {
    var d = userFrom(req);
    if (!d) return res.status(401).json({ error: "Please sign in again." });
    try {
      var scope = req.query.scope === "mine" || req.query.scope === "public" ? req.query.scope : "home";
      var limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 10));
      var before = parseInt(req.query.before, 10) || 0;
      var out = await db(async function (c) {
        var where = "p.status = 'ready'", args = [];
        if (scope === "mine") { where += " AND p.user_id = ?"; args.push(d.id); }
        else if (scope === "public") { where += " AND p.access_mode = 'public'"; }
        else {
          var fr = await friendDids(c, d.did);
          if (fr.length) { where += " AND (p.user_id = ? OR (p.did IN (?) AND p.access_mode IN ('public','friends')))"; args.push(d.id, fr); }
          else { where += " AND p.user_id = ?"; args.push(d.id); }
        }
        if (before) { where += " AND p.id < ?"; args.push(before); }
        var r = await c.query("SELECT p.*, u.name FROM posts p JOIN users u ON u.id = p.user_id WHERE " + where + " ORDER BY p.id DESC LIMIT " + (limit + 1), args);
        return r[0];
      });
      var more = out.length > limit;
      if (more) out = out.slice(0, limit);
      res.set("Cache-Control", "no-store");
      res.json({ items: out.map(function (r) { return toItem(r, d); }), hasMore: more, nextBefore: out.length ? out[out.length - 1].id : null });
    } catch (e) { console.error("posts feed:", e.message); res.status(500).json({ error: "Could not load posts." }); }
  });

  /* 4) media download / video streaming (token in header or ?t=) */
  app.get("/api/posts/:id/media", async function (req, res) {
    var d = userFrom(req, true);
    var id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).end();
    try {
      var rows = await db(function (c) { return c.query("SELECT * FROM posts WHERE id = ? AND status = 'ready'", [id]); });
      var p = rows[0][0];
      if (!p || !p.media_file) return res.status(404).end();
      var ok = p.access_mode === "public" || (d && d.id === p.user_id);
      if (!ok && d && p.access_mode === "friends") {
        ok = await db(async function (c) { return (await friendDids(c, d.did)).indexOf(p.did) > -1; });
      }
      if (!ok) return res.status(d ? 403 : 401).end();
      var dir = dwnSpaceDir({ space_id: p.space_id });
      var f = dir ? path.join(dir, "posts", p.media_file) : null;
      if (!f || !fs.existsSync(f)) return res.status(404).end();
      var headers = {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
        "Content-Type": p.media_kind === "file" ? "application/octet-stream" : p.media_mime
      };
      if (p.media_kind === "file") headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + encodeURIComponent(p.media_name || "file").replace(/'/g, "%27");
      res.sendFile(f, { headers: headers });
    } catch (e) { console.error("posts media:", e.message); if (!res.headersSent) res.status(500).end(); }
  });

  /* 5) delete own post */
  app.delete("/api/posts/:id", async function (req, res) {
    var d = userFrom(req);
    if (!d) return res.status(401).json({ error: "Please sign in again." });
    var id = parseInt(req.params.id, 10), dir = dwnSpaceDir(d);
    if (!id || !dir) return res.status(400).json({ error: "Bad request" });
    try {
      var rows = await db(function (c) { return c.query("SELECT * FROM posts WHERE id = ? AND user_id = ?", [id, d.id]); });
      var p = rows[0][0];
      if (!p) return res.status(404).json({ error: "Post not found" });
      var pd = path.join(dir, "posts");
      [p.media_file, "post-" + id + ".json"].forEach(function (n) { if (n) { try { fs.unlinkSync(path.join(pd, n)); } catch (e) {} } });
      await dropRow(id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "Could not delete." }); }
  });

  setInterval(function () {
    db(function (c) { return c.query("DELETE FROM posts WHERE status = 'uploading' AND created_at < (NOW() - INTERVAL 6 HOUR)"); }).catch(function () {});
  }, 3600 * 1000).unref();
};
