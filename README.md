<p align="center">
  <h1 align="center">puppet</h1>
  <p align="center">
    Multi-platform social media automation via Chrome DevTools Protocol.<br>
    No API keys. No Puppeteer. No new browser. Just your Chrome.
  </p>
  <p align="center">
    <a href="https://github.com/EngineeredReiwa/x-puppet/stargazers"><img src="https://img.shields.io/github/stars/EngineeredReiwa/x-puppet?style=social" alt="Stars"></a>
    <a href="https://github.com/EngineeredReiwa/x-puppet/network/members"><img src="https://img.shields.io/github/forks/EngineeredReiwa/x-puppet?style=social" alt="Forks"></a>
    <a href="https://github.com/EngineeredReiwa/x-puppet/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
    <a href="https://github.com/EngineeredReiwa/x-puppet/issues"><img src="https://img.shields.io/github/issues/EngineeredReiwa/x-puppet" alt="Issues"></a>
    <a href="https://github.com/EngineeredReiwa/x-puppet/pulls"><img src="https://img.shields.io/github/issues-pr/EngineeredReiwa/x-puppet" alt="PRs"></a>
  </p>
</p>

---

## What is puppet?

**puppet** turns your everyday Chrome into a social media automation engine. It connects to your already-logged-in browser via CDP (Chrome DevTools Protocol) — no API keys, no tokens, no headless browser.

One dependency. Zero config. Works everywhere Chrome runs.

## Supported Platforms

| Platform | Read | Actions | Method |
|----------|------|---------|--------|
| **X / Twitter** | Timeline, profile, search, followers | Tweet, like, reply, follow | DOM |
| **Reddit** | Feed, search, post detail, comments | Upvote, downvote, comment | DOM + JSON API |
| **Discord** | Server discovery, channels, messages | Join server, send messages | DOM + CDP Input |
| **note.com** | Feed, search | Suki (like) | DOM |

> **Want to add a platform?** It takes ~100 lines. See [Contributing](#contributing).

## Why puppet?

| | Official API | Puppeteer | **puppet (CDP)** |
|---|---|---|---|
| Cost | $100/mo+ | Free | **Free** |
| Browser | N/A | New Chromium | **Your Chrome** |
| Login | OAuth / tokens | Cookie management | **Already logged in** |
| Detection risk | None | Stealth plugin needed | **None (you ARE the user)** |
| Dependencies | API SDK | 35+ packages | **1 package** |

## Quick Start

### 1. Launch Chrome with CDP

```bash
# Quit Chrome first (Cmd+Q), then:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.puppet-chrome"
```

> First time? Log into X / Reddit / Discord manually in this Chrome window. Sessions persist.

### 2. Install

**One-command install (with Claude Code skill):**

```bash
npx github:EngineeredReiwa/x-puppet puppet-install
```

This clones the repo to `~/puppet`, installs dependencies, and links the Claude Code skill automatically.

**Or manual install:**

```bash
git clone https://github.com/EngineeredReiwa/x-puppet.git
cd x-puppet
npm install
```

### 3. Use

```bash
# --- X / Twitter ---
node puppet.js x timeline 5                 # Read timeline
node puppet.js x tweet "Hello!"             # Post a tweet
node puppet.js x like 0                     # Like a tweet
node puppet.js x search "query" 10          # Search tweets

# --- Reddit ---
node puppet.js reddit feed 20 javascript    # r/javascript posts
node puppet.js reddit search "book" 10      # Search Reddit
node puppet.js reddit read 0                # Post detail + comments
node puppet.js reddit upvote 0              # Upvote

# --- Discord ---
node puppet.js discord discover "light novel" 10  # Search servers
node puppet.js discord join 0                     # Join server
node puppet.js discord channels                   # List channels
node puppet.js discord messages 20                # Read messages
node puppet.js discord send "Hello!"              # Send message

# --- note.com ---
node puppet.js note feed 10                 # Read feed
node puppet.js note search "keyword" 10     # Search articles
node puppet.js note suki 0                  # Like article
```

## Commands

### puppet x

| Command | Description |
|---------|-------------|
| `tweet <text>` | Post a tweet |
| `like [index]` | Like tweet at index |
| `unlike [index]` | Unlike tweet |
| `reply <text> [index]` | Reply to tweet |
| `notifications [limit]` | Read notifications |
| `timeline [limit]` | Read timeline |
| `search <query> [limit]` | Search tweets |
| `navigate <path>` | Go to x.com/\<path\> |
| `eval <js>` | Execute JS on page |

### puppet reddit

| Command | Description |
|---------|-------------|
| `feed [limit] [subreddit]` | Feed posts. With subreddit: JSON API. Without: DOM |
| `search <query> [limit]` | Search posts across Reddit |
| `read [index]` | Post detail + top 20 comments |
| `detail <permalink>` | Post detail by permalink |
| `upvote [index]` | Upvote post |
| `downvote [index]` | Downvote post |
| `navigate <subreddit>` | Navigate to subreddit |
| `eval <js>` | Execute JS on page |

### puppet discord

| Command | Description |
|---------|-------------|
| `discover [query] [limit]` | Search servers on Discord Discovery |
| `join [index]` | Join server from discovery results |
| `channels` | List channels in current server |
| `messages [limit]` | Read recent messages in current channel |
| `send <text>` | Send a message to current channel |
| `navigate <path>` | Navigate to Discord path |
| `eval <js>` | Execute JS on page |

### puppet note

| Command | Description |
|---------|-------------|
| `feed [limit]` | Read note.com feed |
| `search <query> [limit]` | Search articles |
| `suki [index]` | Like (suki) an article |
| `navigate <path>` | Navigate to note.com path |

## Architecture

```
Your Chrome (with --remote-debugging-port=9222)
  ^ CDP (Chrome DevTools Protocol)
  |
puppet (Node.js)
  +-- puppet.js          -- Multi-platform CLI router
  +-- core/
  |   +-- cdp.js         -- Shared: connectToTab, evaluate, sleep
  +-- platforms/
  |   +-- x.js           -- X/Twitter module
  |   +-- reddit.js      -- Reddit module (DOM + JSON API hybrid)
  |   +-- discord.js     -- Discord module
  |   +-- note.js        -- note.com module
  +-- index.js           -- Legacy X-only CLI
  +-- shim.js            -- Puppeteer API compatibility layer
```

### Adding a New Platform

1. Create `platforms/yoursite.js` with `connect()` and `commands` export
2. Add it to the `platforms` object in `puppet.js`
3. Submit a PR

That's it. ~100 lines to add a whole platform.

## Contributing

**PRs are welcome and encouraged.** This project grows through community contributions.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Ideas for contributions

- **New platforms** — YouTube, Instagram, LinkedIn, Bluesky, Mastodon, TikTok...
- **New commands** — DMs, bookmarks, repost, thread posting...
- **Cross-platform workflows** — Post to multiple platforms at once
- **Better error handling** — Retry logic, DOM change detection
- **Documentation** — Tutorials, examples, translations

Check out the [good first issues](https://github.com/EngineeredReiwa/x-puppet/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) to get started.

## Maintainers Wanted

puppet is community-driven. If you're actively contributing and want to help maintain this project, open an issue or reach out. We're looking for platform maintainers who can own specific modules (e.g., the Reddit module, the Discord module).

## Credits

- Created by [@EngineeredReiwa](https://x.com/EngineeredReiwa)
- DOM selectors and automation patterns for X/Twitter inspired by [XActions](https://github.com/nirholas/XActions) by [@nichxbt](https://x.com/nichxbt)

## License

MIT
