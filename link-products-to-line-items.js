require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    // Set to false to perform the actual creates.
    // START WITH true to verify the matches look correct first.
    DRY_RUN: false,

    // Path to the Yodlee OppProduct Export CSV
    lineItemsCsv: './salesforce-exports/Yodlee OppProduct Export.xlsx - Opportunity Product.csv',

    // HubSpot property on PRODUCTS that stores the Salesforce Product2 ID
    productIdentifierProperty: 'salesforce_product_id',

    // HubSpot property on DEALS that stores the Salesforce Opportunity ID (row.OpportunityId)
    dealIdentifierProperty: 'migrated_id',

    // Set to a number to cap how many line items are created. Set to null for all.
    rowLimit: null,

    // Delay in ms between API calls to stay under rate limits.
    apiDelay: 150,
};
// ==================================================================

const hubspotApi = axios.create({
    baseURL: 'https://api.hubapi.com',
    headers: { 'Authorization': `Bearer ${process.env.HUBSPOT_API_KEY}` }
});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
                    console.error(`❌ File not found: ${filePath}`);
                    resolve([]);
                } else {
                    reject(err);
                }
            });
    });
}

// Returns a Map of { identifierPropertyValue -> hubspotRecordId }
// Uses the list endpoint (not search) to avoid the 10,000-record search cap.
async function fetchAllHubSpotRecords(objectType, identifierProperty) {
    console.log(`📖 Fetching all HubSpot ${objectType} (by ${identifierProperty})...`);
    const resultMap = new Map();
    let after = undefined;

    do {
        const params = {
            limit: 100,
            properties: identifierProperty,
            ...(after ? { after } : {})
        };

        const response = await hubspotApi.get(`/crm/v3/objects/${objectType}`, { params });
        const { results, paging } = response.data;

        for (const record of results) {
            const identifierValue = record.properties[identifierProperty];
            if (identifierValue) {
                resultMap.set(identifierValue, record.id);
            }
        }

        after = paging?.next?.after;
        await sleep(CONFIG.apiDelay);
    } while (after);

    console.log(`   - Found ${resultMap.size} ${objectType} with a ${identifierProperty} value.`);
    return resultMap;
}

function cleanNumber(val) {
    return val ? String(val).replace(/[^0-9.-]/g, '') : undefined;
}

async function updateLineItem(hsLineItemId, hsProductId, row) {
    const payload = {
        properties: {
            hs_product_id: hsProductId,
            quantity: cleanNumber(row.Quantity),
            price: cleanNumber(row['UnitPrice']),
            amount: cleanNumber(row['TotalPrice']),
            stream: row['Stream__c'],
            salesforce_line_item_id: row['Id'],
        },
    };
    const response = await hubspotApi.patch(`/crm/v3/objects/line_items/${hsLineItemId}`, payload);
    return response.data.id;
}

async function createLineItem(hsProductId, hsDealId, row) {
    const payload = {
        properties: {
            hs_product_id: hsProductId,
            quantity: cleanNumber(row.Quantity),
            price: cleanNumber(row['UnitPrice']),
            amount: cleanNumber(row['TotalPrice']),
            stream: row['Stream__c'],
            salesforce_line_item_id: row['Id']
        },
        associations: [
            {
                to: { id: hsDealId },
                types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 20 }]
            }
        ]
    };

    const response = await hubspotApi.post('/crm/v3/objects/line_items', payload);
    return response.data.id;
}

