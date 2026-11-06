// Electron main process: cửa sổ, lưu cài đặt, API key mã hoá (safeStorage), gateway AI và tiến trình ngspice.
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { listModels, streamChat, type ChatRequest, type ProviderId } from '../src/ai/providers';
import { compileSpice } from '../src/core/spice';
import { parseNgspiceOp, parseWrdata } from '../src/core/ngspiceParse';
import type { CircuitDocument, SimResult } from '../src/core/types';

interface Settings { ngspicePath?: string; keys: Partial<Record<ProviderId, string>> }

const settingsFile = () => join(app.getPath('userData'), 'netlist-settings.json');
function loadSettings(): Settings {
  try { return { keys: {}, ...JSON.parse(readFileSync(settingsFile(), 'utf8')) }; } catch { return { keys: {} }; }
}
function saveSettings(s: Settings) { writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); }

function encrypt(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(plain).toString('base64');
  return 'raw:' + Buffer.from(plain, 'utf8').toString('base64');
}
function decrypt(stored?: string): string | undefined {
  if (!stored) return undefined;
  if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
  if (stored.startsWith('raw:')) return Buffer.from(stored.slice(4), 'base64').toString('utf8');
  return undefined;
}

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0d0b14',
    title: 'Netlist',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devUrl = process.env.NETLIST_DEV_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  // Liên kết ngoài mở bằng trình duyệt hệ thống, không mở trong app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (url !== win?.webContents.getURL()) e.preventDefault(); });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------------- ngspice ----------------
function ngspiceCandidates(): string[] {
  const s = loadSettings();
  const list: string[] = [];
  if (s.ngspicePath) list.push(s.ngspicePath);
  if (process.env.NGSPICE_PATH) list.push(process.env.NGSPICE_PATH);
  const resources = process.resourcesPath ? join(process.resourcesPath, 'ngspice', 'bin') : '';
  if (process.platform === 'win32') {
    if (resources) list.push(join(resources, 'ngspice_con.exe'));
    list.push(join(app.getAppPath(), 'vendor', 'ngspice', 'Spice64', 'bin', 'ngspice_con.exe'));
    list.push('C:\\Spice64\\bin\\ngspice_con.exe', 'C:\\Program Files\\Spice64\\bin\\ngspice_con.exe', 'ngspice_con.exe', 'ngspice_con', 'ngspice');
  } else {
    if (resources) list.push(join(resources, 'ngspice'));
    list.push('/usr/bin/ngspice', '/usr/local/bin/ngspice', '/opt/homebrew/bin/ngspice', 'ngspice');
  }
  return list;
}

function runProcess(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; out: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    let out = '';
    let timedOut = false;
    const p = spawn(bin, args, { cwd, windowsHide: true });
    const timer = setTimeout(() => { timedOut = true; p.kill(); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d.toString(); if (out.length > 2e6) out = out.slice(-2e6); });
    p.stderr.on('data', (d) => { out += d.toString(); });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, timedOut }); });
  });
}

let cachedBin: string | null | undefined;
async function findNgspice(force = false): Promise<{ bin: string | null; version?: string }> {
  if (!force && cachedBin !== undefined) return { bin: cachedBin };
  for (const c of ngspiceCandidates()) {
    if ((c.includes('/') || c.includes('\\')) && !existsSync(c)) continue;
    try {
      const r = await runProcess(c, ['-v'], tmpdir(), 5000);
      if (/ngspice/i.test(r.out)) {
        cachedBin = c;
        return { bin: c, version: r.out.match(/ngspice[- ]?(\d+[\w.]*)/i)?.[0] };
      }
    } catch { /* thử ứng viên tiếp theo */ }
  }
  cachedBin = null;
  return { bin: null };
}

const runningSims = new Map<string, () => void>();

// ---------- Biên dịch Arduino (.ino → .hex) bằng arduino-cli nếu máy có ----------
function arduinoCliCandidates(): string[] {
  const list: string[] = [];
  if (process.env.ARDUINO_CLI) list.push(process.env.ARDUINO_CLI);
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? '';
    list.push(
      join(local, 'Programs', 'Arduino IDE', 'resources', 'app', 'lib', 'backend', 'resources', 'arduino-cli.exe'),
      'C:\\Program Files\\Arduino IDE\\resources\\app\\lib\\backend\\resources\\arduino-cli.exe',
      'C:\\Program Files\\Arduino CLI\\arduino-cli.exe',
      'arduino-cli.exe', 'arduino-cli',
    );
  } else list.push('/usr/local/bin/arduino-cli', '/usr/bin/arduino-cli', '/opt/homebrew/bin/arduino-cli', 'arduino-cli');
  return list;
}

