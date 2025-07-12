# PR Stop

PRレビューサーバーを停止します。

## サーバー停止

!pkill -f "node.*server.js" || echo "PRサーバーは既に停止しています"

## 実行内容
- Node.js サーバープロセスを終了
- ポート8080を解放
- バックグラウンドプロセスをクリーンアップ

サーバーを再起動したい場合は `/pr-server` または `/pr-open` を使用してください。

$ARGUMENTS