// index.js
const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const fs = require("fs");
const path = require("path");

app.use(express.static("public"));

/* ===== 設定 ===== */
const FILE = "messages.json";
const MAX_MESSAGES = 100;
const ADMIN_PASSWORD = "40311882"; // ← 必ず変更してください

let users = {}; // socket.id -> { name, color, avatar }

/* ===== messages.json 安全読み込み ===== */
function loadMessages() {
  try {
    if (!fs.existsSync(FILE)) {
      fs.writeFileSync(FILE, "[]");
      return [];
    }
    const raw = fs.readFileSync(FILE, "utf8");
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error("loadMessages error:", e);
    fs.writeFileSync(FILE, "[]");
    return [];
  }
}

function saveMessages(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

/* ===== 起動時に履歴整理（100件超え防止） ===== */
(function normalizeMessages() {
  let data = loadMessages();
  if (data.length > MAX_MESSAGES) {
    data = data.slice(data.length - MAX_MESSAGES);
    saveMessages(data);
  }
})();

/* ===== socket.io ===== */
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // 履歴送信
  socket.emit("history", loadMessages());

  // ユーザー参加
  socket.on("userJoin", (user) => {
    users[socket.id] = {
      name: user.name,
      color: user.color,
      avatar: user.avatar || null
    };
    io.emit("userList", Object.values(users));
  });

  // メッセージ受信
  socket.on("chat message", (msg) => {
    let data = loadMessages();

    data.push({
      id: msg.id,
      name: msg.name,
      color: msg.color,
      avatar: msg.avatar ?? null,
      text: msg.text
    });

    // ★ 100件を超えたら古い順に削除
    while (data.length > MAX_MESSAGES) {
      data.shift();
    }

    saveMessages(data);
    io.emit("chat message", msg);
  });

  // 個別削除（本人のみ）
  socket.on("requestDelete", (id) => {
    const currentUser = users[socket.id];
    if (!currentUser) {
      socket.emit("deleteFailed", { id, reason: "not-joined" });
      return;
    }

    let data = loadMessages();
    const msg = data.find(m => m.id === id);
    if (!msg) {
      socket.emit("deleteFailed", { id, reason: "not-found" });
      return;
    }

    const sameName = msg.name === currentUser.name;
    const sameAvatar = (msg.avatar || null) === (currentUser.avatar || null);
    const sameColor = msg.color === currentUser.color;

    if (!(sameName && (sameAvatar || sameColor))) {
      socket.emit("deleteFailed", { id, reason: "not-owner" });
      return;
    }

    data = data.filter(m => m.id !== id);
    saveMessages(data);
    io.emit("delete message", id);
  });

  // ★ 管理者：全削除
  socket.on("adminClearAll", (password) => {
    if (password !== ADMIN_PASSWORD) {
      socket.emit("adminClearFailed", "管理者パスワードが違います");
      return;
    }

    saveMessages([]);
    io.emit("clearAllMessages");
    console.log("Admin cleared all messages");
  });

  // 切断処理
  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("userList", Object.values(users));
    console.log("User disconnected:", socket.id);
  });
});

/* ===== サーバー起動 ===== */
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
