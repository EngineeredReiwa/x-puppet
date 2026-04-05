# pupplet: Recipe vs Low-level DOM — Measurement Experiment

## 目的

LLM による「低レベル DOM 操作の逐次実行」と、site-specific recipe を呼び出す方式で、
実務上どれだけのコスト差があるかを定量的に示す。

## 仮説

1. Recipe 使用時、LLM の tool call 数は桁違いに少ない
2. Recipe 使用時、LLM のコンテキストに流れ込む byte 数は桁違いに少ない
3. Recipe 使用時、完了までの時間は短く、失敗率は低い
4. Recipe 使用時、同じ操作の再実行で安定性が高い

## 比較条件

| 条件 | 説明 |
|------|------|
| **R (recipe あり)** | `node pupplet.js <platform> <cmd> [args]` で完結。LLM から見て 1 tool call |
| **L (recipe なし)** | MCP browser tools 等で DOM を読み、セレクタを推定し、手続きを逐次組み立てる |

browser backend の比較ではない。両方とも同じ Chrome + CDP を使う。変えるのは
「LLM がループする粒度」だけ。

## 対象タスク

### Task A: Reddit feed read
- r/javascript の最新 10 件を、タイトル + URL で取得

### Task B: note.com draft create
- タイトル「テスト投稿」+ 本文（h2 見出し 1 つ、太字を含む段落 2 つ）の下書きを新規作成

## 測定指標

| 指標 | 定義 |
|------|------|
| `tool_calls` | LLM の tool 呼び出し総数 |
| `bytes_in_context` | tool result として LLM に返される総 byte 数 |
| `wall_time_ms` | 開始 ~ 完了の実時間 |
| `dom_inspections` | ページ構造を読んだ回数（accessibility tree / read_page / JS eval の getters） |
| `retries` | 失敗後の再試行回数 |
| `success` | 最終的にタスクが成功したか |
| `failure_reason` | 失敗理由の分類 |

## 試行

各タスク × 各条件 × **3 試行** = 12 run

## 結果

`results/` 配下に JSON Lines 形式で保存。

## レポート

`REPORT.md` を参照。
