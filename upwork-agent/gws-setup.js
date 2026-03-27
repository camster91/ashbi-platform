/**
 * Automates Google Cloud Console setup for gws CLI
 * Uses existing Chrome Profile 4 (cameron@ashbi.ca) — already logged into Google
 * 
 * What this does:
 * 1. Opens Google Cloud Console
 * 2. Creates a new project "Ashbi Hub"
 * 3. Enables Gmail, Calendar, Drive, Sheets APIs
 * 4. Creates OAuth 2.0 Desktop credentials
 * 5. Downloads client_secret.json
 * 6. Saves to C:/Users/camst/.config/gws/client_secret.json
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';


const GWS_CONFIG_DIR = 'C:/Users/camst/.config/gws';
const OUTPUT_PATH = path.join(GWS_CONFIG_DIR, 'client_secret.json');

// APIs to enable
const APIS_TO_ENABLE = [
  'gmail.googleapis.com',
  'calendar-json.googleapis.com', 
  'drive.googleapis.com',
  'sheets.googleapis.com',
  'docs.googleapis.com',
];

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function setup() {
  fs.mkdirSync(GWS_CONFIG_DIR, { recursive: true });

  console.log('Launching Chrome with your Google account...');
  
  // Use AgentChrome dir (separate from real Chrome, avoids conflicts)
  // Must run: node chrome-manager.js start cameron first
  const agentDataDir = 'C:/Users/camst/AppData/Local/AgentChrome/cameron';
  const context = await chromium.launchPersistentContext(
    agentDataDir,
    {
      executablePath: findChromeExe(),
      headless: false,
      slowMo: 200,
      args: ['--profile-directory=Profile 4', '--no-first-run'],
      viewport: { width: 1400, height: 900 },
    }
  );

  const page = context.pages()[0] || await context.newPage();

  try {
    // Step 1: Go to Google Cloud Console — create new project
    console.log('Step 1: Creating Google Cloud project...');
    await page.goto('https://console.cloud.google.com/projectcreate', { waitUntil: 'networkidle', timeout: 30000 });
    await wait(3000);

    // Fill project name
    const projectNameInput = page.locator('input[id*="project"], input[placeholder*="project"], #p-name');
    if (await projectNameInput.count() > 0) {
      await projectNameInput.first().clear();
      await projectNameInput.first().fill('Ashbi Hub');
      await wait(1000);
      await page.locator('button:has-text("Create"), input[type="submit"][value="Create"]').first().click();
      await wait(5000);
      console.log('Project created (or already exists)');
    } else {
      console.log('Project form not found — may already be on a project, continuing...');
    }

    // Step 2: Enable APIs
    console.log('Step 2: Enabling APIs...');
    for (const api of APIS_TO_ENABLE) {
      const apiUrl = `https://console.cloud.google.com/apis/library/${api}`;
      await page.goto(apiUrl, { waitUntil: 'networkidle', timeout: 20000 });
      await wait(2000);
      
      const enableBtn = page.locator('button:has-text("Enable"), a:has-text("Enable")');
      if (await enableBtn.count() > 0) {
        await enableBtn.first().click();
        await wait(3000);
        console.log(`  Enabled: ${api}`);
      } else {
        console.log(`  Already enabled: ${api}`);
      }
    }

    // Step 3: Configure OAuth consent screen
    console.log('Step 3: Configuring OAuth consent screen...');
    await page.goto('https://console.cloud.google.com/apis/credentials/consent', { waitUntil: 'networkidle', timeout: 20000 });
    await wait(2000);

    // Select External if prompted
    const externalRadio = page.locator('input[value="EXTERNAL"], mat-radio-button:has-text("External")');
    if (await externalRadio.count() > 0) {
      await externalRadio.first().click();
      await wait(500);
      const createBtn = page.locator('button:has-text("Create")');
      if (await createBtn.count() > 0) await createBtn.first().click();
      await wait(2000);
    }

    // Fill app name
    const appNameInput = page.locator('input[formcontrolname="displayName"], input[placeholder*="app name"]');
    if (await appNameInput.count() > 0) {
      await appNameInput.first().fill('Ashbi Hub');
      // Fill support email
      const emailInput = page.locator('input[formcontrolname="userSupportEmail"], mat-select[formcontrolname="userSupportEmail"]');
      if (await emailInput.count() > 0) await emailInput.first().click();
      await wait(1000);
      // Save and continue
      await page.locator('button:has-text("Save and Continue"), button:has-text("Save")').first().click();
      await wait(2000);
      // Skip scopes, go to test users
      await page.locator('button:has-text("Save and Continue"), button:has-text("Add or remove scopes")').last().click();
      await wait(1000);
      await page.locator('button:has-text("Save and Continue")').first().click();
      await wait(2000);
      // Add test user
      const addUserBtn = page.locator('button:has-text("Add Users"), button:has-text("+ Add users")');
      if (await addUserBtn.count() > 0) {
        await addUserBtn.first().click();
        await wait(1000);
        const userInput = page.locator('input[type="email"], input[placeholder*="email"]').last();
        await userInput.fill('cameron@ashbi.ca');
        await page.locator('button:has-text("Add"), button:has-text("Save")').last().click();
        await wait(1000);
      }
      await page.locator('button:has-text("Save and Continue"), button:has-text("Back to Dashboard")').last().click();
      await wait(2000);
      console.log('OAuth consent screen configured');
    }

    // Step 4: Create OAuth credentials
    console.log('Step 4: Creating OAuth Desktop credentials...');
    await page.goto('https://console.cloud.google.com/apis/credentials', { waitUntil: 'networkidle', timeout: 20000 });
    await wait(2000);

    await page.locator('button:has-text("Create Credentials"), a:has-text("Create Credentials")').first().click();
    await wait(1000);
    await page.locator('text=OAuth client ID').first().click();
    await wait(1500);

    // Select Desktop app
    const appTypeSelect = page.locator('mat-select[formcontrolname="applicationType"], select[name*="type"]');
    if (await appTypeSelect.count() > 0) {
      await appTypeSelect.first().click();
      await wait(500);
      await page.locator('mat-option:has-text("Desktop app"), option:has-text("Desktop app")').first().click();
      await wait(500);
    }

    // Name it
    const nameInput = page.locator('input[formcontrolname="name"], input[placeholder*="name"]').last();
    await nameInput.clear();
    await nameInput.fill('Ashbi Hub CLI');
    await wait(500);
    await page.locator('button:has-text("Create")').last().click();
    await wait(3000);

    // Step 5: Download the JSON
    console.log('Step 5: Downloading credentials...');
    
    // Watch for download
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    
    const downloadBtn = page.locator('button:has-text("Download JSON"), a:has-text("Download JSON"), button[aria-label*="download"]');
    if (await downloadBtn.count() > 0) {
      await downloadBtn.first().click();
      const download = await downloadPromise;
      if (download) {
        await download.saveAs(OUTPUT_PATH);
        console.log(`✅ Saved credentials to ${OUTPUT_PATH}`);
      }
    } else {
      // May have shown a dialog with the credentials — close it and go to credentials list
      await page.locator('button:has-text("OK"), button:has-text("Close")').first().click().catch(() => {});
      await wait(1000);
      
      // Find the credential we just created and download
      await page.goto('https://console.cloud.google.com/apis/credentials', { waitUntil: 'networkidle', timeout: 20000 });
      await wait(2000);
      const downloadLinks = page.locator('a[title*="Download"], button[aria-label*="Download"]');
      if (await downloadLinks.count() > 0) {
        const dl = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
        await downloadLinks.first().click();
        const download = await dl;
        if (download) {
          await download.saveAs(OUTPUT_PATH);
          console.log(`✅ Saved credentials to ${OUTPUT_PATH}`);
        }
      }
    }

    if (fs.existsSync(OUTPUT_PATH)) {
      console.log('\n✅ Setup complete! Running gws auth login...');
      await context.close();
      return true;
    } else {
      console.log('\n⚠️  Could not auto-download. Please manually download the OAuth JSON from:');
      console.log('https://console.cloud.google.com/apis/credentials');
      console.log(`And save it to: ${OUTPUT_PATH}`);
      console.log('\nLeaving browser open for you to complete manually...');
      return false;
    }

  } catch (err) {
    console.error('Setup error:', err.message);
    console.log('Leaving browser open — complete setup manually if needed');
    return false;
  }
}

function findChromeExe() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome not found');
}

setup();
