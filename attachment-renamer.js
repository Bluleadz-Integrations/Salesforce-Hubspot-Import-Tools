const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mime = require('mime-types');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CSV_FILE_PATH = '../CSV/Attachment.csv';
const FILES_DIRECTORY_PATH = '../Attachments';
// ==================================================================


const sanitizeFilename = (filename) => {
  return filename.replace(/[<>:"/\\|?*]/g, '_');
};

async function processAndRenameFiles() {
  // ✅ FIX: The new library is imported here, inside the async function.
  const { fileTypeFromFile } = await import('file-type');

  console.log('🚀 Starting file renaming process...');

  const fileMetadata = new Map();
  try {
    await new Promise((resolve, reject) => {
      fs.createReadStream(CSV_FILE_PATH)
        .pipe(csv())
        .on('data', (row) => {
          if (row.Id && row.Name) {
            fileMetadata.set(row.Id.trim(), {
              name: row.Name,
              contentType: row.ContentType,
            });
          }
        })
        .on('end', () => {
          console.log(`✅ Successfully loaded metadata for ${fileMetadata.size} records from the CSV.`);
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
      skippedCount++;
      continue;
    }

    const { name: sfName, contentType } = fileMetadata.get(cleanFileId);
    const originalFilePath = path.join(FILES_DIRECTORY_PATH, originalFilename);
    
    let extension = path.extname(sfName).substring(1);
    if (!extension && contentType) {
      extension = mime.extension(contentType);
    }
    
    // ✅ NEW: Inspect the file content if the extension is still unknown
    if (!extension) {
        console.log(`   ...No extension info for [${cleanFileId}], inspecting file content...`);
        try {
            const type = await fileTypeFromFile(originalFilePath);
            if (type) {
                console.log(`   ...File content identified as '${type.mime}'. Using extension '.${type.ext}'.`);
                extension = type.ext;
            }
        } catch (error) {
            console.error(`   ...Error while inspecting file [${cleanFileId}].`, error);
        }
    }
    
    if (!extension) {
      console.warn(`⚠️ Skipping [${cleanFileId}]: Could not determine extension from any source.`);
      skippedCount++;
      continue;
    }
    
    const nameWithoutExt = path.parse(sfName).name;
    const sanitizedName = sanitizeFilename(nameWithoutExt);
    const newFileName = `${cleanFileId} -- ${sanitizedName}.${extension}`;
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
