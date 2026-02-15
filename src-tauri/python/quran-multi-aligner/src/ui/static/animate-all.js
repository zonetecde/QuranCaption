// =====================================================================
// Surah name ligature map (font triggers)
// =====================================================================
var surahLigatures = window.SURAH_LIGATURES;

// =====================================================================
// Animate All — continuous text stream with repetition handling
// =====================================================================
var animateAllState = {
    active: false,
    currentIdx: 0,
    segments: [],   // [{startTime, endTime, cacheWords, cacheChars, wordEls}]
    rafId: null,
    megaCard: null,
    textFlow: null,  // the unified .mega-text-flow container
    btn: null,
    unifiedCacheWords: [],
    unifiedCacheChars: [],
    unifiedAudio: null,  // Single audio element for entire recording
    accordionParent: null,
    accordionNextSibling: null,
    completedIdx: -1
};

function buildMegaCard() {
    var container = document.querySelector('.segments-container');
    if (!container) return null;

    // Create unified audio element from full audio URL
    var fullAudioUrl = container.dataset.fullAudio;
    var unifiedAudio = null;
    if (fullAudioUrl) {
        unifiedAudio = document.createElement('audio');
        unifiedAudio.src = fullAudioUrl;
        unifiedAudio.preload = 'auto';
        unifiedAudio.style.display = 'none';
    }

    var cards = Array.from(container.querySelectorAll('.segment-card'));
    var mega = document.createElement('div');
    mega.className = 'mega-card';
    var textFlow = document.createElement('div');
    textFlow.className = 'mega-text-flow';

    var renderedPositions = {};  // data-pos string -> DOM element in textFlow
    var renderedCharEls = {};    // data-pos string -> Array of .char elements
    var renderedMarkers = {};    // "surah:marker" -> true, to avoid duplicate verse markers
    var frag = document.createDocumentFragment();
    var segments = [];
    var lastSurah = null;
    var pendingSpecial = null;  // buffered special text to flush after surah separator

    // Helper: flush pending special line into fragment
    function flushPendingSpecial() {
        if (!pendingSpecial) return;
        var prevChild = frag.lastChild;
        if (prevChild && prevChild.classList && prevChild.classList.contains('mega-special-line')) {
            prevChild.textContent += '    ' + pendingSpecial;
        } else {
            var specialLine = document.createElement('div');
            specialLine.className = 'mega-special-line';
            specialLine.textContent = pendingSpecial;
            frag.appendChild(specialLine);
        }
        pendingSpecial = null;
    }

    cards.forEach(function(card) {
        var btn = card.querySelector('.animate-btn');
        var ref = (card.dataset.matchedRef || '').trim();
        var isSpecial = (ref === 'Basmala' || ref === "Isti'adha");

        if (!btn || btn.disabled) {
            // Special segment without timestamps — buffer static text
            if (isSpecial || ref === '') {
                var textEl = card.querySelector('.segment-text');
                if (textEl) {
                    var txt = textEl.textContent.trim();
                    if (txt) {
                        if (pendingSpecial) {
                            pendingSpecial += '    ' + txt;
                        } else {
                            pendingSpecial = txt;
                        }
                    }
                }
            }
            return;
        }

        // Animated special segment (has timestamps) — centered line with word animation
        if (isSpecial) {
            var textEl = card.querySelector('.segment-text');
            if (!textEl) return;

            // Extract segment boundaries from card data attributes
            var segStartTime = parseFloat(card.dataset.startTime) || 0;
            var segEndTime = parseFloat(card.dataset.endTime) || 0;

            // Flush any buffered specials first
            flushPendingSpecial();

            var specialDiv;
            var prevChild = frag.lastChild;
            if (prevChild && prevChild.classList && prevChild.classList.contains('mega-special-line')) {
                specialDiv = prevChild;
                specialDiv.appendChild(document.createTextNode('    '));
            } else {
                specialDiv = document.createElement('div');
                specialDiv.className = 'mega-special-line';
                frag.appendChild(specialDiv);
            }

            var sourceWords = Array.from(textEl.querySelectorAll('.word'));
            var segWordEls = [];
            var segWordTimings = [];
            var segCharTimings = [];
            var unifiedCharEls = {};

            sourceWords.forEach(function(node) {
                var pos = node.dataset.pos;
                var clone = node.cloneNode(true);
                specialDiv.appendChild(document.createTextNode(' '));
                specialDiv.appendChild(clone);
                if (pos) renderedPositions[pos] = clone;
                segWordEls.push(clone);

                segWordTimings.push({
                    start: parseFloat(node.dataset.start) || 0,
                    end: parseFloat(node.dataset.end) || 0
                });

                var wordIdx = segWordEls.length - 1;
                var chars = Array.from(clone.children);
                unifiedCharEls[wordIdx] = chars;
                if (pos) renderedCharEls[pos] = chars;

                Array.from(node.children).forEach(function(srcChar) {
                    segCharTimings.push({
                        start: parseFloat(srcChar.dataset.start) || 0,
                        end: parseFloat(srcChar.dataset.end) || 0,
                        parentWordIdx: wordIdx
                    });
                });
            });

            if (segWordEls.length === 0) return;

            var cacheWords = segWordEls.map(function(el, j) {
                return { el: el, start: segWordTimings[j].start, end: segWordTimings[j].end };
            });
            var cacheChars = [];
            var charCountPerWord = {};
            segCharTimings.forEach(function(ct) {
                var wIdx = ct.parentWordIdx;
                if (charCountPerWord[wIdx] === undefined) charCountPerWord[wIdx] = 0;
                var charIdxInWord = charCountPerWord[wIdx]++;
                var unifiedChars = unifiedCharEls[wIdx];
                if (unifiedChars && charIdxInWord < unifiedChars.length) {
                    cacheChars.push({ el: unifiedChars[charIdxInWord], start: ct.start, end: ct.end });
                }
            });

            segments.push({
                startTime: segStartTime,
                endTime: segEndTime,
                cacheWords: cacheWords,
                cacheChars: cacheChars,
                wordEls: segWordEls
            });
            return;
        }

        var textEl = card.querySelector('.segment-text');
        if (!textEl) return;

        // Extract segment boundaries from card data attributes
        var segStartTime = parseFloat(card.dataset.startTime) || 0;
        var segEndTime = parseFloat(card.dataset.endTime) || 0;

        // Detect fused special prefix: leading .word elements with :0:0: in data-pos
        var allWords = Array.from(textEl.querySelectorAll('.word'));
        var fusedWords = [];
        var fusedHasTimestamps = false;
        for (var fi = 0; fi < allWords.length; fi++) {
            var fpos = allWords[fi].dataset.pos || '';
            if (fpos && fpos.indexOf(':0:0:') !== -1) {
                fusedWords.push(allWords[fi]);
                if (allWords[fi].dataset.start) fusedHasTimestamps = true;
            } else if (fpos) {
                break;  // stop at first verse word
            } else {
                // No data-pos at all (old-style) — static fallback
                fusedWords = [];
                break;
            }
        }

        if (fusedWords.length > 0 && fusedHasTimestamps) {
            // Animated fused prefix — clone into a mega-special-line, share audio
            flushPendingSpecial();
            var fusedDiv;
            var prevChild = frag.lastChild;
            if (prevChild && prevChild.classList && prevChild.classList.contains('mega-special-line')) {
                fusedDiv = prevChild;
                fusedDiv.appendChild(document.createTextNode('    '));
            } else {
                fusedDiv = document.createElement('div');
                fusedDiv.className = 'mega-special-line';
                frag.appendChild(fusedDiv);
            }
            var fusedWordEls = [];
            var fusedWordTimings = [];
            var fusedCharTimings = [];
            var fusedCharEls = {};
            fusedWords.forEach(function(node) {
                var clone = node.cloneNode(true);
                fusedDiv.appendChild(document.createTextNode(' '));
                fusedDiv.appendChild(clone);
                var pos = node.dataset.pos;
                if (pos) renderedPositions[pos] = clone;
                fusedWordEls.push(clone);
                fusedWordTimings.push({
                    start: parseFloat(node.dataset.start) || 0,
                    end: parseFloat(node.dataset.end) || 0
                });
                var wordIdx = fusedWordEls.length - 1;
                var chars = Array.from(clone.children);
                fusedCharEls[wordIdx] = chars;
                if (pos) renderedCharEls[pos] = chars;
                Array.from(node.children).forEach(function(srcChar) {
                    fusedCharTimings.push({
                        start: parseFloat(srcChar.dataset.start) || 0,
                        end: parseFloat(srcChar.dataset.end) || 0,
                        parentWordIdx: wordIdx
                    });
                });
            });
            // These fused words will be added to the same segment entry below
            // (they share the audio with the verse words)
        } else if (fusedWords.length > 0) {
            // Fused prefix without timestamps — static text fallback
            var fusedTxt = fusedWords.map(function(w) { return w.textContent; }).join(' ').trim();
            if (fusedTxt) {
                if (pendingSpecial) {
                    pendingSpecial += '    ' + fusedTxt;
                } else {
                    pendingSpecial = fusedTxt;
                }
            }
        }

        var sourceWords = Array.from(textEl.querySelectorAll('.word'));
        var segWordEls = [];    // unified DOM elements this segment animates
        var segWordTimings = []; // {start, end} from source card
        var segCharTimings = []; // [{start, end, parentWordIdx}, ...]
        var unifiedCharEls = {};  // wordIdx -> Array of .char elements in unified DOM

        // Iterate source childNodes to copy words + verse markers, deduplicating by data-pos
        var childNodes = Array.from(textEl.childNodes);
        var lastWasNew = false;  // track if the last word was newly appended
        childNodes.forEach(function(node) {
            if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('word')) {
                var pos = node.dataset.pos;
                if (!pos) return;  // skip words without data-pos
                if (pos.indexOf(':0:0:') !== -1) return;  // skip fused prefix words (handled above)
                if (renderedPositions[pos]) {
                    // Word already in unified text — reuse existing element
                    segWordEls.push(renderedPositions[pos]);
                    lastWasNew = false;
                } else {
                    // New word — clone and append
                    var clone = node.cloneNode(true);
                    // Detect surah change for separator
                    var posParts = pos.split(':');
                    if (posParts.length >= 1 && posParts[0]) {
                        var wordSurah = posParts[0];
                        if (wordSurah !== lastSurah) {
                            var sepDiv = document.createElement('div');
                            sepDiv.className = 'mega-surah-separator';
                            if (lastSurah === null) sepDiv.style.borderTop = 'none';
                            var ligKey = 'surah-' + wordSurah;
                            sepDiv.textContent = surahLigatures[ligKey] || wordSurah;
                            // Insert before any trailing special line so separator comes before basmala
                            var trailingSpecial = frag.lastChild;
                            if (trailingSpecial && trailingSpecial.classList && trailingSpecial.classList.contains('mega-special-line')) {
                                frag.insertBefore(sepDiv, trailingSpecial);
                            } else {
                                frag.appendChild(sepDiv);
                            }
                        }
                        lastSurah = wordSurah;
                    }
                    // Flush buffered special text after separator, before first word
                    flushPendingSpecial();
                    frag.appendChild(document.createTextNode(' '));
                    frag.appendChild(clone);
                    if (pos) {
                        renderedPositions[pos] = clone;
                    }
                    segWordEls.push(clone);
                    lastWasNew = true;
                }
                // Read timing from source word
                segWordTimings.push({
                    start: parseFloat(node.dataset.start) || 0,
                    end: parseFloat(node.dataset.end) || 0
                });
                // Read char timings from source and cache unified char elements
                var wordIdx = segWordEls.length - 1;
                var pos2 = node.dataset.pos;
                if (pos2 && renderedCharEls[pos2]) {
                    unifiedCharEls[wordIdx] = renderedCharEls[pos2];
                } else {
                    var chars = Array.from(segWordEls[wordIdx].children);
                    unifiedCharEls[wordIdx] = chars;
                    if (pos2) renderedCharEls[pos2] = chars;
                }
                var srcChars = Array.from(node.children);
                srcChars.forEach(function(srcChar) {
                    segCharTimings.push({
                        start: parseFloat(srcChar.dataset.start) || 0,
                        end: parseFloat(srcChar.dataset.end) || 0,
                        parentWordIdx: wordIdx
                    });
                });
            } else if (node.nodeType === Node.ELEMENT_NODE && lastWasNew) {
                // Verse marker or other non-word element — append only if preceding word was new
                var markerText = node.textContent || '';
                var markerKey = (lastSurah || '') + ':' + markerText.trim();
                if (!markerText.trim() || !renderedMarkers[markerKey]) {
                    frag.appendChild(document.createTextNode(' '));
                    var markerSpan = document.createElement('span');
                    markerSpan.className = 'verse-marker';
                    markerSpan.title = 'Jump to this verse';
                    markerSpan.appendChild(node.cloneNode(true));
                    // Extract verse from preceding word's data-pos (surah:ayah:word)
                    var lastWordPos = segWordEls.length > 0 ? (segWordEls[segWordEls.length - 1].dataset.pos || '') : '';
                    var posPartsM = lastWordPos.split(':');
                    if (posPartsM.length >= 2) markerSpan.dataset.verse = posPartsM[0] + ':' + posPartsM[1];
                    frag.appendChild(markerSpan);
                    if (markerText.trim()) renderedMarkers[markerKey] = true;
                }
            } else if (node.nodeType === Node.TEXT_NODE && lastWasNew) {
                // Verse markers are plain text nodes (e.g. ۝٢٥٥), not elements
                var txt = node.textContent || '';
                if (txt.trim()) {
                    var markerKey = (lastSurah || '') + ':' + txt.trim();
                    if (!renderedMarkers[markerKey]) {
                        frag.appendChild(document.createTextNode(' '));
                        var markerSpan2 = document.createElement('span');
                        markerSpan2.className = 'verse-marker';
                        markerSpan2.title = 'Jump to this verse';
                        markerSpan2.textContent = txt.trim();
                        var lastWordPos2 = segWordEls.length > 0 ? (segWordEls[segWordEls.length - 1].dataset.pos || '') : '';
                        var posPartsM2 = lastWordPos2.split(':');
                        if (posPartsM2.length >= 2) markerSpan2.dataset.verse = posPartsM2[0] + ':' + posPartsM2[1];
                        frag.appendChild(markerSpan2);
                        renderedMarkers[markerKey] = true;
                    }
                }
            }
        });

        if (segWordEls.length === 0) return;

        // Build caches: pair source timings with unified DOM elements
        var cacheWords = segWordEls.map(function(el, j) {
            return {
                el: el,
                start: segWordTimings[j].start,
                end: segWordTimings[j].end
            };
        });

        // Build char cache using pre-collected unified char elements
        var cacheChars = [];
        var charCountPerWord = {};
        segCharTimings.forEach(function(ct) {
            var wIdx = ct.parentWordIdx;
            if (charCountPerWord[wIdx] === undefined) charCountPerWord[wIdx] = 0;
            var charIdxInWord = charCountPerWord[wIdx]++;
            var unifiedChars = unifiedCharEls[wIdx];
            if (unifiedChars && charIdxInWord < unifiedChars.length) {
                cacheChars.push({
                    el: unifiedChars[charIdxInWord],
                    start: ct.start,
                    end: ct.end
                });
            }
        });

        // Prepend animated fused prefix words/chars (same audio segment)
        if (typeof fusedWordEls !== 'undefined' && fusedWordEls.length > 0 && fusedHasTimestamps) {
            var fusedCacheWords = fusedWordEls.map(function(el, j) {
                return { el: el, start: fusedWordTimings[j].start, end: fusedWordTimings[j].end };
            });
            var fusedCacheChars = [];
            var fusedCharCount = {};
            fusedCharTimings.forEach(function(ct) {
                var wIdx = ct.parentWordIdx;
                if (fusedCharCount[wIdx] === undefined) fusedCharCount[wIdx] = 0;
                var charIdx = fusedCharCount[wIdx]++;
                var chars = fusedCharEls[wIdx];
                if (chars && charIdx < chars.length) {
                    fusedCacheChars.push({ el: chars[charIdx], start: ct.start, end: ct.end });
                }
            });
            cacheWords = fusedCacheWords.concat(cacheWords);
            cacheChars = fusedCacheChars.concat(cacheChars);
            segWordEls = fusedWordEls.concat(segWordEls);
            // Reset fused state for next card
            fusedWordEls = []; fusedHasTimestamps = false;
        }

        // Build group index for segment caches (for character grouping in animations)
        buildGroupIndex(cacheWords);
        buildGroupIndex(cacheChars);

        segments.push({
            startTime: segStartTime,
            endTime: segEndTime,
            cacheWords: cacheWords,
            cacheChars: cacheChars,
            wordEls: segWordEls
        });
    });

    // Flush any remaining buffered special text
    flushPendingSpecial();

    textFlow.appendChild(frag);
    // Build unified caches so Window mode spans all segments.
    // Deduplicate: each DOM element appears once (shared elements from
    // repeated segments reuse the first segment's unified index).
    var unifiedWords = [];
    var unifiedChars = [];
    var wordElToIdx = new Map();
    var charElToIdx = new Map();
    var elToFirstSeg = new Map();
    segments.forEach(function(seg, sIdx) {
        seg.sharedEls = new Set();
        seg.unifiedWordMap = [];
        seg.unifiedCharMap = [];
        for (var i = 0; i < seg.cacheWords.length; i++) {
            var el = seg.cacheWords[i].el;
            if (wordElToIdx.has(el)) {
                seg.unifiedWordMap.push(wordElToIdx.get(el));
                seg.sharedEls.add(el);
                segments[elToFirstSeg.get(el)].sharedEls.add(el);
            } else {
                var idx = unifiedWords.length;
                wordElToIdx.set(el, idx);
                elToFirstSeg.set(el, sIdx);
                seg.unifiedWordMap.push(idx);
                unifiedWords.push(seg.cacheWords[i]);
            }
        }
        for (var i = 0; i < seg.cacheChars.length; i++) {
            var el = seg.cacheChars[i].el;
            if (charElToIdx.has(el)) {
                seg.unifiedCharMap.push(charElToIdx.get(el));
            } else {
                var idx = unifiedChars.length;
                charElToIdx.set(el, idx);
                seg.unifiedCharMap.push(idx);
                unifiedChars.push(seg.cacheChars[i]);
            }
        }
    });
    // Tag each word/char element with its segment index for click-to-seek
    segments.forEach(function(seg, sIdx) {
        seg.cacheWords.forEach(function(c) { c.el.dataset.segIdx = sIdx; });
        seg.cacheChars.forEach(function(c) { c.el.dataset.segIdx = sIdx; });
    });
    // Build group index for unified caches (for character grouping across all segments)
    buildGroupIndex(unifiedWords);
    buildGroupIndex(unifiedChars);

    animateAllState.segments = segments;
    animateAllState.unifiedCacheWords = unifiedWords;
    animateAllState.unifiedCacheChars = unifiedChars;
    animateAllState.textFlow = textFlow;
    animDebug('MEGA', 'buildMegaCard: ' + segments.length + ' segments, unifiedWords=' + unifiedWords.length + ' unifiedChars=' + unifiedChars.length);
    dumpCacheTimestamps(unifiedWords, 'Unified Words');
    dumpCacheTimestamps(unifiedChars, 'Unified Chars');
    mega.appendChild(textFlow);

    // Build top bar with Exit button (placed outside mega card)
    var topBar = document.createElement('div');
    topBar.className = 'mega-top-bar';
    var exitBtn = document.createElement('button');
    exitBtn.className = 'mega-exit-btn';
    exitBtn.textContent = 'Exit';
    exitBtn.title = 'Exit and return to individual segments';
    topBar.appendChild(exitBtn);
    // Speed dropdown
    var speedSelect = document.createElement('select');
    speedSelect.className = 'mega-speed-select';
    speedSelect.title = 'Playback speed';
    [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].forEach(function(r) {
        var opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r + 'x';
        if (r === (window.ANIM_PLAYBACK_RATE || 1)) opt.selected = true;
        speedSelect.appendChild(opt);
    });
    speedSelect.addEventListener('change', function() {
        var rate = parseFloat(speedSelect.value);
        window.ANIM_PLAYBACK_RATE = rate;
        if (animateAllState.unifiedAudio) {
            animateAllState.unifiedAudio.playbackRate = rate;
        }
        saveAnimSettings();
    });
    topBar.appendChild(speedSelect);
    return {mega: mega, topBar: topBar, unifiedAudio: unifiedAudio};
}

