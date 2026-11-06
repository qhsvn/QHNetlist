// Chạy Vite dev server + Electron cùng lúc.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[netlist] Vite: ${url}`);

await import('./build-electron.mjs');

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, NETLIST_DEV_URL: url } });
child.on('close', async (code) => { await server.close(); process.exit(code ?? 0); });
process.on('SIGINT', () => child.kill());
