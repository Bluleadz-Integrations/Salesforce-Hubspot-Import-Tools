# Salesforce to HubSpot Data Migration Scripts

This project contains a collection of Node.js scripts designed to process a data export from Salesforce and prepare it for migration into HubSpot. The scripts handle file renaming, generating import sheets for notes and engagements, and uploading files to HubSpot via its API.

---
## Prerequisites

Before you begin, ensure you have the following:

1.  **Node.js:** Make sure Node.js and npm are installed on your machine.
2.  **Salesforce Data Export:** You need a complete data export from Salesforce, including:
    * `Attachment.csv`
    * `ContentVersion.csv`
    * `ContentDocumentLink.csv`
    * `Note.csv` (for classic notes)
    * `Events.csv`
    * `Opportunity.csv`
    * `EmailMessage.csv` (for Enhanced Emails)
    * `Task.csv` (used as a decoder ring to resolve Enhanced Email associations)
    * `wbsendit__Campaign_Monitor_Campaign__c.csv` (if using Campaign Monitor)
    * `wbsendit__Campaign_Activity__c.csv` (if using Campaign Monitor)
    * Folders containing the actual exported files (e.g., `Attachments`, `ContentVersion`).
3.  **HubSpot ID Mappers:** After importing your main records (Contacts, Companies, Deals) into HubSpot, you must create a set of mapping CSVs that link the old Salesforce IDs to the new HubSpot IDs.
4.  **Dependencies:** In your terminal, navigate to the project folder and run the following command to install all necessary libraries:
    ```bash
    npm install axios csv-parser dotenv file-type form-data mime-types
    ```

---
## The Migration Workflow

The migration process should be performed in the following order. Each step uses one or more scripts from this project.

➡️ **Step 1: File Preparation (Renaming)**
Organize your raw exported files into a consistent, readable format.
* `attachment-renamer.js`
* `contentVersion-renamer.js`

➡️ **Step 2: Generate Raw Import Sheets**
Create the initial CSV files for notes and engagements. These will still contain Salesforce IDs.
* `create-snotes.js` (for modern SNotes)
* `create-classic-notes.js`
* `create-activities.js`

➡️ **Step 2b: Generate Email Activity Sheets (from SF Email sources)**
Salesforce stores emails in multiple places. Run the relevant scripts for whichever sources you have. Because these outputs embed raw HTML email bodies, HubSpot's standard importer will frequently reject the resulting CSVs (it misidentifies them as HTML files rather than CSVs). Use the matching API import script instead of uploading through the HubSpot UI.
* `create-enhanced-emails.js` — for emails stored in `EmailMessage` (Salesforce Enhanced Email)
* `create-email-from-campaign-monitor.js` — for emails sent via Campaign Monitor and tracked in Salesforce

➡️ **Step 3: Map Salesforce IDs to HubSpot IDs**
This is a manual step where you import your main records (Contacts, Companies, etc.) into HubSpot. Then, you create the `mapper` CSVs that link the old Salesforce IDs to the new HubSpot IDs.

➡️ **Step 4: Finalize Import Sheets**
Run `map-snotes.js` to replace the SF IDs in your note sheets with the correct HubSpot IDs.

➡️ **Step 5: Prepare File Upload Manifest**
Run `create-import-manifest.js` to generate the JSON files that list which files belong to which HubSpot records.

➡️ **Step 5b: Import Email Activities via API**
Run the API import scripts to push the email CSVs created in Step 2b directly into HubSpot. **You must add your HubSpot Private App Token to each script's `CONFIG.hubspotToken` field before running** (see script details below). Both scripts rate-limit themselves to ~10 requests per second to stay within HubSpot's API limits.
* `import-enhanced-emails.js` — imports Enhanced Email CSVs for contacts, companies, and deals
* `import-campagin-montior-emails.js` — imports Campaign Monitor email CSVs (contacts only)

➡️ **Step 6: Upload Files to HubSpot**
Run `import-files.js` to read the manifest and upload/attach all files via the API.

---
## Script Details & Usage

### 1. File Renaming Scripts

