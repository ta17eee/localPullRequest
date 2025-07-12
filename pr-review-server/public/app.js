// グローバル変数
let currentDiff = null;
let fileStats = [];
let comments = [];
let reviewData = {
    status: 'pending',
    summary: '',
    comments: [],
    timestamp: null
};

// 初期化
document.addEventListener('DOMContentLoaded', function() {
    loadReviewData();
    fetchDiff();
    
    // ビューモード切り替え
    document.querySelectorAll('input[name="viewMode"]').forEach(radio => {
        radio.addEventListener('change', function() {
            if (currentDiff) {
                renderDiff(currentDiff, this.value);
            }
        });
    });
});

// Git diffを取得
async function fetchDiff() {
    try {
        const response = await fetch('/api/diff');
        const data = await response.json();
        
        if (data.success) {
            currentDiff = data.diff;
            fileStats = data.fileStats;
            renderDiff(data.diff, 'unified');
            renderFileList(data.fileStats);
        } else {
            showError('Failed to fetch git diff: ' + data.error);
        }
    } catch (error) {
        showError('Network error: ' + error.message);
    }
}

// Diffを表示
function renderDiff(diffText, viewMode = 'unified') {
    const container = document.getElementById('diffContainer');
    
    if (!diffText || diffText.trim() === '') {
        container.innerHTML = `
            <div class="text-center p-5">
                <h5>No changes detected</h5>
                <p class="text-muted">Make some changes to your files and refresh to see the diff.</p>
            </div>
        `;
        return;
    }

    try {
        const diff2htmlUi = new Diff2HtmlUI(container, diffText, {
            drawFileList: false,
            matching: 'lines',
            outputFormat: viewMode === 'split' ? 'side-by-side' : 'line-by-line',
            synchronisedScroll: true,
            highlight: true,
            renderNothingWhenEmpty: true
        });
        
        diff2htmlUi.draw();
        
        // コメントボタンを追加
        setTimeout(() => {
            addCommentButtons();
            renderExistingComments();
        }, 100);
        
    } catch (error) {
        console.error('Diff rendering error:', error);
        showError('Failed to render diff: ' + error.message);
    }
}

// ファイルリストを表示
function renderFileList(stats) {
    const fileList = document.getElementById('fileList');
    
    if (!stats || stats.length === 0) {
        fileList.innerHTML = '<div class="p-3 text-muted">No files changed</div>';
        return;
    }
    
    const totalAdditions = stats.reduce((sum, file) => sum + (file.additions || 0), 0);
    const totalDeletions = stats.reduce((sum, file) => sum + (file.deletions || 0), 0);
    
    // 統計情報を表示
    const statsHtml = `
        <div class="p-3 border-bottom">
            <div class="diff-stats">
                <span><strong>${stats.length}</strong> files changed</span>
                <span class="additions">+${totalAdditions}</span>
                <span class="deletions">-${totalDeletions}</span>
            </div>
            <div class="stat-bar">
                <div class="stat-additions" style="width: ${(totalAdditions / (totalAdditions + totalDeletions)) * 100}%"></div>
                <div class="stat-deletions" style="width: ${(totalDeletions / (totalAdditions + totalDeletions)) * 100}%"></div>
            </div>
        </div>
    `;
    
    const filesHtml = stats.map(file => `
        <div class="file-item" onclick="scrollToFile('${file.path}')">
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <div class="fw-medium">${getFileName(file.path)}</div>
                    <div class="text-muted small">${file.path}</div>
                </div>
                <div class="file-stats">
                    ${file.additions ? `<span class="additions">+${file.additions}</span>` : ''}
                    ${file.deletions ? `<span class="deletions">-${file.deletions}</span>` : ''}
                </div>
            </div>
        </div>
    `).join('');
    
    fileList.innerHTML = statsHtml + filesHtml;
}

// ファイル名を取得
function getFileName(path) {
    return path.split('/').pop();
}

// ファイルまでスクロール
function scrollToFile(filePath) {
    const fileHeader = document.querySelector(`[data-file-name*="${filePath}"]`);
    if (fileHeader) {
        fileHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        // アクティブファイルをハイライト
        document.querySelectorAll('.file-item').forEach(item => item.classList.remove('active'));
        event.currentTarget.classList.add('active');
    }
}

