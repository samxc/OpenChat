'use strict';

/* ============================================================
   OpenChat frontend — peer-to-peer files
   - Text + control messages: SockJS + STOMP over /chatPoint.
   - Files: shared browser-to-browser with WebTorrent. The sender
     "seeds" the file; only the magnet link travels over STOMP.
     Receivers pull the bytes from whoever is seeding.
   ============================================================ */

let stompClient = null;
let username = null;
let torrentClient = null;

const consentPage  = document.getElementById('consent');
const consentOk    = document.getElementById('consent-ok');
const loginPage    = document.getElementById('login');
const chatPage     = document.getElementById('chat-page');
const loginForm    = document.getElementById('login-form');
const usernameEl   = document.getElementById('username');
const loginError   = document.getElementById('login-error');
const messageForm  = document.getElementById('message-form');
const messageEl    = document.getElementById('message');
const chatEl       = document.getElementById('chat');
const fileInput    = document.getElementById('file-input');
const attachBtn    = document.getElementById('attach-btn');
const uploadStatus = document.getElementById('upload-status');

const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200MB — P2P, so no server limit; just keep memory sane

const AVATAR_COLORS = [
    '#5865f2', '#57f287', '#eb459e', '#ed4245',
    '#faa61a', '#3ba55d', '#9b59b6', '#e67e22'
];

/* ---------- Consent gate ---------- */

consentOk.addEventListener('click', () => {
    consentPage.classList.add('hidden');
    loginPage.classList.remove('hidden');
    usernameEl.focus();
});

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

    if (window.WebTorrent && !torrentClient) {
        torrentClient = new WebTorrent();
    }

    const socket = new SockJS('/chatPoint');
    stompClient = Stomp.over(socket);
    stompClient.debug = null;
    stompClient.connect({}, onConnected, onError);
};

const onConnected = () => {
    stompClient.subscribe('/topic/public', onMessageReceived);
    stompClient.send('/app/chat.registerUser', {},
        JSON.stringify({ sender: username, type: 'CONNECT' })
    );
    removeStatusPill();
};

const onError = () => showStatusPill('Connection lost — please refresh the page.');

/* ---------- Sending text ---------- */

const sendMessage = (event) => {
    event.preventDefault();
    const content = messageEl.value.trim();
    if (!content || !stompClient) return;

    stompClient.send('/app/chat.send', {}, JSON.stringify({
        sender: username, content: content, type: 'CHAT', time: nowTime()
    }));

    messageEl.value = '';
    autoGrow();
};

/* ---------- Sending files (seed, then broadcast the magnet) ---------- */

attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';

    if (!torrentClient) {
        showUpload('Peer-to-peer sharing is not available in this browser.', true);
        return;
    }
    if (file.size > MAX_FILE_BYTES) {
        showUpload(`"${file.name}" is too big (max ${formatSize(MAX_FILE_BYTES)}).`, true);
        return;
    }

    showUpload(`Preparing "${file.name}" to share…`, false);

    torrentClient.seed(file, (torrent) => {
        stompClient.send('/app/chat.send', {}, JSON.stringify({
            sender: username,
            type: 'FILE',
            magnetUri: torrent.magnetURI,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            time: nowTime()
        }));
        hideUpload();
    });
});

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
    head.append(author, time);
    body.appendChild(head);

    if (message.type === 'FILE') {
        const slot = document.createElement('div');
        body.appendChild(slot);
        loadAttachment(slot, message);
    }
    if (message.content) {
        const text = document.createElement('div');
        text.className = 'msg-text' + (message.type === 'FILE' ? ' msg-caption' : '');
        text.textContent = message.content;
        body.appendChild(text);
    }

    row.append(avatar, body);
    chatEl.appendChild(row);
};

