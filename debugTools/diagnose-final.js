const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION (Ensure these paths are correct)
// ==================================================================
const CSV_FILE_PATH = '../CSV/Attachment.csv';
const FILES_DIRECTORY_PATH = '../Attachments/';
// ==================================================================

/**
 * A helper function to convert a string into an array of its character codes.
 */
function stringToCharCodes(str) {
  if (typeof str !== 'string') {
    return ['Not a valid string'];
  }
  const codes = [];
  for (let i = 0; i < str.length; i++) {
    codes.push(str.charCodeAt(i));
  }
  return codes;
}

async function finalDive() {
  console.log('🚀 Starting final deep-dive diagnostic...');

  // --- 1. Load the ENTIRE CSV into a map ---
  const fileMetadata = new Map();
  let firstCsvId = null;
  try {
    await new Promise((resolve, reject) => {
      fs.createReadStream(CSV_FILE_PATH)
        .pipe(csv())
        .on('data', (row) => {
          if (row.Id) {
            const cleanCsvId = row.Id.trim();
            if (!firstCsvId) {
                firstCsvId = cleanCsvId;
            }
            fileMetadata.set(cleanCsvId, { name: row.Name });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });
    console.log(`✅ CSV loaded successfully. Found ${fileMetadata.size} records.`);
  } catch (error) {
    console.error('❌ Could not read the CSV file.', error);
    return;
  }

  // --- 2. Find the FIRST UNPROCESSED filename from the directory ---
  let fileToAnalyze = null;
  try {
    const filesInDir = await fs.promises.readdir(FILES_DIRECTORY_PATH);
    console.log(`✅ Directory read successfully. Found ${filesInDir.length} files.`);
    for (const filename of filesInDir) {
      if (!filename.includes(' -- ')) {
        fileToAnalyze = filename;
        break; // Found one, stop looking
      }
    }
  } catch (error) {
    console.error('❌ Could not read the files directory.', error);
    return;
  }

  if (!fileToAnalyze) {
    console.error('❌ Could not find any unprocessed files in the directory to analyze.');
    return;
  }
  
  // --- 3. Perform and print the detailed comparison ---
  console.log('\n----------------------------------------------------');
  console.log('--- DEEP ANALYSIS ---');
  console.log('----------------------------------------------------');

  const cleanFileId = fileToAnalyze.trim();
  const idFromCsvToCompare = fileMetadata.has(cleanFileId) 
    ? cleanFileId 
    : firstCsvId; // Fallback to the first CSV ID if no match is found

  console.log(`\n[1] Analyzing an ID from the Directory (filename):`);
  console.log(`Raw Filename: "${fileToAnalyze}"`);
  console.log(`Filename Length: ${fileToAnalyze.length}`);
  console.log('Filename Character Codes:', stringToCharCodes(fileToAnalyze));

  console.log(`\n[2] Analyzing a known-good ID from the CSV:`);
  console.log(`CSV ID String: "${idFromCsvToCompare}"`);
  console.log(`CSV ID Length: ${idFromCsvToCompare.length}`);
  console.log('CSV ID Character Codes:', stringToCharCodes(idFromCsvToCompare));

  console.log('\n----------------------------------------------------');
  console.log('--- CONCLUSION ---');
  console.log('----------------------------------------------------');
  
  const matchFound = fileMetadata.has(cleanFileId);
  console.log(`\nDid the cleaned filename ID find a match in the CSV map? ${matchFound ? '✅ YES' : '❌ NO'}`);
  console.log('----------------------------------------------------');
  console.log('✅ Diagnostic complete.');
  console.log('Please compare the "Character Codes" for the two strings above.');
  console.log('If they are supposed to be the same ID, the character codes MUST be identical.');

}

finalDive();
