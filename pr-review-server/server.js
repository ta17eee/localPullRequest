const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Git インスタンス
const git = simpleGit(process.cwd());

// ミドルウェア
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// データファイルのパス
const DATA_DIR = './data';
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');
const REVIEW_FILE = path.join(DATA_DIR, 'review.json');

// データディレクトリを確保
async function ensureDataDir() {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
    }
}

// JSONファイルを読み込み
async function readJsonFile(filePath, defaultValue = null) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return defaultValue;
        }
        throw error;
    }
}

// JSONファイルに書き込み
async function writeJsonFile(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Git diff を取得
app.get('/api/diff', async (req, res) => {
    try {
        // 作業ディレクトリの状態を確認
        const status = await git.status();
        
        if (status.files.length === 0) {
            return res.json({
                success: true,
                diff: '',
                fileStats: [],
                message: 'No changes detected'
            });
        }

        // diff を取得（ステージングエリアと作業ディレクトリの両方）
        const diffCached = await git.diff(['--cached']);
        const diffWorking = await git.diff();
        const combinedDiff = diffCached + '\n' + diffWorking;

        // ファイル統計を取得
        const fileStats = [];
        for (const file of status.files) {
            try {
                const stat = await git.diffSummary([file.path]);
                fileStats.push({
                    path: file.path,
                    status: file.working_dir || file.index,
                    additions: stat.insertions || 0,
                    deletions: stat.deletions || 0
                });
            } catch (error) {
                // 新規ファイルの場合は統計が取れないことがある
                fileStats.push({
                    path: file.path,
                    status: file.working_dir || file.index,
                    additions: 0,
                    deletions: 0
                });
            }
        }

        res.json({
            success: true,
            diff: combinedDiff,
            fileStats: fileStats
        });

    } catch (error) {
        console.error('Git diff error:', error);
        res.json({
            success: false,
            error: error.message,
            diff: '',
            fileStats: []
        });
    }
});

// コメント一覧を取得
app.get('/api/comments', async (req, res) => {
    try {
        await ensureDataDir();
        const comments = await readJsonFile(COMMENTS_FILE, []);
        res.json({
            success: true,
            comments: comments
        });
    } catch (error) {
        console.error('Get comments error:', error);
        res.json({
            success: false,
            error: error.message,
            comments: []
        });
    }
});

// コメントを追加
app.post('/api/comments', async (req, res) => {
    try {
        await ensureDataDir();
        const newComment = req.body;
        
        // バリデーション
        if (!newComment.text || !newComment.fileName || !newComment.lineNumber) {
            return res.json({
                success: false,
                error: 'Required fields missing'
            });
        }
        
        // 範囲コメントの場合の追加バリデーション
        if (newComment.isRange) {
            if (!newComment.endLineNumber || !newComment.lineRange) {
                return res.json({
                    success: false,
                    error: 'Range comment missing required fields'
                });
            }
        }

        const comments = await readJsonFile(COMMENTS_FILE, []);
        comments.push(newComment);
        await writeJsonFile(COMMENTS_FILE, comments);

        res.json({
            success: true,
            comment: newComment
        });

    } catch (error) {
        console.error('Add comment error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// コメントを削除
app.delete('/api/comments/:id', async (req, res) => {
    try {
        await ensureDataDir();
        const commentId = req.params.id;
        
        const comments = await readJsonFile(COMMENTS_FILE, []);
        const filteredComments = comments.filter(comment => comment.id !== commentId);
        
        if (comments.length === filteredComments.length) {
            return res.json({
                success: false,
                error: 'Comment not found'
            });
        }

        await writeJsonFile(COMMENTS_FILE, filteredComments);

        res.json({
            success: true
        });

    } catch (error) {
        console.error('Delete comment error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// レビューデータを取得
app.get('/api/review', async (req, res) => {
    try {
        await ensureDataDir();
        const review = await readJsonFile(REVIEW_FILE, null);
        res.json({
            success: true,
            review: review
        });
    } catch (error) {
        console.error('Get review error:', error);
        res.json({
            success: false,
            error: error.message,
            review: null
        });
    }
});

// レビューデータを保存
app.post('/api/review', async (req, res) => {
    try {
        await ensureDataDir();
        const reviewData = req.body;
        await writeJsonFile(REVIEW_FILE, reviewData);

        res.json({
            success: true
        });

    } catch (error) {
        console.error('Save review error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// レビューをMarkdown形式でエクスポート
app.get('/api/export', async (req, res) => {
    try {
        await ensureDataDir();
        
        const review = await readJsonFile(REVIEW_FILE, {});
        const comments = await readJsonFile(COMMENTS_FILE, []);
        
        // Git情報を取得
        const status = await git.status();
        const log = await git.log({ maxCount: 5 });
        
        // Markdownを生成
        const markdown = generateMarkdownReport(review, comments, status, log);
        
        res.json({
            success: true,
            markdown: markdown
        });

    } catch (error) {
        console.error('Export error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// Claude Code用の修正指示を取得
app.get('/api/claude-instructions', async (req, res) => {
    try {
        await ensureDataDir();
        
        const review = await readJsonFile(REVIEW_FILE, {});
        const comments = await readJsonFile(COMMENTS_FILE, []);
        
        // 修正が必要なコメントのみフィルタリング
        const fixableComments = comments.filter(comment => 
            comment.type === 'suggestion' || comment.type === 'issue'
        );
        
        if (fixableComments.length === 0) {
            return res.json({
                success: true,
                hasInstructions: false,
                message: 'No fixable comments found'
            });
        }
        
        // ファイル別にコメントを整理
        const instructionsByFile = {};
        fixableComments.forEach(comment => {
            if (!instructionsByFile[comment.fileName]) {
                instructionsByFile[comment.fileName] = [];
            }
            const instruction = {
                line: comment.lineNumber,
                type: comment.type,
                instruction: comment.text,
                priority: comment.type === 'issue' ? 'high' : 'medium'
            };
            
            // 範囲コメントの場合は追加情報を含める
            if (comment.isRange && comment.endLineNumber) {
                instruction.endLine = comment.endLineNumber;
                instruction.isRange = true;
            }
            
            instructionsByFile[comment.fileName].push(instruction);
        });
        
        // 修正指示を生成
        const instructions = generateClaudeInstructions(review, instructionsByFile);
        
        res.json({
            success: true,
            hasInstructions: true,
            instructions: instructions,
            fileCount: Object.keys(instructionsByFile).length,
            commentCount: fixableComments.length
        });

    } catch (error) {
        console.error('Claude instructions error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// Markdownレポートを生成
function generateMarkdownReport(review, comments, gitStatus, gitLog) {
    const date = new Date().toLocaleDateString();
    const statusEmoji = {
        pending: '🟡',
        approved: '✅',
        changes_requested: '❌'
    };
    
    let markdown = `# PR Review Report\n\n`;
    markdown += `**Date:** ${date}\n`;
    markdown += `**Status:** ${statusEmoji[review.status] || '🟡'} ${review.status || 'pending'}\n\n`;
    
    // サマリー
    if (review.summary) {
        markdown += `## Summary\n\n${review.summary}\n\n`;
    }
    
    // 変更されたファイル
    markdown += `## Changed Files\n\n`;
    if (gitStatus.files.length > 0) {
        gitStatus.files.forEach(file => {
            const status = file.working_dir || file.index;
            const statusSymbol = {
                'M': '📝',
                'A': '➕',
                'D': '➖',
                'R': '🔄',
                '?': '❓'
            };
            markdown += `- ${statusSymbol[status] || '📄'} \`${file.path}\`\n`;
        });
    } else {
        markdown += `No files changed.\n`;
    }
    markdown += `\n`;
    
    // コメント
    if (comments.length > 0) {
        markdown += `## Review Comments\n\n`;
        
        const commentsByFile = {};
        comments.forEach(comment => {
            if (!commentsByFile[comment.fileName]) {
                commentsByFile[comment.fileName] = [];
            }
            commentsByFile[comment.fileName].push(comment);
        });
        
        Object.keys(commentsByFile).forEach(fileName => {
            markdown += `### 📁 ${fileName}\n\n`;
            commentsByFile[fileName].forEach(comment => {
                const typeEmoji = {
                    suggestion: '💡',
                    issue: '⚠️',
                    question: '❓',
                    praise: '👍'
                };
                // 範囲コメントかどうかで表示を変える
                const lineDisplay = comment.isRange && comment.endLineNumber ? 
                    `Lines ${comment.lineNumber}-${comment.endLineNumber}` : 
                    `Line ${comment.lineNumber}`;
                    
                markdown += `#### ${lineDisplay} - ${typeEmoji[comment.type]} ${comment.type}\n\n`;
                markdown += `${comment.text}\n\n`;
            });
        });
    }
    
    // 最近のコミット
    if (gitLog.latest) {
        markdown += `## Recent Commits\n\n`;
        gitLog.all.slice(0, 5).forEach(commit => {
            const date = new Date(commit.date).toLocaleDateString();
            markdown += `- **${commit.hash.substring(0, 7)}** ${commit.message} _(${date})_\n`;
        });
        markdown += `\n`;
    }
    
    markdown += `---\n`;
    markdown += `*Generated by PR Review Server on ${new Date().toLocaleString()}*\n`;
    
    return markdown;
}

// Claude Code用の修正指示を生成
function generateClaudeInstructions(review, instructionsByFile) {
    let instructions = `# Code Review Fixes

Based on the PR review feedback, please apply the following fixes:

## Review Status: ${review.status || 'pending'}
`;

    if (review.summary) {
        instructions += `\n## Review Summary\n${review.summary}\n`;
    }

    instructions += `\n## Files to Fix\n\n`;

    Object.keys(instructionsByFile).forEach(fileName => {
        instructions += `### 📁 ${fileName}\n\n`;
        
        // 優先度順にソート (issue -> suggestion)
        const sortedInstructions = instructionsByFile[fileName].sort((a, b) => {
            if (a.priority === 'high' && b.priority !== 'high') return -1;
            if (a.priority !== 'high' && b.priority === 'high') return 1;
            return a.line - b.line;
        });
        
        sortedInstructions.forEach((item) => {
            const priorityEmoji = item.priority === 'high' ? '🚨' : '💡';
            const typeLabel = item.type === 'issue' ? 'Fix Issue' : 'Implement Suggestion';
            
            // 範囲コメントかどうかで表示を変える
            const lineDisplay = item.isRange && item.endLine ? 
                `Lines ${item.line}-${item.endLine}` : 
                `Line ${item.line}`;
            
            instructions += `#### ${priorityEmoji} ${typeLabel} (${lineDisplay})\n\n`;
            instructions += `${item.instruction}\n\n`;
        });
    });

    instructions += `## Instructions for Claude Code

Please review the code in the files mentioned above and apply the necessary fixes based on the review comments. Focus on:

1. **High Priority Issues** 🚨 - Fix bugs and critical problems first
2. **Suggestions** 💡 - Implement improvements and optimizations
3. **Code Quality** - Ensure all changes maintain code readability and follow best practices

After making changes, please run any available linting and testing commands to verify the fixes.
`;

    return instructions;
}

// ルートパス
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// サーバー起動
app.listen(PORT, () => {
    console.log(`\n🚀 PR Review Server is running!`);
    console.log(`📱 Open your browser: http://localhost:${PORT}`);
    console.log(`📂 Working directory: ${process.cwd()}`);
    console.log(`⏰ Started at: ${new Date().toLocaleString()}\n`);
    
    // 初期化
    ensureDataDir().catch(console.error);
});

// エラーハンドリング
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;