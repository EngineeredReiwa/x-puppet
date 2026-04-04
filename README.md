# puppet

Multi-platform DOM automation via Chrome DevTools Protocol.
No API keys. No Puppeteer. No new browser. Just your Chrome.

## Supported Platforms

| Platform | Read | Actions | Method |
|----------|------|---------|--------|
| **X / Twitter** | Timeline, profile, search, followers | Tweet, like, reply, follow | DOM |
| **Reddit** | Feed, search, post detail, comments | Upvote, downvote | DOM + JSON API |

## Why?

| | Official API | Puppeteer | puppet (CDP) |
|---|---|---|---|
| Cost | $100/mo+ | Free | Free |
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

> First time? Log into X / Reddit manually in this Chrome window. Sessions persist.

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
# --- Reddit ---
node puppet.js reddit feed 20 javascript    # r/javascript の投稿20件
node puppet.js reddit search "book" 10      # "book" で検索
node puppet.js reddit read 0                # 投稿詳細 + コメント
node puppet.js reddit upvote 0              # upvote
node puppet.js reddit navigate books        # r/books に移動

# --- X / Twitter ---
node puppet.js x timeline 5                 # タイムライン
node puppet.js x tweet "Hello!"             # ツイート
node puppet.js x like 0                     # いいね
```

## Commands

### puppet reddit

| Command | Description |
|---------|-------------|
| `feed [limit] [subreddit]` | Feed posts. With subreddit: JSON API (pagination, 100+ OK). Without: DOM (current page) |
| `search <query> [limit]` | Search posts across Reddit |
| `read [index]` | Post detail + top 20 comments (from DOM index) |
| `detail <permalink>` | Post detail by permalink |
| `upvote [index]` | Upvote post (Shadow DOM click) |
| `downvote [index]` | Downvote post (Shadow DOM click) |
| `navigate <subreddit>` | Navigate to subreddit |
| `eval <js>` | Execute JS on page |

### puppet x

| Command | Description |
|---------|-------------|
| `tweet <text>` | Post a tweet |
| `like [index]` | Like tweet at index |
| `unlike [index]` | Unlike tweet |
| `reply <text> [index]` | Reply to tweet |
| `notifications [limit]` | Read notifications |
| `timeline [limit]` | Read timeline |
| `navigate <path>` | Go to x.com/\<path\> |
| `eval <js>` | Execute JS on page |

### Legacy CLI (X only, XActions-compatible)

The original `index.js` still works with the full XActions-compatible feature set:

```bash
node index.js tweet "hello"
node index.js search "query" 10
node index.js auto-like "query" 5
node index.js profile username
```

See `node index.js help` for all commands.

## Architecture

```
Your Chrome (with --remote-debugging-port=9222)
  ↑ CDP (Chrome DevTools Protocol)
  |
puppet (Node.js)
  ├── puppet.js          — Multi-platform CLI router
  ├── core/
  │   └── cdp.js         — Shared: connectToTab, evaluate, sleep
  ├── platforms/
  │   ├── x.js           — X/Twitter module
  │   └── reddit.js      — Reddit module (DOM + JSON API hybrid)
  ├── index.js           — Legacy X-only CLI (XActions-compatible)
  └── shim.js            — Puppeteer API compatibility layer
```

### Reddit: Hybrid Approach

Reddit uses a dual strategy:

- **Reading** (feed, search, detail): Reddit JSON API via browser `fetch()` — supports pagination, 100+ posts per request
- **Actions** (upvote, downvote): Direct DOM manipulation through Shadow DOM (`shreddit-post.shadowRoot`)
- **Home feed**: DOM scraping (personalized feed isn't available via JSON API)

### Adding a New Platform

1. Create `platforms/yoursite.js` with `connect()` and `commands` export
2. Add it to the `platforms` object in `puppet.js`
3. Done

## Using as a Library

```js
// Multi-platform (new)
const reddit = require('./platforms/reddit');
const client = await reddit.connect();
// ... use reddit commands

// XActions-compatible (legacy)
const { BrowserAutomationShim } = require('./shim');
const ba = new BrowserAutomationShim();
const page = await ba.connect();
const profile = await ba.scrapeProfile(page, 'username');
```

## Credits

DOM selectors, rate limit patterns, and automation flows for X/Twitter are inspired by [XActions](https://github.com/nirholas/XActions) by [@nichxbt](https://x.com/nichxbt).

## License

MIT
