// Checks the network block for yourself: npm install, then npm test.
// Starts Electron (no window on screen), tries to reach https://example.com in the three ways the app could,
// once with Privacy mode on and once with it off.
import { app, BrowserWindow, net } from 'electron';
import { installNetworkGuard, setBlocked } from '../src/network.js';

const blocked = [];
installNetworkGuard({ ownSchemes: ['cliphub-media'], log: (_msg, url) => blocked.push(url) });

const TARGET = 'https://example.com';
const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
const outcome = (promise) => Promise.race([promise, timeout(10000)]).then(() => 'reached', (e) => `refused (${e.message.slice(0, 60)})`);

async function tryAll() {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<p>test</p>');
  const result = {
    'Node fetch': await outcome(fetch(TARGET)),
    'Electron net.fetch': await outcome(net.fetch(TARGET)),
    'page / window': await win.webContents.executeJavaScript(
      `fetch(${JSON.stringify(TARGET)}, { mode: 'no-cors' }).then(() => 'reached', (e) => 'refused (' + e.message + ')')`),
  };
  win.destroy();
  return result;
}

app.on('window-all-closed', () => {}); // keep running between the two rounds
app.whenReady().then(async () => {
  setBlocked(true);
  const on = await tryAll();
  setBlocked(false);
  const off = await tryAll();

  console.log('\nPrivacy mode ON  (everything must be refused):');
  for (const [way, r] of Object.entries(on)) console.log(`  ${way.padEnd(20)} ${r}`);
  console.log('\nPrivacy mode OFF (reached, if this PC is online):');
  for (const [way, r] of Object.entries(off)) console.log(`  ${way.padEnd(20)} ${r}`);
  console.log(`\nBlocked and logged: ${blocked.length} request(s)`);

  const passed = Object.values(on).every((r) => r.startsWith('refused'));
  console.log(passed ? '\nPASS: nothing got out with Privacy mode on.\n' : '\nFAIL: something got out with Privacy mode on.\n');
  app.exit(passed ? 0 : 1);
});
