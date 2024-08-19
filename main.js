const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Arweave = require('arweave')

const { checkDockerInstalled, installDocker } = require('./actions/dockerActions');
const { 
    downloadComposeFile,
    prepareDockerEnvironment, 
    startDockerSetup, 
    checkDockerContainers, 
    createEnvFileIfMissing,
    startDockerCompose, 
    stopDockerCompose, 
    saveEnv
} = require('./actions/gatewayInitActions');
const { 
    checkPortsInFirewall, 
    checkAndForwardUPnP, 
    notifyUserManualForwarding,
    saveDomainData,
    loadDomainData,
    checkDNSRecords
} = require('./actions/networkActions');
const { 
    deployNginxContainer, 
    startNginxContainer 
} = require('./actions/nginxActions');

const composeFilePath = path.join(os.homedir(), 'ar-io-node/docker-compose.yaml');
const envFilePath = path.join(os.homedir(), 'ar-io-node/.env');

const walletDir = path.join(os.homedir(), 'ar-io-node/wallets');

// Ensure the wallets directory exists
if (!fs.existsSync(walletDir)) {
    fs.mkdirSync(walletDir, { recursive: true });
}

let isInstallingDocker = false;

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    win.loadFile('index.html');

    // Ensure .env file exists before doing anything else
    createEnvFileIfMissing();

    // Load saved domain data if it exists
    loadDomainData((domainData) => {
        win.webContents.send('load-domain', domainData);
    });

    // Download the docker-compose.yaml file at the start
    downloadComposeFile((downloadSuccess) => {
        if (downloadSuccess) {
            console.log('Docker Compose file downloaded.');
        } else {
            win.webContents.send('docker-logs', 'Failed to download docker-compose.yaml.');
        }
    });

    // Check if Docker is installed and running
    checkDockerInstalled((message, dockerInstalled) => {
        win.webContents.on('did-finish-load', async () => {
            win.webContents.send('docker-version', { message, dockerInstalled });

            if (dockerInstalled) {
                win.webContents.send('install-complete');
                prepareDockerEnvironment(win);
            } else {
                const userConsent = await dialog.showMessageBox(win, {
                    type: 'question',
                    buttons: ['Yes', 'No'],
                    defaultId: 0,
                    title: 'Install Docker',
                    message: 'Docker is not installed. Would you like to install it now?',
                });

                if (userConsent.response === 0) { // User chose 'Yes'
                    isInstallingDocker = true;  // Set flag to prevent container checks
                    installDocker((installSuccess) => {
                        isInstallingDocker = false;  // Reset flag after installation
                        if (installSuccess) {
                            checkDockerInstalled((installMessage, dockerNowInstalled) => {
                                win.webContents.send('docker-version', { installMessage, dockerNowInstalled });
                                if (dockerNowInstalled) {
                                    win.webContents.send('install-complete');
                                    prepareDockerEnvironment(win); // Ensure Docker is set up after installation
                                } else {
                                    win.webContents.send('docker-logs', 'Docker installation failed. Please restart the app and try again.');
                                }
                            });
                        } else {
                            win.webContents.send('docker-logs', 'Docker installation failed or was canceled.');
                        }
                    });
                } else {
                    win.webContents.send('docker-logs', 'Docker is required to run this application.');
                }
            }
        });
    });

    // Check if ports 80, 443 are open in the firewall
    checkPortsInFirewall(() => {
        console.log("Running UPnP check...");
        checkAndForwardUPnP((failedPorts) => {
            if (failedPorts.length > 0) {
                notifyUserManualForwarding(failedPorts);
            }
        });
    });

    ipcMain.on('install-docker', () => {
        installDocker((success) => {
            if (success) {
                checkDockerInstalled((message, dockerInstalled) => {
                    win.webContents.send('docker-version', { message, dockerInstalled });
                    if (dockerInstalled) {
                        win.webContents.send('install-complete');
                        prepareDockerEnvironment(win);
                    }
                });
            } else {
                win.webContents.send('docker-version', {
                    message: 'Docker installation failed. Please try again.',
                    dockerInstalled: false,
                });
            }
        });
    });

    ipcMain.on('load-wallet', async (event, filePath) => {
        try {
            // Read and parse the wallet file
            const walletData = fs.readFileSync(filePath, 'utf8');
            const parsedWallet = JSON.parse(walletData);
    
            async function getAddress(jwk) {
                const arweave = Arweave.init();
                return await arweave.wallets.getAddress(jwk);
            }
    
            const address = await getAddress(parsedWallet);
            console.log(address);
    
            // Save the wallet file to the designated directory
            const savePath = path.join(walletDir, `${address}.json`);
            fs.writeFileSync(savePath, JSON.stringify(parsedWallet, null, 2), 'utf8');
    
            // Read the .env file if it exists, or initialize a new env content
            let envContent = '';
            if (fs.existsSync(envFilePath)) {
                envContent = fs.readFileSync(envFilePath, 'utf8');
            }
    
            // Check if OBSERVER_WALLET exists, and update or add it
            if (envContent.includes('OBSERVER_WALLET')) {
                // Replace the existing OBSERVER_WALLET line
                envContent = envContent.replace(/OBSERVER_WALLET=.*/g, `OBSERVER_WALLET=${address}`);
            } else {
                // Add the OBSERVER_WALLET line
                envContent += `\nOBSERVER_WALLET=${address}`;
            }
    
            // Write the updated content back to the .env file
            fs.writeFileSync(envFilePath, envContent, 'utf8');
    
            // Notify the event that the wallet was loaded successfully
            event.reply('wallet-status', 'Wallet loaded and OBSERVER_WALLET set successfully.');
        } catch (error) {
            console.error('Failed to load wallet:', error);
            event.reply('wallet-status', `Failed to load wallet: ${error.message}`);
        }
    });

    ipcMain.on('user-confirmation', (event, confirmed, newFilePath) => {
        if (confirmed) {
            fs.renameSync(newFilePath, composeFilePath);
            startDockerSetup(win);
        }
    });

    ipcMain.on('start-gateway', () => {
        startDockerCompose(win, (startSuccess, logs) => {
            if (startSuccess) {
                win.webContents.send('docker-logs', logs);
            } else {
                win.webContents.send('docker-logs', `Failed to start Docker Compose: ${logs}`);
            }
        });
    });

    ipcMain.on('stop-gateway', () => {
        stopDockerCompose(win, (stopSuccess, logs) => {
            if (stopSuccess) {
                win.webContents.send('docker-logs', logs);
            } else {
                win.webContents.send('docker-logs', `Failed to stop Docker Compose: ${logs}`);
            }
        });
    });

    ipcMain.on('save-env', (event, env) => {
        saveEnv(env);
        win.webContents.send('docker-logs', 'Environment variables updated. Restarting Docker containers...');

        stopDockerCompose(win, (stopSuccess) => {
            if (stopSuccess) {
                startDockerCompose(win, (startSuccess, logs) => {
                    if (startSuccess) {
                        win.webContents.send('docker-logs', logs);
                    } else {
                        win.webContents.send('docker-logs', `Failed to start Docker Compose: ${logs}`);
                    }
                });
            } else {
                win.webContents.send('docker-logs', 'Failed to stop Docker Compose.');
            }
        });
    });

    ipcMain.on('save-domain', (event, domainData) => {
        saveDomainData(domainData, (saveSuccess) => {
            if (saveSuccess) {
                checkDNSRecords(domainData, win);
            } else {
                win.webContents.send('docker-logs', 'Failed to save domain data.');
            }
        });
    });

    ipcMain.on('deploy-nginx', async (event, domainData) => {
        try {
            console.log(`Domain data =  ${domainData}`)
            console.log(JSON.stringify(domainData))
            await deployNginxContainer(domainData);
            win.webContents.send('docker-logs', 'Nginx container deployed and SSL certificates created successfully.');
        } catch (error) {
            console.error('Failed to deploy Nginx container with SSL:', error);
            win.webContents.send('docker-logs', `Failed to deploy Nginx container with SSL: ${error.message}`);
        }
    });


    // Periodically check the Docker containers and update buttons
    setInterval(() => {
        if (!isInstallingDocker) {  // Only check containers if Docker is not being installed
            checkDockerContainers((success, containers) => {
                if (success) {
                    const allStopped = containers.every(container => container.status.includes('Exited') || container.status.includes('Created'));
                    const allRunning = containers.filter(container => container.status.includes('Up')).length === 4;

                    if (containers.length === 0 || allStopped) {
                        win.webContents.send('update-buttons', 'start');
                    } else if (allRunning) {
                        win.webContents.send('update-buttons', 'stop');
                    }
                    win.webContents.send('docker-logs', `Periodic check - Containers: ${containers.map(c => `${c.name}: ${c.status}`).join('\n')}`);
                } else {
                    win.webContents.send('docker-logs', `Failed to check Docker containers: ${containers}`);
                }
            });
        }
    }, 10000); // Check every 10 seconds
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
