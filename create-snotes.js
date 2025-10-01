const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONTENT_VERSION_CSV = '../CSV/ContentVersion.csv';
const CONTENT_DOC_LINK_CSV = '../CSV/ContentDocumentLink.csv';
const FILES_FOLDER_PATH = '../ContentVersion';

const OUTPUT_FILENAME_PREFIX = 'HubSpot_Notes_Import';
// ==================================================================


/**
 * Main function to generate the HubSpot notes import files.
 */
async function generateNotesImport() {
    console.log('🚀 Starting HubSpot notes generation process...');

    const sfIdPrefixMap = {
        '003': 'Contacts',
        '001': 'Companies',
        '006': 'Deals',
        '00Q': 'Contacts'
    };

    // --- Step 1: Load the ContentDocumentLink data into a lookup map ---
    const docIdToEntityIdMap = new Map();
    try {
        await new Promise((resolve, reject) => {
            fs.createReadStream(CONTENT_DOC_LINK_CSV)
                .pipe(csv())
                .on('data', (row) => {
                    if (row.ContentDocumentId && row.LinkedEntityId && !docIdToEntityIdMap.has(row.ContentDocumentId)) {
                        docIdToEntityIdMap.set(row.ContentDocumentId, row.LinkedEntityId);
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });
        console.log(`✅ Link data loaded. Found links for ${docIdToEntityIdMap.size} unique documents.`);
    } catch (error) {
        console.error(`❌ Error reading or parsing ${CONTENT_DOC_LINK_CSV}.`, error);
        return;
    }

    // --- Step 2: Process the ContentVersion CSV and sort notes by type ---
    const header = 'Association ID,Note Body,Timestamp';
    const outputData = {
        Contacts: [header],
        Companies: [header],
        Deals: [header],
        Other: [header]
    };
    let snotesFound = 0;

    try {
        await new Promise((resolve, reject) => {
            fs.createReadStream(CONTENT_VERSION_CSV)
                .pipe(csv())
                .on('data', (row) => {
                    // ✅ FIX: The condition now correctly checks for IsLatest === '1' and FileType === 'SNOTE'.
                    if (row.IsLatest === '1' && row.FileType === 'SNOTE') {
                        snotesFound++;
                        const docId = row.ContentDocumentId;
                        const associationId = docIdToEntityIdMap.get(docId);
                        
                        if (associationId) {
                            const snoteFilePath = path.join(FILES_FOLDER_PATH, row.Id);
                            try {
                                const noteBody = fs.readFileSync(snoteFilePath, 'utf8');
                                const escapedNoteBody = `"${noteBody.replace(/"/g, '""')}"`;
                                const timestamp = row.CreatedDate;
                                const csvRow = `${associationId},${escapedNoteBody},${timestamp}`;
                                
                                const prefix = associationId.substring(0, 3);
                                const objectType = sfIdPrefixMap[prefix] || 'Other';
                                outputData[objectType].push(csvRow);

                            } catch (fileError) {
                                console.warn(`   ⚠️ Could not read .snote file for ID [${row.Id}]. Skipping.`);
                            }
                        }
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });
    } catch (error) {
        console.error(`❌ Error reading or parsing ${CONTENT_VERSION_CSV}.`, error);
        return;
    }

    // --- Step 3: Write the final CSV files ---
    console.log('\n----------------------------------------');
    console.log('✨ Process Complete!');
    console.log(`   Found ${snotesFound} total snotes.`);
    
    let totalRowsCreated = 0;
    for (const [objectType, rows] of Object.entries(outputData)) {
        if (rows.length > 1) {
            const rowCount = rows.length - 1;
            totalRowsCreated += rowCount;
            const filename = `${OUTPUT_FILENAME_PREFIX}_${objectType}.csv`;
            const csvContent = rows.join('\n');
            try {
                await fs.promises.writeFile(filename, csvContent);
                console.log(`📝 Created ${rowCount} rows in ${filename}`);
            } catch (writeError) {
                console.error(`❌ Error writing the file for ${objectType}.`, writeError);
            }
        }
    }
    
    console.log(`   Total notes exported: ${totalRowsCreated}`);
    console.log('----------------------------------------');
}

generateNotesImport();
