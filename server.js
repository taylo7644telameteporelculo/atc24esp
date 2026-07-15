const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');
const store = require('./store');

const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID,
  DISCORD_REDIRECT_URI,
  ROLE_ID_ADMIN,
  ROLE_ID_CONTROLLER,
  ROLE_ID_PILOT,
  SESSION_SECRET,
  PORT = 3000,
} = process.env;

const REQUIRED = {
  DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID, DISCORD_REDIRECT_URI, SESSION_SECRET,
};
const missing = Object.entries(REQUIRED).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error('Faltan variables en .env:', missing.join(', '));
  console.error('Copia backend/.env.example a backend/.env y complétalo con tus credenciales de Discord.');
  process.exit(1);
}

const app = express();
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

const COOKIE_NAME = 'atc24_session';
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 };

function getSessionUser(req) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return null;
  try { return jwt.verify(token, SESSION_SECRET); } catch { return null; }
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'not_authed' });
  req.user = user;
  next();
}

function roleForMember(discordRoleIds) {
  if (ROLE_ID_ADMIN && discordRoleIds.includes(ROLE_ID_ADMIN)) return 'admin';
  if (ROLE_ID_CONTROLLER && discordRoleIds.includes(ROLE_ID_CONTROLLER)) return 'controller';
  if (ROLE_ID_PILOT && discordRoleIds.includes(ROLE_ID_PILOT)) return 'pilot';
  return 'pilot';
}

// Cuenta miembros reales del servidor de Discord con el rol de piloto o de controlador/admin
// (no solo los que se han verificado en el sitio). Requiere el "Server Members Intent"
// activado en el Developer Portal (pestaña Bot) para tu aplicación.
async function refreshDiscordCounts() {
  try {
    let after = '0';
    let pilots = 0, controllers = 0;
    for (let page = 0; page < 20; page++) {
      const res = await fetch(
        `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members?limit=1000&after=${after}`,
        { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
      );
      if (!res.ok) {
        console.error('[discord counts] fetch failed:', res.status, '— ¿activaste "Server Members Intent" en el Developer Portal?');
        return;
      }
      const members = await res.json();
      for (const m of members) {
        const roles = m.roles || [];
        if (ROLE_ID_PILOT && roles.includes(ROLE_ID_PILOT)) pilots++;
        if (ROLE_ID_CONTROLLER && roles.includes(ROLE_ID_CONTROLLER)) controllers++;
        else if (ROLE_ID_ADMIN && roles.includes(ROLE_ID_ADMIN)) controllers++;
      }
      if (members.length < 1000) break;
      after = members[members.length - 1].user.id;
    }
    store.setDiscordCounts({ pilots, controllers });
    io.emit('state:patch', { discordCounts: store.getState().discordCounts });
  } catch (err) {
    console.error('[discord counts] error:', err.message);
  }
}

app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    prompt: 'consent',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?discord=error&reason=' + encodeURIComponent(error));
  if (!code) return res.redirect('/?discord=error&reason=missing_code');

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) throw new Error('token exchange failed: ' + tokenRes.status);
    const token = await tokenRes.json();

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!userRes.ok) throw new Error('user fetch failed: ' + userRes.status);
    const discordUser = await userRes.json();

    const memberRes = await fetch(
      `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${discordUser.id}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    );
    if (memberRes.status === 404) {
      return res.redirect('/?discord=error&reason=not_member');
    }
    if (!memberRes.ok) throw new Error('member fetch failed: ' + memberRes.status);
    const member = await memberRes.json();

    const role = roleForMember(member.roles || []);
    const avatar = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
      : null;

    const sessionUser = {
      id: discordUser.id,
      username: member.nick || discordUser.global_name || discordUser.username,
      avatar,
      role,
    };

    store.upsertUser(sessionUser);
    io.emit('state:patch', { users: store.getState().users });

    const jwtToken = jwt.sign(sessionUser, SESSION_SECRET, { expiresIn: '7d' });
    res.cookie(COOKIE_NAME, jwtToken, COOKIE_OPTS);
    res.redirect('/?discord=success');
  } catch (err) {
    console.error('[discord oauth] error:', err.message);
    res.redirect('/?discord=error&reason=server_error');
  }
});

app.get('/api/me', (req, res) => {
  const user = getSessionUser(req);
  res.json(user ? { authed: true, user } : { authed: false });
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// Estado compartido en vivo (planes, ATC, ATIS, eventos, chat, academia, actividad, noticias).
// Lectura pública (modo solo lectura para quien no se ha verificado); escritura requiere sesión.
app.get('/api/state', (req, res) => {
  res.json(store.getState());
});

// 'users' y 'discordCounts' se administran solo desde el servidor, nunca desde este endpoint.
const CLIENT_WRITABLE_KEYS = Object.keys(store.DEFAULT_STATE).filter(k => k !== 'users' && k !== 'discordCounts');
const ADMIN_ONLY_KEYS = ['settings', 'resources'];

app.post('/api/state', requireAuth, (req, res) => {
  const patch = req.body || {};
  const allowed = {};
  for (const key of CLIENT_WRITABLE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    if (ADMIN_ONLY_KEYS.includes(key) && req.user.role !== 'admin') continue;
    allowed[key] = patch[key];
  }
  const next = store.applyPatch(allowed);
  io.emit('state:patch', allowed);
  res.json({ ok: true, state: next });
});

// ===== Subida de archivos (fotos de galería/noticias/eventos, PDFs de recursos) =====
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'application/pdf': '.pdf',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = ALLOWED_MIME[file.mimetype] || '';
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!ALLOWED_MIME[file.mimetype]),
});

app.post('/api/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'upload_failed' });
    if (!req.file) return res.status(400).json({ error: 'tipo de archivo no permitido (solo jpg/png/webp/gif/pdf, máx 10MB)' });
    res.json({ url: '/uploads/' + req.file.filename, kind: req.file.mimetype === 'application/pdf' ? 'pdf' : 'image' });
  });
});

// Sirve SOLO la carpeta public/, nunca la raíz del proyecto (donde vive .env).
const siteRoot = path.join(__dirname, 'public');
app.use(express.static(siteRoot));
app.get('/', (req, res) => res.sendFile(path.join(siteRoot, 'index.html')));

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: false });

io.on('connection', (socket) => {
  socket.emit('state:patch', store.getState());
});

// Algunos hostings (Pterodactyl/HidenCloud) asignan el puerto real vía SERVER_PORT,
// distinto del PORT que usamos en .env para desarrollo local.
const LISTEN_PORT = process.env.SERVER_PORT || PORT;
httpServer.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`ATC24 Web + Discord OAuth + tiempo real escuchando en puerto ${LISTEN_PORT}`);
  refreshDiscordCounts();
  setInterval(refreshDiscordCounts, 5 * 60 * 1000);
});
