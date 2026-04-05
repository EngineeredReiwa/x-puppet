// pupplet - note.com platform module
// DOM automation for note.com via CDP

const { connectToTab, evaluate, sleep } = require('../core/cdp');
const fs = require('fs');
const path = require('path');

async function connect() {
  return connectToTab('note.com');
}

// --- Actions ---

async function suki(client, index = 0) {
  const btns = await evaluate(client, `
    const btns = document.querySelectorAll('.o-noteLikeV3__iconButton');
    Array.from(btns).map((b, i) => ({
      index: i,
      liked: b.getAttribute('aria-pressed') === 'true',
      count: b.closest('.o-noteLikeV3')?.querySelector('.o-noteLikeV3__count')?.textContent?.trim(),
    }));
  `);

  if (!btns[index]) {
    console.error('❌ suki button not found at index', index);
    return;
  }

  if (btns[index].liked) {
    console.log(`💚 already liked (count: ${btns[index].count})`);
    return;
  }

  await evaluate(client, `document.querySelectorAll('.o-noteLikeV3__iconButton')[${index}]?.click()`);
  await sleep(1000);

  const after = await evaluate(client, `
    document.querySelectorAll('.o-noteLikeV3__count')[${index}]?.textContent?.trim()
  `);
  console.log(`💚 スキ! (${btns[index].count} → ${after})`);
}

async function unsuki(client, index = 0) {
  const liked = await evaluate(client, `
    document.querySelectorAll('.o-noteLikeV3__iconButton')[${index}]?.getAttribute('aria-pressed')
  `);

  if (liked !== 'true') {
    console.log('🤍 not liked');
    return;
  }

  await evaluate(client, `document.querySelectorAll('.o-noteLikeV3__iconButton')[${index}]?.click()`);
  await sleep(1000);
  console.log('🤍 unsuki');
}

// --- Scraping ---

async function feed(client, limit = 10) {
  const articles = await evaluate(client, `
    Array.from(document.querySelectorAll('.m-noteBody, article, [class*="note-card"]')).slice(0, ${limit}).map((a, i) => {
      const title = a.querySelector('h3, [class*="title"]')?.textContent?.trim();
      const author = a.querySelector('[class*="creator"], [class*="author"]')?.textContent?.trim();
      const likes = a.querySelector('.o-noteLikeV3__count, [class*="like"] [class*="count"]')?.textContent?.trim();
      const link = a.querySelector('a[href*="/n/"]')?.href;
      return { index: i, title: title?.slice(0, 60), author: author?.slice(0, 30), likes, url: link };
    });
  `);

  if (!articles || articles.length === 0) {
    console.log('📝 No articles found on current page');
    return;
  }

  console.log(`📝 ${articles.length} articles:`);
  articles.forEach(a => {
    console.log(`  [${a.index}] ${a.title || '(no title)'}`);
    console.log(`       ${a.author || ''} | 💚${a.likes || '?'}`);
  });
}

async function articleDetail(client) {
  const detail = await evaluate(client, `
    const title = document.querySelector('h1, .o-noteTitle')?.textContent?.trim();
    const author = document.querySelector('.o-noteContentHeader__name, [class*="creatorName"]')?.textContent?.trim();
    const body = document.querySelector('.note-common-styles__textnote-body, .p-article__content')?.textContent?.trim();
    const likes = document.querySelector('.o-noteLikeV3__count')?.textContent?.trim();
    const liked = document.querySelector('.o-noteLikeV3__iconButton')?.getAttribute('aria-pressed') === 'true';
    JSON.stringify({ title, author, body: body?.slice(0, 500), likes, liked });
  `);

  if (!detail) {
    console.log('❌ No article found on current page');
    return;
  }

  const d = JSON.parse(detail);
  console.log(`📖 ${d.title}`);
  console.log(`   by ${d.author} | 💚${d.likes} ${d.liked ? '(liked)' : ''}`);
  console.log(`   ${d.body?.slice(0, 200)}...`);
}

