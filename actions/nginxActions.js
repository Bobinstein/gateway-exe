const { exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Helper function for delays
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// Function to create the nginx.conf file
function createNginxConfig() {
    return new Promise((resolve, reject) => {
        console.log("Creating nginx.conf...");
        const nginxConfigContent = `
user  nginx;
worker_processes  auto;

error_log  /var/log/nginx/error.log warn;
pid        /var/run/nginx.pid;

events {
    worker_connections  1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';

    access_log  /var/log/nginx/access.log  main;

    sendfile        on;
    #tcp_nopush     on;

    keepalive_timeout  65;

    include /etc/nginx/conf.d/*.conf;
}
`.replace(/\r\n/g, '\n');  // Convert to Unix line endings for Linux

        const nginxConfigPath = path.join(os.homedir(), 'ar-io-node/nginx/nginx.conf');
        fs.writeFile(nginxConfigPath, nginxConfigContent, 'utf8', (err) => {
            if (err) {
                console.error(`Failed to create nginx.conf: ${err.message}`);
                reject(err);
            } else {
                console.log(`nginx.conf created successfully at ${nginxConfigPath}`);
                resolve(nginxConfigPath);
            }
        });
    });
}

// Function to create the necessary directory structure
function createDirectories() {
    return new Promise((resolve, reject) => {
        console.log("Creating necessary directories...");
        const nginxDir = path.join(os.homedir(), 'ar-io-node/nginx');
        const certsDir = path.join(os.homedir(), 'ar-io-node/certs');

        try {
            if (!fs.existsSync(nginxDir)) {
                fs.mkdirSync(nginxDir, { recursive: true });
            }
            if (!fs.existsSync(certsDir)) {
                fs.mkdirSync(certsDir, { recursive: true });
            }
            console.log("Directories created successfully.");
            resolve();
        } catch (err) {
            console.error(`Failed to create directories: ${err.message}`);
            reject(err);
        }
    });
}

// Function to create the Dockerfile
function createDockerfile() {
    return new Promise((resolve, reject) => {
        console.log("Creating Dockerfile...");
        const dockerfileContent = `
FROM nginx:latest

# Install Certbot and necessary dependencies
RUN apt-get update && \\
    apt-get install -y certbot python3-certbot-nginx && \\
    apt-get clean

RUN apt-get update && apt-get install -y procps
RUN apt-get install dnsutils -y


# Expose ports 80 and 443
EXPOSE 80 443

# Command to run Nginx
CMD ["nginx", "-g", "daemon off;"]
`;
        const dockerfilePath = path.join(os.homedir(), 'ar-io-node/nginx/Dockerfile');
        fs.writeFile(dockerfilePath, dockerfileContent, 'utf8', (err) => {
            if (err) {
                console.error(`Failed to create Dockerfile: ${err.message}`);
                reject(err);
            } else {
                console.log("Dockerfile created successfully.");
                resolve();
            }
        });
    });
}

// Function to create the Docker Compose file
function createDockerComposeFile() {
    return new Promise((resolve, reject) => {
        console.log("Creating Docker Compose file...");
        const composeFileContent = `
version: '3.8'
services:
  nginx:
    build: .
    container_name: nginx-proxy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ../certs:/etc/letsencrypt
      - ./dnsUpdateScript.sh:/dnsUpdateScript.sh
      - ./dnsCleanupScript.sh:/dnsCleanupScript.sh
    restart: unless-stopped
    networks:
      - nginx-network

networks:
  nginx-network:
    driver: bridge
`;

        const composeFilePath = path.join(os.homedir(), 'ar-io-node/nginx/docker-compose.yaml');
        fs.writeFile(composeFilePath, composeFileContent, 'utf8', (err) => {
            if (err) {
                console.error(`Failed to create Docker Compose file: ${err.message}`);
                reject(err);
            } else {
                console.log("Docker Compose file created successfully.");
                resolve(composeFilePath);
            }
        });
    });
}

// Function to create the DNS update script for Certbot
function createDNSUpdateScript() {
    return new Promise((resolve, reject) => {
        console.log("Creating DNS update script...");
        const scriptContent = `
    #!/bin/bash
set -x

log() {
    echo "$(date +'%Y-%m-%d %H:%M:%S') - $1"
}

log "Starting DNS authentication script"

# Log all environment variables to debug
env | sort

log "Environment Variables:"
log "CERTBOT_DOMAIN: $CERTBOT_DOMAIN"
log "CERTBOT_VALIDATION: $CERTBOT_VALIDATION"

log "Checking required environment variables..."
if [ -z "$CERTBOT_DOMAIN" ]; then
    log "ERROR: CERTBOT_DOMAIN is not set."
    exit 1
fi

if [ -z "$CERTBOT_VALIDATION" ]; then
    log "ERROR: CERTBOT_VALIDATION is not set."
    exit 1
fi

DOMAIN_SLD=$(echo "$CERTBOT_DOMAIN" | awk -F '.' '{print $(NF-1)}')
DOMAIN_TLD=$(echo "$CERTBOT_DOMAIN" | awk -F '.' '{print $(NF)}')

log "Extracted Values: DOMAIN_SLD: $DOMAIN_SLD, DOMAIN_TLD: $DOMAIN_TLD"

if [ -z "$DOMAIN_SLD" ] || [ -z "$DOMAIN_TLD" ]; then
    log "ERROR: DOMAIN_SLD or DOMAIN_TLD extraction failed."
    exit 1
fi

# Extract subdomain if it exists
SUBDOMAIN=$(echo "$CERTBOT_DOMAIN" | sed "s/.\?$DOMAIN_SLD.$DOMAIN_TLD//")
if [ "$SUBDOMAIN" = "$CERTBOT_DOMAIN" ]; then
    SUBDOMAIN=""
fi

log "SUBDOMAIN: $SUBDOMAIN"

# Create the DNS record
API_RESPONSE=$(curl -s "https://api.namecheap.com/xml.response" \
    --data-urlencode "ApiUser=$NAMECHEAP_API_USER" \
    --data-urlencode "UserName=$NAMECHEAP_API_USER" \
    --data-urlencode "ApiKey=$NAMECHEAP_API_KEY" \
    --data-urlencode "ClientIp=$CLIENT_IP" \
    --data-urlencode "Command=namecheap.domains.dns.setHosts" \
    --data-urlencode "SLD=$DOMAIN_SLD" \
    --data-urlencode "TLD=$DOMAIN_TLD" \
    --data-urlencode "HostName1=_acme-challenge.$SUBDOMAIN" \
    --data-urlencode "RecordType1=TXT" \
    --data-urlencode "Address1=$CERTBOT_VALIDATION" \
    --data-urlencode "TTL1=300")

log "Sleeping 30 after the namecheap call"
sleep 30
log "API Response: $API_RESPONSE"

# Check if the DNS record was created successfully
if echo "$API_RESPONSE" | grep -q "IsSuccess=\"true\""; then
    log "DNS record successfully created for _acme-challenge.$CERTBOT_DOMAIN"
else
    log "ERROR: Failed to create DNS record for _acme-challenge.$CERTBOT_DOMAIN"
    exit 1
fi

# Hard 30-second sleep after creating the DNS record
log "Sleeping for 30 seconds to allow DNS propagation to start..."
sleep 30 || log "Sleep failed"
log "Woke up from sleep, proceeding with DNS propagation checks."

# Waiting for DNS propagation
log "Waiting for DNS propagation..."

for i in {1..20}; do
    TXT_RECORD=$(dig +short TXT _acme-challenge.$CERTBOT_DOMAIN | tr -d '"')

    if [ "$TXT_RECORD" == "$CERTBOT_VALIDATION" ]; then
        log "DNS propagation complete. TXT record found: $TXT_RECORD"
        break
    else
        log "DNS propagation not yet complete. Retrying in 30 seconds... (Attempt $i/20)"
        sleep 30
    fi

    if [ $i -eq 20 ]; then
        log "ERROR: DNS propagation did not complete within the expected time."
        exit 1
    fi
done

log "DNS authentication script completed."

`.replace(/\r\n/g, '\n');  // Convert to Unix line endings

        const scriptPath = path.join(os.homedir(), 'ar-io-node/nginx/dnsUpdateScript.sh');
        fs.writeFile(scriptPath, scriptContent, { mode: 0o755 }, (err) => {
            if (err) {
                console.error(`Failed to create DNS update script: ${err.message}`);
                reject(err);
            } else {
                console.log(`DNS update script created successfully at ${scriptPath}`);
                resolve(scriptPath);
            }
        });
    });
}





// Function to create the DNS cleanup script for Certbot
function createDNSCleanupScript() {
    return new Promise((resolve, reject) => {
        console.log("Creating DNS cleanup script...");
        const scriptContent = `
#!/bin/bash
set -x
log() { echo "$(date +'%Y-%m-%d %H:%M:%S') - $1"; }
log "Starting DNS cleanup script"
if [ -z "$CERTBOT_DOMAIN" ]; then
    log "ERROR: CERTBOT_DOMAIN is not set."
    exit 1
fi
DOMAIN_SLD=$(echo "$CERTBOT_DOMAIN" | awk -F '.' '{print $(NF-1)}')
DOMAIN_TLD=$(echo "$CERTBOT_DOMAIN" | awk -F '.' '{print $(NF)}')
log "Extracted Values: DOMAIN_SLD: $DOMAIN_SLD, DOMAIN_TLD: $DOMAIN_TLD"
log "DNS cleanup script completed."
`.replace(/\r\n/g, '\n');  // Convert to Unix line endings

        const scriptPath = path.join(os.homedir(), 'ar-io-node/nginx/dnsCleanupScript.sh');
        fs.writeFile(scriptPath, scriptContent, { mode: 0o755 }, (err) => {
            console.log("Attempting to write clean up script")
            if (err) {
                console.error(`Failed to create DNS cleanup script: ${err.message}`);
                reject(err);
            } else {
                console.log(`DNS cleanup script created successfully at ${scriptPath}`);
                resolve(scriptPath);
            }
        });
        console.log("clean up script write block finished.")
    });
}

// Function to start Nginx container only after all files are created
async function startNginxContainer() {
    try {
        console.log("Starting file creation process...");

        await createDirectories();
        await delay(1000); // Brief delay to ensure directories are created

        await createDockerfile();
        await delay(1000); // Brief delay to ensure Dockerfile is created

        await createDockerComposeFile();
        await delay(1000); // Brief delay to ensure Docker Compose file is created

        await createNginxConfig();  // Create the nginx.conf file
        await delay(1000); // Brief delay to ensure nginx.conf is created

        await createDNSUpdateScript();
        await delay(1000); // Brief delay to ensure DNS update script is created

        await createDNSCleanupScript();
        await delay(1000); // Brief delay to ensure DNS cleanup script is created

        console.log("All necessary files created. Now starting Nginx container...");

        const command = `docker-compose -f "${path.join(os.homedir(), 'ar-io-node/nginx/docker-compose.yaml')}" up -d`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Failed to start Nginx container using Docker Compose: ${error.message}`);
                console.error(`stderr: ${stderr}`);
                return;
            }
            console.log(`Nginx container started successfully using Docker Compose. Logs: ${stdout}`);
        });
    } catch (error) {
        console.error(`Failed to start Nginx container: ${error.message}`);
    }
}



async function runCertbotSequentially(domainData) {
    const publicIp = await import('public-ip');
    const clientIp = await publicIp.publicIpv4();

    // First run for the base domain
    const baseDomainCommand = `docker exec -e NAMECHEAP_API_USER=${domainData.username} -e NAMECHEAP_API_KEY=${domainData.apiKey} -e CLIENT_IP=${clientIp} nginx-proxy certbot certonly -v --manual --preferred-challenges dns -d ${domainData.fqdn} --manual-auth-hook "bash /dnsUpdateScript.sh && sleep 30" --manual-cleanup-hook "/dnsCleanupScript.sh" --non-interactive --agree-tos --register-unsafely-without-email --force-renewal --dry-run`;
    
    console.log('Running Certbot command for base domain:', baseDomainCommand);
    await executeCertbotCommand(baseDomainCommand);

    // Second run for the wildcard domain
    const wildcardDomainCommand = `docker exec -e NAMECHEAP_API_USER=${domainData.username} -e NAMECHEAP_API_KEY=${domainData.apiKey} -e CLIENT_IP=${clientIp} nginx-proxy certbot certonly -v --manual --preferred-challenges dns -d *.${domainData.fqdn} --manual-auth-hook "bash /dnsUpdateScript.sh && sleep 30" --manual-cleanup-hook "/dnsCleanupScript.sh" --non-interactive --agree-tos --register-unsafely-without-email --force-renewal --dry-run`;

    console.log('Running Certbot command for wildcard domain:', wildcardDomainCommand);
    await executeCertbotCommand(wildcardDomainCommand);
}

function executeCertbotCommand(command) {
    return new Promise((resolve, reject) => {
        const child = exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error('Certbot process failed:', error.message);
                reject(error);
            } else {
                console.log('Certbot command completed successfully.');
                resolve(stdout);
            }
        });

        child.stdout.on('data', (data) => {
            console.log(`Certbot stdout: ${data}`);
        });

        child.stderr.on('data', (data) => {
            console.error(`Certbot stderr: ${data}`);
        });

        child.on('exit', (code) => {
            console.log(`Certbot process exited with code ${code}`);
        });
    });
}


// Function to run Certbot for SSL certificate creation or expansion
async function runCertbot(domainData) {
    const publicIp = await import('public-ip');
    const clientIp = await publicIp.publicIpv4();

    return new Promise((resolve, reject) => {
        const certbotCommand = `docker exec -e NAMECHEAP_API_USER=${domainData.username} -e NAMECHEAP_API_KEY=${domainData.apiKey} -e CLIENT_IP=${clientIp} nginx-proxy certbot certonly -v --manual --preferred-challenges dns -d ${domainData.fqdn} -d *.${domainData.fqdn} --manual-auth-hook "bash /dnsUpdateScript.sh && sleep 30" --manual-cleanup-hook "/dnsCleanupScript.sh" --non-interactive --agree-tos --email none@example.com --force-renewal --dry-run`;

        console.log('Running Certbot command inside container with environment variables:', certbotCommand);

        const child = exec(certbotCommand, (error, stdout, stderr) => {
            if (error) {
                console.error('Certbot process failed:', error.message);
                reject(error);
            } else {
                console.log('Certbot command completed successfully.');
                resolve(stdout);
            }
        });

        // Capture stdout
        child.stdout.on('data', (data) => {
            console.log(`Certbot stdout: ${data}`);
        });

        // Capture stderr
        child.stderr.on('data', (data) => {
            console.error(`Certbot stderr: ${data}`);
        });

        // Capture the exit code
        child.on('exit', (code) => {
            console.log(`Certbot process exited with code ${code}`);
        });
    });
}





// Function to update Nginx configuration with SSL after certificates are created
function updateNginxConfigWithSSL(domainData, certPath) {
    return new Promise((resolve, reject) => {
        console.log("Updating Nginx configuration with SSL...");
        const sslNginxConfig = `
server {
    listen 80;
    listen [::]:80;
    server_name ${domainData.fqdn} *.${domainData.fqdn};

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${domainData.fqdn} *.${domainData.fqdn};

    ssl_certificate ${certPath}/fullchain.pem;
    ssl_certificate_key ${certPath}/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
    }
}
`;

        const sslConfigPath = path.join(os.homedir(), 'ar-io-node/nginx/nginx-ssl.conf');
        fs.writeFile(sslConfigPath, sslNginxConfig, 'utf8', (err) => {
            if (err) {
                console.error(`Failed to update Nginx configuration with SSL: ${err.message}`);
                return reject(err);
            }
            console.log("Nginx configuration with SSL updated successfully.");
            
            const updateCommand = `
                docker cp ${sslConfigPath} nginx-proxy:/etc/nginx/nginx.conf && \
                docker exec nginx-proxy nginx -s reload
            `;

            exec(updateCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error(`Failed to reload Nginx with SSL configuration: ${error.message}`);
                    console.error(`stderr: ${stderr}`);
                    return reject(error);
                }
                console.log(`Nginx configuration updated with SSL and reloaded. Logs: ${stdout}`);
                resolve();
            });
        });
    });
}

// Main function to handle Nginx deployment with SSL
async function deployNginxContainer(domainData) {
    try {
        console.log("Deploying Nginx container...");
        
        // Start the Nginx container with default configuration
        await startNginxContainer();

        // Create SSL certificates
        const certPath = path.join(os.homedir(), `ar-io-node/certs/${domainData.fqdn}`);
        await runCertbotSequentially(domainData);

        // Update Nginx configuration with SSL
        await updateNginxConfigWithSSL(domainData, certPath);

        console.log("Nginx container deployed and SSL certificates created successfully.");
    } catch (error) {
        console.error(`Failed to deploy Nginx container with SSL: ${error.message}`);
    }
}


module.exports = {
    deployNginxContainer,
    runCertbotSequentially,
    updateNginxConfigWithSSL,
    startNginxContainer
};
