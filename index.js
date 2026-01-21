// index.js
const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const crypto = require("crypto");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

app.use(express.static("public"));
app.use(express.json());

/* ===== 設定 ===== */
const MAX_MESSAGES = 100;
const {
  GITHUB_TOKEN,
  GITHUB_REPO,
  GITHUB_FILE,
  ENTRY_PASSWORD,
  ADMIN_PASSWORD,
  SECRET_KEY
} = process.env;

const users = {};

/* ===== 暗号化 ===== */
const ALGO = "aes-256-gcm";
const KEY = crypto.createHash("sha256").update(SECRET_KEY).digest();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(data) {
  const buf = Buffer.from(data, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const text = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(text, null, "utf8") + decipher.final("utf8");
}

/* ===== GitHub API ===== */
const GH_API = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`;

async function loadMessages() {
  try {
    const r = await fetch(GH_API, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      }
    });

    if (r.status === 404) return [];

    const j = await r.json();
    const decrypted = decrypt(Buffer.from(j.content, "base64").toString());
    return JSON.parse(decrypted);
  } catch (e) {
    console.error("loadMessages error:", e);
    return [];
  }
}

async function saveMessages(data) {
  const encrypted = encrypt(JSON.stringify(data));
  const content = Buffer.from(encrypted).toString("base64");

  let sha = null;
  const r = await fetch(GH_API, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}` }
  });
  if (r.ok) sha = (await r.json()).sha;

  await fetch(GH_API, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: "update messages",
      content,
      sha
    })
  });
}

/* ===== 入室認証 ===== */
app.post("/auth", (req, res) => {
  res.json({ ok: req.body.password === ENTRY_PASSWORD });
});

/* ===== socket.io ===== */
io.on("connection", async (socket) => {
  socket.emit("history", await loadMessages());

  socket.on("userJoin", (u) => {
    users[socket.id] = u;
    io.emit("userList", Object.values(users));
  });

  socket.on("chat message", async (msg) => {
    let data = await loadMessages();
    data.push(msg);
    if (data.length > MAX_MESSAGES) {
      data = data.slice(-MAX_MESSAGES);
    }
    await saveMessages(data);
    io.emit("chat message", msg);
  });

  socket.on("requestDelete", async (id) => {
    let data = await loadMessages();
    data = data.filter(m => m.id !== id);
    await saveMessages(data);
    io.emit("delete message", id);
  });

  socket.on("adminClearAll", async (pw) => {
    if (pw !== ADMIN_PASSWORD) return;
    await saveMessages([]);
    io.emit("clearAllMessages");
  });

  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("userList", Object.values(users));
  });
});

/* ===== 起動 ===== */
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("Server running:", PORT));