async function main() {
    if (!process.env.HUBSPOT_API_KEY) {
        console.error('❌ CRITICAL ERROR: HUBSPOT_API_KEY not found in .env file.');
        return;
    }

    if (CONFIG.DRY_RUN) {
        console.log('\n================================================');
        console.log('              - - - DRY RUN - - -');
        console.log('   No records will be created in HubSpot.');
        console.log('================================================\n');
    }

    // 1. Bulk-fetch products, deals, and existing line items in parallel.
    const [hsProductMap, hsDealMap, hsLineItemMap] = await Promise.all([
        fetchAllHubSpotRecords('products',   CONFIG.productIdentifierProperty),
        fetchAllHubSpotRecords('deals',      CONFIG.dealIdentifierProperty),
        fetchAllHubSpotRecords('line_items', 'salesforce_line_item_id'),
    ]);

    // 2. Read the CSV.
    console.log(`\n🔄 Reading ${CONFIG.lineItemsCsv}...`);
    const rows = await readCsv(CONFIG.lineItemsCsv);
    if (rows.length === 0) {
        console.log('   - No rows found. Exiting.');
        return;
    }
    console.log(`   - ${rows.length} rows loaded.`);

    // 3. Cross-reference each row to a product and deal.
    const toCreate = [];
    const missingProductIds = new Set();
    let skippedNoDeal = 0;

    for (const row of rows) {
        const sfProductId     = row.Product2Id;
        const sfOpportunityId = row.OpportunityId;

        const hsProductId = hsProductMap.get(sfProductId);
        const hsDealId    = hsDealMap.get(sfOpportunityId);

        if(row.TotalPrice && row.TotalPrice.includes('-')) {
            row.TotalPrice = '0';
        }
        if(row.UnitPrice && row.UnitPrice.includes('-')) {
            row.UnitPrice = '0';
        }
        
        if (!hsProductId) { missingProductIds.add(sfProductId); continue; }
        if (!hsDealId) { 
            skippedNoDeal++;
            console.log("Skipped deal Salesforce ID: ", sfOpportunityId)
            continue;
        }

        toCreate.push({ hsProductId, hsDealId, row });
    }

    console.log(`\n   - ✅ ${toCreate.length} rows matched to a product and deal.`);
    if (missingProductIds.size > 0) {
        console.log(`   - ⚠️  ${missingProductIds.size} rows had no matching HubSpot product (${CONFIG.productIdentifierProperty}):`);
        missingProductIds.forEach(id => console.log(`      - ${id}`));
    }
    if (skippedNoDeal > 0) {
        console.log(`   - ⚠️  ${skippedNoDeal} rows had no matching HubSpot deal (${CONFIG.dealIdentifierProperty}).`);
        skippedNoDeal
    }

    if (toCreate.length === 0) {
        console.log('\n   - Nothing to create. Exiting.');
        return;
    }

    if (CONFIG.DRY_RUN) {
        console.log('\n   [DRY RUN] First 5 line items that would be created:');
        toCreate.slice(0, 5).forEach(({ hsProductId, hsDealId, row }) =>
            console.log(`   - Deal ${hsDealId} (SF Opp: ${row.OpportunityId}) + Product ${hsProductId} (SF Product2Id: ${row.Product2Id}) | Qty: ${row.Quantity} | Unit: ${row['UnitPrice']} | Total: ${row['TotalPrice']} | Stream: ${row['Stream__c']} | Salesforce Line Item ID: ${row['Id']}`)
        );
        console.log('\n   Set DRY_RUN: false to create all line items.');
        return;
    }

    // 4. Create line items.
    const batch = CONFIG.rowLimit ? toCreate.slice(0, CONFIG.rowLimit) : toCreate;
    console.log(`\n🔄 Creating ${batch.length} line items in HubSpot${CONFIG.rowLimit ? ` (limited to first ${CONFIG.rowLimit})` : ''}...`);
    let createdCount = 0;
    let updatedCount = 0;
    const failedRows = [];

    for (const { hsProductId, hsDealId, row } of batch) {
        const existingLineItemId = hsLineItemMap.get(row['Id']);
        try {
            if (existingLineItemId) {
                await updateLineItem(existingLineItemId, hsProductId, row);
                console.log(`   - ✅ Updating existing line item ${existingLineItemId} on deal ${hsDealId}`);
                updatedCount++;
                continue;
            } else {
                const newId = await createLineItem(hsProductId, hsDealId, row);
                console.log(`   - ✅ Created line item ${newId} on deal ${hsDealId}`);
                createdCount++;
            }
        } catch (error) {
            const reason = JSON.stringify(error.response?.data || error.message);
            console.error(`   - ❌ Failed for deal ${hsDealId} / product ${hsProductId}: ${reason}`);
            failedRows.push({ ...row, _error: reason });
        }
        await sleep(CONFIG.apiDelay);
    }

    console.log('\n----------------------------------------');
    console.log('✨ Line Item Creation Complete!');
    console.log(`   - ✅ Successfully created: ${createdCount}`);
    console.log(`   - 🔄 Successfully updated: ${updatedCount}`);
    console.log(`   - Total processed items: ${createdCount + updatedCount}`);
    if (failedRows.length > 0) {
        console.log(`   - ❌ Failed: ${failedRows.length}`);
        const headers = Object.keys(failedRows[0]).join(',');
        const csvLines = failedRows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
        const failPath = CONFIG.lineItemsCsv.replace(/(\.[^.]+)?$/, '_failed$1');
        fs.writeFileSync(failPath, [headers, ...csvLines].join('\n'));
        console.log(`   - 📄 Failed rows written to: ${failPath}`);
        console.log('      Re-point lineItemsCsv to that file and rerun to retry.');
    }
    console.log('----------------------------------------');
}

main().catch(console.error);