// Reset highlight state for backward transitions (cache-based, no DOM queries)
function resetHighlightsFrom(segIdx) {
    for (var s = segIdx; s < animateAllState.segments.length; s++) {
        var seg = animateAllState.segments[s];
        seg.cacheWords.forEach(function(c) {
            c.el.classList.remove('active', 'reached');
            c.el.style.removeProperty('opacity');
        });
        seg.cacheChars.forEach(function(c) {
            c.el.classList.remove('active', 'reached');
            c.el.style.removeProperty('opacity');
        });
    }
    // Re-apply 'reached' to shared elements belonging to completed earlier segments
    for (var s = 0; s < segIdx && s <= animateAllState.completedIdx; s++) {
        var prev = animateAllState.segments[s];
        if (!prev.sharedEls || prev.sharedEls.size === 0) continue;
        prev.cacheWords.forEach(function(c) {
            if (prev.sharedEls.has(c.el)) c.el.classList.add('reached');
        });
        prev.cacheChars.forEach(function(c) {
            if (prev.sharedEls.has(c.el)) c.el.classList.add('reached');
        });
    }
}

function startSegmentTick(seg, audio, segStartTime, segEndTime) {
    var lastWordIdx = -1;
    var lastGranularity = window.ANIM_GRANULARITY;
    var lastOpacityPrev = window.ANIM_OPACITY_PREV;
    var lastSeenVersion = window._windowSettingsVersion;
    var segIdx = animateAllState.currentIdx;
    animDebug('MEGA', 'startSegmentTick seg=' + segIdx + ' cacheWords=' + seg.cacheWords.length + ' cacheChars=' + seg.cacheChars.length + ' bounds=[' + segStartTime.toFixed(3) + ',' + segEndTime.toFixed(3) + ']');
    function tick() {
        if (audio.paused) return;
        var currentTime = audio.currentTime;

        // Check segment end boundary (unified audio spans all segments)
        if (currentTime >= segEndTime) {
            onAnimateAllSegmentEnd();
            return;
        }

        var cache = window.ANIM_GRANULARITY === 'Characters' ? seg.cacheChars : seg.cacheWords;
        if (window.ANIM_GRANULARITY !== lastGranularity) {
            animDebug('MEGA', 'Granularity changed: ' + lastGranularity + ' -> ' + window.ANIM_GRANULARITY);
            // Granularity changed mid-animation: reset this segment's elements
            seg.wordEls.forEach(function(w) {
                w.classList.remove('active');
                w.style.removeProperty('opacity');
                w.querySelectorAll('.char').forEach(function(c) {
                    c.classList.remove('active');
                    c.style.removeProperty('opacity');
                });
            });
            // Clear inline opacity across all segments (previous segments may have inline opacity)
            animateAllState.unifiedCacheWords.forEach(function(c) { c.el.style.removeProperty('opacity'); });
            animateAllState.unifiedCacheChars.forEach(function(c) { c.el.style.removeProperty('opacity'); });
            lastWordIdx = -1;
            lastGranularity = window.ANIM_GRANULARITY;
        }

        // Mode changed mid-animation — refresh all reached words with new opacity
        if (window.ANIM_OPACITY_PREV !== lastOpacityPrev) {
            animDebug('MEGA', 'Mode changed: prevOp ' + lastOpacityPrev + ' -> ' + window.ANIM_OPACITY_PREV);
            animateAllState.unifiedCacheWords.forEach(function(c) {
                if (c.el.classList.contains('reached')) {
                    if (window.ANIM_OPACITY_PREV >= 1) {
                        c.el.style.removeProperty('opacity');
                    } else {
                        c.el.style.opacity = String(window.ANIM_OPACITY_PREV);
                    }
                }
            });
            animateAllState.unifiedCacheChars.forEach(function(c) {
                if (c.el.classList.contains('reached')) {
                    if (window.ANIM_OPACITY_PREV >= 1) {
                        c.el.style.removeProperty('opacity');
                    } else {
                        c.el.style.opacity = String(window.ANIM_OPACITY_PREV);
                    }
                }
            });
            lastOpacityPrev = window.ANIM_OPACITY_PREV;
        }

        // Slider settings changed mid-animation — reapply window opacity
        if (window._windowSettingsVersion !== lastSeenVersion) {
            if (lastWordIdx >= 0) {
                var wc = window.ANIM_GRANULARITY === 'Characters'
                    ? animateAllState.unifiedCacheChars : animateAllState.unifiedCacheWords;
                var map = window.ANIM_GRANULARITY === 'Characters'
                    ? seg.unifiedCharMap : seg.unifiedWordMap;
                if (map[lastWordIdx] !== undefined) {
                    applyWindowOpacity(wc, map[lastWordIdx], map[lastWordIdx]);
                }
            }
            lastSeenVersion = window._windowSettingsVersion;
        }

        var newWordIdx = -1;
        var searchPath = '';
        // Fast path: check current word, then next (covers ~99% of frames)
        if (lastWordIdx >= 0 && lastWordIdx < cache.length &&
            currentTime >= cache[lastWordIdx].start && currentTime < cache[lastWordIdx].end) {
            newWordIdx = lastWordIdx;
            searchPath = 'same';
        } else if (lastWordIdx + 1 < cache.length &&
            currentTime >= cache[lastWordIdx + 1].start && currentTime < cache[lastWordIdx + 1].end) {
            newWordIdx = lastWordIdx + 1;
            searchPath = 'next';
        } else {
            // Fallback: full scan (seeking, granularity switch, etc.)
            searchPath = 'scan';
            for (var i = 0; i < cache.length; i++) {
                if (currentTime >= cache[i].start && currentTime < cache[i].end) {
                    newWordIdx = i;
                    break;
                }
            }
            // Clamp to last word when past its end but audio hasn't ended yet
            if (newWordIdx === -1 && cache.length > 0 && currentTime >= cache[cache.length - 1].start) {
                newWordIdx = cache.length - 1;
                searchPath = 'clamp';
            }
        }
        if (newWordIdx !== lastWordIdx) {
            var newText = newWordIdx >= 0 ? cache[newWordIdx].el.textContent.substring(0, 15) : '-';
            animDebug('MEGA', 'seg=' + segIdx + ' idx: ' + lastWordIdx + ' -> ' + newWordIdx + ' (' + searchPath + ') t=' + currentTime.toFixed(3) + ' "' + newText + '"');
            if (newWordIdx === -1 && cache.length > 0) {
                var first = cache[0];
                var last = cache[cache.length - 1];
                animDebug('MEGA', '  NO MATCH: t=' + currentTime.toFixed(3) + ' cache[0]=[' + first.start.toFixed(3) + ',' + first.end.toFixed(3) + '] cache[' + (cache.length-1) + ']=[' + last.start.toFixed(3) + ',' + last.end.toFixed(3) + ']');
            }
            if (lastWordIdx >= 0 && lastWordIdx < cache.length) {
                applyClassToGroup(cache, lastWordIdx, 'active', false);
                applyClassToGroup(cache, lastWordIdx, 'reached', true);
            }
            if (newWordIdx >= 0) {
                applyClassToGroup(cache, newWordIdx, 'active', true);
                if (lastWordIdx === -1) {
                    // First highlight — catch up any skipped words (with group support)
                    for (var j = 0; j < newWordIdx; j++) {
                        applyClassToGroup(cache, j, 'reached', true);
                    }
                }
                // auto-scroll disabled — causes jank with frequent word changes
            }
            if (newWordIdx >= 0) {
                var wc = window.ANIM_GRANULARITY === 'Characters'
                    ? animateAllState.unifiedCacheChars : animateAllState.unifiedCacheWords;
                var map = window.ANIM_GRANULARITY === 'Characters' ? seg.unifiedCharMap : seg.unifiedWordMap;
                applyWindowOpacity(wc, map[newWordIdx],
                    lastWordIdx >= 0 ? map[lastWordIdx] : -1);
            }
            lastWordIdx = newWordIdx;
        }
    }
    if (animateAllState.rafId) cancelAnimationFrame(animateAllState.rafId);
    function rafLoop() {
        tick();
        // Keep looping while animation is active AND still on the same segment.
        // When tick() triggers a segment transition, a new RAF loop is started for
        // the new segment - this old loop must stop to avoid duplicate transitions.
        if (animateAllState.active && !audio.paused && animateAllState.currentIdx === segIdx) {
            animateAllState.rafId = requestAnimationFrame(rafLoop);
        }
    }
    animateAllState.rafId = requestAnimationFrame(rafLoop);
}

