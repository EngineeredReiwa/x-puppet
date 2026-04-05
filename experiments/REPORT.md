# Recipe vs. Low-level DOM: LLM における site-specific 操作の圧縮効果

**実験日**: 2026-04-05
**著者**: EngineeredReiwa
**ツール**: [pupplet](https://github.com/EngineeredReiwa/pupplet)

---

## A. もともとの構想

もともとの pupplet の構想は、"Chrome DevTools Protocol (CDP) を使った便利なブラウザ自動化ツール" という位置づけだった。API キーや新しい Chromium プロセスを立ち上げず、ユーザーが普段使っている Chrome に直接接続して、DOM 操作を行うという点が売りだった。

主な比較対象は Puppeteer や Playwright、あるいは公式 API を使った自動化だった。

## B. なぜ今の構想に変わったか

実装を進める中で、現代のブラウザ自動化の問題は「どのブラウザバックエンドを使うか」ではないことが見えてきた。Playwright も Puppeteer も Chrome DevTools MCP も、ブラウザを動かすだけなら十分に解決している。

本当の問題は、**LLM（あるいは MCP agent）がブラウザを操作するときのコスト構造**にあった。

具体的には以下のような問題が観測された：

1. **サイト UI の再発見コストが毎回かかる**: LLM に低レベルな DOM 操作を任せると、セレクタ探索、要素の構造理解、操作順序の推論を、実行のたびに繰り返すことになる。

2. **コンテキストが急速に消費される**: accessibility tree やページ HTML を LLM のコンテキストに流し込むと、1 操作あたり数 KB〜数百 KB が消える。タスクが複雑になるほど加速度的に悪化する。

3. **脆弱性が指数的に増える**: 個々の DOM 操作に成否があり、エラー分岐も多い。LLM が毎回その場で組み立てた操作フローは、再現性が低い。

4. **サイト固有の落とし穴が多い**: React のコントロールされた input、ProseMirror のような rich editor、cross-origin redirect、Shadow DOM、lazy loading。これらは一般知識では回避できず、サイト別の知識が必要になる。

そこで構想は次のように変わった：

> pupplet は「汎用ブラウザ自動化フレームワーク」ではなく、
> **サイト別の脆くて寿命の短いアクションレシピを、LLM が呼び出せる形に圧縮して共有する仕組み**。

この発想では、LLM は高レベルの意図（「r/javascript の最新10件を読む」「note.com に下書きを作る」）だけを扱い、実際の DOM 操作詳細は recipe 関数の中に閉じ込める。

## C. 今回の仮説

本実験は、この構想を支えるために以下の仮説を検証する：

1. **H1**: site-specific recipe を使うと、LLM の tool call 数は桁違いに少ない
2. **H2**: site-specific recipe を使うと、LLM のコンテキストに流れ込む byte 数は桁違いに少ない
3. **H3**: site-specific recipe を使うと、完了までの時間は短く、成功率は高い
4. **H4**: site-specific recipe を使うと、検証の信頼性が高い

## D. 測定方法

### 比較した 2 条件

| 条件 | 説明 | LLM の役割 |
|------|------|-----------|
| **R (recipe あり)** | `node pupplet.js <platform> <cmd>` を 1 回実行 | 1 tool call で完結 |
| **L (recipe なし)** | CDP Runtime.evaluate 経由で DOM を段階的に探索・操作 | 複数 tool call を逐次発行 |

**browser backend は同一** (Chrome + CDP)。変えているのは「LLM がループする粒度」だけ。

### 3 段階ヒント制度

L 条件では、盲目な LLM が詰まった場合に備えて、事前に設計した 3 段階のヒントを用意した。各ヒントは決められた閾値を超えた時点で自動的に与えられ、その時点のヒントレベルがログに記録される。

#### Task A: Reddit feed
- **Hint 1**: "Reddit has a JSON API via `.json` suffix"
- **Hint 2**: `/r/javascript/.json?limit=10` → `d.data.children[*].data`
- **Hint 3**: 完全なワンライナー

#### Task B: note.com draft
- **Hint 1**: "Editor on editor.note.com. Title is `<textarea>`, body is `.ProseMirror` contenteditable. React controls the textarea."
- **Hint 2**: "React textarea needs nativeSetter + `_valueTracker` reset. ProseMirror accepts `ClipboardEvent` paste with `text/html`."
- **Hint 3**: 完全なコード

### 対象タスク

#### Task A: Reddit feed read
- **目的**: r/javascript の最新 10 件を title + URL で取得
- **成功条件**: 10 件以上の {title, link} が得られること

#### Task B: note.com draft create
- **目的**: 新規下書きを作成。タイトル「テスト投稿」、本文に `<h2>` 1 つと `<strong>` を含む段落 2 つ
- **成功条件**: `textarea[placeholder="記事タイトル"].value === 'テスト投稿'` かつ `.ProseMirror` 内に `h2` ≥ 1 かつ `strong` ≥ 1

### 測定指標

| 指標 | 定義 |
|------|------|
| `tool_calls` | LLM の tool 呼び出し総数 |
| `bytes_in_context` | tool result として LLM に返される総 byte 数 |
| `wall_time_ms` | 開始〜完了の実時間 |
| `dom_inspections` | ページ構造を読んだ回数 |
| `success` | 最終検証を通過したか |
| `hint_level_used` | 成功時点で使われていたヒントレベル (0-3) |

### 試行

各タスク × 各条件 × **3 試行** = 12 run。

## E. 結果

### 集計表

| 条件 | Task | success | 平均 tool_calls | 平均 bytes | 平均 wall_time_ms | hint_level |
|------|------|---------|-----------------|------------|-------------------|------------|
| R | reddit-feed | 3/3 | **1** | **1,333** | 752 | n/a |
| L | reddit-feed | 3/3 | **18** | **10,907** | 14,489 | **1** |
| R | note-draft | 3/3 | **1** | **161** | 11,896 | n/a |
| L | note-draft | 3/3 *(疑義あり)* | **17** | **1,080** | 8,140 | **1** |

### R vs L の倍率

| Task | tool_calls 倍率 | bytes 倍率 | wall_time 倍率 |
|------|-----------------|------------|----------------|
| reddit-feed | **×18** | **×8.2** | **×19.3** |
| note-draft | **×17** | **×6.7** | ×0.68 (L が速い) |

### Hint レベル

| 条件 | Task | 使われたヒント |
|------|------|----------------|
| L | reddit-feed | **Hint 1** (3 試行すべて) |
| L | note-draft | **Hint 1** (3 試行すべて、ただし「成功」の妥当性に疑義) |

どちらのタスクもヒント 1 までで「成功」した。しかしこれはやや誤解を招く結果であり、後述の F で詳しく論じる。

## F. 解釈

### F.1 仮説ごとの評価

**H1 (tool call 削減)**: **強く支持された**

- reddit-feed: R=1 vs L=18 (×18)
- note-draft: R=1 vs L=17 (×17)

Recipe を使うと、LLM の tool call は 1 回で済む。盲目 LLM は、構造探索・セレクタ推定・複数の試行を経て、結局 17-18 回の tool call を消費する。

**H2 (context bytes 削減)**: **支持された**

- reddit-feed: R=1,333B vs L=10,907B (×8.2)
- note-draft: R=161B vs L=1,080B (×6.7)

R 条件では、LLM のコンテキストに流れ込むのは recipe の出力メッセージだけ（成功確認のための数行）。L 条件では、accessibility tree 相当の DOM 情報、要素サンプル、失敗後の状態確認データが繰り返し発生する。

ただし、今回の L 条件の byte 数は**控えめな下限値**であることに注意が必要。実際の MCP browser tool (`read_page` with `filter: all`) は 1 回で 50KB〜500KB の accessibility tree を返すことがあり、本実験のスクリプト実装はそれより遥かに節約されている。つまり、**現実の LLM agent の context 消費はさらに桁違いに悪化する可能性が高い**。

**H3 (時間・成功率)**: **部分的に支持された**

- reddit-feed: R は 19.3 倍速い。L は 4 回のスクロール失敗を経て JSON API への切り替えに至る。
- note-draft: L の方が速いという意外な結果が出たが、これは 2 つの要因による：
  1. R 条件の `pupplet note post` は ProseMirror のロード待ち・navigate 待ちのために固定の sleep を含んでおり、14秒近くを待機時間が占める
  2. L 条件の「成功」は DOM レベル verify だけでしか確認しておらず、後述のとおり実際には React/ProseMirror 内部状態に反映されていない可能性が高い（= 未完の状態で "完了" と判定された）

成功率は両条件とも 3/3 だが、これは L の note-draft については疑義つきである（F.3 参照）。

**H4 (検証の信頼性)**: **予想外の形で強く支持された**

これが今回最も重要な発見である。次の F.2 で詳述する。

### F.2 発見: 盲目 LLM は「成功したと誤認する」

L-note-draft の実行ログを詳細に見ると、非常に興味深い現象が起きていた。

**Step 6**: `textarea.value = 'テスト投稿'` という最もナイーブな代入を実行した。
**Step 7 (verify)**: `textarea.value === 'テスト投稿'` → **true**（一見成功）

**Step 11**: `.ProseMirror.innerHTML = <h2>...` という最もナイーブな代入を実行した。
**Step 12 (verify)**: `.ProseMirror` 内に h2=1, strong=1 → **true**（一見成功）
**Step 13 (verify after 1.5s)**: まだ h2=1, strong=1 → **true**

しかし **step 12 の時点で `textarea.value === ''`** になっていた。innerHTML を代入した副作用で、React が再レンダリングし、以前のタイトル設定が消えている。

つまり、**盲目 LLM は「見かけ上の成功」の連鎖にはまっている**：
1. `t.value = X` → React は値を認識していないが、DOM 読み取りでは X が見える
2. `editor.innerHTML = HTML` → ProseMirror は内部状態を持っていないが、innerHTML 読み取りでは HTML が見える
3. しかし、どちらも **ユーザーが保存ボタンを押したり、フォーカスが外れたりした時点で消える**

recipe なしでこれを検知するには、「保存 → リロード → 再取得」という追加の検証サイクルが必要。そしてそのサイクル自体がさらに tool call を消費する。しかも、保存の仕方がサイト ごとに違うので、サイト固有知識なしで回せない。

結論：**盲目 LLM は単に遅いだけでなく、誤った成功判定に陥りやすい**。

### F.3 Task A と Task B の非対称性

reddit-feed は読み取り系タスク、note-draft は書き込み系タスク。両者で R/L の倍率が似ていた（tool calls で ×17〜18）が、その意味は大きく異なる。

- **reddit-feed (読み取り)**: 失敗パターンが見えやすい。3 件しか posts が取れない時点で明確に「足りない」と判定できる。最終的に正しい答えに辿り着きやすい。
- **note-draft (書き込み)**: 失敗パターンが見えにくい。ナイーブな代入が DOM 読み取り上は成功しているように見えるため、LLM は問題に気づかない。

書き込み系の方が、「見かけ上成功」問題が深刻。これは R が真に強みを発揮する領域。

### F.4 time の逆転現象について

note-draft で L が R より速かった理由を正確に把握しておきたい。

- **R の 11.9秒**: `pupplet note post` 内で (a) 新規タブ作成 → editor.note.com リダイレクト待ち (5s sleep)、(b) ProseMirror ロード待ち (2s sleep)、(c) Page domain enable + Runtime enable + 複数 sleep (合計数秒) を含む。これらは recipe 側が「確実に動くため」に敢えて取っている安全マージン。
- **L の 8.1秒**: L も同じ 5s sleep を取っているが、その後の verify は即座で終わる（= 誤った成功判定のため「追加待ち」が発生しない）。

つまり、L は「待つべきところを待っていないので速いが、実は保存できない」という状態。**time では L が勝っているが、actually-works では R が勝っている**。

### F.5 ヒントが比較的軽くて済んだ理由

Task A は Hint 1（JSON API の存在）だけで即解決した。これは reddit の JSON API が非常に分かりやすく、広く知られているから。一般的な LLM が事前知識で持っている可能性もある（本実験では意図的に「知らない」前提で進めた）。

Task B も Hint 1 で「成功」したが、これは前述の通り verify が浅いため。真面目に保存まで検証したら、Hint 2（React _valueTracker）・Hint 3（ClipboardEvent の specific 構築）が必要になる可能性が高い。これは未検証。

## G. 何が言えて、何がまだ言えないか

### 言えること

1. **LLM の tool call 数は、site-specific recipe を使うことで 17〜18 倍削減できる**（少なくとも本実験の 2 タスクでは）。
2. **context bytes は 7〜8 倍削減できる**（これは控えめな下限値。実際の MCP agent ではもっと大きくなる）。
3. **書き込み系タスクでは、盲目 LLM は「見かけ上の成功」に陥りやすく、検証の信頼性が低い**。これは recipe 化の最も強い論拠。
4. **再現性が異常に高い**。R 条件では 3 試行の wall_time 分散が 3ms 以下（note-draft）という結果。これは decisive な処理フローの証左。
5. **Reddit の lazy loading のような UI の現代的な複雑さは、盲目 LLM を容易に詰まらせる**。JSON API のような裏道の知識がなければ完了できない。

### まだ言えないこと

1. **現実の MCP agent での測定は未実施**。本実験は Node.js スクリプトで LLM の振る舞いをシミュレーションしている。実際の Claude + MCP browser tools では `read_page` 1 回で数十〜数百 KB の accessibility tree が返るため、byte 消費はさらに悪化するはず。これは補足実験の対象。

   **本実験の L 条件の数値は、意図的に「理想的に節約された blind LLM」の下限値**であることに留意。具体的には：
   - ページ読み取りを `innerText.slice(0, 5000)` に絞っている（現実の `read_page` は 100-500KB）
   - 複数の確認を 1 つの eval に batch している（現実の LLM は 1 eval = 1 probe）
   - 4 スクロール失敗で即 Hint を与えている（現実の LLM はもっと粘る）

   つまり、**現実の MCP agent を使った場合、本実験の L の数値は数倍〜数十倍悪化する**と予想される。報告する ×18 tool calls / ×8 bytes は保守的な見積もり。
2. **3 試行は統計的に弱い**。ただし R 条件の wall_time が 3ms 以内に揃うような状況では、分散が極めて小さいので 3 試行でも信頼度は一定程度ある。
3. **Recipe の保守コストは測定していない**。Recipe は DOM 変更で壊れやすく、書き直しが必要になる。この壊れやすさと書き直しコストは、この構想の最大の弱点。本実験ではその点は扱っていない。
4. **他のサイト・他のタスクでの一般化は未検証**。note / reddit の 2 サイトだけの結果。Discord や LinkedIn のような認証フローが複雑なサイトでは、別の傾向が出る可能性がある。
5. **L 条件の「成功」の妥当性**。note-draft については保存→リロード検証まで行っていないため、本当に成功しているかは未確認。疑いが強い。

### この構想の弱点

- **Recipe は脆い**。サイトの UI が変わると壊れる。保守できる仕組み（テスト、早期失敗検出、community maintenance）が前提になる。
- **Recipe のカタログ化が課題**。新しいサイト・新しい操作のたびに書かなければならない。ネットワーク効果がどこで生まれるか、まだ設計の問題。
- **成功検証がやはり site-specific**。recipe 本体だけでなく、「recipe が成功したかどうか」の判定も site-specific な知識が必要。これは recipe の一部として実装できるが、コストは増える。

---

## 付録: 実装と再現

- `experiments/runner.js` — R 条件の測定 wrapper
- `experiments/blind-reddit.js` — L 条件の Task A
- `experiments/blind-note.js` — L 条件の Task B
- `experiments/results/` — 全 12 run の JSON / JSONL ログ
- `experiments/tasks/` — タスク仕様

再現するには:

```bash
# R condition (recipe あり)
for i in 1 2 3; do node experiments/runner.js reddit-feed $i -- reddit feed 10 javascript; done
for i in 1 2 3; do node experiments/runner.js note-draft $i -- note post experiments/tasks/sample.md; done

# L condition (recipe なし blind LLM simulation)
for i in 1 2 3; do node experiments/blind-reddit.js $i; done
for i in 1 2 3; do node experiments/blind-note.js $i; done
```

Chrome を `--remote-debugging-port=9222` で起動し、note.com にログインしていることが前提。
