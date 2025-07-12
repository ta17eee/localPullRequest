# PR Server

ローカルPRレビューサーバーを起動し、ブラウザでインタラクティブなコードレビューを開始します。

## サーバー起動

!cd pr-review-server && npm install
!cd pr-review-server && npm start &

## ブラウザでレビュー画面を開く

!open http://localhost:8080

## 機能
- 📊 Git diff の可視化
- 💬 行別コメント機能
- ✅ レビューステータス管理
- 📄 Markdownエクスポート
- 🔄 リアルタイム更新

GitHubのPull Requestと同様のインターフェースで、ローカルの変更内容をレビューできます。

$ARGUMENTS