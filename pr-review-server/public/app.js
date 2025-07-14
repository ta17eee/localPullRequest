// グローバル変数
let currentDiff = null;
let fileStats = [];
let comments = [];
let overallReviews = [];
let diffSummary = null;
let reviewData = {
    status: 'pending',
    summary: '',
    comments: [],
    overallReviews: [],
    timestamp: null
};

// 行範囲選択の状態管理
let selectionMode = false;
let startLine = null;
let endLine = null;
let selectedLines = [];
let selectionIndicator = null;

// パフォーマンス最適化：DOM要素のキャッシュ
let cachedCodeLines = null;
let cachedFileMappings = new Map();
let renderTimeout = null;

// 初期化
document.addEventListener('DOMContentLoaded', function() {
    loadReviewData();
    loadOverallReviews();
    fetchDiff();
    
    // ビューモード切り替え
    document.querySelectorAll('input[name="viewMode"]').forEach(radio => {
        radio.addEventListener('change', function() {
            if (currentDiff) {
                renderDiff(currentDiff, this.value);
            }
        });
    });
    
    // ESCキーで選択をキャンセル
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && selectionMode) {
            cancelSelection();
        }
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
            diffSummary = data.summary;
            renderDiff(data.diff, 'split');
            renderFileList(data.fileStats);
            if (data.summary) {
                renderDiffSummary(data.summary);
            }
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
        
        // パフォーマンス最適化：キャッシュと選択状態をクリア
        clearLineNumberCache();
        resetSelectionState();
        
        // デバウンシング：前の処理をキャンセル
        if (renderTimeout) {
            clearTimeout(renderTimeout);
        }
        
        // DOMが更新された後、段階的に処理を実行
        requestAnimationFrame(() => {
            // 最初の段階：基本的なキャッシュ
            cacheCodeLines();
            enhanceSynchronizedScrolling();
            
            // 次の段階：コメントボタンの追加とイベント設定（遅延を増やす）
            setTimeout(() => {
                // diff2htmlのレンダリングが完全に終了するまで待機
                const checkAndSetup = () => {
                    const codeLines = document.querySelectorAll('.d2h-code-line, tr.d2h-code-side-line, .d2h-diff-tbody tr');
                    if (codeLines.length > 0) {
                        console.log(`Found ${codeLines.length} code lines, setting up...`);
                        addCommentButtons();
                        setupLineClickHandlers();
                        
                        // 最終段階：コメントレンダリング
                        renderTimeout = setTimeout(() => {
                            asyncRenderExistingComments();
                            renderTimeout = null;
                        }, 100);
                    } else {
                        console.log('No code lines found yet, retrying...');
                        setTimeout(checkAndSetup, 100);
                    }
                };
                checkAndSetup();
            }, 300); // diff2htmlの完全レンダリングを待つ時間を増やす
        });
        
    } catch (error) {
        console.error('Diff rendering error:', error);
        showError('Failed to render diff: ' + error.message);
    }
}

