// client.js
const socket = io();

// DOM
const setupPanel = document.getElementById("setupPanel");
const usernameInput = document.getElementById("usernameInput");
const colorInput = document.getElementById("colorInput");
const avatarInput = document.getElementById("avatarInput");
const saveSettingsBtn = document.getElementById("saveSettings");
const cancelSetupBtn = document.getElementById("cancelSetup");
const openSettingsBtn = document.getElementById("openSettings");

const messagesEl = document.getElementById("messages");
const userListEl = document.getElementById("userList");
const onlineCountEl = document.getElementById("onlineCount");
const inputEl = document.getElementById("m");
const sendBtn = document.getElementById("send");

// localStorage keys
const KEY_NAME = "chat_username";
const KEY_COLOR = "chat_color";
const KEY_AVATAR = "chat_avatar"; // base64 data URL

let username = localStorage.getItem(KEY_NAME) || "";
let color = localStorage.getItem(KEY_COLOR) || "#00b900";
let avatar = localStorage.getItem(KEY_AVATAR) || null;

// 初回表示（既にあれば隠す）
function showSetupIfNeeded() {
  if (username && color) {
    setupPanel.style.display = "none";
    // 通知サーバーに join 情報を送る
    socket.emit("userJoin", { name: username, color, avatar });
  } else {
    setupPanel.style.display = "flex";
    if (username) usernameInput.value = username;
    colorInput.value = color;
  }
}
showSetupIfNeeded();

// avatar ファイルを base64 に変換して変数に入れる
avatarInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  // 画像を縮小して base64 にする簡易処理（FileReader）
  const reader = new FileReader();
  reader.onload = () => {
    // dataURL を avatar として保持（そのまま localStorage へ保存可能）
    avatar = reader.result;
  };
  reader.readAsDataURL(file);
});

// 保存ボタン（設定確定）
saveSettingsBtn.addEventListener("click", () => {
  const name = usernameInput.value.trim();
  const col = colorInput.value;

  if (!name) return alert("名前を入力してください");

  username = name;
  color = col;

  // avatar がまだ null なら既に localStorage にあるか無視
  if (avatar) {
    try { localStorage.setItem(KEY_AVATAR, avatar); } catch(e){ /* いっぱいなら無視 */ }
  } else {
    // 既に localStorage の avatar があれば読み込む
    const stored = localStorage.getItem(KEY_AVATAR);
    if (stored) avatar = stored;
  }

  localStorage.setItem(KEY_NAME, username);
  localStorage.setItem(KEY_COLOR, color);

  // 送信（参加を通知）
  socket.emit("userJoin", { name: username, color, avatar });

  setupPanel.style.display = "none";
});

// キャンセル（設定画面を閉じるだけ。既に設定があれば閉じる）
cancelSetupBtn.addEventListener("click", () => {
  if (username && color) {
    setupPanel.style.display = "none";
  } else {
    // 入力必須の状況なら閉じさせない
    alert("名前を入力してから開始してください");
  }
});

// 設定を開く（やり直し）
openSettingsBtn.addEventListener("click", () => {
  // prefill
  usernameInput.value = username || "";
  colorInput.value = color || "#00b900";
  // avatarInput はファイル入力なのでクリア
  avatarInput.value = "";
  setupPanel.style.display = "flex";
});

