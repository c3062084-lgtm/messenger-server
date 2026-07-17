const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const DB = { users: {}, messages: {}, channels: {}, tokens: {}, blocked: {} };

DB.users['boss'] = { username: 'boss', displayName: 'BOSS', isAdmin: true };
DB.blocked['boss'] = [];

function auth(req, res, next) {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const username = DB.tokens[token];
    if (!username || !DB.users[username]) return res.status(401).json({ error: 'auth' });
    req.user = DB.users[username];
    next();
}

app.post('/api/login', (req, res) => {
    const { username, displayName } = req.body;
    if (!username || !displayName) return res.status(400).json({ error: 'fill' });
    if (!DB.users[username]) { DB.users[username] = { username, displayName, isAdmin: false }; DB.blocked[username] = []; }
    else DB.users[username].displayName = displayName;
    if (username === 'boss') DB.users[username].isAdmin = true;
    const token = Math.random().toString(36);
    DB.tokens[token] = username;
    res.json({ token, user: DB.users[username] });
});

app.get('/api/me', auth, (req, res) => {
    res.json({ ...req.user, blockedCount: (DB.blocked[req.user.username] || []).length });
});

app.get('/api/users/search', auth, (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    const users = Object.values(DB.users).filter(u => u.username !== req.user.username && (u.username.includes(q) || u.displayName.toLowerCase().includes(q))).map(u => ({ username: u.username, displayName: u.displayName, isAdmin: u.isAdmin }));
    res.json({ users });
});

app.get('/api/users/:username', auth, (req, res) => {
    const u = DB.users[req.params.username];
    if (!u) return res.status(404).json({ error: 'not found' });
    res.json({ user: { username: u.username, displayName: u.displayName, isAdmin: u.isAdmin }, isBlocked: (DB.blocked[req.user.username] || []).includes(req.params.username) });
});

app.post('/api/block/:username', auth, (req, res) => {
    if (!DB.blocked[req.user.username].includes(req.params.username)) DB.blocked[req.user.username].push(req.params.username);
    res.json({ ok: true });
});

app.delete('/api/block/:username', auth, (req, res) => {
    DB.blocked[req.user.username] = DB.blocked[req.user.username].filter(u => u !== req.params.username);
    res.json({ ok: true });
});

app.get('/api/blocked', auth, (req, res) => {
    const list = (DB.blocked[req.user.username] || []).map(u => ({ username: u, displayName: (DB.users[u] || {}).displayName || u }));
    res.json({ blocked: list });
});

app.post('/api/chat/start', auth, (req, res) => {
    const id = [req.user.username, req.body.withUser].sort().join('::');
    if (!DB.messages[id]) DB.messages[id] = [];
    res.json({ chatId: id });
});

app.get('/api/chats', auth, (req, res) => {
    const chats = [];
    Object.keys(DB.messages).forEach(id => {
        if (id.startsWith('ch:')) return;
        if (!id.includes(req.user.username)) return;
        const msgs = DB.messages[id];
        if (!msgs.length) return;
        const other = id.split('::').find(u => u !== req.user.username);
        const ou = DB.users[other];
        if (!ou) return;
        chats.push({ chatId: id, partner: { username: other, displayName: ou.displayName, isAdmin: ou.isAdmin }, lastMessage: msgs[msgs.length - 1], isBlocked: (DB.blocked[req.user.username] || []).includes(other) });
    });
    chats.sort((a, b) => (b.lastMessage?.ts || 0) - (a.lastMessage?.ts || 0));
    res.json({ chats });
});

app.get('/api/messages/:chatId', auth, (req, res) => {
    const msgs = DB.messages[req.params.chatId] || [];
    let partner = { username: '', displayName: '' };
    if (!req.params.chatId.startsWith('ch:')) {
        const other = req.params.chatId.split('::').find(u => u !== req.user.username);
        if (other && DB.users[other]) partner = { username: other, displayName: DB.users[other].displayName };
    }
    res.json({ messages: msgs, partner, isBlocked: (DB.blocked[req.user.username] || []).includes(partner.username) });
});

