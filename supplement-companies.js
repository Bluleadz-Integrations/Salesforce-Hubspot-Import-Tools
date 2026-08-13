const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    // HubSpot export containing the Record ID + Salesforce Account ID
    hubspotCsv: './hubspot-exports/companies-with-salesforce-ids.csv',
    // Salesforce Account export to pull supplemental fields from
    accountCsv: './salesforce-exports/Account.csv',
    // Where to save the final HubSpot import file
    outputDir: './',

    // Salesforce Account fields to pull in, alongside the HubSpot property
    // name they should be imported into.
    fieldMap: {
        'Account_Manager__c':  'account_manager',
        'Client_Partner__c':   'client_partner',
        'Delivery_Manager__c': 'delivery_manager',
        'ParentId':            'parent_id'
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
    console.log(`\n🔄 Reading ${CONFIG.accountCsv}...`);
    const accountRows = await readCsv(CONFIG.accountCsv);
    const accountsById = new Map(accountRows.map(row => [row.Id, row]));
    console.log(`   - ${accountsById.size} Salesforce accounts loaded.`);

    console.log(`\n🔄 Reading ${CONFIG.hubspotCsv}...`);
    const companyRows = await readCsv(CONFIG.hubspotCsv);
    console.log(`   - ${companyRows.length} HubSpot companies loaded.`);

    const sfFields = Object.keys(CONFIG.fieldMap);
    const headers = ['Record ID', ...Object.values(CONFIG.fieldMap)];
    const rows = [headers.join(',')];

    let matched = 0;
    const missing = [];

    for (const company of companyRows) {
        const recordId = company['Record ID'];
        const sfAccountId = company['Salesforce Account ID'];

        if (!sfAccountId) {
            missing.push(recordId);
            continue;
        }

        const account = accountsById.get(sfAccountId);
        if (!account) {
            missing.push(recordId);
            continue;
        }

        const rowValues = [
            formatCsvField(recordId),
            ...sfFields.map(field => formatCsvField(account[field]))
        ];
        rows.push(rowValues.join(','));
        matched++;
    }

    console.log('\n----------------------------------------');
    console.log('✨ Company Supplement Processing Complete!');

    if (matched > 0) {
        const outputPath = path.join(CONFIG.outputDir, 'hubspot_import_companies_supplement.csv');
        await fs.promises.writeFile(outputPath, rows.join('\n'));
        console.log(`   - ✅ Wrote ${matched} records to ${outputPath}`);
    } else {
        console.log('   - ⚠️  No records were written.');
    }

    if (missing.length > 0) {
        console.log(`   - ⏭️  Skipped ${missing.length} companies with no matching Salesforce account.`);
    }

    console.log('----------------------------------------');
}

main().catch(console.error);