// コメントボタンを追加
function addCommentButtons() {
    const codeLines = document.querySelectorAll('.d2h-code-line');
    codeLines.forEach((line, index) => {
        if (!line.querySelector('.line-comment-btn')) {
            const lineNumber = line.querySelector('.d2h-line-number');
            if (lineNumber) {
                const commentBtn = document.createElement('span');
                commentBtn.className = 'line-comment-btn';
                commentBtn.innerHTML = '💬';
                commentBtn.title = 'Add comment';
                commentBtn.onclick = () => openCommentModal(line, index);
                lineNumber.appendChild(commentBtn);
            }
        }
    });
}

// コメントモーダルを開く
function openCommentModal(lineElement, lineIndex) {
    const fileName = getFileFromLine(lineElement);
    const lineNumber = getLineNumber(lineElement);
    
    document.getElementById('commentLocation').value = `${fileName}:${lineNumber}`;
    document.getElementById('commentText').value = '';
    document.getElementById('commentType').value = 'suggestion';
    
    // 現在の行情報を保存
    document.getElementById('commentForm').dataset.fileName = fileName;
    document.getElementById('commentForm').dataset.lineNumber = lineNumber;
    document.getElementById('commentForm').dataset.lineIndex = lineIndex;
    
    const modal = new bootstrap.Modal(document.getElementById('commentModal'));
    modal.show();
}

// 行からファイル名を取得
function getFileFromLine(lineElement) {
    const fileWrapper = lineElement.closest('.d2h-file-wrapper');
    if (fileWrapper) {
        const fileHeader = fileWrapper.querySelector('.d2h-file-name');
        return fileHeader ? fileHeader.textContent.trim() : 'unknown';
    }
    return 'unknown';
}

// 行番号を取得
function getLineNumber(lineElement) {
    const lineNumberElement = lineElement.querySelector('.d2h-line-number-content');
    return lineNumberElement ? lineNumberElement.textContent.trim() : '0';
}

// コメントを追加
async function addComment() {
    const form = document.getElementById('commentForm');
    const fileName = form.dataset.fileName;
    const lineNumber = form.dataset.lineNumber;
    const lineIndex = form.dataset.lineIndex;
    const commentText = document.getElementById('commentText').value.trim();
    const commentType = document.getElementById('commentType').value;
    
    if (!commentText) {
        alert('Please enter a comment');
        return;
    }
    
    const comment = {
        id: Date.now().toString(),
        fileName: fileName,
        lineNumber: lineNumber,
        lineIndex: lineIndex,
        text: commentText,
        type: commentType,
        timestamp: new Date().toISOString()
    };
    
    try {
        const response = await fetch('/api/comments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(comment)
        });
        
        const result = await response.json();
        if (result.success) {
            comments.push(comment);
            renderCommentOnLine(comment);
            
            // モーダルを閉じる
            const modal = bootstrap.Modal.getInstance(document.getElementById('commentModal'));
            modal.hide();
            
            showSuccess('Comment added successfully');
        } else {
            showError('Failed to add comment: ' + result.error);
        }
    } catch (error) {
        showError('Network error: ' + error.message);
    }
}

// 行にコメントを表示
function renderCommentOnLine(comment) {
    const codeLines = document.querySelectorAll('.d2h-code-line');
    const targetLine = codeLines[comment.lineIndex];
    
    if (targetLine) {
        const existingThread = targetLine.nextElementSibling;
        if (existingThread && existingThread.classList.contains('comment-thread')) {
            // 既存のコメントスレッドに追加
            const commentHtml = createCommentHtml(comment);
            existingThread.insertAdjacentHTML('beforeend', commentHtml);
        } else {
            // 新しいコメントスレッドを作成
            const commentThread = document.createElement('div');
            commentThread.className = 'comment-thread';
            commentThread.innerHTML = createCommentHtml(comment);
            targetLine.parentNode.insertBefore(commentThread, targetLine.nextSibling);
        }
    }
}

