const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    mappersDir: './maps/',
    taskCsv: '../CSV/Task.csv',
    emailMessageCsv: '../CSV/EmailMessage.csv',
    outputDir: './',

    // ✅ NEW: Set to true to skip rows where no email body could be found
    // (not in EmailMessage.csv AND not in the Task.Description field).
    skipEmptyBodies: true,

    // ✅ NEW: Maximum size (in MB) for each output file chunk.
    // HubSpot's limit is 511MB, so 500MB is a safe buffer.
    MAX_CHUNK_SIZE_MB: 500
};

const TYPE_MAP = {
    emails: [
        'Email'
    ]
};
// ==================================================================

// --- Helper Functions (no changes here) ---

function formatCsvField(field) {
    const str = String(field ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        const escapedStr = str.replace(/"/g, '""');
        return `"${escapedStr}"`;
    }
    return str;
}

async function readCsv(filePath) {
    const results = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (err) => {
                if (err.code === 'ENOENT') {
                    console.warn(`   - ⚠️  File not found: ${filePath}. Skipping.`);
                    resolve([]);
                } else {
                    reject(err);
                }
            });
    });
}

async function loadMappers() {
    console.log('📖 Loading ID mapper files...');
    const sfToHsIdMap = {
        '001': new Map(), '003': new Map(), '00Q': new Map(),
        '006': new Map(), '500': new Map()
    };
    const mappersToLoad = [
        { name: 'company-mapper.csv', prefix: '001', sfIdColumns: ['SF ID'] },
        { name: 'contact-mapper.csv', prefix: '003', sfIdColumns: ['SF ID', 'SF Contact ID'] },
        { name: 'contact-mapper.csv', prefix: '00Q', sfIdColumns: ['SF Lead ID'] },
        { name: 'deal-mapper.csv', prefix: '006', sfIdColumns: ['sf_id', 'SF ID'] },
    ];
    for (const mapper of mappersToLoad) {
        try {
            const data = await readCsv(path.join(CONFIG.mappersDir, mapper.name));
            let count = 0;
            for (const row of data) {
                const hsId = row['Record ID'];
                let sfId = null;
                for (const col of mapper.sfIdColumns) {
                    if (row[col]) {
                        sfId = row[col];
                        break;
                    }
                }
                if (hsId && sfId) {
                    sfToHsIdMap[mapper.prefix].set(sfId, hsId);
                    count++;
                }
            }
            console.log(`   - Loaded ${count} mappings from ${mapper.name} for prefix ${mapper.prefix}.`);
        } catch (error) {
            console.warn(`   - ⚠️  Could not load ${mapper.name}. Skipping.`);
        }
    }
    return sfToHsIdMap;
}

async function loadEmailBodies() {
    console.log(`📖 Loading full email bodies from ${CONFIG.emailMessageCsv}...`);
    const emailBodyMap = new Map();
    try {
        const emailMessages = await readCsv(CONFIG.emailMessageCsv);
        for (const message of emailMessages) {
            if (message.ActivityId && (message.HtmlBody || message.TextBody)) {
                const body = message.HtmlBody || message.TextBody;
                emailBodyMap.set(message.ActivityId, body);
            }
        }
        console.log(`   - Loaded ${emailBodyMap.size} unique email bodies.`);
        return emailBodyMap;
    } catch (error) {
        console.warn(`   - ⚠️  Could not load ${CONFIG.emailMessageCsv}. Will fall back to Task descriptions.`);
        return new Map();
    }
}

function buildCsvRow(data, headers) {
    const row = headers.map(header => formatCsvField(data[header]));
    return row.join(',');
}

// ✅ NEW: Helper function to create a new writer and filename
function createWriter(assocType, chunkIndex = 1) {
    const filename = `hubspot_import_task_emails_for_${assocType}_chunk${chunkIndex}.csv`;
    const outputPath = path.join(CONFIG.outputDir, filename);
    console.log(`   - Creating new chunk file: ${filename}`);
    return fs.createWriteStream(outputPath);
}

// --- Main Function (Modified for Chunking) ---

