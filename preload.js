//preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    on: (channel, func) => ipcRenderer.on(channel, func),
    startGateway: () => ipcRenderer.send('start-gateway'),
    stopGateway: () => ipcRenderer.send('stop-gateway'),
    saveEnv: (env) => ipcRenderer.send('save-env', env),
    saveDomain: (domainData) => ipcRenderer.send('save-domain', domainData),
    loadDomain: (callback) => ipcRenderer.once('load-domain', callback),
    deployNginx: (domainData) => ipcRenderer.send('deploy-nginx', domainData),
    loadWallet: (filePath) => ipcRenderer.send('load-wallet', filePath)
});
