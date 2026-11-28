var DID_RE = /^did:milan:[0-9a-f]{32}$/;
module.exports = function (app, pool, authFromReq, dwnSpaceDir, path, fs) {
  pool.query("CREATE TABLE IF NOT EXISTS connections (id INT AUTO_INCREMENT PRIMARY KEY, from_did VARCHAR(100) NOT NULL, to_did VARCHAR(100) NOT NULL, status ENUM('pending','accepted') NOT NULL DEFAULT 'pending', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_pair (from_did, to_did), KEY idx_to (to_did, status)) DEFAULT CHARSET=utf8mb4")
    .catch(function (e) { console.error("connections table error:", e.message); });

  function avatarUrl(req, u) {
    try {
      var dir = dwnSpaceDir({ space_id: u.space_id });
      if (!dir) return "";
      var st = fs.statSync(path.join(dir, "dp", "avatar.meta.json"));
      fs.accessSync(path.join(dir, "dp", "avatar.bin"));
      var proto = String(req.headers["x-forwarded-proto"] || req.protocol).split(",")[0];
      return proto + "://" + req.get("host") + "/api/avatar/" + u.did + "?v=" + Math.round(st.mtimeMs);
    } catch (e) { return ""; }
  }

  app.get("/api/avatar/:did", function (req, res) {
    var did = String(req.params.did || "");
    if (!DID_RE.test(did)) return res.status(400).end();
    pool.query("SELECT space_id FROM users WHERE did = ?", [did]).then(function (r) {
      var u = r[0][0];
      var dir = u && dwnSpaceDir(u);
      if (!dir) return res.status(404).end();
      var meta = JSON.parse(fs.readFileSync(path.join(dir, "dp", "avatar.meta.json"), "utf8"));
      if (!/^image\/(jpeg|png|webp|gif)$/i.test(meta.mime || "")) return res.status(404).end();
      var bin = fs.readFileSync(path.join(dir, "dp", "avatar.bin"));
      res.set({ "Content-Type": meta.mime, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" });
      res.send(bin);
    }).catch(function () { res.status(404).end(); });
  });

  app.get(["/social/people", "/api/social/people"], async function (req, res) {
    var d = authFromReq(req, res); if (!d) return;
    try {
      var [users] = await pool.query("SELECT id, name, did, space_id FROM users WHERE did IS NOT NULL AND did <> ? AND email_verified = 1 ORDER BY id DESC", [d.did]);
      var [conns] = await pool.query("SELECT id, from_did, to_did, status FROM connections WHERE from_did = ? OR to_did = ?", [d.did, d.did]);
      var map = {};
      conns.forEach(function (c) { map[c.from_did === d.did ? c.to_did : c.from_did] = c; });
      var rank = { received: 0, none: 1, sent: 2, friends: 3 };
      var out = users.map(function (u) {
        var c = map[u.did], st = "none", cid = "";
        if (c) { cid = c.id; st = c.status === "accepted" ? "friends" : (c.from_did === d.did ? "sent" : "received"); }
        return { name: u.name, did: u.did, avatar: avatarUrl(req, u), connectionStatus: st, connectionId: cid };
      });
      out.sort(function (a, b) { return rank[a.connectionStatus] - rank[b.connectionStatus]; });
      res.set("Cache-Control", "no-store");
      res.json(out);
    } catch (e) { console.error(e); res.status(500).json({ error: "Could not load people" }); }
  });

  app.post(["/connections", "/api/connections"], async function (req, res) {
    var d = authFromReq(req, res); if (!d) return;
    try {
      var to = String((req.body || {}).toDid || "").trim();
      if (!DID_RE.test(to)) return res.status(400).json({ error: "Invalid DID" });
      if (to === d.did) return res.status(400).json({ error: "You cannot follow yourself" });
      var [t] = await pool.query("SELECT id FROM users WHERE did = ? AND email_verified = 1", [to]);
      if (!t.length) return res.status(404).json({ error: "User not found" });
      var [ex] = await pool.query("SELECT id, from_did, status FROM connections WHERE (from_did = ? AND to_did = ?) OR (from_did = ? AND to_did = ?)", [d.did, to, to, d.did]);
      if (ex.length) {
        var c = ex[0];
        if (c.status === "accepted") return res.json({ ok: true, status: "accepted", id: c.id });
        if (c.from_did === d.did) return res.json({ ok: true, status: "pending", id: c.id });
        await pool.query("UPDATE connections SET status = 'accepted' WHERE id = ?", [c.id]);
        return res.json({ ok: true, status: "accepted", id: c.id });
      }
      var [r] = await pool.query("INSERT INTO connections (from_did, to_did) VALUES (?, ?)", [d.did, to]);
      res.status(201).json({ ok: true, status: "pending", id: r.insertId });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") return res.json({ ok: true, status: "pending" });
      console.error(e); res.status(500).json({ error: "Could not send follow request" });
    }
  });

  app.post(["/connections/:id/approve", "/api/connections/:id/approve"], async function (req, res) {
    var d = authFromReq(req, res); if (!d) return;
    try {
      var id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
      var r = await pool.query("UPDATE connections SET status = 'accepted' WHERE id = ? AND to_did = ? AND status = 'pending'", [id, d.did]);
      if (!r[0].affectedRows) return res.status(404).json({ error: "Request not found" });
      res.json({ ok: true, status: "accepted" });
    } catch (e) { console.error(e); res.status(500).json({ error: "Could not accept request" }); }
  });

  app.post(["/connections/:id/reject", "/api/connections/:id/reject"], async function (req, res) {
    var d = authFromReq(req, res); if (!d) return;
    try {
      var id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
      var r = await pool.query("DELETE FROM connections WHERE id = ? AND to_did = ? AND status = 'pending'", [id, d.did]);
      if (!r[0].affectedRows) return res.status(404).json({ error: "Request not found" });
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: "Could not decline request" }); }
  });

  app.get(["/social/notifications", "/api/social/notifications"], async function (req, res) {
    var d = authFromReq(req, res); if (!d) return;
    try {
      var [rows] = await pool.query("SELECT from_did, to_did, status, created_at, updated_at FROM connections WHERE (to_did = ? AND status = 'pending') OR (from_did = ? AND status = 'accepted') ORDER BY updated_at DESC LIMIT 20", [d.did, d.did]);
      res.set("Cache-Control", "no-store");
      res.json(rows.map(function (r) {
        return r.status === "pending"
          ? { type: "follow_request", actorDid: r.from_did, createdAt: r.created_at }
          : { type: "follow_accepted", actorDid: r.to_did, createdAt: r.updated_at };
      }));
    } catch (e) { console.error(e); res.status(500).json({ error: "Could not load notifications" }); }
  });
};