function animateSegment(idx, seekTime) {
    var seg = animateAllState.segments[idx];
    if (!seg) return;
    animateAllState.currentIdx = idx;
    // Re-tag shared elements so click-to-seek targets this segment during playback
    seg.cacheWords.forEach(function(c) { c.el.dataset.segIdx = idx; });
    seg.cacheChars.forEach(function(c) { c.el.dataset.segIdx = idx; });
    var audio = animateAllState.unifiedAudio;
    // Apply window engine class to mega card
    var mega = animateAllState.megaCard;
    mega.classList.add('anim-window');
    if (window.ANIM_GRANULARITY === 'Characters') {
        mega.classList.add('anim-chars');
    }
    // Detect backward transition: jumping to a segment at or before the last completed one
    if (idx <= animateAllState.completedIdx) {
        resetHighlightsFrom(idx);
        // Reset completedIdx so forward progress from here is tracked correctly
        animateAllState.completedIdx = idx - 1;
    }
    // Determine seek position: use provided seekTime or default to segment start
    var targetTime = (seekTime !== undefined) ? seekTime : seg.startTime;
    // Start playback and polling with segment boundaries
    startSegmentTick(seg, audio, seg.startTime, seg.endTime);
    audio.currentTime = targetTime;
    audio.playbackRate = window.ANIM_PLAYBACK_RATE || 1;
    audio.play();
    // No per-segment preloading needed — unified audio already loaded
}

