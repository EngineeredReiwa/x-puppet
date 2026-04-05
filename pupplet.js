#!/usr/bin/env node
// pupplet - Multi-platform DOM automation via Chrome DevTools Protocol
// Usage: pupplet <platform> <command> [args]
//
// Prerequisites:
//   Launch Chrome with: --remote-debugging-port=9222
//
// Platforms:
//   x        - X/Twitter
//   reddit   - Reddit
//   discord  - Discord

const platforms = {
  x: () => require('./platforms/x'),
  reddit: () => require('./platforms/reddit'),
  discord: () => require('./platforms/discord'),
  note: () => require('./platforms/note'),
};

function showHelp() {
  console.log(`
pupplet - Multi-platform DOM automation via CDP

Usage: pupplet <platform> <command> [args]

Platforms:`);

  for (const [name, loader] of Object.entries(platforms)) {
    const mod = loader();
    console.log(`\n  ${name}:`);
    for (const [cmd, info] of Object.entries(mod.commands)) {
      console.log(`    pupplet ${name} ${info.usage}`);
    }
  }

  console.log(`\nPrereq: Launch Chrome with --remote-debugging-port=9222`);
}

async function main() {
  const args = process.argv.slice(2);
  const platformName = args[0];
  const command = args[1];

  if (!platformName || platformName === '--help' || platformName === '-h') {
    showHelp();
    process.exit(0);
  }

  if (!platforms[platformName]) {
    console.error(`❌ Unknown platform: ${platformName}`);
    console.error(`   Available: ${Object.keys(platforms).join(', ')}`);
    process.exit(1);
  }

  const platform = platforms[platformName]();

  if (!command || command === '--help' || command === '-h') {
    console.log(`\npupplet ${platformName} commands:\n`);
    for (const [cmd, info] of Object.entries(platform.commands)) {
      console.log(`  pupplet ${platformName} ${info.usage}`);
    }
    process.exit(0);
  }

  if (!platform.commands[command]) {
    console.error(`❌ Unknown command: ${command}`);
    console.error(`   Available for ${platformName}: ${Object.keys(platform.commands).join(', ')}`);
    process.exit(1);
  }

  let client;
  try {
    client = await platform.connect();
    await platform.commands[command].fn(client, args.slice(2));
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.message.includes('ECONNREFUSED')) {
      console.error('   Chrome is not running with --remote-debugging-port=9222');
    }
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
}

main();
