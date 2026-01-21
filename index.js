// index.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

/* ===== 設定 ===== */
const LOCAL_FILE = "messages.json";

const {
  ENTRY_PASSWORD,
  ADMIN_PASSWORD,
  GITHUB_TOKEN,
  GITHUB_REPO,
  GITHUB_FILE,
  SECRET_KEY
} = process.env;

if (!SECRET_KEY || SECRET_KEY.length < 32) {
  throw new Error("SECRET_KEY must be 32+ chars");
}

/* ===== メモリ ===== */
let users = {};
let messages = [];

/* ===== 暗号化 ===== */
function encrypt(data) {
  const iv = crypto.randomBytes(16);
  const key = crypto.createHash("sha256").update(SECRET_KEY).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const enc = Buffer.concat([
    cipher.update(JSON.stringify(data), "utf8"),
    cipher.final()
  ]);

  return JSON.stringify({
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: enc.toString("hex")
  });
}

function decrypt(enc) {
  const obj = JSON.parse(enc);
  const key = crypto.createHash("sha256").update(SECRET_KEY).digest();

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(obj.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(obj.tag, "hex"));

  const dec = Buffer.concat([
    decipher.update(Buffer.from(obj.data, "hex")),
    decipher.final()
  ]);

  return JSON.parse(dec.toString("utf8"));
}

/* ===== GitHub API ===== */
async function githubRequest(method, body) {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json"
      },
      body: body ? JSON.stringify(body) : undefined
    }
  );
  return res.ok ? res.json() : null;
}

/* ===== GitHub → 復元 ===== */
async function restoreFromGitHub() {
  const file = await githubRequest("GET");
  if (!file?.content) return;

  const decoded = Buffer.from(file.content, "base64").toString();
  messages = decrypt(decoded);

  fs.writeFileSync(LOCAL_FILE, JSON.stringify(messages, null, 2));
  console.log("Restored from GitHub");
}

/* ===== GitHub ← バックアップ ===== */
async function backupToGitHub() {
  const encrypted = encrypt(messages);
  const file = await githubRequest("GET");

  await githubRequest("PUT", {
    message: "backup messages",
    content: Buffer.from(encrypted).toString("base64"),
    sha: file?.sha
  });

  console.log("Backup to GitHub complete");
}

/* ===== 起動処理 ===== */
(async () => {
  if (fs.existsSync(LOCAL_FILE)) {
    messages = JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));
  } else {
    await restoreFromGitHub();
  }
})();

/* ===== 認証 ===== */
app.post("/auth", (req, res) => {
  res.json({ ok: req.body.password === ENTRY_PASSWORD });
});

/* ===== socket.io ===== */
io.on("connection", (socket) => {
  socket.emit("history", messages);

  socket.on("userJoin", (user) => {
    users[socket.id] = user;
    io.emit("userList", Object.values(users));
  });

  socket.on("chat message", (msg) => {
    messages.push(msg);
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(messages, null, 2));
    io.emit("chat message", msg);
  });

  socket.on("requestDelete", (id) => {
    messages = messages.filter(m => m.id !== id);
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(messages, null, 2));
    io.emit("delete message", id);
  });

  socket.on("adminClearAll", async (password) => {
    if (password !== ADMIN_PASSWORD) return;
    messages = [];
    fs.writeFileSync(LOCAL_FILE, "[]");
    await backupToGitHub();
    io.emit("clearAllMessages");
  });

  socket.on("disconnect", async () => {
    delete users[socket.id];
    io.emit("userList", Object.values(users));

    // ★ 誰もいなくなった瞬間バックアップ
    if (Object.keys(users).length === 0) {
      await backupToGitHub();
    }
  });
});

/* ===== 起動 ===== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on", PORT);
});
