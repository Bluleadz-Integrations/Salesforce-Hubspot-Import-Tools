const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONTENT_VERSION_CSV = './salesforce-exports/ContentVersion.csv';
const FILES_DIRECTORY_PATH = './salesforce-exports/Master-ContentVersion'; // The folder where the ContentVersion files are

// ✅ NEW: A safe character limit for the main body of the filename.
const MAX_FILENAME_BODY_LENGTH = 200;
// ==================================================================


const sanitizeFilename = (filename) => {
  return filename.replace(/[<>:"/\\|?*]/g, '_');
};

async function processAndRenameFiles() {
  console.log('🚀 Starting ContentVersion file renaming process...');

  const fileMetadata = new Map();
  try {
    await new Promise((resolve, reject) => {
      fs.createReadStream(CONTENT_VERSION_CSV)
        .pipe(csv())
        .on('data', (row) => {
          if (row.IsLatest === '1' && row.FileType !== 'SNOTE') {
            fileMetadata.set(row.Id.trim(), {
              title: row.Title,
              pathOnClient: row.PathOnClient,
            });
          }
        })
        .on('end', () => {
          console.log(`✅ Successfully loaded metadata for ${fileMetadata.size} file versions from the CSV.`);
          if (fileMetadata.size === 0) {
            console.error('❌ WARNING: No data was loaded. Exiting.');
            process.exit(1);
          }
          resolve();
        })
        .on('error', reject);
    });
  } catch (error) {
    console.error(`❌ Error reading CSV file.`, error);
    return;
  }

  const filesInDir = await fs.promises.readdir(FILES_DIRECTORY_PATH);
  console.log(`🔍 Found ${filesInDir.length} files in the target directory.`);

  let renamedCount = 0;
  let skippedCount = 0;
  
  for (const originalFilename of filesInDir) {
    if (originalFilename.includes(' -- ')) {
      skippedCount++;
      continue; 
    }

    const cleanFileId = originalFilename.trim();
    
    if (!fileMetadata.has(cleanFileId)) {
      // console.log(`⏭️  No metadata match for: "${cleanFileId}"`);
      skippedCount++;
      continue;
    }
    
    const { title, pathOnClient } = fileMetadata.get(cleanFileId);
    
    let extension = path.extname(pathOnClient).substring(1);
    
    if (!extension) {
      console.warn(`⚠️ Skipping [${cleanFileId}]: Could not determine extension from PathOnClient: "${pathOnClient}"`);
      skippedCount++;
      continue;
    }
    
    const nameWithoutExt = path.parse(title).name;
    let sanitizedName = sanitizeFilename(nameWithoutExt);

    // ✅ FIX: Truncate the sanitized name if it's longer than our defined limit.
    if (sanitizedName.length > MAX_FILENAME_BODY_LENGTH) {
        sanitizedName = sanitizedName.substring(0, MAX_FILENAME_BODY_LENGTH);
    }
    
    const newFileName = `${cleanFileId} -- ${sanitizedName}.${extension}`;
    
    const originalFilePath = path.join(FILES_DIRECTORY_PATH, originalFilename);
    const newFilePath = path.join(FILES_DIRECTORY_PATH, newFileName);

    try {
      await fs.promises.rename(originalFilePath, newFilePath);
      renamedCount++;
    } catch (error) {
      console.error(`❌ Error renaming file '${originalFilename}'.`, error);
      skippedCount++;
    }
  }

  console.log('\n----------------------------------------');
  console.log('✨ Process Complete!');
  console.log(`   Renamed: ${renamedCount} file(s)`);
  console.log(`   Skipped: ${skippedCount} file(s)`);
  console.log('----------------------------------------');
}

processAndRenameFiles();