async function search(client, query, limit = 10) {
  await evaluate(client, `window.location.href = 'https://note.com/search?q=${encodeURIComponent(query)}&context=note'`);
  await sleep(3000);

  const results = await evaluate(client, `
    Array.from(document.querySelectorAll('a[href*="/n/"]')).slice(0, ${limit}).map((a, i) => {
      const container = a.closest('[class*="card"], [class*="item"], article') || a;
      const title = container.querySelector('h3, [class*="title"]')?.textContent?.trim() || a.textContent?.trim();
      return { index: i, title: title?.slice(0, 60), url: a.href };
    }).filter(r => r.title);
  `);

  console.log(`🔍 ${results?.length || 0} results for "${query}":`);
  (results || []).forEach(r => {
    console.log(`  [${r.index}] ${r.title}`);
    console.log(`       ${r.url}`);
  });
}

async function navigate(client, path) {
  const url = path.startsWith('http') ? path : `https://note.com/${path}`;
  await evaluate(client, `window.location.href = '${url}'`);
  await sleep(3000);
  const title = await evaluate(client, 'document.title');
  console.log(`🔗 ${title}`);
}

// --- Markdown to HTML ---

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineFormat(text) {
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/`(.+?)`/g, '<code>$1</code>');
  text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  return text;
}

function parseMarkdownFile(filePath) {
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

  // Remove leading empty lines
  while (bodyLines.length > 0 && bodyLines[0].trim() === '') bodyLines.shift();

  const html = markdownToHtml(bodyLines.join('\n'));
  return { title, html };
}

