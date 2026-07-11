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
let myAvatar = null;   // resized image data-URL, or null for the default initial

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
const avatarInput  = document.getElementById('avatar-input');
const avatarPicker = document.getElementById('avatar-picker');
const threadModal   = document.getElementById('thread-modal');
const threadParent  = document.getElementById('thread-parent');
const threadReplies = document.getElementById('thread-replies');
const threadForm    = document.getElementById('thread-form');
const threadInput   = document.getElementById('thread-input');
const threadClose   = document.getElementById('thread-close');
const threadTitle   = document.getElementById('thread-title');

const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200MB — P2P, so no server limit; just keep memory sane

const AVATAR_COLORS = [
    '#5865f2', '#57f287', '#eb459e', '#ed4245',
    '#faa61a', '#3ba55d', '#9b59b6', '#e67e22'
];

const QUICK_EMOJIS = ['👍', '👎', '❤️', '😂', '😮', '🔥'];
const messagesById = {}; // id -> { reactionsEl, reactions: { emoji: Set<sender> } }

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
    // Live broadcasts for everyone...
    stompClient.subscribe('/topic/public', onMessageReceived);
    // ...and a private feed the server uses to replay history just to us (catch-up on join).
    stompClient.subscribe('/user/queue/history', onMessageReceived);
    stompClient.send('/app/chat.registerUser', {},
        JSON.stringify({ sender: username, avatar: myAvatar, type: 'CONNECT' })
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
        scrollToBottom();
    } else if (message.type === 'DISCONNECT') {
        renderSystemMessage(message.sender, 'left the chat', 'leave');
        scrollToBottom();
    } else if (message.type === 'REACTION') {
        applyReaction(message);
    } else if (message.type === 'REPLY') {
        applyReply(message);
    } else {
        renderChatMessage(message);
        scrollToBottom();
    }
};

/* ---------- Rendering ---------- */

