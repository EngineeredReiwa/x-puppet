const { connectToTab, evaluate, sleep } = require('../core/cdp');
const fs = require('fs');
const path = require('path');

async function connect() {
  return connectToTab('reddit.com');
}

// --- JSON API helpers ---

async function fetchJSON(client, url) {
  const result = await evaluate(client, `
    fetch('${url}', { headers: { 'Accept': 'application/json' } })
      .then(function(r) { return r.json(); })
      .then(function(d) { return JSON.stringify(d); })
  `);
  return JSON.parse(result);
}

function formatPost(data, index) {
  return {
    index,
    id: data.name,
    title: data.title || '',
    score: data.score || 0,
    author: data.author || '',
    subreddit: data.subreddit_name_prefixed || '',
    comments: data.num_comments || 0,
    type: data.post_hint || (data.is_self ? 'text' : 'link'),
    permalink: data.permalink || '',
    created: new Date(data.created_utc * 1000).toISOString(),
    url: data.url || '',
    selftext: data.selftext || '',
    domain: data.domain || '',
    upvoteRatio: data.upvote_ratio || 0,
  };
}

// --- Commands ---

async function feed(client, limit = 5, subreddit = null) {
  // サブレディット指定 → JSON API (ページネーション対応、大量取得OK)
  // ホームフィード → DOM (現在表示分のみ)
  if (subreddit) {
    return feedJSON(client, limit, subreddit);
  }

  // ホームフィードはまずDOMから取得を試みる
  const domPosts = await feedDOM(client, limit);
  return domPosts;
}

async function feedJSON(client, limit, subreddit) {
  const posts = [];
  let after = null;

  while (posts.length < limit) {
    const batchSize = Math.min(100, limit - posts.length);
    let url = `https://www.reddit.com/r/${subreddit}.json?limit=${batchSize}`;
    if (after) url += `&after=${after}`;

    const data = await fetchJSON(client, url);
    if (!data.data || !data.data.children || data.data.children.length === 0) break;

    data.data.children.forEach(c => {
      if (posts.length < limit) {
        posts.push(formatPost(c.data, posts.length));
      }
    });

    after = data.data.after;
    if (!after) break;
  }

  printPosts(posts);
  return posts;
}

async function feedDOM(client, limit) {
  const result = await evaluate(client, `
    (function() {
      var posts = document.querySelectorAll('shreddit-post');
      var out = [];
      for (var i = 0; i < posts.length; i++) {
        var p = posts[i];
        out.push({
          id: p.id,
          title: p.getAttribute('post-title') || '',
          score: p.getAttribute('score') || '0',
          author: p.getAttribute('author') || '',
          subreddit: p.getAttribute('subreddit-prefixed-name') || '',
          comments: p.getAttribute('comment-count') || '0',
          type: p.getAttribute('post-type') || '',
          permalink: p.getAttribute('permalink') || '',
          created: p.getAttribute('created-timestamp') || '',
        });
      }
      return JSON.stringify(out);
    })()
  `);
  const posts = JSON.parse(result).slice(0, limit).map((p, i) => ({ ...p, index: i }));
  printPosts(posts);
  return posts;
}

function printPosts(posts) {
  console.log(`📜 ${posts.length} posts:`);
  posts.forEach(p => {
    console.log(`  [${p.index}] ⬆${p.score} 💬${p.comments} ${p.subreddit}`);
    console.log(`       ${p.title.slice(0, 80)}`);
    console.log(`       by ${p.author} | ${p.type}`);
  });
}

