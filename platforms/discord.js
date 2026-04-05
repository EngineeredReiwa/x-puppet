const { connectToTab, evaluate, sleep } = require('../core/cdp');

async function connect() {
  return connectToTab('discord.com');
}

// --- Helpers ---

async function typeText(client, text) {
  // React制御コンポーネント対応: keyDown + char + keyUp の3段階を発火
  // char イベントが beforeinput/input を発生させ React の state を更新する
  for (const ch of text) {
    const upper = ch.toUpperCase();
    const code = /^[a-zA-Z]$/.test(ch) ? 'Key' + upper : (ch === ' ' ? 'Space' : '');
    const kc = ch === ' ' ? 32 : upper.charCodeAt(0);
    await client.Input.dispatchKeyEvent({ type: 'keyDown', key: ch, code, windowsVirtualKeyCode: kc });
    await client.Input.dispatchKeyEvent({ type: 'char', text: ch, unmodifiedText: ch });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key: ch, code, windowsVirtualKeyCode: kc });
    await sleep(60);
  }
}

async function pressEnter(client) {
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}

// 現在のDiscordページが何の状態か判定
// 返り値: 'in_channel' | 'no_access' | 'server_no_channel' | 'discovery' | 'home' | 'unknown'
async function detectState(client) {
  const state = await evaluate(client, `
    (function() {
      var t = document.body.textContent || '';
      // 権限なし/認証必要画面
      if (t.indexOf('テキストチャンネルがありません') !== -1) return 'no_access';
      if (t.indexOf("don't have access to any text channels") !== -1) return 'no_access';
      if (t.indexOf('No Text Channels') !== -1 && t.indexOf('wrong place') !== -1) return 'no_access';
      // チャンネル表示中 (メッセージリストがある)
      if (document.querySelector('[data-list-id="chat-messages"]')) return 'in_channel';
      // Discoveryページ
      if (document.querySelectorAll('[class*="card__84e3e"]').length > 0) return 'discovery';
      // サーバーに入ってるがチャンネル未選択 (サイドバーにチャンネルリストはある)
      if (document.querySelectorAll('[data-dnd-name]').length > 0) return 'server_no_channel';
      // DM/Home画面
      if (location.pathname === '/channels/@me' || location.pathname.startsWith('/channels/@me/')) return 'home';
      return 'unknown';
    })()
  `);
  return state;
}

async function requireState(client, expectedStates, actionHint) {
  const state = await detectState(client);
  const expected = Array.isArray(expectedStates) ? expectedStates : [expectedStates];
  if (expected.includes(state)) return state;

  const hints = {
    no_access: '❌ このサーバーの認証が必要です。verify-here チャンネルで認証するか、別のサーバーに移動してください',
    server_no_channel: 'ℹ️  サーバーに入りましたが、まだチャンネルが開かれていません。`puppet discord goto <channel>` でチャンネルを開いてください',
    discovery: 'ℹ️  現在 Discovery ページです。`puppet discord join <index>` でサーバーに入るか、`puppet discord goto` でチャンネルを開いてください',
    home: 'ℹ️  DM/ホーム画面です。サーバーに移動してください',
    unknown: '⚠️  現在の状態が判定できませんでした',
  };
  console.error(hints[state] || hints.unknown);
  if (actionHint) console.error('   ' + actionHint);
  const err = new Error('state_mismatch: ' + state);
  err.state = state;
  throw err;
}

function parseServerCard(text, name) {
  // "ServerNameDescription123人がオンライン456人" をパース
  var desc = text;
  if (name) desc = desc.replace(name, '');
  var onlineMatch = desc.match(/([\d,]+)人がオンライン/);
  var memberMatch = desc.match(/オンライン([\d,]+)人/);
  // English fallback
  if (!onlineMatch) onlineMatch = desc.match(/([\d,]+)\s*Online/);
  if (!memberMatch) memberMatch = desc.match(/Online\s*([\d,]+)\s*Members/);

  var online = onlineMatch ? onlineMatch[1] : '';
  var members = memberMatch ? memberMatch[1] : '';
  desc = desc.replace(/[\d,]+人がオンライン[\d,]+人/, '').replace(/[\d,]+\s*Online\s*[\d,]+\s*Members/, '').trim();
  return { description: desc.slice(0, 120), online, members };
}

