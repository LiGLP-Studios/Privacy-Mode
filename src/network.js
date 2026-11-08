// Privacy mode on: nothing ClipHub does may leave the PC. One gate for every way the app could go online:
//   - pages and windows (Chromium): every request of every session goes through webRequest, anything not local is cancelled
//   - the main process: fetch (Node's and Electron's net.fetch) and net.request refuse non-local addresses
// Local stays allowed: the app's own files, the clip scheme, data/blob URLs, localhost.
// Discord Rich Presence is not network: it talks to the Discord app on this PC (see discord.js; Strict mode turns it off).
import { app, net, session } from 'electron';

const LOCAL_SCHEMES = new Set(['file:', 'data:', 'blob:', 'devtools:', 'chrome:', 'chrome-extension:', 'about:']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

let blocked = true; // safe until the settings say otherwise
let onBlocked = () => {};
const guarded = new WeakSet();

export function isLocal(url, ownSchemes = []) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return false; }
  if (LOCAL_SCHEMES.has(parsed.protocol) || ownSchemes.includes(parsed.protocol.slice(0, -1))) return true;
  return LOCAL_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith('.localhost');
}

export const isBlocked = () => blocked;

// Privacy mode on (normal or strict) → blocked. Takes effect at once, also for windows already open.
export function setBlocked(on) {
  blocked = !!on;
}

function refuse(url) {
  onBlocked(String(url));
  return new Error(`ClipHub privacy mode: blocked ${url}`);
}

function guardSession(ses, ownSchemes) {
  if (!ses || guarded.has(ses)) return;
  guarded.add(ses);
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (blocked && !isLocal(details.url, ownSchemes)) {
      onBlocked(details.url);
      callback({ cancel: true });
      return;
    }
    callback({});
  });
}

// Call once, before the first window. ownSchemes: the app's own protocols (e.g. 'cliphub-media').
export function installNetworkGuard({ ownSchemes = [], log } = {}) {
  if (log) onBlocked = (url) => log('privacy mode: blocked', url.slice(0, 200));
  const urlOf = (input) => (typeof input === 'string' ? input : input?.url ?? input?.href ?? String(input));

  const nodeFetch = globalThis.fetch;
  if (nodeFetch) {
    globalThis.fetch = (input, init) => (blocked && !isLocal(urlOf(input), ownSchemes)
      ? Promise.reject(refuse(urlOf(input))) : nodeFetch(input, init));
  }
  const netFetch = net.fetch.bind(net);
  net.fetch = (input, init) => (blocked && !isLocal(urlOf(input), ownSchemes)
    ? Promise.reject(refuse(urlOf(input))) : netFetch(input, init));
  const netRequest = net.request.bind(net);
  net.request = (options) => {
    const url = typeof options === 'string' ? options : options?.url
      ?? `${options?.protocol || 'https:'}//${options?.hostname || options?.host || ''}${options?.path || '/'}`;
    if (blocked && !isLocal(url, ownSchemes)) throw refuse(url);
    return netRequest(options);
  };

  app.whenReady().then(() => guardSession(session.defaultSession, ownSchemes));
  app.on('session-created', (ses) => guardSession(ses, ownSchemes));
}
