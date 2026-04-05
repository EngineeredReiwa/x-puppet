#!/usr/bin/env node
// X Puppet - X/Twitter DOM automation via Chrome DevTools Protocol
//
// Prerequisites: Launch Chrome with --remote-debugging-port=9222
//
// Usage: node index.js <command> [args]

const { BrowserAutomationShim } = require('./shim');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help') {
    console.log(`
pupplet - X/Twitter automation via CDP (no API key needed)

Usage: node index.js <command> [args]

Actions:
  tweet <text>                    Post a tweet
  like [index]                    Like tweet at index (default: 0)
  unlike [index]                  Unlike tweet at index
  reply <text> [index]            Reply to tweet at index
  follow <username>               Follow a user
  unfollow <username>             Unfollow a user

Scraping:
  timeline [limit]                Read timeline (default: 5)
  notifications [limit]           Read notifications (default: 10)
  profile <username>              Get user profile
  tweets <username> [limit]       Get user's tweets
  tweet-detail <tweetId>          Get tweet details
  followers <username> [limit]    Get followers list
  following <username> [limit]    Get following list
  search <query> [limit]          Search tweets

Automation:
  auto-like <query> [max]         Auto-like search results
  auto-like-user <username> [max] Auto-like user's tweets
  auto-comment <query> <comment>  Auto-comment on search results
  keyword-follow <query> [max]    Follow users from search
  unfollow-non-followers <user>   Unfollow non-followers

Other:
  navigate <path>                 Go to x.com/<path>
  eval <js>                       Execute JS on the page

Prereq: Chrome must be running with --remote-debugging-port=9222
    `);
    process.exit(0);
  }

  const ba = new BrowserAutomationShim();

  try {
    const page = await ba.connect();

    switch (command) {
      // --- Actions ---
      case 'tweet': {
        const text = args.slice(1).join(' ');
        if (!text) { console.error('Usage: tweet <text>'); break; }
        await page.goto('https://x.com/home', { waitUntil: 'networkidle2' });
        await page.evaluate(`document.querySelector('[data-testid="SideNav_NewTweet_Button"]').click()`);
        await page.waitForSelector('[data-testid="tweetTextarea_0"]');
        await page.evaluate(`
          const e = document.querySelector('[data-testid="tweetTextarea_0"]');
          e.focus();
          document.execCommand('insertText', false, ${JSON.stringify(text)});
          e.dispatchEvent(new Event('input', { bubbles: true }));
        `);
        const { sleep } = require('./shim');
        await sleep(500);
        await page.click('[data-testid="tweetButton"]');
        await sleep(1000);
        console.log('✅ tweeted:', text.slice(0, 60));
        break;
      }

      case 'like': {
        const idx = parseInt(args[1]) || 0;
        const tweet = await page.evaluate(`
          const b = document.querySelectorAll('[data-testid="like"]')[${idx}];
          if (b) { b.click(); b.closest('article')?.querySelector('[data-testid="tweetText"]')?.textContent?.slice(0, 60) }
          else { null }
        `);
        console.log(tweet ? `❤️  liked: ${tweet}` : '❌ like button not found');
        break;
      }

      case 'unlike': {
        const idx = parseInt(args[1]) || 0;
        await page.evaluate(`document.querySelectorAll('[data-testid="unlike"]')[${idx}]?.click()`);
        console.log('💔 unliked');
        break;
      }

      case 'reply': {
        const text = args[1];
        const idx = parseInt(args[2]) || 0;
        if (!text) { console.error('Usage: reply <text> [index]'); break; }
        await page.evaluate(`document.querySelectorAll('[data-testid="reply"]')[${idx}]?.click()`);
        await page.waitForSelector('[data-testid="tweetTextarea_0"]');
        await page.evaluate(`
          const e = document.querySelector('[data-testid="tweetTextarea_0"]');
          e.focus();
          document.execCommand('insertText', false, ${JSON.stringify(text)});
          e.dispatchEvent(new Event('input', { bubbles: true }));
        `);
        const { sleep: s2 } = require('./shim');
        await s2(500);
        await page.click('[data-testid="tweetButton"]');
        console.log('💬 replied:', text.slice(0, 60));
        break;
      }

      case 'comment': {
        const url = args[1];
        const text = args[2];
        if (!url || !text) { console.error('Usage: comment <tweet_url> <text>'); break; }
        const result = await ba.postComment(page, url, text);
        console.log(result.success ? `💬 commented: ${text.slice(0, 60)}` : `❌ ${result.error}`);
        break;
      }

      case 'follow': {
        const username = args[1];
        if (!username) { console.error('Usage: follow <username>'); break; }
        const result = await ba.followUser(page, username);
        console.log(result.success ? `✅ followed @${username}` : `❌ ${result.error}`);
        break;
      }

      case 'unfollow': {
        const username = args[1];
        if (!username) { console.error('Usage: unfollow <username>'); break; }
        const result = await ba.unfollowUser(page, username);
        console.log(result.success ? `✅ unfollowed @${username}` : `❌ ${result.error}`);
        break;
      }

      // --- Scraping ---
      case 'timeline': {
        const limit = parseInt(args[1]) || 5;
        const tweets = await page.evaluate((lim) => {
          return Array.from(document.querySelectorAll('article')).slice(0, lim).map(a => ({
            user: a.querySelector('[data-testid="User-Name"]')?.textContent?.slice(0, 40),
            text: a.querySelector('[data-testid="tweetText"]')?.textContent?.slice(0, 100),
            liked: !!a.querySelector('[data-testid="unlike"]'),
          }));
        }, limit);
        console.log(`📜 ${tweets.length} tweets:`);
        tweets.forEach((t, i) => {
          console.log(`  [${i}] ${t.liked ? '❤️' : '  '} ${t.user}`);
          if (t.text) console.log(`       ${t.text.slice(0, 80)}`);
        });
        break;
      }

      case 'notifications': {
        const limit = parseInt(args[1]) || 10;
        const notifs = await ba.getNotifications(page, limit);
        console.log(`📬 ${notifs.length} notifications:`);
        notifs.forEach(n => console.log(`  [${n.index}] ${n.text?.slice(0, 100)}`));
        break;
      }

      case 'profile': {
        const username = args[1];
        if (!username) { console.error('Usage: profile <username>'); break; }
        const p = await ba.scrapeProfile(page, username);
        console.log(JSON.stringify(p, null, 2));
        break;
      }

      case 'tweets': {
        const username = args[1];
        const limit = parseInt(args[2]) || 10;
        if (!username) { console.error('Usage: tweets <username> [limit]'); break; }
        const tweets = await ba.scrapeTweets(page, username, limit);
        console.log(`📜 ${tweets.length} tweets from @${username}:`);
        tweets.forEach(t => {
          console.log(`  [${t.timestamp?.slice(0, 10)}] ❤️${t.likes} 🔄${t.retweets} ${t.url || ''}`);
          console.log(`    ${t.text?.slice(0, 80)}`);
        });
        break;
      }

      case 'tweet-detail': {
        const tweetId = args[1];
        if (!tweetId) { console.error('Usage: tweet-detail <tweetId>'); break; }
        const detail = await ba.scrapeTweetDetails(page, tweetId);
        console.log(JSON.stringify(detail, null, 2));
        break;
      }

      case 'followers': {
        const username = args[1];
        const limit = parseInt(args[2]) || 50;
        if (!username) { console.error('Usage: followers <username> [limit]'); break; }
        const users = await ba.scrapeFollowers(page, username, limit);
        console.log(`👥 ${users.length} followers of @${username}:`);
        users.forEach(u => console.log(`  @${u.username} ${u.verified ? '✅' : ''} - ${u.bio?.slice(0, 60) || ''}`));
        break;
      }

      case 'following': {
        const username = args[1];
        const limit = parseInt(args[2]) || 50;
        if (!username) { console.error('Usage: following <username> [limit]'); break; }
        const users = await ba.scrapeFollowing(page, username, limit);
        console.log(`👥 ${users.length} following by @${username}:`);
        users.forEach(u => console.log(`  @${u.username} ${u.verified ? '✅' : ''} - ${u.bio?.slice(0, 60) || ''}`));
        break;
      }

      case 'search': {
        const query = args[1];
        const limit = parseInt(args[2]) || 10;
        if (!query) { console.error('Usage: search <query> [limit]'); break; }
        const tweets = await ba.searchTweets(page, query, limit);
        console.log(`🔍 ${tweets.length} results for "${query}":`);
        tweets.forEach(t => {
          console.log(`  @${t.username} [${t.timestamp?.slice(0, 10)}] ${t.url || ''}`);
          console.log(`    ${t.text?.slice(0, 80)}`);
        });
        break;
      }

      // --- Automation ---
      case 'auto-like': {
        const query = args[1];
        const max = parseInt(args[2]) || 10;
        if (!query) { console.error('Usage: auto-like <query> [max]'); break; }
        const result = await ba.autoLike(page, { query, maxLikes: max });
        console.log(`❤️  Liked ${result.liked.length}/${result.total} tweets`);
        break;
      }

      case 'auto-like-user': {
        const username = args[1];
        const max = parseInt(args[2]) || 10;
        if (!username) { console.error('Usage: auto-like-user <username> [max]'); break; }
        const result = await ba.autoLike(page, { targetUsername: username, maxLikes: max });
        console.log(`❤️  Liked ${result.liked.length}/${result.total} tweets from @${username}`);
        break;
      }

      case 'auto-comment': {
        const query = args[1];
        const comment = args.slice(2).join(' ');
        if (!query || !comment) { console.error('Usage: auto-comment <query> <comment>'); break; }
        const result = await ba.autoComment(page, { query, comments: [comment], maxComments: 5 });
        console.log(`💬 Commented on ${result.commented.length}/${result.total} tweets`);
        break;
      }

      case 'keyword-follow': {
        const query = args[1];
        const max = parseInt(args[2]) || 10;
        if (!query) { console.error('Usage: keyword-follow <query> [max]'); break; }
        const result = await ba.keywordFollow(page, { query, maxFollows: max });
        console.log(`✅ Followed ${result.followed.length}/${result.total} users`);
        break;
      }

      case 'unfollow-non-followers': {
        const username = args[1];
        if (!username) { console.error('Usage: unfollow-non-followers <username>'); break; }
        const result = await ba.unfollowNonFollowers(page, { username });
        console.log(`✅ Unfollowed ${result.unfollowed.length} non-followers`);
        break;
      }

      // --- Other ---
      case 'navigate': {
        const path = args[1];
        if (!path) { console.error('Usage: navigate <path>'); break; }
        const { Page } = ba.client;
        await Page.navigate({ url: 'https://x.com' + (path.startsWith('/') ? path : '/' + path) });
        const { sleep: s3 } = require('./shim');
        await s3(2000);
        console.log('🔗 navigated to:', path);
        break;
      }

      case 'eval': {
        const js = args.slice(1).join(' ');
        const result = await page.evaluate(js);
        console.log(result);
        break;
      }

      default:
        console.error('Unknown command:', command);
        console.error('Run "node index.js help" for usage');
        process.exit(1);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.message.includes('ECONNREFUSED')) {
      console.error('   Chrome not running with --remote-debugging-port=9222');
    }
    process.exit(1);
  } finally {
    await ba.close();
  }
}

main();