// --- Commands ---

async function discover(client, query, limit = 10) {
  // Discovery ページに遷移
  const { Page } = client;
  await Page.enable();

  const currentUrl = await evaluate(client, 'location.href');
  if (!currentUrl.includes('discord.com/discovery')) {
    await Page.navigate({ url: 'https://discord.com/discovery/servers' });
    await sleep(2000);
  }

  if (query) {
    // 検索欄をフォーカス
    await evaluate(client, `
      document.querySelector('input[aria-label="検索"], input[placeholder="検索"], input[type="text"]').focus();
    `);
    await sleep(300);

    // 既存の値を1文字ずつ Backspace で削除 (Cmd+Aが効かないため)
    const existingValue = await evaluate(client, `
      document.querySelector('input[aria-label="検索"], input[placeholder="検索"], input[type="text"]').value || ''
    `);
    for (let i = 0; i < existingValue.length; i++) {
      await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await sleep(20);
    }
    await sleep(200);

    await typeText(client, query);
    await sleep(300);
    await pressEnter(client);
    await sleep(2500);
  }

  // サーバーカード取得
  const result = await evaluate(client, `
    (function() {
      var cards = document.querySelectorAll('[class*="card__84e3e"]');
      var out = [];
      for (var i = 0; i < Math.min(cards.length, ${limit}); i++) {
        var c = cards[i];
        var h2 = c.querySelector('h2');
        var details = c.querySelector('[class*="guildDetails"]');
        var verified = !!c.querySelector('[class*="verified"]');
        var partnered = !!c.querySelector('[class*="partnered"]');
        out.push({
          index: i,
          name: h2 ? h2.textContent.trim() : '',
          fullText: details ? details.textContent.trim() : '',
          verified: verified,
          partnered: partnered,
        });
      }
      return JSON.stringify(out);
    })()
  `);

  const servers = JSON.parse(result).map(s => {
    const parsed = parseServerCard(s.fullText, s.name);
    return {
      index: s.index,
      name: s.name,
      description: parsed.description,
      online: parsed.online,
      members: parsed.members,
      verified: s.verified,
      partnered: s.partnered,
    };
  });

  console.log(`🔍 ${servers.length} servers${query ? ` for "${query}"` : ''}:`);
  servers.forEach(s => {
    const badges = [s.verified ? '✅' : '', s.partnered ? '🤝' : ''].filter(Boolean).join('');
    console.log(`  [${s.index}] ${badges} ${s.name}`);
    console.log(`       ${s.description.slice(0, 80)}`);
    if (s.online || s.members) {
      console.log(`       🟢${s.online || '?'} online | 👥${s.members || '?'} members`);
    }
  });
  return servers;
}

async function joinServer(client, index = 0) {
  // Discovery上のサーバーカードをクリックして詳細ページに遷移
  await evaluate(client, `
    (function() {
      var cards = document.querySelectorAll('[class*="card__84e3e"]');
      if (cards[${index}]) cards[${index}].click();
    })()
  `);
  await sleep(2000);

  // 参加ボタンを探してクリック（まだ参加してない場合）
  const result = await evaluate(client, `
    (function() {
      // サーバー名取得
      var name = '';
      var h1 = document.querySelector('h1, [class*="guildName"], [class*="name"]');
      if (h1) name = h1.textContent.trim().substring(0, 60);

      // 参加ボタン
      var btns = document.querySelectorAll('button');
      var joinBtn = null;
      for (var i = 0; i < btns.length; i++) {
        var txt = btns[i].textContent.trim();
        if (txt === 'サーバーに参加' || txt === 'Join Server' || txt === '参加') {
          joinBtn = btns[i];
          break;
        }
      }
      if (joinBtn) {
        joinBtn.click();
        return JSON.stringify({ ok: true, name: name, action: 'joined' });
      }
      // 既に参加済み
      return JSON.stringify({ ok: true, name: name, action: 'already_joined' });
    })()
  `);
  const res = JSON.parse(result);
  if (res.action === 'joined') {
    console.log(`✅ joined: ${res.name}`);
  } else {
    console.log(`ℹ️  already in: ${res.name}`);
  }
  return res;
}

