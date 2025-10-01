const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    // Paths to your ID mapping files
    mappersDir: './maps/',
    // Path to your main Salesforce Events.csv export
    eventsCsv: '../CSV/Event.csv',
    // Where to save the final HubSpot import files
    outputDir: './'
};

/**
 * ✅ CUSTOM TYPE MAPPING
 * Map your unique Salesforce Event 'Type' values to one of the three
 * HubSpot engagement types: 'calls', 'meetings', or 'emails'.
 * Anything not in this map will be ignored.
 */
const TYPE_MAP = {
    calls: [
        'Call',
        'Qual Call' // Your example
    ],
    meetings: [
        'Meeting',
        'Demo'      // Your example
    ],
    emails: [
        'Email'
    ]
};
// ==================================================================

// Helper function to format a field for a CSV file
function formatCsvField(field) {
    const str = String(field ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        const escapedStr = str.replace(/"/g, '""');
        return `"${escapedStr}"`;
    }
    return str;
}

// Helper to read a CSV and return its data
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

// Reusable function to load all your mappers
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

// Function to build a HubSpot CSV row from an array of objects
function buildCsvRow(data, headers) {
    const row = headers.map(header => formatCsvField(data[header]));
    return row.join(',');
}

async function main() {
    const sfToHsIdMap = await loadMappers();

    // Reverse the TYPE_MAP for quick lookups
    const reverseTypeMap = {};
    for (const [hsType, sfTypes] of Object.entries(TYPE_MAP)) {
        for (const sfType of sfTypes) {
            reverseTypeMap[sfType] = hsType;
        }
    }
    
    // Prepare data structures for output
    const outputData = {
        calls: { contacts: [], companies: [], deals: [] },
        meetings: { contacts: [], companies: [], deals: [] },
        emails: { contacts: [], companies: [], deals: [] },
    };
    
    // Define HubSpot headers for each import type
    const headers = {
        calls: ['Record ID', 'Call notes', 'Activity date', 'Call direction', 'Call title'],
        meetings: ['Record ID', 'Meeting description', 'Activity date', 'Meeting start time', 'Meeting end time', 'Meeting title'],
        emails: ['Record ID', 'Email body', 'Activity date', 'Email direction', 'Email subject']
    };

    console.log(`\n🔄 Processing ${CONFIG.eventsCsv}...`);
    const events = await readCsv(CONFIG.eventsCsv);

    for (const event of events) {
        const hsEngagementType = reverseTypeMap[event.Type];
        if (!hsEngagementType) {
            continue; // Skip event types we don't care about
        }

        // --- Find all associations ---
        const associations = [];
        const { WhoId, WhatId, AccountId } = event;

        // Contact / Lead association
        const whoPrefix = WhoId ? WhoId.substring(0, 3) : '';
        if ((whoPrefix === '003' || whoPrefix === '00Q') && sfToHsIdMap[whoPrefix]?.has(WhoId)) {
            associations.push({ type: 'contacts', hsId: sfToHsIdMap[whoPrefix].get(WhoId) });
        }

        // Company / Account association
        if (AccountId && sfToHsIdMap['001']?.has(AccountId)) {
            associations.push({ type: 'companies', hsId: sfToHsIdMap['001'].get(AccountId) });
        }

        // Deal / Opportunity association
        const whatPrefix = WhatId ? WhatId.substring(0, 3) : '';
        if (whatPrefix === '006' && sfToHsIdMap['006']?.has(WhatId)) {
            associations.push({ type: 'deals', hsId: sfToHsIdMap['006'].get(WhatId) });
        }
        
        // If no mapped associations were found for this event, skip it
        if (associations.length === 0) continue;

        // --- Build the HubSpot row based on engagement type ---
        let rowData = {};
        const activityDate = event.ActivityDateTime || event.CreatedDate;

        if (hsEngagementType === 'calls') {
            rowData = { 'Record ID': '', 'Call notes': event.Description, 'Activity date': activityDate, 'Call direction': 'Outbound', 'Call title': event.Subject };
        } else if (hsEngagementType === 'meetings') {
            const startTime = new Date(activityDate);
            const duration = parseInt(event.DurationInMinutes, 10) || 0;
            const endTime = new Date(startTime.getTime() + duration * 60000);
            rowData = { 'Record ID': '', 'Meeting description': event.Description, 'Activity date': activityDate, 'Meeting start time': startTime.toISOString(), 'Meeting end time': endTime.toISOString(), 'Meeting title': event.Subject };
        } else if (hsEngagementType === 'emails') {
            rowData = { 'Record ID': '', 'Email body': event.Description, 'Activity date': activityDate, 'Email direction': 'UNKNOWN', 'Email subject': event.Subject };
        }

        // Add the row to each associated object type's list
        for (const assoc of associations) {
            rowData['Record ID'] = assoc.hsId;
            outputData[hsEngagementType][assoc.type].push(rowData);
        }
    }
    
    // --- Write all the final CSV files ---
    console.log('\n----------------------------------------');
    console.log('✨ Engagement Processing Complete!');

    for (const [engagementType, assocData] of Object.entries(outputData)) {
        for (const [assocType, data] of Object.entries(assocData)) {
            if (data.length > 0) {
                const outputHeaders = headers[engagementType];
                const csvRows = [outputHeaders.join(',')]; // Start with the header
                data.forEach(row => {
                    csvRows.push(buildCsvRow(row, outputHeaders));
                });

                const filename = `hubspot_import_${engagementType}_for_${assocType}.csv`;
                const outputPath = path.join(CONFIG.outputDir, filename);
                await fs.promises.writeFile(outputPath, csvRows.join('\n'));
                console.log(`   - ✅ Wrote ${data.length} ${engagementType} to ${outputPath}`);
            }
        }
    }
    console.log('----------------------------------------');
}

main().catch(console.error);