async function main() {
    const [sfToHsIdMap, emailBodyMap] = await Promise.all([
        loadMappers(),
        loadEmailBodies()
    ]);

    const reverseTypeMap = {};
    for (const [hsType, sfTypes] of Object.entries(TYPE_MAP)) {
        for (const sfType of sfTypes) {
            reverseTypeMap[sfType] = hsType;
        }
    }
    
    // ✅ MODIFIED: Set up writers and stats for chunking
    const emailHeaders = ['Record ID', 'Email body', 'Activity date', 'Email direction', 'Email subject'];
    const emailHeadersString = emailHeaders.join(',') + '\n';
    const emailHeadersBytes = Buffer.byteLength(emailHeadersString, 'utf8');
    const MAX_CHUNK_SIZE_BYTES = CONFIG.MAX_CHUNK_SIZE_MB * 1024 * 1024;

    const assocTypes = ['contacts', 'companies', 'deals', 'other'];
    const outputWriters = {};
    const outputStats = {};

    for (const type of assocTypes) {
        outputStats[type] = { currentSize: emailHeadersBytes, chunkIndex: 1, totalCount: 0 };
        outputWriters[type] = createWriter(type, 1);
        outputWriters[type].write(emailHeadersString); // Write header to the first file
    }

    console.log(`\n🔄 Processing ${CONFIG.taskCsv} (streaming)...`);

    await new Promise((resolve, reject) => {
        fs.createReadStream(CONFIG.taskCsv)
            .pipe(csv())
            .on('data', (task) => {
                try {
                    const hsEngagementType = reverseTypeMap[task.Type];
                    if (hsEngagementType !== 'emails') {
                        return;
                    }

                    // --- Association Logic (no change) ---
                    const associations = [];
                    const { WhoId, WhatId, AccountId } = task;
                    const whoPrefix = WhoId ? WhoId.substring(0, 3) : '';
                    if ((whoPrefix === '003' || whoPrefix === '00Q') && sfToHsIdMap[whoPrefix]?.has(WhoId)) {
                        associations.push({ type: 'contacts', hsId: sfToHsIdMap[whoPrefix].get(WhoId) });
                    }
                    if (AccountId && sfToHsIdMap['001']?.has(AccountId)) {
                        associations.push({ type: 'companies', hsId: sfToHsIdMap['001'].get(AccountId) });
                    }
                    const whatPrefix = WhatId ? WhatId.substring(0, 3) : '';
                    if (whatPrefix === '006' && sfToHsIdMap['006']?.has(WhatId)) {
                        associations.push({ type: 'deals', hsId: sfToHsIdMap['006'].get(WhatId) });
                    }
                    if (associations.length === 0) return;

                    // --- Body Logic (with new check) ---
                    const emailBody = emailBodyMap.get(task.Id) || task.Description || '';
                    
                    // ✅ NEW: Skip if body is empty and config is set
                    if (CONFIG.skipEmptyBodies && !emailBody) {
                        return; // Skip this row
                    }

                    const activityDate = task.ActivityDate || task.CreatedDate;
                    const rowData = {
                        'Email body': emailBody,
                        'Activity date': activityDate,
                        'Email direction': 'UNKNOWN',
                        'Email subject': task.Subject
                    };

                    // --- File Writing Logic (modified for chunking) ---
                    for (const assoc of associations) {
                        rowData['Record ID'] = assoc.hsId;
                        const csvRow = buildCsvRow(rowData, emailHeaders) + '\n';
                        const rowBytes = Buffer.byteLength(csvRow, 'utf8');
                        const stats = outputStats[assoc.type];

                        // Check if we need to roll over to a new chunk file
                        if (stats.currentSize > 0 && (stats.currentSize + rowBytes) > MAX_CHUNK_SIZE_BYTES) {
                            console.log(`   - Chunk ${stats.chunkIndex} for ${assoc.type} reached ${CONFIG.MAX_CHUNK_SIZE_MB}MB. Starting new chunk.`);
                            outputWriters[assoc.type].end(); // Close current file
                            stats.chunkIndex++;
                            outputWriters[assoc.type] = createWriter(assoc.type, stats.chunkIndex);
                            outputWriters[assoc.type].write(emailHeadersString); // Write header to new file
                            stats.currentSize = emailHeadersBytes; // Reset size
                        }

                        // Write the row and update stats
                        outputWriters[assoc.type].write(csvRow);
                        stats.currentSize += rowBytes;
                        stats.totalCount++;
                    }
                } catch (e) {
                    console.warn(`   - ⚠️  Error processing task row ${task.Id}: ${e.message}. Skipping.`);
                }
            })
            .on('end', () => {
                for (const writer of Object.values(outputWriters)) {
                    writer.end();
                }
                resolve();
            })
            .on('error', reject);
    });
    
    // ✅ MODIFIED: Updated logging
    console.log('\n----------------------------------------');
    console.log('✨ Task Email Processing Complete!');
    for (const type of assocTypes) {
        if (outputStats[type].totalCount > 0) {
            console.log(`   - ✅ Wrote ${outputStats[type].totalCount} total task-emails for ${type} across ${outputStats[type].chunkIndex} chunk file(s).`);
        }
    }
    console.log('----------------------------------------');
}

main().catch(console.error);
