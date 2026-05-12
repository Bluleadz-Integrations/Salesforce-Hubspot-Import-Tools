const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    mappersDir: '../maps/',
    salesforce: {
        campaigns: '../CSV/wbsendit__Campaign_Monitor_Campaign__c.csv',
        activities: '../CSV/wbsendit__Campaign_Activity__c.csv'
    },
    outputDir: './',
    chunkSize: 2000 // Number of rows per CSV file
};
// ==================================================================

// Helper: Normalize Salesforce IDs to 15 characters safely
function safeId(id) {
    if (!id) return null;
    return String(id).trim().substring(0, 15);
}

// Helper: Format fields for CSV output safely
function formatCsvField(field) {
    const str = String(field ?? '');
    
    // 🚀 THE FIX: HubSpot thinks this is an HTML file because of all the raw HTML newlines.
    // We replace physical line breaks with spaces to force a strict CSV row structure.
    const noNewlinesStr = str.replace(/[\r\n]+/g, ' ');
    
    // Escape quotes for standard CSV compliance
    const escapedStr = noNewlinesStr.replace(/"/g, '""');
    return `"${escapedStr}"`;
}

// Helper: Case-insensitive, multi-name column search
function getVal(row, possibleKeys) {
    const rowKeys = Object.keys(row);
    for (const key of possibleKeys) {
        const match = rowKeys.find(k => k.toLowerCase().trim() === key.toLowerCase());
        if (match && row[match]) return row[match];
    }
    return null;
}

// Helper: Read CSV files
async function readCsv(filePath) {
    const results = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (err) => {
                if (err.code === 'ENOENT') {
                    console.warn(`   ⚠️ WARNING: File not found: ${filePath}`);
                    resolve([]);
                } else reject(err);
            });
    });
}

// 1. Load Campaign Names, Subjects, and Bodies
async function loadCampaigns() {
    console.log('📢 Loading Campaign Monitor Campaigns...');
    const campaignMap = new Map(); // Maps external Hash ID OR SF ID to campaign info
    
    const campaigns = await readCsv(CONFIG.salesforce.campaigns);
    
    // --- PRE-SCAN: Calculate exact number of fetches needed ---
    let totalFetchesNeeded = 0;
    for (const row of campaigns) {
        const body = getVal(row, ['wbsendit__HTML_Version__c', 'HTML_Version__c', 'wbsendit__Text_Version__c']);
        const webUrl = getVal(row, ['wbsendit__Web_Version_URL__c', 'Web_Version_URL__c']);
        if (!body && webUrl) {
            totalFetchesNeeded++;
        }
    }
    console.log(`   - Found ${campaigns.length} total campaigns. ${totalFetchesNeeded} require live HTML downloading.`);

    let count = 0;
    let fetchedCount = 0;
    
    for (const row of campaigns) {
        const sfId = safeId(getVal(row, ['Id', 'ID']));
        const extHashId = getVal(row, ['wbsendit__Campaign_ID__c', 'Campaign_ID__c']);
        
        // Grab Subject
        const name = getVal(row, ['Name', 'NAME']) || 'Unnamed Campaign';
        const subject = getVal(row, ['wbsendit__Subject__c', 'Subject__c']) || name || 'No Subject';
        
        // Grab Body (Check HTML, then Text, then fallback to Web URL from TSV)
        let body = getVal(row, ['wbsendit__HTML_Version__c', 'HTML_Version__c', 'wbsendit__Text_Version__c']);
        const webUrl = getVal(row, ['wbsendit__Web_Version_URL__c', 'Web_Version_URL__c']);

        if (!body && webUrl) {
            fetchedCount++;
            console.log(`   🌐 [${fetchedCount}/${totalFetchesNeeded}] Downloading HTML for: ${name}...`);
            try {
                // Dynamically fetch the HTML straight from the live web URL
                const response = await fetch(webUrl);
                if (response.ok) {
                    body = await response.text();
                } else {
                    body = `<a href="${webUrl}">View original email in browser: ${name}</a>`;
                }
            } catch (err) {
                body = `<a href="${webUrl}">View original email in browser: ${name}</a>`;
            }
        } else if (!body) {
            body = `[Campaign Monitor Email Sent: ${name}]`;
        }

        const campaignInfo = { name, subject, body };

        // Save using both keys so Activity mapper can find it no matter what!
        if (sfId) campaignMap.set(sfId, campaignInfo);
        if (extHashId) campaignMap.set(extHashId, campaignInfo);
        
        count++;
    }
    console.log(`   ✅ Finished loading ${count} Campaign records into memory.`);
    return campaignMap;
}

