var activeManualSplitCard = null;
var MANUAL_SPLIT_MIN_TEXT_HEIGHT =
    Number(window.MANUAL_SPLIT_TEXT_MIN_HEIGHT_PX) || 96;
var MANUAL_SPLIT_MAX_TEXT_HEIGHT =
    Number(window.MANUAL_SPLIT_TEXT_MAX_HEIGHT_PX) || 420;

function getManualSplitRenderKey(card) {
    var container = card && card.closest ? card.closest('.segments-container') : null;
    return container && container.dataset ? (container.dataset.renderKey || '') : '';
}

function isStaleManualSplitCard(card) {
    if (!card) return false;
    var storedKey = card._manualSplitRenderKey || '';
    var currentKey = getManualSplitRenderKey(card);
    return !!storedKey && !!currentKey && storedKey !== currentKey;
}

function collectManualSplitContent(card) {
    var textDiv = card.querySelector('.segment-text');
    if (!textDiv) {
        return {words: [], items: []};
    }

    var words = [];
    var items = [];
    var wordIdx = -1;

    Array.from(textDiv.childNodes).forEach(function(node) {
        if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('word')) {
            var text = (node.textContent || '').trim();
            if (!text) return;
            wordIdx += 1;
            words.push({idx: wordIdx, text: text});
            items.push({type: 'word', wordIdx: wordIdx, text: text});
            return;
        }

        var markerText = (node.textContent || '').trim();
        if (!markerText || wordIdx < 0) return;
        items.push({type: 'marker', wordIdx: wordIdx, text: markerText});
    });

    return {words: words, items: items};
}

function resetManualSplitPending(card) {
    if (!card) return;
    delete card.dataset.manualSplitPending;
    delete card.dataset.manualSplitPendingToken;
    var confirmBtn = card.querySelector('.split-confirm-btn');
    if (!confirmBtn) return;
    confirmBtn.textContent = 'Confirm';
    confirmBtn.disabled = !card._manualSplitBoundaryStarts || card._manualSplitBoundaryStarts.size === 0;
}

function setManualSplitStableLayout(card, textDiv) {
    if (!card || !textDiv) return;
    var measured = Math.ceil(textDiv.getBoundingClientRect().height || textDiv.offsetHeight || 0);
    var minHeight = Math.max(MANUAL_SPLIT_MIN_TEXT_HEIGHT, measured);
    card.style.setProperty('--manual-split-text-min-height', minHeight + 'px');
    card.style.setProperty('--manual-split-text-max-height', MANUAL_SPLIT_MAX_TEXT_HEIGHT + 'px');
}

function clearManualSplitStableLayout(card) {
    if (!card) return;
    card.style.removeProperty('--manual-split-text-min-height');
    card.style.removeProperty('--manual-split-text-max-height');
}

function exitManualSplit(card) {
    if (!card) return;
    var textDiv = card.querySelector('.segment-text');
    if (textDiv && typeof card._manualSplitOriginalHtml === 'string' && !isStaleManualSplitCard(card)) {
        textDiv.innerHTML = card._manualSplitOriginalHtml;
    }
    card.classList.remove('manual-split-mode');
    resetManualSplitPending(card);
    card._manualSplitBoundaryStarts = null;
    card._manualSplitOriginalHtml = null;
    card._manualSplitWords = null;
    card._manualSplitItems = null;
    card._manualSplitPreviewWordEls = null;
    card._manualSplitPreviewBreakEls = null;
    card._manualSplitRenderKey = null;
    clearManualSplitStableLayout(card);
    if (activeManualSplitCard === card) activeManualSplitCard = null;
}

function exitOtherManualSplitModes(exceptCard) {
    if (activeManualSplitCard && activeManualSplitCard !== exceptCard) {
        exitManualSplit(activeManualSplitCard);
    }
}

function ensureManualSplitPreview(card) {
    var textDiv = card.querySelector('.segment-text');
    var words = card._manualSplitWords || [];
    var items = card._manualSplitItems || [];
    if (!textDiv || !words.length) return;
    if (card._manualSplitPreviewWordEls && card._manualSplitPreviewBreakEls) return;

    var wrapper = document.createElement('div');
    wrapper.className = 'split-preview';
    var flow = document.createElement('div');
    flow.className = 'split-preview-flow';
    var wordEls = new Array(words.length);
    var breakEls = {};

    items.forEach(function(item, itemIdx) {
        if (itemIdx > 0) {
            flow.appendChild(document.createTextNode(' '));
        }

        if (item.type === 'word') {
            if (item.wordIdx > 0) {
                var br = document.createElement('br');
                br.className = 'split-preview-break';
                br.dataset.startIndex = String(item.wordIdx);
                flow.appendChild(br);
                breakEls[item.wordIdx] = br;
            }

            var span = document.createElement('span');
            span.className = 'split-preview-word';
            span.textContent = item.text;
            span.dataset.wordIndex = String(item.wordIdx);
            wordEls[item.wordIdx] = span;
            flow.appendChild(span);
        } else {
            var marker = document.createElement('span');
            marker.className = 'split-preview-marker';
            marker.textContent = item.text;
            flow.appendChild(marker);
        }
    });

    wrapper.appendChild(flow);

    textDiv.innerHTML = '';
    textDiv.appendChild(wrapper);
    card._manualSplitPreviewWordEls = wordEls;
    card._manualSplitPreviewBreakEls = breakEls;
}