const loadAttachment = (slot, message) => {
    const loading = document.createElement('div');
    loading.className = 'attach-loading';
    const spin = document.createElement('div');
    spin.className = 'spinner';
    const label = document.createElement('span');
    label.textContent = `Fetching ${message.fileName || 'file'}…`;
    loading.append(spin, label);
    slot.appendChild(loading);

    if (!torrentClient) {
        label.textContent = 'Cannot fetch file — peer-to-peer unavailable in this browser.';
        spin.remove();
        return;
    }

    getOrAdd(message.magnetUri,
        (torrent) => {
            const onProgress = () => { label.textContent = `Fetching ${message.fileName}… ${Math.round(torrent.progress * 100)}%`; };
            torrent.on('download', onProgress);
            torrent.files[0].getBlobURL((err, url) => {
                torrent.removeListener('download', onProgress);
                if (err) {
                    spin.remove();
                    label.textContent = 'Could not load this file.';
                    return;
                }
                slot.replaceChildren(buildMedia(message, url));
                scrollToBottom();
            });
        },
        () => {
            spin.remove();
            label.textContent = `${message.fileName} isn't available right now — nobody sharing it is online.`;
        }
    );
};

// Find the torrent if we already have it (e.g. we're the seeder), otherwise join the swarm.
const getOrAdd = (magnet, onReady, onFail) => {
    try {
        const existing = torrentClient.get(magnet);
        if (existing) {
            existing.ready ? onReady(existing) : existing.once('ready', () => onReady(existing));
        } else {
            const t = torrentClient.add(magnet, (torrent) => onReady(torrent));
            t.on('error', () => onFail && onFail());
        }
    } catch (e) {
        onFail && onFail();
    }
};

const buildMedia = (message, url) => {
    const type = message.fileType || '';

    if (type.startsWith('image/')) {
        const link = document.createElement('a');
        link.href = url; link.target = '_blank'; link.rel = 'noopener';
        const img = document.createElement('img');
        img.className = 'attach-img';
        img.src = url;
        img.alt = message.fileName || 'image';
        link.appendChild(img);
        return link;
    }
    if (type.startsWith('video/')) {
        const video = document.createElement('video');
        video.className = 'attach-video';
        video.src = url; video.controls = true;
        return video;
    }
    if (type.startsWith('audio/')) {
        const audio = document.createElement('audio');
        audio.className = 'attach-audio';
        audio.src = url; audio.controls = true;
        return audio;
    }
    return buildFileCard(message, url);
};

const buildFileCard = (message, url) => {
    const card = document.createElement('a');
    card.className = 'attach-file';
    card.href = url;
    card.target = '_blank';
    card.rel = 'noopener';
    card.download = message.fileName || 'file';

    const icon = document.createElement('div');
    icon.className = 'attach-file-icon';
    icon.textContent = fileEmoji(message.fileType, message.fileName);

    const meta = document.createElement('div');
    meta.className = 'attach-file-meta';
    const name = document.createElement('div');
    name.className = 'attach-file-name';
    name.textContent = message.fileName || 'file';
    const sub = document.createElement('div');
    sub.className = 'attach-file-sub';
    sub.textContent = (message.fileType || 'file') + ' · ' + formatSize(message.fileSize || 0);
    meta.append(name, sub);

    card.append(icon, meta);
    return card;
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
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return hash;
};

const avatarColor = (name) => AVATAR_COLORS[Math.abs(hashCode(name || '')) % AVATAR_COLORS.length];

const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatSize = (bytes) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + units[i];
};

const fileEmoji = (type, name) => {
    type = type || '';
    if (type.includes('pdf')) return '📄';
    if (type.startsWith('text/')) return '📝';
    if (type.includes('zip') || type.includes('compressed')) return '🗜️';
    if (type.includes('word') || (name || '').match(/\.docx?$/)) return '📘';
    if (type.includes('sheet') || (name || '').match(/\.xlsx?$/)) return '📊';
    return '📎';
};

const scrollToBottom = () => { chatEl.scrollTop = chatEl.scrollHeight; };

const autoGrow = () => {
    messageEl.style.height = 'auto';
    messageEl.style.height = Math.min(messageEl.scrollHeight, 180) + 'px';
};

/* ---------- Upload status line ---------- */

const showUpload = (text, isError) => {
    uploadStatus.textContent = text;
    uploadStatus.classList.toggle('error', !!isError);
    uploadStatus.classList.remove('hidden');
    if (isError) setTimeout(hideUpload, 5000);
};
const hideUpload = () => uploadStatus.classList.add('hidden');

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
messageEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        messageForm.requestSubmit();
    }
});