These scripts make your file folders manageable by renaming files from their Salesforce ID to a more descriptive format (`ID -- Title.ext`).

#### `attachment-renamer.js`
* **Purpose:** Renames files from your `Attachment.csv` export.
* **Configuration:** Set the `CSV_FILE_PATH` and `FILES_DIRECTORY_PATH` variables inside the script.
* **Usage:** `node attachment-renamer.js`

#### `contentVersion-renamer.js`
* **Purpose:** Renames files from your `ContentVersion.csv` export. It correctly handles versioning (only processing the latest), skips SNotes, and truncates filenames that are too long.
* **Configuration:** Set the `CONTENT_VERSION_CSV` and `FILES_DIRECTORY_PATH` variables. You can also adjust `MAX_FILENAME_BODY_LENGTH`.
* **Usage:** `node contentVersion-renamer.js`

### 2. Import Sheet Generators

These scripts read your Salesforce data and create the initial CSV files for import.

#### `create-snotes.js`
* **Purpose:** Processes `ContentVersion.csv` to find all SNotes (rich text notes), reads their HTML content, and generates categorized import sheets (`..._Contacts.csv`, `..._Companies.csv`, etc.).
* **Configuration:** Set paths for `ContentVersion.csv`, `ContentDocumentLink.csv`, and the folder containing the files. The `sfIdPrefixMap` can also be customized.
* **Usage:** `node create-snotes.js`

#### `create-classic-notes.js`
* **Purpose:** Processes the classic `Note.csv` export and generates categorized import sheets. It combines the `Title` and `Body` fields for better context in HubSpot.
* **Configuration:** Set the path for `Note.csv` and the mappers directory.
* **Usage:** `node create-classic-notes.js`

#### `create-activities.js`
* **Purpose:** Processes `Events.csv` to create import sheets for Calls, Meetings, and Emails.
* **Configuration:** The `TYPE_MAP` object at the top is crucial. Here, you map your custom Salesforce event types (e.g., "Qual Call", "Demo") to a standard HubSpot type (`calls`, `meetings`, `emails`).
* **Usage:** `node create-activities.js`

### 3. Email Activity Generators

Salesforce stores email history in several places beyond `Events.csv`. These scripts extract emails from those sources and produce HubSpot-compatible import CSVs. Because the output files contain raw HTML email bodies, HubSpot's standard CSV importer will often reject them as "not a valid CSV." Use the matching API import scripts (section 4 below) instead of uploading through the HubSpot UI.

#### `create-enhanced-emails.js`
* **Purpose:** Processes `EmailMessage.csv` (Salesforce Enhanced Email) to produce separate import CSVs for Contacts, Companies, and Deals. Uses `Task.csv` as a decoder ring to resolve which HubSpot records each email should be linked to, and injects From/To/CC metadata as a styled HTML header in the email body.
* **Configuration:** Set `mappersDir`, `emailMessageCsv`, `tasksCsv`, and `outputDir` inside the `CONFIG` block at the top of the script.
* **Usage:** `node create-enhanced-emails.js`
* **Output:** `hubspot_import_enhanced_emails_for_contacts.csv`, `..._companies.csv`, `..._deals.csv`

#### `create-email-from-campaign-monitor.js`
* **Purpose:** Processes Campaign Monitor campaign data (`wbsendit__Campaign_Monitor_Campaign__c.csv` and `wbsendit__Campaign_Activity__c.csv`) to produce email activity CSVs. Only "Sent" interactions are exported — opens, clicks, and bounces are ignored. If an HTML body is not stored in Salesforce, the script fetches it live from Campaign Monitor's web version URL. Output is automatically chunked into files of 2,000 rows each to avoid import size limits.
* **Configuration:** Set `mappersDir`, the two `salesforce` CSV paths, `outputDir`, and optionally `chunkSize` in the `CONFIG` block.
* **Usage:** `node create-email-from-campaign-monitor.js`
* **Output:** `HubSpot_Import_Campaign_Monitor_Emails_Part_1.csv`, `..._Part_2.csv`, etc.

### 4. Email Activity API Import Scripts