function seekToWord(wordEl) {
    if (!animateAllState.active) return;
    var cache = window.ANIM_GRANULARITY === 'Characters'
        ? animateAllState.unifiedCacheChars : animateAllState.unifiedCacheWords;
    // Find unified index and start time for the clicked word
    var targetIdx = -1;
    var wordStartTime = 0;
    // For char granularity, find the first char of the clicked word
    if (window.ANIM_GRANULARITY === 'Characters') {
        for (var i = 0; i < cache.length; i++) {
            if (cache[i].el.parentElement === wordEl || cache[i].el === wordEl) {
                targetIdx = i;
                wordStartTime = cache[i].start;
                break;
            }
        }
    } else {
        for (var i = 0; i < cache.length; i++) {
            if (cache[i].el === wordEl) {
                targetIdx = i;
                wordStartTime = cache[i].start;
                break;
            }
        }
    }
    if (targetIdx < 0) return;
    // Derive segment from word timing (more reliable than data-segIdx for shared elements)
    var segIdx = 0;
    for (var s = 0; s < animateAllState.segments.length; s++) {
        var seg = animateAllState.segments[s];
        if (wordStartTime >= seg.startTime && wordStartTime < seg.endTime) {
            segIdx = s;
            break;
        }
    }
    // Reset window cache to force full reapplication (not fast path)
    window._windowActiveIdx = -1;
    window._windowLastPcAll = false;
    window._windowLastAcAll = false;
    // Update highlight state: words before target = reached, target onward = clean
    for (var i = 0; i < cache.length; i++) {
        cache[i].el.classList.remove('active');
        cache[i].el.style.removeProperty('opacity');
        if (i < targetIdx) {
            cache[i].el.classList.add('reached');
        } else {
            cache[i].el.classList.remove('reached');
        }
    }
    // Also sync the other cache (chars if in word mode, words if in char mode)
    var otherCache = window.ANIM_GRANULARITY === 'Characters'
        ? animateAllState.unifiedCacheWords : animateAllState.unifiedCacheChars;
    for (var i = 0; i < otherCache.length; i++) {
        otherCache[i].el.classList.remove('active');
        otherCache[i].el.style.removeProperty('opacity');
    }
    // Re-apply window opacity immediately for the new position
    applyWindowOpacity(cache, targetIdx, -1);
    // Switch segment or seek within current (unified audio)
    var audio = animateAllState.unifiedAudio;
    if (animateAllState.rafId) {
        cancelAnimationFrame(animateAllState.rafId);
        animateAllState.rafId = null;
    }
    if (segIdx !== animateAllState.currentIdx) {
        // Different segment — restart tick loop with new segment boundaries
        animateSegment(segIdx, wordStartTime);
    } else {
        // Same segment — restart tick loop at new position for clean state
        audio.currentTime = wordStartTime;
        var seg = animateAllState.segments[segIdx];
        var segStartTime = segIdx > 0 ? animateAllState.segments[segIdx - 1].endTime : 0;
        startSegmentTick(seg, audio, segStartTime, seg.endTime);
    }
}

