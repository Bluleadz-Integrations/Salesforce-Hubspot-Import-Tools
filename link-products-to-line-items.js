require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    // Set to false to perform the actual updates.
    // START WITH true to verify the matches look correct first.
    DRY_RUN: true,

    // Path to your Salesforce OpportunityLineItem.csv export
    lineItemsCsv: './salesforce-exports/OpportunityLineItem.csv',

    // The HubSpot property on LINE ITEMS that holds the Salesforce line item ID.
    // This is used to look up the right HubSpot line item for each SF record.
    lineItemIdentifierProperty: 'migrated_id',

    // The HubSpot property on PRODUCTS that holds the Salesforce Product2 ID.
    // This is used to find the right HubSpot product to link to each line item.
    productIdentifierProperty: 'migrated_id',

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
                    console.warn(`   - ⚠️  File not found: ${filePath}.`);
                    resolve([]);
                } else {
                    reject(err);
                }
            });
    });
}

// Fetches all records of a given object type from HubSpot using cursor-based pagination.
// Returns a Map of { identifierPropertyValue -> hubspotRecordId }
async function fetchAllHubSpotRecords(objectType, identifierProperty) {
    console.log(`📖 Fetching all HubSpot ${objectType} (property: ${identifierProperty})...`);
    const resultMap = new Map();
    let after = undefined;

    do {
        const body = {
            limit: 100,
            properties: [identifierProperty],
            ...(after ? { after } : {})
        };

        const response = await hubspotApi.post(`/crm/v3/objects/${objectType}/search`, body);
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

async function main() {
    if (!process.env.HUBSPOT_API_KEY) {
        console.error('❌ CRITICAL ERROR: HUBSPOT_API_KEY not found in .env file.');
        return;
    }

    if (CONFIG.DRY_RUN) {
        console.log('\n================================================');
        console.log('              - - - DRY RUN - - -');
        console.log('   No records will be updated in HubSpot.');
        console.log('================================================\n');
    }

    // 1. Fetch all HubSpot products and line items in bulk.
    //    Both maps are: { sfSalesforceId -> hubspotRecordId }
    const [hsProductMap, hsLineItemMap] = await Promise.all([
        fetchAllHubSpotRecords('products', CONFIG.productIdentifierProperty),
        fetchAllHubSpotRecords('line_items', CONFIG.lineItemIdentifierProperty),
    ]);

    // 2. Read OpportunityLineItem.csv to build the SF-side mapping:
    //    sfLineItemId -> sfProduct2Id
    console.log(`\n🔄 Processing ${CONFIG.lineItemsCsv}...`);
    const sfLineItems = await readCsv(CONFIG.lineItemsCsv);

    const sfLineItemToProduct = new Map();
    for (const item of sfLineItems) {
        if (item.IsDeleted !== '1' && item.Id && item.Product2Id) {
            sfLineItemToProduct.set(item.Id, item.Product2Id);
        }
    }
    console.log(`   - Found ${sfLineItemToProduct.size} active line items with a Product2Id.`);

    // 3. Cross-reference to build update pairs.
    let matched = 0, skippedNoLineItem = 0, skippedNoProduct = 0;
    const updates = [];

    for (const [sfLineItemId, sfProduct2Id] of sfLineItemToProduct) {
        const hsLineItemId = hsLineItemMap.get(sfLineItemId);
        const hsProductId = hsProductMap.get(sfProduct2Id);

        if (!hsLineItemId) { skippedNoLineItem++; continue; }
        if (!hsProductId)  { skippedNoProduct++;  continue; }

        updates.push({ hsLineItemId, hsProductId, sfLineItemId, sfProduct2Id });
        matched++;
    }

    console.log(`\n   - ✅ ${matched} line items matched to a product.`);
    if (skippedNoLineItem > 0) console.log(`   - ⚠️  ${skippedNoLineItem} SF line items had no matching HubSpot line item (check ${CONFIG.lineItemIdentifierProperty}).`);
    if (skippedNoProduct > 0)  console.log(`   - ⚠️  ${skippedNoProduct} SF line items had no matching HubSpot product (check ${CONFIG.productIdentifierProperty}).`);

    if (updates.length === 0) {
        console.log('\n   - Nothing to update. Exiting.');
        return;
    }

    if (CONFIG.DRY_RUN) {
        console.log('\n   [DRY RUN] First 5 updates that would be applied:');
        updates.slice(0, 5).forEach(u =>
            console.log(`   - Line item ${u.hsLineItemId} (SF: ${u.sfLineItemId}) → product ${u.hsProductId} (SF: ${u.sfProduct2Id})`)
        );
        console.log('\n   Set DRY_RUN: false to apply all updates.');
        return;
    }

    // 4. Apply updates.
    console.log(`\n🔄 Updating ${updates.length} line items in HubSpot...`);
    let successCount = 0, failCount = 0;

    for (const { hsLineItemId, hsProductId } of updates) {
        try {
            await hubspotApi.patch(`/crm/v3/objects/line_items/${hsLineItemId}`, {
                properties: { hs_product_id: hsProductId }
            });
            successCount++;
        } catch (error) {
            console.error(`   - ❌ Failed to update line item ${hsLineItemId}:`, error.response?.data || error.message);
            failCount++;
        }
        await sleep(CONFIG.apiDelay);
    }

    console.log('\n----------------------------------------');
    console.log('✨ Product Linking Complete!');
    console.log(`   - ✅ Successfully updated: ${successCount}`);
    if (failCount > 0) console.log(`   - ❌ Failed: ${failCount}`);
    console.log('----------------------------------------');
}

main().catch(console.error);