function renderManualSplitPreview(card) {
    var words = card._manualSplitWords || [];
    var boundaries = card._manualSplitBoundaryStarts || new Set();
    if (!words.length) return;

    ensureManualSplitPreview(card);

    var wordEls = card._manualSplitPreviewWordEls || [];
    var breakEls = card._manualSplitPreviewBreakEls || {};

    for (var i = 0; i < wordEls.length; i++) {
        var wordEl = wordEls[i];
        if (!wordEl) continue;
        wordEl.classList.toggle('can-cut', (i > 0 && boundaries.has(i)) || i < words.length - 1);
        wordEl.classList.toggle('boundary-start', boundaries.has(i));
        wordEl.classList.toggle('boundary-end', boundaries.has(i + 1));
    }

    Object.keys(breakEls).forEach(function(startIdx) {
        var breakEl = breakEls[startIdx];
        if (!breakEl) return;
        breakEl.classList.toggle('active', boundaries.has(Number(startIdx)));
    });

    var confirmBtn = card.querySelector('.split-confirm-btn');
    if (confirmBtn) {
        confirmBtn.disabled = boundaries.size === 0 || card.dataset.manualSplitPending === '1';
    }
}

function enterManualSplit(card) {
    if (!card) return;
    exitOtherManualSplitModes(card);

    var textDiv = card.querySelector('.segment-text');
    var content = collectManualSplitContent(card);
    var words = content.words;
    if (!textDiv || words.length < 2) return;

    var audio = card.querySelector('audio');
    if (audio) {
        audio.pause();
        stopAnimation(audio, card);
    }
    var animBtn = card.querySelector('.animate-btn');
    if (animBtn) {
        animBtn.classList.remove('active');
        animBtn.textContent = 'Animate';
    }

    card._manualSplitOriginalHtml = textDiv.innerHTML;
    card._manualSplitWords = words;
    card._manualSplitItems = content.items;
    card._manualSplitRenderKey = getManualSplitRenderKey(card);
    setManualSplitStableLayout(card, textDiv);

    card._manualSplitBoundaryStarts = new Set();
    card.classList.add('manual-split-mode');
    activeManualSplitCard = card;
    resetManualSplitPending(card);
    renderManualSplitPreview(card);
}

function toggleManualSplitBoundary(card, wordIdx) {
    var words = card._manualSplitWords || [];
    if (!words.length) return;
    if (!card._manualSplitBoundaryStarts) {
        card._manualSplitBoundaryStarts = new Set();
    }

    if (wordIdx > 0 && card._manualSplitBoundaryStarts.has(wordIdx)) {
        card._manualSplitBoundaryStarts.delete(wordIdx);
    } else if (wordIdx < words.length - 1 && card._manualSplitBoundaryStarts.has(wordIdx + 1)) {
        card._manualSplitBoundaryStarts.delete(wordIdx + 1);
    } else if (wordIdx < words.length - 1) {
        card._manualSplitBoundaryStarts.add(wordIdx + 1);
    }

    renderManualSplitPreview(card);
}

function submitManualSplit(card) {
    if (!card || card.dataset.manualSplitPending === '1') return;
    var boundaries = card._manualSplitBoundaryStarts;
    if (!boundaries || boundaries.size === 0) return;

    var cuts = Array.from(boundaries).sort(function(a, b) { return a - b; }).map(function(startIdx) {
        return startIdx - 1;
    });
    var segIdx = parseInt(card.getAttribute('data-segment-idx'), 10);
    if (isNaN(segIdx)) return;

    var confirmBtn = card.querySelector('.split-confirm-btn');
    var token = String(Date.now());
    card.dataset.manualSplitPending = '1';
    card.dataset.manualSplitPendingToken = token;
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Processing...';
    }

    var payloadStr = JSON.stringify({idx: segIdx, cuts: cuts});
    setGradioValue('manual-split-payload', payloadStr);
    setTimeout(function() {
        var btn = document.getElementById('manual-split-trigger');
        if (btn) btn.click();
    }, 50);

    setTimeout(function() {
        if (!card.isConnected) return;
        if (!card.classList.contains('manual-split-mode')) return;
        if (card.dataset.manualSplitPendingToken !== token) return;
        resetManualSplitPending(card);
    }, 8000);
}

document.addEventListener('click', function(e) {
    var splitBtn = e.target.closest('.manual-split-btn');
    if (splitBtn) {
        enterManualSplit(splitBtn.closest('.segment-card'));
        return;
    }

    var cancelBtn = e.target.closest('.split-cancel-btn');
    if (cancelBtn) {
        exitManualSplit(cancelBtn.closest('.segment-card'));
        return;
    }

    var confirmBtn = e.target.closest('.split-confirm-btn');
    if (confirmBtn) {
        submitManualSplit(confirmBtn.closest('.segment-card'));
        return;
    }

    var splitWord = e.target.closest('.split-preview-word');
    if (splitWord) {
        var card = splitWord.closest('.segment-card');
        var wordIdx = parseInt(splitWord.dataset.wordIndex, 10);
        if (!isNaN(wordIdx)) {
            toggleManualSplitBoundary(card, wordIdx);
        }
    }
});
