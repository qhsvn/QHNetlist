// Cầu nối an toàn giữa renderer và main. Chỉ lộ các kênh trong allowlist.
import { contextBridge, ipcRenderer } from 'electron';

type Handler = (type: string, payload: unknown) => void;
const aiHandlers = new Map<string, Handler>();
ipcRenderer.on('ai:event', (_e, id: string, type: string, payload: unknown) => aiHandlers.get(id)?.(type, payload));

contextBridge.exposeInMainWorld('netlistDesktop', {
  platform: process.platform,
  hasKey: (provider: string) => ipcRenderer.invoke('settings:hasKey', provider),
  setKey: (provider: string, key: string) => ipcRenderer.invoke('settings:setKey', provider, key),
  listModels: (provider: string, baseUrl?: string) => ipcRenderer.invoke('ai:listModels', provider, baseUrl),
  aiStart: (id: string, req: unknown, handler: Handler) => {
    aiHandlers.set(id, handler);
    ipcRenderer.send('ai:start', id, req);
  },
  aiCancel: (id: string) => ipcRenderer.send('ai:cancel', id),
  aiRelease: (id: string) => aiHandlers.delete(id),
  simStatus: (force?: boolean) => ipcRenderer.invoke('sim:status', force),
  simSetPath: (p: string) => ipcRenderer.invoke('sim:setPath', p),
  simBrowse: () => ipcRenderer.invoke('sim:browse'),
  simRun: (doc: unknown, analysis: string, runId: string) => ipcRenderer.invoke('sim:run', doc, analysis, runId),
  simCancel: (runId: string) => ipcRenderer.send('sim:cancel', runId),
  saveFile: (name: string, content: string, ext: string) => ipcRenderer.invoke('file:save', name, content, ext),
  saveBinary: (name: string, base64: string, ext: string) => ipcRenderer.invoke('file:saveBinary', name, base64, ext),
  openFile: () => ipcRenderer.invoke('file:open'),
  compileArduino: (fqbn: string) => ipcRenderer.invoke('mcu:compile', fqbn),
});
