const socket = io();

/* =====================
   localStorage
===================== */
const KEY_NAME = "chat_username";
const KEY_COLOR = "chat_color";
const KEY_AVATAR = "chat_avatar";
const KEY_TOKEN = "client_token";

let username = localStorage.getItem(KEY_NAME) || "";
let color = localStorage.getItem(KEY_COLOR) || "#00b900";
let avatar = localStorage.getItem(KEY_AVATAR) || null;
let clientToken = localStorage.getItem(KEY_TOKEN);

/* =====================
   DOM
===================== */
const setupPanel = document.getElementById("setupPanel");
const usernameInput = document.getElementById("usernameInput");
const colorInput = document.getElementById("colorInput");
const avatarInput = document.getElementById("avatarInput");
const saveBtn = document.getElementById("saveSettings");

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("m");
const sendBtn = document.getElementById("send");

/* =====================
   初期参加
===================== */
if (username) {
  socket.emit("userJoin", {
    client_token: clientToken,
    name: username,
    color,
    avatar
  });
} else {
  setupPanel.style.display = "flex";
}

/* =====================
   token受信
===================== */
socket.on("assignClientToken", (token) => {
  clientToken = token;
  localStorage.setItem(KEY_TOKEN, token);
});

/* =====================
   保存
===================== */
saveBtn.addEventListener("click", () => {
  const name = usernameInput.value.trim();
  if (!name) return alert("名前を入力してください");

  username = name;
  color = colorInput.value;

  localStorage.setItem(KEY_NAME, username);
  localStorage.setItem(KEY_COLOR, color);
  if (avatar) localStorage.setItem(KEY_AVATAR, avatar);

  socket.emit("userJoin", {
    client_token: clientToken,
    name: username,
    color,
    avatar
  });

  setupPanel.style.display = "none";
});

/* =====================
   avatar
===================== */
avatarInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => avatar = r.result;
  r.readAsDataURL(file);
});

/* =====================
   表示
===================== */
function addMessage(m) {
  const li = document.createElement("li");
  li.textContent = `${m.name}: ${m.text}`;
  li.dataset.id = m.id;
  messagesEl.appendChild(li);
}

socket.on("history", msgs => {
  messagesEl.innerHTML = "";
  msgs.forEach(addMessage);
});

socket.on("chat message", addMessage);

socket.on("delete message", id => {
  const el = messagesEl.querySelector(`[data-id="${id}"]`);
  if (el) el.remove();
});

socket.on("edit message", ({ id, text }) => {
  const el = messagesEl.querySelector(`[data-id="${id}"]`);
  if (el) el.textContent = el.textContent.split(":")[0] + ": " + text;
});

/* =====================
   送信
===================== */
sendBtn.addEventListener("click", () => {
  const text = inputEl.value.trim();
  if (!text) return;

  socket.emit("chat message", { text });
  inputEl.value = "";
});