function seekToVerseMarker(markerEl) {
    if (!animateAllState.active) return;
    var verse = markerEl.dataset.verse;  // e.g. "2:255"
    if (!verse) return;
    var prefix = verse + ':';
    // Find first word in unified cache whose data-pos starts with this verse
    var cache = animateAllState.unifiedCacheWords;
    for (var i = 0; i < cache.length; i++) {
        var pos = cache[i].el.dataset.pos || '';
        if (pos === verse || pos.indexOf(prefix) === 0) {
            seekToWord(cache[i].el);
            return;
        }
    }
}

function onAnimateAllSegmentEnd() {
    if (!animateAllState.active) return;
    var seg = animateAllState.segments[animateAllState.currentIdx];
    if (seg) {
        // Mark all words/chars in finished segment as reached.
        // Use mode's prev_opacity for completed elements.
        seg.cacheWords.forEach(function(c) {
            if (c.el.classList.contains('active')) {
                c.el.style.opacity = String(window.ANIM_OPACITY_PREV);
            }
            c.el.classList.remove('active');
            c.el.classList.add('reached');
        });
        seg.cacheChars.forEach(function(c) {
            if (c.el.classList.contains('active')) {
                c.el.style.opacity = String(window.ANIM_OPACITY_PREV);
            }
            c.el.classList.remove('active');
            c.el.classList.add('reached');
        });
        animateAllState.completedIdx = animateAllState.currentIdx;
    }
    var nextIdx = animateAllState.currentIdx + 1;
    if (nextIdx < animateAllState.segments.length) {
        // Unified audio continues playing — just switch segment tracking
        var nextSeg = animateAllState.segments[nextIdx];
        animateAllState.currentIdx = nextIdx;
        // Re-tag shared elements for the new segment
        nextSeg.cacheWords.forEach(function(c) { c.el.dataset.segIdx = nextIdx; });
        nextSeg.cacheChars.forEach(function(c) { c.el.dataset.segIdx = nextIdx; });
        // Restart tick loop with new segment boundaries
        startSegmentTick(nextSeg, animateAllState.unifiedAudio, nextSeg.startTime, nextSeg.endTime);
    } else {
        // All segments done — tear down after brief delay
        setTimeout(function() { stopAnimateAll(); }, 500);
    }
}

