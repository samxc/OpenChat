'use strict';

/* ============================================================
   OpenChat frontend
   Transport: SockJS + STOMP over the /chatPoint endpoint.
   Server broadcasts every message to /topic/public.
   ============================================================ */

let stompClient = null;
let username = null;

const loginPage   = document.getElementById('login');
const chatPage    = document.getElementById('chat-page');
const loginForm   = document.getElementById('login-form');
const usernameEl  = document.getElementById('username');
const loginError  = document.getElementById('login-error');
const messageForm = document.getElementById('message-form');
const messageEl   = document.getElementById('message');
const chatEl      = document.getElementById('chat');

const AVATAR_COLORS = [
    '#5865f2', '#57f287', '#eb459e', '#ed4245',
    '#faa61a', '#3ba55d', '#9b59b6', '#e67e22'
];

/* ---------- Connection ---------- */

const connect = (event) => {
    event.preventDefault();
    username = usernameEl.value.trim();
    if (!username) {
        loginError.textContent = 'Please enter a username.';
        return;
    }

    loginPage.classList.add('hidden');
    chatPage.classList.remove('hidden');
    messageEl.focus();

    const socket = new SockJS('/chatPoint');
    stompClient = Stomp.over(socket);
    stompClient.debug = null; // silence the noisy console output
    stompClient.connect({}, onConnected, onError);
};

const onConnected = () => {
    stompClient.subscribe('/topic/public', onMessageReceived);
    // Announce ourselves so everyone gets a "joined" system message.
    stompClient.send('/app/chat.registerUser', {},
        JSON.stringify({ sender: username, type: 'CONNECT' })
    );
    removeStatusPill();
};

const onError = () => {
    showStatusPill('Connection lost — please refresh the page.');
};

/* ---------- Sending ---------- */

const sendMessage = (event) => {
    event.preventDefault();
    const content = messageEl.value.trim();
    if (!content || !stompClient) return;

    stompClient.send('/app/chat.send', {}, JSON.stringify({
        sender: username,
        content: content,
        type: 'CHAT',
        time: nowTime()
    }));

    messageEl.value = '';
    autoGrow();
};

/* ---------- Receiving ---------- */

const onMessageReceived = (payload) => {
    const message = JSON.parse(payload.body);

    if (message.type === 'CONNECT') {
        renderSystemMessage(message.sender, 'joined the chat', 'join');
    } else if (message.type === 'DISCONNECT') {
        renderSystemMessage(message.sender, 'left the chat', 'leave');
    } else {
        renderChatMessage(message);
    }
    scrollToBottom();
};

/* ---------- Rendering ---------- */

const renderChatMessage = (message) => {
    const row = document.createElement('div');
    row.className = 'msg';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.style.backgroundColor = avatarColor(message.sender);
    avatar.textContent = initial(message.sender);

    const body = document.createElement('div');
    body.className = 'msg-body';

    const head = document.createElement('div');
    head.className = 'msg-head';

    const author = document.createElement('span');
    author.className = 'msg-author';
    author.style.color = avatarColor(message.sender);
    author.textContent = message.sender;

    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = message.time || nowTime();

    const text = document.createElement('div');
    text.className = 'msg-text';
    text.textContent = message.content; // textContent = safe against HTML injection

    head.append(author, time);
    body.append(head, text);
    row.append(avatar, body);
    chatEl.appendChild(row);
};

const renderSystemMessage = (sender, action, kind) => {
    const row = document.createElement('div');
    row.className = `system ${kind}`;

    const arrow = document.createElement('span');
    arrow.className = 'system-arrow';
    arrow.textContent = kind === 'join' ? '→' : '←';

    const name = document.createElement('span');
    name.className = 'system-name';
    name.textContent = sender;

    const label = document.createElement('span');
    label.textContent = ` ${action}`;

    const time = document.createElement('span');
    time.className = 'system-time';
    time.textContent = nowTime();

    row.append(arrow, name, label, time);
    chatEl.appendChild(row);
};

/* ---------- Helpers ---------- */

const initial = (name) => (name && name.length ? name[0] : '?');

const hashCode = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hash;
};

const avatarColor = (name) => {
    const index = Math.abs(hashCode(name || '')) % AVATAR_COLORS.length;
    return AVATAR_COLORS[index];
};

const nowTime = () =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const scrollToBottom = () => { chatEl.scrollTop = chatEl.scrollHeight; };

const autoGrow = () => {
    messageEl.style.height = 'auto';
    messageEl.style.height = Math.min(messageEl.scrollHeight, 180) + 'px';
};

/* ---------- Status pill ---------- */

const showStatusPill = (text) => {
    removeStatusPill();
    const pill = document.createElement('div');
    pill.className = 'status-pill';
    pill.id = 'status-pill';
    pill.textContent = text;
    document.body.appendChild(pill);
};
const removeStatusPill = () => {
    const pill = document.getElementById('status-pill');
    if (pill) pill.remove();
};

/* ---------- Events ---------- */

loginForm.addEventListener('submit', connect);
messageForm.addEventListener('submit', sendMessage);

messageEl.addEventListener('input', autoGrow);

// Enter sends, Shift+Enter makes a new line (Discord behaviour).
messageEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        messageForm.requestSubmit();
    }
});