async function search(client, query, limit = 10, subreddit = null) {
  const posts = [];
  let after = null;

  while (posts.length < limit) {
    const batchSize = Math.min(100, limit - posts.length);
    let url = subreddit
      ? `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=on&limit=${batchSize}`
      : `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${batchSize}`;
    if (after) url += `&after=${after}`;

    const data = await fetchJSON(client, url);
    if (!data.data || !data.data.children || data.data.children.length === 0) break;

    data.data.children.forEach(c => {
      if (posts.length < limit) {
        posts.push(formatPost(c.data, posts.length));
      }
    });

    after = data.data.after;
    if (!after) break;
  }

  console.log(`🔍 ${posts.length} results for "${query}":`);
  posts.forEach(p => {
    console.log(`  [${p.index}] ⬆${p.score} 💬${p.comments} ${p.subreddit}`);
    console.log(`       ${p.title.slice(0, 80)}`);
    console.log(`       by ${p.author}`);
  });
  return posts;
}

async function postDetail(client, permalink) {
  // permalink or post ID
  let url;
  if (permalink.startsWith('/r/')) {
    url = `https://www.reddit.com${permalink}.json`;
  } else if (permalink.startsWith('t3_')) {
    // IDからURLを構築できないのでJSON APIの info endpoint を使う
    url = `https://www.reddit.com/api/info.json?id=${permalink}`;
  } else {
    url = `https://www.reddit.com/r/${permalink}.json`;
  }

  const data = await fetchJSON(client, url);

  // commentsエンドポイントは配列を返す [post, comments]
  if (Array.isArray(data)) {
    const post = data[0].data.children[0].data;
    const cmts = data[1].data.children
      .filter(c => c.kind === 't1')
      .slice(0, 20)
      .map((c, i) => ({
        index: i,
        author: c.data.author,
        score: c.data.score,
        text: (c.data.body || '').slice(0, 200),
        depth: c.data.depth || 0,
      }));

    console.log(`📖 ${post.title}`);
    console.log(`   ${post.subreddit_name_prefixed} | by ${post.author}`);
    console.log(`   ⬆${post.score} 💬${post.num_comments} | ${post.domain || 'self'}`);
    if (post.selftext) console.log(`\n   ${post.selftext.slice(0, 300)}`);
    console.log(`\n💬 ${cmts.length} comments:`);
    cmts.forEach(c => {
      const indent = '  '.repeat(c.depth + 1);
      console.log(`${indent}[${c.index}] ${c.author} (⬆${c.score})`);
      console.log(`${indent}  ${c.text.slice(0, 100)}`);
    });
    return { post: formatPost(post, 0), comments: cmts };
  }

  return data;
}

// --- DOM actions (upvote/downvote require browser interaction) ---

async function upvote(client, index = 0) {
  const result = await evaluate(client, `
    (function() {
      var posts = document.querySelectorAll('shreddit-post');
      if (!posts[${index}]) return JSON.stringify({ error: 'post not found at index ${index}' });
      var p = posts[${index}];
      var sr = p.shadowRoot;
      if (!sr) return JSON.stringify({ error: 'no shadow root' });
      var btn = sr.querySelectorAll('button')[0];
      if (!btn) return JSON.stringify({ error: 'upvote button not found' });
      btn.click();
      return JSON.stringify({ ok: true, title: p.getAttribute('post-title').substring(0, 60) });
    })()
  `);
  const res = JSON.parse(result);
  if (res.ok) {
    console.log('⬆️  upvoted:', res.title);
  } else {
    console.error('❌', res.error);
  }
}

async function downvote(client, index = 0) {
  const result = await evaluate(client, `
    (function() {
      var posts = document.querySelectorAll('shreddit-post');
      if (!posts[${index}]) return JSON.stringify({ error: 'post not found at index ${index}' });
      var p = posts[${index}];
      var sr = p.shadowRoot;
      if (!sr) return JSON.stringify({ error: 'no shadow root' });
      var btn = sr.querySelectorAll('button')[1];
      if (!btn) return JSON.stringify({ error: 'downvote button not found' });
      btn.click();
      return JSON.stringify({ ok: true, title: p.getAttribute('post-title').substring(0, 60) });
    })()
  `);
  const res = JSON.parse(result);
  if (res.ok) {
    console.log('⬇️  downvoted:', res.title);
  } else {
    console.error('❌', res.error);
  }
}

