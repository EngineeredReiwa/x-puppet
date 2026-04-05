---
name: pupplet
description: "X/Twitter automation via CDP. Use when the user asks to post tweets, like tweets, search X, check notifications, follow/unfollow users, or automate X engagement. Requires Chrome running with --remote-debugging-port=9222."
---

# pupplet — X/Twitter DOM Automation

Automate X (Twitter) by controlling the user's Chrome browser via CDP (Chrome DevTools Protocol).

## Prerequisites

Chrome must be running with `--remote-debugging-port=9222`:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.pupplet-chrome"
```

If the user hasn't started Chrome with CDP, tell them to run the command above first.

## CLI Commands

All commands are run from `${CLAUDE_SKILL_DIR}/../../../`:

```bash
node ${CLAUDE_SKILL_DIR}/../../../index.js <command> [args]
```

### Actions
| Command | Description |
|---------|-------------|
| `tweet <text>` | Post a tweet |
| `like [index]` | Like tweet at index (default: 0) |
| `unlike [index]` | Unlike tweet |
| `reply <text> [index]` | Reply to tweet |
| `follow <username>` | Follow a user |
| `unfollow <username>` | Unfollow a user |

### Scraping
| Command | Description |
|---------|-------------|
| `timeline [limit]` | Read timeline (default: 5) |
| `notifications [limit]` | Read notifications (default: 10) |
| `profile <username>` | Get user profile info |
| `tweets <username> [limit]` | Get user's tweets |
| `tweet-detail <tweetId>` | Get tweet details |
| `followers <username> [limit]` | List followers |
| `following <username> [limit]` | List following |
| `search <query> [limit]` | Search tweets |

### Automation
| Command | Description |
|---------|-------------|
| `auto-like <query> [max]` | Auto-like search results |
| `auto-like-user <username> [max]` | Auto-like user's tweets |
| `auto-comment <query> <comment>` | Auto-comment on results |
| `keyword-follow <query> [max]` | Follow users from search |
| `unfollow-non-followers <username>` | Unfollow non-followers |

### Other
| Command | Description |
|---------|-------------|
| `navigate <path>` | Go to x.com/<path> |
| `eval <js>` | Execute JS on the X page |

## Usage Examples

```bash
# Post a tweet
node index.js tweet "Hello from pupplet!"

# Search for tweets about a topic
node index.js search "Kindle NotebookLM" 5

# Like the first tweet on timeline
node index.js like 0

# Check notifications
node index.js notifications 5

# Get a user's profile
node index.js profile EngineeredReiwa

# Auto-like tweets about a topic
node index.js auto-like "AI reading" 10
```

## Using as a Library

```js
const { BrowserAutomationShim } = require('./shim');

const ba = new BrowserAutomationShim();
const page = await ba.connect();

// Scrape
const profile = await ba.scrapeProfile(page, 'username');
const tweets = await ba.searchTweets(page, 'query', 10);

// Act
await ba.likePost(page, 'https://x.com/user/status/123');
await ba.followUser(page, 'username');
await ba.postComment(page, 'https://x.com/user/status/123', 'Great!');

await ba.close();
```

## Important Notes

- Chrome must be running with `--remote-debugging-port=9222`
- First-time setup requires manual X login in the CDP Chrome window
- Uses the user's own Chrome session — no API key, no detection risk
- Built-in rate limiting: 2-5s between likes, 30-60s between comments
- All DOM operations use `data-testid` selectors (stable, used by X's own tests)
