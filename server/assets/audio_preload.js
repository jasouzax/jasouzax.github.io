// Preload of the hidden audio capture window: the only way out of the page is to hand Opus packets to the main process
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jazu_server', {
    packet: (timestamp, bytes) => ipcRenderer.send('server:audio', timestamp, bytes),
});
