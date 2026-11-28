var express = require("express");
var path = require("path");
var fs = require("fs");
var bcrypt = require("bcryptjs");
var jwt = require("jsonwebtoken");
var mysql = require("mysql2/promise");
var crypto = require("crypto");
var app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../../frontend")));
var JWT_SECRET = process.env.JWT_SECRET || "milan-secret-2026";
var pool = mysql.createPool({ host: "localhost", user: "milan", password: "milan123", database: "milan", waitForConnections: true, connectionLimit: 10 });
function makeDid() { return "did:milan:" + crypto.randomBytes(16).toString("hex"); }
function makeSpaceId(did) { return "space-" + crypto.createHash("sha256").update(did).digest("hex").slice(0, 24); }
app.get("/api/health", (req, res) => res.json({ ok: true, app: "MILAN", time: new Date().toISOString() }));

/* MILAN-SOCIAL-PEOPLE */
setTimeout(function () { pool.execute("CREATE TABLE IF NOT EXISTS connections (id INT AUTO_INCREMENT PRIMARY KEY, from_did VARCHAR(64) NOT NULL, to_did VARCHAR(64) NOT NULL, status VARCHAR(12) NOT NULL DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_conn (from_did, to_did), KEY k_to (to_did))").catch(function (e) { console.error("connections table:", e.message); }); }, 1500);
var SP_DID = /^did:milan:[0-9a-f]{32}$/;
async function spMe(req) {
  var t = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!t) { console.error("spMe 401: no token", req.originalUrl); return null; }
  var d; try { d = jwt.verify(t, JWT_SECRET); } catch (e) { console.error("spMe 401: jwt", e.message, req.originalUrl); return null; }
  var [r] = await pool.execute("SELECT id, did FROM users WHERE id = ?", [d.id]);
  if (!r.length) console.error("spMe 401: user id not found", d.id);
  return r.length ? r[0] : null;
}
function spAvatarUrl(did, spaceId) {
  try {
    var dir = path.join(__dirname, "../../DWN", String(spaceId));
    var meta = JSON.parse(fs.readFileSync(path.join(dir, "dp", "avatar.meta.json"), "utf8"));
    if (!fs.existsSync(path.join(dir, "dp", "avatar.bin"))) return "";
    return "/api/social/avatar/" + did + "?v=" + encodeURIComponent(meta.recordId || "1");
  } catch (e) { return ""; }
}
app.get(["/social/avatar/:did", "/api/social/avatar/:did"], async function (req, res) {
  try {
    var did = String(req.params.did || "");
    if (!SP_DID.test(did)) return res.status(400).end();
    var [r] = await pool.execute("SELECT space_id FROM users WHERE did = ?", [did]);
    if (!r.length) return res.status(404).end();
    var dir = path.join(__dirname, "../../DWN", String(r[0].space_id), "dp");
    var meta = JSON.parse(fs.readFileSync(path.join(dir, "avatar.meta.json"), "utf8"));
    var mime = String(meta.mime || "");
    if (mime.indexOf("image/") !== 0) return res.status(404).end();
    res.set("Content-Type", mime);
    res.set("Cache-Control", "public, max-age=300");
    res.send(fs.readFileSync(path.join(dir, "avatar.bin")));
  } catch (e) { res.status(404).end(); }
});
app.get(["/social/people", "/api/social/people"], async function (req, res) {
  try {
    var me = await spMe(req);
    if (!me) return res.status(401).json({ error: "Please sign in again." });
    var [users] = await pool.execute("SELECT id, name, did, space_id FROM users WHERE did <> ? ORDER BY name ASC", [me.did]);
    var [cons] = await pool.execute("SELECT id, from_did, to_did, status FROM connections WHERE from_did = ? OR to_did = ?", [me.did, me.did]);
    var map = {};
    cons.forEach(function (c) {
      var other = c.from_did === me.did ? c.to_did : c.from_did;
      var st = c.status === "accepted" ? "friends" : (c.from_did === me.did ? "sent" : "received");
      map[other] = { status: st, id: c.id };
    });
    res.set("Cache-Control", "no-store");
    res.json(users.map(function (u) {
      var m = map[u.did];
      return { did: u.did, name: u.name, avatar: spAvatarUrl(u.did, u.space_id), connectionStatus: m ? m.status : "none", connectionId: m ? m.id : null };
    }));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load people." }); }
});
app.post(["/connections", "/api/connections"], async function (req, res) {
  try {
    var me = await spMe(req);
    if (!me) return res.status(401).json({ error: "Please sign in again." });
    var to = String((req.body || {}).toDid || "");
    if (!SP_DID.test(to) || to === me.did) return res.status(400).json({ error: "Invalid DID" });
    var [u] = await pool.execute("SELECT id FROM users WHERE did = ?", [to]);
    if (!u.length) return res.status(404).json({ error: "User not found" });
    var [rev] = await pool.execute("SELECT id, status FROM connections WHERE from_did = ? AND to_did = ?", [to, me.did]);
    if (rev.length) {
      if (rev[0].status !== "accepted") await pool.execute("UPDATE connections SET status = 'accepted' WHERE id = ?", [rev[0].id]);
      return res.json({ status: "accepted" });
    }
    var [fwd] = await pool.execute("SELECT id, status FROM connections WHERE from_did = ? AND to_did = ?", [me.did, to]);
    if (fwd.length) return res.json({ status: fwd[0].status === "accepted" ? "accepted" : "pending" });
    await pool.execute("INSERT INTO connections (from_did, to_did, status) VALUES (?,?,'pending')", [me.did, to]);
    res.status(201).json({ status: "pending" });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not send request." }); }
});
app.post(["/connections/:id/approve", "/api/connections/:id/approve"], async function (req, res) {
  try {
    var me = await spMe(req);
    if (!me) return res.status(401).json({ error: "Please sign in again." });
    await pool.execute("UPDATE connections SET status = 'accepted' WHERE id = ? AND to_did = ? AND status = 'pending'", [Number(req.params.id), me.did]);
    res.json({ status: "accepted" });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not accept." }); }
});
app.post(["/connections/:id/reject", "/api/connections/:id/reject"], async function (req, res) {
  try {
    var me = await spMe(req);
    if (!me) return res.status(401).json({ error: "Please sign in again." });
    await pool.execute("DELETE FROM connections WHERE id = ? AND to_did = ? AND status = 'pending'", [Number(req.params.id), me.did]);
    res.json({ status: "rejected" });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not decline." }); }
});

/* MILAN-CHAT */
setTimeout(function () { pool.execute("CREATE TABLE IF NOT EXISTS messages (id BIGINT AUTO_INCREMENT PRIMARY KEY, message_id VARCHAR(64) NOT NULL, conv_key VARCHAR(100) NOT NULL, sender_did VARCHAR(64) NOT NULL, recipient_did VARCHAR(64) NOT NULL, body TEXT NOT NULL, sent_ms BIGINT NOT NULL, read_ms BIGINT NULL, UNIQUE KEY uq_msg (sender_did, message_id), KEY k_conv (conv_key, id), KEY k_rec (recipient_did)) DEFAULT CHARSET=utf8mb4").catch(function (e) { console.error("messages table:", e.message); }); }, 1800);
function chKey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
async function chFriends(did) {
  var [r] = await pool.execute("SELECT from_did, to_did FROM connections WHERE status = 'accepted' AND (from_did = ? OR to_did = ?)", [did, did]);
  return r.map(function (c) { return c.from_did === did ? c.to_did : c.from_did; });
}
async function chIsFriend(a, b) {
  var [r] = await pool.execute("SELECT id FROM connections WHERE status = 'accepted' AND ((from_did = ? AND to_did = ?) OR (from_did = ? AND to_did = ?)) LIMIT 1", [a, b, b, a]);
  return r.length > 0;
}
async function chPersons(dids) {
  if (!dids.length) return [];
  var [r] = await pool.query("SELECT name, did, space_id FROM users WHERE did IN (?) ORDER BY name ASC", [dids]);
  return r.map(function (u) { return { did: u.did, name: u.name, avatar: spAvatarUrl(u.did, u.space_id) }; });
}
function chMsg(r) {
  return { id: String(r.id), messageId: r.message_id, conversationId: r.conv_key, senderDid: r.sender_did, recipientDid: r.recipient_did, text: r.body,
    sentAt: new Date(Number(r.sent_ms)).toISOString(), readAt: r.read_ms ? new Date(Number(r.read_ms)).toISOString() : null, status: "sent" };
}
var chClients = new Map();
function chPush(did, payload) {
  var set = chClients.get(did); if (!set) return;
  var line = "data: " + JSON.stringify(payload) + "\n\n";
  set.forEach(function (r) { try { r.write(line); } catch (e) {} });
}
app.get(["/events", "/api/events"], async function (req, res) {
  try {
    var d = jwt.verify(String(req.query.token || ""), JWT_SECRET);
    var [r] = await pool.execute("SELECT did FROM users WHERE id = ?", [d.id]);
    if (!r.length) return res.status(401).end();
    var did = r[0].did;
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    if (res.flushHeaders) res.flushHeaders();
    res.write(": ok\n\n");
    if (!chClients.has(did)) chClients.set(did, new Set());
    chClients.get(did).add(res);
    var hb = setInterval(function () { try { res.write(": hb\n\n"); } catch (e) {} }, 25000);
    req.on("close", function () { clearInterval(hb); var s = chClients.get(did); if (s) { s.delete(res); if (!s.size) chClients.delete(did); } });
  } catch (e) { res.status(401).end(); }
});
app.get(["/chat/people", "/api/chat/people"], async function (req, res) {
  try {
    var me = await spMe(req);
    if (!me) return res.status(401).json({ error: "Please sign in again." });
    var q = String(req.query.q || "").trim().toLowerCase();
    var list = await chPersons(await chFriends(me.did));
    if (q) list = list.filter(function (p) { return String(p.name || "").toLowerCase().indexOf(q) > -1 || String(p.did).toLowerCase().indexOf(q) > -1; });
    res.set("Cache-Control", "no-store");
    res.json(list);
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load friends." }); }
});
app.get(["/chat/conversations", "/api/chat/conversations"], async function (req, res) {
  try {
    var me = await spMe(req);
    if (!me) return res.status(401).json({ error: "Please sign in again." });
    var fr = await chFriends(me.did);
    if (!fr.length) return res.json({ conversations: [] });
    var pm = {}; (await chPersons(fr)).forEach(function (p) { pm[p.did] = p; });
    var [last] = await pool.execute("SELECT m.sender_did, m.recipient_did, m.body, m.sent_ms FROM messages m JOIN (SELECT conv_key, MAX(id) AS mid FROM messages WHERE sender_did = ? OR recipient_did = ? GROUP BY conv_key) x ON x.mid = m.id ORDER BY m.sent_ms DESC", [me.did, me.did]);
    var out = [];
    last.forEach(function (m) {
      var other = m.sender_did === me.did ? m.recipient_did : m.sender_did;
      if (!pm[other]) return;
      out.push({ person: pm[other], lastMessage: String(m.body).slice(0, 120), lastMessageAt: new Date(Number(m.sent_ms)).toISOString(), lastSenderDid: m.sender_did });
    });
    res.set("Cache-Control", "no-store");
    res.json({ conversations: out });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load conversations." }); }
});
app.get(["/chat/with/:did", "/api/chat/with/:did"], async function (req, res) {
  try {
    var me = await spMe(req);
    if (!me) return res.status(401).json({ error: "Please sign in again." });
    var other = String(req.params.did || "");
    if (!SP_DID.test(other)) return res.status(400).json({ error: "Invalid DID" });
    if (!(await chIsFriend(me.did, other))) return res.status(403).json({ error: "You can chat only with friends." });
    var key = chKey(me.did, other), rows;
    if (req.query.after !== undefined) {
      var after = Date.parse(String(req.query.after || "")); if (!isFinite(after)) after = 0;
      [rows] = await pool.execute("SELECT * FROM messages WHERE conv_key = ? AND sent_ms >= ? ORDER BY id ASC LIMIT 200", [key, after]);
    } else {
      [rows] = await pool.execute("SELECT * FROM (SELECT * FROM messages WHERE conv_key = ? ORDER BY id DESC LIMIT 200) t ORDER BY id ASC", [key]);
    }
    res.set("Cache-Control", "no-store");
    res.json({ messages: rows.map(chMsg), hiddenMessageIds: [] });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load messages." }); }
});
app.post(["/chat/with/:did/messages", "/api/chat/with/:did/messages"], async function (req, res) {
  try {
    var me = await spMe(req);
    if (!me) return res.status(401).json({ error: "Please sign in again." });
    var to = String(req.params.did || "");
    if (!SP_DID.test(to) || to === me.did) return res.status(400).json({ error: "Invalid DID" });
    if (!(await chIsFriend(me.did, to))) return res.status(403).json({ error: "You can message only friends. Send a follow request and wait until it is accepted." });
    var text = String((req.body || {}).text || "").trim();
    if (!text) return res.status(400).json({ error: "Message is empty." });
    if (text.length > 4000) return res.status(400).json({ error: "Message is too long." });
    var mid = String((req.body || {}).clientMessageId || "").replace(/[^\w.\-]/g, "").slice(0, 64) || crypto.randomBytes(12).toString("hex");
    var [ex] = await pool.execute("SELECT * FROM messages WHERE sender_did = ? AND message_id = ?", [me.did, mid]);
    var row = ex[0];
    if (!row) {
      await pool.execute("INSERT INTO messages (message_id, conv_key, sender_did, recipient_did, body, sent_ms) VALUES (?,?,?,?,?,?)", [mid, chKey(me.did, to), me.did, to, text, Date.now()]);
      var [nr] = await pool.execute("SELECT * FROM messages WHERE sender_did = ? AND message_id = ?", [me.did, mid]);
      row = nr[0];
      var ev = { type: "notify", notifType: "chat_message", message: chMsg(row) };
      chPush(to, ev); chPush(me.did, ev);
    }
    res.status(201).json({ message: chMsg(row) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Message could not be sent." }); }
});
app.post(["/chat/with/:did/typing", "/api/chat/with/:did/typing"], async function (req, res) {
  try {
    var me = await spMe(req);
    if (!me) return res.status(401).json({ error: "Please sign in again." });
    var to = String(req.params.did || "");
    if (!SP_DID.test(to) || !(await chIsFriend(me.did, to))) return res.status(403).json({ error: "Friends only." });
    chPush(to, { type: "notify", notifType: "chat_typing", active: (req.body || {}).active === true, senderDid: me.did });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Failed." }); }
});
app.post(["/chat/with/:did/read", "/api/chat/with/:did/read"], async function (req, res) {
  try {
    var me = await spMe(req);
    if (!me) return res.status(401).json({ error: "Please sign in again." });
    var other = String(req.params.did || "");
    if (!SP_DID.test(other) || !(await chIsFriend(me.did, other))) return res.status(403).json({ error: "Friends only." });
    var ids = ((req.body || {}).messageIds || []).map(String).slice(0, 200);
    if (ids.length) {
      var now = Date.now();
      var [u] = await pool.query("UPDATE messages SET read_ms = ? WHERE recipient_did = ? AND sender_did = ? AND message_id IN (?) AND read_ms IS NULL", [now, me.did, other, ids]);
      if (u.affectedRows) ids.forEach(function (id) { chPush(other, { type: "notify", notifType: "chat_read", readerDid: me.did, messageId: id, readAt: new Date(now).toISOString() }); });
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Failed." }); }
});


app.post(["/auth/register", "/api/auth/register"], async (req, res) => {
  try {
    var { name, email, password } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: "name, email, password required" });
    email = String(email).toLowerCase().trim();
    var did = makeDid();
    var spaceId = makeSpaceId(did);
    var hash = await bcrypt.hash(password, 10);
    var dwnDir = path.join(__dirname, "../../DWN", spaceId); if (!fs.existsSync(dwnDir)) fs.mkdirSync(dwnDir, { recursive: true }); fs.writeFileSync(path.join(dwnDir, "profile.json"), JSON.stringify({ did, space_id: spaceId, name, email, created: new Date().toISOString() })); var [r] = await pool.execute("INSERT INTO users (name, email, password_hashed, did, space_id) VALUES (?,?,?,?,?)", [name, email, hash, did, spaceId]);
    if (mailReady()) { sendVerifyMail({ id: r.insertId, name: name, email: email }).catch(function (me) { console.error("verify mail failed:", me.message); }); return res.status(201).json({ message: "Account created. Please check your email to verify.", email: email, emailVerificationRequired: true, did: did, space_id: spaceId, deviceToken: jwt.sign({ id: r.insertId, did: did }, JWT_SECRET + ":devreg", { expiresIn: "15m" }) }); }
    await pool.execute("UPDATE users SET email_verified = 1 WHERE id = ?", [r.insertId]);
    var token = jwt.sign({ id: r.insertId, email, did, space_id: spaceId }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ message: "Registered successfully", id: r.insertId, name, email, did, space_id: spaceId, token });
  } catch (e) { if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Email already registered" }); console.error(e); res.status(500).json({ error: e.message }); }
});
app.post(["/auth/login", "/api/auth/login"], async (req, res) => {
  try {
    var { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email, password required" });
    var [rows] = await pool.execute("SELECT * FROM users WHERE email = ?", [String(email).toLowerCase().trim()]);
    if (!rows.length) return res.status(401).json({ error: "Invalid email" });
    var u = rows[0];
    var ok = await bcrypt.compare(password, u.password_hashed);
    if (!ok) return res.status(401).json({ error: "Invalid password" });
    if (mailReady() && !u.email_verified) return res.status(403).json({ error: "Please verify your email before logging in.", emailVerificationRequired: true, email: u.email });
    var token = jwt.sign({ id: u.id, email: u.email, did: u.did, space_id: u.space_id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, id: u.id, name: u.name, email: u.email, did: u.did, space_id: u.space_id, dwn: { spaceId: u.space_id, did: u.did } });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.get(["/auth/me", "/api/auth/me"], async (req, res) => {
  try {
    var h = req.headers.authorization || "";
    var t = h.replace("Bearer ", "");
    if (!t) return res.status(401).json({ error: "No token" });
    var d = jwt.verify(t, JWT_SECRET);
    var [rows] = await pool.execute("SELECT id, name, email, did, space_id, timestamp FROM users WHERE id = ?", [d.id]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (e) { res.status(401).json({ error: "Invalid token" }); }
});
/* MILAN-PROFILE-AVATAR */
function dwnSpaceDir(d) {
  if (!d || !/^space-[0-9a-f]{24}$/.test(String(d.space_id || ""))) return null;
  return path.join(__dirname, "../../DWN", d.space_id);
}
function authFromReq(req, res) {
  try {
    var t = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!t) { res.status(401).json({ error: "No token" }); return null; }
    var d = jwt.verify(t, JWT_SECRET);
    if (!dwnSpaceDir(d)) { res.status(400).json({ error: "Invalid space" }); return null; } ensureComponents(dwnSpaceDir(d));
    return d;
  } catch (e) { res.status(401).json({ error: "Invalid token" }); return null; }
}
function readAvatarRecord(dir) {
  try {
    var meta = JSON.parse(fs.readFileSync(path.join(dir, "dp", "avatar.meta.json"), "utf8"));
    var bin = fs.readFileSync(path.join(dir, "dp", "avatar.bin"));
    if (!meta.recordId || !bin.length) return null;
    return { recordId: meta.recordId, avatar: "data:" + meta.mime + ";base64," + bin.toString("base64") };
  } catch (e) { return null; }
}
async function profileView(d) {
  var u = {};
  try { var r = await pool.execute("SELECT name, email FROM users WHERE id = ?", [d.id]); u = r[0][0] || {}; } catch (e) {}
  var a = readAvatarRecord(dwnSpaceDir(d));
  var p = { name: u.name || "", email: u.email || d.email || "", did: d.did, spaceId: d.space_id,
    avatar: a ? a.avatar : "", avatarRecordId: a ? a.recordId : "", avatarSync: a ? "synced" : "none" };
  return Object.assign({}, p, { profile: p });
}
function parseMultipart(buf, ctype) {
  var m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype || "");
  if (!m) return null;
  var b = Buffer.from("--" + String(m[1] || m[2]).trim());
  var out = { fields: {}, files: {} };
  var pos = buf.indexOf(b);
  while (pos !== -1) {
    var next = buf.indexOf(b, pos + b.length);
    if (next === -1) break;
    var part = buf.slice(pos + b.length + 2, next - 2);
    var sep = part.indexOf("\r\n\r\n");
    if (sep !== -1) {
      var head = part.slice(0, sep).toString("utf8");
      var body = part.slice(sep + 4);
      var nm = /name="([^"]*)"/i.exec(head);
      var fn = /filename="([^"]*)"/i.exec(head);
      var ct = /content-type:\s*([^\r\n]+)/i.exec(head);
      if (nm) {
        if (fn) out.files[nm[1]] = { buf: body, type: ct ? ct[1].trim() : "" };
        else out.fields[nm[1]] = body.toString("utf8");
      }
    }
    pos = next;
  }
  return out;
}
app.get("/api/profile", async (req, res) => {
  var d = authFromReq(req, res); if (!d) return;
  res.set("Cache-Control", "no-store");
  res.json(await profileView(d));
});
app.put("/api/profile", express.raw({ type: "multipart/form-data", limit: "3mb" }), async (req, res) => {
  var d = authFromReq(req, res); if (!d) return;
  try {
    var dir = dwnSpaceDir(d);
    if (Buffer.isBuffer(req.body)) {
      var mp = parseMultipart(req.body, req.headers["content-type"]);
      var f = mp && mp.files.avatar;
      if (f) {
        if (!/^image\/(jpeg|png|webp|gif)$/i.test(f.type) || !f.buf.length || f.buf.length > 900000) {
          return res.status(400).json({ error: "Invalid image (jpeg/png/webp/gif, max 900KB)" });
        }
        fs.mkdirSync(path.join(dir, "dp"), { recursive: true });
        var qerr = checkQuota(dir, f.buf.length, fileSize(path.join(dir, "dp", "avatar.bin"))); if (qerr) return res.status(qerr.code).json(qerr.body);
        var recordId = "avatar-" + crypto.randomBytes(12).toString("hex");
        fs.writeFileSync(path.join(dir, "dp", "avatar.bin"), f.buf);
        fs.writeFileSync(path.join(dir, "dp", "avatar.meta.json"), JSON.stringify({ recordId: recordId, mime: f.type.toLowerCase(), bytes: f.buf.length, updatedAt: new Date().toISOString() }));
      }
    }
    var view = await profileView(d);
    res.json(Object.assign({ ok: true }, view));
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.delete("/api/profile/avatar", async (req, res) => {
  var d = authFromReq(req, res); if (!d) return;
  try {
    var dir = dwnSpaceDir(d);
    ["avatar.bin", "avatar.meta.json"].forEach(function (n) { try { fs.unlinkSync(path.join(dir, "dp", n)); } catch (e) {} });
    var view = await profileView(d);
    res.json(Object.assign({ ok: true }, view));
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

/* MILAN-DWN-QUOTA */
var DWN_QUOTA_BYTES = 1610612736;
var DISK_GUARD_PCT = 90;
function dirSize(dir) {
  var total = 0;
  try {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      var q = path.join(dir, e.name);
      if (e.isDirectory()) total += dirSize(q);
      else if (e.isFile()) { try { total += fs.statSync(q).size; } catch (x) {} }
    });
  } catch (x) {}
  return total;
}
function fileSize(q) { try { return fs.statSync(q).size; } catch (e) { return 0; } }
function diskUsedPct() {
  try {
    if (typeof fs.statfsSync !== "function") return null;
    var s = fs.statfsSync(__dirname);
    return Math.round((1 - s.bavail / s.blocks) * 100);
  } catch (e) { return null; }
}
function storageSummary(dir) {
  var used = dirSize(dir);
  return { usedBytes: used, quotaBytes: DWN_QUOTA_BYTES, freeBytes: Math.max(0, DWN_QUOTA_BYTES - used), percent: Math.round(used * 1000 / DWN_QUOTA_BYTES) / 10 };
}
function checkQuota(dir, addBytes, replaceBytes) {
  var pct = diskUsedPct();
  if (pct !== null && pct >= DISK_GUARD_PCT) {
    return { code: 507, body: { error: "Server storage is almost full. Uploads are paused.", diskUsedPercent: pct } };
  }
  var used = dirSize(dir);
  if (used - (replaceBytes || 0) + addBytes > DWN_QUOTA_BYTES) {
    return { code: 413, body: { error: "Storage quota exceeded", usedBytes: used, quotaBytes: DWN_QUOTA_BYTES, upgrade: "/storage-upgrade.html" } };
  }
  return null;
}
function safeFileName(n) {
  n = String(n || "");
  return /^[A-Za-z0-9._-]{1,100}$/.test(n) && n.charAt(0) !== "." ? n : null;
}
app.get("/api/storage", function (req, res) {
  var d = authFromReq(req, res); if (!d) return;
  var dir = dwnSpaceDir(d);
  var files = [];
  try {
    fs.readdirSync(path.join(dir, "posts")).forEach(function (n) {
      try { var st = fs.statSync(path.join(dir, "posts", n)); if (st.isFile()) files.push({ name: n, bytes: st.size, updatedAt: st.mtime.toISOString() }); } catch (x) {}
    });
  } catch (x) {}
  res.set("Cache-Control", "no-store");
  res.json(Object.assign(storageSummary(dir), { components: { dp: { bytes: dirSize(path.join(dir, "dp")) }, posts: { bytes: dirSize(path.join(dir, "posts")), count: files.length }, payments: { bytes: dirSize(path.join(dir, "payments")) } }, avatarBytes: fileSize(path.join(dir, "dp", "avatar.bin")), files: files }));
});
app.post("/api/dwn/files", express.raw({ type: "application/octet-stream", limit: "100mb" }), function (req, res) {
  var d = authFromReq(req, res); if (!d) return;
  try {
    var name = safeFileName(req.query.name);
    if (!name) return res.status(400).json({ error: "Invalid file name (letters, digits, . _ - only, max 100)" });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Send the file as application/octet-stream" });
    var dir = dwnSpaceDir(d);
    var target = path.join(dir, "posts", name);
    var qerr = checkQuota(dir, req.body.length, fileSize(target));
    if (qerr) return res.status(qerr.code).json(qerr.body);
    fs.mkdirSync(path.join(dir, "posts"), { recursive: true });
    fs.writeFileSync(target, req.body);
    res.json(Object.assign({ ok: true, name: name, bytes: req.body.length }, storageSummary(dir)));
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.delete("/api/dwn/files/:name", function (req, res) {
  var d = authFromReq(req, res); if (!d) return;
  try {
    var name = safeFileName(req.params.name);
    if (!name) return res.status(400).json({ error: "Invalid file name" });
    var dir = dwnSpaceDir(d);
    var target = path.join(dir, "posts", name);
    if (!fs.existsSync(target)) return res.status(404).json({ error: "File not found" });
    fs.unlinkSync(target);
    res.json(Object.assign({ ok: true, deleted: name }, storageSummary(dir)));
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

/* MILAN-STORAGE-COMPONENTS */
var STORAGE_COMPONENTS = ["dp", "posts", "payments"];
function ensureComponents(dir) {
  try {
    STORAGE_COMPONENTS.forEach(function (c) { fs.mkdirSync(path.join(dir, c), { recursive: true }); });
    ["avatar.bin", "avatar.meta.json"].forEach(function (n) {
      var o = path.join(dir, n), t = path.join(dir, "dp", n);
      if (fs.existsSync(o) && !fs.existsSync(t)) fs.renameSync(o, t);
    });
    var lf = path.join(dir, "files");
    if (fs.existsSync(lf) && fs.statSync(lf).isDirectory()) {
      fs.readdirSync(lf).forEach(function (n) {
        var o = path.join(lf, n), t = path.join(dir, "posts", n);
        if (!fs.existsSync(t)) fs.renameSync(o, t);
      });
      try { fs.rmdirSync(lf); } catch (x) {}
    }
  } catch (e) { console.error("ensureComponents:", e.message); }
}
(function migrateAllSpaces() {
  try {
    var root = path.join(__dirname, "../../DWN");
    fs.readdirSync(root).forEach(function (n) {
      if (/^space-[0-9a-f]{24}$/.test(n)) ensureComponents(path.join(root, n));
    });
  } catch (e) {}
})();

/* MILAN-ID3-PASSKEY */
var PK_RP_ID = "milanlife.in";
var PK_RP_NAME = "MILAN";
var PK_ORIGINS = ["https://milanlife.in", "https://www.milanlife.in"];
var pkChallenges = new Map();
var pkLibPromise = null;
function pkLib() { if (!pkLibPromise) pkLibPromise = import("@simplewebauthn/server"); return pkLibPromise; }
function pkPut(key) {
  var now = Date.now();
  pkChallenges.forEach(function (v, k) { if (now - v > 300000) pkChallenges.delete(k); });
  pkChallenges.set(key, now);
}
function pkTake(key) {
  var t = pkChallenges.get(key);
  pkChallenges.delete(key);
  return !!t && Date.now() - t <= 300000;
}
function pkUser(req, res) {
  try {
    var t = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!t) { res.status(401).json({ error: "No token" }); return null; }
    return jwt.verify(t, JWT_SECRET);
  } catch (e) { res.status(401).json({ error: "Invalid token" }); return null; }
}
function pkSplit(t) { return t ? String(t).split(",").filter(Boolean) : undefined; }

app.get(["/did/passkey/status", "/api/did/passkey/status"], async function (req, res) {
  var d = pkUser(req, res); if (!d) return;
  try {
    var [rows] = await pool.execute("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?", [d.id]);
    res.set("Cache-Control", "no-store");
    res.json({ registered: rows[0].n > 0, count: Number(rows[0].n) });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get(["/did/passkey/register/options", "/api/did/passkey/register/options"], async function (req, res) {
  var d = pkUser(req, res); if (!d) return;
  try {
    var lib = await pkLib();
    var [ur] = await pool.execute("SELECT id, name, email, did FROM users WHERE id = ?", [d.id]);
    if (!ur.length) return res.status(404).json({ error: "User not found" });
    var u = ur[0];
    var [cr] = await pool.execute("SELECT credential_id, transports FROM passkeys WHERE user_id = ?", [u.id]);
    var options = await lib.generateRegistrationOptions({
      rpName: PK_RP_NAME, rpID: PK_RP_ID,
      userID: new Uint8Array(Buffer.from(String(u.did || "user-" + u.id))),
      userName: u.email, userDisplayName: u.name || u.email,
      attestationType: "none",
      excludeCredentials: cr.map(function (c) { return { id: c.credential_id, transports: pkSplit(c.transports) }; }),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" }
    });
    pkPut("reg:" + u.id + ":" + options.challenge);
    res.set("Cache-Control", "no-store");
    res.json(options);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post(["/did/passkey/register/verify", "/api/did/passkey/register/verify"], async function (req, res) {
  var d = pkUser(req, res); if (!d) return;
  try {
    var lib = await pkLib();
    var body = req.body || {};
    var challenge = null;
    try { challenge = JSON.parse(Buffer.from(body.response.clientDataJSON, "base64url").toString("utf8")).challenge; } catch (x) {}
    if (!challenge || !pkTake("reg:" + d.id + ":" + challenge)) return res.status(400).json({ error: "Registration expired. Try again.", verified: false });
    var v = await lib.verifyRegistrationResponse({ response: body, expectedChallenge: challenge, expectedOrigin: PK_ORIGINS, expectedRPID: PK_RP_ID, requireUserVerification: false });
    if (!v.verified || !v.registrationInfo) return res.status(400).json({ error: "ID3 registration was not verified.", verified: false });
    var ci = v.registrationInfo.credential;
    var tr = (ci.transports || (body.response && body.response.transports) || []).join(",");
    await pool.execute("INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports) VALUES (?,?,?,?,?)", [d.id, ci.id, Buffer.from(ci.publicKey).toString("base64url"), ci.counter || 0, tr]);
    res.json({ verified: true });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "This passkey is already registered.", verified: false });
    console.error(e); res.status(400).json({ error: e.message, verified: false });
  }
});

app.get(["/did/passkey/login/options", "/api/did/passkey/login/options"], async function (req, res) {
  try {
    if (pkChallenges.size > 5000) return res.status(429).json({ error: "Too many requests" });
    var [c] = await pool.execute("SELECT COUNT(*) AS n FROM passkeys");
    if (!Number(c[0].n)) return res.status(409).json({ error: "No ID3 credentials yet" });
    var lib = await pkLib();
    var options = await lib.generateAuthenticationOptions({ rpID: PK_RP_ID, userVerification: "preferred" });
    pkPut("auth:" + options.challenge);
    res.set("Cache-Control", "no-store");
    res.json(options);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post(["/did/passkey/login/verify", "/api/did/passkey/login/verify"], async function (req, res) {
  try {
    var lib = await pkLib();
    var body = req.body || {};
    var challenge = null;
    try { challenge = JSON.parse(Buffer.from(body.response.clientDataJSON, "base64url").toString("utf8")).challenge; } catch (x) {}
    if (!body.id || !challenge || !pkTake("auth:" + challenge)) return res.status(400).json({ error: "Login expired. Try again." });
    var [rows] = await pool.execute("SELECT p.id AS pid, p.user_id, p.credential_id, p.public_key, p.counter, p.transports, u.name, u.email, u.did, u.space_id FROM passkeys p JOIN users u ON u.id = p.user_id WHERE p.credential_id = ?", [body.id]);
    if (!rows.length) return res.status(401).json({ error: "This ID3 credential is not registered with MILAN" });
    var p = rows[0];
    var v = await lib.verifyAuthenticationResponse({
      response: body, expectedChallenge: challenge, expectedOrigin: PK_ORIGINS, expectedRPID: PK_RP_ID,
      credential: { id: p.credential_id, publicKey: new Uint8Array(Buffer.from(p.public_key, "base64url")), counter: Number(p.counter) || 0, transports: pkSplit(p.transports) },
      requireUserVerification: false
    });
    if (!v.verified) return res.status(401).json({ error: "ID3 verification failed" });
    await pool.execute("UPDATE passkeys SET counter = ?, last_used_at = NOW() WHERE id = ?", [v.authenticationInfo.newCounter || 0, p.pid]);
    var token = jwt.sign({ id: p.user_id, email: p.email, did: p.did, space_id: p.space_id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token: token, id: p.user_id, name: p.name, email: p.email, did: p.did, space_id: p.space_id, dwn: { spaceId: p.space_id, did: p.did } });
  } catch (e) { console.error(e); res.status(401).json({ error: e.message || "ID3 login failed" }); }
});

/* MILAN-DID-DEVICE */
var dvChallenges = new Map();
function dvPut(nonce, did) {
  var n = Date.now();
  dvChallenges.forEach(function (v, k) { if (n - v.t > 120000) dvChallenges.delete(k); });
  dvChallenges.set(nonce, { did: did, t: n });
}
function dvTake(nonce, did) {
  var v = dvChallenges.get(nonce);
  dvChallenges.delete(nonce);
  return !!v && v.did === did && Date.now() - v.t <= 120000;
}
app.post(["/did/device/challenge", "/api/did/device/challenge"], function (req, res) {
  var did = String((req.body || {}).did || "");
  if (!/^did:milan:[0-9a-f]{32}$/.test(did)) return res.status(400).json({ error: "Invalid DID" });
  if (dvChallenges.size > 5000) return res.status(429).json({ error: "Too many requests" });
  var nonce = crypto.randomBytes(24).toString("hex");
  dvPut(nonce, did);
  res.set("Cache-Control", "no-store");
  res.json({ nonce: nonce });
});
app.post(["/did/device/register", "/api/did/device/register"], async function (req, res) {
  try {
    var t = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!t) return res.status(401).json({ error: "No token" });
    var d; try { d = jwt.verify(t, JWT_SECRET); } catch (_e) { d = jwt.verify(t, JWT_SECRET + ":devreg"); }
    var j = (req.body || {}).publicJwk || {};
    if (j.kty !== "EC" || j.crv !== "P-256" || typeof j.x !== "string" || typeof j.y !== "string" || j.x.length > 64 || j.y.length > 64) return res.status(400).json({ error: "Invalid device key" });
    var [ur] = await pool.execute("SELECT id, did FROM users WHERE id = ?", [d.id]);
    if (!ur.length) return res.status(404).json({ error: "User not found" });
    var [cnt] = await pool.execute("SELECT COUNT(*) AS n FROM device_keys WHERE user_id = ?", [d.id]);
    var keyId = crypto.createHash("sha256").update(j.x + "." + j.y).digest("hex").slice(0, 32);
    var [ex] = await pool.execute("SELECT id FROM device_keys WHERE key_id = ?", [keyId]);
    if (!ex.length) {
      if (Number(cnt[0].n) >= 10) return res.status(400).json({ error: "Too many devices registered" });
      await pool.execute("INSERT INTO device_keys (user_id, did, key_id, public_jwk) VALUES (?,?,?,?)", [d.id, ur[0].did, keyId, JSON.stringify({ kty: j.kty, crv: j.crv, x: j.x, y: j.y })]);
    }
    res.json({ ok: true, keyId: keyId });
  } catch (e) { res.status(401).json({ error: "Invalid token" }); }
});
app.post(["/did/device/login", "/api/did/device/login"], async function (req, res) {
  try {
    var b = req.body || {};
    var did = String(b.did || "");
    if (!/^did:milan:[0-9a-f]{32}$/.test(did) || !b.nonce || !b.keyId || !b.signature) return res.status(400).json({ error: "Invalid request" });
    if (!dvTake(String(b.nonce), did)) return res.status(400).json({ error: "Login expired. Try again." });
    var [rows] = await pool.execute("SELECT k.id AS kid, k.public_jwk, u.id, u.name, u.email, u.did, u.space_id FROM device_keys k JOIN users u ON u.id = k.user_id WHERE k.key_id = ? AND u.did = ?", [String(b.keyId), did]);
    if (!rows.length) return res.status(401).json({ error: "This device is not registered for this DID. Sign in with your password once." });
    var u = rows[0];
    var pub = crypto.createPublicKey({ key: JSON.parse(u.public_jwk), format: "jwk" });
    var ok = crypto.verify("sha256", Buffer.from("milan-did-login:" + did + ":" + b.nonce), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(String(b.signature), "base64url"));
    if (!ok) return res.status(401).json({ error: "DID verification failed" });
    await pool.execute("UPDATE device_keys SET last_used_at = NOW() WHERE id = ?", [u.kid]);
    var token = jwt.sign({ id: u.id, email: u.email, did: u.did, space_id: u.space_id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token: token, id: u.id, name: u.name, email: u.email, did: u.did, space_id: u.space_id, dwn: { spaceId: u.space_id, did: u.did } });
  } catch (e) { console.error(e); res.status(401).json({ error: "DID login failed" }); }
});

/* MILAN-EMAIL-AUTH */
var nodemailer = require("nodemailer");
var mailer = null;
var mailThrottle = new Map();
function mailReady() { return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS); }
function appUrl() { return String(process.env.APP_URL || "https://milanlife.in").replace(/\/+$/, ""); }
function throttled(key, ms) {
  var n = Date.now(), t = mailThrottle.get(key);
  if (t && n - t < ms) return true;
  if (mailThrottle.size > 5000) mailThrottle.clear();
  mailThrottle.set(key, n);
  return false;
}
function sha(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }
function safeEq(a, b) { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
async function sendMail(to, subject, m) {
  var port = Number(process.env.SMTP_PORT || 587);
  if (!mailer) mailer = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  await mailer.sendMail({ from: process.env.MAIL_FROM || "MILAN <support@milanlife.in>", to: to, subject: subject, text: m.text, html: m.html });
}
function mailLayout(o) {
  var h = '<div style="background:#0b1220;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">'
    + '<div style="max-width:480px;margin:0 auto;background:#111a2e;border:1px solid #223049;border-radius:16px;padding:28px;color:#e6ebf5">'
    + '<div style="font-size:22px;font-weight:800;letter-spacing:.04em;color:#fbbf24">MILAN</div>'
    + '<h2 style="margin:18px 0 8px;font-size:18px;color:#ffffff">' + esc(o.title) + '</h2>'
    + '<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#b8c3d9">' + esc(o.intro) + '</p>'
    + '<p style="margin:0 0 22px"><a href="' + esc(o.link) + '" style="display:inline-block;background:#f59e0b;color:#17111d;text-decoration:none;font-weight:800;font-size:14px;padding:12px 22px;border-radius:12px">' + esc(o.button) + '</a></p>'
    + '<p style="margin:0 0 6px;font-size:13px;color:#b8c3d9">Or enter this 6-digit code:</p>'
    + '<p style="margin:0 0 22px;font-size:28px;font-weight:800;letter-spacing:.3em;color:#ffffff">' + esc(o.code) + '</p>'
    + '<p style="margin:0;font-size:12px;line-height:1.6;color:#8997b2">' + esc(o.note) + '</p></div>'
    + '<p style="text-align:center;font-size:11px;color:#6b7a96;margin:14px 0 0">MILAN &middot; milanlife.in &middot; support@milanlife.in</p></div>';
  var t = o.title + "\n\n" + o.intro + "\n\n" + o.button + ": " + o.link + "\n\nOr enter this 6-digit code: " + o.code + "\n\n" + o.note + "\n\n- MILAN (milanlife.in)";
  return { html: h, text: t };
}
async function issueToken(userId, purpose, ttlSec) {
  var token = crypto.randomBytes(32).toString("hex");
  var code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await pool.execute("UPDATE email_tokens SET used_at = NOW() WHERE user_id = ? AND purpose = ? AND used_at IS NULL", [userId, purpose]);
  await pool.execute("INSERT INTO email_tokens (user_id, purpose, token_hash, code_hash, expires_at) VALUES (?,?,?,?, DATE_ADD(NOW(), INTERVAL " + Number(ttlSec) + " SECOND))", [userId, purpose, sha(token), sha(code + ":" + userId)]);
  return { token: token, code: code };
}
async function consumeToken(email, purpose, token, code) {
  var [ur] = await pool.execute("SELECT id, name, email FROM users WHERE email = ?", [email]);
  if (!ur.length) return null;
  var u = ur[0];
  var [rows] = await pool.execute("SELECT id, token_hash, code_hash, attempts FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1", [u.id, purpose]);
  if (!rows.length) return null;
  var r = rows[0];
  if (Number(r.attempts) >= 5) return null;
  var ok = token ? safeEq(r.token_hash, sha(token)) : safeEq(r.code_hash, sha(String(code).trim() + ":" + u.id));
  if (!ok) { await pool.execute("UPDATE email_tokens SET attempts = attempts + 1 WHERE id = ?", [r.id]); return null; }
  await pool.execute("UPDATE email_tokens SET used_at = NOW() WHERE id = ?", [r.id]);
  return u;
}
async function sendVerifyMail(u) {
  var t = await issueToken(u.id, "verify", 86400);
  var link = appUrl() + "/verify-email.html?email=" + encodeURIComponent(u.email) + "&token=" + t.token;
  var m = mailLayout({ title: "Verify your email", intro: "Hi " + (u.name || "there") + ", welcome to MILAN! Tap the button below to confirm your email address and activate your account.", button: "Verify my email", link: link, code: t.code, note: "This link and code expire in 24 hours. If you did not create a MILAN account, you can safely ignore this email." });
  await sendMail(u.email, "Verify your MILAN account", m);
}
async function sendResetMail(u) {
  var t = await issueToken(u.id, "reset", 3600);
  var link = appUrl() + "/reset-password.html?email=" + encodeURIComponent(u.email) + "&token=" + t.token;
  var m = mailLayout({ title: "Reset your password", intro: "Hi " + (u.name || "there") + ", we received a request to reset your MILAN password. Tap the button below to choose a new one.", button: "Reset my password", link: link, code: t.code, note: "This link and code expire in 1 hour. If you did not request this, you can safely ignore this email; your password will not change." });
  await sendMail(u.email, "Reset your MILAN password", m);
}
app.post(["/auth/verify-email", "/api/auth/verify-email"], async function (req, res) {
  try {
    var b = req.body || {};
    var email = String(b.email || "").toLowerCase().trim();
    if (!email || (!b.token && !b.code)) return res.status(400).json({ error: "Email and code are required." });
    var u = await consumeToken(email, "verify", b.token, b.code);
    if (!u) return res.status(400).json({ error: "This link or code is invalid or has expired. Request a new one." });
    await pool.execute("UPDATE users SET email_verified = 1 WHERE id = ?", [u.id]);
    res.json({ ok: true, verified: true, message: "Email verified. You can now log in." });
  } catch (e) { console.error(e); res.status(500).json({ error: "Verification failed. Try again." }); }
});
app.post(["/auth/resend-verification", "/api/auth/resend-verification"], async function (req, res) {
  try {
    var email = String((req.body || {}).email || "").toLowerCase().trim();
    if (!email || email.length > 255) return res.status(400).json({ error: "Enter your email address." });
    if (throttled("rv:" + email, 60000)) return res.status(429).json({ error: "Please wait a minute before requesting again." });
    if (mailReady()) {
      var [rows] = await pool.execute("SELECT id, name, email, email_verified FROM users WHERE email = ?", [email]);
      if (rows.length && !rows[0].email_verified) sendVerifyMail(rows[0]).catch(function (e) { console.error("verify mail failed:", e.message); });
    }
    res.json({ message: "If that account exists, a verification email has been sent." });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not process the request. Try again." }); }
});
app.post(["/auth/forgot-password", "/api/auth/forgot-password"], async function (req, res) {
  try {
    var email = String((req.body || {}).email || "").toLowerCase().trim();
    if (!email || email.length > 255) return res.status(400).json({ error: "Enter your email address." });
    if (throttled("fp:" + email, 60000)) return res.status(429).json({ error: "Please wait a minute before requesting again." });
    if (mailReady()) {
      var [rows] = await pool.execute("SELECT id, name, email FROM users WHERE email = ?", [email]);
      if (rows.length) sendResetMail(rows[0]).catch(function (e) { console.error("reset mail failed:", e.message); });
    } else { console.error("forgot-password: SMTP not configured"); }
    res.json({ message: "If that account exists, a reset email has been sent. Check your inbox." });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not process the request. Try again." }); }
});
app.post(["/auth/reset-password", "/api/auth/reset-password"], async function (req, res) {
  try {
    var b = req.body || {};
    var email = String(b.email || "").toLowerCase().trim();
    var password = String(b.password || "");
    if (!email || (!b.token && !b.code)) return res.status(400).json({ error: "Email and code are required." });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    var u = await consumeToken(email, "reset", b.token, b.code);
    if (!u) return res.status(400).json({ error: "This link or code is invalid or has expired. Request a new one." });
    var hash = await bcrypt.hash(password, 10);
    await pool.execute("UPDATE users SET password_hashed = ?, email_verified = 1 WHERE id = ?", [hash, u.id]);
    await pool.execute("UPDATE email_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL", [u.id]);
    res.json({ ok: true, message: "Password updated. You can now log in." });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not reset the password. Try again." }); }
});

require("./milan_follow.js")(app, pool, authFromReq, dwnSpaceDir, path, fs);
require("./milan_posts.js")(app, pool, dwnSpaceDir, path, fs, checkQuota);
app.get("*", (req, res) => {
  var f = path.join(__dirname, "../../frontend", req.path === "/" ? "index.html" : req.path);
  if (!fs.existsSync(f) && fs.existsSync(f + ".html")) f = f + ".html";
  if (fs.existsSync(f) && fs.statSync(f).isFile()) return res.sendFile(f);
  res.sendFile(path.join(__dirname, "../../frontend/index.html"));
});
var PORT = Number(process.env.PORT || 5001);
app.listen(PORT, () => console.log("MILAN running at http://localhost:" + PORT));
module.exports = app;
