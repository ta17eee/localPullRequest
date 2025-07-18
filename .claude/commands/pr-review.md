# PR Review

PRスタイルでコード変更をレビューし、GitHubのPull Request形式で出力します。

## 変更の概要

!git log --oneline -10

## ファイル変更一覧

!git diff --name-status

## 詳細な変更内容

以下のコード変更を詳細にレビューし、GitHub Pull Requestのような形式で出力してください：

!git diff

### レビュー観点
- コードの品質と可読性
- 潜在的なバグやセキュリティ問題
- パフォーマンスの観点
- ベストプラクティスの遵守
- テストの必要性

### 出力形式
1. **概要** - 変更の目的と影響
2. **主な変更点** - ファイルごとの変更内容
3. **レビューコメント** - 具体的な改善提案
4. **承認/変更要求** - 総合的な判断

$ARGUMENTS