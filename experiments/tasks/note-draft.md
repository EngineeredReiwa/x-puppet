# Task B: note.com draft create

## Goal

note.com に新規下書きを作成する。タイトルと本文（h2 見出し 1 つ、太字を含む段落 2 つ）をセットする。

入力元: `experiments/tasks/sample.md`

## Success criterion

1. note.com のエディタに下書きが生成されていること
2. タイトルが "テスト投稿" になっていること
3. 本文に h2 見出しと `<strong>` 要素が少なくとも 1 つずつ含まれていること

## R condition command

```
node puppet.js note post experiments/tasks/sample.md
```

## L condition procedure (LLM が逐次実行する想定)

1. tabs_context_mcp でタブ一覧
2. navigate で https://note.com/notes/new に遷移 → editor.note.com にリダイレクト
3. read_page でエディタ全体の構造を取得
4. javascript_tool で title textarea を特定
5. javascript_tool で title を注入（React _valueTracker 問題に遭遇）
6. javascript_tool で ProseMirror editor を特定
7. 本文を h2, p, strong などに分解して逐次挿入 or paste イベント組み立て
8. 最終状態を検証