async function compileArduino(fqbn: string): Promise<{ ok: boolean; name?: string; hex?: string; log: string } | null> {
  const r = await dialog.showOpenDialog(win!, { title: 'Chọn sketch Arduino (.ino)', properties: ['openFile'], filters: [{ name: 'Arduino sketch', extensions: ['ino'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  const name = basename(src, '.ino');
  let cli: string | null = null;
  for (const c of arduinoCliCandidates()) {
    if ((c.includes('/') || c.includes('\\')) && !existsSync(c)) continue;
    try { const v = await runProcess(c, ['version'], tmpdir(), 8000); if (/arduino-cli|Version/i.test(v.out)) { cli = c; break; } } catch { /* thử tiếp */ }
  }
  if (!cli) return { ok: false, name, log: 'Không tìm thấy arduino-cli. Cài Arduino IDE 2 (có sẵn arduino-cli) hoặc arduino-cli, rồi thử lại. Cách khác: trong Arduino IDE chọn Sketch → Export Compiled Binary và nạp file .hex.' };
  // arduino-cli cần thư mục sketch trùng tên file .ino; chép cả các file .h/.cpp đi kèm
  const dir = mkdtempSync(join(tmpdir(), 'netlist-ino-'));
  const sketch = join(dir, name), out = join(dir, 'out');
  mkdirSync(sketch); mkdirSync(out);
  for (const f of readdirSync(dirname(src))) if (/\.(ino|h|hpp|c|cpp)$/i.test(f)) copyFileSync(join(dirname(src), f), join(sketch, f));
  try {
    const res = await runProcess(cli, ['compile', '--fqbn', fqbn, '--output-dir', out, sketch], dir, 180000);
    const hexFile = readdirSync(out).find((f) => f.endsWith('.ino.hex') && !f.includes('bootloader'));
    if (res.code !== 0 || !hexFile) return { ok: false, name, log: res.out.slice(-6000) || 'Biên dịch thất bại' };
    return { ok: true, name: `${name}.ino`, hex: readFileSync(join(out, hexFile), 'utf8'), log: res.out.slice(-3000) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runNgspice(doc: CircuitDocument, analysis: 'op' | 'tran', runId: string): Promise<SimResult> {
  const t0 = Date.now();
  const base = { source: 'ngspice' as const, analysis, revision: doc.revision };
  const { bin } = await findNgspice();
  if (!bin) return { ...base, ok: false, error: 'NGSPICE_NOT_FOUND', log: 'Không tìm thấy ngspice.', elapsedMs: 0 };
  const dir = mkdtempSync(join(tmpdir(), 'netlist-'));
  try {
    const tranFile = join(dir, 'tran.txt');
    const compiled = compileSpice(doc, { analysis, control: { tranFile: analysis === 'tran' ? 'tran.txt' : undefined } });
    if (compiled.errors.length) return { ...base, ok: false, error: compiled.errors.join('; '), log: compiled.text, elapsedMs: 0 };
    writeFileSync(join(dir, 'circuit.cir'), compiled.text);
    let cancelled = false;
    const p = runProcess(bin, ['-b', 'circuit.cir'], dir, 30000);
    runningSims.set(runId, () => { cancelled = true; });
    const r = await p;
    runningSims.delete(runId);
    const log = `$ ${bin} -b circuit.cir\n${r.out}`;
    if (cancelled) return { ...base, ok: false, error: 'Đã huỷ', log, elapsedMs: Date.now() - t0 };
    if (r.timedOut) return { ...base, ok: false, error: 'Quá thời gian 30 s', log, elapsedMs: Date.now() - t0 };
    if (/error|singular|no convergence|timestep too small/i.test(r.out) && !r.out.includes('NETLIST_OP_BEGIN')) {
      const line = r.out.split(/\r?\n/).find((l) => /error|singular|convergence|timestep/i.test(l)) ?? 'ngspice báo lỗi';
      return { ...base, ok: false, error: line.trim(), log, elapsedMs: Date.now() - t0 };
    }
    const op = parseNgspiceOp(r.out, compiled.elementMap);
    let tran;
    if (analysis === 'tran') {
      if (!existsSync(tranFile)) return { ...base, ok: false, error: 'ngspice không tạo dữ liệu transient', op, log, elapsedMs: Date.now() - t0 };
      tran = parseWrdata(readFileSync(tranFile, 'utf8'));
    }
    return { ...base, ok: true, op, tran, log, elapsedMs: Date.now() - t0 };
  } catch (e) {
    return { ...base, ok: false, error: e instanceof Error ? e.message : String(e), log: '', elapsedMs: Date.now() - t0 };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* bỏ qua */ }
  }
}

// ---------------- IPC ----------------
const aiControllers = new Map<string, AbortController>();
const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'gemini', 'ollama', 'compatible'];
const isProvider = (p: unknown): p is ProviderId => PROVIDER_IDS.includes(p as ProviderId);

function registerIpc() {
  ipcMain.handle('settings:hasKey', (_e, provider: unknown) => isProvider(provider) && !!loadSettings().keys[provider]);
  ipcMain.handle('settings:setKey', (_e, provider: unknown, key: unknown) => {
    if (!isProvider(provider) || typeof key !== 'string') throw new Error('Tham số không hợp lệ');
    const s = loadSettings();
    if (key.trim()) s.keys[provider] = encrypt(key.trim()); else delete s.keys[provider];
    saveSettings(s);
    return true;
  });

  ipcMain.handle('ai:listModels', async (_e, provider: unknown, baseUrl: unknown) => {
    if (!isProvider(provider)) throw new Error('Nhà cung cấp không hợp lệ');
    return listModels(provider, decrypt(loadSettings().keys[provider]), typeof baseUrl === 'string' ? baseUrl : undefined);
  });

  ipcMain.on('ai:start', async (e, id: string, req: ChatRequest) => {
    const send = (type: string, payload?: unknown) => { if (!e.sender.isDestroyed()) e.sender.send('ai:event', id, type, payload); };
    if (!isProvider(req?.provider) || typeof req.system !== 'string' || !Array.isArray(req.messages)) {
      send('error', 'Yêu cầu AI không hợp lệ'); return;
    }
    const ctrl = new AbortController();
    aiControllers.set(id, ctrl);
    try {
      const apiKey = decrypt(loadSettings().keys[req.provider]);
      const result = await streamChat({ ...req, apiKey }, { onText: (d) => send('text', d), onStatus: (s) => send('status', s) }, ctrl.signal);
      send('done', result);
    } catch (err) {
      send('error', ctrl.signal.aborted ? 'Đã huỷ' : err instanceof Error ? err.message : String(err));
    } finally {
      aiControllers.delete(id);
    }
  });
  ipcMain.on('ai:cancel', (_e, id: string) => aiControllers.get(id)?.abort());

  ipcMain.handle('sim:status', async (_e, force?: boolean) => {
    const r = await findNgspice(!!force);
    return { available: !!r.bin, path: r.bin, version: r.version, configured: loadSettings().ngspicePath ?? null };
  });
  ipcMain.handle('sim:setPath', async (_e, p: unknown) => {
    const s = loadSettings();
    if (typeof p === 'string' && p.trim()) s.ngspicePath = p.trim(); else delete s.ngspicePath;
    saveSettings(s);
    const r = await findNgspice(true);
    return { available: !!r.bin, path: r.bin, version: r.version, configured: s.ngspicePath ?? null };
  });
  ipcMain.handle('sim:browse', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Chọn ngspice_con.exe', properties: ['openFile'], filters: process.platform === 'win32' ? [{ name: 'ngspice', extensions: ['exe'] }] : [] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('sim:run', (_e, doc: CircuitDocument, analysis: 'op' | 'tran', runId: string) => runNgspice(doc, analysis === 'tran' ? 'tran' : 'op', String(runId)));
  ipcMain.on('sim:cancel', (_e, runId: string) => runningSims.get(runId)?.());

  ipcMain.handle('file:save', async (_e, suggested: string, content: string, ext: string) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: suggested, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath + '.tmp', content);
    const { rename } = await import('node:fs/promises');
    await rename(r.filePath + '.tmp', r.filePath); // ghi nguyên tử qua file tạm
    return r.filePath;
  });
  ipcMain.handle('file:saveBinary', async (_e, suggested: string, base64: string, ext: string) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: suggested, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, Buffer.from(base64, 'base64'));
    return r.filePath;
  });
  ipcMain.handle('mcu:compile', (_e, fqbn: unknown) => compileArduino(fqbn === 'arduino:avr:uno' ? 'arduino:avr:uno' : 'arduino:avr:nano'));
  ipcMain.handle('file:open', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Dự án Netlist', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const content = await readFile(r.filePaths[0], 'utf8');
    if (content.length > 20e6) throw new Error('Tệp quá lớn');
    return { name: r.filePaths[0], content };
  });
}
