const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    // Look in the sibling Generated folder for the Enhanced Email CSVs
    generatedFilesDir: './Generated/',
    
    // Any rows that fail to upload will be saved here so you can review them
    failedOutputPath: './failed_enhanced_api_emails.csv',
    
    // Your HubSpot Private App Token
    hubspotToken: '' 
};
// ==================================================================

// Helper: Sleep function for rate limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Push a single row to HubSpot's Engagements API
async function pushToHubSpot(row, objectType) {
    // We use the v1 Engagements API because it is incredibly stable for raw HTML emails
    const url = 'https://api.hubapi.com/engagements/v1/engagements';
    
    // HubSpot requires timestamp in milliseconds
    const activityDate = row['Activity Date'] || new Date().toISOString();
    const timestamp = new Date(activityDate).getTime();
    
    const payload = {
        engagement: {
            active: true,
            type: 'EMAIL',
            timestamp: timestamp
        },
        associations: {},
        metadata: {
            subject: row['Email Subject'] || 'Logged Email',
            html: row['Email Body'] || ''
        }
    };

    // ✅ DYNAMIC ASSOCIATION: Route to the correct HubSpot object based on the file being processed
    const recordId = parseInt(row['Record ID']);
    if (objectType === 'contacts') {
        payload.associations.contactIds = [recordId];
    } else if (objectType === 'companies') {
        payload.associations.companyIds = [recordId];
    } else if (objectType === 'deals') {
        payload.associations.dealIds = [recordId];
    }

    let retries = 3;
    while (retries > 0) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CONFIG.hubspotToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                return true; // Success!
            } else if (response.status === 429) {
                // Rate limit hit - pause and try again
                const retryAfter = response.headers.get('retry-after') || 5;
                await sleep(retryAfter * 1000);
                retries--;
                continue;
            } else {
                // Something else went wrong (e.g., deleted object ID)
                const errorText = await response.text();
                console.error(`\n❌ Error pushing ${objectType} ${row['Record ID']}: ${response.status} - ${errorText}`);
                return false;
            }
        } catch (err) {
            console.error(`\n❌ Network Error: ${err.message}`);
            retries--;
            await sleep(2000); // Wait 2 seconds on a network drop before retrying
        }
    }
    return false; // Failed after 3 retries
}

async function main() {
    // Find all the files ending in .csv that contain "enhanced_emails"
    const files = fs.readdirSync(CONFIG.generatedFilesDir)
        .filter(f => f.endsWith('.csv') && f.includes('enhanced_emails'));
    
    if (files.length === 0) {
        console.log(`\n⚠️ No Enhanced Email CSV files found in ${CONFIG.generatedFilesDir}\n`);
        return;
    }

    console.log(`\n🚀 Found ${files.length} Enhanced Email CSV files. Starting API push...`);
    console.log('⏳ This will run at ~10 requests per second to stay within HubSpot limits.\n');

    const failedRows = [];
    let successCount = 0;
    let failCount = 0;

    for (const file of files) {
        console.log(`\n📄 Processing file: ${file}...`);
        const filePath = path.join(CONFIG.generatedFilesDir, file);
        
        // Determine if this file is for contacts, companies, or deals
        let objectType = 'contacts';
        if (file.includes('_for_companies')) objectType = 'companies';
        if (file.includes('_for_deals')) objectType = 'deals';

        // We use 'for await' to stream the CSV row by row, keeping memory usage near zero!
        for await (const row of fs.createReadStream(filePath).pipe(csv())) {
            const success = await pushToHubSpot(row, objectType);
            
            if (success) {
                successCount++;
                // Print an updating tally on the same line in the terminal
                process.stdout.write(`\r✅ Successfully pushed: ${successCount} | ❌ Failed: ${failCount}`);
            } else {
                failCount++;
                // Save the file name alongside the row so you know where it failed
                failedRows.push({ SourceFile: file, ...row });
                process.stdout.write(`\r✅ Successfully pushed: ${successCount} | ❌ Failed: ${failCount}`);
            }
            
            // Wait 100ms between every request (Guarantees we stay well under 100 requests per 10sec)
            await sleep(100); 
        }
    }

    console.log('\n\n----------------------------------------');
    console.log('✨ API Push Complete!');
    console.log(`✅ Total Successfully Pushed: ${successCount}`);
    console.log(`❌ Total Failed: ${failCount}`);

    // If any records failed (usually due to bad/orphaned IDs), save them to a file
    if (failedRows.length > 0) {
        const header = Object.keys(failedRows[0]).join(',') + '\n';
        const rows = failedRows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        fs.writeFileSync(CONFIG.failedOutputPath, header + rows);
        console.log(`📝 Failed rows saved to: ${CONFIG.failedOutputPath}`);
    }
    console.log('----------------------------------------\n');
}

main().catch(console.error);
