const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    // Path to your Salesforce Yodlee_Platform_ID__c export
    yodleeCsv: './salesforce-exports/Yodlee_Platform_ID__c.csv',
    // Where to save the final HubSpot import file
    outputDir: './'
};

/**
 * ✅ FIELD MAPPING
 * Maps Salesforce field names to HubSpot custom object property names.
 * Adjust the HubSpot property names (right side) to match whatever
 * internal names you used when creating the custom object in HubSpot.
 */
const FIELD_MAP = {
    'Name':                  'name',
    'Co_Brand_ID__c':        'co_brand_id',
    'Environment__c':        'environment',
    'Is_Channel__c':         'is_channel',
    'Channel_Partner_ID__c': 'channel_partner_id',
    'Contractual_Minimum__c':'contractual_minimum',
    'Fastlink__c':           'fastlink',
    'Platform_Version__c':   'platform_version',
    'Decomissioned__c':      'decomissioned',
    'Environment_Type__c':   'environment_type',
    'Subbra__c':             'subbra',
    'CreatedDate':           'salesforce_created_date',
};
// ==================================================================

function formatCsvField(field) {
    const str = String(field ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
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
            .on('error', reject);
    });
}

async function main() {
    // Build output headers: mapped property columns + association lookup column.
    // During HubSpot import, map "Associated Company migrated_id" to the
    // migrated_id property on the Company object to resolve the association.
    const hsPropertyHeaders = Object.values(FIELD_MAP);
    const headers = [...hsPropertyHeaders, 'Associated Company migrated_id'];

    const rows = [headers.join(',')];
    let skippedDeleted = 0;
    let skippedNoAccount = 0;
    let written = 0;

    console.log(`\n🔄 Processing ${CONFIG.yodleeCsv}...`);
    const records = await readCsv(CONFIG.yodleeCsv);

    for (const record of records) {
        if (record.IsDeleted === '1') {
            skippedDeleted++;
            continue;
        }

        const accountId = record.Account__c;
        if (!accountId) {
            skippedNoAccount++;
            continue;
        }

        const rowValues = Object.keys(FIELD_MAP).map(sfField => formatCsvField(record[sfField]));
        rowValues.push(formatCsvField(accountId));
        rows.push(rowValues.join(','));
        written++;
    }

    console.log('\n----------------------------------------');
    console.log('✨ Yodlee Platform ID Processing Complete!');

    if (written > 0) {
        const outputPath = path.join(CONFIG.outputDir, 'hubspot_import_yodlee_platform_ids.csv');
        await fs.promises.writeFile(outputPath, rows.join('\n'));
        console.log(`   - ✅ Wrote ${written} records to ${outputPath}`);
    } else {
        console.log('   - ⚠️  No records were written.');
    }

    if (skippedDeleted > 0)   console.log(`   - ⏭️  Skipped ${skippedDeleted} deleted records.`);
    if (skippedNoAccount > 0) console.log(`   - ⏭️  Skipped ${skippedNoAccount} records with no Account__c.`);

    console.log('----------------------------------------');
}

main().catch(console.error);
