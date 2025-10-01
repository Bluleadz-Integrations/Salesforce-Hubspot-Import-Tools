const fs = require('fs');
const path = require('path');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const FILES_DIRECTORY_PATH = '../Attachments';

// 👉 Paste the new ID here
const SPECIFIC_FILE_ID = '00P4R00001KJneZUAT'; // <-- PASTE THE NEW ID HERE
// ==================================================================

// ... (rest of the script is the same)

function testFileSystem() {
  console.log('--- Ground Truth Diagnostic ---');
  const cwd = process.cwd();
  console.log(`\n[1] Current Working Directory:`);
  console.log(cwd);
  const absoluteFilesPath = path.resolve(FILES_DIRECTORY_PATH);
  console.log(`\n[2] Resolved path to files: absolute`);
  console.log(absoluteFilesPath);
  const dirExists = fs.existsSync(absoluteFilesPath);
  console.log(`\n[3] Does this directory exist?`);
  console.log(dirExists ? '✅ Yes' : '❌ NO');
  if (!dirExists) {
    console.log('\nCONCLUSION: The path to your files folder is incorrect.');
    return;
  }
  const specificFilePath = path.join(absoluteFilesPath, SPECIFIC_FILE_ID);
  console.log(`\n[4] Checking for this specific file:`);
  console.log(specificFilePath);
  const specificFileExists = fs.existsSync(specificFilePath);
  console.log(`\n[5] Does this specific file exist?`);
  console.log(specificFileExists ? '✅ Yes' : '❌ NO');
  console.log('\n--- End of Report ---');
}
testFileSystem();
