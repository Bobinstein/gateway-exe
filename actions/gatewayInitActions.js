const { exec } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');
const crypto = require('crypto');

const arIoNodeDir = path.join(os.homedir(), 'ar-io-node');
const envFilePath = path.join(os.homedir(), 'ar-io-node/.env');
const composeFilePath = path.join(os.homedir(), 'ar-io-node/docker-compose.yaml');
const composeFileUrl = 'https://raw.githubusercontent.com/ar-io/ar-io-node/main/docker-compose.yaml';

// Function to create .env file if it does not exist
function createEnvFileIfMissing() {
    // Ensure the ar-io-node directory exists
    if (!fs.existsSync(arIoNodeDir)) {
        console.log('ar-io-node directory does not exist. Creating it...');
        fs.mkdirSync(arIoNodeDir, { recursive: true });
        console.log('ar-io-node directory created.');
    }

    // Check if .env file exists and create it if missing
    if (!fs.existsSync(envFilePath)) {
        console.log('.env file does not exist. Creating with default values...');
        const defaultEnv = {
            AR_IO_WALLET: '',
            OTHER_ENV_VARIABLE: 'default_value', // Add other default environment variables here
        };

        const envString = Object.keys(defaultEnv).map(key => `${key}=${defaultEnv[key]}`).join('\n');
        fs.writeFileSync(envFilePath, envString);
        console.log('.env file created.');
    } else {
        console.log('.env file already exists.');
    }
}

function downloadComposeFile(callback) {
    console.log('Downloading docker-compose.yaml...');

    const tempFilePath = path.join(os.tmpdir(), 'docker-compose.yaml');

    const file = fs.createWriteStream(tempFilePath);

    https.get(composeFileUrl, (response) => {
        if (response.statusCode === 200) {
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    console.log('docker-compose.yaml downloaded.');
                    compareComposeFiles(tempFilePath, callback);
                });
            });
        } else {
            console.error(`Failed to download docker-compose.yaml: ${response.statusCode}`);
            callback(false);
        }
    }).on('error', (err) => {
        fs.unlink(tempFilePath, () => {});
        console.error(`Error downloading docker-compose.yaml: ${err.message}`);
        callback(false);
    });
}

function compareComposeFiles(newFilePath, callback) {
    if (fs.existsSync(composeFilePath)) {
        const oldFileHash = crypto.createHash('sha256').update(fs.readFileSync(composeFilePath)).digest('hex');
        const newFileHash = crypto.createHash('sha256').update(fs.readFileSync(newFilePath)).digest('hex');

        if (oldFileHash === newFileHash) {
            console.log('The existing docker-compose.yaml file is up-to-date.');
            callback(true, false); // No need to replace the file
        } else {
            callback(true, true, newFilePath); // Existing file is different, needs user confirmation
        }
    } else {
        // No existing file, just move the new one
        fs.renameSync(newFilePath, composeFilePath);
        callback(true, false);
    }
}

function isDockerRunning(callback) {
    exec('docker info', (error) => {
        if (error) {
            callback(false);
        } else {
            callback(true);
        }
    });
}

// Function to start Docker if it's installed but not running
function startDocker(callback) {
    const command = `"C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe" --start`;
    console.log('Starting Docker Desktop...');

    exec(command, (error) => {
        if (error) {
            console.error(`Error starting Docker Desktop: ${error.message}`);
            callback(false);
        } else {
            console.log('Docker Desktop started successfully.');
            // Wait a few seconds to allow Docker to fully start
            setTimeout(() => {
                isDockerRunning(callback);
            }, 5000);
        }
    });
}

