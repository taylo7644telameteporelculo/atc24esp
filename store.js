const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

const DEFAULT_STATE = {
  plans: [],
  atc: [],
  atis: {},
  events: [],
  chat: [],
  notifs: [],
  academy: {},
  activity: [],
  news: [],
  users: {},
  settings: {},
  gallery: [],
  resources: [],
  readings: [],
  discordCounts: { pilots: 0, controllers: 0, total: 0, updatedAt: 0 },
};

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

let state = load();
let saveTimer = null;

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
  }, 250);
}

function getState() {
  return state;
}

// patch: partial object with any of the DEFAULT_STATE keys; each provided
// key fully replaces that slice (the frontend always sends whole arrays/objects).
function applyPatch(patch) {
  for (const key of Object.keys(DEFAULT_STATE)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      state[key] = patch[key];
    }
  }
  saveSoon();
  return state;
}

// Registro persistente de usuarios reales autenticados con Discord (no borra el historial al cerrar sesión).
function upsertUser(user) {
  state.users = { ...state.users, [user.id]: { id: user.id, username: user.username, avatar: user.avatar, role: user.role, lastSeen: Date.now() } };
  saveSoon();
  return state;
}

function getSettings() {
  return state.settings || {};
}

function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  saveSoon();
  return state;
}

function setDiscordCounts(counts) {
  state.discordCounts = { ...counts, updatedAt: Date.now() };
  saveSoon();
  return state;
}

module.exports = { getState, applyPatch, upsertUser, getSettings, updateSettings, setDiscordCounts, DEFAULT_STATE };
