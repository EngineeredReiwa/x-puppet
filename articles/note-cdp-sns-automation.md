# APIに月$100払うな。SNS自動化うまく行ってる？無料で超効率的にやる方法

## SNS自動化、金かかりすぎ問題

X（旧Twitter）のAPIが有料化された。月$100のBasicプランでも、ツイート投稿やタイムライン取得に制限がある。

Reddit APIもレート制限が厳しくなった。Discord Botはサーバーの認証が必要。

「自動でいいねしたい」「タイムラインを読み取りたい」「複数のSNSを効率よく回したい」

たったこれだけのことに、なぜ毎月お金を払わなきゃいけないのか。

## 発想の転換：APIを使わなければいい

ちょっと考えてみてほしい。

あなたは毎日、Chromeを開いて、手動でXを見て、いいねして、ツイートしている。

**その操作を、プログラムから自動でやれたら？**

ブラウザはすでにログイン済み。認証もセッションも全部ある。APIキーなんていらない。

これを実現するのが **CDP（Chrome DevTools Protocol）** だ。

## CDPとは何か

CDPは、Chromeに組み込まれたデバッグ用のプロトコル。DevTools（F12で開くやつ）が内部で使っているのと同じ仕組みだ。

Chromeを特別なオプション付きで起動するだけで、外部のプログラムからChromeを操作できるようになる。

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.pupplet-chrome"
```

これだけ。あとはNode.jsからJavaScriptを実行して、ページ上のボタンをクリックしたり、テキストを読み取ったりできる。

## Puppeteerとは違うの？

Puppeteerを知っている人は「それPuppeteerじゃん」と思うかもしれない。

違う。

| | Puppeteer | CDP直接操作 |
|---|---|---|
| ブラウザ | **新しいChromiumを起動** | **今使ってるChromeを操作** |
| ログイン | 毎回クッキー管理が必要 | **すでにログイン済み** |
| 検出リスク | ステルスプラグインが必要 | **あなた自身がユーザー** |
| 依存パッケージ | 35個以上 | **1個だけ** |

Puppeteerは「新しいブラウザを立ち上げて操作する」ツール。

CDPを直接使えば「今開いているChromeをそのまま操作する」ことができる。ログイン不要。検出リスクなし。依存パッケージ1個。

## 実際にやってみる

この仕組みを使って、OSSツール **pupplet** を作った。

https://github.com/EngineeredReiwa/pupplet

### インストール

```bash
git clone https://github.com/EngineeredReiwa/pupplet.git
cd pupplet
npm install
```

依存パッケージは `chrome-remote-interface` の1個だけ。

### Xでタイムラインを読む

```bash
node pupplet.js x timeline 5
```

ログイン済みのChromeから、タイムラインの最新5件を取得する。APIキーは不要。

### Xでツイートする

```bash
node pupplet.js x tweet "Hello from pupplet!"
```

投稿ボタンをクリックして、テキストを入力して、送信する。あなたが手でやっていることと全く同じ操作を自動でやる。

### Redditのフィードを読む

```bash
node pupplet.js reddit feed 20 javascript
```

r/javascript の最新20件を取得。RedditはJSON APIとDOMのハイブリッドで動作する。

### Discordでメッセージを送る

```bash
node pupplet.js discord messages 20
node pupplet.js discord send "Hey everyone!"
```

X、Reddit、Discord、note.com。全部同じ仕組みで動く。

## 技術的に何をやっているか

中身はシンプルだ。

**1. Chromeに接続する**

```js
const CDP = require('chrome-remote-interface');
const client = await CDP({ port: 9222 });
```

ポート9222で待っているChromeに接続する。

**2. タブを探す**

```js
const targets = await CDP.List({ port: 9222 });
const tab = targets.find(t => t.url.includes('x.com'));
```

開いているタブの中から、対象のサイトを見つける。

**3. JavaScriptを実行する**

```js
const result = await Runtime.evaluate({
  expression: `document.querySelectorAll('[data-testid="tweet"]').length`,
  returnByValue: true
});
```

ページ上でJavaScriptを実行して、DOM要素を読み取る。いいねボタンをクリックするのも、テキストを入力するのも、全部これ。

DevToolsのコンソールで手打ちしていることを、プログラムから自動でやっているだけだ。

## プラットフォームの追加が簡単すぎる

puppletの設計で一番こだわったのは「新しいSNSを追加するのが簡単」ということ。

新しいプラットフォームを追加するのに必要なのは、たった2ステップ：

**1. プラットフォームファイルを作る（~100行）**

```js
// platforms/yoursite.js
const { connectToTab, evaluate } = require('../core/cdp');

async function connect() {
  return await connectToTab('yoursite.com');
}

const commands = {
  async feed({ Runtime }, limit = 10) {
    return evaluate(Runtime, `/* DOM読み取り */`);
  },
  async like({ Runtime }, index = 0) {
    return evaluate(Runtime, `/* ボタンクリック */`);
  }
};

module.exports = { connect, commands };
```

**2. ルーターに1行追加する**

```js
yoursite: () => require('./platforms/yoursite'),
```

これだけ。YouTube、Instagram、LinkedIn、Bluesky... 何でも同じパターンで追加できる。

## OSSとして公開中

puppletはMITライセンスのOSSとして公開している。

https://github.com/EngineeredReiwa/pupplet

現在サポートしているプラットフォーム：

| Platform | Read | Actions |
|----------|------|---------|
| X / Twitter | Timeline, search, profile | Tweet, like, reply, follow |
| Reddit | Feed, search, comments | Upvote, downvote, comment |
| Discord | Servers, channels, messages | Join, send messages |
| note.com | Feed, search | Suki (like) |

**PRは大歓迎。** 新しいプラットフォームの追加、新しいコマンドの追加、バグ修正、何でも。

`good first issue` ラベル付きのIssueも用意してある。YouTube、Instagram、LinkedIn、Bluesky、Mastodon、TikTokのプラットフォーム追加が待っている。

## まとめ

- SNS自動化にAPIは不要。CDPで十分
- ログイン済みのChromeをそのまま操作するから、認証もセッション管理も不要
- 依存パッケージ1個。セットアップ30秒
- OSSだから、自分の欲しい機能は自分で（or PRで）追加できる

APIに月$100払い続けるか、CDPで無料でやるか。選ぶのはあなただ。

---

**pupplet** - Multi-platform social media automation via Chrome DevTools Protocol

GitHub: https://github.com/EngineeredReiwa/pupplet

Created by [@EngineeredReiwa](https://x.com/EngineeredReiwa)