const renderChatMessage = (message) => {
    const row = document.createElement('div');
    row.className = 'msg';

    const avatar = buildAvatar(message);

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

    if (message.id) {
        const actions = document.createElement('div');
        actions.className = 'msg-actions';
        const reactionsEl = document.createElement('div');
        reactionsEl.className = 'reactions';
        const threadEl = document.createElement('div');
        threadEl.className = 'thread-summary';
        actions.append(reactionsEl, threadEl);
        body.appendChild(actions);
        messagesById[message.id] = { message, reactionsEl, reactions: {}, threadEl, replies: [] };
    }

    row.append(avatar, body);
    chatEl.appendChild(row);

    if (message.id) {
        renderReactions(message.id);
        renderThreadSummary(message.id);
    }
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

/* ---------- Reactions ---------- */

const renderReactions = (id) => {
    const entry = messagesById[id];
    if (!entry) return;
    const el = entry.reactionsEl;
    el.replaceChildren();

    Object.keys(entry.reactions).forEach((emoji) => {
        const set = entry.reactions[emoji];
        if (!set || set.size === 0) return;
        const pill = document.createElement('button');
        pill.className = 'reaction-pill' + (set.has(username) ? ' mine' : '');
        pill.textContent = `${emoji} ${set.size}`;
        pill.addEventListener('click', () => sendReaction(id, emoji));
        el.appendChild(pill);
    });

    // Add-reaction button with a popover picker (absolutely positioned, so opening it
    // never shifts the row). Picking closes it; only one picker is ever open.
    const addWrap = document.createElement('span');
    addWrap.className = 'reaction-add-wrap';

    const add = document.createElement('button');
    add.className = 'reaction-add';
    add.textContent = '＋';
    add.title = 'Add reaction';

    const picker = document.createElement('span');
    picker.className = 'reaction-picker hidden';
    QUICK_EMOJIS.forEach((emoji) => {
        const choice = document.createElement('button');
        choice.className = 'reaction-choice';
        choice.textContent = emoji;
        choice.addEventListener('click', () => {
            sendReaction(id, emoji);
            picker.classList.add('hidden');
        });
        picker.appendChild(choice);
    });
    add.addEventListener('click', () => {
        const wasHidden = picker.classList.contains('hidden');
        closeAllPickers();
        if (wasHidden) picker.classList.remove('hidden');
    });

    addWrap.append(add, picker);
    el.appendChild(addWrap);
};

const closeAllPickers = () => {
    document.querySelectorAll('.reaction-picker').forEach((p) => p.classList.add('hidden'));
};

const sendReaction = (id, emoji) => {
    if (!stompClient) return;
    stompClient.send('/app/chat.send', {}, JSON.stringify({
        type: 'REACTION', targetId: id, emoji: emoji
    }));
};

// Every client applies the same toggle on the same event stream, so counts converge.
const applyReaction = (message) => {
    const entry = messagesById[message.targetId];
    if (!entry) return; // reacting to a message we don't have (e.g. joined later) — ignore

    const emoji = message.emoji;
    const sender = message.sender;
    const alreadyThisEmoji = entry.reactions[emoji] && entry.reactions[emoji].has(sender);

    // One reaction per person: clear this user from every emoji on the message first.
    Object.keys(entry.reactions).forEach((e) => {
        entry.reactions[e].delete(sender);
        if (entry.reactions[e].size === 0) delete entry.reactions[e];
    });

    // Re-adding the same emoji is a toggle-off; a different emoji switches to it.
    if (!alreadyThisEmoji) {
        if (!entry.reactions[emoji]) entry.reactions[emoji] = new Set();
        entry.reactions[emoji].add(sender);
    }
    renderReactions(message.targetId);
};

/* ---------- Threads ---------- */

let currentThreadId = null;

const renderThreadSummary = (id) => {
    const entry = messagesById[id];
    if (!entry) return;
    const el = entry.threadEl;
    el.replaceChildren();
    const n = entry.replies.length;
    const isFile = entry.message && entry.message.type === 'FILE';
    const noun = isFile ? 'comment' : 'reply';
    const btn = document.createElement('button');
    btn.className = 'thread-btn' + (n > 0 ? ' has-replies' : '');
    if (n > 0) {
        btn.textContent = `💬 ${n} ${n === 1 ? noun : noun + 's'}`;
    } else {
        btn.textContent = isFile ? '💬 Comment' : '💬 Reply';
    }
    btn.addEventListener('click', () => openThread(id));
    el.appendChild(btn);
};

const openThread = (id) => {
    const entry = messagesById[id];
    if (!entry) return;
    currentThreadId = id;
    if (threadTitle) {
        threadTitle.textContent = entry.message.type === 'FILE' ? '💬 Comments' : '🧵 Thread';
    }
    threadParent.replaceChildren(renderThreadMessage(entry.message));
    renderThreadReplies(id);
    threadModal.classList.remove('hidden');
    threadInput.focus();
};

const closeThread = () => {
    currentThreadId = null;
    threadModal.classList.add('hidden');
};

const renderThreadReplies = (id) => {
    const entry = messagesById[id];
    if (!entry) return;
    threadReplies.replaceChildren();
    entry.replies.forEach((reply) => threadReplies.appendChild(renderThreadMessage(reply)));
    threadReplies.scrollTop = threadReplies.scrollHeight;
};

const renderThreadMessage = (msg) => {
    const row = document.createElement('div');
    row.className = 'thread-msg';

    const avatar = buildAvatar(msg);

    const body = document.createElement('div');
    body.className = 'msg-body';
    const head = document.createElement('div');
    head.className = 'msg-head';
    const author = document.createElement('span');
    author.className = 'msg-author';
    author.style.color = avatarColor(msg.sender);
    author.textContent = msg.sender;
    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = msg.time || '';
    head.append(author, time);

    const text = document.createElement('div');
    text.className = 'msg-text';
    text.textContent = msg.type === 'FILE' ? ('📎 ' + (msg.fileName || 'file')) : (msg.content || '');

    body.append(head, text);
    row.append(avatar, body);
    return row;
};

const sendReply = (id, text) => {
    if (!stompClient || !text) return;
    stompClient.send('/app/chat.send', {}, JSON.stringify({
        type: 'REPLY', targetId: id, content: text, time: nowTime()
    }));
};

const applyReply = (message) => {
    const entry = messagesById[message.targetId];
    if (!entry) return; // parent not present (joined before its history) — ignore
    entry.replies.push(message);
    renderThreadSummary(message.targetId);
    if (currentThreadId === message.targetId) renderThreadReplies(message.targetId);
};

/* ---------- Helpers ---------- */

const initial = (name) => (name && name.length ? name[0] : '?');

// A photo avatar if the sender set one, otherwise the colored-initial circle.
const buildAvatar = (message) => {
    if (message.avatar) {
        const img = document.createElement('img');
        img.className = 'msg-avatar';
        img.src = message.avatar;
        img.alt = message.sender || '';
        return img;
    }
    const div = document.createElement('div');
    div.className = 'msg-avatar';
    div.style.backgroundColor = avatarColor(message.sender);
    div.textContent = initial(message.sender);
    return div;
};

// Shrink a chosen image to a small square JPEG data-URL for use as an avatar.
const resizeToAvatar = (file, cb) => {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const size = 96;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const min = Math.min(img.width, img.height);
            const sx = (img.width - min) / 2;
            const sy = (img.height - min) / 2;
            ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
            cb(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

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

// Avatar picker (login screen)
avatarPicker.addEventListener('click', () => avatarInput.click());
avatarInput.addEventListener('change', () => {
    const file = avatarInput.files[0];
    avatarInput.value = '';
    if (!file) return;
    resizeToAvatar(file, (dataUrl) => {
        myAvatar = dataUrl;
        avatarPicker.style.backgroundImage = `url(${dataUrl})`;
        avatarPicker.classList.add('has-image');
    });
});

// Thread modal
threadClose.addEventListener('click', closeThread);
threadModal.addEventListener('click', (e) => { if (e.target === threadModal) closeThread(); });
threadForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = threadInput.value.trim();
    if (!text || !currentThreadId) return;
    sendReply(currentThreadId, text);
    threadInput.value = '';
});
threadInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        threadForm.requestSubmit();
    }
});

// Close any open reaction picker when clicking outside of it.
document.addEventListener('click', (e) => {
    if (!e.target.closest('.reaction-add-wrap')) closeAllPickers();
});
messageEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        messageForm.requestSubmit();
    }
});
