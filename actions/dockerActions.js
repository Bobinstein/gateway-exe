const { exec } = require('child_process');
const https = require('https');
const path = require('path');
const fs = require('fs');
//actions/dockerActions.js
const os = require('os');

function checkDockerInstalled(callback) {
    const timeout = setTimeout(() => {
        console.error('Docker check timed out.');
        callback('Docker check timed out.', false);
    }, 10000); // Set a 10-second timeout

    exec('docker --version', (error, stdout, stderr) => {
        clearTimeout(timeout);
        if (error) {
            console.error(`Error checking Docker version: ${error.message}`);
            callback('Docker is not installed.', false);
        } else {
            console.log(`Docker version detected: ${stdout.trim()}`);
            checkDockerDaemonRunning((dockerRunning) => {
                if (dockerRunning) {
                    callback('Docker is installed and running.', true);
                } else {
                    console.log('Docker is installed but not running.');
                    startDockerDaemon((daemonStarted) => {
                        if (daemonStarted) {
                            callback('Docker daemon started successfully.', true);
                        } else {
                            callback('Docker daemon failed to start.', false);
                        }
                    });
                }
            });
        }
    });
}



function installDocker(callback) {
    const installerUrl = 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe';
    const installerPath = path.join(os.tmpdir(), 'DockerInstaller.exe');

    console.log('Downloading Docker installer...');

    const file = fs.createWriteStream(installerPath);
    https.get(installerUrl, (response) => {
        if (response.statusCode === 200) {
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    console.log('Docker installer downloaded.');
                    runInstaller(installerPath, callback);
                });
            });
        } else {
            console.error(`Failed to download Docker installer: ${response.statusCode}`);
            callback(false);
        }
    }).on('error', (err) => {
        fs.unlink(installerPath, () => {});
        console.error(`Error downloading Docker installer: ${err.message}`);
        callback(false);
    });
}

function runInstaller(installerPath, callback) {
    const command = `powershell -Command "Start-Process '${installerPath}' -Verb RunAs"`;

    console.log('Running Docker installer...');
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error running Docker installer: ${error.message}`);
            callback(false);
        } else {
            console.log('Docker installer executed successfully.');
            callback(true);
        }
    });
}

function checkDockerDaemonRunning(callback) {
    exec('docker info', (error, stdout, stderr) => {
        if (error) {
            console.error('Docker daemon is not running.');
            callback(false);
        } else {
            console.log('Docker daemon is running.');
            callback(true);
        }
    });
}

function startDockerDaemon(callback) {
    const command = `"C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe" --start`;

    console.log('Starting Docker Desktop...');
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error starting Docker Desktop: ${error.message}`);
            callback(false);
        } else {
            console.log('Docker Desktop started successfully.');
            // Wait a few seconds before checking if the daemon is running
            setTimeout(() => {
                checkDockerDaemonRunning((dockerRunning) => {
                    callback(dockerRunning);
                });
            }, 5000); // Wait 5 seconds
        }
    });
}


module.exports = {
    checkDockerInstalled,
    installDocker,
    checkDockerDaemonRunning,
    startDockerDaemon
};
