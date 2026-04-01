/**
 * Chrome Manager — start once, all agents connect silently
 * 
 * Usage:
 *   node chrome-manager.js start          # Launch both profile instances
 *   node chrome-manager.js start cameron  # Launch just Cameron's profile
 *   node chrome-manager.js start bianca   # Launch just Bianca's profile
 *   node chrome-manager.js status         # Check which are running
 *   node chrome-manager.js stop           # Stop all agent Chrome instances
 * 
 * This runs SEPARATE Chrome instances on dedicated debug ports.
 * Your real Chrome stays completely untouched.
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const PROFILES = {
  cameron: {
    userDataDir: 'C:/Users/camst/AppData/Local/Google/Chrome/User Data',
    profileDir: 'Profile 4',
    debugPort: 9222,
    label: 'Cameron (cameron@ashbi.ca)',
  },
  bianca: {
    userDataDir: 'C:/Users/camst/AppData/Local/Google/Chrome/User Data',
    profileDir: 'Profile 6',
    debugPort: 9223,
    label: 'Bianca (bianca@ashbi.ca)',
  },
};

function findChromeExe() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome not found');
}

async function isPortOpen(port) {
  try {
    const res = await fetch(`http://localhost:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    const data = await res.json();
    return { open: true, browser: data.Browser };
  } catch {
    return { open: false };
  }
}

async function startProfile(name) {
  const profile = PROFILES[name];
  const status = await isPortOpen(profile.debugPort);

  if (status.open) {
    console.log(`✅ ${profile.label} already running on port ${profile.debugPort}`);
    return;
  }

  const chromeExe = findChromeExe();

  // Use a dedicated user-data-dir copy for agent Chrome instances
  // This avoids the "non-default user-data-dir required" restriction
  // and never touches your real Chrome session
  const agentDataDir = `C:/Users/camst/AppData/Local/AgentChrome/${name}`;

  // On first run: copy just the profile folder (cookies/session) from real Chrome
  const srcProfile = path.join(profile.userDataDir, profile.profileDir);
  const destProfile = path.join(agentDataDir, profile.profileDir);

  if (!fs.existsSync(destProfile)) {
    console.log(`📋 Copying ${name}'s profile to agent dir (first time only)...`);
    fs.mkdirSync(agentDataDir, { recursive: true });
    copyProfileDir(srcProfile, destProfile);
    console.log('   Done.');
  }

  console.log(`🚀 Starting Chrome for ${profile.label} on port ${profile.debugPort}...`);

  spawn(chromeExe, [
    `--remote-debugging-port=${profile.debugPort}`,
    `--user-data-dir=${agentDataDir}`,
    `--profile-directory=${profile.profileDir}`,
    '--no-first-run',
    '--disable-blink-features=AutomationControlled',
    '--window-position=9999,9999', // off-screen so it doesn't clutter your desktop
    '--window-size=1280,900',
  ], { detached: true, stdio: 'ignore' }).unref();

  // Wait for port
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const s = await isPortOpen(profile.debugPort);
    if (s.open) {
      console.log(`✅ ${profile.label} ready (${s.browser})`);
      return;
    }
  }
  console.error(`❌ Chrome for ${name} didn't start in time`);
}

async function stopProfile(name) {
  const profile = PROFILES[name];
  try {
    execSync(
      `taskkill /F /FI "COMMANDLINE like *remote-debugging-port=${profile.debugPort}*" 2>nul`,
      { timeout: 5000 }
    );
    console.log(`🛑 Stopped Chrome for ${PROFILES[name].label}`);
  } catch {
    console.log(`   ${PROFILES[name].label} was not running`);
  }
}

async function status() {
  console.log('Chrome Agent Status:');
  for (const [name, profile] of Object.entries(PROFILES)) {
    const s = await isPortOpen(profile.debugPort);
    const icon = s.open ? '✅' : '⭕';
    const info = s.open ? `running — ${s.browser}` : 'not running';
    console.log(`  ${icon} ${profile.label} (port ${profile.debugPort}): ${info}`);
  }
}

function copyProfileDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const skip = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'ShaderCache', 'lock', 'LOCK', 'SingletonLock'];
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    try {
      if (entry.isDirectory()) {
        copyProfileDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    } catch { /* skip locked files */ }
  }
}

// CLI
const cmd = process.argv[2] || 'status';
const target = process.argv[3]; // optional: cameron | bianca

if (cmd === 'start') {
  const toStart = target ? [target] : Object.keys(PROFILES);
  for (const name of toStart) {
    if (!PROFILES[name]) { console.error(`Unknown profile: ${name}`); continue; }
    await startProfile(name);
  }
} else if (cmd === 'stop') {
  const toStop = target ? [target] : Object.keys(PROFILES);
  for (const name of toStop) {
    if (!PROFILES[name]) continue;
    await stopProfile(name);
  }
} else if (cmd === 'status') {
  await status();
} else {
  console.log('Usage: node chrome-manager.js [start|stop|status] [cameron|bianca]');
}
