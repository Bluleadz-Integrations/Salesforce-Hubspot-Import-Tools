const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    // HubSpot export containing the Record ID + Salesforce Opportunity ID
    hubspotCsv: './hubspot-exports/hubspot-crm-exports-opps-with-salesforce-ids-072926-2026-07-29.csv',
    // Salesforce Opportunity export to pull supplemental fields from
    opportunityCsv: './salesforce-exports/Opportunity.csv',
    // Where to save the final HubSpot import file
    outputDir: './',

    // Salesforce Opportunity fields to pull in, alongside the HubSpot property
    // name they should be imported into.
    fieldMap: {
        'Type': 'dealtype'
    },

    // Per-field value translations, keyed by Salesforce field name, mapping the
    // Salesforce value to the HubSpot internal option value.
    valueMap: {
        'Type': {
            'New Business': 'newbusiness',
            'Existing Business': 'existingbusiness',
            'Renewal': 'renewal',
            'Channel': 'channel',
            'Business Development': 'businessdevelopment',
            'Incoming from Channel Partner': 'incomingfromchannelpartner',
            'Outgoing to Channel partner': 'outgoingtochannelpartner',
            'All In': 'allin',
            'Biller Network': 'billernetwork',
            '4th/5th Year Booking': '4th/5thyearbooking',
            'Evaluation': 'evaluation',
            'PS-Change Order': 'ps-changeorder',
            'New Business - PY Debooking': 'newbusiness-pydebooking',
            'Renewal - CY Debooking': 'renewal-cydebooking',
            'Renewal - PY Debooking': 'renewal-pydebooking',
            'New Business - CY Debooking': 'newbusiness-cydebooking',
            'Dev Portal User': 'devportaluser',
            'BAC': 'bac',
            'Mid-Market': 'mid-market',
            'F.I. Opportunity': 'fiopportunity'
        }
    }
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
    console.log(`\n🔄 Reading ${CONFIG.opportunityCsv}...`);
    const opportunityRows = await readCsv(CONFIG.opportunityCsv);
    const opportunitiesById = new Map(opportunityRows.map(row => [row.Id, row]));
    console.log(`   - ${opportunitiesById.size} Salesforce opportunities loaded.`);

    console.log(`\n🔄 Reading ${CONFIG.hubspotCsv}...`);
    const dealRows = await readCsv(CONFIG.hubspotCsv);
    console.log(`   - ${dealRows.length} HubSpot deals loaded.`);

    const sfFields = Object.keys(CONFIG.fieldMap);
    const headers = ['Record ID', ...Object.values(CONFIG.fieldMap)];
    const rows = [headers.join(',')];

    let matched = 0;
    const missing = [];
    const unmappedValues = new Set();

    for (const deal of dealRows) {
        const recordId = deal['Record ID'];
        const sfOpportunityId = deal['Opportunity ID'];

        if (!sfOpportunityId) {
            missing.push(recordId);
            continue;
        }

        const opportunity = opportunitiesById.get(sfOpportunityId);
        if (!opportunity) {
            missing.push(recordId);
            continue;
        }

        const rowValues = [
            formatCsvField(recordId),
            ...sfFields.map(field => {
                const rawValue = opportunity[field];
                const valueMap = CONFIG.valueMap[field];
                if (!valueMap || !rawValue) {
                    return formatCsvField(rawValue);
                }
                if (!(rawValue in valueMap)) {
                    unmappedValues.add(`${field}: "${rawValue}"`);
                    return formatCsvField(rawValue);
                }
                return formatCsvField(valueMap[rawValue]);
            })
        ];
        rows.push(rowValues.join(','));
        matched++;
    }

    console.log('\n----------------------------------------');
    console.log('✨ Deal Supplement Processing Complete!');

    if (matched > 0) {
        const outputPath = path.join(CONFIG.outputDir, 'hubspot_import_deals_supplement.csv');
        await fs.promises.writeFile(outputPath, rows.join('\n'));
        console.log(`   - ✅ Wrote ${matched} records to ${outputPath}`);
    } else {
        console.log('   - ⚠️  No records were written.');
    }

    if (missing.length > 0) {
        console.log(`   - ⏭️  Skipped ${missing.length} deals with no matching Salesforce opportunity.`);
    }

    if (unmappedValues.size > 0) {
        console.log(`   - ⚠️  ${unmappedValues.size} value(s) had no entry in valueMap and were passed through as-is:`);
        for (const value of unmappedValues) {
            console.log(`       ${value}`);
        }
    }

    console.log('----------------------------------------');
}

main().catch(console.error);
