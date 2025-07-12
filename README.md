# Claude Code Local PR Review System

GitHubのPull Requestのような形式でローカルコード変更をレビューできるWebアプリケーションです。

## 📋 機能

### ✨ 主要機能
- **Git Diff可視化** - diff2htmlによる美しい差分表示
- **インタラクティブレビュー** - 行別コメント機能
- **GitHub風UI** - 馴染みのあるインターフェース
- **レビューステータス管理** - 承認/変更要求/保留
- **Markdownエクスポート** - レビュー結果の出力
- **リアルタイム更新** - 変更内容の即座反映

### 🔧 技術スタック
- **Backend**: Node.js + Express
- **Frontend**: HTML5 + Bootstrap 5 + Vanilla JavaScript
- **Git Integration**: simple-git
- **Diff Rendering**: diff2html.js

## 🚀 スラッシュコマンド

### `/pr-server`
PRレビューサーバーを起動します
```bash
/pr-server
```

### `/pr-open` 
サーバー起動 + ブラウザでレビュー画面を開きます
```bash
/pr-open
```

### `/pr-stop`
PRレビューサーバーを停止します
```bash
/pr-stop
```

### 従来のレビューコマンド
- `/pr-review` - GitHub PR形式のテキストレビュー
- `/pr-summary` - 変更サマリー生成
- `/pr-files` - ファイル別詳細レビュー

## 📁 プロジェクト構造

```
claudeCodeLocalPR/
├── .claude/
│   ├── commands/           # スラッシュコマンド定義
│   │   ├── pr-server.md   # サーバー起動
│   │   ├── pr-open.md     # ブラウザ開く
│   │   ├── pr-stop.md     # サーバー停止
│   │   ├── pr-review.md   # テキストレビュー
│   │   ├── pr-summary.md  # サマリー生成
│   │   └── pr-files.md    # ファイル別レビュー
│   └── settings.local.json # 権限設定
├── pr-review-server/       # Webアプリケーション
│   ├── server.js          # Express サーバー
│   ├── package.json       # 依存関係
│   ├── public/            # フロントエンド
│   │   ├── index.html     # メインUI
│   │   ├── styles.css     # GitHub風スタイル
│   │   └── app.js         # JavaScript機能
│   └── data/              # レビューデータ保存
│       ├── comments.json  # コメントデータ
│       └── review.json    # レビューステータス
└── README.md
```

## 🎯 使用手順

1. **コード変更を行う**
   ```bash
   # ファイルを編集
   echo "console.log('Hello World');" > test.js
   ```

2. **PRレビューを開始**
   ```bash
   /pr-open
   ```

3. **ブラウザでレビュー実施**
   - http://localhost:8080 が自動で開く
   - 差分を確認
   - 行別コメントを追加
   - レビューステータスを設定

4. **レビュー結果をエクスポート**
   - ブラウザ内の「Export」ボタンクリック
   - Markdownファイルがダウンロード

## 🔧 セットアップ

初回実行時に自動でセットアップされますが、手動で行う場合：

```bash
cd pr-review-server
npm install
npm start
```

サーバーは http://localhost:8080 で起動します。

## 📊 レビューワークフロー

1. **差分表示** - Unified/Split ビューで変更確認
2. **ファイルナビゲーション** - サイドバーで変更ファイル一覧
3. **コメント追加** - 行の💬ボタンでコメント追加
4. **レビューステータス** - 承認/変更要求/保留を設定
5. **サマリー作成** - 全体的なフィードバックを記述
6. **エクスポート** - レビュー結果をMarkdown形式で出力

## 🎨 UI機能

- **レスポンシブデザイン** - モバイル対応
- **ダークモードサポート** - GitHub風テーマ
- **キーボードショートカット** - 効率的な操作
- **トーストメッセージ** - 操作フィードバック
- **リアルタイム更新** - 自動リフレッシュ

## 📈 今後の拡張予定

- WebSocketによるリアルタイム同期
- 複数ブランチ対応
- コミット単位のレビュー
- チーム機能とユーザー管理
- Slackとの連携
- VS Code拡張機能

---

🤖 Generated with [Claude Code](https://claude.ai/code)