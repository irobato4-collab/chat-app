// index.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import fs from "fs";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

/* =====================
   設定
===================== */
const LOCAL_FILE = "messages.json";

const {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_FILE,
  GITHUB_TOKEN,
  SECRET_KEY,
  ADMIN_PASSWORD,
  ENTRY_PASSWORD
} = process.env;

/* =====================
   メモリ
===================== */
let messages = [];
let users = {};

/* =====================
   暗号化 / 復号
===================== */
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const key = crypto.createHash("sha256").update(SECRET_KEY).digest();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const enc = Buffer.concat([cipher.update(text), cipher.final()]);
  return iv.toString("hex") + ":" + enc.toString("hex");
}

function decrypt(text) {
  const [ivHex, dataHex] = text.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const key = crypto.createHash("sha256").update(SECRET_KEY).digest();
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString();
}

/* =====================
   GitHub API
===================== */
const GH_HEADERS = {
  Authorization: `token ${GITHUB_TOKEN}`,
  "User-Agent": "chat-backup",
  Accept: "application/vnd.github+json"
};

async function restoreFromGitHub() {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;
  const res = await fetch(url, { headers: GH_HEADERS });
  if (!res.ok) {
    console.log("⚠ GitHub backup not found");
    return;
  }

  const json = await res.json();
  const encrypted = Buffer.from(json.content, "base64").toString();
  const decrypted = decrypt(encrypted);
  messages = JSON.parse(decrypted);

  fs.writeFileSync(LOCAL_FILE, JSON.stringify(messages, null, 2));
}

async function backupToGitHub() {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;

  let sha = null;
  const check = await fetch(url, { headers: GH_HEADERS });
  if (check.ok) sha = (await check.json()).sha;

  const encrypted = encrypt(JSON.stringify(messages));
  const content = Buffer.from(encrypted).toString("base64");

  await fetch(url, {
    method: "PUT",
    headers: GH_HEADERS,
    body: JSON.stringify({
      message: "backup messages",
      content,
      sha
    })
  });

  console.log("☁ GitHub backup updated");
}

/* =====================
   入室認証
===================== */
app.post("/auth", (req, res) => {
  res.json({ ok: req.body.password === ENTRY_PASSWORD });
});

/* =====================
   socket.io
===================== */
io.on("connection", (socket) => {
  console.log("connect:", socket.id);

  socket.emit("history", messages);

  socket.on("userJoin", (u) => {
    users[socket.id] = u;
  });

  socket.on("chat message", (msg) => {
    messages.push(msg);
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(messages, null, 2));
    io.emit("chat message", msg);
  });

  socket.on("requestDelete", (id) => {
    const user = users[socket.id];
    const msg = messages.find(m => m.id === id);
    if (!user || !msg || msg.name !== user.name) return;

    messages = messages.filter(m => m.id !== id);
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(messages, null, 2));
    io.emit("delete message", id);
  });

  socket.on("adminClearAll", (password) => {
    if (password !== ADMIN_PASSWORD) return;
    messages = [];
    fs.writeFileSync(LOCAL_FILE, "[]");
    io.emit("clearAllMessages");
    backupToGitHub();
  });

  socket.on("disconnect", async () => {
    delete users[socket.id];
    if (Object.keys(users).length === 0) {
      await backupToGitHub();
    }
  });
});

/* =====================
   起動（最重要）
===================== */
async function boot() {
  console.log("⏳ restoring messages...");
  if (fs.existsSync(LOCAL_FILE)) {
    messages = JSON.parse(fs.readFileSync(LOCAL_FILE));
    console.log("✅ loaded local messages");
  } else {
    await restoreFromGitHub();
    console.log("✅ restored from GitHub");
  }

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log("🚀 Server started on port", PORT);
  });
}

boot();
