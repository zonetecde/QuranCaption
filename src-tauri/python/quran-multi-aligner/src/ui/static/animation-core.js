// =====================================================================
// Per-segment animation engine — audio warmup, caching, window mode,
// highlight tick loop, and per-card Animate toggle.
// Requires window.* config globals set by js_config.py.
// =====================================================================

// Warm up browser audio pipeline on first user interaction.
// Uses pointerdown (fires ~50-100ms before click) + AudioContext.resume()
// to prime the audio hardware before the <audio> element's play fires.
var _audioWarmedUp = false;
function _warmupAudio() {
    if (_audioWarmedUp) return;
    _audioWarmedUp = true;
    // 1. Resume/create AudioContext — this is what actually initializes audio hardware
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    // Play a single silent sample to force full pipeline init
    var buf = ctx.createBuffer(1, 1, 22050);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    // 2. Also prime HTML5 Audio path with a silent WAV
    var a = new Audio('data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAABCxAgACABAAZGF0YQIAAAAAAA==');
    a.volume = 0;
    a.play().catch(function(){});
    document.removeEventListener('pointerdown', _warmupAudio);
    document.removeEventListener('touchstart', _warmupAudio);
}
// pointerdown fires before click, giving audio hardware a head start
document.addEventListener('pointerdown', _warmupAudio);
document.addEventListener('touchstart', _warmupAudio, {passive: true});

