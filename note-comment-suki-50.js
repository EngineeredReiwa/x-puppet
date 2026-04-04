// BookHalo関連記事50件 コメント＋スキ スクリプト
const { connectToTab, evaluate, sleep } = require('./core/cdp');

// --- コメントテンプレート（記事カテゴリ別） ---
const COMMENTS = {
  highlight: [
    'ハイライト活用の仕組み、とても参考になります！自分もKindle本のテキストをいかに活かすか試行錯誤中です',
    'Kindleハイライトの整理って地味に手間かかりますよね。効率的な方法を模索してて共感しました',
    'ハイライトを読書ノートに活かすの、自分も実践してます。この方法は良いですね',
  ],
  pdf: [
    'PDF化のアプローチ、参考になります！電子書籍の活用幅が広がりますね',
    'Kindle本のPDF化、自分も色々試してます。この方法はスマートですね',
    'PDF変換の手順がわかりやすくまとまっていて助かります',
  ],
  reading: [
    '読書術として実践的ですね。インプットを確実にアウトプットにつなげる仕組みが大事ですよね',
    'デジタルツールを読書に活かす視点、共感します。自分も似たような運用を試しています',
    '読書の質を上げる工夫が詰まっていて、とても勉強になりました',
  ],
  kindle: [
    'Kindleの活用法、参考になります！まだまだ知らない使い方があるんだなと感心しました',
    'Kindle周りの情報、ありがたいです。電子書籍の可能性をもっと広げたいですね',
    'Kindleユーザーとして共感する部分が多いです。良い記事をありがとうございます',
  ],
  notebooklm: [
    'NotebookLMとの組み合わせ、面白いですね！本の内容を対話的に深掘りできるのは革命的だと思います',
    'NotebookLMに本のテキストを読ませるアイデア、自分もやってます。可能性が広がりますよね',
  ],
  obsidian: [
    'Obsidianとの連携、実用的ですね！ナレッジベースとして読書メモを蓄積するの最高です',
    'Obsidianで読書ノートを管理する発想、自分も取り入れています。参考になりました',
  ],
  ebook: [
    '電子書籍の活用法、とても参考になりました。デジタルならではの使い方がもっと広がるといいですね',
    '電子書籍周りのノウハウ、ありがたいです。紙では難しいことができるのが電子の強みですよね',
  ],
  general: [
    '興味深い記事ですね。新しい視点をもらえました、ありがとうございます',
    '良い記事ですね。自分も似たようなことを考えていたので参考になりました',
    'わかりやすくまとまっていて勉強になります。ありがとうございます',
  ],
};

// キーワード→カテゴリ判定
function categorize(title, body) {
  const text = (title + ' ' + body).toLowerCase();
  if (text.includes('notebooklm') || text.includes('notebook lm')) return 'notebooklm';
  if (text.includes('obsidian')) return 'obsidian';
  if (text.includes('ハイライト') || text.includes('highlight')) return 'highlight';
  if (text.includes('pdf')) return 'pdf';
  if (text.includes('読書術') || text.includes('読書ノート') || text.includes('読書法')) return 'reading';
  if (text.includes('kindle')) return 'kindle';
  if (text.includes('電子書籍') || text.includes('ebook')) return 'ebook';
  return 'general';
}

function pickComment(category) {
  const pool = COMMENTS[category] || COMMENTS.general;
  return pool[Math.floor(Math.random() * pool.length)];
}

// --- 検索キーワード ---
const KEYWORDS = [
  'Kindle ハイライト 活用',
  'Kindle PDF 変換',
  'Kindle 読書ノート',
  'NotebookLM Kindle',
  'Kindle Obsidian',
  'Kindle テキスト抽出',
  '電子書籍 読書術',
  'Kindle Cloud Reader',
];

const TARGET = 50;
const DELAY_BETWEEN = 5000; // 5秒間隔（コメント付きなので慎重に）

async function collectUrls(client, keyword, limit = 12) {
  const searchUrl = `https://note.com/search?q=${encodeURIComponent(keyword)}&context=note`;
  await evaluate(client, `window.location.href = '${searchUrl}'`);
  await sleep(5000);

  for (let i = 0; i < 2; i++) {
    await evaluate(client, 'window.scrollBy(0, 2000)');
    await sleep(1500);
  }

  const urls = await evaluate(client, `
    JSON.stringify(
      Array.from(document.querySelectorAll('a.m-largeNoteWrapper__link[href*="/n/"]'))
        .map(a => a.href)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .slice(0, ${limit})
    )
  `);

  return urls ? JSON.parse(urls) : [];
}

