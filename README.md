# ClipHub Privacy mode

This is the code behind **Privacy mode** in [ClipHub](https://cliphub.liglp.de), published so you can check it yourself instead of taking our word for it.
The files in `src/` are the same files that ship inside the app. They are not rewritten for show.

## The three settings

| Setting | Internet | Discord status | Game names |
|---|---|---|---|
| **Privacy mode on** (default) | blocked | "Clipping With Cliphub", no game | not detected |
| **Strict** | blocked | off | not detected |
| **Privacy mode off** | allowed | "Clipping *Game* With Cliphub" | in file and folder names, with notification previews |

You can change this at any time under **Settings → Privacy**. The change takes effect immediately, with no restart.

## What each file does

### [`src/network.js`](src/network.js): the network block
With Privacy mode on (normal or Strict), it blocks every way ClipHub could go online:

- **Windows and pages** (Chromium): every request from every session goes through `webRequest.onBeforeRequest`. Anything that isn't local is cancelled. This also covers windows opened later (`session-created`).
- **Main process**: `fetch`, Electron's `net.fetch` and `net.request` refuse any address that isn't local.

Local stays allowed: the app's own files, the clip protocol (`cliphub-media:`), `data:` / `blob:` URLs and `localhost`.
Each blocked request is written to the local log (`%APPDATA%\ClipHub\cliphub.log`, line `privacy mode: blocked …`), so you can see what was stopped.
The block is on from the very first moment and is only lifted once the saved settings say Privacy mode is off.

### [`src/discord.js`](src/discord.js): Discord Rich Presence
- This file talks only to the **Discord app on your PC**, over its local pipe (`\\.\pipe\discord-ipc-N`). ClipHub itself does not go online for this.
- With Privacy mode on, the status never contains the game. It only says "Clipping With Cliphub · On Windows".
- **Strict** turns the status off completely, because Discord forwards it to its servers.
- The Discord application ID in the file is public by design (Discord shows it to everyone), so it is not a secret.

### [`src/foreground.js`](src/foreground.js): game detection
- This file asks Windows which program is in front (window title and program name), using a small local PowerShell helper.
- **It only runs with Privacy mode off.** With Privacy mode on, ClipHub never starts it. If it is already running, it is stopped.
- Nothing it finds leaves your PC. It is only used for clip file names, folder names and the Discord status.

## Check it yourself

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm test
```

The test starts Electron without a visible window. It tries to reach `https://example.com` in all three ways, first with Privacy mode on and then with it off. With Privacy mode on, every attempt must be refused:

```
Privacy mode ON  (everything must be refused):
  Node fetch           refused (ClipHub privacy mode: blocked https://example.com)
  Electron net.fetch   refused (ClipHub privacy mode: blocked https://example.com)
  page / window        refused (Failed to fetch)
```

To check that your installed ClipHub contains exactly these files, compare their checksums:

```bash
npm run checksums -- "C:\path\to\ClipHub\resources\app\src\main"
```

You can also watch ClipHub with a network monitor (Windows Resource Monitor, Wireshark, GlassWire) while switching Privacy mode on and off.

## License

The code is published for review and verification only. See [LICENSE.md](LICENSE.md).