async function read(client, index = 0) {
  // DOM上の投稿からpermalinkを取得してJSON APIで詳細取得
  const permalink = await evaluate(client, `
    (function() {
      var posts = document.querySelectorAll('shreddit-post');
      if (!posts[${index}]) return '';
      return posts[${index}].getAttribute('permalink') || '';
    })()
  `);
  if (!permalink) {
    console.error('❌ post not found at index', index);
    return;
  }
  return postDetail(client, permalink);
}

async function navigate_(client, path) {
  const { Page } = client;
  await Page.enable();
  const url = path.startsWith('http') ? path : 'https://www.reddit.com/' + (path.startsWith('r/') ? path : 'r/' + path);
  await Page.navigate({ url });
  await sleep(2000);
  console.log('🔗 navigated to:', path);
}

async function comment(client, permalink, text) {
  const { Page, Input, Target } = client;
  await Page.enable();

  // Activate tab in Chrome
  try {
    const { targetInfo } = await Target.getTargetInfo();
    await Target.activateTarget({ targetId: targetInfo.targetId });
  } catch (e) {}
  try {
    await Page.bringToFront();
  } catch (e) {}

  // Bring Chrome app to foreground on macOS
  try {
    const { execSync } = require('child_process');
    execSync(`osascript -e 'tell application "Google Chrome" to activate'`, { stdio: 'ignore' });
  } catch (e) {}
  await sleep(800);

  const url = permalink.startsWith('http')
    ? permalink
    : 'https://www.reddit.com' + (permalink.startsWith('/') ? permalink : '/' + permalink);
  await Page.navigate({ url });
  await sleep(3000);

  // Wait for FACEPLATE-TEXTAREA-INPUT to render
  // Note: direct querySelector().getBoundingClientRect() returns 0 on Reddit
  // but finding via parent querySelectorAll works
  let pos = '';
  for (let i = 0; i < 10; i++) {
    pos = await evaluate(client, `
      (function() {
        var cch = document.querySelector('comment-composer-host');
        if (!cch) return '';
        var ft = cch.querySelector('faceplate-textarea-input');
        if (!ft) return '';
        var els = cch.querySelectorAll('*');
        for (var j = 0; j < els.length; j++) {
          if (els[j].tagName === 'FACEPLATE-TEXTAREA-INPUT') {
            var rect = els[j].getBoundingClientRect();
            if (rect.width > 100) {
              return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
            }
          }
        }
        return '';
      })()
    `);
    if (pos) break;
    await sleep(1000);
  }

  if (!pos) {
    console.error('❌ comment box not found on', url);
    return;
  }

  // Click faceplate and retry until editor expands (up to 5 attempts)
  let editorPos = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    // Re-query faceplate position each attempt
    const currentPos = await evaluate(client, `
      (function() {
        var cch = document.querySelector('comment-composer-host');
        if (!cch) return '';
        var els = cch.querySelectorAll('*');
        for (var j = 0; j < els.length; j++) {
          if (els[j].tagName === 'FACEPLATE-TEXTAREA-INPUT') {
            els[j].scrollIntoView({ block: 'center' });
            var rect = els[j].getBoundingClientRect();
            if (rect.width > 100) {
              return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
            }
          }
        }
        return '';
      })()
    `);
    if (!currentPos) {
      // Editor already expanded? Check
      const expanded = await evaluate(client, `
        (function() {
          var cch = document.querySelector('comment-composer-host');
          if (!cch) return '';
          var els = cch.querySelectorAll('*');
          for (var j = 0; j < els.length; j++) {
            if (els[j].getAttribute('role') === 'textbox' && els[j].contentEditable === 'true') {
              var rect = els[j].getBoundingClientRect();
              if (rect.width > 100) {
                return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
              }
            }
          }
          return '';
        })()
      `);
      if (expanded) { editorPos = expanded; break; }
      await sleep(2000);
      continue;
    }
    const cp = JSON.parse(currentPos);
    await Input.dispatchMouseEvent({ type: 'mousePressed', x: cp.x, y: cp.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await Input.dispatchMouseEvent({ type: 'mouseReleased', x: cp.x, y: cp.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await sleep(2000);

    editorPos = await evaluate(client, `
      (function() {
        var cch = document.querySelector('comment-composer-host');
        if (!cch) return '';
        var els = cch.querySelectorAll('*');
        for (var j = 0; j < els.length; j++) {
          if (els[j].getAttribute('role') === 'textbox' && els[j].contentEditable === 'true') {
            var rect = els[j].getBoundingClientRect();
            if (rect.width > 100) {
              return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
            }
          }
        }
        return '';
      })()
    `);
    if (editorPos) break;
    console.log(`  (retry ${attempt + 1}/5: editor not yet expanded)`);
  }

  if (!editorPos) {
    console.error('❌ editor did not expand on', url);
    return;
  }
  const ep = JSON.parse(editorPos);
  await Input.dispatchMouseEvent({ type: 'mousePressed', x: ep.x, y: ep.y, button: 'left', clickCount: 1 });
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x: ep.x, y: ep.y, button: 'left', clickCount: 1 });
  await sleep(500);

  // Type using CDP Input.insertText
  await Input.insertText({ text });
  await sleep(500);

  // Click the submit button (「コメント」or "Comment")
  const submitted = await evaluate(client, `
    (function() {
      var btns = document.querySelectorAll('button[type="submit"]');
      for (var i = 0; i < btns.length; i++) {
        var t = btns[i].textContent.trim();
        if (t === 'コメント' || t === 'Comment' || t === 'comment' || t === 'Reply' || t === 'reply') {
          btns[i].click();
          return 'ok';
        }
      }
      return 'not_found';
    })()
  `);

  if (submitted === 'not_found') {
    console.error('❌ submit button not found');
    return;
  }
  await sleep(2000);

  console.log('💬 commented on:', url);
  console.log('   text:', text.slice(0, 80) + (text.length > 80 ? '...' : ''));
}

async function draft(client) {
  const result = await evaluate(client, `
    (function() {
      var cch = document.querySelector('comment-composer-host');
      if (!cch) return '';
      var els = cch.querySelectorAll('*');
      for (var i = 0; i < els.length; i++) {
        if (els[i].getAttribute('role') === 'textbox' && els[i].contentEditable === 'true') {
          return els[i].textContent || '';
        }
      }
      return '';
    })()
  `);
  if (result) {
    console.log('📝 draft:', result);
  } else {
    console.log('📝 draft: (empty or editor not open)');
  }
  return result;
}

async function verify(client) {
  const result = await evaluate(client, `
    (async function() {
      var url = window.location.href;
      var match = url.match(/\\/comments\\/([^/]+)/);
      if (!match) return JSON.stringify({ error: 'not on a post page' });

      // Get username
      var username = '';
      try {
        var meResp = await fetch('https://www.reddit.com/api/me.json');
        var meData = await meResp.json();
        username = meData.data ? meData.data.name : '';
      } catch(e) {}

      // Get comments
      var resp = await fetch(url + '.json');
      var d = await resp.json();
      if (!Array.isArray(d) || !d[1]) return JSON.stringify({ error: 'no comments data' });
      var comments = d[1].data.children.filter(function(c) { return c.kind === 't1'; });
      var mine = comments.filter(function(c) { return c.data.author === username; });
      if (mine.length === 0) return JSON.stringify({ status: 'NOT_FOUND', username: username, totalComments: comments.length });
      var latest = mine[mine.length - 1].data;
      return JSON.stringify({
        status: latest.body === '[removed]' || latest.body === '[deleted]' ? 'REMOVED' : 'ALIVE',
        body: latest.body.substring(0, 200),
        score: latest.score,
        created: new Date(latest.created_utc * 1000).toISOString(),
        username: username,
      });
    })()
  `);
  const res = JSON.parse(result);
  if (res.status === 'ALIVE') {
    console.log('✅ ALIVE | ⬆' + res.score + ' | ' + res.body.slice(0, 80));
  } else if (res.status === 'REMOVED') {
    console.log('❌ REMOVED | ' + res.body.slice(0, 80));
  } else if (res.status === 'NOT_FOUND') {
    console.log('⚠️  NOT_FOUND | user: ' + res.username + ' | total comments: ' + res.totalComments);
  } else {
    console.log('⚠️ ', JSON.stringify(res));
  }
  return res;
}

async function clear(client) {
  const { Input } = client;
  // Select all text and delete
  const editorPos = await evaluate(client, `
    (function() {
      var cch = document.querySelector('comment-composer-host');
      if (!cch) return '';
      var els = cch.querySelectorAll('*');
      for (var i = 0; i < els.length; i++) {
        if (els[i].getAttribute('role') === 'textbox' && els[i].contentEditable === 'true') {
          var rect = els[i].getBoundingClientRect();
          if (rect.width > 100) {
            els[i].focus();
            return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
          }
        }
      }
      return '';
    })()
  `);
  if (!editorPos) {
    console.log('📝 no editor open to clear');
    return;
  }
  const ep = JSON.parse(editorPos);
  await Input.dispatchMouseEvent({ type: 'mousePressed', x: ep.x, y: ep.y, button: 'left', clickCount: 1 });
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x: ep.x, y: ep.y, button: 'left', clickCount: 1 });
  await sleep(200);
  // Ctrl+A then Backspace
  await Input.dispatchKeyEvent({ type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2 }); // 2 = Ctrl/Cmd
  await Input.dispatchKeyEvent({ type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 });
  await sleep(100);
  await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Backspace', code: 'Backspace' });
  await Input.dispatchKeyEvent({ type: 'keyUp', key: 'Backspace', code: 'Backspace' });
  await sleep(200);
  console.log('🗑️  draft cleared');
}

