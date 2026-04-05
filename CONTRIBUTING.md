# Contributing to pupplet

Thanks for your interest in contributing! pupplet is a community-driven project — every PR makes the tool better for everyone.

## Quick Overview

pupplet automates social media platforms by connecting to your Chrome via CDP. Each platform is a self-contained module in `platforms/`.

## Adding a New Platform

This is the highest-impact contribution you can make. It takes ~100 lines.

### 1. Create the module

Create `platforms/yoursite.js`:

```js
const { connectToTab, evaluate, sleep } = require('../core/cdp');

async function connect() {
  // Connect to a tab matching your platform's URL
  const { client, Runtime } = await connectToTab('yoursite.com');
  return { client, Runtime };
}

const commands = {
  async feed({ Runtime }, limit = 10) {
    // Scrape feed items from the DOM
    return evaluate(Runtime, `
      // Your DOM scraping logic here
    `);
  },

  async like({ Runtime }, index = 0) {
    // Click the like button
    return evaluate(Runtime, `
      // Your DOM manipulation here
    `);
  }
};

module.exports = { connect, commands };
```

### 2. Register it

Add one line to `pupplet.js`:

```js
const platforms = {
  x: require('./platforms/x'),
  reddit: require('./platforms/reddit'),
  discord: require('./platforms/discord'),
  yoursite: require('./platforms/yoursite'),  // <-- add this
};
```

### 3. Test it

```bash
# Make sure Chrome is running with --remote-debugging-port=9222
# and you're logged into the platform
node pupplet.js yoursite feed 5
```

### 4. Submit a PR

Update the README platform table and command reference, then open a PR.

## Adding Commands to Existing Platforms

1. Add your function to the platform's `commands` object in `platforms/<platform>.js`
2. Update the README command table
3. Test manually
4. Submit a PR

## Code Style

- **Keep it simple.** pupplet's strength is its simplicity. One dependency. Minimal abstraction.
- **No new dependencies** unless absolutely necessary. Discuss in an issue first.
- **DOM-first.** Prefer DOM scraping/manipulation over API calls. Use APIs only when DOM isn't viable (like Reddit's JSON API for pagination).
- **Platform modules are self-contained.** Each platform file should work independently.
- Use `evaluate()` from `core/cdp.js` for all browser interactions.
- Return structured data (arrays of objects) from read commands.
- Use `console.log` for user-facing output in CLI commands.

## Pull Request Guidelines

- **One feature per PR.** Keep PRs focused and reviewable.
- **Describe what and why** in the PR description.
- **Test manually** before submitting. Automated tests are welcome but not required.
- **Update the README** if you add commands or platforms.

## Reporting Bugs

Open an issue with:
- What you tried (command + arguments)
- What happened (error message or unexpected output)
- Your environment (OS, Chrome version, Node version)

## Feature Requests

Open an issue describing:
- What platform/command you want
- Why it's useful
- Any ideas on implementation

## Becoming a Maintainer

Active contributors can become platform maintainers. This means:
- Triage issues for your platform
- Review PRs for your platform
- Keep DOM selectors up-to-date when sites change their UI

Interested? Open an issue or mention it in a PR.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
