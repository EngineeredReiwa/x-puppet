// Puppeteer Page Shim - PuppeteerのpageオブジェクトをCDP上で再現
// XActionsのコードをそのまま動かすためのアダプター

const CDP = require('chrome-remote-interface');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = (min = 1000, max = 3000) => sleep(min + Math.random() * (max - min));

class PageShim {
  constructor(client, targetId) {
    this.client = client;
    this.targetId = targetId;
    this._closed = false;
  }

  async goto(url, options = {}) {
    const { Page, Runtime } = this.client;
    await Page.enable();
    await Page.navigate({ url });

    // waitUntil: 'networkidle2' 相当 — ページ読み込み完了を待つ
    if (options.waitUntil) {
      await this._waitForLoad();
    } else {
      await sleep(2000);
    }
  }

  async evaluate(fn, ...args) {
    const { Runtime } = this.client;

    let expression;
    if (typeof fn === 'function') {
      // page.evaluate(() => { ... }) 形式
      const argStr = args.map(a => JSON.stringify(a)).join(',');
      expression = `(${fn.toString()})(${argStr})`;
    } else {
      // page.evaluate('expression') 形式
      expression = fn;
    }

    const result = await Runtime.evaluate({
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      const msg = result.exceptionDetails.text ||
        result.exceptionDetails.exception?.description ||
        'evaluate error';
      throw new Error(msg);
    }

    return result.result.value;
  }

  // page.$('selector') — 要素の存在確認
  async $(selector) {
    const exists = await this.evaluate(
      `!!document.querySelector('${selector.replace(/'/g, "\\'")}')`
    );
    return exists ? { click: () => this.click(selector) } : null;
  }

  // page.click('selector')
  async click(selector) {
    await this.evaluate(
      `document.querySelector('${selector.replace(/'/g, "\\'")}')?.click()`
    );
  }

  // page.type('selector', 'text')
  async type(selector, text) {
    await this.evaluate(`
      const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
      if (el) {
        el.focus();
        document.execCommand('insertText', false, ${JSON.stringify(text)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `);
  }

  // page.waitForSelector('selector', { timeout })
  async waitForSelector(selector, options = {}) {
    const timeout = options.timeout || 5000;
    const escaped = selector.replace(/'/g, "\\'");
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const found = await this.evaluate(
        `!!document.querySelector('${escaped}')`
      );
      if (found) return { click: () => this.click(selector) };
      await sleep(200);
    }
    throw new Error(`waitForSelector timeout: ${selector}`);
  }

  // page.setCookie() — 不要（自分のChromeのセッションを使う）
  async setCookie() { /* noop */ }

  // page.setUserAgent() — 不要
  async setUserAgent() { /* noop */ }

  // page.setViewport() — 不要
  async setViewport() { /* noop */ }

  // page.close() — タブを使い回すので基本何もしない
  async close() {
    this._closed = true;
  }

  // page.url()
  async url() {
    return this.evaluate('window.location.href');
  }

  // --- Internal ---
  async _waitForLoad(timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const state = await this.evaluate('document.readyState');
      if (state === 'complete') return;
      await sleep(300);
    }
  }
}

// --- BrowserAutomation Shim ---
// XActionsの browserAutomation モジュールの代替

class BrowserAutomationShim {
  constructor() {
    this.page = null;
    this.client = null;
  }

  async connect(port = 9222) {
    const targets = await CDP.List({ port });
    const xTarget = targets.find(t => t.url.includes('x.com'));

    if (xTarget) {
      this.client = await CDP({ port, target: xTarget });
    } else {
      this.client = await CDP({ port });
      await this.client.Target.createTarget({ url: 'https://x.com/home' });
      await sleep(3000);

      const targets2 = await CDP.List({ port });
      const xTarget2 = targets2.find(t => t.url.includes('x.com'));
      if (xTarget2) {
        await this.client.close();
        this.client = await CDP({ port, target: xTarget2 });
      }
    }

    await this.client.Runtime.enable();
    await this.client.Page.enable();
    this.page = new PageShim(this.client);
    return this.page;
  }

  // XActionsの createPage() 互換
  async createPage(sessionCookie) {
    if (!this.page) await this.connect();
    // sessionCookieは不要（自分のChromeで既にログイン済み）
    return this.page;
  }