// スクロールコンテナをmouseWheelで最下部までスクロール
// (Discord のオンボーディングはscrollTopの直接セットでは「読了」判定が発火しないため物理スクロールが必要)
async function scrollToBottom(client, selector = '[class*="scrollerContent"]') {
  const pos = await evaluate(client, `
    (function() {
      var el = document.querySelector('${selector}');
      if (!el) return JSON.stringify({ error: 'not_found' });
      var r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
    })()
  `);
  const data = JSON.parse(pos);
  if (data.error) return false;

  const steps = Math.max(5, Math.ceil((data.scrollHeight - data.clientHeight) / 200) + 2);
  for (let i = 0; i < steps; i++) {
    await client.Input.dispatchMouseEvent({ type: 'mouseWheel', x: data.x, y: data.y, deltaX: 0, deltaY: 200 });
    await sleep(150);
  }
  return true;
}

// Discord のサーバーオンボーディングを自動完了する
// 1) 目的選択画面: 'Engage with us' を選ぶ (全チャンネルアンロック)
// 2) 次へ押下
// 3) ルール画面をスクロールして読了判定を発火
// 4) 完了 🎉 押下
async function onboard(client) {
  const currentUrl = await evaluate(client, 'location.href');
  if (!currentUrl.includes('/onboarding')) {
    console.log('ℹ️  現在はオンボーディング画面ではありません');
    return { skipped: true };
  }

  console.log('🚀 オンボーディング開始');

  // Step 1: "Engage with us" をクリック
  const step1 = await evaluate(client, `
    (function() {
      var targets = ['Engage with us', '交流する', 'すべてのチャンネルを利用'];
      var all = document.querySelectorAll('label, button, div, [role="button"], [role="option"]');
      for (var i = 0; i < all.length; i++) {
        var tx = all[i].textContent.trim();
        for (var j = 0; j < targets.length; j++) {
          if (tx === targets[j]) { all[i].click(); return JSON.stringify({ ok: true, picked: tx }); }
        }
      }
      return JSON.stringify({ ok: false });
    })()
  `);
  const pick = JSON.parse(step1);
  if (pick.ok) {
    console.log(`  ✓ 目的: "${pick.picked}"`);
  } else {
    console.log('  ⚠️  目的選択肢が見つかりませんでした (既に選択済みかも)');
  }
  await sleep(1000);

  // Step 2: 「次へ」押下
  const step2 = await evaluate(client, `
    (function() {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var tx = btns[i].textContent.trim();
        if ((tx === '次へ' || tx === 'Next' || tx === 'Continue') && !btns[i].disabled) {
          btns[i].click();
          return 'ok';
        }
      }
      return 'not_found';
    })()
  `);
  if (step2 === 'ok') console.log('  ✓ 次へ');
  await sleep(2000);

  // Step 3: ルールをスクロール
  const scrolled = await scrollToBottom(client);
  if (scrolled) console.log('  ✓ ルールをスクロール');
  await sleep(800);

  // Step 4: 完了 🎉 押下
  const step4 = await evaluate(client, `
    (function() {
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var tx = btns[i].textContent.trim();
        if ((tx.indexOf('完了') !== -1 || tx === 'Finish' || tx === 'Complete') && !btns[i].disabled) {
          btns[i].click();
          return 'ok';
        }
      }
      return 'disabled_or_not_found';
    })()
  `);
  if (step4 === 'ok') {
    console.log('  ✓ 完了');
  } else {
    console.log('  ⚠️  完了ボタンがdisabled or 見つかりません (手動で確認してください)');
  }
  await sleep(2500);

  // 結果確認
  const final = await evaluate(client, `
    JSON.stringify({
      url: location.href,
      hasChatList: !!document.querySelector('[data-list-id="chat-messages"]'),
      channels: document.querySelectorAll('[data-dnd-name]').length,
    })
  `);
  const done = JSON.parse(final);
  if (!done.url.includes('/onboarding')) {
    console.log(`✅ オンボーディング完了 (${done.channels} channels accessible)`);
  } else {
    console.log('⚠️  まだオンボーディング画面です:', done.url);
  }
  return done;
}