// メッセージ要素を生成して追加
function makeMessageEl(msg) {
  // msg: { id, name, color, text, avatar (optional) }
  const isSelf = (msg.name === username) && ((msg.avatar || null) === (avatar || null));
  const li = document.createElement("li");
  li.className = "message " + (isSelf ? "right" : "left");
  li.dataset.id = msg.id;

  // icon element (img if avatar present)
  let iconHtml = "";
  if (msg.avatar) {
    // Use image
    iconHtml = `<img class="icon" src="${msg.avatar}" alt="avatar">`;
  } else {
    // fallback colored circle with initials
    const initials = (msg.name || "?").split(" ").map(s=>s[0]).join("").slice(0,2).toUpperCase();
    // use color with slight transparency for background
    iconHtml = `<div class="icon" style="background:${msg.color};">${initials}</div>`;
  }

  // tools (delete button only when owner)
  let toolsHtml = "";
  const isOwner = (msg.name === username) && ((msg.avatar || null) === (avatar || null));
  if (isOwner) {
    // show delete button (three dots + delete)
    toolsHtml = `
      <div class="msg-tools">
        <button class="msg-button open-menu">…</button>
        <button class="msg-button delete" title="削除">🗑</button>
      </div>
    `;
  }

  // build inner HTML
  li.innerHTML = `
    ${iconHtml}
    <div class="meta">
      <div class="msg-name" style="color:${msg.color}">${escapeHtml(msg.name)}</div>
      <div class="bubble">${escapeHtml(msg.text)}</div>
    </div>
    ${toolsHtml}
  `;

  // wire delete button
  if (isOwner) {
    const delBtn = li.querySelector(".delete");
    if (delBtn) {
      delBtn.addEventListener("click", () => {
        // request deletion from server
        socket.emit("requestDelete", msg.id);
      });
    }
    const openBtn = li.querySelector(".open-menu");
    if (openBtn) {
      openBtn.addEventListener("click", () => {
        // simple UI: toggle visibility of delete button
        const del = li.querySelector(".delete");
        if (del) del.style.display = (del.style.display === "inline-block") ? "none" : "inline-block";
      });
      // keep delete hidden until menu opened
      const del = li.querySelector(".delete");
      if (del) del.style.display = "none";
    }
  }

  return li;
}

// HTML エスケープ
function escapeHtml(s){
  if (!s && s !== 0) return "";
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// 履歴受信
socket.on("history", (msgs) => {
  messagesEl.innerHTML = "";
  msgs.forEach(m => {
    const el = makeMessageEl(m);
    messagesEl.appendChild(el);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

// 新着受信
socket.on("chat message", (m) => {
  const el = makeMessageEl(m);
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

// ユーザー一覧更新
socket.on("userList", (list) => {
  userListEl.innerHTML = "";
  onlineCountEl.textContent = `オンライン: ${list.length}`;
  list.forEach(u => {
    const div = document.createElement("div");
    div.className = "user-item";
    let imgHtml = "";
    if (u.avatar) {
      imgHtml = `<img class="uimg" src="${u.avatar}" alt="u">`;
    } else {
      const initials = (u.name||"?").split(" ").map(s=>s[0]).join("").slice(0,2).toUpperCase();
      imgHtml = `<div class="uimg" style="background:${u.color}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700">${initials}</div>`;
    }
    div.innerHTML = `${imgHtml}<div class="uname" style="color:${u.color}">${escapeHtml(u.name)}</div>`;
    userListEl.appendChild(div);
  });
});

// 削除反映
socket.on("delete message", (id) => {
  const el = messagesEl.querySelector(`[data-id="${id}"]`);
  if (el) el.remove();
});

// 削除失敗
socket.on("deleteFailed", ({ id, reason }) => {
  alert("削除に失敗しました: " + reason);
});

// 送信ボタン
sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;
  // ensure user joined
  if (!username) {
    alert("先に設定してください（⚙を押してください）");
    setupPanel.style.display = "flex";
    return;
  }

  const msg = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2),
    name: username,
    color: color,
    avatar: avatar || null,
    text
  };

  socket.emit("chat message", msg);
  inputEl.value = "";
}

// 最後に、もし既に username があったらすぐ join を送る（ページ読み込み時）
if (username) {
  // try to ensure avatar var is loaded from storage
  if (!avatar) avatar = localStorage.getItem(KEY_AVATAR) || null;
  socket.emit("userJoin", { name: username, color, avatar });
}

/* =========================
   管理者：全削除機能
========================= */

const adminClearBtn = document.getElementById("adminClearBtn");

if (adminClearBtn) {
  adminClearBtn.addEventListener("click", () => {
    const password = prompt("管理者パスワードを入力してください");
    if (!password) return;

    socket.emit("adminClearAll", password);
  });
}

// 成功時：全メッセージ削除
socket.on("clearAllMessages", () => {
  messagesEl.innerHTML = "";
  alert("全メッセージを削除しました");
});

// 失敗時
socket.on("adminClearFailed", (msg) => {
  alert("管理者操作失敗: " + msg);
});
