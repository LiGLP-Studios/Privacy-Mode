// Discord Rich Presence: "Clipping With Cliphub · On Windows", or "Clipping <Game> With Cliphub" while a game is in front.
// Talks to the Discord desktop app over its local pipe (\\.\pipe\discord-ipc-N), no extra package, nothing goes online.
// Discord not running, or closed later: ClipHub just tries again every so often. Privacy mode on: never names the game.
// Privacy mode Strict: no Discord status at all (Discord would carry it to its servers).
import { EventEmitter } from 'node:events';
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';

// Application ID from https://discord.com/developers/applications (the app's name there is the "Playing …" line).
// Not a secret. Empty = Rich Presence off. Dev only: CLIPHUB_DISCORD_ID overrides it.
export const DISCORD_CLIENT_ID = '1427780446015586405';
// Name of the image uploaded under Rich Presence → Art Assets (optional: without it Discord shows no picture).
const LARGE_IMAGE = 'cliphub-violett-quadrat-1024';

const OP = { handshake: 0, frame: 1, close: 2, ping: 3, pong: 4 };
const RECONNECT_MS = 15000;
const POLL_MS = 10000;

// Fullscreen programs that are not games: browsers, players, chat, editors.
const NOT_GAMES = new Set(['chrome', 'msedge', 'firefox', 'opera', 'opera_gx', 'brave', 'vivaldi', 'discord', 'discordptb',
  'discordcanary', 'spotify', 'vlc', 'mpc-hc64', 'mpc-be64', 'potplayermini64', 'code', 'devenv', 'obs64', 'steamwebhelper',
  'steam', 'epicgameslauncher', 'battle.net', 'teams', 'ms-teams', 'zoom', 'powerpnt', 'winword', 'excel', 'notepad',
  'windowsterminal', 'cmd', 'powershell', 'photos', 'microsoft.media.player', 'netflix']);

function frame(op, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

// One connection to the Discord app. Emits 'ready' after the handshake and 'closed' when it goes away.
class DiscordIpc extends EventEmitter {
  constructor(clientId) {
    super();
    this.clientId = clientId;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
  }

  async open() {
    // Discord takes the first free pipe 0–9 (two Discord builds running = two pipes).
    for (let i = 0; i < 10; i++) {
      const socket = await new Promise((resolve) => {
        const s = connect(`\\\\?\\pipe\\discord-ipc-${i}`);
        s.once('connect', () => resolve(s));
        s.once('error', () => resolve(null));
      });
      if (socket) return this.attach(socket);
    }
    return false;
  }

  attach(socket) {
    this.socket = socket;
    socket.on('data', (chunk) => this.read(chunk));
    const gone = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.emit('closed');
    };
    socket.on('close', gone);
    socket.on('error', gone);
    socket.write(frame(OP.handshake, { v: 1, client_id: this.clientId }));
    return true;
  }

  read(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + length) return;
      let message = null;
      try { message = JSON.parse(this.buffer.subarray(8, 8 + length).toString('utf8')); } catch { /* skip */ }
      this.buffer = this.buffer.subarray(8 + length);
      if (op === OP.ping) this.socket?.write(frame(OP.pong, message));
      else if (op === OP.close) { this.emit('error', message); this.close(); }
      else if (message?.evt === 'READY') this.emit('ready', message.data?.user);
      else if (message?.evt === 'ERROR') this.emit('error', message.data);
    }
  }

  setActivity(activity) {
    this.socket?.write(frame(OP.frame, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: randomUUID() }));
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    try { socket?.end(); socket?.destroy(); } catch { /* gone */ }
  }
}

export class DiscordPresence extends EventEmitter {
  // foreground: the recorder's Foreground helper (shared, so only one PowerShell runs).
  constructor(foreground, clientId = process.env.CLIPHUB_DISCORD_ID || DISCORD_CLIENT_ID) {
    super();
    this.foreground = foreground;
    this.clientId = String(clientId || '').trim();
    this.ipc = null;
    this.ready = false;
    this.privacyMode = true;
    this.game = '';
    this.sent = '';
    this.startedAt = Date.now();
    this.pollTimer = null;
    this.retryTimer = null;
    this.stopped = true;
  }

  get enabled() { return /^\d{17,20}$/.test(this.clientId); }

  static allowedBy(settings) { return !(settings.privacyMode && settings.privacyStrict); }

  start(settings) {
    if (!this.enabled || !this.stopped || !DiscordPresence.allowedBy(settings)) return;
    this.stopped = false;
    this.privacyMode = settings.privacyMode;
    this.connect();
    this.pollTimer = setInterval(() => this.poll(), POLL_MS);
  }

  apply(settings) {
    if (!DiscordPresence.allowedBy(settings)) { if (!this.stopped) this.stop(); return; }
    if (this.stopped) { this.start(settings); return; }
    if (this.privacyMode === settings.privacyMode) return;
    this.privacyMode = settings.privacyMode;
    if (this.privacyMode) this.game = '';
    this.update();
    this.poll();
  }

  async connect() {
    if (this.stopped || this.ipc) return;
    const ipc = new DiscordIpc(this.clientId);
    this.ipc = ipc;
    ipc.on('ready', (user) => {
      this.ready = true;
      this.sent = '';
      this.emit('connected', user?.username || '');
      this.update();
    });
    ipc.on('error', (error) => this.emit('error', error));
    ipc.on('closed', () => this.lost(ipc));
    if (!(await ipc.open())) this.lost(ipc);
  }

  lost(ipc) {
    if (this.ipc !== ipc) return;
    if (this.ready) this.emit('disconnected');
    this.ipc = null;
    this.ready = false;
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), RECONNECT_MS);
  }

  // Which game is in front: only a fullscreen (or borderless) window that isn't a browser, player or chat.
  async poll() {
    if (!this.ready) return;
    let game = '';
    if (!this.privacyMode) {
      const info = await this.foreground.query().catch(() => null);
      const process = String(info?.process || '').toLowerCase();
      if (info?.fullscreen && !NOT_GAMES.has(process)) game = this.foreground.nameOf(info);
    }
    if (game === this.game) return;
    this.game = game;
    this.startedAt = Date.now();
    this.update();
  }

  update() {
    if (!this.ready || !this.ipc) return;
    const activity = {
      details: this.game ? `Clipping ${this.game} With Cliphub` : 'Clipping With Cliphub',
      state: 'On Windows',
      timestamps: { start: Math.floor(this.startedAt / 1000) },
      assets: { large_image: LARGE_IMAGE, large_text: 'ClipHub' },
      instance: false,
    };
    const key = JSON.stringify(activity);
    if (key === this.sent) return; // Discord allows only a few updates per 20 seconds
    this.sent = key;
    this.ipc.setActivity(activity);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearTimeout(this.retryTimer);
    if (this.ready) this.ipc?.setActivity(null);
    this.ipc?.close();
    this.ipc = null;
    this.ready = false;
  }
}
