import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// CSP chỉ chèn ở bản build (dev server của Vite cần script inline cho HMR)
const csp: Plugin = {
  name: 'netlist-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://localhost:* http://127.0.0.1:* https:; font-src 'self' data:" />`,
    ),
};

export default defineConfig({
  base: './',
  plugins: [react(), csp],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