// 2. Load HubSpot Contacts/Leads Mappers
async function loadContactMappers() {
    console.log('\n📖 Loading ID mapper files for Contacts & Leads...');
    const sfToHsIdMap = new Map();
    
    const mappersToLoad = [
        { name: 'contact-mapper.csv', sfIdColumns: ['SF ID', 'SF Contact ID', 'SF Lead ID'] }
    ];

    for (const mapper of mappersToLoad) {
        try {
            const mapperPath = path.join(CONFIG.mappersDir, mapper.name);
            const data = await readCsv(mapperPath);
            let count = 0;

            for (const row of data) {
                const hsId = row['Record ID'];
                let sfId = null;
                for (const col of mapper.sfIdColumns) {
                    if (row[col]) { sfId = row[col]; break; }
                }
                if (hsId && sfId) {
                    sfToHsIdMap.set(safeId(sfId), hsId);
                    count++;
                }
            }
            console.log(`   - Loaded ${count} mappings from ${mapper.name}.`);
        } catch (error) {
            console.warn(`   - ⚠️  Could not load ${mapper.name}.`);
        }
    }
    return sfToHsIdMap;
}

// Helper: Create a new write stream for chunked output
function createNewChunkStream(partIndex) {
    const outputPath = path.join(CONFIG.outputDir, `HubSpot_Import_Campaign_Monitor_Emails_Part_${partIndex}.csv`);
    const ws = fs.createWriteStream(outputPath);
    const header = ['Record ID', 'Email Subject', 'Email Body', 'Activity Date', 'Email Direction'];
    ws.write(header.join(',') + '\n');
    return { stream: ws, path: outputPath };
}

// 3. Process Activities
async function main() {
    const [campaignMap, sfToHsIdMap] = await Promise.all([
        loadCampaigns(),
        loadContactMappers()
    ]);

    console.log(`\n🔄 Processing Campaign Monitor Activities from ${CONFIG.salesforce.activities}...`);
    const activities = await readCsv(CONFIG.salesforce.activities);

    let matchCount = 0;
    let skippedInteractionCount = 0;
    let missingContactCount = 0;

    let currentFileIndex = 1;
    let rowsInCurrentFile = 0;
    let currentStreamObj = createNewChunkStream(currentFileIndex);
    const generatedFiles = [currentStreamObj.path];

    for (const row of activities) {
        // ONLY PROCESS "SENT" EMAILS (Ignore Opens/Clicks/Bounces)
        const action = (getVal(row, ['wbsendit__Activity__c', 'Activity__c']) || '').toLowerCase();
        if (action !== 'sent') {
            skippedInteractionCount++;
            continue;
        }

        // Find who this belongs to
        const parentId = safeId(getVal(row, ['wbsendit__Contact__c', 'Contact__c'])) || 
                         safeId(getVal(row, ['wbsendit__Lead__c', 'Lead__c']));
        
        if (!parentId) {
            missingContactCount++;
            continue;
        }

        const hubspotId = sfToHsIdMap.get(parentId);

        if (hubspotId) {
            // First try matching via the external Hash ID (highly reliable)
            const extHashId = getVal(row, ['wbsendit__Campaign_Id__c', 'Campaign_Id__c']);
            // Fallback to the standard Salesforce lookup ID
            const sfCampaignId = safeId(getVal(row, [
                'wbsendit__Campaign_Monitor_Campaign__c',
                'wbsendit__Campaign_Report__c',
                'wbsendit__Campaign__c'
            ]));
                               
            const campaign = campaignMap.get(extHashId) || campaignMap.get(sfCampaignId) || { 
                subject: 'Unknown Subject', 
                body: '[Email content unavailable]' 
            };
            
            const date = getVal(row, ['wbsendit__Activity_Date__c', 'Activity_Date__c']);

            const csvRow = [
                formatCsvField(hubspotId),
                formatCsvField(campaign.subject),
                formatCsvField(campaign.body),
                formatCsvField(date),
                formatCsvField('Sent')
            ].join(',');
            
            // Chunking logic: If we hit the limit, rotate the file stream
            if (rowsInCurrentFile >= CONFIG.chunkSize) {
                currentStreamObj.stream.end(); // close current file
                
                currentFileIndex++;
                currentStreamObj = createNewChunkStream(currentFileIndex);
                generatedFiles.push(currentStreamObj.path);
                
                rowsInCurrentFile = 0;
            }

            // Write logic with backpressure handling
            const canWrite = currentStreamObj.stream.write(csvRow + '\n');
            if (!canWrite) {
                await new Promise(resolve => currentStreamObj.stream.once('drain', resolve));
            }
            
            rowsInCurrentFile++;
            matchCount++;
        } else {
            missingContactCount++;
        }
    }
    
    currentStreamObj.stream.end(); // close the final file
    
    console.log(`   - Successfully mapped ${matchCount} Sent emails to HubSpot Contacts/Leads.`);
    console.log(`   - Skipped ${skippedInteractionCount} interactions (Opens, Clicks, Bounces ignored).`);
    console.log(`   - Skipped ${missingContactCount} items (Contact not migrated or orphaned).`);
    
    console.log('\n----------------------------------------');
    if (matchCount > 0) {
        console.log(`✨ ✅ Wrote ${matchCount} Campaign Emails across ${generatedFiles.length} files:`);
        generatedFiles.forEach(file => console.log(`      - ${file}`));
    } else {
        console.log('ℹ️ No valid Sent Campaign Activities found to map.');
    }
    console.log('----------------------------------------');
}

main().catch(console.error);
