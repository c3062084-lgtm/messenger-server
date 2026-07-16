const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

const DB = { users: {}, messages: {}, channels: {}, tokens: {}, blocked: {} };
DB.users['boss'] = { username: 'boss', displayName: 'BOSS', isAdmin: true, createdAt: Date.now() };
DB.blocked['boss'] = [];

function getChatId(u1, u2) { return [u1, u2].sort().join('::'); }

app.post('/api/login', (req, res) => {
    const { username, displayName } = req.body;
    if (!username || !displayName) return res.status(400).json({ error: 'error' });
    if (!DB.users[username]) { DB.users[username] = { username, displayName, isAdmin: false }; DB.blocked[username] = []; }
    else DB.users[username].displayName = displayName;
    const token = Math.random().toString(36);
    DB.tokens[token] = username;
    res.json({ token, user: DB.users[username] });
});

app.get('/api/me', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const user = DB.users[DB.tokens[token]];
    if (!user) return res.status(401).json({ error: 'auth' });
    res.json({ ...user, blockedCount: (DB.blocked[user.username] || []).length });
});

app.get('/api/users/search', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const me = DB.users[DB.tokens[token]];
    if (!me) return res.status(401).json({ error: 'auth' });
    const q = (req.query.q || '').toLowerCase();
    res.json({ users: Object.values(DB.users).filter(u => u.username !== me.username && (u.username.includes(q) || u.displayName.toLowerCase().includes(q))).map(u => ({ username: u.username, displayName: u.displayName, isAdmin: u.isAdmin })) });
});

app.get('/api/users/:username', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const me = DB.users[DB.tokens[token]];
    if (!me) return res.status(401).json({ error: 'auth' });
    const user = DB.users[req.params.username];
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ user: { username: user.username, displayName: user.displayName, isAdmin: user.isAdmin }, isBlocked: (DB.blocked[me.username] || []).includes(req.params.username) });
});

app.post('/api/users/:username/block', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const me = DB.users[DB.tokens[token]];
    if (!me) return res.status(401).json({ error: 'auth' });
    if (!DB.blocked[me.username].includes(req.params.username)) DB.blocked[me.username].push(req.params.username);
    res.json({ success: true });
});

app.delete('/api/users/:username/block', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const me = DB.users[DB.tokens[token]];
    if (!me) return res.status(401).json({ error: 'auth' });
    DB.blocked[me.username] = DB.blocked[me.username].filter(u => u !== req.params.username);
    res.json({ success: true });
});

app.post('/api/chats/start', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const me = DB.users[DB.tokens[token]];
    if (!me) return res.status(401).json({ error: 'auth' });
    const chatId = getChatId(me.username, req.body.withUser);
    if (!DB.messages[chatId]) DB.messages[chatId] = [];
    res.json({ chatId });
});

app.get('/api/chats', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const me = DB.users[DB.tokens[token]];
    if (!me) return res.status(401).json({ error: 'auth' });
    const chats = [];
    Object.keys(DB.messages).forEach(chatId => {
        if (!chatId.includes(me.username)) return;
        const msgs = DB.messages[chatId];
        if (!msgs.length) return;
        const other = chatId.split('::').find(u => u !== me.username);
        const ou = DB.users[other];
        if (!ou) return;
        chats.push({ chatId, partner: { username: other, displayName: ou.displayName, isAdmin: ou.isAdmin }, lastMessage: msgs[msgs.length - 1], unread: 0, isBlocked: (DB.blocked[me.username] || []).includes(other) });
    });
    res.json({ chats });
});

app.get('/api/messages/:chatId', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const me = DB.users[DB.tokens[token]];
    if (!me) return res.status(401).json({ error: 'auth' });
    const msgs = DB.messages[req.params.chatId] || [];
    const other = req.params.chatId.split('::').find(u => u !== me.username);
    const ou = DB.users[other] || { username: other, displayName: other };
    res.json({ messages: msgs, partner: { username: other, displayName: ou.displayName, isAdmin: ou.isAdmin } });
});

app.post('/api/messages/:chatId', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const me = DB.users[DB.tokens[token]];
    if (!me) return res.status(401).json({ error: 'auth' });
    if (!DB.messages[req.params.chatId]) DB.messages[req.params.chatId] = [];
    DB.messages[req.params.chatId].push({ from: me.username, fromDisplayName: me.displayName, text: req.body.text, ts: Date.now() });
    res.json({ messages: DB.messages[req.params.chatId] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('OK'));
