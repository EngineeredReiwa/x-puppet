// BookHalo関連記事100件スキスクリプト
const { connectToTab, evaluate, sleep } = require('./core/cdp');

const KEYWORDS = [
  'Kindle ハイライト',
  'Kindle 読書ノート',
  'Kindle テキスト抽出',
  '電子書籍 PDF',
  'Kindle Cloud Reader',
  'Kindle メモ',
  'Kindle 読書術',
  '読書 デジタル化',
  'Kindle 活用',
  'Kindle まとめ',
];

const TARGET = 100;
const DELAY_BETWEEN_SUKI = 3000; // 3秒間隔（レート制限対策）

async function collectUrls(client, keyword, limit = 15) {
  const searchUrl = `https://note.com/search?q=${encodeURIComponent(keyword)}&context=note`;
  await evaluate(client, `window.location.href = '${searchUrl}'`);
  await sleep(5000);

  // スクロールして追加読み込み
  for (let i = 0; i < 3; i++) {
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

async function sukiArticle(client, url) {
  await evaluate(client, `window.location.href = '${url}'`);
  await sleep(4000);

  // タイトル取得
  const title = await evaluate(client, `
    (document.querySelector('h1')?.textContent?.trim() || document.title)?.slice(0, 60)
  `) || '(no title)';

  // スキ済みか確認
  const liked = await evaluate(client, `
    document.querySelector('.o-noteLikeV3__iconButton')?.getAttribute('aria-pressed')
  `);

  if (liked === 'true') {
    console.log(`  💚 already liked: ${title}`);
    return 'already';
  }

  // スキボタンクリック
  const btnExists = await evaluate(client, `
    !!document.querySelector('.o-noteLikeV3__iconButton')
  `);

  if (!btnExists) {
    console.log(`  ⚠️  no suki button: ${title}`);
    return 'no_button';
  }

  await evaluate(client, `document.querySelector('.o-noteLikeV3__iconButton').click()`);
  await sleep(1500);

  // 確認
  const afterLiked = await evaluate(client, `
    document.querySelector('.o-noteLikeV3__iconButton')?.getAttribute('aria-pressed')
  `);

  if (afterLiked === 'true') {
    console.log(`  💚 スキ!: ${title}`);
    return 'liked';
  } else {
    console.log(`  ❓ uncertain: ${title}`);
    return 'uncertain';
  }
}

(async () => {
  const client = await connectToTab('note.com');
  const allUrls = new Set();
  const stats = { liked: 0, already: 0, no_button: 0, uncertain: 0, error: 0 };

  // Phase 1: URL収集
  console.log('=== Phase 1: URL収集 ===');
  for (const kw of KEYWORDS) {
    if (allUrls.size >= TARGET * 1.5) break; // 余裕を持って収集
    console.log(`🔍 "${kw}" ...`);
    try {
      const urls = await collectUrls(client, kw, 15);
      const newCount = urls.filter(u => !allUrls.has(u)).length;
      urls.forEach(u => allUrls.add(u));
      console.log(`   → ${urls.length}件 (新規${newCount}件, 合計${allUrls.size}件)`);
    } catch (e) {
      console.log(`   ⚠️ error: ${e.message}`);
    }
  }

  const urlList = Array.from(allUrls).slice(0, TARGET + 20); // 余裕分
  console.log(`\n=== Phase 2: ${urlList.length}件にスキ (目標${TARGET}件) ===\n`);

  // Phase 2: 各記事にスキ
  let sukiCount = 0;
  for (let i = 0; i < urlList.length && sukiCount < TARGET; i++) {
    const url = urlList[i];
    console.log(`[${i + 1}/${urlList.length}] (スキ済${sukiCount}/${TARGET})`);
    try {
      const result = await sukiArticle(client, url);
      stats[result]++;
      if (result === 'liked') sukiCount++;
      await sleep(DELAY_BETWEEN_SUKI);
    } catch (e) {
      console.log(`  ❌ error: ${e.message}`);
      stats.error++;
      await sleep(2000);
    }
  }

  console.log('\n=== 完了 ===');
  console.log(`💚 新規スキ: ${stats.liked}`);
  console.log(`💚 既にスキ済: ${stats.already}`);
  console.log(`⚠️  ボタンなし: ${stats.no_button}`);
  console.log(`❓ 不明: ${stats.uncertain}`);
  console.log(`❌ エラー: ${stats.error}`);
})();