app.post('/api/messages/:chatId', auth, (req, res) => {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'empty' });
    if (!DB.messages[req.params.chatId]) DB.messages[req.params.chatId] = [];
    DB.messages[req.params.chatId].push({ from: req.user.username, fromDisplayName: req.user.displayName, text, ts: Date.now() });
    res.json({ messages: DB.messages[req.params.chatId] });
});

app.post('/api/channel/create', auth, (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name || name.length < 3) return res.status(400).json({ error: 'short' });
    const id = 'ch_' + Date.now();
    DB.channels[id] = { name, desc: req.body.desc || '', owner: req.user.username, subs: [req.user.username] };
    res.json({ channel: DB.channels[id], id });
});

app.get('/api/channels', auth, (req, res) => {
    const list = Object.keys(DB.channels).map(id => ({ id, ...DB.channels[id], subsCount: DB.channels[id].subs.length, isSubbed: DB.channels[id].subs.includes(req.user.username) }));
    res.json({ channels: list });
});

app.get('/api/channel/:id/messages', auth, (req, res) => {
    const ch = DB.channels[req.params.id];
    const msgs = DB.messages['ch:' + req.params.id] || [];
    res.json({ messages: msgs, channel: ch ? { name: ch.name, subsCount: ch.subs.length } : null });
});

app.post('/api/channel/:id/subscribe', auth, (req, res) => {
    const ch = DB.channels[req.params.id];
    if (!ch) return res.status(404).json({ error: 'not found' });
    if (!ch.subs.includes(req.user.username)) ch.subs.push(req.user.username);
    res.json({ ok: true });
});

app.delete('/api/channel/:id', auth, (req, res) => {
    const ch = DB.channels[req.params.id];
    if (!ch) return res.status(404).json({ error: 'not found' });
    if (ch.owner !== req.user.username && !req.user.isAdmin) return res.status(403).json({ error: 'denied' });
    delete DB.channels[req.params.id];
    delete DB.messages['ch:' + req.params.id];
    res.json({ ok: true });
});

app.get('/api/admin/stats', auth, (req, res) => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'denied' });
    let totalMsgs = 0;
    Object.values(DB.messages).forEach(m => totalMsgs += m.length);
    res.json({ totalUsers: Object.keys(DB.users).length, totalMessages: totalMsgs, totalChannels: Object.keys(DB.channels).length });
});

app.post('/api/admin/boost-subs', auth, (req, res) => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'denied' });
    const ch = DB.channels[req.body.channelId];
    if (!ch) return res.status(404).json({ error: 'not found' });
    for (let i = 0; i < (req.body.count || 100); i++) {
        const name = 'sub_' + Date.now() + '_' + i;
        if (!DB.users[name]) { DB.users[name] = { username: name, displayName: 'Подписчик ' + (i + 1), isAdmin: false }; DB.blocked[name] = []; }
        if (!ch.subs.includes(name)) ch.subs.push(name);
    }
    res.json({ ok: true });
});

app.post('/api/admin/boost-messages', auth, (req, res) => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'denied' });
    const texts = ['🔥', 'Привет!', 'Как дела?', 'Отлично!', '👍', 'Супер!'];
    if (!DB.messages[req.body.chatId]) DB.messages[req.body.chatId] = [];
    for (let i = 0; i < (req.body.count || 50); i++) {
        DB.messages[req.body.chatId].push({ from: req.user.username, fromDisplayName: req.user.displayName, text: texts[Math.floor(Math.random() * texts.length)], ts: Date.now() - i * 60000 });
    }
    res.json({ ok: true });
});

app.post('/api/admin/fake-users', auth, (req, res) => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'denied' });
    const names = ['Алекс', 'Мария', 'Дмитрий', 'Анна', 'Сергей', 'Елена', 'Иван', 'Ольга'];
    for (let i = 0; i < (req.body.count || 10); i++) {
        const name = 'user_' + Date.now() + '_' + i;
        if (!DB.users[name]) { DB.users[name] = { username: name, displayName: names[i % names.length] + ' ' + (i + 1), isAdmin: false }; DB.blocked[name] = []; }
    }
    res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('OK'));
