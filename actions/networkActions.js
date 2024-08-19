const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns');
const upnp = require('nat-upnp');
const client = upnp.createClient();
const axios = require('axios');
const { dialog } = require('electron');

const domainFilePath = path.join(os.homedir(), 'ar-io-node/.domain');

// Function to check if ports 80, 443 are open in the firewall
function checkPortsInFirewall(callback) {
    const ports = [80, 443];

    ports.forEach((port) => {
        exec(`netsh advfirewall firewall show rule name=all | findstr /I /C:"LocalPort=${port}"`, (error, stdout, stderr) => {
            if (!stdout.includes(`${port}`)) {
                exec(`netsh advfirewall firewall add rule name="Allow Port ${port}" dir=in action=allow protocol=TCP localport=${port}`, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`Failed to open port ${port} in the firewall: ${error.message}`);
                    } else {
                        console.log(`Port ${port} has been allowed in the firewall.`);
                    }
                });
            } else {
                console.log(`Port ${port} is already open in the firewall.`);
            }
        });
    });

    callback();
}

// Function to check and forward ports 80, 443 using UPnP
function checkAndForwardUPnP(callback) {
    const ports = [
        { external: 80, internal: 80 },
        { external: 443, internal: 443 }
    ];

    let failedPorts = [];

    ports.forEach(port => {
        console.log(`Attempting to forward external port ${port.external} to internal port ${port.internal} with description "ar-io-gateway" using UPnP...`);
        client.portMapping({
            public: port.external,
            private: port.internal,
            description: 'ar-io-gateway',
            ttl: 3600
        }, (err) => {
            if (err) {
                if (err.message.includes('ConflictInMappingEntry')) {
                    console.log(`Port ${port.external} is already forwarded using UPnP.`);
                } else {
                    console.error(`Failed to forward external port ${port.external} using UPnP: ${err.message}`);
                    failedPorts.push(port.external);
                }
            } else {
                console.log(`Port ${port.external} has been forwarded to ${port.internal} using UPnP.`);
            }
        });
    });

    callback(failedPorts);
}

// Notify user to manually forward any failed ports
function notifyUserManualForwarding(failedPorts) {
    const message = `Failed to automatically forward the following ports using UPnP: ${failedPorts.join(', ')}. Please manually forward these ports on your router. For more information, visit [this guide](https://www.hellotech.com/guide/for/how-to-port-forward?srsltid=AfmBOoqVA5GP7rtaHl-jCS35QEphT4Vb944GhPFbxxa49D12C_PZ3loR).`;

    console.warn(message);
}

// Function to save domain data to a file
function saveDomainData(domainData, callback) {
    const domainConfig = {
        fqdn: domainData.fqdn,
        isNamecheap: domainData.isNamecheap,
        apiKey: domainData.isNamecheap ? domainData.apiKey : null,
    };

    fs.writeFile(domainFilePath, JSON.stringify(domainConfig), (err) => {
        if (err) {
            console.error('Error saving domain data:', err);
            callback(false);
        } else {
            console.log('Domain data saved successfully.');
            callback(true);
        }
    });
}

// Function to load domain data from a file
function loadDomainData(callback) {
    if (fs.existsSync(domainFilePath)) {
        fs.readFile(domainFilePath, 'utf8', (err, data) => {
            if (err) {
                console.error('Error reading domain data:', err);
                callback(null);
            } else {
                try {
                    const domainData = JSON.parse(data);
                    callback(domainData);
                } catch (e) {
                    console.error('Error parsing domain data:', e);
                    callback(null);
                }
            }
        });
    } else {
        callback(null);
    }
}

