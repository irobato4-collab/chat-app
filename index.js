const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const fetch = (...args) => import("node-fetch").then(m => m.default(...args));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

/* =====================
   設定
===================== */
const FILE = path.join(__dirname, "messages.json");

const {
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_FILE,
  GITHUB_BRANCH = "main",
  SECRET_KEY,
  ENTRY_PASSWORD,
  ADMIN_PASSWORD
} = process.env;

const users = {}; // socket.id -> user

/* =====================
   暗号化 & 復号
===================== */
function encrypt(buffer) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(SECRET_KEY).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function decrypt(buffer) {
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const data = buffer.subarray(28);
  const key = crypto.createHash("sha256").update(SECRET_KEY).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

/* =====================
   gzip
===================== */
const gzip = buf => new Promise((r, j) =>
  zlib.gzip(buf, (e, d) => e ? j(e) : r(d))
);
const gunzip = buf => new Promise((r, j) =>
  zlib.gunzip(buf, (e, d) => e ? j(e) : r(d))
);

/* =====================
   messages.json
===================== */
async function loadMessages() {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    await fs.writeFile(FILE, "[]");
    return [];
  }
}

async function saveMessages(data) {
  await fs.writeFile(FILE, JSON.stringify(data, null, 2));
}

/* =====================
   GitHub
===================== */
async function githubGet() {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}?ref=${GITHUB_BRANCH}`,
    { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
  );
  if (!res.ok) return null;
  return res.json();
}

async function githubPut(content, sha, message) {
  await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message,
        content,
        sha,
        branch: GITHUB_BRANCH
      })
    }
  );
}

async function backupToGithub() {
  const messages = await loadMessages();
  const json = Buffer.from(JSON.stringify(messages));
  const gz = await gzip(json);
  const enc = encrypt(gz);
  const base64 = enc.toString("base64");

  const existing = await githubGet();
  await githubPut(
    base64,
    existing?.sha,
    "backup messages"
  );
}

async function restoreFromGithub() {
  const file = await githubGet();
  if (!file) return;

  const enc = Buffer.from(file.content, "base64");
  const gz = decrypt(enc);
  const json = await gunzip(gz);
  await fs.writeFile(FILE, json);
}

/* =====================
   起動時復元
===================== */
restoreFromGithub().then(() =>
  console.log("Restored messages from GitHub")
);

/* =====================
   入室認証
===================== */
app.post("/auth", (req, res) => {
  res.json({ ok: req.body.password === ENTRY_PASSWORD });
});

/* =====================
   socket.io
===================== */
io.on("connection", async (socket) => {
  socket.emit("history", await loadMessages());

  socket.on("userJoin", (user) => {
    users[socket.id] = user;
  });

  socket.on("chat message", async (msg) => {
    const data = await loadMessages();
    data.push(msg);
    await saveMessages(data);
    io.emit("chat message", msg);
  });

  socket.on("requestDelete", async (id) => {
    const data = await loadMessages();
    const next = data.filter(m => m.id !== id);
    await saveMessages(next);
    io.emit("delete message", id);
  });

  socket.on("adminClearAll", async (pw) => {
    if (pw !== ADMIN_PASSWORD) return;
    await saveMessages([]);
    await backupToGithub();
    io.emit("clearAllMessages");
  });

  socket.on("disconnect", async () => {
    delete users[socket.id];

    // ★ 最後の1人が抜けた瞬間
    if (io.engine.clientsCount === 0) {
      await backupToGithub();
      console.log("Backup on last disconnect");
    }
  });
});

/* =====================
   起動
===================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log("Server running on", PORT)
);
