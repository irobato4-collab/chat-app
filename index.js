// index.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import crypto from "crypto";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ===== 外部Ping用（スリープ防止）=====
app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

/* ===== 設定 ===== */
const MAX_MESSAGES = 100;

// env
const {
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  GITHUB_FILE,
  SECRET_KEY,
  ADMIN_PASSWORD,
  ENTRY_PASSWORD,
  PORT
} = process.env;

app.use(express.static("public"));
app.use(express.json());

let users = {}; // socket.id -> user

/* ===== 暗号化ユーティリティ ===== */
const ALGO = "aes-256-gcm";
const KEY = crypto.createHash("sha256").update(SECRET_KEY).digest();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(enc) {
  const buf = Buffer.from(enc, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/* ===== GitHub API ===== */
const GH_HEADERS = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  "Content-Type": "application/json"
};

const GH_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}?ref=${GITHUB_BRANCH}`;

async function loadMessages() {
  try {
    const res = await fetch(GH_URL, { headers: GH_HEADERS });
    if (res.status === 404) return [];

    const json = await res.json();
    const decrypted = decrypt(Buffer.from(json.content, "base64").toString());
    return JSON.parse(decrypted);
  } catch (e) {
    console.error("loadMessages error:", e);
    return [];
  }
}

async function saveMessages(messages) {
  const encrypted = encrypt(JSON.stringify(messages));
  const content = Buffer.from(encrypted).toString("base64");

  let sha = undefined;
  const res = await fetch(GH_URL, { headers: GH_HEADERS });
  if (res.ok) {
    const json = await res.json();
    sha = json.sha;
  }

  await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
    {
      method: "PUT",
      headers: GH_HEADERS,
      body: JSON.stringify({
        message: "update messages",
        content,
        branch: GITHUB_BRANCH,
        sha
      })
    }
  );
}

/* ===== 入室認証 ===== */
app.post("/auth", (req, res) => {
  res.json({ ok: req.body.password === ENTRY_PASSWORD });
});

/* ===== socket.io ===== */
io.on("connection", async (socket) => {
  console.log("connected:", socket.id);

  socket.emit("history", await loadMessages());

  socket.on("userJoin", (user) => {
    users[socket.id] = user;
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

  socket.on("adminClearAll", async (password) => {
    if (password !== ADMIN_PASSWORD) return;
    await saveMessages([]);
    io.emit("clearAllMessages");
  });

  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("userList", Object.values(users));
  });
});

/* ===== 起動 ===== */
server.listen(PORT || 3000, () => {
  console.log("Server running");
});
