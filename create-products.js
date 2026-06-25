const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    // Path to your Salesforce Product2.csv export
    productsCsv: './salesforce-exports/Product2.csv',
    // Where to save the final HubSpot import file
    outputDir: './'
};

/**
 * ✅ FIELD MAPPING
 * Maps Salesforce Product2 field names to HubSpot product property names.
 * Standard HubSpot product properties: name, description, price, hs_sku,
 * hs_product_type, hs_url. Adjust the right-hand side to match whatever
 * property names you've created in HubSpot.
 */
const FIELD_MAP = {
    'Name':             'name',
    'Description':      'description',
    'ProductCode':      'product_code',
    'StockKeepingUnit': 'hs_sku',
    'Family':           'hs_product_type',
    'DisplayUrl':       'hs_url',
    'QuantityUnit':     'quantity_unit',
    'IsActive':         'is_active',
    'ExternalId':       'external_id',
    'CreatedDate':      'salesforce_created_date',
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

async function main() {
    const headers = Object.values(FIELD_MAP);
    const rows = [headers.join(',')];
    let skippedDeleted = 0;
    let skippedArchived = 0;
    let written = 0;

    console.log(`\n🔄 Processing ${CONFIG.productsCsv}...`);
    const products = await readCsv(CONFIG.productsCsv);

    for (const product of products) {
        if (product.IsDeleted === '1') {
            skippedDeleted++;
            continue;
        }
        if (product.IsArchived === '1') {
            skippedArchived++;
            continue;
        }

        const rowValues = Object.keys(FIELD_MAP).map(sfField => formatCsvField(product[sfField]));
        rows.push(rowValues.join(','));
        written++;
    }

    console.log('\n----------------------------------------');
    console.log('✨ Products Processing Complete!');

    if (written > 0) {
        const outputPath = path.join(CONFIG.outputDir, 'hubspot_import_products.csv');
        await fs.promises.writeFile(outputPath, rows.join('\n'));
        console.log(`   - ✅ Wrote ${written} products to ${outputPath}`);
    } else {
        console.log('   - ⚠️  No products were written.');
    }

    if (skippedDeleted > 0)  console.log(`   - ⏭️  Skipped ${skippedDeleted} deleted products.`);
    if (skippedArchived > 0) console.log(`   - ⏭️  Skipped ${skippedArchived} archived products.`);

    console.log('----------------------------------------');
}

main().catch(console.error);