function markdownToHtml(md) {
  const lines = md.split('\n');
  const parts = [];
  let inCodeBlock = false;
  let codeContent = '';
  let inList = false;
  let listType = '';
  let inTable = false;
  let tableRows = [];

  function closeList() {
    if (inList) {
      parts.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
    }
  }

  function closeTable() {
    if (inTable && tableRows.length > 0) {
      // note.com has no table support — render as bold header + text rows
      const headers = tableRows[0];
      parts.push(`<p><strong>${headers.join(' | ')}</strong></p>`);
      for (let i = 1; i < tableRows.length; i++) {
        parts.push(`<p>${tableRows[i].join(' | ')}</p>`);
      }
      inTable = false;
      tableRows = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        parts.push(`<pre><code>${escapeHtml(codeContent.trimEnd())}</code></pre>`);
        codeContent = '';
        inCodeBlock = false;
      } else {
        closeList();
        closeTable();
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeContent += line + '\n';
      continue;
    }

    // Table rows (lines starting with |)
    if (line.trim().startsWith('|') && line.includes('|', 1)) {
      // Skip separator rows like |---|---|
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.length > 0) {
        if (!inTable) { closeList(); inTable = true; tableRows = []; }
        tableRows.push(cells);
      }
      continue;
    } else {
      closeTable();
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeList();
      parts.push('<hr>');
      continue;
    }

    // Headings
    if (line.startsWith('### ')) { closeList(); parts.push(`<h3>${inlineFormat(line.slice(4))}</h3>`); continue; }
    if (line.startsWith('## '))  { closeList(); parts.push(`<h2>${inlineFormat(line.slice(3))}</h2>`); continue; }

    // Blockquote
    if (line.startsWith('> ')) {
      closeList();
      parts.push(`<blockquote><p>${inlineFormat(line.slice(2))}</p></blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*] /.test(line)) {
      if (!inList || listType !== 'ul') { closeList(); inList = true; listType = 'ul'; parts.push('<ul>'); }
      parts.push(`<li>${inlineFormat(line.replace(/^[-*] /, ''))}</li>`);
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      if (!inList || listType !== 'ol') { closeList(); inList = true; listType = 'ol'; parts.push('<ol>'); }
      parts.push(`<li>${inlineFormat(line.replace(/^\d+\. /, ''))}</li>`);
      continue;
    }

    closeList();

    // Empty line — skip (paragraph break)
    if (line.trim() === '') continue;

    // Regular paragraph
    parts.push(`<p>${inlineFormat(line)}</p>`);
  }

  closeList();
  closeTable();
  return parts.join('');
}

// --- Post ---

async function post(client, filePath) {
  if (!filePath) {
    console.error('❌ Usage: pupplet note post <markdown-file>');
    return;
  }

  if (!fs.existsSync(path.resolve(filePath))) {
    console.error(`❌ File not found: ${filePath}`);
    return;
  }

  const { title, html } = parseMarkdownFile(filePath);
  console.log(`📝 Title: ${title}`);
  console.log(`📝 Body: ${html.length} chars of HTML`);

  // Create a new tab for the editor (avoids stale CDP connections)
  const CDP = require('chrome-remote-interface');
  const port = parseInt(process.env.CDP_PORT || '9222');

  // Open new tab directly to the notes/new URL
  const tmpClient = await CDP({ port });
  const { targetId } = await tmpClient.Target.createTarget({ url: 'https://note.com/notes/new' });
  await tmpClient.close();
  await sleep(5000); // Wait for redirect to editor.note.com

  // Connect to the new editor tab
  const targets = await CDP.List({ port });
  const editorTab = targets.find(t => t.url.includes('editor.note.com') && t.type === 'page');
  if (!editorTab) {
    console.error('❌ Editor tab not found. Are you logged in to note.com?');
    return;
  }

  // Use the new editor tab's client instead
  const editorClient = await CDP({ port, target: editorTab });
  await editorClient.Runtime.enable();
  await sleep(2000);

  // Wait for ProseMirror editor to appear
  for (let attempt = 0; attempt < 5; attempt++) {
    const ready = await evaluate(editorClient, `!!document.querySelector('.ProseMirror')`).catch(() => false);
    if (ready) break;
    await sleep(2000);
  }

  const editorReady = await evaluate(editorClient, `!!document.querySelector('.ProseMirror')`).catch(() => false);
  if (!editorReady) {
    console.error('❌ Editor not loaded. Try again.');
    await editorClient.close();
    return;
  }

  // From here on, use editorClient instead of client
  client = editorClient;

  // Set title — React-compatible: reset valueTracker, set native value, dispatch input
  const escapedTitle = title.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  await evaluate(client, `
    const textarea = document.querySelector('textarea[placeholder="記事タイトル"]');
    if (textarea) {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      // Reset React's internal value tracker so it detects the change
      const tracker = textarea._valueTracker;
      if (tracker) tracker.setValue('');
      nativeSetter.call(textarea, '${escapedTitle}');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  `);
  await sleep(500);

  // Focus ProseMirror editor and paste HTML via ClipboardEvent
  const escapedHtml = html.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  await evaluate(client, `
    const editor = document.querySelector('.ProseMirror');
    editor.focus();

    const clipboardData = new DataTransfer();
    clipboardData.setData('text/html', '${escapedHtml}');
    clipboardData.setData('text/plain', '');
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData,
      bubbles: true,
      cancelable: true,
    });
    editor.dispatchEvent(pasteEvent);
  `);
  await sleep(2000);

  // Verify content was inserted
  const bodyLen = await evaluate(client, `document.querySelector('.ProseMirror')?.textContent?.length || 0`);
  if (bodyLen > 10) {
    console.log(`✅ Draft created! (${bodyLen} chars in body)`);
    console.log('   → Review in browser, then click "公開に進む" to publish');
  } else {
    console.log('⚠️  Paste may not have worked. Trying fallback with insertHTML...');

    // Fallback: use execCommand
    await evaluate(client, `
      const editor = document.querySelector('.ProseMirror');
      editor.focus();
      document.execCommand('insertHTML', false, '${escapedHtml}');
    `);
    await sleep(1000);

    const bodyLen2 = await evaluate(client, `document.querySelector('.ProseMirror')?.textContent?.length || 0`);
    if (bodyLen2 > 10) {
      console.log(`✅ Draft created with fallback! (${bodyLen2} chars in body)`);
      console.log('   → Review in browser, then click "公開に進む" to publish');
    } else {
      console.log('❌ Could not insert content. Try pasting manually.');
    }
  }
}

// --- Command Router ---

const commands = {
  suki:     { fn: (c, args) => suki(c, parseInt(args[0]) || 0),                  usage: 'suki [index]' },
  unsuki:   { fn: (c, args) => unsuki(c, parseInt(args[0]) || 0),                usage: 'unsuki [index]' },
  feed:     { fn: (c, args) => feed(c, parseInt(args[0]) || 10),                 usage: 'feed [limit]' },
  detail:   { fn: (c, args) => articleDetail(c),                                  usage: 'detail' },
  search:   { fn: (c, args) => search(c, args[0], parseInt(args[1]) || 10),      usage: 'search <query> [limit]' },
  navigate: { fn: (c, args) => navigate(c, args[0]),                              usage: 'navigate <path|url>' },
  post:     { fn: (c, args) => post(c, args[0]),                                       usage: 'post <markdown-file>' },
  eval:     { fn: async (c, args) => { console.log(await evaluate(c, args.join(' '))); }, usage: 'eval <js>' },
};

module.exports = { connect, commands };
