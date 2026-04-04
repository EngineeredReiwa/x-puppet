#!/usr/bin/env node
// dig-discord.js — Discord翻訳待望ユーザーを掘り出してCSV化
//
// Usage: node scripts/dig-discord.js [output.csv]
//
// 現在接続中のDiscordサーバーでキーワード検索し、
// 翻訳を待望しているユーザーのアタックリストをCSVで出力する

const { connectToTab, evaluate, sleep } = require('../core/cdp');
const fs = require('fs');

const KEYWORDS = [
  'untranslated',
  'no english',
  'not translated',
  'wish translated',
  'fan translation',
  'need translation',
  'english version',
  'official translation',
  'japanese only',
  'can\'t read japanese',
];

const LIMIT_PER_KEYWORD = 20;

async function typeText(client, text) {
  for (const ch of text) {
    await client.Input.dispatchKeyEvent({ type: 'keyDown', key: ch, text: ch });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key: ch });
    await sleep(30);
  }
}

async function searchKeyword(client, query, limit) {
  // Escで既存検索を閉じる
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape' });
  await sleep(500);

  // Cmd+F
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 4 });
  await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'f', code: 'KeyF', modifiers: 4 });
  await sleep(1000);

  // Cmd+A → Delete で既存テキストクリア
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 });
  await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 });
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Backspace', code: 'Backspace' });
  await sleep(300);

  await typeText(client, query);
  await sleep(500);

  await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
  await sleep(3000);

  const result = await evaluate(client, `
    (function() {
      var panel = document.querySelector('[class*="searchResultsWrap"]');
      if (!panel) return JSON.stringify({ results: [] });

      var countEl = panel.querySelector('[class*="searchHeader"]');
      var countText = countEl ? countEl.textContent.trim() : '';
      var countMatch = countText.match(/(\\d+)/);
      var totalCount = countMatch ? parseInt(countMatch[1]) : 0;

      var items = panel.querySelectorAll('[class*="searchResult__"]');
      var out = [];
      items.forEach(function(item, i) {
        if (i >= ${limit}) return;
        var authorEl = item.querySelector('[class*="username_"]');
        var contentEl = item.querySelector('[id^="message-content-"]');
        var timeEl = item.querySelector('time');
        out.push({
          author: authorEl ? authorEl.textContent.trim() : '',
          text: contentEl ? contentEl.textContent.trim().substring(0, 500) : '',
          time: timeEl ? timeEl.getAttribute('datetime') : '',
        });
      });
      return JSON.stringify({ totalCount: totalCount, results: out });
    })()
  `);

  return JSON.parse(result);
}

function escapeCSV(str) {
  if (!str) return '';
  str = str.replace(/\r?\n/g, ' ').replace(/"/g, '""');
  if (str.includes(',') || str.includes('"') || str.includes(' ')) {
    return '"' + str + '"';
  }
  return str;
}

async function main() {
  const outputFile = process.argv[2] || 'discord-leads.csv';

  console.log('🔌 Connecting to Discord...');
  const client = await connectToTab('discord.com');

  // 現在のサーバー名を取得
  const serverName = await evaluate(client, `
    (function() {
      var el = document.querySelector('[class*="name_"] h1, [class*="guildName"]');
      if (el) return el.textContent.trim().substring(0, 60);
      var header = document.querySelector('header');
      return header ? header.textContent.trim().substring(0, 60) : 'Unknown';
    })()
  `);
  console.log(`📍 Server: ${serverName}`);

  const allResults = [];
  const seen = new Set();

  for (const keyword of KEYWORDS) {
    process.stdout.write(`🔍 "${keyword}" ... `);
    const data = await searchKeyword(client, keyword, LIMIT_PER_KEYWORD);
    const newResults = [];

    for (const r of data.results) {
      if (!r.author || !r.text) continue;
      const key = `${r.author}|${r.time}|${r.text.slice(0, 50)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      newResults.push({
        server: serverName,
        keyword,
        author: r.author,
        text: r.text,
        time: r.time,
        date: r.time ? new Date(r.time).toISOString().split('T')[0] : '',
      });
    }

    allResults.push(...newResults);
    console.log(`${newResults.length} new (${data.totalCount || '?'} total)`);
    await sleep(1000);
  }

  // CSV出力
  const header = 'server,keyword,author,date,text';
  const rows = allResults.map(r =>
    [r.server, r.keyword, r.author, r.date, r.text].map(escapeCSV).join(',')
  );
  const csv = [header, ...rows].join('\n');
  fs.writeFileSync(outputFile, csv, 'utf8');

  console.log(`\n✅ ${allResults.length} leads saved to ${outputFile}`);
  console.log(`   ${new Set(allResults.map(r => r.author)).size} unique users`);

  await client.close();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
