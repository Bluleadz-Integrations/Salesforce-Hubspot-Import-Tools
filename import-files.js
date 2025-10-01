require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    // Set to false to perform the actual import. 
    // START WITH true to ensure everything is found correctly.
    DRY_RUN: true,
    
    // Path to the folder containing your JSON manifest files
    manifestsDir: './',

    // Delay in milliseconds between processing each file to avoid hitting API rate limits.
    // 200ms is safe for a standard free/starter account (5 requests/second).
    apiDelay: 200 
};
// ==================================================================

// Pre-configured axios instance for HubSpot API calls
const hubspotApi = axios.create({
    baseURL: 'https://api.hubapi.com',
    headers: {
        'Authorization': `Bearer ${process.env.HUBSPOT_API_KEY}`
    }
});

/**
 * Finds the full, renamed filename in a directory that starts with a given Salesforce ID.
 * @param {string} dirPath The directory to search.
 * @param {string} sfFileId The 18-character Salesforce ID prefix.
 * @returns {string|null} The full filename or null if not found.
 */
async function findFileById(dirPath, sfFileId) {
    try {
        const files = await fs.promises.readdir(dirPath);
        const foundFile = files.find(file => file.startsWith(sfFileId));
        return foundFile ? path.join(dirPath, foundFile) : null;
    } catch (error) {
        console.error(`   - ❌ Error reading directory ${dirPath}`, error);
        return null;
    }
}

/**
 * Uploads a single file to the HubSpot File Manager API.
 * @param {string} fullFilePath The absolute or relative path to the file.
 * @returns {string|null} The HubSpot ID of the uploaded file, or null on failure.
 */
async function uploadFileToHubSpot(fullFilePath) {
    const fileName = path.basename(fullFilePath);
    const form = new FormData();
    form.append('file', fs.createReadStream(fullFilePath));
    const options = {
        access: 'PRIVATE',
        folderPath: '/salesforce_import', // All files will go into this folder in HS
        overwrite: false
    };
    form.append('options', JSON.stringify(options));

    try {
        const response = await hubspotApi.post('/files/v3/files', form, {
            headers: form.getHeaders()
        });
        console.log(`   - ✅ Uploaded "${fileName}". HS File ID: ${response.data.id}`);
        return response.data.id;
    } catch (error) {
        console.error(`   - ❌ Failed to upload "${fileName}":`, error.response?.data || error.message);
        return null;
    }
}

/**
 * Attaches a HubSpot file to a CRM record by creating a NOTE engagement.
 * @param {string} objectTypeKey e.g., 'contactIds', 'companyIds'
 * @param {string} hubspotObjectId The ID of the contact, company, or deal.
 * @param {string} hubspotFileId The ID of the file from the HubSpot File Manager.
 * @param {object} fileManifestEntry The original manifest entry for metadata.
 */
async function attachFileToRecord(objectTypeKey, hubspotObjectId, hubspotFileId, fileManifestEntry) {
    const engagementData = {
        engagement: {
            active: true,
            type: 'NOTE',
        },
        associations: {
            [objectTypeKey]: [hubspotObjectId]
        },
        attachments: [{ id: hubspotFileId }],
        metadata: {
            body: `Attached file migrated from Salesforce: ${fileManifestEntry.original_filename}`
        }
    };

    try {
        await hubspotApi.post('/engagements/v1/engagements', engagementData);
        console.log(`   - ✅ Attached file to ${objectTypeKey.slice(0, -3)} ID ${hubspotObjectId}`);
    } catch (error) {
        console.error(`   - ❌ Failed to attach file to ${hubspotObjectId}:`, error.response?.data || error.message);
    }
}

async function main() {
    if (!process.env.HUBSPOT_API_KEY) {
        console.error('❌ CRITICAL ERROR: HUBSPOT_API_KEY not found in .env file. Please complete the setup steps.');
        return;
    }
    
    if (CONFIG.DRY_RUN) {
        console.log('\n================================================');
        console.log('              - - - DRY RUN - - -');
        console.log('   No files will be uploaded or attached.');
        console.log('================================================\n');
    }

    const objectTypes = [
        { type: 'contacts', hsKey: 'contactIds' },
        { type: 'companies', hsKey: 'companyIds' },
        { type: 'deals', hsKey: 'dealIds' },
    ];

    for (const { type, hsKey } of objectTypes) {
        const manifestPath = path.join(CONFIG.manifestsDir, `${type}_manifest.json`);
        let manifestData;
        try {
            const fileContent = await fs.promises.readFile(manifestPath, 'utf8');
            manifestData = JSON.parse(fileContent);
            console.log(`\nProcessing ${manifestData.length} files for ${type}...`);
        } catch (error) {
            console.log(`\nℹ️ No manifest file found for ${type} at ${manifestPath}. Skipping.`);
            continue;
        }

        for (const fileEntry of manifestData) {
            console.log(`\n[1/3] Finding file for SF ID: ${fileEntry.salesforce_file_id}`);
            const fullFilePath = await findFileById(fileEntry.file_location, fileEntry.salesforce_file_id);

            if (!fullFilePath) {
                console.log(`   - ⚠️  Could not find a renamed file for ID ${fileEntry.salesforce_file_id} in ${fileEntry.file_location}. Skipping.`);
                continue;
            }
            console.log(`   - ✅ Found file: ${path.basename(fullFilePath)}`);

            if (CONFIG.DRY_RUN) {
                console.log(`   - [DRY RUN] Would upload this file.`);
                console.log(`   - [DRY RUN] Would attach to ${type} ID ${fileEntry.hubspot_id}.`);
            } else {
                console.log(`[2/3] Uploading file...`);
                const hubspotFileId = await uploadFileToHubSpot(fullFilePath);

                if (hubspotFileId) {
                    console.log(`[3/3] Attaching file...`);
                    await attachFileToRecord(hsKey, fileEntry.hubspot_id, hubspotFileId, fileEntry);
                }
            }
            
            // Wait to avoid hitting API rate limits
            await new Promise(resolve => setTimeout(resolve, CONFIG.apiDelay));
        }
    }
    
    console.log('\n----------------------------------------');
    console.log('✨ Import script finished!');
    console.log('----------------------------------------');
}

main().catch(console.error);
