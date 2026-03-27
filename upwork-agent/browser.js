import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

// PROFILE CONFIGURATION
// Cameron (cameron@ashbi.ca): Shopify/WordPress/web dev — Profile 4 on this machine
// Bianca (bianca@ashbi.ca): CPG/DTC/branding/packaging — Profile 6 on this machine
const PROFILES = {
  cameron: {
    // Agent Chrome uses a separate user-data-dir (never touches real Chrome)
    // Run: node chrome-manager.js start cameron — to launch it
    agentDataDir: 'C:/Users/camst/AppData/Local/AgentChrome/cameron',
    profileDir: 'Profile 4',
    email: 'cameron@ashbi.ca',
    focus: 'Shopify/WordPress/Web',
    debugPort: 9222,
  },
  bianca: {
    agentDataDir: 'C:/Users/camst/AppData/Local/AgentChrome/bianca',
    profileDir: process.env.CHROME_PROFILE || 'Profile 6',
    email: 'bianca@ashbi.ca',
    focus: 'CPG/DTC/Branding',
    debugPort: 9223,
  },
};

export const ACTIVE_PROFILE = process.env.UPWORK_PROFILE || 'cameron';

let browser = null;
let ownedBrowser = false; // did we launch it, or connect to existing?

function findChromeExe() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome not found. Set CHROME_PATH env var.');
}

async function isDebugPortOpen(port) {
  try {
    const res = await fetch(`http://localhost:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function launchChromeWithDebugPort(profile) {
  const chromeExe = findChromeExe();
  console.log(`Launching Chrome with debug port ${profile.debugPort}...`);

  // Kill any Chrome already using this profile (port conflict)
  try {
    execSync(`taskkill /F /FI "COMMANDLINE like *remote-debugging-port=${profile.debugPort}*" 2>nul`, { timeout: 5000 });
    await new Promise(r => setTimeout(r, 1500));
  } catch { /* ignore */ }

  spawn(chromeExe, [
    `--remote-debugging-port=${profile.debugPort}`,
    `--profile-directory=${profile.profileDir}`,
    `--user-data-dir=${profile.userDataDir}`,
    '--no-first-run',
    '--disable-blink-features=AutomationControlled',
  ], { detached: true, stdio: 'ignore' }).unref();

  // Wait for port to be ready
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isDebugPortOpen(profile.debugPort)) {
      console.log('Chrome ready.');
      return;
    }
  }
  throw new Error(`Chrome debug port ${profile.debugPort} never opened`);
}

export async function launchBrowser() {
  const profile = PROFILES[ACTIVE_PROFILE];

  // Try to connect to already-running Chrome debug port first
  if (await isDebugPortOpen(profile.debugPort)) {
    console.log(`Connecting to existing Chrome on port ${profile.debugPort}...`);
  } else {
    // Launch a new Chrome instance with debug port
    await launchChromeWithDebugPort(profile);
    ownedBrowser = true;
  }

  browser = await chromium.connectOverCDP(`http://localhost:${profile.debugPort}`);
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  const page = await context.newPage();
  return page;
}

export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
  // Only kill Chrome if we launched it; don't kill the user's existing session
  if (ownedBrowser) {
    const profile = PROFILES[ACTIVE_PROFILE];
    try {
      execSync(`taskkill /F /FI "COMMANDLINE like *remote-debugging-port=${profile.debugPort}*" 2>nul`, { timeout: 5000 });
    } catch { /* ignore */ }
    ownedBrowser = false;
  }
}
