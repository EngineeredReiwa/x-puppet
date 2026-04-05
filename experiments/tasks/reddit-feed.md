# Task A: Reddit feed read

## Goal

r/javascript の最新 10 件を、タイトルと URL を含む一覧で取得する。

## Success criterion

stdout に少なくとも 10 件の投稿情報（タイトル＋URL）が含まれていること。

## R condition command

```
node pupplet.js reddit feed 10 javascript
```

## L condition procedure (LLM が逐次実行する想定)

1. tabs_context_mcp でタブ一覧を取得
2. navigate で https://www.reddit.com/r/javascript に遷移
3. read_page で全ページ構造を取得（accessibility tree）
4. javascript_tool で投稿要素のセレクタを見つける
5. javascript_tool で投稿タイトルとURLを抽出
6. 10件取れているかを検証、足りなければスクロール or 再取得