async function eval_(client, js) {
  const result = await evaluate(client, js);
  console.log(result);
}

// --- Submit (new top-level post) ---
//
// Parses a markdown file where the first `# ` line is the title and the rest is the body.
// Navigates to old.reddit.com/r/<subreddit>/submit (simpler than the React-based new UI),
// fills the form, and leaves it for manual review. Does NOT auto-click submit — Reddit
// submission is a one-way action and often requires captcha.

function parseMarkdownPost(filePath) {
  const resolved = path.resolve(filePath);
  const content = fs.readFileSync(resolved, 'utf-8');
  const lines = content.split('\n');
  let title = '';
  const bodyLines = [];
  let titleFound = false;
  for (const line of lines) {
    if (!titleFound && line.startsWith('# ')) {
      title = line.slice(2).trim();
      titleFound = true;
    } else {
      bodyLines.push(line);
    }
  }
  while (bodyLines.length > 0 && bodyLines[0].trim() === '') bodyLines.shift();
  return { title, body: bodyLines.join('\n') };
}

async function submit(client, subreddit, filePath) {
  if (!subreddit || !filePath) {
    console.error('❌ Usage: pupplet reddit submit <subreddit> <markdown-file>');
    return;
  }
  if (!fs.existsSync(path.resolve(filePath))) {
    console.error(`❌ File not found: ${filePath}`);
    return;
  }

  const { title, body } = parseMarkdownPost(filePath);
  if (!title) {
    console.error('❌ First line of the markdown file must be "# <title>"');
    return;
  }

  console.log(`📝 Subreddit: r/${subreddit}`);
  console.log(`📝 Title: ${title}`);
  console.log(`📝 Body: ${body.length} chars`);

  // Create a new tab for the submit page (avoids stale CDP connections,
  // same pattern as note.post)
  const CDP = require('chrome-remote-interface');
  const port = parseInt(process.env.CDP_PORT || '9222');
  const submitUrl = `https://old.reddit.com/r/${subreddit}/submit?selftext=true`;

  const tmpClient = await CDP({ port });
  await tmpClient.Target.createTarget({ url: submitUrl });
  await tmpClient.close();
  await sleep(4000);

  // Connect to the new submit tab
  const targets = await CDP.List({ port });
  const submitTab = targets.find(
    (t) => t.type === 'page' && t.url.includes('old.reddit.com') && t.url.includes('/submit'),
  );
  if (!submitTab) {
    console.error('❌ Submit tab not found. Are you logged in to old.reddit.com?');
    return;
  }

  const submitClient = await CDP({ port, target: submitTab });
  await submitClient.Runtime.enable();
  await sleep(1500);

  // Verify we're on the submit page (not redirected to login)
  const url = await evaluate(submitClient, `window.location.href`);
  if (url.includes('/login')) {
    console.error('❌ Redirected to login. Log into old.reddit.com first, then retry.');
    await submitClient.close();
    return;
  }
  console.log(`🔗 On: ${url}`);

  // Fill title
  const titleFilled = await evaluate(
    submitClient,
    `(() => {
      const t = document.querySelector('textarea[name="title"]') || document.querySelector('input[name="title"]');
      if (!t) return 'NO_TITLE_FIELD';
      t.focus();
      t.value = ${JSON.stringify(title)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.dispatchEvent(new Event('change', { bubbles: true }));
      return t.value;
    })()`,
  );
  if (titleFilled === 'NO_TITLE_FIELD') {
    console.error('❌ Title field not found. old.reddit.com layout may have changed.');
    await submitClient.close();
    return;
  }
  console.log(`✏️  Title filled: ${titleFilled.slice(0, 60)}`);

  // Fill body
  const bodyFilled = await evaluate(
    submitClient,
    `(() => {
      const t = document.querySelector('textarea[name="text"]');
      if (!t) return 'NO_BODY_FIELD';
      t.focus();
      t.value = ${JSON.stringify(body)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.dispatchEvent(new Event('change', { bubbles: true }));
      return t.value.length;
    })()`,
  );
  if (bodyFilled === 'NO_BODY_FIELD') {
    console.error('❌ Body field not found. old.reddit.com layout may have changed.');
    await submitClient.close();
    return;
  }
  console.log(`✏️  Body filled: ${bodyFilled} chars`);

  console.log(`\n✅ Form filled on old.reddit.com/r/${subreddit}/submit`);
  console.log(`   → Review in browser, solve captcha if needed, then click "submit"`);

  // Force exit after a short grace period (CDP close can hang)
  setTimeout(() => process.exit(0), 500);
}