// コメントHTMLを生成
function createCommentHtml(comment) {
    const timestamp = new Date(comment.timestamp).toLocaleString();
    return `
        <div class="comment" data-comment-id="${comment.id}">
            <div class="comment-header">
                <span class="comment-type ${comment.type}">${getCommentTypeIcon(comment.type)} ${comment.type}</span>
                <span class="comment-time">${timestamp}</span>
                <button class="btn btn-sm btn-outline-danger ms-auto" onclick="deleteComment('${comment.id}')">🗑️</button>
            </div>
            <div class="comment-body">${comment.text}</div>
        </div>
    `;
}

// コメントタイプのアイコンを取得
function getCommentTypeIcon(type) {
    const icons = {
        suggestion: '💡',
        issue: '⚠️',
        question: '❓',
        praise: '👍'
    };
    return icons[type] || '💬';
}

// 既存のコメントを表示
async function renderExistingComments() {
    try {
        const response = await fetch('/api/comments');
        const data = await response.json();
        
        if (data.success) {
            comments = data.comments;
            comments.forEach(comment => {
                renderCommentOnLine(comment);
            });
        }
    } catch (error) {
        console.error('Failed to load comments:', error);
    }
}

// コメントを削除
async function deleteComment(commentId) {
    if (!confirm('Are you sure you want to delete this comment?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/comments/${commentId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        if (result.success) {
            // DOMから削除
            const commentElement = document.querySelector(`[data-comment-id="${commentId}"]`);
            if (commentElement) {
                const thread = commentElement.parentElement;
                commentElement.remove();
                
                // スレッドが空になったら削除
                if (thread.children.length === 0) {
                    thread.remove();
                }
            }
            
            // ローカル配列から削除
            comments = comments.filter(c => c.id !== commentId);
            
            showSuccess('Comment deleted successfully');
        } else {
            showError('Failed to delete comment: ' + result.error);
        }
    } catch (error) {
        showError('Network error: ' + error.message);
    }
}

// レビューを保存
async function saveReview() {
    const status = document.getElementById('overallStatus').value;
    const summary = document.getElementById('summaryComment').value;
    
    const reviewData = {
        status: status,
        summary: summary,
        timestamp: new Date().toISOString(),
        commentsCount: comments.length
    };
    
    try {
        const response = await fetch('/api/review', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(reviewData)
        });
        
        const result = await response.json();
        if (result.success) {
            showSuccess('Review saved successfully');
        } else {
            showError('Failed to save review: ' + result.error);
        }
    } catch (error) {
        showError('Network error: ' + error.message);
    }
}

// レビューデータを読み込み
async function loadReviewData() {
    try {
        const response = await fetch('/api/review');
        const data = await response.json();
        
        if (data.success && data.review) {
            document.getElementById('overallStatus').value = data.review.status || 'pending';
            document.getElementById('summaryComment').value = data.review.summary || '';
        }
    } catch (error) {
        console.error('Failed to load review data:', error);
    }
}

// レビューをエクスポート
async function exportReview() {
    try {
        const response = await fetch('/api/export');
        const result = await response.json();
        
        if (result.success) {
            // Markdownファイルをダウンロード
            const blob = new Blob([result.markdown], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `pr-review-${new Date().toISOString().split('T')[0]}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showSuccess('Review exported successfully');
        } else {
            showError('Failed to export review: ' + result.error);
        }
    } catch (error) {
        showError('Network error: ' + error.message);
    }
}

// Diffを更新
function refreshDiff() {
    const container = document.getElementById('diffContainer');
    container.innerHTML = `
        <div class="text-center p-5">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-3">Refreshing git diff...</p>
        </div>
    `;
    
    fetchDiff();
}

// 成功メッセージを表示
function showSuccess(message) {
    showToast(message, 'success');
}

// エラーメッセージを表示
function showError(message) {
    showToast(message, 'danger');
}

// トーストを表示
function showToast(message, type) {
    const toastContainer = getOrCreateToastContainer();
    const toastId = 'toast-' + Date.now();
    
    const toastHtml = `
        <div id="${toastId}" class="toast align-items-center text-white bg-${type} border-0" role="alert">
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `;
    
    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement);
    toast.show();
    
    // 自動削除
    toastElement.addEventListener('hidden.bs.toast', () => {
        toastElement.remove();
    });
}

// トーストコンテナを取得または作成
function getOrCreateToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(container);
    }
    return container;
}