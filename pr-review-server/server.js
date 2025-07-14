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
const OVERALL_REVIEWS_FILE = path.join(DATA_DIR, 'overall-reviews.json');

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

        // 全体の差分統計を取得
        let totalAdditions = 0;
        let totalDeletions = 0;
        let fileStats = [];
        
        try {
            // ステージング済みとワーキングディレクトリの統計を両方取得
            const statCached = await git.diffSummary(['--cached']);
            const statWorking = await git.diffSummary();
            
            // ファイル別統計を作成
            const fileStatsMap = new Map();
            
            // ステージング済みの統計をマップに追加
            if (statCached && statCached.files) {
                statCached.files.forEach(fileStat => {
                    fileStatsMap.set(fileStat.file, {
                        path: fileStat.file,
                        status: 'staged',
                        additions: fileStat.insertions || 0,
                        deletions: fileStat.deletions || 0
                    });
                });
            }
            
            // ワーキングディレクトリの統計をマージ
            if (statWorking && statWorking.files) {
                statWorking.files.forEach(fileStat => {
                    const existing = fileStatsMap.get(fileStat.file);
                    if (existing) {
                        existing.additions += fileStat.insertions || 0;
                        existing.deletions += fileStat.deletions || 0;
                        existing.status = 'modified';
                    } else {
                        fileStatsMap.set(fileStat.file, {
                            path: fileStat.file,
                            status: 'unstaged',
                            additions: fileStat.insertions || 0,
                            deletions: fileStat.deletions || 0
                        });
                    }
                });
            }
            
            // status.filesから確実にすべてのファイルを含める
            status.files.forEach(file => {
                if (!fileStatsMap.has(file.path)) {
                    fileStatsMap.set(file.path, {
                        path: file.path,
                        status: file.working_dir || file.index,
                        additions: 0,
                        deletions: 0
                    });
                }
            });
            
            // 配列に変換し、合計を計算
            fileStats = Array.from(fileStatsMap.values());
            totalAdditions = fileStats.reduce((sum, file) => sum + file.additions, 0);
            totalDeletions = fileStats.reduce((sum, file) => sum + file.deletions, 0);
            
        } catch (error) {
            console.error('Diff summary error:', error);
            // フォールバック：基本情報のみ
            fileStats = status.files.map(file => ({
                path: file.path,
                status: file.working_dir || file.index,
                additions: 0,
                deletions: 0
            }));
        }

        // 差分の要約を生成
        const summary = generateDiffSummary(fileStats, totalAdditions, totalDeletions, combinedDiff);

        res.json({
            success: true,
            diff: combinedDiff,
            fileStats: fileStats,
            summary: summary
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

// 全体レビューを取得
app.get('/api/overall-reviews', async (req, res) => {
    try {
        await ensureDataDir();
        const reviews = await readJsonFile(OVERALL_REVIEWS_FILE, []);
        res.json({
            success: true,
            reviews: reviews
        });
    } catch (error) {
        console.error('Get overall reviews error:', error);
        res.json({
            success: false,
            error: error.message,
            reviews: []
        });
    }
});

// 全体レビューを追加
app.post('/api/overall-reviews', async (req, res) => {
    try {
        await ensureDataDir();
        const review = req.body;
        
        // バリデーション
        if (!review.title || !review.text) {
            return res.json({
                success: false,
                error: 'Title and text are required'
            });
        }
        
        const reviews = await readJsonFile(OVERALL_REVIEWS_FILE, []);
        reviews.push(review);
        await writeJsonFile(OVERALL_REVIEWS_FILE, reviews);
        
        res.json({
            success: true
        });
    } catch (error) {
        console.error('Add overall review error:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// 全体レビューを削除
app.delete('/api/overall-reviews/:id', async (req, res) => {
    try {
        await ensureDataDir();
        const reviewId = req.params.id;
        
        const reviews = await readJsonFile(OVERALL_REVIEWS_FILE, []);
        const filteredReviews = reviews.filter(r => r.id !== reviewId);
        
        if (reviews.length === filteredReviews.length) {
            return res.json({
                success: false,
                error: 'Review not found'
            });
        }
        
        await writeJsonFile(OVERALL_REVIEWS_FILE, filteredReviews);
        
        res.json({
            success: true
        });
    } catch (error) {
        console.error('Delete overall review error:', error);
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
        const overallReviews = await readJsonFile(OVERALL_REVIEWS_FILE, []);
        
        // Git情報を取得
        const status = await git.status();
        const log = await git.log({ maxCount: 5 });
        
        // Markdownを生成
        const markdown = generateMarkdownReport(review, comments, overallReviews, status, log);
        
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
function generateMarkdownReport(review, comments, overallReviews, gitStatus, gitLog) {
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
    
    // 全体レビュー
    if (overallReviews.length > 0) {
        markdown += `## Overall Diff Reviews\n\n`;
        
        // 優先度でソート
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const sortedReviews = [...overallReviews].sort((a, b) => 
            priorityOrder[a.priority] - priorityOrder[b.priority]
        );
        
        sortedReviews.forEach(review => {
            const typeEmoji = {
                general: '📝',
                architecture: '🏗️',
                performance: '⚡',
                security: '🔒',
                testing: '🧪',
                documentation: '📚'
            };
            const priorityEmoji = {
                low: '🟢',
                medium: '🟡',
                high: '🔴',
                critical: '🚨'
            };
            
            markdown += `### ${typeEmoji[review.type] || '📝'} ${review.title}\n`;
            markdown += `**Type:** ${review.type} | **Priority:** ${priorityEmoji[review.priority]} ${review.priority}\n`;
            markdown += `**Date:** ${new Date(review.timestamp).toLocaleString()}\n\n`;
            markdown += `${review.text}\n\n`;
            markdown += `---\n\n`;
        });
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

// 差分の要約を生成
function generateDiffSummary(fileStats, totalAdditions, totalDeletions, diffContent) {
    const summary = {
        totalFiles: fileStats.length,
        totalAdditions: totalAdditions,
        totalDeletions: totalDeletions,
        fileTypes: {},
        changeTypes: {
            added: 0,
            modified: 0,
            deleted: 0,
            renamed: 0
        },
        mainChanges: [],
        estimatedImpact: 'low' // low, medium, high
    };

    // ファイルタイプと変更タイプを分析
    fileStats.forEach(file => {
        // ファイル拡張子を取得
        const ext = path.extname(file.path) || 'no-extension';
        summary.fileTypes[ext] = (summary.fileTypes[ext] || 0) + 1;

        // 変更タイプをカウント
        switch (file.status) {
            case 'A':
            case '??':
                summary.changeTypes.added++;
                break;
            case 'M':
                summary.changeTypes.modified++;
                break;
            case 'D':
                summary.changeTypes.deleted++;
                break;
            case 'R':
                summary.changeTypes.renamed++;
                break;
        }
    });

    // 主要な変更を抽出
    const significantFiles = fileStats
        .filter(file => {
            const isSignificant = 
                file.path.includes('package.json') ||
                file.path.includes('config') ||
                file.path.includes('.env') ||
                file.path.includes('schema') ||
                file.path.includes('migration') ||
                (file.additions + file.deletions) > 50;
            return isSignificant;
        })
        .map(file => ({
            path: file.path,
            changes: file.additions + file.deletions,
            type: getFileType(file.path)
        }));

    summary.mainChanges = significantFiles;

    // 影響度を推定
    if (totalAdditions + totalDeletions > 500 || summary.totalFiles > 20) {
        summary.estimatedImpact = 'high';
    } else if (totalAdditions + totalDeletions > 100 || summary.totalFiles > 10) {
        summary.estimatedImpact = 'medium';
    }

    // コードパターンの分析（簡易版）
    const patterns = analyzeDiffPatterns(diffContent);
    summary.patterns = patterns;

    return summary;
}

// ファイルタイプを判定
function getFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const typeMap = {
        '.js': 'JavaScript',
        '.ts': 'TypeScript',
        '.jsx': 'React',
        '.tsx': 'React TypeScript',
        '.json': 'Configuration',
        '.md': 'Documentation',
        '.css': 'Styling',
        '.scss': 'Styling',
        '.html': 'Markup',
        '.py': 'Python',
        '.java': 'Java',
        '.go': 'Go',
        '.rs': 'Rust',
        '.sql': 'Database',
        '.yml': 'Configuration',
        '.yaml': 'Configuration',
        '.env': 'Environment',
        '.gitignore': 'Git',
        '.dockerignore': 'Docker'
    };
    return typeMap[ext] || 'Other';
}

// Diffパターンを分析
function analyzeDiffPatterns(diffContent) {
    const patterns = {
        newFeatures: [],
        refactoring: [],
        bugFixes: [],
        tests: [],
        documentation: []
    };

    // 簡易的なパターンマッチング
    const lines = diffContent.split('\n');
    
    lines.forEach(line => {
        if (line.startsWith('+') && !line.startsWith('+++')) {
            const content = line.substring(1).trim().toLowerCase();
            
            // 新機能の検出
            if (content.includes('function') || content.includes('class') || 
                content.includes('export') || content.includes('async')) {
                patterns.newFeatures.push('New functions or classes added');
            }
            
            // テストの検出
            if (content.includes('test') || content.includes('spec') || 
                content.includes('expect') || content.includes('assert')) {
                patterns.tests.push('Test cases added or modified');
            }
            
            // ドキュメントの検出
            if (content.includes('readme') || content.includes('doc') || 
                content.includes('comment')) {
                patterns.documentation.push('Documentation updates');
            }
            
            // バグ修正の検出
            if (content.includes('fix') || content.includes('bug') || 
                content.includes('error') || content.includes('issue')) {
                patterns.bugFixes.push('Potential bug fixes');
            }
        }
    });

    // 重複を削除
    Object.keys(patterns).forEach(key => {
        patterns[key] = [...new Set(patterns[key])].slice(0, 3); // 最大3つまで
    });

    return patterns;
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