async function channels(client) {
  const result = await evaluate(client, `
    (function() {
      // チャンネル一覧 — aria-label にチャンネル名が入る
      var items = document.querySelectorAll('[class*="containerDefault"], [data-dnd-name]');
      var out = [];
      items.forEach(function(item, i) {
        var name = item.getAttribute('data-dnd-name') || '';
        var link = item.querySelector('a');
        var href = link ? link.getAttribute('href') : '';
        if (name) {
          out.push({ index: i, name: name, href: href });
        }
      });
      // fallback: aria-label
      if (out.length === 0) {
        document.querySelectorAll('[class*="name_"] [class*="channelName"],' +
          ' [class*="channel-"] a').forEach(function(el, i) {
          out.push({ index: i, name: el.textContent.trim().substring(0, 50), href: '' });
        });
      }
      return JSON.stringify(out);
    })()
  `);
  const chs = JSON.parse(result);
  console.log(`📂 ${chs.length} channels:`);
  chs.forEach(c => {
    console.log(`  [${c.index}] #${c.name}${c.href ? ' → ' + c.href : ''}`);
  });
  return chs;
}

// チャンネルの topic (説明文/ルール) を取得
// ハニーポット系チャンネル(例: "do NOT send a message") の警告文もここに書かれていることが多い
async function topic(client) {
  try {
    await requireState(client, ['in_channel', 'server_no_channel']);
  } catch (e) { return; }
  const result = await evaluate(client, `
    (function() {
      // チャンネルヘッダーの topic
      var topicEl = document.querySelector('[class*="topic_"]');
      var topic = topicEl ? topicEl.textContent.trim() : '';

      // チャンネル名
      var nameEl = document.querySelector('[class*="title_"] h1, [class*="channelName"]')
        || document.querySelector('header h1')
        || document.querySelector('header [class*="title_"]');
      var name = nameEl ? nameEl.textContent.trim() : '';

      // メンバー数 / オンライン数 (あれば)
      return JSON.stringify({
        name: name.substring(0, 80),
        topic: topic.substring(0, 1000),
      });
    })()
  `);
  const data = JSON.parse(result);
  console.log(`📋 #${data.name}`);
  if (data.topic) {
    console.log(`   ${data.topic}`);

    // ハニーポット/禁止系の警告を目立たせる
    const red = /(do NOT send|スパム|spam|禁止|forbidden|banned|honeypot)/i;
    if (red.test(data.topic)) {
      console.log(`\n⚠️  WARNING: このチャンネルに投稿すると問題がある可能性があります`);
    }
  } else {
    console.log(`   (no topic set)`);
  }
  return data;
}

async function messages(client, limit = 20) {
  try {
    await requireState(client, 'in_channel');
  } catch (e) { return; }
  const result = await evaluate(client, `
    (function() {
      var msgs = document.querySelectorAll('[id^="chat-messages-"]');
      var out = [];
      for (var i = Math.max(0, msgs.length - ${limit}); i < msgs.length; i++) {
        var m = msgs[i];
        var author = m.querySelector('[class*="username_"]');
        var content = m.querySelector('[id^="message-content-"]');
        var timestamp = m.querySelector('time');
        out.push({
          index: out.length,
          author: author ? author.textContent.trim() : '',
          text: content ? content.textContent.trim().substring(0, 300) : '',
          time: timestamp ? timestamp.getAttribute('datetime') : '',
        });
      }
      return JSON.stringify(out);
    })()
  `);
  const msgs = JSON.parse(result);
  console.log(`💬 ${msgs.length} messages:`);
  msgs.forEach(m => {
    const time = m.time ? new Date(m.time).toLocaleTimeString() : '';
    console.log(`  [${m.index}] ${m.author} ${time}`);
    if (m.text) console.log(`       ${m.text.slice(0, 100)}`);
  });
  return msgs;
}

