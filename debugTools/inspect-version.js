// inspect-versions.js
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const CONTENT_VERSION_CSV = '../CSV/ContentVersion.csv';

async function inspectVersions() {
    console.log(`🚀 Inspecting the first 5 SNOTE records from ${CONTENT_VERSION_CSV}...`);
    let snotesFound = 0;

    await new Promise((resolve, reject) => {
        fs.createReadStream(CONTENT_VERSION_CSV)
            .pipe(csv())
            .on('data', (row) => {
                // Find rows where the FileType is SNOTE
                if (row.FileType === 'SNOTE' && snotesFound < 5) {
                    console.log(`\n--- Found SNOTE #${snotesFound + 1} ---`);
                    console.log(`  Id:           ${row.Id}`);
                    console.log(`  IsLatest:     ${row.IsLatest}`);
                    console.log(`  Title:        ${row.Title}`);
                    console.log(`  PathOnClient: ${row.PathOnClient}`);
                    console.log(`  FileType:     ${row.FileType}`);
                    snotesFound++;
                }
            })
            .on('end', () => {
                if (snotesFound === 0) {
                    console.log('\n❌ No records with FileType "SNOTE" were found in the CSV.');
                }
                resolve();
            })
            .on('error', reject);
    });
}

inspectVersions();
