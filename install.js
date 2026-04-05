#!/usr/bin/env node
// pupplet installer — clone repo + create Claude Code skill symlink

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = 'https://github.com/EngineeredReiwa/pupplet.git';
const INSTALL_DIR = path.join(os.homedir(), 'pupplet');
const SKILL_SOURCE = path.join(INSTALL_DIR, '.claude', 'skills', 'pupplet');
const SKILL_TARGET = path.join(os.homedir(), '.claude', 'skills', 'pupplet');

console.log('🎭 pupplet installer\n');

// 1. Clone repo
if (fs.existsSync(INSTALL_DIR)) {
  console.log(`📁 ${INSTALL_DIR} already exists, pulling latest...`);
  execSync('git pull', { cwd: INSTALL_DIR, stdio: 'inherit' });
} else {
  console.log(`📥 Cloning to ${INSTALL_DIR}...`);
  execSync(`git clone ${REPO} "${INSTALL_DIR}"`, { stdio: 'inherit' });
}

// 2. npm install
console.log('📦 Installing dependencies...');
execSync('npm install --production', { cwd: INSTALL_DIR, stdio: 'inherit' });

// 3. Create Claude Code skill symlink
fs.mkdirSync(path.join(os.homedir(), '.claude', 'skills'), { recursive: true });

if (fs.existsSync(SKILL_TARGET)) {
  const stat = fs.lstatSync(SKILL_TARGET);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(SKILL_TARGET);
    console.log('🔗 Updating existing skill symlink...');
  } else {
    console.log('⚠️  ~/.claude/skills/pupplet already exists (not a symlink). Skipping.');
  }
}

if (!fs.existsSync(SKILL_TARGET)) {
  fs.symlinkSync(SKILL_SOURCE, SKILL_TARGET);
  console.log('🔗 Skill linked: ~/.claude/skills/pupplet');
}

console.log(`
✅ Done!

Next steps:
  1. Launch Chrome with CDP:
     /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome \\
       --remote-debugging-port=9222 \\
       --user-data-dir="$HOME/.pupplet-chrome"

  2. Log into X/Reddit in that Chrome window (first time only)

  3. Use it:
     node ~/pupplet/pupplet.js x timeline 5
     node ~/pupplet/pupplet.js reddit feed 10

  4. Claude Code will auto-discover the skill.
     Ask Claude: "post a tweet saying hello"
`);
