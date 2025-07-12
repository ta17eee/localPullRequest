# PR Open

PRレビューサーバーが起動していない場合は起動し、ブラウザでレビュー画面を開きます。

## サーバー状態確認とブラウザオープン

!cd pr-review-server && [ ! -d "node_modules" ] && npm install; (curl -s http://localhost:8080 > /dev/null || (npm start > /dev/null 2>&1 &)) && sleep 3 && open http://localhost:8080

これにより以下が実行されます：
1. 依存関係の確認と自動インストール（必要な場合）
2. サーバーの稼働状況をチェック
3. 未起動の場合はバックグラウンドでサーバーを起動
4. ブラウザでレビュー画面を自動オープン

## 使用方法
1. コード変更を行う
2. `/pr-open` を実行
3. ブラウザでPRレビュー画面が開く
4. GitHub風UIでコードレビューを実施

$ARGUMENTS