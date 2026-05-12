const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    mappersDir: './maps/',
    emailMessageCsv: './CSV/EmailMessage.csv',
    tasksCsv: './CSV/Task.csv', // Used as a decoder ring to find the Contact IDs
    outputDir: './'
};
// ==================================================================

// Helper: Format a field for CSV safely
function formatCsvField(field) {
    const str = String(field ?? '');
    // Strip physical newlines to prevent HubSpot from thinking this is an HTML file
    const noNewlinesStr = str.replace(/[\r\n]+/g, ' '); 
    const escapedStr = noNewlinesStr.replace(/"/g, '""');
    return `"${escapedStr}"`;
}

// Helper: Read a CSV and return its data
async function readCsv(filePath) {
    const results = [];
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            console.warn(`   ⚠️ WARNING: File not found: ${filePath}`);
            return resolve([]);
        }
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

// 1. Load ID Mappers
async function loadMappers() {
    console.log('📖 Loading ID mapper files...');
    const sfToHsIdMap = {
        '001': new Map(), '003': new Map(), '00Q': new Map(), '006': new Map()
    };
    
    const mappersToLoad = [
        { name: 'company-mapper.csv', prefix: '001', sfIdColumns: ['SF ID'] },
        { name: 'contact-mapper.csv', prefix: '003', sfIdColumns: ['SF ID', 'SF Contact ID'] },
        { name: 'contact-mapper.csv', prefix: '00Q', sfIdColumns: ['SF Lead ID'] },
        { name: 'deal-mapper.csv', prefix: '006', sfIdColumns: ['sf_id', 'SF ID'] }
    ];

    for (const mapper of mappersToLoad) {
        try {
            const data = await readCsv(path.join(CONFIG.mappersDir, mapper.name));
            let count = 0;
            for (const row of data) {
                const hsId = row['Record ID'];
                let sfId = null;
                for (const col of mapper.sfIdColumns) {
                    if (row[col]) { sfId = row[col]; break; }
                }
                if (hsId && sfId) {
                    sfToHsIdMap[mapper.prefix].set(sfId.substring(0, 15), hsId);
                    count++;
                }
            }
            console.log(`   - Loaded ${count} mappings from ${mapper.name} for prefix ${mapper.prefix}.`);
        } catch (error) {
            console.warn(`   - ⚠️ Could not load ${mapper.name}. Skipping.`);
        }
    }
    return sfToHsIdMap;
}

// 2. Load Task.csv to use as a decoder ring
async function loadTaskDecoder() {
    console.log('\n📖 Loading Task.csv to build email association decoder ring...');
    const taskMap = new Map();
    const tasks = await readCsv(CONFIG.tasksCsv);
    
    for (const row of tasks) {
        if (row.Id) {
            taskMap.set(row.Id.substring(0, 15), {
                WhoId: row.WhoId ? row.WhoId.substring(0, 15) : null,
                WhatId: row.WhatId ? row.WhatId.substring(0, 15) : null,
                AccountId: row.AccountId ? row.AccountId.substring(0, 15) : null
            });
        }
    }
    console.log(`   - Mapped ${taskMap.size} Tasks for cross-referencing.`);
    return taskMap;
}

// 3. Process Enhanced Emails
async function main() {
    const sfToHsIdMap = await loadMappers();
    const taskMap = await loadTaskDecoder();

    console.log(`\n🔄 Processing Enhanced Emails from ${CONFIG.emailMessageCsv}...`);
    const emailMessages = await readCsv(CONFIG.emailMessageCsv);

    const outputData = {
        contacts: [],
        companies: [],
        deals: []
    };

    let matchCount = 0;
    let skipCount = 0;

    for (const row of emailMessages) {
        // Skip system emails or empty rows
        if (!row.Id || row.Id === '000000000000000AAA') continue;

        // Use a Set to prevent linking the same email to the same Company twice
        const associations = { contacts: new Set(), companies: new Set(), deals: new Set() };

        const relatedToId = row.RelatedToId ? row.RelatedToId.substring(0, 15) : null;
        const activityId = row.ActivityId ? row.ActivityId.substring(0, 15) : null;

        // --- CHECK 1: Direct Link via RelatedToId ---
        if (relatedToId) {
            const prefix = relatedToId.substring(0, 3);
            if (prefix === '001' && sfToHsIdMap['001'].has(relatedToId)) associations.companies.add(sfToHsIdMap['001'].get(relatedToId));
            if ((prefix === '003' || prefix === '00Q') && sfToHsIdMap[prefix].has(relatedToId)) associations.contacts.add(sfToHsIdMap[prefix].get(relatedToId));
            if (prefix === '006' && sfToHsIdMap['006'].has(relatedToId)) associations.deals.add(sfToHsIdMap['006'].get(relatedToId));
        }

        // --- CHECK 2: Lookup Link via Task ActivityId ---
        if (activityId && taskMap.has(activityId)) {
            const task = taskMap.get(activityId);
            
            const whoPrefix = task.WhoId ? task.WhoId.substring(0, 3) : '';
            if ((whoPrefix === '003' || whoPrefix === '00Q') && sfToHsIdMap[whoPrefix].has(task.WhoId)) {
                associations.contacts.add(sfToHsIdMap[whoPrefix].get(task.WhoId));
            }
            
            if (task.AccountId && sfToHsIdMap['001'].has(task.AccountId)) {
                associations.companies.add(sfToHsIdMap['001'].get(task.AccountId));
            }
            
            const whatPrefix = task.WhatId ? task.WhatId.substring(0, 3) : '';
            if (whatPrefix === '001' && sfToHsIdMap['001'].has(task.WhatId)) associations.companies.add(sfToHsIdMap['001'].get(task.WhatId));
            if (whatPrefix === '006' && sfToHsIdMap['006'].has(task.WhatId)) associations.deals.add(sfToHsIdMap['006'].get(task.WhatId));
        }

        if (associations.contacts.size === 0 && associations.companies.size === 0 && associations.deals.size === 0) {
            skipCount++;
            continue; // No mapped HubSpot records found for this email
        }

        // --- BUILD EMAIL BODY ---
        const subject = row.Subject || '[No Subject]';
        const date = row.MessageDate || row.CreatedDate;
        const direction = (row.Incoming === '1' || row.Incoming?.toLowerCase() === 'true') ? 'INBOUND' : 'OUTBOUND';
        
        // Grab HTML Body, fallback to Text Body
        let bodyContent = row.HtmlBody || row.TextBody || '';
        
        // Inject Header Data (To, From, CC) so it looks beautiful in HubSpot
        let metadata = `<div style="background-color: #f9f9f9; padding: 10px; margin-bottom: 15px; border-radius: 5px;">`;
        if (row.FromName || row.FromAddress) metadata += `<b>From:</b> ${row.FromName} &lt;${row.FromAddress}&gt;<br>`;
        if (row.ToAddress) metadata += `<b>To:</b> ${row.ToAddress}<br>`;
        if (row.CcAddress) metadata += `<b>CC:</b> ${row.CcAddress}<br>`;
        if (row.BccAddress) metadata += `<b>BCC:</b> ${row.BccAddress}<br>`;
        metadata += `</div>`;

        const fullBody = metadata + bodyContent;

        const rowData = {
            'Email Subject': subject,
            'Email Body': fullBody,
            'Activity Date': date,
            'Email Direction': direction
        };

        // Push to appropriate output arrays
        for (const hsId of associations.contacts) outputData.contacts.push({ 'Record ID': hsId, ...rowData });
        for (const hsId of associations.companies) outputData.companies.push({ 'Record ID': hsId, ...rowData });
        for (const hsId of associations.deals) outputData.deals.push({ 'Record ID': hsId, ...rowData });

        matchCount++;
    }

    // --- WRITE CSV FILES ---
    console.log('\n----------------------------------------');
    console.log('✨ Enhanced Email Processing Complete!');
    console.log(`   - Matched ${matchCount} Emails successfully.`);
    console.log(`   - Skipped ${skipCount} Emails (System emails or orphaned records).`);

    const outputHeaders = ['Record ID', 'Email Subject', 'Email Body', 'Activity Date', 'Email Direction'];

    for (const [assocType, data] of Object.entries(outputData)) {
        if (data.length > 0) {
            const csvRows = [outputHeaders.join(',')];
            data.forEach(row => {
                csvRows.push(outputHeaders.map(h => formatCsvField(row[h])).join(','));
            });

            const filename = `hubspot_import_enhanced_emails_for_${assocType}.csv`;
            const outputPath = path.join(CONFIG.outputDir, filename);
            await fs.promises.writeFile(outputPath, csvRows.join('\n'));
            console.log(`   ✅ Wrote ${data.length} explicit links to ${outputPath}`);
        }
    }
    console.log('----------------------------------------');
}

main().catch(console.error);