// Pause: keep mega card and position, just stop playback
function pauseAnimateAll() {
    if (animateAllState.rafId) {
        cancelAnimationFrame(animateAllState.rafId);
        animateAllState.rafId = null;
    }
    if (animateAllState.unifiedAudio) animateAllState.unifiedAudio.pause();
    animateAllState.active = false;

    // Fade last active word to mode's prev_opacity
    var seg = animateAllState.segments[animateAllState.currentIdx];
    if (seg) {
        var cache = window.ANIM_GRANULARITY === 'Characters' ? seg.cacheChars : seg.cacheWords;
        cache.forEach(function(c) {
            if (c.el.classList.contains('active')) {
                c.el.style.opacity = String(window.ANIM_OPACITY_PREV);
            }
        });
    }

    if (animateAllState.btn) {
        animateAllState.btn.classList.remove('active');
        animateAllState.btn.textContent = 'Resume';
    }
}

// Full teardown: remove mega card, restore segment cards
function stopAnimateAll() {
    if (animateAllState.rafId) {
        cancelAnimationFrame(animateAllState.rafId);
        animateAllState.rafId = null;
    }
    if (animateAllState.unifiedAudio) animateAllState.unifiedAudio.pause();
    // Move Stop/Resume button back to its original parent before removing mega card
    if (animateAllState.btn && animateAllState.btnParent) {
        animateAllState.btnParent.appendChild(animateAllState.btn);
    }
    // Remove tip callout, top bar, and mega card
    var tipEl = document.querySelector('.mega-tip');
    if (tipEl) tipEl.parentNode.removeChild(tipEl);
    if (animateAllState.topBar && animateAllState.topBar.parentNode) {
        animateAllState.topBar.parentNode.removeChild(animateAllState.topBar);
    }
    if (animateAllState.megaCard && animateAllState.megaCard.parentNode) {
        animateAllState.megaCard.parentNode.removeChild(animateAllState.megaCard);
    }
    animateAllState.megaCard = null;
    animateAllState.topBar = null;
    animateAllState.textFlow = null;
    // Unhide segment cards
    document.querySelectorAll('.segment-card.hidden-for-mega').forEach(function(c) {
        c.classList.remove('hidden-for-mega');
    });
    // Restore left column and right column sizing
    var leftCol = document.getElementById('left-col');
    if (leftCol) leftCol.style.display = '';
    var mainRow = document.getElementById('main-row');
    if (mainRow) {
        var rightCol = mainRow.querySelector(':scope > div:last-child');
        if (rightCol) rightCol.style.flexGrow = animateAllState.savedFlexGrow || '';
    }
    // Restore description and API accordion
    if (mainRow) {
        var sibling = mainRow.parentNode.firstElementChild;
        while (sibling && sibling !== mainRow) {
            sibling.style.display = '';
            sibling = sibling.nextElementSibling;
        }
    }
    // Restore header/summary text and action buttons
    document.querySelectorAll('.segments-header, .segments-review-summary').forEach(function(el) {
        el.style.display = '';
    });
    var actionRow = document.getElementById('action-btns-row');
    if (actionRow) actionRow.style.display = '';
    var tsRow = document.getElementById('ts-row');
    if (tsRow) tsRow.style.display = '';
    // Move animation settings accordion back to left column
    var animAccordion = document.getElementById('anim-settings-accordion');
    if (animAccordion && animateAllState.accordionParent) {
        if (animateAllState.accordionNextSibling) {
            animateAllState.accordionParent.insertBefore(animAccordion, animateAllState.accordionNextSibling);
        } else {
            animateAllState.accordionParent.appendChild(animAccordion);
        }
    }
    // Hide mega styling sliders (only shown in megacard view)
    var megaStylingRow = document.getElementById('mega-styling-row');
    if (megaStylingRow) megaStylingRow.style.display = 'none';
    // Reset button
    if (animateAllState.btn) {
        animateAllState.btn.classList.remove('active');
        animateAllState.btn.textContent = 'Animate All';
    }
    animateAllState.active = false;
    animateAllState.completedIdx = -1;
    animateAllState.segments = [];
    animateAllState.unifiedCacheWords = [];
    animateAllState.unifiedCacheChars = [];
    animateAllState.unifiedAudio = null;
    animateAllState.megaCard = null;
    animateAllState.textFlow = null;
    window.ANIM_PLAYBACK_RATE = 1;
}

