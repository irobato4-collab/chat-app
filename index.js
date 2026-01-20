  const express = require("express");
  const http = require("http");
  const { Server } = require("socket.io");
  const { Pool } = require("pg");
  const crypto = require("crypto");
  require("dotenv").config();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  // =====================
  // PostgreSQL 接続
  // =====================
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // =====================
  // 静的ファイル
  // =====================
  app.use(express.static("public"));

  // =====================
  // DB初期化
  // =====================
  async function initDB() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        name TEXT,
        color TEXT,
        avatar TEXT,
        text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
  initDB();

  // =====================
  // Socket.IO
  // =====================
  io.on("connection", (socket) => {

    // 入室パスワード認証
    socket.on("checkRoomPassword", (pw) => {
      if (pw === process.env.ROOM_PASSWORD) {
        socket.emit("roomAuthOK");
      } else {
        socket.emit("roomAuthNG");
      }
    });

    // ユーザー参加
    socket.on("userJoin", async (user) => {
      let token = user.client_token;

      if (!token) {
        token = crypto.randomUUID();
        socket.emit("assignClientToken", token);
      }

      socket.clientToken = token;
      socket.userInfo = user;

      const result = await pool.query(
        "SELECT * FROM messages ORDER BY created_at ASC LIMIT 100"
      );
      socket.emit("history", result.rows);
    });

    // メッセージ送信（IDはサーバー生成・永続）
    socket.on("chat message", async (msg) => {
      const id = crypto.randomUUID();

      const data = {
        id,
        name: socket.userInfo.name,
        color: socket.userInfo.color,
        avatar: socket.userInfo.avatar,
        text: msg.text
      };

      await pool.query(
        "INSERT INTO messages(id,name,color,avatar,text) VALUES($1,$2,$3,$4,$5)",
        [data.id, data.name, data.color, data.avatar, data.text]
      );

      io.emit("chat message", data);
    });

    // 管理者：全削除
    socket.on("adminDeleteAll", async (pw) => {
      if (pw !== process.env.ADMIN_DELETE_PASSWORD) return;
      await pool.query("DELETE FROM messages");
      io.emit("history", []);
    });

    // 切断
    socket.on("disconnect", () => {
      console.log("disconnect:", socket.clientToken);
    });
  });

  // =====================
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log("Server running on", PORT);
  });