// 同期スクロールを強化（最小限のアプローチ）
function enhanceSynchronizedScrolling() {
    // diff2htmlのsynchronisedScroll: trueを活用し、最小限の追加処理のみ
    
    // ファイルヘッダーのスティッキー設定のみ実装
    setTimeout(() => {
        const fileHeaders = document.querySelectorAll('.d2h-file-header');
        fileHeaders.forEach(header => {
            header.style.position = 'sticky';
            header.style.top = '0';
            header.style.zIndex = '10';
            header.style.backgroundColor = '#f6f8fa';
        });
    }, 50);
    
    // diff2htmlの内部構造には干渉しない
    // synchronisedScroll: trueが適切に動作するよう環境を整えるのみ
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

// コメントボタンを追加（最適化版 - イベント委任付き）
function addCommentButtons() {
    console.log('Adding comment buttons...');
    
    // DOM準備完了を確認
    const diffContainer = document.getElementById('diffContainer');
    if (!diffContainer) {
        console.error('diffContainer not found, retrying in 100ms...');
        setTimeout(addCommentButtons, 100);
        return;
    }
    
    // より広範なセレクタで行要素を取得
    const allLines = document.querySelectorAll(
        'tr.d2h-code-side-line, ' +
        'tr[class*="d2h-"], ' +
        '.d2h-diff-tbody tr, ' +
        '.d2h-code-wrapper tr'
    );
    
    if (allLines.length === 0) {
        console.error('No lines found, retrying in 100ms...');
        setTimeout(addCommentButtons, 100);
        return;
    }
    
    console.log(`Processing ${allLines.length} lines for comment buttons`);
    
    // ドキュメントフラグメントを使用してDOM操作を最適化
    const changes = [];
    let addedCount = 0;
    
    allLines.forEach((line, index) => {
        // すでにボタンがある場合はスキップ
        if (line.querySelector('.line-comment-btn')) {
            return;
        }
        
        // クリック可能な行としてマーク
        line.style.cursor = 'pointer';
        
        // diff2htmlの実際の構造に合わせて複数のセレクターを試行
        const lineNumberSelectors = [
            '.d2h-code-linenumber',       // 最も一般的
            '.d2h-code-side-linenumber',  // サイドバイサイド
            'td.d2h-code-linenumber',     // テーブルセル
            '.d2h-line-number',           // 旧バージョン
            'td:first-child',             // 最初のセル（行番号の可能性）
        ];
        
        let lineNumber = null;
        for (const selector of lineNumberSelectors) {
            lineNumber = line.querySelector(selector);
            if (lineNumber && lineNumber.textContent.trim().match(/^\d+$/)) {
                break;
            }
        }
        
        if (lineNumber) {
            const commentBtn = document.createElement('span');
            commentBtn.className = 'line-comment-btn';
            commentBtn.innerHTML = '💬';
            commentBtn.title = 'Click to start/end range selection';
            commentBtn.dataset.lineIndex = index;
            changes.push({ lineNumber, commentBtn });
            addedCount++;
        }
        
        // 行インデックスをデータ属性として保存
        line.dataset.lineIndex = index;
        line.classList.add('code-line-selectable');
    });
    
    // バッチでDOM変更を適用
    changes.forEach(({ lineNumber, commentBtn }) => {
        lineNumber.appendChild(commentBtn);
    });
    
    console.log(`Added ${addedCount} new comment buttons out of ${allLines.length} lines`);
    
    // キャッシュを更新
    cachedCodeLines = allLines;
    
    // イベント委任を設定
    setupEventDelegation();
    
    // 設定後の検証
    validateEventDelegationSetup();
}

// イベント委任の設定を検証
function validateEventDelegationSetup() {
    const diffContainer = document.getElementById('diffContainer');
    const commentButtons = document.querySelectorAll('.line-comment-btn');
    const selectableLines = document.querySelectorAll('.code-line-selectable');
    
    const validationResult = {
        diffContainerExists: !!diffContainer,
        eventDelegationSetup: eventDelegationSetup,
        hasClickHandler: !!diffContainerClickHandler,
        commentButtonsCount: commentButtons.length,
        selectableLinesCount: selectableLines.length,
        firstButtonHasIndex: commentButtons.length > 0 ? !!commentButtons[0].dataset.lineIndex : false
    };
    
    debugLog('Event delegation validation:', validationResult);
    
    // 検証エラーのチェック
    if (!validationResult.diffContainerExists) {
        console.error('Validation failed: diffContainer not found');
    }
    if (!validationResult.hasClickHandler) {
        console.error('Validation failed: Click handler not set');
    }
    if (validationResult.commentButtonsCount === 0) {
        console.warn('Validation warning: No comment buttons found');
    }
    
    // 最初のボタンの属性を詳細チェック
    if (commentButtons.length > 0) {
        const firstBtn = commentButtons[0];
        debugLog('First comment button details:', {
            className: firstBtn.className,
            lineIndex: firstBtn.dataset.lineIndex,
            isConnected: firstBtn.isConnected,
            parentElement: firstBtn.parentElement?.tagName
        });
    }
}

// イベント委任を設定（パフォーマンス最適化）
let eventDelegationSetup = false;
let diffContainerClickHandler = null;
let currentDiffContainer = null;

function setupEventDelegation() {
    if (eventDelegationSetup) {
        console.log('Event delegation already setup, skipping');
        return;
    }
    
    const diffContainer = document.getElementById('diffContainer');
    if (!diffContainer) {
        console.error('diffContainer not found, cannot setup event delegation');
        return;
    }
    
    console.log('Setting up event delegation...');
    
    // 古いリスナーを削除（もしあれば）
    if (currentDiffContainer && diffContainerClickHandler) {
        console.log('Removing old event listener');
        currentDiffContainer.removeEventListener('click', diffContainerClickHandler);
    }
    
    // 新しいイベントハンドラを作成
    diffContainerClickHandler = (e) => {
        // コメントボタンのクリック
        if (e.target.classList.contains('line-comment-btn')) {
            console.log('Comment button clicked', { lineIndex: e.target.dataset.lineIndex, selectionMode });
            e.stopPropagation();
            e.preventDefault();
            const lineIndex = parseInt(e.target.dataset.lineIndex);
            
            // 直接行要素を取得
            const line = e.target.closest('tr, .d2h-code-line');
            if (line) {
                console.log('Starting/ending range selection via button click');
                handleLineSelection(line);
            } else {
                console.error('Could not find parent line element');
            }
            return;
        }
        
        // 行のクリック（範囲選択）- 複数のセレクタをサポート
        const codeLine = e.target.closest('tr.d2h-code-side-line, tr[class*="d2h-"], .d2h-code-line, .d2h-diff-tbody tr');
        if (codeLine && !e.target.closest('.line-comment-btn')) {
            // 行番号セルまたはコード内容セルがあることを確認
            const hasLineNumber = codeLine.querySelector('.d2h-code-linenumber, .d2h-code-side-linenumber');
            const hasCodeContent = codeLine.querySelector('.d2h-code-line, .d2h-code-side-line');
            
            if (hasLineNumber || hasCodeContent) {
                console.log('Line clicked for selection', codeLine);
                e.preventDefault();
                
                // クリックエフェクトを追加
                addClickEffect(codeLine);
                
                handleLineSelection(codeLine);
            }
        }
    };
    
    // 新しいリスナーを追加
    diffContainer.addEventListener('click', diffContainerClickHandler);
    currentDiffContainer = diffContainer;
    
    eventDelegationSetup = true;
    console.log('Event delegation setup completed');
}

// 行クリックハンドラーを明示的に設定
function setupLineClickHandlers() {
    console.log('Setting up line click handlers...');
    
    // すべての行要素を取得
    const lines = document.querySelectorAll('tr.d2h-code-side-line, tr[class*="d2h-"], .d2h-diff-tbody tr');
    console.log(`Found ${lines.length} line elements`);
    
    // 各行にデータ属性を追加してクリック可能にする
    lines.forEach((line, index) => {
        if (!line.dataset.clickable) {
            line.dataset.clickable = 'true';
            line.dataset.lineIdx = index;
            line.style.cursor = 'pointer';
        }
        
        // ホバーイベントを追加（選択モード中のプレビュー）
        line.addEventListener('mouseenter', handleLineHover);
        line.addEventListener('mouseleave', handleLineHoverEnd);
    });
    
    // イベント委任を確実に設定
    setupEventDelegation();
}

// ホバー時のプレビュー処理
function handleLineHover(e) {
    if (!selectionMode || !startLine) return;
    
    const hoveredLine = e.currentTarget;
    const startLineNum = getLineNumberFromElement(startLine);
    const hoveredLineNum = getLineNumberFromElement(hoveredLine);
    
    if (startLineNum === 0 || hoveredLineNum === 0) return;
    
    // プレビュー範囲を表示
    const min = Math.min(startLineNum, hoveredLineNum);
    const max = Math.max(startLineNum, hoveredLineNum);
    
    document.querySelectorAll('.line-hover-preview').forEach(el => {
        el.classList.remove('line-hover-preview');
    });
    
    const fileWrapper = startLine.closest('.d2h-file-wrapper');
    if (fileWrapper) {
        const linesInFile = fileWrapper.querySelectorAll('tr.d2h-code-side-line, tr[class*="d2h-"], .d2h-diff-tbody tr');
        linesInFile.forEach(line => {
            const lineNum = getLineNumberFromElement(line);
            if (lineNum >= min && lineNum <= max) {
                line.classList.add('line-hover-preview');
            }
        });
    }
}

// ホバー終了時の処理
function handleLineHoverEnd() {
    document.querySelectorAll('.line-hover-preview').forEach(el => {
        el.classList.remove('line-hover-preview');
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
    const form = document.getElementById('commentForm');
    form.dataset.fileName = fileName;
    form.dataset.lineNumber = lineNumber;
    form.dataset.lineIndex = lineIndex;
    form.dataset.isRange = 'false';
    
    // モーダルタイトルを更新
    const modalTitle = document.querySelector('#commentModal .modal-title');
    modalTitle.textContent = `💬 Add Comment on line ${lineNumber}`;
    
    const modal = new bootstrap.Modal(document.getElementById('commentModal'));
    modal.show();
}

// 行からファイル名を取得
function getFileFromLine(lineElement) {
    const fileWrapper = lineElement.closest('.d2h-file-wrapper');
    if (fileWrapper) {
        // 複数のセレクタを試す
        const fileHeader = fileWrapper.querySelector('.d2h-file-name, .d2h-file-name-wrapper');
        if (fileHeader) {
            // ファイル名だけを抽出（パスの場合は最後の部分）
            const fullPath = fileHeader.textContent.trim();
            return fullPath.split('/').pop() || fullPath;
        }
    }
    return 'unknown';
}

// 行番号を取得
function getLineNumber(lineElement) {
    // 複数のセレクタを試す
    const selectors = [
        '.d2h-code-linenumber',
        '.d2h-code-side-linenumber', 
        '.d2h-line-number-content',
        '.d2h-line-number',
        'td:first-child'
    ];
    
    for (const selector of selectors) {
        const lineNumberElement = lineElement.querySelector(selector);
        if (lineNumberElement) {
            const text = lineNumberElement.textContent.trim();
            // 数字のみの場合は行番号として返す
            if (text.match(/^\d+$/)) {
                return text;
            }
        }
    }
    return '0';
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
    
    // 範囲コメントの場合は追加情報を含める
    if (form.dataset.isRange === 'true') {
        comment.isRange = true;
        comment.endLineNumber = form.dataset.endLineNumber;
        comment.lineRange = JSON.parse(form.dataset.lineRange);
    }
    
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

// コメントを一括レンダリング（最適化版）
function batchRenderComments(commentsArray) {
    if (!cachedCodeLines) {
        console.warn('Code lines not cached, falling back to individual rendering');
        commentsArray.forEach(comment => renderCommentOnLine(comment));
        return;
    }
    
    // コメントをファイル別とタイプ別に分類
    const commentsByLocation = new Map();
    
    commentsArray.forEach(comment => {
        const key = comment.isRange ? 
            `${comment.fileName}:${comment.lineNumber}-${comment.endLineNumber}` :
            `${comment.fileName}:${comment.lineNumber}`;
            
        if (!commentsByLocation.has(key)) {
            commentsByLocation.set(key, []);
        }
        commentsByLocation.get(key).push(comment);
    });
    
    // バッチで処理
    commentsByLocation.forEach((comments, location) => {
        const firstComment = comments[0];
        if (firstComment.isRange && firstComment.lineRange) {
            batchRenderRangeComments(comments);
        } else {
            batchRenderSingleLineComments(comments);
        }
    });
}

// 単一行コメントを一括レンダリング
function batchRenderSingleLineComments(comments) {
    const firstComment = comments[0];
    const targetLine = cachedCodeLines[firstComment.lineIndex];
    
    if (targetLine) {
        let commentThread = targetLine.nextElementSibling;
        if (!commentThread || !commentThread.classList.contains('comment-thread')) {
            commentThread = document.createElement('div');
            commentThread.className = 'comment-thread';
            targetLine.parentNode.insertBefore(commentThread, targetLine.nextSibling);
        }
        
        // 全てのコメントを一度に追加
        const allCommentsHtml = comments.map(comment => createCommentHtml(comment)).join('');
        commentThread.insertAdjacentHTML('beforeend', allCommentsHtml);
    }
}

// 範囲コメントを一括レンダリング
function batchRenderRangeComments(comments) {
    const firstComment = comments[0];
    const fileName = firstComment.fileName;
    const fileLines = cachedFileMappings.get(fileName);
    
    if (!fileLines) return;
    
    // 最初の行を見つける
    const startLineNum = parseInt(firstComment.lineNumber);
    const targetLine = fileLines.find(item => 
        getLineNumberFromElement(item.element) === startLineNum
    )?.element;
    
    if (targetLine) {
        let commentThread = targetLine.nextElementSibling;
        if (!commentThread || !commentThread.classList.contains('comment-thread')) {
            commentThread = document.createElement('div');
            commentThread.className = 'comment-thread range-comment-thread';
            targetLine.parentNode.insertBefore(commentThread, targetLine.nextSibling);
        }
        
        // 全ての範囲コメントを一度に追加
        const allCommentsHtml = comments.map(comment => createRangeCommentHtml(comment)).join('');
        commentThread.insertAdjacentHTML('beforeend', allCommentsHtml);
    }
}

// 行にコメントを表示（後方互換性のため保持）
function renderCommentOnLine(comment) {
    if (comment.isRange && comment.lineRange) {
        // 範囲コメントの場合
        batchRenderRangeComments([comment]);
    } else {
        // 単一行コメントの場合
        batchRenderSingleLineComments([comment]);
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

// 既存のコメントを表示（最適化版）
async function renderExistingComments() {
    try {
        const response = await fetch('/api/comments');
        const data = await response.json();
        
        if (data.success) {
            comments = data.comments;
            batchRenderComments(comments);
        }
    } catch (error) {
        console.error('Failed to load comments:', error);
    }
}

// 非同期でコメントを段階的にレンダリング
async function asyncRenderExistingComments() {
    try {
        const response = await fetch('/api/comments');
        const data = await response.json();
        
        if (data.success) {
            comments = data.comments;
            
            // コメントが多い場合は段階的に処理
            if (comments.length > 20) {
                asyncBatchRenderComments(comments);
            } else {
                // 少ない場合は通常の処理
                requestAnimationFrame(() => batchRenderComments(comments));
            }
        }
    } catch (error) {
        console.error('Failed to load comments:', error);
    }
}

// 大量のコメントを段階的に非同期レンダリング
function asyncBatchRenderComments(commentsArray) {
    const CHUNK_SIZE = 10; // 一度に処理するコメント数
    let currentIndex = 0;
    
    function processChunk() {
        const chunk = commentsArray.slice(currentIndex, currentIndex + CHUNK_SIZE);
        if (chunk.length === 0) return; // 処理完了
        
        // チャンクを処理
        requestAnimationFrame(() => {
            batchRenderComments(chunk);
            currentIndex += CHUNK_SIZE;
            
            // 次のチャンクを処理（CPU時間を他の処理に渡すため）
            if (currentIndex < commentsArray.length) {
                setTimeout(processChunk, 0);
            }
        });
    }
    
    processChunk();
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

// Claude Codeによる自動修正を開始
async function startClaudeFix() {
    try {
        // 修正指示を取得
        const response = await fetch('/api/claude-instructions');
        const data = await response.json();
        
        if (!data.success) {
            showError('Failed to get fix instructions: ' + data.error);
            return;
        }
        
        if (!data.hasInstructions) {
            showInfo('No fixable review comments found. Add suggestions or issues to enable auto-fix.');
            return;
        }
        
        // 修正指示をクリップボードにコピー
        const instructions = data.instructions;
        
        try {
            await navigator.clipboard.writeText(instructions);
            
            showSuccess(`Claude Fix instructions copied! 
                        📁 ${data.fileCount} files with ${data.commentCount} issues/suggestions.
                        
                        Now run: /pr-fix in Claude Code to start auto-fixing.`);
        } catch (clipboardError) {
            // クリップボードアクセスが失敗した場合の代替方法
            console.warn('Clipboard access failed:', clipboardError);
            
            // テキストエリアを作成して選択状態にする
            const textArea = document.createElement('textarea');
            textArea.value = instructions;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            
            try {
                document.execCommand('copy');
                showSuccess(`Claude Fix instructions copied! 
                            📁 ${data.fileCount} files with ${data.commentCount} issues/suggestions.
                            
                            Now run: /pr-fix in Claude Code to start auto-fixing.`);
            } catch (execError) {
                // 全て失敗した場合は表示だけ
                showInstructionsModal(instructions, data.fileCount, data.commentCount);
            }
            
            document.body.removeChild(textArea);
        }
        
    } catch (error) {
        showError('Network error: ' + error.message);
    }
}

// 修正指示をモーダルで表示（クリップボードが使えない場合の代替）
function showInstructionsModal(instructions, fileCount, commentCount) {
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">🤖 Claude Fix Instructions</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <p><strong>📁 ${fileCount} files</strong> with <strong>${commentCount} issues/suggestions</strong> found.</p>
                    <p>Copy the instructions below and run <code>/pr-fix</code> in Claude Code:</p>
                    <textarea class="form-control" rows="15" readonly>${instructions}</textarea>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-primary" onclick="selectInstructionsText()">Select All</button>
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();
    
    // モーダルが閉じられたら削除
    modal.addEventListener('hidden.bs.modal', () => {
        document.body.removeChild(modal);
    });
}

// 情報メッセージを表示
function showInfo(message) {
    showToast(message, 'info');
}

// 差分全体レビューモーダルを開く
function openOverallReviewModal() {
    document.getElementById('overallReviewTitle').value = '';
    document.getElementById('overallReviewText').value = '';
    document.getElementById('overallReviewType').value = 'general';
    document.getElementById('overallReviewPriority').value = 'medium';
    
    const modal = new bootstrap.Modal(document.getElementById('overallReviewModal'));
    modal.show();
}

// 差分全体レビューを追加
async function addOverallReview() {
    const title = document.getElementById('overallReviewTitle').value.trim();
    const text = document.getElementById('overallReviewText').value.trim();
    const type = document.getElementById('overallReviewType').value;
    const priority = document.getElementById('overallReviewPriority').value;
    
    if (!title || !text) {
        showError('Please enter both title and review comment');
        return;
    }
    
    const review = {
        id: Date.now().toString(),
        title: title,
        text: text,
        type: type,
        priority: priority,
        timestamp: new Date().toISOString(),
        author: 'Current User' // ユーザー管理機能がある場合はここを更新
    };
    
    try {
        const response = await fetch('/api/overall-reviews', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(review)
        });
        
        const result = await response.json();
        if (result.success) {
            overallReviews.push(review);
            renderOverallReview(review);
            
            // モーダルを閉じる
            const modal = bootstrap.Modal.getInstance(document.getElementById('overallReviewModal'));
            modal.hide();
            
            showSuccess('Overall review added successfully');
        } else {
            showError('Failed to add overall review: ' + result.error);
        }
    } catch (error) {
        showError('Network error: ' + error.message);
    }
}

// 差分全体レビューを表示
function renderOverallReview(review) {
    const container = document.getElementById('overallReviewsList');
    
    const reviewHtml = `
        <div class="overall-review-item mb-3" data-review-id="${review.id}">
            <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <div>
                        <span class="review-type-badge badge bg-${getReviewTypeBadgeColor(review.type)}">
                            ${getReviewTypeIcon(review.type)} ${review.type}
                        </span>
                        <span class="review-priority-badge badge bg-${getPriorityBadgeColor(review.priority)} ms-2">
                            ${getPriorityIcon(review.priority)} ${review.priority}
                        </span>
                    </div>
                    <div class="text-muted small">
                        ${new Date(review.timestamp).toLocaleString()}
                    </div>
                </div>
                <div class="card-body">
                    <h6 class="card-title">${escapeHtml(review.title)}</h6>
                    <p class="card-text">${escapeHtml(review.text).replace(/\n/g, '<br>')}</p>
                    <div class="d-flex justify-content-end">
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteOverallReview('${review.id}')">
                            🗑️ Delete
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    container.insertAdjacentHTML('beforeend', reviewHtml);
}

// レビュータイプのバッジ色を取得
function getReviewTypeBadgeColor(type) {
    const colors = {
        general: 'secondary',
        architecture: 'primary',
        performance: 'warning',
        security: 'danger',
        testing: 'success',
        documentation: 'info'
    };
    return colors[type] || 'secondary';
}

// レビュータイプのアイコンを取得
function getReviewTypeIcon(type) {
    const icons = {
        general: '📝',
        architecture: '🏗️',
        performance: '⚡',
        security: '🔒',
        testing: '🧪',
        documentation: '📚'
    };
    return icons[type] || '📝';
}

// 優先度のバッジ色を取得
function getPriorityBadgeColor(priority) {
    const colors = {
        low: 'success',
        medium: 'warning',
        high: 'danger',
        critical: 'dark'
    };
    return colors[priority] || 'secondary';
}

// 優先度のアイコンを取得
function getPriorityIcon(priority) {
    const icons = {
        low: '🟢',
        medium: '🟡',
        high: '🔴',
        critical: '🚨'
    };
    return icons[priority] || '🟡';
}

// HTMLエスケープ
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 差分全体レビューを削除
async function deleteOverallReview(reviewId) {
    if (!confirm('Are you sure you want to delete this overall review?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/overall-reviews/${reviewId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        if (result.success) {
            // DOMから削除
            const reviewElement = document.querySelector(`[data-review-id="${reviewId}"]`);
            if (reviewElement) {
                reviewElement.remove();
            }
            
            // ローカル配列から削除
            overallReviews = overallReviews.filter(r => r.id !== reviewId);
            
            showSuccess('Overall review deleted successfully');
        } else {
            showError('Failed to delete overall review: ' + result.error);
        }
    } catch (error) {
        showError('Network error: ' + error.message);
    }
}

// 全体レビューを読み込み
async function loadOverallReviews() {
    try {
        const response = await fetch('/api/overall-reviews');
        const data = await response.json();
        
        if (data.success) {
            overallReviews = data.reviews || [];
            const container = document.getElementById('overallReviewsList');
            container.innerHTML = '';
            
            if (overallReviews.length === 0) {
                container.innerHTML = '<p class="text-muted text-center">No overall reviews yet. Click the button below to add one.</p>';
            } else {
                overallReviews.forEach(review => renderOverallReview(review));
            }
        }
    } catch (error) {
        console.error('Failed to load overall reviews:', error);
    }
}

// 差分要約を表示
function renderDiffSummary(summary) {
    const summaryCard = document.getElementById('diffSummaryCard');
    const summaryContent = document.getElementById('diffSummaryContent');
    const summaryDetail = document.getElementById('diffSummaryDetail');
    
    if (!summary || summary.totalFiles === 0) {
        summaryCard.style.display = 'none';
        return;
    }
    
    summaryCard.style.display = 'block';
    
    // 影響度の表示
    const impactColors = {
        low: 'success',
        medium: 'warning',
        high: 'danger'
    };
    const impactEmojis = {
        low: '🟢',
        medium: '🟡',
        high: '🔴'
    };
    
    // メイン要約
    let mainSummaryHtml = `
        <div class="row">
            <div class="col-md-3 text-center">
                <h2 class="mb-0">${summary.totalFiles}</h2>
                <p class="text-muted">Files Changed</p>
            </div>
            <div class="col-md-3 text-center">
                <h2 class="mb-0 text-success">+${summary.totalAdditions}</h2>
                <p class="text-muted">Additions</p>
            </div>
            <div class="col-md-3 text-center">
                <h2 class="mb-0 text-danger">-${summary.totalDeletions}</h2>
                <p class="text-muted">Deletions</p>
            </div>
            <div class="col-md-3 text-center">
                <h2 class="mb-0">
                    <span class="badge bg-${impactColors[summary.estimatedImpact]}">
                        ${impactEmojis[summary.estimatedImpact]} ${summary.estimatedImpact.toUpperCase()}
                    </span>
                </h2>
                <p class="text-muted">Impact</p>
            </div>
        </div>
    `;
    
    // 変更タイプのサマリ
    if (Object.values(summary.changeTypes).some(v => v > 0)) {
        mainSummaryHtml += `
            <hr>
            <div class="row mt-3">
                <div class="col-12">
                    <h6>Change Types:</h6>
                    <div class="d-flex flex-wrap gap-2">
        `;
        
        if (summary.changeTypes.added > 0) {
            mainSummaryHtml += `<span class="badge bg-success">➕ Added: ${summary.changeTypes.added}</span>`;
        }
        if (summary.changeTypes.modified > 0) {
            mainSummaryHtml += `<span class="badge bg-info">📝 Modified: ${summary.changeTypes.modified}</span>`;
        }
        if (summary.changeTypes.deleted > 0) {
            mainSummaryHtml += `<span class="badge bg-danger">➖ Deleted: ${summary.changeTypes.deleted}</span>`;
        }
        if (summary.changeTypes.renamed > 0) {
            mainSummaryHtml += `<span class="badge bg-warning">🔄 Renamed: ${summary.changeTypes.renamed}</span>`;
        }
        
        mainSummaryHtml += `
                    </div>
                </div>
            </div>
        `;
    }
    
    summaryContent.innerHTML = mainSummaryHtml;
    
    // 詳細情報
    let detailHtml = '';
    
    // ファイルタイプ別統計
    if (Object.keys(summary.fileTypes).length > 0) {
        detailHtml += `
            <div class="mb-4">
                <h6>File Types:</h6>
                <div class="row">
        `;
        
        Object.entries(summary.fileTypes)
            .sort((a, b) => b[1] - a[1])
            .forEach(([ext, count]) => {
                detailHtml += `
                    <div class="col-6 col-md-4 col-lg-3 mb-2">
                        <div class="d-flex justify-content-between align-items-center p-2 bg-light rounded">
                            <span class="text-truncate">${ext}</span>
                            <span class="badge bg-secondary">${count}</span>
                        </div>
                    </div>
                `;
            });
        
        detailHtml += `
                </div>
            </div>
        `;
    }
    
    // 主要な変更
    if (summary.mainChanges && summary.mainChanges.length > 0) {
        detailHtml += `
            <div class="mb-4">
                <h6>Significant Changes:</h6>
                <ul class="list-group">
        `;
        
        summary.mainChanges.forEach(change => {
            const changeIcon = change.changes > 100 ? '🚨' : change.changes > 50 ? '⚠️' : '🔔';
            detailHtml += `
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    <span>
                        ${changeIcon} <code>${change.path}</code>
                        <span class="text-muted ms-2">(${change.type})</span>
                    </span>
                    <span class="badge bg-primary rounded-pill">${change.changes} changes</span>
                </li>
            `;
        });
        
        detailHtml += `
                </ul>
            </div>
        `;
    }
    
    // パターン分析
    if (summary.patterns) {
        const hasPatterns = Object.values(summary.patterns).some(arr => arr.length > 0);
        if (hasPatterns) {
            detailHtml += `
                <div class="mb-4">
                    <h6>Detected Patterns:</h6>
                    <div class="row">
            `;
            
            const patternInfo = {
                newFeatures: { emoji: '✨', label: 'New Features', color: 'success' },
                bugFixes: { emoji: '🐛', label: 'Bug Fixes', color: 'danger' },
                tests: { emoji: '🧪', label: 'Tests', color: 'info' },
                documentation: { emoji: '📚', label: 'Documentation', color: 'secondary' },
                refactoring: { emoji: '🔧', label: 'Refactoring', color: 'warning' }
            };
            
            Object.entries(summary.patterns).forEach(([type, items]) => {
                if (items.length > 0) {
                    const info = patternInfo[type];
                    detailHtml += `
                        <div class="col-md-6 mb-3">
                            <div class="card border-${info.color}">
                                <div class="card-body">
                                    <h6 class="card-title">${info.emoji} ${info.label}</h6>
                                    <ul class="mb-0">
                                        ${items.map(item => `<li>${item}</li>`).join('')}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    `;
                }
            });
            
            detailHtml += `
                    </div>
                </div>
            `;
        }
    }
    
    summaryDetail.innerHTML = detailHtml;
}

// 要約詳細の表示切り替え
function toggleSummaryDetail() {
    const detail = document.getElementById('diffSummaryDetail');
    const toggleText = document.getElementById('summaryToggleText');
    
    if (detail.style.display === 'none') {
        detail.style.display = 'block';
        toggleText.textContent = 'Hide Details';
    } else {
        detail.style.display = 'none';
        toggleText.textContent = 'Show Details';
    }
}

// 差分要約からレビューコメントを自動生成
function generateReviewSummary() {
    if (!diffSummary) {
        showError('No diff summary available. Please refresh the diff first.');
        return;
    }
    
    const spinner = document.getElementById('summarySpinner');
    const reviewText = document.getElementById('overallReviewText');
    const reviewTitle = document.getElementById('overallReviewTitle');
    
    // スピナーを表示
    spinner.classList.remove('d-none');
    
    // 要約からレビューを生成
    setTimeout(() => {
        let generatedTitle = '';
        let generatedReview = '';
        
        // タイトルを生成
        if (diffSummary.estimatedImpact === 'high') {
            generatedTitle = 'Major Changes - Careful Review Required';
        } else if (diffSummary.estimatedImpact === 'medium') {
            generatedTitle = 'Moderate Changes - Standard Review';
        } else {
            generatedTitle = 'Minor Changes - Quick Review';
        }
        
        // レビューコメントを生成
        generatedReview = `## Summary of Changes\n\n`;
        generatedReview += `This PR includes changes to **${diffSummary.totalFiles} files** with **+${diffSummary.totalAdditions} additions** and **-${diffSummary.totalDeletions} deletions**.\n\n`;
        
        // 変更タイプの説明
        generatedReview += `### Change Breakdown:\n`;
        if (diffSummary.changeTypes.added > 0) {
            generatedReview += `- ➕ **${diffSummary.changeTypes.added} new files** added\n`;
        }
        if (diffSummary.changeTypes.modified > 0) {
            generatedReview += `- 📝 **${diffSummary.changeTypes.modified} files** modified\n`;
        }
        if (diffSummary.changeTypes.deleted > 0) {
            generatedReview += `- ➖ **${diffSummary.changeTypes.deleted} files** deleted\n`;
        }
        if (diffSummary.changeTypes.renamed > 0) {
            generatedReview += `- 🔄 **${diffSummary.changeTypes.renamed} files** renamed\n`;
        }
        
        generatedReview += `\n`;
        
        // 主要な変更の説明
        if (diffSummary.mainChanges && diffSummary.mainChanges.length > 0) {
            generatedReview += `### Significant Changes:\n`;
            diffSummary.mainChanges.forEach(change => {
                generatedReview += `- **${change.path}** (${change.type}): ${change.changes} changes\n`;
            });
            generatedReview += `\n`;
        }
        
        // パターン分析の結果
        if (diffSummary.patterns) {
            generatedReview += `### Detected Patterns:\n`;
            
            if (diffSummary.patterns.newFeatures.length > 0) {
                generatedReview += `- ✨ **New Features**: ${diffSummary.patterns.newFeatures.join(', ')}\n`;
            }
            if (diffSummary.patterns.bugFixes.length > 0) {
                generatedReview += `- 🐛 **Bug Fixes**: ${diffSummary.patterns.bugFixes.join(', ')}\n`;
            }
            if (diffSummary.patterns.tests.length > 0) {
                generatedReview += `- 🧪 **Testing**: ${diffSummary.patterns.tests.join(', ')}\n`;
            }
            if (diffSummary.patterns.documentation.length > 0) {
                generatedReview += `- 📚 **Documentation**: ${diffSummary.patterns.documentation.join(', ')}\n`;
            }
            if (diffSummary.patterns.refactoring.length > 0) {
                generatedReview += `- 🔧 **Refactoring**: ${diffSummary.patterns.refactoring.join(', ')}\n`;
            }
            
            generatedReview += `\n`;
        }
        
        // 推奨事項
        generatedReview += `### Review Recommendations:\n`;
        if (diffSummary.estimatedImpact === 'high') {
            generatedReview += `- 🔴 This is a **high-impact** change requiring thorough review\n`;
            generatedReview += `- Pay special attention to architectural changes and breaking changes\n`;
            generatedReview += `- Ensure comprehensive testing coverage for modified areas\n`;
        } else if (diffSummary.estimatedImpact === 'medium') {
            generatedReview += `- 🟡 This is a **medium-impact** change with moderate complexity\n`;
            generatedReview += `- Focus on code quality and potential side effects\n`;
            generatedReview += `- Verify that existing functionality remains intact\n`;
        } else {
            generatedReview += `- 🟢 This is a **low-impact** change with minimal risk\n`;
            generatedReview += `- Standard review process should be sufficient\n`;
            generatedReview += `- Focus on code style and best practices\n`;
        }
        
        // 値を設定
        if (reviewTitle.value === '') {
            reviewTitle.value = generatedTitle;
        }
        reviewText.value = generatedReview;
        
        // スピナーを非表示
        spinner.classList.add('d-none');
        
        showSuccess('Review summary generated successfully!');
    }, 500); // シミュレートされた遅延
}

// 行範囲選択の処理
function handleLineSelection(lineElement) {
    console.log('handleLineSelection called', { 
        element: lineElement, 
        tagName: lineElement?.tagName,
        classes: lineElement?.className,
        selectionMode 
    });
    
    // 要素の有効性をチェック
    if (!lineElement || !lineElement.isConnected) {
        console.error('Invalid or disconnected line element passed to handleLineSelection');
        return;
    }
    
    // 行番号が取得できることを確認
    const lineNumber = getLineNumberFromElement(lineElement);
    if (lineNumber === 0) {
        console.warn('Could not get line number from element, skipping');
        return;
    }
    
    console.log(`Line number: ${lineNumber}`);
    
    if (!selectionMode) {
        // 選択開始
        console.log('Starting range selection');
        startRangeSelection(lineElement);
    } else {
        // 選択終了
        console.log('Ending range selection');
        endRangeSelection(lineElement);
    }
}

// 範囲選択開始
function startRangeSelection(lineElement) {
    console.log('Starting range selection on line:', lineElement);
    
    if (!lineElement || !lineElement.isConnected) {
        console.error('Cannot start selection on invalid element');
        return;
    }
    
    selectionMode = true;
    startLine = lineElement;
    
    // 開始行をハイライト
    lineElement.classList.add('line-selected', 'line-range-start');
    
    // 選択インジケーターを表示
    showSelectionIndicator('Click another line to complete range selection');
    
    // ビジュアルフィードバックを追加
    document.body.classList.add('range-selection-active');
    
    console.log('Range selection started successfully');
    
    // ツールチップを更新
    updateCommentButtonTooltips();
}

// 範囲選択終了
function endRangeSelection(lineElement) {
    console.log('Ending range selection on line:', lineElement);
    
    if (!lineElement || !lineElement.isConnected) {
        console.error('Cannot end selection on invalid element');
        cancelSelection();
        return;
    }
    
    if (!startLine || !startLine.isConnected) {
        console.error('Start line is invalid, canceling selection');
        cancelSelection();
        return;
    }
    
    endLine = lineElement;
    
    // 選択範囲を計算
    const range = calculateLineRange(startLine, endLine);
    
    if (range.length === 0) {
        showError('Invalid line range selected');
        cancelSelection();
        return;
    }
    
    console.log(`Selected range of ${range.length} lines`);
    
    // 範囲をハイライト
    highlightRange(range);
    
    // 範囲コメントモーダルを開く
    openRangeCommentModal(range);
    
    // ツールチップを元に戻す
    updateCommentButtonTooltips();
}

// 行番号を取得（最適化版）
function getLineNumberFromElement(lineElement) {
    // キャッシュされた行番号があれば使用
    if (lineElement.dataset.cachedLineNumber) {
        return parseInt(lineElement.dataset.cachedLineNumber);
    }
    
    // 複数のセレクタを試す
    const selectors = [
        '.d2h-code-linenumber',
        '.d2h-code-side-linenumber',
        '.d2h-line-number-content',
        '.d2h-line-number',
        'td:first-child'
    ];
    
    // 行要素自体がtrの場合
    if (lineElement.tagName === 'TR') {
        for (const selector of selectors) {
            const lineNumberCell = lineElement.querySelector(selector);
            if (lineNumberCell) {
                const text = lineNumberCell.textContent.trim();
                if (text.match(/^\d+$/)) {
                    const lineNum = parseInt(text);
                    lineElement.dataset.cachedLineNumber = lineNum;
                    return lineNum;
                }
            }
        }
    }
    
    // 親のtr要素を探す
    const row = lineElement.closest('tr');
    if (row) {
        for (const selector of selectors) {
            const lineNumberCell = row.querySelector(selector);
            if (lineNumberCell) {
                const text = lineNumberCell.textContent.trim();
                if (text.match(/^\d+$/)) {
                    const lineNum = parseInt(text);
                    lineElement.dataset.cachedLineNumber = lineNum;
                    return lineNum;
                }
            }
        }
    }
    
    return 0;
}

// 行範囲を計算（最適化版）
function calculateLineRange(startLineElement, endLineElement) {
    const startNum = getLineNumberFromElement(startLineElement);
    const endNum = getLineNumberFromElement(endLineElement);
    
    console.log(`Calculating range from line ${startNum} to ${endNum}`);
    
    if (startNum === 0 || endNum === 0) {
        console.error('Invalid line numbers:', { startNum, endNum });
        return [];
    }
    
    const min = Math.min(startNum, endNum);
    const max = Math.max(startNum, endNum);
    
    const range = [];
    
    // より効率的な方法：同じファイル内の行のみを検索
    const fileWrapper = startLineElement.closest('.d2h-file-wrapper');
    if (fileWrapper) {
        // 複数のセレクタで行を探す
        const linesInFile = fileWrapper.querySelectorAll(
            'tr.d2h-code-side-line, tr[class*="d2h-"], .d2h-diff-tbody tr'
        );
        
        console.log(`Found ${linesInFile.length} lines in file`);
        
        for (const line of linesInFile) {
            const lineNum = getLineNumberFromElement(line);
            if (lineNum >= min && lineNum <= max) {
                range.push({
                    element: line,
                    lineNumber: lineNum
                });
            }
        }
        
        // 範囲をソート（行番号順）
        range.sort((a, b) => a.lineNumber - b.lineNumber);
    }
    
    console.log(`Range contains ${range.length} lines`);
    return range;
}

// 範囲をハイライト
function highlightRange(range) {
    range.forEach((item, index) => {
        item.element.classList.add('line-selected');
        
        if (index === 0) {
            item.element.classList.add('line-range-start');
        } else if (index === range.length - 1) {
            item.element.classList.add('line-range-end');
        } else {
            item.element.classList.add('line-range-middle');
        }
    });
    
    selectedLines = range;
}

// 選択をキャンセル
function cancelSelection() {
    selectionMode = false;
    startLine = null;
    endLine = null;
    
    // ハイライトを削除
    document.querySelectorAll('.line-selected, .line-range-start, .line-range-end, .line-range-middle')
            .forEach(line => {
                line.classList.remove('line-selected', 'line-range-start', 'line-range-end', 'line-range-middle');
            });
    
    // 選択インジケーターを削除
    hideSelectionIndicator();
    
    // ビジュアルフィードバックを削除
    document.body.classList.remove('range-selection-active');
    
    selectedLines = [];
    
    // ツールチップを元に戻す
    updateCommentButtonTooltips();
}

// コメントボタンのツールチップを更新
function updateCommentButtonTooltips() {
    const commentButtons = document.querySelectorAll('.line-comment-btn');
    const tooltipText = selectionMode ? 
        'Click to complete range selection' : 
        'Click to start range selection';
    
    commentButtons.forEach(btn => {
        btn.title = tooltipText;
    });
}

// 選択インジケーターを表示
function showSelectionIndicator(message) {
    hideSelectionIndicator();
    
    selectionIndicator = document.createElement('div');
    selectionIndicator.className = 'selection-indicator alert alert-info';
    selectionIndicator.innerHTML = `
        <div class="d-flex align-items-center">
            <span class="me-2">🎯</span>
            <span>${message}</span>
            <button type="button" class="btn-close ms-auto" onclick="cancelSelection()"></button>
        </div>
    `;
    
    document.body.appendChild(selectionIndicator);
    
    // 位置を調整
    selectionIndicator.style.position = 'fixed';
    selectionIndicator.style.top = '80px';
    selectionIndicator.style.right = '20px';
    selectionIndicator.style.zIndex = '1050';
    selectionIndicator.style.minWidth = '300px';
    selectionIndicator.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
}

// 選択インジケーターを非表示
function hideSelectionIndicator() {
    if (selectionIndicator) {
        selectionIndicator.remove();
        selectionIndicator = null;
    }
}

// 範囲コメントモーダルを開く
function openRangeCommentModal(range) {
    const fileName = getFileFromLine(range[0].element);
    const startLineNum = range[0].lineNumber;
    const endLineNum = range[range.length - 1].lineNumber;
    
    // Locationフィールドを更新
    const locationText = startLineNum === endLineNum ? 
        `${fileName}:${startLineNum}` : 
        `${fileName}:${startLineNum}-${endLineNum}`;
    document.getElementById('commentLocation').value = locationText;
    document.getElementById('commentText').value = '';
    document.getElementById('commentType').value = 'suggestion';
    
    // 既存のモーダルを使用してファイル名と行番号を設定
    const form = document.getElementById('commentForm');
    form.dataset.fileName = fileName;
    form.dataset.lineNumber = startLineNum;
    form.dataset.endLineNumber = endLineNum;
    form.dataset.isRange = 'true';
    form.dataset.lineRange = JSON.stringify(range.map(item => item.lineNumber));
    
    // モーダルのタイトルを更新
    const modalTitle = document.querySelector('#commentModal .modal-title');
    if (startLineNum === endLineNum) {
        modalTitle.textContent = `💬 Comment on line ${startLineNum}`;
    } else {
        modalTitle.textContent = `🎯 Comment on lines ${startLineNum}-${endLineNum} (${range.length} lines)`;
    }
    
    // モーダルを表示
    const modal = new bootstrap.Modal(document.getElementById('commentModal'));
    modal.show();
    
    // 選択をクリア
    cancelSelection();
}

// パフォーマンス最適化関数

// DOM要素をキャッシュ
function cacheCodeLines() {
    console.log('Caching code lines...');
    
    // diff2htmlの実際の構造に合わせて複数のセレクターを試行
    const selectors = [
        'tr.d2h-code-side-line',      // サイドバイサイド表示用（最優先）
        'tr[class*="d2h-"]',         // d2hクラスを持つ全ての行
        '.d2h-diff-tbody tr',         // diff tbody内の行
        '.d2h-code-wrapper tr',       // コードラッパー内の行
        '.d2h-code-line',             // 元のセレクター
        'tbody tr',                   // 基本的なテーブル行
    ];
    
    let foundLines = null;
    for (const selector of selectors) {
        foundLines = document.querySelectorAll(selector);
        console.log(`Selector "${selector}" found ${foundLines.length} elements`);
        if (foundLines.length > 0) {
            // 実際のコード行のみをフィルタリング（ヘッダー行などを除外）
            const codeLines = Array.from(foundLines).filter(line => {
                return line.querySelector('.d2h-code-linenumber, .d2h-code-side-linenumber') !== null;
            });
            if (codeLines.length > 0) {
                cachedCodeLines = codeLines;
                console.log(`Filtered to ${codeLines.length} actual code lines`);
                break;
            }
        }
    }
    
    if (!cachedCodeLines || cachedCodeLines.length === 0) {
        console.error('No code lines found with any selector. DOM structure:');
        const diffContainer = document.getElementById('diffContainer');
        if (diffContainer) {
            console.log('DiffContainer HTML:', diffContainer.innerHTML.substring(0, 500));
        }
        return;
    }
    
    cachedFileMappings.clear();
    console.log(`Found ${cachedCodeLines.length} code lines to cache`);
    
    // ファイルマッピングを作成
    cachedCodeLines.forEach((line, index) => {
        const fileName = getFileFromLine(line);
        if (!cachedFileMappings.has(fileName)) {
            cachedFileMappings.set(fileName, []);
        }
        cachedFileMappings.get(fileName).push({ element: line, index: index });
    });
    
    console.log(`Cached mappings for ${cachedFileMappings.size} files`);
}

// キャッシュをクリア
function clearDOMCache() {
    console.log('Clearing DOM cache...');
    cachedCodeLines = null;
    cachedFileMappings.clear();
    
    // キャッシュクリア後は必ず再キャッシュが必要
    console.log('DOM cache cleared, will need recaching');
}

// 行番号キャッシュをクリア
function clearLineNumberCache() {
    if (cachedCodeLines) {
        cachedCodeLines.forEach(element => {
            delete element.dataset.cachedLineNumber;
        });
    } else {
        document.querySelectorAll('[data-cached-line-number]').forEach(element => {
            delete element.dataset.cachedLineNumber;
        });
    }
}

// 選択状態をリセット（新しいdiff読み込み時）
function resetSelectionState() {
    selectionMode = false;
    startLine = null;
    endLine = null;
    selectedLines = [];
    hideSelectionIndicator();
    
    // メモリクリーンアップ
    performMemoryCleanup();
    
    // 既存の選択ハイライトを削除
    document.querySelectorAll('.line-selected, .line-range-start, .line-range-end, .line-range-middle')
            .forEach(line => {
                line.classList.remove('line-selected', 'line-range-start', 'line-range-end', 'line-range-middle');
            });
}

// 包括的なメモリクリーンアップ
function performMemoryCleanup() {
    // DOM キャッシュクリア
    clearDOMCache();
    
    // イベントリスナーをリセット（新しいdiffのため）
    resetEventDelegation();
    
    // タイムアウトをクリア
    if (renderTimeout) {
        clearTimeout(renderTimeout);
        renderTimeout = null;
    }
    
    // ガベージコレクションのヒント（強制ではない）
    if (window.gc && typeof window.gc === 'function') {
        try {
            window.gc();
        } catch (e) {
            // ガベージコレクションが利用できない場合は無視
        }
    }
}

// イベント委任をリセット
function resetEventDelegation() {
    console.log('Resetting event delegation...');
    
    // 既存のイベントリスナーを削除
    if (currentDiffContainer && diffContainerClickHandler) {
        console.log('Removing event listener during reset');
        currentDiffContainer.removeEventListener('click', diffContainerClickHandler);
    }
    
    // 状態をクリア
    eventDelegationSetup = false;
    diffContainerClickHandler = null;
    currentDiffContainer = null;
    
    console.log('Event delegation reset completed');
}

// 範囲コメントを表示
function renderRangeComment(comment, codeLines) {
    // 範囲の最初の行を探す
    let targetLine = null;
    const startLineNum = parseInt(comment.lineNumber);
    
    for (let i = 0; i < codeLines.length; i++) {
        const lineNum = getLineNumberFromElement(codeLines[i]);
        if (lineNum === startLineNum) {
            targetLine = codeLines[i];
            break;
        }
    }
    
    if (targetLine) {
        const existingThread = targetLine.nextElementSibling;
        if (existingThread && existingThread.classList.contains('comment-thread')) {
            // 既存のコメントスレッドに追加
            const commentHtml = createRangeCommentHtml(comment);
            existingThread.insertAdjacentHTML('beforeend', commentHtml);
        } else {
            // 新しいコメントスレッドを作成
            const commentThread = document.createElement('div');
            commentThread.className = 'comment-thread range-comment-thread';
            commentThread.innerHTML = createRangeCommentHtml(comment);
            targetLine.parentNode.insertBefore(commentThread, targetLine.nextSibling);
        }
    }
}

// 範囲コメント用のHTMLを生成
function createRangeCommentHtml(comment) {
    const typeClass = comment.type || 'suggestion';
    const typeEmoji = {
        suggestion: '💡',
        issue: '⚠️',
        question: '❓',
        praise: '👍'
    };
    
    const lineDisplay = comment.endLineNumber ? 
        `Lines ${comment.lineNumber}-${comment.endLineNumber}` : 
        `Line ${comment.lineNumber}`;
    
    return `
        <div class="comment-item range-comment" data-id="${comment.id}">
            <div class="comment-header">
                <span class="comment-type ${typeClass}">${typeEmoji[comment.type] || '💬'} ${comment.type}</span>
                <span class="comment-range">${lineDisplay}</span>
                <span class="comment-time">${new Date(comment.timestamp).toLocaleString()}</span>
                <button class="btn btn-sm btn-link comment-delete" onclick="deleteComment('${comment.id}')">🗑️</button>
            </div>
            <div class="comment-text">${comment.text}</div>
        </div>
    `;
}