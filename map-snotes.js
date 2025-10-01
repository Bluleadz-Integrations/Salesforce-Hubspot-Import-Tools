const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// ==================================================================
// ✅ CONFIGURATION
// ==================================================================
const CONFIG = {
    mappersDir: './maps/',
    notesDir: '../',
    outputDir: './'
};
// ==================================================================

function formatCsvField(field) {
    const str = String(field ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        const escapedStr = str.replace(/"/g, '""');
        return `"${escapedStr}"`;
    }
    return str;
}

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
    const objectTypes = ['Contacts', 'Companies', 'Deals', 'Tickets', 'Other'];
    console.log('\n🔄 Starting to map note files...');

    for (const type of objectTypes) {
        const inputFilePath = path.join(CONFIG.notesDir, `HubSpot_Notes_Import_${type}.csv`);
        const outputFilePath = path.join(CONFIG.outputDir, `HubSpot_Notes_Import_${type}_mapped.csv`);
        
        try {
            await fs.promises.access(inputFilePath);
            
            const noteRows = await readCsv(inputFilePath);
            const newCsvRows = [];

            // ✅ FIX: Changed 'Association ID' to 'Record ID' for HubSpot matching.
            const header = [
                formatCsvField('Record ID'),
                formatCsvField('Note Body'),
                formatCsvField('Timestamp')
            ].join(',');
            newCsvRows.push(header);

            let mappedCount = 0;
            let unmappedCount = 0;

            for (const row of noteRows) {
                const sfId = row['Association ID'];
                const prefix = sfId ? sfId.substring(0, 3) : '';
                const hubspotId = sfToHsIdMap[prefix]?.get(sfId);

                if (hubspotId) {
                    const mappedRow = [
                        formatCsvField(hubspotId),
                        formatCsvField(row['Note Body']),
                        formatCsvField(row['Timestamp'])
                    ].join(',');
                    newCsvRows.push(mappedRow);
                    mappedCount++;
                } else {
                    unmappedCount++;
                }
            }
            
            if (mappedCount > 0) {
                await fs.promises.writeFile(outputFilePath, newCsvRows.join('\n'));
                console.log(`   - ✅ Processed ${type}: Wrote ${mappedCount} mapped notes to ${outputFilePath}.`);
                if (unmappedCount > 0) {
                    console.log(`   - ⚠️  Skipped ${unmappedCount} notes for ${type} (no HS ID found in mapper).`);
                }
            } else {
                console.log(`   - ℹ️ No notes could be mapped for ${type}.`);
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error(`   - ❌ An error occurred while processing ${type}:`, error);
            }
        }
    }
    console.log('\n✨ Mapping complete!');
}

main().catch(console.error);