These scripts push the email CSVs directly into HubSpot via the Engagements API, bypassing the CSV importer entirely. **Before running either script, open it and paste your HubSpot Private App Token into the `hubspotToken` field inside the `CONFIG` block.** Do not commit this token to source control.

To get a Private App Token:
1. In HubSpot, go to **Settings → Integrations → Private Apps**.
2. Create a new app (or use an existing one) and grant it `crm.objects.contacts.write`, `crm.objects.companies.write`, and `crm.objects.deals.write` scopes, plus `engagements` write access.
3. Copy the token and paste it into `CONFIG.hubspotToken` in the script.

#### `import-enhanced-emails.js`
* **Purpose:** Reads the CSVs produced by `create-enhanced-emails.js` (files containing `enhanced_emails` in the name) from the configured `generatedFilesDir` and posts each row to HubSpot's v1 Engagements API. Automatically detects from the filename whether each file targets contacts, companies, or deals and routes the association accordingly.
* **Configuration:** Set `generatedFilesDir`, `failedOutputPath`, and `hubspotToken` in the `CONFIG` block.
* **Special Setup:** Paste your HubSpot Private App Token into `CONFIG.hubspotToken`.
* **Usage:** `node import-enhanced-emails.js`
* **Output:** Any rows that fail to upload are saved to `failed_enhanced_api_emails.csv` for review.

#### `import-campagin-montior-emails.js`
* **Purpose:** Reads the chunked CSVs produced by `create-email-from-campaign-monitor.js` (files containing `Campaign_Monitor` in the name) from `generatedFilesDir` and posts each row to HubSpot's v1 Engagements API. Also loads the original campaigns CSV to look up sender name and email address to attach to each engagement.
* **Configuration:** Set `generatedFilesDir`, `campaignsCsv`, `failedOutputPath`, and `hubspotToken` in the `CONFIG` block.
* **Special Setup:** Paste your HubSpot Private App Token into `CONFIG.hubspotToken`.
* **Usage:** `node import-campagin-montior-emails.js`
* **Output:** Any rows that fail to upload are saved to `failed_api_emails.csv` for review.

### 6. Post-Processing Scripts

These scripts refine the generated import sheets and prepare for the final API step.

#### `map-snotes.js`
* **Purpose:** Reads the CSVs generated by the "create notes" scripts and replaces the Salesforce "Association ID" with the correct HubSpot "Record ID" from your mapper files.
* **Configuration:** Set the directory paths for your mappers and the note CSVs.
* **Usage:** `node map-snotes.js`
* **Output:** Generates new files ending in `_mapped.csv`. **These are the files you will use for the HubSpot Note import.**

#### `create-import-manifest.js`
* **Purpose:** The final data preparation step. It reads your mapper files and your Salesforce `Attachment` and `ContentVersion` CSVs to produce a set of JSON "manifest" files. These files link a HubSpot record ID to the specific file(s) that should be attached to it.
* **Configuration:** Requires paths to all mappers, all relevant Salesforce CSVs, and the folders containing the renamed files.
* **Usage:** `node create-import-manifest.js`
* **Output:** Creates `contacts_manifest.json`, `companies_manifest.json`, etc.

### 7. HubSpot API File Upload Script

#### `import-files.js`
* **Purpose:** Reads the JSON manifest files and performs the final import. For each entry, it finds the file on your disk, uploads it to the HubSpot File Manager, and then attaches it as a Note engagement to the specified HubSpot record.
* **Special Setup:** This script requires API credentials.
    1.  **Create a `.env` file** in the project root.
    2.  Add your HubSpot Private App token to it: `HUBSPOT_API_KEY=your-private-app-token-goes-here`
    3.  **Add `.env` to your `.gitignore` file** to keep your key secure.
* **Configuration:** The `DRY_RUN` flag is at the top. **It is highly recommended to run with `DRY_RUN: true` first.** This will simulate the entire process and log which files it finds without making any changes to your HubSpot account. Once you confirm the output is correct, set it to `false` to perform the live import.
* **Usage:** `node import-files.js`