async function search(client, query, limit = 10, channelFilter = null) {
  try {
    await requireState(client, 'in_channel');
  } catch (e) { return; }

  // channelFilter が指定されていれば `in:#channel-name` フィルタを付加
  // Discordの検索は "keyword in:channel-name" の形式でチャンネル絞り込みできる
  const fullQuery = channelFilter ? `${query} in:${channelFilter.replace(/^#/, '')}` : query;

  // まず既存の検索をEscで閉じる
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape' });
  await sleep(500);

  // Cmd+F でサーバー内検索を開く
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 4 });
  await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'f', code: 'KeyF', modifiers: 4 });
  await sleep(1000);

  // 既存テキストを Backspace で1文字ずつクリア
  const existingValue = await evaluate(client, `
    (function() {
      var input = document.activeElement;
      return (input && input.value) || '';
    })()
  `);
  for (let i = 0; i < existingValue.length; i++) {
    await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Backspace', code: 'Backspace' });
    await sleep(20);
  }
  await sleep(200);

  await typeText(client, fullQuery);
  await sleep(500);
  await pressEnter(client);
  await sleep(3000);

  // 結果を取得
  const result = await evaluate(client, `
    (function() {
      var panel = document.querySelector('[class*="searchResultsWrap"]');
      if (!panel) return JSON.stringify({ error: 'search panel not found', results: [] });

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
          index: i,
          author: authorEl ? authorEl.textContent.trim() : '',
          text: contentEl ? contentEl.textContent.trim().substring(0, 300) : '',
          time: timeEl ? timeEl.getAttribute('datetime') : '',
        });
      });
      return JSON.stringify({ totalCount: totalCount, results: out });
    })()
  `);
  const data = JSON.parse(result);
  if (data.error) {
    console.error('❌', data.error);
    return data;
  }

  const label = channelFilter ? `"${query}" in #${channelFilter.replace(/^#/, '')}` : `"${query}"`;
  console.log(`🔍 ${data.totalCount} total hits for ${label} (${data.results.length} shown):`);
  data.results.forEach(r => {
    const time = r.time ? new Date(r.time).toLocaleDateString() : '';
    console.log(`  [${r.index}] ${r.author} (${time})`);
    console.log(`       ${r.text.slice(0, 100)}`);
  });

  // Escで検索パネルを閉じる
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape' });

  return data;
}

async function send(client, text) {
  try {
    await requireState(client, 'in_channel');
  } catch (e) { return; }
  // メッセージ入力欄にテキストを入力して送信
  await evaluate(client, `
    (function() {
      var editor = document.querySelector('[role="textbox"][contenteditable="true"]');
      if (editor) editor.focus();
    })()
  `);
  await sleep(200);
  await typeText(client, text);
  await sleep(300);
  await pressEnter(client);
  await sleep(500);
  console.log('✉️  sent:', text.slice(0, 60));
}