// Modified checkDockerContainers function
function checkDockerContainers(callback) {
    exec('docker --version', (error, stdout) => {
        if (error) {
            console.error('Docker is not installed or not found.');
            callback(false, 'Docker is not installed.');
        } else {
            console.log(`Docker version detected: ${stdout.trim()}`);
            isDockerRunning((dockerRunning) => {
                if (dockerRunning) {
                    console.log('Docker is running.');
                    const networkName = getNetworkNameFromCompose();
                    if (!networkName) {
                        callback(false, 'No network name found');
                        return;
                    }

                    const command = `docker ps --filter "network=${networkName}" --format "{{.Names}}: {{.Status}}"`;

                    exec(command, (containerError, containerStdout) => {
                        if (containerError) {
                            console.error(`Error checking Docker containers: ${containerError.message}`);
                            callback(false, containerError.message);
                            return;
                        }

                        const containers = containerStdout.trim().split('\n').filter(Boolean).map(line => {
                            const [name, status] = line.split(': ');
                            return { name, status };
                        });

                        // console.log(`Detected containers: ${JSON.stringify(containers)}`);
                        callback(true, containers);
                    });
                } else {
                    console.log('Docker is installed but not running. Attempting to start Docker...');
                    startDocker((dockerStarted) => {
                        if (dockerStarted) {
                            console.log('Docker started successfully.');
                            checkDockerContainers(callback); // Re-run the check now that Docker is running
                        } else {
                            callback(false, 'Failed to start Docker.');
                        }
                    });
                }
            });
        }
    });
}

function getNetworkNameFromCompose() {
    try {
        const fileContents = fs.readFileSync(composeFilePath, 'utf8');
        const data = yaml.load(fileContents);

        const networks = data.networks ? Object.keys(data.networks) : [];
        if (networks.length > 0) {
            return networks[0];
        } else {
            console.error('No networks found in docker-compose.yaml');
            return null;
        }
    } catch (err) {
        console.error('Error reading docker-compose.yaml:', err);
        return null;
    }
}



function startDockerCompose(win, callback) {
    console.log('Running docker compose up in detached mode with env file...');

    const command = `docker compose -f "${composeFilePath}" --env-file "${envFilePath}" up -d`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error running docker compose up: ${error.message}`);
            callback(false, stderr);
        } else {
            callback(true, stdout);
        }
    });
}

function stopDockerCompose(win, callback) {
    console.log('Running docker compose down...');

    const command = `docker compose -f "${composeFilePath}" down`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error running docker compose down: ${error.message}`);
            callback(false, stderr);
        } else {
            callback(true, stdout);
        }
    });
}

function prepareDockerEnvironment(win) {
    downloadComposeFile((downloadSuccess, needsUpdate, newFilePath) => {
        if (downloadSuccess) {
            if (needsUpdate) {
                dialog.showMessageBox(win, {
                    type: 'question',
                    buttons: ['Yes', 'No'],
                    defaultId: 0,
                    title: 'Confirm Update',
                    message: 'A new version of the docker-compose.yaml file is available. Do you want to update?',
                }).then((response) => {
                    const confirmed = response.response === 0;
                    win.webContents.send('user-confirmation', confirmed, newFilePath);
                });
            } else {
                startDockerSetup(win);
            }
        } else {
            win.webContents.send('docker-logs', 'Failed to download docker-compose.yaml.');
        }
    });
}

function startDockerSetup(win) {
    checkDockerContainers((success, containers) => {
        if (success) {
            win.webContents.send('docker-logs', `Containers: ${containers.map(c => `${c.name}: ${c.status}`).join('\n')}`);
        } else {
            win.webContents.send('docker-logs', `Failed to check Docker containers: ${containers}`);
        }
    });
}

function saveEnv(env) {
    const envString = Object.keys(env).map(key => `${key}=${env[key]}`).join('\n');
    fs.writeFileSync(envFilePath, envString);
    console.log('.env file has been updated.');
}

module.exports = {
    createEnvFileIfMissing,
    downloadComposeFile,
    compareComposeFiles,
    getNetworkNameFromCompose,
    checkDockerContainers,
    startDockerCompose,
    stopDockerCompose,
    prepareDockerEnvironment,
    startDockerSetup,
    saveEnv
};
