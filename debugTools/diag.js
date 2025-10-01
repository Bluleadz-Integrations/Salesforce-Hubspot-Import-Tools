const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION (Ensure these paths are correct)
// ==================================================================
const CSV_FILE_PATH = '../CSV/Attachment.csv';
const FILES_DIRECTORY_PATH = '../Attachments';
// ==================================================================

/**
 * A helper function to convert a string into an array of its character codes.
 * This makes invisible characters visible.
 * @param {string} str The string to analyze.
 * @returns {number[]} An array of character codes.
 */
function stringToCharCodes(str) {
  const codes = [];
  for (let i = 0; i < str.length; i++) {
    codes.push(str.charCodeAt(i));
  }
  return codes;
}

async function deepDive() {
  console.log('🚀 Starting deep-dive diagnostic...');

  // --- 1. Load the first ID from the CSV ---
  let firstIdFromCsv = null;
  try {
    await new Promise((resolve, reject) => {
      fs.createReadStream(CSV_FILE_PATH)
        .pipe(csv())
        .on('data', (row) => {
          if (!firstIdFromCsv && row.Id) {
            firstIdFromCsv = row.Id;
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });
  } catch (error) {
    console.error('❌ Could not read the CSV file.', error);
    return;
  }

  if (!firstIdFromCsv) {
    console.error('❌ Could not find any "Id" in the first rows of the CSV.');
    return;
  }

  // --- 2. Load the first filename from the directory ---
  let firstFileFromDir = null;
  try {
    const filesInDir = await fs.promises.readdir(FILES_DIRECTORY_PATH);
    if (filesInDir.length > 0) {
      firstFileFromDir = filesInDir[0];
    }
  } catch (error) {
    console.error('❌ Could not read the files directory.', error);
    return;
  }

  if (!firstFileFromDir) {
    console.error('❌ The files directory appears to be empty.');
    return;
  }
  
  // --- 3. Perform and print the detailed comparison ---
  console.log('\n----------------------------------------------------');
  console.log('--- DEEP ANALYSIS ---');
  console.log('----------------------------------------------------');

  console.log('\n[1] Analyzing the ID from the CSV file:');
  console.log(`Raw String: "${firstIdFromCsv}"`);
  console.log(`String Length: ${firstIdFromCsv.length}`);
  console.log('Character Codes:', stringToCharCodes(firstIdFromCsv));

  console.log('\n[2] Analyzing the Filename from the Directory:');
  console.log(`Raw String: "${firstFileFromDir}"`);
  console.log(`String Length: ${firstFileFromDir.length}`);
  console.log('Character Codes:', stringToCharCodes(firstFileFromDir));

  console.log('\n----------------------------------------------------');
  console.log('--- CONCLUSION ---');
  console.log('----------------------------------------------------');
  
  const areEqual = firstIdFromCsv === firstFileFromDir;
  console.log(`\nAre the raw strings identical? ${areEqual ? '✅ Yes' : '❌ NO'}`);
  
  if (!areEqual) {
      console.log('Compare the "Character Codes" arrays above to find the difference.');
      console.log('Common codes: [10 = Newline], [13 = Carriage Return], [32 = Space]');
  }

  const trimmedFileFromDir = firstFileFromDir.trim();
  const areTrimmedEqual = firstIdFromCsv === trimmedFileFromDir;
  console.log(`\nAre they equal after trimming the filename? ${areTrimmedEqual ? '✅ Yes' : '❌ NO'}`);
  console.log('----------------------------------------------------');
  console.log('✅ Diagnostic complete.');
}

deepDive();
