const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    mappers: {
        companies: './maps/company-mapper.csv',
        contacts: './maps/contact-mapper.csv',
        deals: './maps/deal-mapper.csv' // Your updated deals mapper
    },
    salesforce: {
        attachments: '../CSV/Attachment.csv',
        contentVersion: '../CSV/ContentVersion.csv',
        contentDocLink: '../CSV/ContentDocumentLink.csv'
        // NOTE: Opportunity.csv is no longer needed
    },
    files: {
        attachments: '../Attachments',
        contentVersion: '../ContentVersion'
    },
    outputDir: './'
};
// ==================================================================

async function readCsv(filePath) {
    const results = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

async function loadMappers() {
    console.log('📖 Loading ID mapper files...');
    const [companyData, contactData, dealData] = await Promise.all([
        readCsv(CONFIG.mappers.companies),
        readCsv(CONFIG.mappers.contacts),
        readCsv(CONFIG.mappers.deals)
    ]);

    const sfToHsIdMap = {
        '001': new Map(), // Account / Company
        '003': new Map(), // Contact
        '00Q': new Map(), // Lead
        '006': new Map()  // Opportunity / Deal
    };

    for (const row of companyData) {
        if (row['SF ID']) sfToHsIdMap['001'].set(row['SF ID'], row['Record ID']);
    }
    for (const row of contactData) {
        const hsId = row['Record ID'];
        const sfContactId = row['SF ID'] || row['SF Contact ID'];
        if (sfContactId) sfToHsIdMap['003'].set(sfContactId, hsId);
        if (row['SF Lead ID']) sfToHsIdMap['00Q'].set(row['SF Lead ID'], hsId);
    }
    
    // ✅ NEW: Simplified deal mapping logic
    for (const row of dealData) {
        // The script checks for 'sf_id' or 'SF ID' to be safe.
        // Please confirm this matches your actual column header.
        const sfDealId = row['sf_id'] || row['SF ID'];
        if (sfDealId) {
             sfToHsIdMap['006'].set(sfDealId, row['Record ID']);
        }
    }
    
    console.log(`   - Loaded ${sfToHsIdMap['001'].size} company mappings.`);
    console.log(`   - Loaded ${sfToHsIdMap['003'].size} contact mappings.`);
    console.log(`   - Loaded ${sfToHsIdMap['00Q'].size} lead mappings.`);
    console.log(`   - Loaded ${sfToHsIdMap['006'].size} deal mappings.`);
    return sfToHsIdMap;
}

async function processFiles(dataType, sfData, sfToHsIdMap, manifest) {
    console.log(`🔎 Processing ${dataType}...`);
    // This map now includes '006' for direct lookup
    const prefixMap = { '001': 'companies', '003': 'contacts', '00Q': 'contacts', '006': 'deals' };

    for (const record of sfData) {
        let parentId = (dataType === 'Attachments') ? record.ParentId : record.LinkedEntityId;
        if (!parentId) continue;

        let prefix = parentId.substring(0, 3);
        let objectType = prefixMap[prefix];
        
        // The complex, multi-step deal lookup is no longer needed.
        // This generic block now handles all object types, including deals.
        if (objectType && sfToHsIdMap[prefix]?.has(parentId)) {
            const hubspotId = sfToHsIdMap[prefix].get(parentId);
            const fileId = (dataType === 'Attachments') ? record.Id : record.VersionId;
            const filename = (dataType === 'Attachments') ? record.Name : record.Title;
            const fileLocation = (dataType === 'Attachments') ? CONFIG.files.attachments : CONFIG.files.contentVersion;

            manifest[objectType].push({
                hubspot_id: hubspotId,
                original_sf_id: parentId,
                salesforce_file_id: fileId,
                file_location: fileLocation.replace(/\\/g, '/'),
                original_filename: filename
            });
        }
    }
}

async function main() {
    const sfToHsIdMap = await loadMappers();
    
    const fileManifest = { companies: [], contacts: [], deals: [] };
    
    // Process Attachments
    const attachments = await readCsv(CONFIG.salesforce.attachments);
    await processFiles('Attachments', attachments, sfToHsIdMap, fileManifest);

    // Process ContentVersions
    const [links, versions] = await Promise.all([
        readCsv(CONFIG.salesforce.contentDocLink),
        readCsv(CONFIG.salesforce.contentVersion)
    ]);
    const docLinkMap = new Map(links.map(l => [l.ContentDocumentId, l.LinkedEntityId]));
    const latestVersions = versions
        .filter(v => v.IsLatest === '1' && v.FileType !== 'SNOTE')
        .map(v => ({ ...v, VersionId: v.Id, LinkedEntityId: docLinkMap.get(v.ContentDocumentId) }));
    await processFiles('ContentVersions', latestVersions, sfToHsIdMap, fileManifest);

    console.log('\n----------------------------------------');
    console.log('✨ Manifest Generation Complete!');

    for (const [objectType, data] of Object.entries(fileManifest)) {
        if (data.length > 0) {
            const outputPath = path.join(CONFIG.outputDir, `${objectType}_manifest.json`);
            await fs.promises.writeFile(outputPath, JSON.stringify(data, null, 2));
            console.log(`   - ✅ Wrote ${data.length} file entries to ${outputPath}`);
        } else {
            console.log(`   - ℹ️ No files found for ${objectType}.`);
        }
    }
    console.log('----------------------------------------');
}

main().catch(console.error);
