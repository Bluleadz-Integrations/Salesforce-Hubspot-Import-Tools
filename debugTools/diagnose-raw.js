const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CSV_FILE_PATH = '../CSV/Attachment.csv';
const ID_TO_FIND = '00P4R00001KJneZUAT';
// ==================================================================

/**
 * A helper function to convert a string into an array of its character codes.
 */
function stringToCharCodes(str) {
  const codes = [];
  for (let i = 0; i < str.length; i++) {
    codes.push(str.charCodeAt(i));
  }
  return codes;
}

async function inspectRow() {
  console.log(`🚀 Searching for ID [${ID_TO_FIND}] in ${CSV_FILE_PATH}...`);

  let foundRow = null;

  await new Promise((resolve, reject) => {
    fs.createReadStream(CSV_FILE_PATH)
      .pipe(csv())
      .on('data', (row) => {
        // We use .includes() here in case the hidden char is in the middle
        if (row.Id && row.Id.includes(ID_TO_FIND)) {
          foundRow = row;
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  if (foundRow) {
    console.log('\n--- ANALYSIS OF CSV DATA ---');
    const idFromCsv = foundRow.Id;
    const cleanId = ID_TO_FIND;

    console.log('\n[1] Corrupted ID from CSV file:');
    console.log(`Raw String: "${idFromCsv}"`);
    console.log(`String Length: ${idFromCsv.length}`);
    console.log('Character Codes:', stringToCharCodes(idFromCsv));

    console.log('\n[2] Clean, Correct ID for comparison:');
    console.log(`Correct String: "${cleanId}"`);
    console.log(`Correct Length: ${cleanId.length}`);
    console.log('Character Codes:', stringToCharCodes(cleanId));
    
    console.log('\n--- CONCLUSION ---');
    console.log('Compare the "Character Codes" arrays. The corrupted ID will have an extra number.');
    console.log('This number is the character that is causing the problem. hidden');

  } else {
    console.log(`\n❌ Could not find a row containing the ID [${ID_TO_FIND}].`);
  }
}

inspectRow();