async function commentAndSuki(client, url) {
  await evaluate(client, `window.location.href = '${url}'`);
  await sleep(4000);

  // タイトル・本文取得
  const title = await evaluate(client, `
    (document.querySelector('h1')?.textContent?.trim() || document.title)?.slice(0, 100)
  `) || '(no title)';

  const body = await evaluate(client, `
    (document.querySelector('.note-common-styles__textnote-body, .p-article__content')?.textContent?.trim() || '').slice(0, 300)
  `) || '';

  // 自分の記事はスキップ
  const author = await evaluate(client, `
    document.querySelector('.o-noteContentHeader__name, [class*="creatorName"]')?.textContent?.trim() || ''
  `) || '';
  if (author.includes('Engineered Reiwa') || author.includes('engineered_reiwa')) {
    console.log(`  ⏭️  自分の記事スキップ: ${title}`);
    return 'skip_self';
  }

  // スキ済み確認
  const liked = await evaluate(client, `
    document.querySelector('.o-noteLikeV3__iconButton')?.getAttribute('aria-pressed')
  `);

  // --- コメント投稿 ---
  // コメント欄を開く
  await evaluate(client, `document.querySelector('.o-viewComment')?.click()`);
  await sleep(2000);

  // textarea存在確認
  const hasTextarea = await evaluate(client, `!!document.querySelector('.o-noteCommentForm__inputMessage')`);
  if (!hasTextarea) {
    console.log(`  ⚠️  コメント欄なし: ${title}`);
    // スキだけする
    if (liked !== 'true') {
      await evaluate(client, `document.querySelector('.o-noteLikeV3__iconButton')?.click()`);
      await sleep(1000);
    }
    return 'suki_only';
  }

  // カテゴリ判定＆コメント選択
  const category = categorize(title, body);
  const comment = pickComment(category);

  // textarea にフォーカス＆入力
  await evaluate(client, `document.querySelector('.o-noteCommentForm__inputMessage')?.focus()`);
  await sleep(500);

  const { Input } = client;
  await Input.insertText({ text: comment });
  await sleep(1500);

  // 送信ボタンクリック
  const submitClicked = await evaluate(client, `
    const btn = document.querySelector('[data-v-fcbb7f8c] button[aria-label="送信"]');
    if (btn) { btn.click(); true; } else { false; }
  `);

  if (!submitClicked) {
    console.log(`  ⚠️  送信ボタンなし: ${title}`);
    // キャンセル
    await evaluate(client, `document.querySelector('[data-v-fcbb7f8c] button[aria-label="キャンセル"]')?.click()`);
    await sleep(500);
  } else {
    await sleep(2000);
    console.log(`  💬 コメント投稿 [${category}]: ${title}`);
    console.log(`     "${comment}"`);
  }

  // --- スキ ---
  if (liked !== 'true') {
    await evaluate(client, `document.querySelector('.o-noteLikeV3__iconButton')?.click()`);
    await sleep(1000);
    console.log(`  💚 スキ!`);
  } else {
    console.log(`  💚 already liked`);
  }

  return submitClicked ? 'commented' : 'suki_only';
}

(async () => {
  const client = await connectToTab('note.com');
  const allUrls = new Set();
  const stats = { commented: 0, suki_only: 0, skip_self: 0, error: 0 };

  // Phase 1: URL収集
  console.log('=== Phase 1: URL収集 ===');
  for (const kw of KEYWORDS) {
    if (allUrls.size >= TARGET * 1.5) break;
    console.log(`🔍 "${kw}" ...`);
    try {
      const urls = await collectUrls(client, kw, 12);
      const newCount = urls.filter(u => !allUrls.has(u)).length;
      urls.forEach(u => allUrls.add(u));
      console.log(`   → ${urls.length}件 (新規${newCount}件, 合計${allUrls.size}件)`);
    } catch (e) {
      console.log(`   ⚠️ error: ${e.message}`);
    }
  }

  const urlList = Array.from(allUrls).slice(0, TARGET + 10);
  console.log(`\n=== Phase 2: ${urlList.length}件にコメント＋スキ (目標${TARGET}件) ===\n`);

  // Phase 2: 各記事にコメント＋スキ
  let doneCount = 0;
  for (let i = 0; i < urlList.length && doneCount < TARGET; i++) {
    const url = urlList[i];
    console.log(`[${i + 1}/${urlList.length}] (完了${doneCount}/${TARGET})`);
    try {
      const result = await commentAndSuki(client, url);
      stats[result] = (stats[result] || 0) + 1;
      if (result === 'commented' || result === 'suki_only') doneCount++;
      await sleep(DELAY_BETWEEN);
    } catch (e) {
      console.log(`  ❌ error: ${e.message}`);
      stats.error++;
      await sleep(3000);
    }
  }

  console.log('\n=== 完了 ===');
  console.log(`💬 コメント＋スキ: ${stats.commented}`);
  console.log(`💚 スキのみ: ${stats.suki_only}`);
  console.log(`⏭️  自分スキップ: ${stats.skip_self}`);
  console.log(`❌ エラー: ${stats.error}`);
})();
