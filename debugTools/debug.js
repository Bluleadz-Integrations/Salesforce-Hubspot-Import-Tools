const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION (Ensure these paths are correct)
// ==================================================================
const CSV_FILE_PATH = '../CSV/Attachment.csv';
// ==================================================================

async function diagnoseCsv() {
  console.log('🚀 Starting CSV diagnostic tool...');
  console.log('Reading the first two rows from:', CSV_FILE_PATH);
  console.log('----------------------------------------------------');

  let rowCount = 0;

  try {
    await new Promise((resolve, reject) => {
      fs.createReadStream(CSV_FILE_PATH)
        .pipe(csv())
        .on('data', (row) => {
          // We only want to inspect the first couple of rows
          if (rowCount < 2) {
            console.log(`\n--- Inspecting Row #${rowCount + 1} ---`);

            // 1. Log the entire raw row object to see all headers
            console.log('Raw row object:', row);

            // 2. Check the 'Id' column specifically
            const idFromCsv = row.Id || row['\ufeffId']; // Check for BOM character

            if (idFromCsv) {
              // 3. Log the ID and its length
              console.log(`ID found: '${idFromCsv}'`);
              console.log(`Length of ID: ${idFromCsv.length}`);

              // 4. Log the ID with JSON.stringify to make whitespace visible
              console.log('ID with whitespace: visible', JSON.stringify(idFromCsv));
            } else {
              console.log("Could not find 'Id' column in this row.");
            }
          }
          rowCount++;
        })
        .on('end', () => {
          if (rowCount === 0) {
            console.log('\n❌ No data rows were processed. The file might be empty or formatted incorrectly.');
          } else {
            console.log('\n----------------------------------------------------');
            console.log('✅ Diagnostic complete.');
          }
          resolve();
        })
        .on('error', reject);
    });
  } catch (error) {
    console.error('❌ An error occurred while reading the CSV:', error);
  }
}

diagnoseCsv();