const commands = {
  feed:     { fn: (c, args) => feed(c, parseInt(args[0]) || 5, args[1] || null),  usage: 'feed [limit] [subreddit]' },
  search:   { fn: (c, args) => search(c, args[0], parseInt(args[1]) || 10),       usage: 'search <query> [limit]' },
  read:     { fn: (c, args) => read(c, parseInt(args[0]) || 0),                   usage: 'read [index]' },
  detail:   { fn: (c, args) => postDetail(c, args.join(' ')),                      usage: 'detail <permalink>' },
  upvote:   { fn: (c, args) => upvote(c, parseInt(args[0]) || 0),                 usage: 'upvote [index]' },
  downvote: { fn: (c, args) => downvote(c, parseInt(args[0]) || 0),               usage: 'downvote [index]' },
  comment:  { fn: (c, args) => comment(c, args[0], args.slice(1).join(' ')),        usage: 'comment <permalink> <text>' },
  draft:    { fn: (c, args) => draft(c),                                           usage: 'draft' },
  verify:   { fn: (c, args) => verify(c),                                          usage: 'verify' },
  clear:    { fn: (c, args) => clear(c),                                           usage: 'clear' },
  submit:   { fn: (c, args) => submit(c, args[0], args[1]),                         usage: 'submit <subreddit> <markdown-file>' },
  navigate: { fn: (c, args) => navigate_(c, args.join(' ')),                       usage: 'navigate <subreddit>' },
  eval:     { fn: (c, args) => eval_(c, args.join(' ')),                           usage: 'eval <js>' },
};

module.exports = { connect, commands };