// Resume from paused position
function resumeAnimateAll() {
    animateAllState.active = true;
    if (animateAllState.btn) {
        animateAllState.btn.classList.add('active');
        animateAllState.btn.textContent = 'Stop';
    }
    var seg = animateAllState.segments[animateAllState.currentIdx];
    if (!seg) return;
    var audio = animateAllState.unifiedAudio;
    // Re-apply animation classes
    var mega = animateAllState.megaCard;
    mega.classList.add('anim-window');
    if (window.ANIM_GRANULARITY === 'Characters') {
        mega.classList.add('anim-chars');
    }
    // Restart polling from current audio position
    startSegmentTick(seg, audio, seg.startTime, seg.endTime);
    audio.playbackRate = window.ANIM_PLAYBACK_RATE || 1;
    audio.play();
}

function toggleAnimateAll(btn) {
    // Currently playing → pause (keep mega card)
    if (animateAllState.active) {
        pauseAnimateAll();
        return;
    }
    // Paused with mega card still in live DOM → resume
    if (animateAllState.megaCard && document.contains(animateAllState.megaCard)) {
        resumeAnimateAll();
        return;
    }
    // Stale mega card (orphaned by Gradio HTML update) → reset state
    if (animateAllState.megaCard) {
        animateAllState.megaCard = null;
        animateAllState.textFlow = null;
        animateAllState.segments = [];
        animateAllState.unifiedCacheWords = [];
        animateAllState.unifiedCacheChars = [];
        animateAllState.unifiedAudio = null;
        animateAllState.completedIdx = -1;
        animateAllState.active = false;
    }
    // Fresh start
    document.querySelectorAll('.animate-btn.active').forEach(function(b) {
        toggleAnimation(b);
    });
    var result = buildMegaCard();
    if (!result || animateAllState.segments.length === 0) return;
    if (!result.unifiedAudio) {
        console.error('Animate All: unified audio not available');
        return;
    }
    var mega = result.mega;
    var topBar = result.topBar;
    animateAllState.megaCard = mega;
    animateAllState.topBar = topBar;
    animateAllState.unifiedAudio = result.unifiedAudio;
    animateAllState.btn = btn;
    animateAllState.active = true;
    // Hide individual segment cards
    document.querySelectorAll('.segments-container .segment-card').forEach(function(c) {
        c.classList.add('hidden-for-mega');
    });
    // Hide left column and expand right column to full width
    var leftCol = document.getElementById('left-col');
    if (leftCol) leftCol.style.display = 'none';
    var mainRow = document.getElementById('main-row');
    if (mainRow) {
        var rightCol = mainRow.querySelector(':scope > div:last-child');
        if (rightCol) {
            animateAllState.savedFlexGrow = rightCol.style.flexGrow;
            rightCol.style.flexGrow = '1';
        }
    }
    // Hide description and API accordion (everything before main-row)
    if (mainRow) {
        var sibling = mainRow.parentNode.firstElementChild;
        while (sibling && sibling !== mainRow) {
            sibling.style.display = 'none';
            sibling = sibling.nextElementSibling;
        }
    }
    // Hide header/summary text and action buttons
    document.querySelectorAll('.segments-header, .segments-review-summary').forEach(function(el) {
        el.style.display = 'none';
    });
    var actionRow = document.getElementById('action-btns-row');
    if (actionRow) actionRow.style.display = 'none';
    var tsRow = document.getElementById('ts-row');
    if (tsRow) tsRow.style.display = 'none';
    // Move animation settings accordion above segments container
    var animAccordion = document.getElementById('anim-settings-accordion');
    if (animAccordion) {
        animateAllState.accordionParent = animAccordion.parentNode;
        animateAllState.accordionNextSibling = animAccordion.nextElementSibling;
        var container = document.querySelector('.segments-container');
        if (container) container.parentNode.insertBefore(animAccordion, container);
    }
    // Show mega styling sliders (hidden in normal card view)
    var megaStylingRow = document.getElementById('mega-styling-row');
    if (megaStylingRow) megaStylingRow.style.display = 'flex';
    var container = document.querySelector('.segments-container');
    // Add tip callout above the mega card
    var tip = document.createElement('div');
    tip.className = 'mega-tip';
    tip.textContent = 'Tip: Click on any word to seek to it, or click a verse marker to jump to the start of that verse.';
    container.appendChild(topBar);
    container.appendChild(tip);
    container.appendChild(mega);
    // Append unified audio element to mega card (hidden)
    if (animateAllState.unifiedAudio) {
        mega.appendChild(animateAllState.unifiedAudio);
    }
    // Move Stop/Resume button into top bar (above mega card)
    btn.classList.add('active');
    btn.textContent = 'Stop';
    animateAllState.btnParent = btn.parentNode;
    topBar.appendChild(btn);
    // Start animation from first segment
    animateSegment(0);
}