// 指定セレクタの要素を物理マウスクリック (.click() では発火しないReactハンドラ対策)
async function physicalClick(client, selectorExpression) {
  const posJson = await evaluate(client, `
    (function() {
      var el = ${selectorExpression};
      if (!el) return JSON.stringify({ error: 'not_found' });
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return JSON.stringify({ error: 'zero_size' });
      return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 });
    })()
  `);
  const pos = JSON.parse(posJson);
  if (pos.error) return { ok: false, error: pos.error };

  await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x: pos.x, y: pos.y });
  await sleep(50);
  await client.Input.dispatchMouseEvent({ type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  return { ok: true, x: pos.x, y: pos.y };
}

// React/Discord向けのクリック: 合成 PointerEvent と MouseEvent を直接要素に dispatch する
// physicalClick では発火しないReactハンドラ (pointer events 依存) 向け
async function reactClick(client, selectorExpression) {
  const result = await evaluate(client, `
    (function() {
      var el = ${selectorExpression};
      if (!el) return JSON.stringify({ error: 'not_found' });
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return JSON.stringify({ error: 'zero_size' });
      var x = r.x + r.width / 2;
      var y = r.y + r.height / 2;

      // pointerover → pointermove → pointerdown → mousedown → pointerup → mouseup → click
      var evtInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons: 1,
        pointerType: 'mouse',
        pointerId: 1,
        isPrimary: true,
      };
      try { el.dispatchEvent(new PointerEvent('pointerover', evtInit)); } catch(e) {}
      try { el.dispatchEvent(new MouseEvent('mouseover', evtInit)); } catch(e) {}
      try { el.dispatchEvent(new PointerEvent('pointermove', evtInit)); } catch(e) {}
      try { el.dispatchEvent(new MouseEvent('mousemove', evtInit)); } catch(e) {}
      try { el.dispatchEvent(new PointerEvent('pointerdown', evtInit)); } catch(e) {}
      try { el.dispatchEvent(new MouseEvent('mousedown', evtInit)); } catch(e) {}
      try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, evtInit, { buttons: 0 }))); } catch(e) {}
      try { el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, evtInit, { buttons: 0 }))); } catch(e) {}
      try { el.dispatchEvent(new MouseEvent('click', Object.assign({}, evtInit, { buttons: 0 }))); } catch(e) {}

      return JSON.stringify({ ok: true, x: x, y: y });
    })()
  `);
  return JSON.parse(result);
}

// 指定ユーザーのプロフィールからDMを開き、メッセージをドラフト入力する
// (送信はしない - 安全のため必ず人間が目視確認してからEnter)
//
// フロー (ユーザー手動操作で観察したもの):
//   1. チャンネル内のそのユーザーのメッセージを探し、アバター要素を物理クリック
//   2. プロフィール popout 内の「その他」ボタン (aria-label="その他") をクリック
//   3. オーバーフローメニューの「プロフィール全体を表示」をクリック
//   4. フルプロフィールモーダル内の「メッセージ」ボタンをクリック
//   5. URL が /channels/@me/<dmChannelId> に変わったのを確認
//   6. DM入力欄 ([role="textbox"][aria-label^="@"]) にテキストをドラフト入力
async function dm(client, targetName, message) {
  if (!targetName) {
    console.error('❌ Usage: dm <user-display-name> [message]');
    return;
  }
  try {
    await requireState(client, 'in_channel');
  } catch (e) { return; }

  // 前の popout/modal が残っていたらEscで閉じる (複数回)
  for (let i = 0; i < 3; i++) {
    await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(200);
  }

  console.log(`🔍 "${targetName}" のメッセージを探しています...`);

  // 対象ユーザーのメッセージ内のアバター要素を見つけて、画面中央にスクロール
  // (そのままだとヘッダーに隠れる可能性がある)
  const found = await evaluate(client, `
    (function() {
      var msgs = document.querySelectorAll('[id^="chat-messages-"]');
      var target = ${JSON.stringify(targetName.toLowerCase())};
      for (var i = 0; i < msgs.length; i++) {
        var u = msgs[i].querySelector('[class*="username_"]');
        var name = u ? u.textContent.trim().toLowerCase() : '';
        if (name === target || name.indexOf(target) !== -1) {
          var av = msgs[i].querySelector('img[class*="avatar"]');
          if (!av) return JSON.stringify({ error: 'avatar_not_found' });
          av.scrollIntoView({ block: 'center', behavior: 'instant' });
          return JSON.stringify({ ok: true, matchedName: name });
        }
      }
      return JSON.stringify({ error: 'user_not_in_channel' });
    })()
  `);
  const foundData = JSON.parse(found);
  if (foundData.error) {
    console.error(`❌ "${targetName}" のメッセージが現在のチャンネルに見つかりません (${foundData.error})`);
    console.error('   このチャンネルに該当ユーザーの発言が必要です');
    return;
  }
  console.log(`  ✓ 発見: ${foundData.matchedName}`);
  await sleep(500); // スクロール反映待ち

  // Step 1: アバターを React向けクリック
  const avatarSelector = `
    (function() {
      var msgs = document.querySelectorAll('[id^="chat-messages-"]');
      var target = ${JSON.stringify(targetName.toLowerCase())};
      for (var i = 0; i < msgs.length; i++) {
        var u = msgs[i].querySelector('[class*="username_"]');
        var name = u ? u.textContent.trim().toLowerCase() : '';
        if (name === target || name.indexOf(target) !== -1) {
          return msgs[i].querySelector('img[class*="avatar"]');
        }
      }
      return null;
    })()
  `;
  const step1 = await reactClick(client, avatarSelector);
  if (!step1.ok) {
    console.error('❌ アバタークリックに失敗:', step1.error);
    return;
  }
  console.log(`  ✓ アバタークリック (${Math.round(step1.x)}, ${Math.round(step1.y)})`);
  await sleep(2000);

  // Step 2: popout の「その他」ボタン (dialog配下限定でメッセージアクションバーと区別)
  // popout の生成を最大5秒待つ
  let step2 = null;
  for (let i = 0; i < 10; i++) {
    step2 = await reactClick(client, `
      (function() {
        var dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return null;
        return dialog.querySelector('[role="button"][aria-label="その他"]')
          || dialog.querySelector('[role="button"][aria-label="More"]')
          || dialog.querySelector('[class*="bannerButton"][role="button"]');
      })()
    `);
    if (step2.ok) break;
    await sleep(500);
  }
  if (!step2 || !step2.ok) {
    // デバッグ用: 今DOMに何があるか
    const debug = await evaluate(client, `
      (function() {
        var popouts = document.querySelectorAll('[class*="userPopout"], [class*="userProfile"], [class*="popout"], [role="dialog"]');
        var btns = [];
        document.querySelectorAll('[role="button"][aria-label]').forEach(function(b) {
          var al = b.getAttribute('aria-label') || '';
          if (al.length < 40) btns.push(al);
        });
        return JSON.stringify({ popouts: popouts.length, ariaLabels: [...new Set(btns)].slice(0, 20) });
      })()
    `);
    console.error('❌ プロフィール popout の「その他」ボタンが見つかりません');
    console.error('   debug:', debug);
    return;
  }
  console.log('  ✓ 「その他」をクリック');
  await sleep(1500);

  // Step 3: オーバーフローメニューの「プロフィール全体を表示」
  // id + text の両方をリトライ
  let step3 = null;
  for (let i = 0; i < 8; i++) {
    step3 = await reactClick(client, `
      (function() {
        // id match
        var byId = document.querySelector('#user-profile-overflow-menu-view-profile');
        if (byId) return byId;
        // text match (複数言語対応)
        var items = document.querySelectorAll('[role="menuitem"]');
        for (var i = 0; i < items.length; i++) {
          var t = items[i].textContent.trim();
          if (t === 'プロフィール全体を表示' || t === 'View Full Profile' || t === 'Ver perfil completo') return items[i];
        }
        return null;
      })()
    `);
    if (step3.ok) break;
    await sleep(500);
  }
  if (!step3 || !step3.ok) {
    // デバッグ: メニュー項目を表示
    const debug = await evaluate(client, `
      (function() {
        var items = [];
        document.querySelectorAll('[role="menuitem"]').forEach(function(m) {
          items.push(m.textContent.trim().substring(0, 40));
        });
        return JSON.stringify({ menuItems: items });
      })()
    `);
    console.error('❌ 「プロフィール全体を表示」メニューが見つかりません');
    console.error('   debug:', debug);
    return;
  }
  console.log('  ✓ 「プロフィール全体を表示」をクリック');
  await sleep(2000);

  // Step 4: フルプロフィール内の「メッセージ」ボタン
  let step4 = null;
  for (let i = 0; i < 8; i++) {
    step4 = await reactClick(client, `
      document.querySelector('button[role="button"][aria-label="メッセージ"], button[role="button"][aria-label="Message"]')
    `);
    if (step4.ok) break;
    await sleep(500);
  }
  if (!step4.ok) {
    console.error('❌ 「メッセージ」ボタンが見つかりません (DM が無効化されている可能性があります)');
    return;
  }
  console.log('  ✓ 「メッセージ」ボタンをクリック');
  await sleep(2500);

  // Step 5: URL が /channels/@me/ に遷移したか確認
  const urlCheck = await evaluate(client, 'location.href');
  if (!urlCheck.includes('/channels/@me/')) {
    console.error('❌ DM への遷移に失敗しました');
    console.error('   current url:', urlCheck);
    return;
  }
  console.log('  ✓ DM へ遷移:', urlCheck);

  // Step 6: DM入力欄にフォーカスしてドラフト入力
  // aria-label は "@<実username> へメッセージを送信" 形式
  const focusRes = await evaluate(client, `
    (function() {
      var editor = document.querySelector('[role="textbox"][aria-label^="@"]');
      if (!editor) return JSON.stringify({ error: 'input_not_found' });
      editor.focus();
      return JSON.stringify({
        ok: true,
        ariaLabel: editor.getAttribute('aria-label'),
      });
    })()
  `);
  const focus = JSON.parse(focusRes);
  if (focus.error) {
    console.error('❌ DM入力欄が見つかりません');
    return;
  }
  console.log(`  ✓ 入力欄にフォーカス: ${focus.ariaLabel}`);

  if (!message) {
    console.log('\nℹ️  ドラフトなし。DM画面を開いた状態で停止しました');
    console.log('   メッセージを送るには: puppet discord dm "' + targetName + '" "<text>"');
    return { opened: true, url: urlCheck, ariaLabel: focus.ariaLabel };
  }

  // テキストをドラフト入力 (送信しない)
  await sleep(300);
  await typeText(client, message);
  await sleep(500);

  const draftCheck = await evaluate(client, `
    (function() {
      var editor = document.querySelector('[role="textbox"][aria-label^="@"]');
      return editor ? editor.textContent.trim().substring(0, 200) : '';
    })()
  `);
  console.log(`\n📝 ドラフト入力完了:`);
  console.log(`   "${draftCheck}"`);
  console.log(`\n⚠️  メッセージはまだ送信されていません。`);
  console.log('   ブラウザで内容を確認し、問題なければ手動で Enter を押すか、');
  console.log('   `puppet discord dm-send` で送信できます (未実装)');

  return { opened: true, drafted: draftCheck, url: urlCheck };
}

async function goto_(client, channelName) {
  // チャンネル名またはインデックスでSPA遷移
  const index = parseInt(channelName);
  const result = await evaluate(client, `
    (function() {
      var items = document.querySelectorAll('[data-dnd-name]');
      var target = null;
      for (var i = 0; i < items.length; i++) {
        var name = items[i].getAttribute('data-dnd-name') || '';
        if (${!isNaN(index)} && i === ${index || 0}) { target = items[i]; break; }
        if (name.toLowerCase().indexOf(${JSON.stringify(String(channelName).toLowerCase())}) !== -1) { target = items[i]; break; }
      }
      if (!target) return JSON.stringify({ error: 'channel not found' });
      var link = target.querySelector('a');
      if (link) { link.click(); return JSON.stringify({ ok: true, name: target.getAttribute('data-dnd-name') }); }
      target.click();
      return JSON.stringify({ ok: true, name: target.getAttribute('data-dnd-name') });
    })()
  `);
  const res = JSON.parse(result);
  if (res.ok) {
    await sleep(2000);
    console.log('📂 switched to:', res.name);
  } else {
    console.error('❌', res.error);
  }
}

async function navigate_(client, path) {
  const { Page } = client;
  await Page.enable();
  const url = path.startsWith('http') ? path : 'https://discord.com' + (path.startsWith('/') ? path : '/' + path);
  await Page.navigate({ url });
  await sleep(2000);
  console.log('🔗 navigated to:', path);
}

async function eval_(client, js) {
  const result = await evaluate(client, js);
  console.log(result);
}

const commands = {
  discover: { fn: (c, args) => discover(c, args[0] || null, parseInt(args[1]) || 10),  usage: 'discover [query] [limit]' },
  join:     { fn: (c, args) => joinServer(c, parseInt(args[0]) || 0),                   usage: 'join [index]' },
  onboard:  { fn: (c, args) => onboard(c),                                              usage: 'onboard (complete server onboarding: pick purpose, scroll rules, finish)' },
  channels: { fn: (c, args) => channels(c),                                             usage: 'channels' },
  goto:     { fn: (c, args) => goto_(c, args.join(' ')),                                 usage: 'goto <channel-name|index>' },
  topic:    { fn: (c, args) => topic(c),                                                 usage: 'topic (read current channel rules/description)' },
  search:   { fn: (c, args) => search(c, args[0], parseInt(args[1]) || 10, args[2] || null), usage: 'search <query> [limit] [channel]' },
  messages: { fn: (c, args) => messages(c, parseInt(args[0]) || 20),                    usage: 'messages [limit]' },
  send:     { fn: (c, args) => send(c, args.join(' ')),                                 usage: 'send <text>' },
  dm:       { fn: (c, args) => dm(c, args[0], args.slice(1).join(' ') || null),          usage: 'dm <display-name> [message]  (draft only, does NOT send)' },
  navigate: { fn: (c, args) => navigate_(c, args.join(' ')),                             usage: 'navigate <path>' },
  eval:     { fn: (c, args) => eval_(c, args.join(' ')),                                 usage: 'eval <js>' },
};

module.exports = { connect, commands };