  // XActionsの navigateToTwitter() 互換
  async navigateToTwitter(page) {
    const url = await page.url();
    if (!url.includes('x.com')) {
      await page.goto('https://x.com/home', { waitUntil: 'networkidle2' });
    }
  }

  // XActionsの checkAuthentication() 互換
  async checkAuthentication(page) {
    const url = await page.url();
    return !url.includes('/login');
  }

  // XActionsの searchTweets() 互換
  async searchTweets(page, query, limit = 20) {
    await page.goto(`https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`, { waitUntil: 'networkidle2' });
    await sleep(2000);

    // スクロールして追加読み込み (X は lazy load)
    const collected = new Map();
    const maxScrolls = Math.ceil(limit / 5) + 2;
    for (let i = 0; i < maxScrolls; i++) {
      const batch = await page.evaluate(() => {
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        return Array.from(articles).map(article => {
          const textEl = article.querySelector('[data-testid="tweetText"]');
          const linkEl = article.querySelector('a[href*="/status/"]');
          const authorLink = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
          const timeEl = article.querySelector('time');
          const tweetUrl = linkEl?.href;
          const tweetId = tweetUrl?.split('/status/')[1]?.split('?')[0];
          return {
            id: tweetId,
            text: textEl?.textContent || '',
            url: tweetUrl,
            username: authorLink?.href?.split('/').pop() || '',
            timestamp: timeEl?.getAttribute('datetime') || '',
          };
        }).filter(t => t.url);
      });
      for (const t of batch) {
        if (!collected.has(t.id)) collected.set(t.id, t);
      }
      if (collected.size >= limit) break;
      // スクロールして追加ロード
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await sleep(1500);
    }

    return Array.from(collected.values()).slice(0, limit);
  }

