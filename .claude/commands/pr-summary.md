# PR Summary

現在のブランチの変更内容の概要を、GitHub Pull Requestのサマリー形式で出力します。

## コミット履歴

!git log --oneline --graph -10

## 変更統計

!git diff --stat

## 変更されたファイル

!git diff --name-only

以下の情報をもとに、Pull Requestのサマリーを作成してください：

### 出力形式
1. **What** - 何を変更したか
2. **Why** - なぜ変更したか  
3. **How** - どのように変更したか
4. **Testing** - テスト方法
5. **Breaking Changes** - 破壊的変更があるか

$ARGUMENTS