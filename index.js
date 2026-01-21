// index.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

/* =====================
   環境変数
===================== */
const PORT = process.env.PORT || 3000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // owner/repo
const GITHUB_PATH = process.env.GITHUB_PATH || "messages.enc.json";
const SECRET_KEY = process.env.SECRET_KEY; // 32文字推奨
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const MAX_MESSAGES = 100;

/* =====================
   暗号化 / 復号
===================== */
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const key = crypto.createHash("sha256").update(SECRET_KEY).digest();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let enc = cipher.update(text, "utf8", "base64");
  enc += cipher.final("base64");
  return iv.toString("base64") + ":" + enc;
}

function decrypt(enc) {
  const [ivStr, data] = enc.split(":");
  const iv = Buffer.from(ivStr, "base64");
  const key = crypto.createHash("sha256").update(SECRET_KEY).digest();
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let dec = decipher.update(data, "base64", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

/* =====================
   GitHub API
===================== */
const api = "https://api.github.com";

async function loadMessages() {
  try {
    const res = await fetch(
      `${api}/repos/${GITHUB_REPO}/contents/${GITHUB_PATH}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json"
        }
      }
    );

    if (res.status === 404) return [];

    const json = await res.json();
    const decoded = Buffer.from(json.content, "base64").toString("utf8");
    return JSON.parse(decrypt(decoded));
  } catch (e) {
    console.error("loadMessages error:", e);
    return [];
  }
}

async function saveMessages(data) {
  try {
    const body = encrypt(JSON.stringify(data));
    let sha = null;

    const check = await fetch(
      `${api}/repos/${GITHUB_REPO}/contents/${GITHUB_PATH}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json"
        }
      }
    );

    if (check.ok) {
      sha = (await check.json()).sha;
    }

    await fetch(
      `${api}/repos/${GITHUB_REPO}/contents/${GITHUB_PATH}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json"
        },
        body: JSON.stringify({
          message: "update messages",
          content: Buffer.from(body).toString("base64"),
          sha
        })
      }
    );
  } catch (e) {
    console.error("saveMessages error:", e);
  }
}

/* =====================
   メモリキャッシュ（高速用）
===================== */
let messageCache = await loadMessages();
if (messageCache.length > MAX_MESSAGES) {
  messageCache = messageCache.slice(-MAX_MESSAGES);
}

/* =====================
   socket.io
===================== */
io.on("connection", (socket) => {
  console.log("connect:", socket.id);

  // 履歴送信
  socket.emit("history", messageCache);

  // メッセージ受信
  socket.on("chat message", (msg) => {
    messageCache.push(msg);

    if (messageCache.length > MAX_MESSAGES) {
      messageCache = messageCache.slice(-MAX_MESSAGES);
    }

    // 🔥 即時表示（超高速）
    io.emit("chat message", msg);

    // 🔥 裏で保存（遅くてもOK）
    saveMessages(messageCache);
  });

  // 個別削除
  socket.on("requestDelete", (id) => {
    messageCache = messageCache.filter(m => m.id !== id);

    io.emit("delete message", id);
    saveMessages(messageCache);
  });

  // 管理者：全削除
  socket.on("adminClearAll", (password) => {
    if (password !== ADMIN_PASSWORD) {
      socket.emit("adminClearFailed", "管理者パスワードが違います");
      return;
    }

    messageCache = [];
    io.emit("clearAllMessages");
    saveMessages(messageCache);

    console.log("admin cleared all");
  });

  socket.on("disconnect", () => {
    console.log("disconnect:", socket.id);
  });
});

/* =====================
   起動
===================== */
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