  // XActionsの likePost() 互換
  async likePost(page, tweetUrl) {
    try {
      await page.goto(tweetUrl, { waitUntil: 'networkidle2' });
      await sleep(1500);

      const alreadyLiked = await page.evaluate(() =>
        !!document.querySelector('[data-testid="unlike"]')
      );
      if (alreadyLiked) {
        return { success: true, alreadyLiked: true };
      }

      await page.evaluate(() =>
        document.querySelector('[data-testid="like"]')?.click()
      );
      await sleep(500);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // --- スクレイピング系 (browserAutomation.js移植) ---

  // プロフィール取得
  async scrapeProfile(page, username) {
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
    await randomDelay();

    return page.evaluate(() => {
      const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
      const followingLink = document.querySelector('a[href$="/following"]');
      const followersLink = document.querySelector('a[href$="/verified_followers"], a[href$="/followers"]');
      const nameSection = document.querySelector('[data-testid="UserName"]');
      const fullText = nameSection?.textContent || '';
      const usernameMatch = fullText.match(/@(\w+)/);

      return {
        name: fullText.split('@')[0]?.trim() || null,
        username: usernameMatch?.[1] || null,
        bio: getText('[data-testid="UserDescription"]'),
        location: getText('[data-testid="UserLocation"]'),
        website: document.querySelector('[data-testid="UserUrl"] a')?.href || null,
        joinDate: getText('[data-testid="UserJoinDate"]'),
        following: followingLink?.querySelector('span')?.textContent || null,
        followers: followersLink?.querySelector('span')?.textContent || null,
        profileImage: document.querySelector('[data-testid*="UserAvatar"] img')?.src || null,
        verified: !!document.querySelector('[data-testid="UserName"] svg[aria-label*="Verified"]'),
      };
    });
  }

  // ユーザーのツイート一覧取得
  async scrapeTweets(page, username, limit = 20) {
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
    await sleep(2000);

    const tweets = [];
    let scrollAttempts = 0;
    const maxScrolls = Math.ceil(limit / 5);

    while (tweets.length < limit && scrollAttempts < maxScrolls) {
      const newTweets = await page.evaluate((targetUsername) => {
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        return Array.from(articles).map(article => {
          const linkEl = article.querySelector('a[href*="/status/"]');
          const tweetUrl = linkEl?.href;
          const tweetId = tweetUrl?.split('/status/')[1]?.split('?')[0];
          const textEl = article.querySelector('[data-testid="tweetText"]');
          const timeEl = article.querySelector('time');
          const likesEl = article.querySelector('[data-testid="like"] span span');
          const retweetsEl = article.querySelector('[data-testid="retweet"] span span');
          const repliesEl = article.querySelector('[data-testid="reply"] span span');

          return {
            id: tweetId,
            username: targetUsername,
            text: textEl?.textContent || '',
            url: tweetUrl,
            timestamp: timeEl?.getAttribute('datetime') || '',
            likes: likesEl?.textContent || '0',
            retweets: retweetsEl?.textContent || '0',
            replies: repliesEl?.textContent || '0',
            isRetweet: !!article.querySelector('[data-testid="socialContext"]'),
          };
        }).filter(t => t.url);
      }, username);

      newTweets.forEach(t => {
        if (!tweets.find(existing => existing.id === t.id)) tweets.push(t);
      });

      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await randomDelay(2000, 3000);
      scrollAttempts++;
    }

    return tweets.slice(0, limit);
  }

  // ツイート詳細取得
  async scrapeTweetDetails(page, tweetId) {
    await page.goto(`https://x.com/i/status/${tweetId}`, { waitUntil: 'networkidle2' });
    await randomDelay();

    return page.evaluate(() => {
      const article = document.querySelector('article[data-testid="tweet"]');
      if (!article) return null;

      const textEl = article.querySelector('[data-testid="tweetText"]');
      const authorLink = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
      const authorName = article.querySelector('[data-testid="User-Name"]')?.textContent;
      const timeEl = article.querySelector('time');
      const likesEl = article.querySelector('[data-testid="like"] span span');
      const retweetsEl = article.querySelector('[data-testid="retweet"] span span');
      const repliesEl = article.querySelector('[data-testid="reply"] span span');
      const viewsEl = article.querySelector('a[href*="/analytics"] span span');
      const images = Array.from(article.querySelectorAll('[data-testid="tweetPhoto"] img')).map(i => i.src);

      return {
        id: window.location.pathname.match(/status\/(\d+)/)?.[1] || null,
        text: textEl?.textContent || null,
        authorUsername: authorLink?.href?.split('/').pop() || null,
        authorName: authorName?.split('@')[0]?.trim() || null,
        timestamp: timeEl?.getAttribute('datetime') || null,
        likes: likesEl?.textContent || '0',
        retweets: retweetsEl?.textContent || '0',
        replies: repliesEl?.textContent || '0',
        views: viewsEl?.textContent || '0',
        images,
        hasVideo: !!article.querySelector('[data-testid="videoPlayer"]'),
        isQuote: !!article.querySelector('[data-testid="quoteTweet"]'),
      };
    });
  }

  // フォロワー一覧取得
  async scrapeFollowers(page, username, limit = 100) {
    await page.goto(`https://x.com/${username}/followers`, { waitUntil: 'networkidle2' });
    await randomDelay();

    const users = new Map();
    let retries = 0;

    while (users.size < limit && retries < 10) {
      const userData = await page.evaluate(() => {
        const cells = document.querySelectorAll('[data-testid="UserCell"]');
        return Array.from(cells).map(cell => {
          const link = cell.querySelector('a[href^="/"]');
          const nameEl = cell.querySelector('[dir="ltr"] > span');
          const bioEl = cell.querySelector('[data-testid="UserDescription"]');
          const href = link?.getAttribute('href') || '';
          return {
            username: href.split('/')[1],
            name: nameEl?.textContent || null,
            bio: bioEl?.textContent || null,
            verified: !!cell.querySelector('svg[aria-label*="Verified"]'),
          };
        }).filter(u => u.username && !u.username.includes('?'));
      });

      const prevSize = users.size;
      userData.forEach(u => users.set(u.username, u));
      if (users.size === prevSize) retries++;
      else retries = 0;

      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await randomDelay(1500, 2500);
    }

    return Array.from(users.values()).slice(0, limit);
  }

  // フォロー中一覧取得
  async scrapeFollowing(page, username, limit = 100) {
    await page.goto(`https://x.com/${username}/following`, { waitUntil: 'networkidle2' });
    await randomDelay();

    const users = new Map();
    let retries = 0;

    while (users.size < limit && retries < 10) {
      const userData = await page.evaluate(() => {
        const cells = document.querySelectorAll('[data-testid="UserCell"]');
        return Array.from(cells).map(cell => {
          const link = cell.querySelector('a[href^="/"]');
          const nameEl = cell.querySelector('[dir="ltr"] > span');
          const bioEl = cell.querySelector('[data-testid="UserDescription"]');
          const href = link?.getAttribute('href') || '';
          return {
            username: href.split('/')[1],
            name: nameEl?.textContent || null,
            bio: bioEl?.textContent || null,
            verified: !!cell.querySelector('svg[aria-label*="Verified"]'),
          };
        }).filter(u => u.username && !u.username.includes('?'));
      });

      const prevSize = users.size;
      userData.forEach(u => users.set(u.username, u));
      if (users.size === prevSize) retries++;
      else retries = 0;

      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await randomDelay(1500, 2500);
    }

    return Array.from(users.values()).slice(0, limit);
  }

  // --- アクション系 (operations/puppeteer移植) ---

  // コメント投稿
  async postComment(page, tweetUrl, commentText) {
    try {
      await page.goto(tweetUrl, { waitUntil: 'networkidle2' });
      await sleep(2000);

      // リプライ欄を探してクリック
      const replyBox = await page.$('[data-testid="tweetTextarea_0"]');
      if (!replyBox) {
        // リプライボタンをクリックしてダイアログを開く
        await page.click('[data-testid="reply"]');
        await sleep(1000);
      }

      const editor = await page.waitForSelector('[data-testid="tweetTextarea_0"]');
      await page.evaluate(`
        const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
        editor.focus();
        document.execCommand('insertText', false, ${JSON.stringify(commentText)});
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      `);
      await sleep(500);

      await page.click('[data-testid="tweetButton"]');
      await sleep(1500);

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // フォロー
  async followUser(page, username) {
    try {
      await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
      await sleep(1500);

      // 既にフォロー済みかチェック
      const alreadyFollowing = await page.evaluate(() =>
        !!document.querySelector('[data-testid$="-unfollow"]')
      );
      if (alreadyFollowing) return { success: true, alreadyFollowing: true };

      await page.evaluate(() => {
        const btns = document.querySelectorAll('[data-testid$="-follow"]');
        const followBtn = Array.from(btns).find(b => !b.getAttribute('data-testid').includes('unfollow'));
        followBtn?.click();
      });
      await sleep(500);

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // アンフォロー
  async unfollowUser(page, username) {
    try {
      await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
      await sleep(1500);

      await page.evaluate(() => {
        const btn = document.querySelector('[data-testid$="-unfollow"]');
        btn?.click();
      });
      await sleep(500);

      // 確認ダイアログ
      await page.evaluate(() => {
        const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
        confirmBtn?.click();
      });
      await sleep(500);

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // --- 自動操作系 (XActions operations移植) ---

  // 自動いいね（検索 or ユーザー指定）
  async autoLike(page, config = {}) {
    const { query, targetUsername, maxLikes = 10, dryRun = false, onProgress } = config;
    const log = onProgress || console.log;

    let tweets = [];
    if (targetUsername) {
      log(`Fetching tweets from @${targetUsername}...`);
      tweets = await this.scrapeTweets(page, targetUsername, maxLikes * 2);
    } else if (query) {
      log(`Searching for "${query}"...`);
      tweets = await this.searchTweets(page, query, maxLikes * 2);
    } else {
      throw new Error('query or targetUsername required');
    }

    log(`Found ${tweets.length} tweets`);
    const liked = [];
    const limit = Math.min(tweets.length, maxLikes);

    for (let i = 0; i < limit; i++) {
      const tweet = tweets[i];
      log(`[${i + 1}/${limit}] @${tweet.username}: ${tweet.text?.slice(0, 40)}`);

      if (!dryRun && tweet.url) {
        const result = await this.likePost(page, tweet.url);
        if (result.success) liked.push({ url: tweet.url, username: tweet.username, alreadyLiked: result.alreadyLiked });
        await randomDelay(2000, 5000);
        if ((i + 1) % 10 === 0) await randomDelay(10000, 20000);
      }
    }

    return { liked, total: limit, dryRun };
  }

  // 自動コメント
  async autoComment(page, config = {}) {
    const { query, targetUsername, comments = [], maxComments = 5, dryRun = false, onProgress } = config;
    const log = onProgress || console.log;

    if (comments.length === 0) throw new Error('comments array required');

    let tweets = [];
    if (targetUsername) {
      tweets = await this.scrapeTweets(page, targetUsername, maxComments * 2);
    } else if (query) {
      tweets = await this.searchTweets(page, query, maxComments * 2);
    } else {
      throw new Error('query or targetUsername required');
    }

    log(`Found ${tweets.length} tweets`);
    const commented = [];
    const limit = Math.min(tweets.length, maxComments);

    for (let i = 0; i < limit; i++) {
      const tweet = tweets[i];
      const commentText = comments[i % comments.length];
      log(`[${i + 1}/${limit}] @${tweet.username}: "${commentText.slice(0, 30)}"`);

      if (!dryRun && tweet.url) {
        const result = await this.postComment(page, tweet.url, commentText);
        if (result.success) commented.push({ url: tweet.url, username: tweet.username, comment: commentText });
        await randomDelay(30000, 60000); // コメントは厳しいので長めのディレイ
        if ((i + 1) % 5 === 0) await randomDelay(120000, 180000);
      }
    }

    return { commented, total: limit, dryRun };
  }

  // キーワードフォロー
  async keywordFollow(page, config = {}) {
    const { query, maxFollows = 10, dryRun = false, onProgress } = config;
    const log = onProgress || console.log;
    if (!query) throw new Error('query required');

    const tweets = await this.searchTweets(page, query, maxFollows * 3);
    const usernames = [...new Set(tweets.map(t => t.username).filter(Boolean))];
    log(`Found ${usernames.length} unique users`);

    const followed = [];
    const limit = Math.min(usernames.length, maxFollows);

    for (let i = 0; i < limit; i++) {
      const username = usernames[i];
      log(`[${i + 1}/${limit}] Following @${username}`);

      if (!dryRun) {
        const result = await this.followUser(page, username);
        if (result.success) followed.push({ username, alreadyFollowing: result.alreadyFollowing });
        await randomDelay(3000, 6000);
        if ((i + 1) % 10 === 0) await randomDelay(15000, 30000);
      }
    }

    return { followed, total: limit, dryRun };
  }

  // 非フォロバ解除
  async unfollowNonFollowers(page, config = {}) {
    const { username, maxUnfollows = 50, dryRun = false, onProgress } = config;
    const log = onProgress || console.log;
    if (!username) throw new Error('username required');

    log('Fetching followers...');
    const followers = await this.scrapeFollowers(page, username, 500);
    const followerSet = new Set(followers.map(f => f.username));

    log('Fetching following...');
    const following = await this.scrapeFollowing(page, username, 500);

    const nonFollowers = following.filter(f => !followerSet.has(f.username));
    log(`Found ${nonFollowers.length} non-followers`);

    const unfollowed = [];
    const limit = Math.min(nonFollowers.length, maxUnfollows);

    for (let i = 0; i < limit; i++) {
      const user = nonFollowers[i];
      log(`[${i + 1}/${limit}] Unfollowing @${user.username}`);

      if (!dryRun) {
        const result = await this.unfollowUser(page, user.username);
        if (result.success) unfollowed.push({ username: user.username });
        await randomDelay(3000, 6000);
      }
    }

    return { unfollowed, total: limit, dryRun };
  }

  // 通知取得
  async getNotifications(page, limit = 10) {
    await page.goto('https://x.com/notifications', { waitUntil: 'networkidle2' });
    await sleep(2000);

    return page.evaluate((lim) => {
      const articles = document.querySelectorAll('[data-testid="notification"]');
      return Array.from(articles).slice(0, lim).map((a, i) => ({
        index: i,
        text: a.textContent?.slice(0, 200),
      }));
    }, limit);
  }

  // ユーティリティ
  randomDelay(min = 1000, max = 3000) {
    return randomDelay(min, max);
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.page = null;
    }
  }
}

module.exports = { PageShim, BrowserAutomationShim, sleep, randomDelay };
