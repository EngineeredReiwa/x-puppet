const CDP = require('chrome-remote-interface');

const CDP_PORT = parseInt(process.env.CDP_PORT || '9222');

async function enableClient(client) {
  await client.Runtime.enable();
  // ウィンドウが背面でもキーイベント等を処理できるようにする
  // (CDPから送るdispatchKeyEventがReact制御inputに届かない問題の対策)
  try {
    await client.Emulation.setFocusEmulationEnabled({ enabled: true });
  } catch (e) {
    // Emulationドメインが使えない環境は無視
  }
}

async function connectToTab(urlPattern) {
  const targets = await CDP.List({ port: CDP_PORT });
  const target = targets.find(t => t.url.includes(urlPattern) && t.type === 'page');

  if (target) {
    const client = await CDP({ port: CDP_PORT, target });
    await enableClient(client);
    return client;
  }

  // タブが見つからなければ新規作成
  const tmp = await CDP({ port: CDP_PORT });
  const url = urlPattern.includes('://') ? urlPattern : `https://${urlPattern}`;
  await tmp.Target.createTarget({ url });
  await sleep(3000);

  const targets2 = await CDP.List({ port: CDP_PORT });
  const target2 = targets2.find(t => t.url.includes(urlPattern) && t.type === 'page');
  if (target2) {
    await tmp.close();
    const client = await CDP({ port: CDP_PORT, target: target2 });
    await enableClient(client);
    return client;
  }

  await enableClient(tmp);
  return tmp;
}

async function evaluate(client, expression) {
  const result = await client.Runtime.evaluate({
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'JS evaluation error');
  }
  return result.result.value;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { connectToTab, evaluate, sleep, CDP_PORT };
