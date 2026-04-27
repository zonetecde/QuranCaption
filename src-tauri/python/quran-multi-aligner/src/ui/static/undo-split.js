function submitUndoSplit(undoBtn) {
    if (!undoBtn || undoBtn.disabled) return;

    var segIdx = parseInt(undoBtn.dataset.segment, 10);
    if (isNaN(segIdx)) return;

    if (typeof activeManualSplitCard !== 'undefined' && activeManualSplitCard) {
        exitManualSplit(activeManualSplitCard);
    }

    undoBtn.disabled = true;
    undoBtn.dataset.originalLabel = undoBtn.textContent || 'Undo split';
    undoBtn.textContent = 'Undoing...';

    var payloadStr = JSON.stringify({idx: segIdx});
    setGradioValue('undo-split-payload', payloadStr);
    setTimeout(function() {
        var btn = document.getElementById('undo-split-trigger');
        if (btn) btn.click();
    }, 50);

    setTimeout(function() {
        if (!undoBtn.isConnected) return;
        undoBtn.disabled = false;
        undoBtn.textContent = undoBtn.dataset.originalLabel || 'Undo split';
    }, 8000);
}

document.addEventListener('click', function(e) {
    var undoBtn = e.target.closest('.undo-split-btn');
    if (!undoBtn) return;
    submitUndoSplit(undoBtn);
});
