const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    // Look in the sibling Generated folder for the 26 CSVs you created
    generatedFilesDir: '../Generated/',
    
    // Original Campaign file to look up the missing Sender information
    campaignsCsv: '../CSV/wbsendit__Campaign_Monitor_Campaign__c.csv',
    
    // Any rows that fail to upload will be saved here so you can review them
    failedOutputPath: './failed_api_emails.csv',
    
    // 🚨 PASTE YOUR HUBSPOT PRIVATE APP TOKEN HERE 🚨
    hubspotToken: '' 
};
// ==================================================================

// Helper: Sleep function for rate limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Case-insensitive, multi-name column search
function getVal(row, possibleKeys) {
    const rowKeys = Object.keys(row);
    for (const key of possibleKeys) {
        const match = rowKeys.find(k => k.toLowerCase().trim() === key.toLowerCase());
        if (match && row[match]) return row[match];
    }
    return null;
}

// Helper: Load Sender info dynamically from the original Salesforce file
async function loadSenders() {
    console.log('📢 Scanning original Campaigns file for Sender info...');
    const senderMap = new Map();
    
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(CONFIG.campaignsCsv)) {
            console.warn(`   ⚠️ Could not find Campaigns file at ${CONFIG.campaignsCsv}. Senders will be blank.`);
            return resolve(senderMap);
        }
        
        fs.createReadStream(CONFIG.campaignsCsv)
            .pipe(csv())
            .on('data', (row) => {
                const name = getVal(row, ['Name', 'NAME']) || 'Unnamed Campaign';
                const subject = getVal(row, ['wbsendit__Subject__c', 'Subject__c']) || name;
                const fromEmail = getVal(row, ['wbsendit__From_Email__c', 'From_Email__c']);
                const fromName = getVal(row, ['wbsendit__From_Name__c', 'From_Name__c']);
                
                // Map the Subject to the Sender Info
                if (fromEmail) {
                    senderMap.set(subject.toLowerCase().trim(), { email: fromEmail, name: fromName });
                }
            })
            .on('end', () => {
                console.log(`   ✅ Linked sender details for ${senderMap.size} unique campaign subjects.`);
                resolve(senderMap);
            })
            .on('error', reject);
    });
}

// Helper: Push a single row to HubSpot's Engagements API
async function pushToHubSpot(row, senderMap) {
    // We use the v1 Engagements API because it is incredibly stable for raw HTML emails
    const url = 'https://api.hubapi.com/engagements/v1/engagements';
    
    // HubSpot requires timestamp in milliseconds
    const activityDate = row['Activity Date'] || new Date().toISOString();
    const timestamp = new Date(activityDate).getTime();
    const subject = row['Email Subject'] || 'Campaign Monitor Email';
    
    // Look up the sender based on the exact subject line match
    let fromEmail = '';
    let fromName = '';
    const subjectKey = subject.toLowerCase().trim();
    
    if (senderMap.has(subjectKey)) {
        const senderInfo = senderMap.get(subjectKey);
        fromEmail = senderInfo.email;
        fromName = senderInfo.name;
    }
    
    const payload = {
        engagement: {
            active: true,
            type: 'EMAIL',
            timestamp: timestamp
        },
        associations: {
            contactIds: [parseInt(row['Record ID'])] // Must be an array of integers
        },
        metadata: {
            subject: subject,
            html: row['Email Body'] || ''
        }
    };

    // If we successfully found sender info, attach it to the email metadata!
    if (fromEmail) {
        payload.metadata.from = {
            email: fromEmail,
            firstName: fromName || '' // HubSpot will display "FirstName <Email>" in the timeline
        };
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
                // Something else went wrong (e.g., deleted contact ID)
                const errorText = await response.text();
                console.error(`\n❌ Error pushing Contact ${row['Record ID']}: ${response.status} - ${errorText}`);
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
    if (CONFIG.hubspotToken === 'YOUR_HUBSPOT_PRIVATE_APP_TOKEN') {
        console.error('\n🚨 ERROR: Please paste your HubSpot Private App Token in the CONFIG at the top of the script!\n');
        return;
    }

    // Find all the files ending in .csv that you just generated
    const files = fs.readdirSync(CONFIG.generatedFilesDir)
        .filter(f => f.endsWith('.csv') && f.includes('Campaign_Monitor'));
    
    if (files.length === 0) {
        console.log(`\n⚠️ No Campaign Monitor CSV files found in ${CONFIG.generatedFilesDir}\n`);
        return;
    }

    // Pre-load the sender information before we start processing the big files
    const senderMap = await loadSenders();

    console.log(`\n🚀 Found ${files.length} chunked CSV files. Starting API push...`);
    console.log('⏳ This will run at ~10 requests per second to stay within HubSpot limits.\n');

    const failedRows = [];
    let successCount = 0;
    let failCount = 0;

    for (const file of files) {
        console.log(`\n📄 Processing file: ${file}...`);
        const filePath = path.join(CONFIG.generatedFilesDir, file);

        // We use 'for await' to stream the CSV row by row, keeping memory usage near zero!
        for await (const row of fs.createReadStream(filePath).pipe(csv())) {
            const success = await pushToHubSpot(row, senderMap);
            
            if (success) {
                successCount++;
                // Print an updating tally on the same line in the terminal
                process.stdout.write(`\r✅ Successfully pushed: ${successCount} | ❌ Failed: ${failCount}`);
            } else {
                failCount++;
                failedRows.push(row);
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

    // If any records failed (usually due to bad/orphaned Contact IDs), save them to a file
    if (failedRows.length > 0) {
        const header = Object.keys(failedRows[0]).join(',') + '\n';
        const rows = failedRows.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        fs.writeFileSync(CONFIG.failedOutputPath, header + rows);
        console.log(`📝 Failed rows saved to: ${CONFIG.failedOutputPath}`);
    }
    console.log('----------------------------------------\n');
}

main().catch(console.error);