// Event delegation for Animate button clicks and click-to-seek
document.addEventListener('click', function(e) {
    // Click-to-seek in Animate All mode
    if (animateAllState.active && animateAllState.megaCard) {
        var wordEl = e.target.closest('.word');
        if (wordEl && animateAllState.megaCard.contains(wordEl)) {
            seekToWord(wordEl);
            return;
        }
        var markerEl = e.target.closest('.verse-marker');
        if (markerEl && animateAllState.megaCard.contains(markerEl)) {
            seekToVerseMarker(markerEl);
            return;
        }
    }
    if (e.target.matches('.play-btn')) {
        var card = e.target.closest('.segment-card');
        var audio = card && card.querySelector('audio');
        if (audio) {
            activateAudio(audio);
            audio.play().catch(function(){});
        }
    }
    if (e.target.matches('.animate-btn')) {
        toggleAnimation(e.target);
    }
    if (e.target.matches('.animate-all-btn')) {
        toggleAnimateAll(e.target);
    }
    if (e.target.matches('.mega-exit-btn')) {
        stopAnimateAll();
    }
});

// Clear highlights when audio ends (with delay so last word is visible)
document.addEventListener('ended', function(e) {
    if (e.target.tagName === 'AUDIO') {
        var audio = e.target;
        // If Animate All is active with unified audio, handle full recording end
        if (animateAllState.active && audio === animateAllState.unifiedAudio) {
            // Unified audio ended — entire recording finished
            setTimeout(function() { stopAnimateAll(); }, 500);
            return;
        }
        // Default per-card behavior
        var card = audio.closest('.segment-card');
        if (card) {
            setTimeout(function() {
                var btn = card.querySelector('.animate-btn');
                if (btn && btn.classList.contains('active')) {
                    btn.classList.remove('active');
                    btn.textContent = 'Animate';
                    stopAnimation(audio, card);
                }
            }, 500);
        }
    }
}, true);

// Prefetch next segment's audio when current segment starts playing
document.addEventListener('play', function(e) {
    if (e.target.tagName === 'AUDIO') {
        var card = e.target.closest('.segment-card');
        if (!card) return;
        var next = card.nextElementSibling;
        if (next && next.classList.contains('segment-card')) {
            var nextAudio = next.querySelector('audio');
            if (nextAudio && !nextAudio.src && nextAudio.dataset.src) {
                nextAudio.src = nextAudio.dataset.src;
                nextAudio.preload = 'metadata';
            }
        }
    }
}, true);
