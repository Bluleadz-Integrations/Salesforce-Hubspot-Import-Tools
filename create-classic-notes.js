const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    // Path to the folder containing your mapper CSVs
    mappersDir: './maps/',
    // Path to your classic Notes.csv export
    notesCsv: '../CSV/Note.csv',
    // Where to save the new HubSpot import files
    outputDir: './'
};
// ==================================================================

// Helper function to correctly format a field for a CSV file
function formatCsvField(field) {
    const str = String(field ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        const escapedStr = str.replace(/"/g, '""');
        return `"${escapedStr}"`;
    }
    return str;
}

// Helper to read a CSV and return its data as an array of objects
async function readCsv(filePath) {
    const results = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

// Reusable function to load all your mappers
async function loadMappers() {
    console.log('📖 Loading ID mapper files...');
    const sfToHsIdMap = {
        '001': new Map(), '003': new Map(), '00Q': new Map(),
        '006': new Map(), '500': new Map()
    };
    
    const mappersToLoad = [
        { name: 'company-mapper.csv', prefix: '001', sfIdColumns: ['SF ID'] },
        { name: 'contact-mapper.csv', prefix: '003', sfIdColumns: ['SF ID', 'SF Contact ID'] },
        { name: 'contact-mapper.csv', prefix: '00Q', sfIdColumns: ['SF Lead ID'] },
        { name: 'deal-mapper.csv', prefix: '006', sfIdColumns: ['sf_id', 'SF ID'] },
    ];

    for (const mapper of mappersToLoad) {
        try {
            const mapperPath = path.join(CONFIG.mappersDir, mapper.name);
            const data = await readCsv(mapperPath);
            let count = 0;
            for (const row of data) {
                const hsId = row['Record ID'];
                let sfId = null;
                for (const col of mapper.sfIdColumns) {
                    if (row[col]) {
                        sfId = row[col];
                        break;
                    }
                }
                if (hsId && sfId) {
                    sfToHsIdMap[mapper.prefix].set(sfId, hsId);
                    count++;
                }
            }
            console.log(`   - Loaded ${count} mappings from ${mapper.name} for prefix ${mapper.prefix}.`);
        } catch (error) {
            console.warn(`   - ⚠️  Could not load or process ${mapper.name}. Skipping.`);
        }
    }
    return sfToHsIdMap;
}


async function main() {
    const sfToHsIdMap = await loadMappers();

    // ✅ FIX: Added 'Title' and 'Body' to the header definition
    const header = ['Record ID', 'Note Body', 'Timestamp', 'Title', 'Body'];
    const outputData = {
        contacts: [header.join(',')],
        companies: [header.join(',')],
        deals: [header.join(',')],
        other: [header.join(',')]
    };
    
    const prefixMap = {
        '001': 'companies',
        '003': 'contacts',
        '00Q': 'contacts',
        '006': 'deals'
    };

    console.log(`\n🔄 Processing classic notes from ${CONFIG.notesCsv}...`);
    const notes = await readCsv(CONFIG.notesCsv);

    for (const note of notes) {
        if (!note.ParentId || note.IsDeleted === '1') {
            continue;
        }
        
        const parentId = note.ParentId;
        const prefix = parentId.substring(0, 3);
        const objectType = prefixMap[prefix] || 'other';
        const hubspotId = sfToHsIdMap[prefix]?.get(parentId);

        if (hubspotId) {
            // Combine Title and Body for the main "Note Body" field
            const noteTitleText = note.Title ? `Title: ${note.Title}\n\n` : '';
            const mergedBody = `${noteTitleText}${note.Body || ''}`;
            
            const newRow = [
                formatCsvField(hubspotId),
                formatCsvField(mergedBody),
                formatCsvField(note.CreatedDate),
                formatCsvField(note.Title), // Separate Title
                formatCsvField(note.Body)     // Separate Body
            ].join(',');
            
            outputData[objectType].push(newRow);
        }
    }
    
    console.log('\n----------------------------------------');
    console.log('✨ Classic Notes Processing Complete!');

    for (const [objectType, data] of Object.entries(outputData)) {
        if (data.length > 1) {
            const outputPath = path.join(CONFIG.outputDir, `hubspot_import_classic_notes_${objectType}.csv`);
            await fs.promises.writeFile(outputPath, data.join('\n'));
            console.log(`   - ✅ Wrote ${data.length - 1} classic notes to ${outputPath}`);
        }
    }
    console.log('----------------------------------------');
}

main().catch(console.error);
