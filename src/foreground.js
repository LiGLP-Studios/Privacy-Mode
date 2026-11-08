// Which game is in front? Only used with Privacy mode off ("Clips named and sorted by game").
// A small PowerShell helper stays open while it is needed and answers one line per question, so a hotkey
// press costs a few milliseconds instead of starting PowerShell every time.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class ClipHubForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  // Window covers its whole monitor: fullscreen or borderless, as games are.
  public static bool Fullscreen(IntPtr hWnd) {
    RECT r; if (!GetWindowRect(hWnd, out r)) return false;
    MONITORINFO m = new MONITORINFO(); m.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(hWnd, 2), ref m)) return false;
    return r.Left <= m.rcMonitor.Left && r.Top <= m.rcMonitor.Top && r.Right >= m.rcMonitor.Right && r.Bottom >= m.rcMonitor.Bottom;
  }
}
"@
[Console]::Out.WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $hwnd = [ClipHubForeground]::GetForegroundWindow()
  $procId = [uint32]0
  [void][ClipHubForeground]::GetWindowThreadProcessId($hwnd, [ref]$procId)
  $title = New-Object System.Text.StringBuilder 512
  [void][ClipHubForeground]::GetWindowText($hwnd, $title, 512)
  $proc = Get-Process -Id $procId
  $description = ''
  try { $description = $proc.MainModule.FileVersionInfo.FileDescription } catch {}
  $answer = @{ process = [string]$proc.ProcessName; title = $title.ToString(); description = [string]$description; fullscreen = [ClipHubForeground]::Fullscreen($hwnd) }
  [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress))
}
`;

// Not a game: the desktop, Windows itself, ClipHub.
const IGNORE = new Set(['explorer', 'shellexperiencehost', 'searchhost', 'searchapp', 'startmenuexperiencehost', 'lockapp',
  'textinputhost', 'applicationframehost', 'electron', 'cliphub', 'veloframe', 'idle', 'taskmgr', '']);
// Runtimes that run many different games: the window title says more than the program name.
const GENERIC = new Set(['javaw', 'java', 'python', 'pythonw', 'love', 'godot']);

// File and folder safe, short, no trailing dots or spaces (Windows rules).
export function safeName(name) {
  const clean = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) return '';
  return clean;
}

export function gameName(info) {
  if (!info) return '';
  const process = String(info.process || '').toLowerCase();
  if (IGNORE.has(process)) return '';
  if (GENERIC.has(process)) return safeName(String(info.title || '').split(' - ')[0]);
  return safeName(info.description || info.process || '');
}

export class Foreground {
  constructor() {
    this.child = null;
    this.ready = null;
    this.queue = [];
  }

  start() {
    if (this.child) return this.ready;
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    });
    this.child = child;
    let resolveReady;
    this.ready = new Promise((resolve) => { resolveReady = resolve; });
    createInterface({ input: child.stdout }).on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.ready) { resolveReady(true); return; }
      const next = this.queue.shift();
      if (next) next(message);
    });
    const gone = () => {
      if (this.child !== child) return;
      this.child = null;
      resolveReady(false);
      for (const next of this.queue.splice(0)) next(null);
    };
    child.on('exit', gone);
    child.on('error', gone);
    return this.ready;
  }

  // The game in front right now, or '' (desktop, unknown, helper not ready within the time limit).
  async current(timeout = 600) {
    return gameName(await this.query(timeout));
  }

  nameOf(info) { return gameName(info); }

  // The raw answer { process, title, description, fullscreen } for the window in front, or null.
  async query(timeout = 600) {
    const started = await Promise.race([this.start(), new Promise((r) => setTimeout(() => r(false), timeout))]);
    if (!started || !this.child) return null;
    const answer = await new Promise((resolve) => {
      // A late answer still belongs to this question: keep its place in the queue, just ignore it.
      let waiting = true;
      const timer = setTimeout(() => { waiting = false; resolve(null); }, timeout);
      this.queue.push((info) => { clearTimeout(timer); if (waiting) resolve(info); });
      this.child.stdin.write('?\n');
    });
    return answer;
  }

  stop() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    try { child.stdin.end(); child.kill(); } catch { /* gone */ }
  }
}