// Helper function to create DNS records via Namecheap API
async function createDNSRecord(domainData, type, name, ip) {
    if (!domainData.isNamecheap || !domainData.apiKey || !domainData.username) {
        console.error("Cannot create DNS record: Missing Namecheap API key or invalid domain data.");
        return;
    }

    try {
        const namecheapApi = require('namecheap-api');
        const publicIp = await import('public-ip');
        const clientIp = await publicIp.publicIpv4();

        // Set the Namecheap global parameters
        namecheapApi.config.set("ApiUser", domainData.username);
        namecheapApi.config.set("UserName", domainData.username);
        namecheapApi.config.set("ApiKey", domainData.apiKey);
        namecheapApi.config.set("ClientIp", clientIp);

        // Extract SLD and TLD from the FQDN
        const domainParts = domainData.fqdn.split('.');
        const sld = domainParts.slice(0, -1).join('.'); // The part before the last dot is the SLD
        const tld = domainParts.slice(-1)[0]; // The last part is the TLD
        const host = name === '@' ? '@' : name;

        // Fetch existing DNS records
        const existingRecordsResult = await namecheapApi.apiCall("namecheap.domains.dns.getHosts", {
            SLD: sld,
            TLD: tld
        });

        // Enhanced logging of the full API response
        console.log("Full API Response for getHosts:", JSON.stringify(existingRecordsResult, null, 2));

        // Check if the result contains the expected structure
        if (
            !existingRecordsResult ||
            !existingRecordsResult.response ||
            !existingRecordsResult.response[0] ||
            !existingRecordsResult.response[0].DomainDNSGetHostsResult ||
            !existingRecordsResult.response[0].DomainDNSGetHostsResult[0] ||
            !existingRecordsResult.response[0].DomainDNSGetHostsResult[0].host
        ) {
            console.error("Failed to retrieve existing DNS records or unexpected API response structure.");
            return;
        }

        const existingRecords = existingRecordsResult.response[0].DomainDNSGetHostsResult[0].host;

        // Add the new record to the existing records
        existingRecords.push({
            $: {
                Name: host,
                Type: type,
                Address: ip,
                TTL: '300'
            }
        });

        // Prepare the payload for setting all records
        const requestPayload = {
            SLD: sld,
            TLD: tld
        };

        existingRecords.forEach((record, index) => {
            requestPayload[`HostName${index + 1}`] = record.$.Name;
            requestPayload[`RecordType${index + 1}`] = record.$.Type;
            requestPayload[`Address${index + 1}`] = record.$.Address;
            if (record.$.TTL) {
                requestPayload[`TTL${index + 1}`] = record.$.TTL;
            }
        });

        console.log('Sending the following payload to Namecheap API:', requestPayload);

        // Perform the API call to update the DNS records
        const result = await namecheapApi.apiCall("namecheap.domains.dns.setHosts", requestPayload);

        if (result && result.response && result.response[0]) {
            const setHostsResult = result.response[0].DomainDNSSetHostsResult[0];

            // Log the detailed response for debugging
            console.log("Full API Response for setHosts:", JSON.stringify(result.response, null, 2));

            if (setHostsResult && setHostsResult.$ && setHostsResult.$.IsSuccess === 'true') {
                console.log(`DNS A record for ${name}.${domainData.fqdn} successfully created.`);
            } else {
                console.error('Error creating DNS A record: Namecheap API returned a failure.');
                if (setHostsResult && setHostsResult.$ && setHostsResult.$.Domain) {
                    console.error(`Domain: ${setHostsResult.$.Domain}`);
                }
            }
        } else {
            console.error('Error creating DNS A record: An unknown error occurred.');
            console.log("API Response:", JSON.stringify(result.response, null, 2));
        }
    } catch (err) {
        console.error('Error creating DNS A record:', err.message || err);
    }
}













// Function to check DNS records for the domain
async function checkDNSRecords(domainData, win) {
    const fqdn = domainData.fqdn;
    try {
        const publicIp = await import('public-ip');
        const ip = await publicIp.publicIpv4();

        // Check DNS for the main domain
        try {
            const addresses = await resolveDNS(fqdn);
            if (!addresses.includes(ip)) {
                console.warn(`DNS A record for ${fqdn} does not match the public IP ${ip}.`);
                if (domainData.isNamecheap && domainData.apiKey) {
                    const userResponse = await dialog.showMessageBox(win, {
                        type: 'question',
                        buttons: ['Yes', 'No'],
                        defaultId: 0,
                        title: 'DNS Record Mismatch',
                        message: `The DNS A record for ${fqdn} does not match your public IP address (${ip}). Would you like to create a new DNS record?`,
                    });
                    if (userResponse.response === 0) {
                        await createDNSRecord(domainData, 'A', '@', ip);
                    }
                }
            } else {
                console.log(`DNS A record for ${fqdn} is correctly pointed to ${ip}.`);
            }
        } catch (err) {
            console.error(err);
        }

        // Check DNS for the wildcard subdomain
        try {
            const addresses = await resolveDNS(`potato.${fqdn}`);
            if (!addresses.includes(ip)) {
                console.warn(`DNS A record for potato.${fqdn} does not match the public IP ${ip}.`);
                if (domainData.isNamecheap && domainData.apiKey) {
                    const userResponse = await dialog.showMessageBox(win, {
                        type: 'question',
                        buttons: ['Yes', 'No'],
                        defaultId: 0,
                        title: 'DNS Record Mismatch',
                        message: `The DNS A record for potato.${fqdn} does not match your public IP address (${ip}). Would you like to create a new DNS record?`,
                    });
                    if (userResponse.response === 0) {
                        await createDNSRecord(domainData, 'A', '*', ip);
                    }
                }
            } else {
                console.log(`DNS A record for potato.${fqdn} is correctly pointed to ${ip}.`);
            }
        } catch (err) {
            console.error(`Failed to resolve potato.${fqdn}: ${err}`);
            if (domainData.isNamecheap && domainData.apiKey) {
                const userResponse = await dialog.showMessageBox(win, {
                    type: 'question',
                    buttons: ['Yes', 'No'],
                    defaultId: 0,
                    title: 'DNS Record Missing',
                    message: `The DNS A record for potato.${fqdn} could not be found. Would you like to create a new DNS record for it?`,
                });
                if (userResponse.response === 0) {
                    await createDNSRecord(domainData, 'A', '*', ip);
                }
            }
        }

    } catch (err) {
        console.error('Error fetching public IP:', err);
    }
}

async function resolveDNS(hostname, timeout = 5000) {
    console.log(`Checking DNS for: ${hostname}`);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(`DNS resolution timed out for ${hostname}`);
        }, timeout);

        dns.resolve4(hostname, (err, addresses) => {
            clearTimeout(timer);
            if (err) {
                return reject(`DNS resolution failed for ${hostname}: ${err.message}`);
            }
            return resolve(addresses);
        });
    });
}

module.exports = {
    checkPortsInFirewall,
    checkAndForwardUPnP,
    notifyUserManualForwarding,
    saveDomainData,
    loadDomainData,
    checkDNSRecords
};