// --- localStorage persistence helpers ---
var _ANIM_STORAGE_KEY = 'quran_anim_settings';
function loadAnimSettings() {
    try {
        var raw = localStorage.getItem(_ANIM_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
}
function saveAnimSettings() {
    try {
        var mode = window.ANIM_DISPLAY_MODE;
        var s = loadAnimSettings() || {};
        s.granularity = window.ANIM_GRANULARITY;
        s.mode = mode;
        s.verseOnly = !!window.ANIM_VERSE_MODE;
        s.color = getComputedStyle(document.documentElement).getPropertyValue('--anim-word-color').trim() || window.ANIM_WORD_COLOR_DEFAULT;
        // Read text styling from slider DOM values (more reliable than mega-card inline styles)
        var wsEl = document.querySelector('#anim-word-spacing input[type=range],#anim-word-spacing input[type=number]');
        var tsEl = document.querySelector('#anim-text-size input[type=range],#anim-text-size input[type=number]');
        var lsEl = document.querySelector('#anim-line-spacing input[type=range],#anim-line-spacing input[type=number]');
        s.wordSpacing = wsEl ? parseFloat(wsEl.value) : window.MEGA_WORD_SPACING_DEFAULT;
        s.textSize = tsEl ? parseFloat(tsEl.value) : window.MEGA_TEXT_SIZE_DEFAULT;
        s.lineSpacing = lsEl ? parseFloat(lsEl.value) : window.MEGA_LINE_SPACING_DEFAULT;
        // Always keep custom sub-object up to date when in Custom mode
        if (mode === 'Custom') {
            s.custom = {
                prevOpacity: window.ANIM_OPACITY_PREV,
                afterOpacity: window.ANIM_OPACITY_AFTER,
                prevWords: window.ANIM_WINDOW_PREV,
                afterWords: window.ANIM_WINDOW_AFTER
            };
        }
        s.playbackRate = window.ANIM_PLAYBACK_RATE || 1;
        localStorage.setItem(_ANIM_STORAGE_KEY, JSON.stringify(s));
    } catch(e) {}
}

// --- Restore from localStorage or use defaults ---
var _saved = loadAnimSettings();
if (_saved) {
    window.ANIM_DISPLAY_MODE = _saved.mode || window.ANIM_DISPLAY_MODE_DEFAULT;
    window.ANIM_GRANULARITY = _saved.granularity || window.ANIM_GRANULARITY_DEFAULT;
    window.ANIM_VERSE_MODE = !!_saved.verseOnly;
    if (_saved.color) document.documentElement.style.setProperty('--anim-word-color', _saved.color);
    var _rPreset = window.ANIM_PRESETS[window.ANIM_DISPLAY_MODE];
    if (_rPreset) {
        window.ANIM_OPACITY_PREV = _rPreset.prev_opacity;
        window.ANIM_OPACITY_AFTER = _rPreset.after_opacity;
        window.ANIM_WINDOW_PREV = _rPreset.prev_words;
        window.ANIM_WINDOW_AFTER = _rPreset.after_words;
    } else if (_saved.custom) {
        window.ANIM_OPACITY_PREV = _saved.custom.prevOpacity;
        window.ANIM_OPACITY_AFTER = _saved.custom.afterOpacity;
        window.ANIM_WINDOW_PREV = _saved.custom.prevWords;
        window.ANIM_WINDOW_AFTER = _saved.custom.afterWords;
    } else {
        window.ANIM_OPACITY_PREV = window.ANIM_OPACITY_PREV_DEFAULT;
        window.ANIM_OPACITY_AFTER = window.ANIM_OPACITY_AFTER_DEFAULT;
        window.ANIM_WINDOW_PREV = window.ANIM_WINDOW_PREV_DEFAULT;
        window.ANIM_WINDOW_AFTER = window.ANIM_WINDOW_AFTER_DEFAULT;
    }
} else {
    window.ANIM_DISPLAY_MODE = window.ANIM_DISPLAY_MODE_DEFAULT;
    window.ANIM_GRANULARITY = window.ANIM_GRANULARITY_DEFAULT;
    var _initPreset = window.ANIM_PRESETS[window.ANIM_DISPLAY_MODE_DEFAULT];
    window.ANIM_OPACITY_PREV = _initPreset ? _initPreset.prev_opacity : window.ANIM_OPACITY_PREV_DEFAULT;
    window.ANIM_OPACITY_AFTER = _initPreset ? _initPreset.after_opacity : window.ANIM_OPACITY_AFTER_DEFAULT;
    window.ANIM_WINDOW_PREV = _initPreset ? _initPreset.prev_words : window.ANIM_WINDOW_PREV_DEFAULT;
    window.ANIM_WINDOW_AFTER = _initPreset ? _initPreset.after_words : window.ANIM_WINDOW_AFTER_DEFAULT;
    window.ANIM_VERSE_MODE = false;
}
window.ANIM_PLAYBACK_RATE = (_saved && _saved.playbackRate) ? _saved.playbackRate : 1;
window._windowPrevGradient = [];
window._windowAfterGradient = [];

function rebuildWindowGradient() {
    var basePrev = window.ANIM_OPACITY_PREV;
    var baseAfter = window.ANIM_OPACITY_AFTER;
    var pc = window.ANIM_WINDOW_PREV;
    var ac = window.ANIM_WINDOW_AFTER;
    window._windowPrevGradient = [];
    window._windowAfterGradient = [];
    // At max: empty gradient signals "show all at flat base opacity"
    if (pc < window.ANIM_WINDOW_PREV_MAX) {
        for (var d = 1; d <= pc; d++) {
            window._windowPrevGradient.push(String(basePrev * (pc - d + 1) / pc));
        }
    }
    if (ac < window.ANIM_WINDOW_AFTER_MAX) {
        for (var d = 1; d <= ac; d++) {
            window._windowAfterGradient.push(String(baseAfter * (ac - d + 1) / ac));
        }
    }
}
rebuildWindowGradient();

// Activate a lazy-loaded audio element (set src, show controls, hide play button)
function activateAudio(audio) {
    if (audio.hasAttribute('controls')) return audio;
    audio.src = audio.dataset.src;
    audio.controls = true;
    audio.style.display = '';
    var playBtn = audio.parentElement && audio.parentElement.querySelector('.play-btn');
    if (playBtn) playBtn.style.display = 'none';
    return audio;
}

// =====================================================================
// Animation Debug Logging
// Enable via: window.ANIM_DEBUG = true; in browser console
// =====================================================================
window.ANIM_DEBUG = false;  // Set to true to enable animation debug logging
function animDebug(category, msg, data) {
    if (!window.ANIM_DEBUG) return;
    var prefix = '[ANIM:' + category + ']';
    if (data !== undefined) {
        console.log(prefix, msg, data);
    } else {
        console.log(prefix, msg);
    }
}
function dumpCacheTimestamps(cache, label) {
    if (!window.ANIM_DEBUG) return;
    console.group('[ANIM:CACHE] ' + label + ' (' + cache.length + ' entries)');
    cache.forEach(function(item, idx) {
        var text = item.el.textContent.substring(0, 20);
        var gid = item.groupId || '-';
        console.log(idx + ': "' + text + '" start=' + item.start.toFixed(3) + ' end=' + item.end.toFixed(3) + ' groupId=' + gid);
    });
    if (cache._groupIndex) {
        console.log('_groupIndex:', JSON.parse(JSON.stringify(cache._groupIndex)));
    }
    console.groupEnd();
}

// Cache elements and timing data for a given selector
// Also builds group index for letter groups (chars with same data-group-id)
function initCacheFor(card, selector) {
    var elements = Array.from(card.querySelectorAll(selector));
    var cache = elements.map(function(el, idx) {
        return {
            el: el,
            start: parseFloat(el.dataset.start),
            end: parseFloat(el.dataset.end),
            groupId: el.dataset.groupId || null,
            cacheIdx: idx
        };
    });
    // Build group index: groupId → [cacheIdx, ...]
    var groupIndex = {};
    cache.forEach(function(item) {
        if (item.groupId) {
            if (!groupIndex[item.groupId]) {
                groupIndex[item.groupId] = [];
            }
            groupIndex[item.groupId].push(item.cacheIdx);
        }
    });
    cache._groupIndex = groupIndex;
    animDebug('INIT', 'initCacheFor("' + selector + '"): ' + cache.length + ' elements, ' + Object.keys(groupIndex).length + ' groups');
    return cache;
}

// Apply class to element and all members of its letter group
function applyClassToGroup(cache, idx, className, add) {
    var item = cache[idx];
    if (!item) {
        animDebug('CLASS', 'applyClassToGroup SKIP: no item at idx=' + idx);
        return;
    }
    var text = item.el.textContent.substring(0, 10);
    animDebug('CLASS', (add ? '+' : '-') + className + ' idx=' + idx + ' "' + text + '" groupId=' + (item.groupId || '-'));
    if (add) {
        item.el.classList.add(className);
    } else {
        item.el.classList.remove(className);
    }
    // Also apply to all group members if this element has a groupId
    if (item.groupId && cache._groupIndex) {
        var groupMembers = cache._groupIndex[item.groupId] || [];
        if (groupMembers.length > 1) {
            animDebug('CLASS', '  -> propagating to group members:', groupMembers);
        }
        groupMembers.forEach(function(memberIdx) {
            if (memberIdx !== idx) {
                if (add) {
                    cache[memberIdx].el.classList.add(className);
                } else {
                    cache[memberIdx].el.classList.remove(className);
                }
            }
        });
    }
}

// Return the active cache based on current granularity setting
function getActiveCache(audio) {
    return window.ANIM_GRANULARITY === 'Characters' ? audio._cacheChars : audio._cacheWords;
}

// Apply opacity to element and all members of its letter group
function applyOpacityToGroup(cache, idx, opacity) {
    var item = cache[idx];
    if (!item) {
        animDebug('OPACITY', 'applyOpacityToGroup SKIP: no item at idx=' + idx);
        return;
    }
    var text = item.el.textContent.substring(0, 10);
    animDebug('OPACITY', 'idx=' + idx + ' "' + text + '" opacity=' + (opacity === null ? 'CLEAR' : opacity) + ' groupId=' + (item.groupId || '-'));
    if (opacity === null) {
        item.el.style.removeProperty('opacity');
    } else {
        item.el.style.opacity = opacity;
    }
    // Also apply to all group members if this element has a groupId
    if (item.groupId && cache._groupIndex) {
        var groupMembers = cache._groupIndex[item.groupId] || [];
        if (groupMembers.length > 1) {
            animDebug('OPACITY', '  -> propagating to group members:', groupMembers);
        }
        groupMembers.forEach(function(memberIdx) {
            if (memberIdx !== idx) {
                if (opacity === null) {
                    cache[memberIdx].el.style.removeProperty('opacity');
                } else {
                    cache[memberIdx].el.style.opacity = opacity;
                }
            }
        });
    }
}

// Build group index for a cache array (extracts groupId and builds _groupIndex)
// Used for megacard caches which are built manually without initCacheFor()
function buildGroupIndex(cache) {
    var groupIndex = {};
    cache.forEach(function(item, idx) {
        var gid = item.el.dataset.groupId;
        if (gid) {
            item.groupId = gid;
            if (!groupIndex[gid]) groupIndex[gid] = [];
            groupIndex[gid].push(idx);
        }
    });
    cache._groupIndex = groupIndex;
    var groupCount = Object.keys(groupIndex).length;
    animDebug('GROUP', 'buildGroupIndex: ' + cache.length + ' elements, ' + groupCount + ' groups');
    if (window.ANIM_DEBUG && groupCount > 0) {
        for (var gid in groupIndex) {
            if (groupIndex[gid].length > 1) {
                animDebug('GROUP', '  group "' + gid + '": indices ' + JSON.stringify(groupIndex[gid]));
            }
        }
    }
}

// Window mode: track active state for live slider updates
window._windowActiveCache = null;
window._windowActiveIdx = -1;
window._windowLastPc = 0;
window._windowLastAc = 0;
window._windowLastPcAll = false;
window._windowLastAcAll = false;
window._windowSettingsVersion = 0;  // Incremented when sliders change, so tick() can detect

// Window mode: apply per-element opacity gradient around active index
function applyWindowOpacity(cache, newIdx, prevIdx) {
    animDebug('WINDOW', 'applyWindowOpacity newIdx=' + newIdx + ' prevIdx=' + prevIdx + ' cacheLen=' + cache.length);
    // If prevIdx is unknown (e.g. after a timing gap between words),
    // fall back to the last index we applied so the old window gets cleared.
    if (prevIdx < 0 && window._windowActiveIdx >= 0 && window._windowActiveCache === cache) {
        animDebug('WINDOW', '  -> using fallback prevIdx=' + window._windowActiveIdx);
        prevIdx = window._windowActiveIdx;
    }
    var prevGrad = window._windowPrevGradient;
    var afterGrad = window._windowAfterGradient;
    var pc = prevGrad.length;
    var ac = afterGrad.length;
    var pcAll = (window.ANIM_WINDOW_PREV >= window.ANIM_WINDOW_PREV_MAX);
    var acAll = (window.ANIM_WINDOW_AFTER >= window.ANIM_WINDOW_AFTER_MAX);
    var oldPcAll = window._windowLastPcAll;
    var oldAcAll = window._windowLastAcAll;
    var basePrev = String(window.ANIM_OPACITY_PREV);
    var baseAfter = String(window.ANIM_OPACITY_AFTER);
    animDebug('WINDOW', '  verseMode=' + window.ANIM_VERSE_MODE + ' pcAll=' + pcAll + ' acAll=' + acAll + ' basePrev=' + basePrev + ' baseAfter=' + baseAfter);
    // Verse mode: show only current-verse words, hide everything else
    if (window.ANIM_VERSE_MODE) {
        var activeEl = cache[newIdx].el;
        var activePos = activeEl.dataset.pos || (activeEl.closest('.word') || {}).dataset?.pos || '';
        var vp = activePos.split(':');
        var activeVerse = vp.length >= 2 ? vp[0] + ':' + vp[1] : '';
        // Track which group IDs we've already handled to avoid duplicates
        var handledGroups = {};
        for (var i = 0; i < cache.length; i++) {
            // Skip if this element's group was already handled
            var gid = cache[i].groupId;
            if (gid && handledGroups[gid]) continue;
            if (gid) handledGroups[gid] = true;
            if (i === newIdx) {
                applyOpacityToGroup(cache, i, null);
                continue;
            }
            var el = cache[i].el;
            var pos = el.dataset.pos || (el.closest('.word') || {}).dataset?.pos || '';
            var wp = pos.split(':');
            var wverse = wp.length >= 2 ? wp[0] + ':' + wp[1] : '';
            if (wverse === activeVerse) {
                // Same verse: normal gradient opacity
                if (i < newIdx || !cache[i].el.classList.contains('reached')) {
                    applyOpacityToGroup(cache, i, (i < newIdx) ? basePrev : baseAfter);
                }
            } else if (i < newIdx) {
                // Different verse, before current: always hide past verses
                applyOpacityToGroup(cache, i, '0');
            } else {
                // Different verse, after current: hide future verses in verse-only mode
                applyOpacityToGroup(cache, i, '0');
            }
        }
        window._windowActiveCache = cache;
        window._windowActiveIdx = newIdx;
        return;
    }
    // Fast path: All→All steady state — only 2 elements change (with group support)
    if (prevIdx >= 0 && newIdx >= 0 && pcAll && acAll && oldPcAll && oldAcAll) {
        applyOpacityToGroup(cache, prevIdx, basePrev);
        applyOpacityToGroup(cache, newIdx, null);
        window._windowActiveCache = cache;
        window._windowActiveIdx = newIdx;
        window._windowLastPc = pc;  window._windowLastAc = ac;
        window._windowLastPcAll = pcAll;  window._windowLastAcAll = acAll;
        return;
    }
    // Clear old window range
    if (prevIdx >= 0) {
        if (oldPcAll || oldAcAll) {
            // Previous state had "all" — clear every element
            for (var i = 0; i < cache.length; i++) {
                cache[i].el.style.removeProperty('opacity');
            }
        } else {
            var clearPc = Math.max(pc, window._windowLastPc);
            var clearAc = Math.max(ac, window._windowLastAc);
            var clearStart = Math.max(0, prevIdx - clearPc);
            var clearEnd = Math.min(cache.length - 1, prevIdx + clearAc);
            for (var i = clearStart; i <= clearEnd; i++) {
                cache[i].el.style.removeProperty('opacity');
            }
        }
    }
    // Track state for live slider updates
    window._windowActiveCache = cache;
    window._windowActiveIdx = newIdx;
    window._windowLastPc = pc;
    window._windowLastAc = ac;
    window._windowLastPcAll = pcAll;
    window._windowLastAcAll = acAll;
    if (newIdx < 0) return;
    // Apply previous elements (with group support)
    if (pcAll) {
        for (var i = 0; i < newIdx; i++) {
            applyOpacityToGroup(cache, i, basePrev);
        }
    } else {
        for (var p = 0; p < pc; p++) {
            var idx = newIdx - (p + 1);
            if (idx < 0) break;
            applyOpacityToGroup(cache, idx, prevGrad[p]);
        }
    }
    // Apply after elements (upcoming words always get opacity set for
    // proper word-by-word animation, even if they have 'reached' from
    // a previous segment) — with group support
    if (acAll) {
        for (var i = newIdx + 1; i < cache.length; i++) {
            applyOpacityToGroup(cache, i, baseAfter);
        }
    } else {
        for (var a = 0; a < ac; a++) {
            var idx = newIdx + (a + 1);
            if (idx >= cache.length) break;
            applyOpacityToGroup(cache, idx, afterGrad[a]);
        }
    }
    // Fade previously-active word from full opacity to its new level (with group support)
    if (prevIdx >= 0 && prevIdx !== newIdx) {
        var tgt = cache[prevIdx].el.style.opacity || '0';
        applyOpacityToGroup(cache, prevIdx, tgt);
    }
    // Reconcile group opacities: grouped characters should appear as
    // one visual unit, using the max opacity from any member
    if (cache._groupIndex) {
        var gids = Object.keys(cache._groupIndex);
        for (var g = 0; g < gids.length; g++) {
            var members = cache._groupIndex[gids[g]];
            if (members.length <= 1) continue;
            // If any member is active, set all to full opacity
            var anyActive = false;
            var maxOp = -1;
            for (var m = 0; m < members.length; m++) {
                if (cache[members[m]].el.classList.contains('active')) {
                    anyActive = true;
                    break;
                }
                var op = cache[members[m]].el.style.opacity;
                if (op !== '') {
                    var val = parseFloat(op);
                    if (!isNaN(val) && val > maxOp) maxOp = val;
                }
            }
            if (anyActive) {
                for (var m = 0; m < members.length; m++) {
                    cache[members[m]].el.style.opacity = '1';
                }
            } else if (maxOp > 0) {
                var maxOpStr = String(maxOp);
                for (var m = 0; m < members.length; m++) {
                    cache[members[m]].el.style.opacity = maxOpStr;
                }
            }
            // maxOp <= 0: group is hidden (outside window), leave as-is
        }
    }
}

// Re-apply window opacity immediately (called when sliders change mid-animation)
function reapplyWindowNow() {
    var cache = window._windowActiveCache;
    var idx = window._windowActiveIdx;
    if (!cache || idx < 0) return;
    applyWindowOpacity(cache, idx, idx);
}

// Replace numeric value with "All" when slider is at maximum
function updateWindowMaxLabel(elemId, val, maxVal) {
    var el = document.getElementById(elemId);
    if (!el) return;
    var numInput = el.querySelector('input[type="number"]');
    if (!numInput) return;
    if (val >= maxVal) {
        numInput.style.display = 'none';
        var maxSpan = el.querySelector('.max-label');
        if (!maxSpan) {
            maxSpan = document.createElement('span');
            maxSpan.className = 'max-label';
            maxSpan.style.cssText = 'font-weight: bold; opacity: 0.85;';
            numInput.parentNode.insertBefore(maxSpan, numInput.nextSibling);
        }
        maxSpan.textContent = 'All';
        maxSpan.style.display = '';
    } else {
        numInput.style.display = '';
        var maxSpan = el.querySelector('.max-label');
        if (maxSpan) maxSpan.style.display = 'none';
    }
    // Always inject a hint at the right end of the slider track
    if (!el.querySelector('.max-hint')) {
        var rangeWrap = el.querySelector('input[type="range"]');
        if (rangeWrap) {
            var hint = document.createElement('span');
            hint.className = 'max-hint';
            hint.textContent = 'All';
            hint.style.cssText = 'position: absolute; right: 0; bottom: -1.2em; font-size: 0.7em; opacity: 0.5;';
            var parent = rangeWrap.parentNode;
            if (parent) {
                parent.style.position = 'relative';
                parent.appendChild(hint);
            }
        }
    }
}

// Expose to global scope so Gradio inline js= callbacks can call them
window.rebuildWindowGradient = rebuildWindowGradient;
window.reapplyWindowNow = reapplyWindowNow;
window.updateWindowMaxLabel = updateWindowMaxLabel;
window.saveAnimSettings = saveAnimSettings;
window.loadAnimSettings = loadAnimSettings;

// Inject "All" hints on slider tracks once Gradio renders them
setTimeout(function() {
    updateWindowMaxLabel('anim-window-prev', window.ANIM_WINDOW_PREV, window.ANIM_WINDOW_PREV_MAX);
    updateWindowMaxLabel('anim-window-after', window.ANIM_WINDOW_AFTER, window.ANIM_WINDOW_AFTER_MAX);
}, 500);

// Clear inline opacity from all words/chars in a card (Window mode cleanup)
// Applies mode's prev_opacity instead of removing opacity entirely
function clearWindowOpacity(card) {
    var prevOp = window.ANIM_OPACITY_PREV;
    card.querySelectorAll('.word, .char').forEach(function(el) {
        // Apply mode's prev_opacity consistently:
        // - Reveal/Fade (1.0): full visibility
        // - Spotlight (0.3): dimmed
        // - Isolate/Consume (0): hidden/disappear
        if (prevOp >= 1) {
            el.style.removeProperty('opacity');
        } else {
            el.style.opacity = String(prevOp);
        }
    });
}

function clearHighlights(card) {
    card.querySelectorAll('.word.active, .word.reached, .char.active, .char.reached').forEach(function(w) {
        w.classList.remove('active', 'reached');
    });
    clearWindowOpacity(card);
    card.classList.remove('anim-window', 'anim-chars');
}

function stopAnimation(audio, card) {
    if (audio._rafId) {
        cancelAnimationFrame(audio._rafId);
        audio._rafId = null;
    }
    if (card) {
        // Apply mode's prev_opacity to last active word before clearing
        var activeEl = card.querySelector('.word.active, .char.active');
        if (activeEl && window.ANIM_OPACITY_PREV < 1) {
            activeEl.style.opacity = String(window.ANIM_OPACITY_PREV);
        }
        clearHighlights(card);
    }
}

function startAnimation(audio, card) {
    var lastWordIdx = -1;
    var lastGranularity = window.ANIM_GRANULARITY;
    var lastOpacityPrev = window.ANIM_OPACITY_PREV;
    var lastSeenVersion = window._windowSettingsVersion;
    // Segment audio is trimmed, so currentTime starts at 0.
    // Word timestamps are absolute, so we need to add segment offset.
    var segOffset = parseFloat(card.dataset.startTime) || 0;

    function tick() {
        if (audio.paused || audio.ended) return;
        var wordCache = getActiveCache(audio);
        var currentTime = audio.currentTime + segOffset;

        // Granularity switched mid-animation — clear old highlights and reset
        if (window.ANIM_GRANULARITY !== lastGranularity) {
            animDebug('TICK', 'Granularity changed: ' + lastGranularity + ' -> ' + window.ANIM_GRANULARITY);
            card.querySelectorAll('.word.active, .word.reached, .char.active, .char.reached').forEach(function(w) {
                w.classList.remove('active', 'reached');
            });
            clearWindowOpacity(card);
            lastWordIdx = -1;
            lastGranularity = window.ANIM_GRANULARITY;
        }

        // Mode changed mid-animation — refresh all reached words with new opacity
        if (window.ANIM_OPACITY_PREV !== lastOpacityPrev) {
            animDebug('TICK', 'Mode changed: prevOp ' + lastOpacityPrev + ' -> ' + window.ANIM_OPACITY_PREV);
            card.querySelectorAll('.word.reached, .char.reached').forEach(function(el) {
                if (window.ANIM_OPACITY_PREV >= 1) {
                    el.style.removeProperty('opacity');
                } else {
                    el.style.opacity = String(window.ANIM_OPACITY_PREV);
                }
            });
            lastOpacityPrev = window.ANIM_OPACITY_PREV;
        }

        // Slider settings changed mid-animation — reapply window opacity
        if (window._windowSettingsVersion !== lastSeenVersion) {
            if (lastWordIdx >= 0) {
                applyWindowOpacity(wordCache, lastWordIdx, lastWordIdx);
            }
            lastSeenVersion = window._windowSettingsVersion;
        }

        var newWordIdx = -1;
        var searchPath = '';
        // Fast path: check current word, then next (covers ~99% of frames)
        if (lastWordIdx >= 0 && lastWordIdx < wordCache.length &&
            currentTime >= wordCache[lastWordIdx].start && currentTime < wordCache[lastWordIdx].end) {
            newWordIdx = lastWordIdx;
            searchPath = 'same';
        } else if (lastWordIdx + 1 < wordCache.length &&
            currentTime >= wordCache[lastWordIdx + 1].start && currentTime < wordCache[lastWordIdx + 1].end) {
            newWordIdx = lastWordIdx + 1;
            searchPath = 'next';
        } else {
            // Fallback: full scan (seeking, granularity switch, etc.)
            searchPath = 'scan';
            for (var i = 0; i < wordCache.length; i++) {
                if (currentTime >= wordCache[i].start && currentTime < wordCache[i].end) {
                    newWordIdx = i;
                    break;
                }
            }
            // Clamp to last word when past its end but audio hasn't ended yet
            if (newWordIdx === -1 && wordCache.length > 0 && currentTime >= wordCache[wordCache.length - 1].start) {
                newWordIdx = wordCache.length - 1;
                searchPath = 'clamp';
            }
        }

        // Only update DOM if word changed
        if (newWordIdx !== lastWordIdx) {
            var newText = newWordIdx >= 0 ? wordCache[newWordIdx].el.textContent.substring(0, 15) : '-';
            animDebug('TICK', 'idx change: ' + lastWordIdx + ' -> ' + newWordIdx + ' (' + searchPath + ') t=' + currentTime.toFixed(3) + ' "' + newText + '"');
            if (newWordIdx === -1 && wordCache.length > 0) {
                // No match - log surrounding timing info
                var first = wordCache[0];
                var last = wordCache[wordCache.length - 1];
                animDebug('TICK', '  NO MATCH: t=' + currentTime.toFixed(3) + ' cache[0]=[' + first.start.toFixed(3) + ',' + first.end.toFixed(3) + '] cache[' + (wordCache.length-1) + ']=[' + last.start.toFixed(3) + ',' + last.end.toFixed(3) + ']');
            }
            if (lastWordIdx >= 0 && lastWordIdx < wordCache.length) {
                applyClassToGroup(wordCache, lastWordIdx, 'active', false);
                applyClassToGroup(wordCache, lastWordIdx, 'reached', true);
            }
            if (newWordIdx >= 0) {
                applyClassToGroup(wordCache, newWordIdx, 'active', true);
                if (lastWordIdx === -1) {
                    // First highlight — catch up any skipped words (with group support)
                    for (var j = 0; j < newWordIdx; j++) {
                        applyClassToGroup(wordCache, j, 'reached', true);
                    }
                }
            }
            if (newWordIdx >= 0) {
                applyWindowOpacity(wordCache, newWordIdx, lastWordIdx);
            }
            lastWordIdx = newWordIdx;
        }
    }

    function rafLoop() {
        tick();
        if (!audio.paused && !audio.ended) {
            audio._rafId = requestAnimationFrame(rafLoop);
        }
    }
    audio._rafId = requestAnimationFrame(rafLoop);
}

function toggleAnimation(btn) {
    var card = btn.closest('.segment-card');
    if (!card) return;
    var audio = card.querySelector('audio');
    if (!audio) return;

    var isActive = btn.classList.toggle('active');
    if (isActive) {
        btn.textContent = 'Stop';
        // Apply window engine class to card
        card.classList.add('anim-window');
        if (window.ANIM_GRANULARITY === 'Characters') {
            card.classList.add('anim-chars');
        }
        // Build both caches upfront for live granularity switching
        audio._cacheWords = initCacheFor(card, '.segment-text .word');
        audio._cacheChars = initCacheFor(card, '.segment-text .char');
        animDebug('START', 'toggleAnimation: words=' + audio._cacheWords.length + ' chars=' + audio._cacheChars.length + ' granularity=' + window.ANIM_GRANULARITY);
        dumpCacheTimestamps(audio._cacheWords, 'Words');
        dumpCacheTimestamps(audio._cacheChars, 'Chars');
        activateAudio(audio);
        startAnimation(audio, card);
        audio.play();
    } else {
        btn.textContent = 'Animate';
        audio.pause();
        stopAnimation(audio, card);
    }
}
