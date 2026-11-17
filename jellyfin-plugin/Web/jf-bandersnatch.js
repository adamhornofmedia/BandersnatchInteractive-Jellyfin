/*
 * Bandersnatch choices inside the native Jellyfin web player.
 * Branching logic ported from joric/bandersnatch (original version) with fixes by CyberShadow
 * and the web player by mehotkhan; Jellyfin plugin based on deathrjj's fork. Unlicense.
 * Activates only when the playing <video> is the 5:12:14 Bandersnatch file.
 */
(function () {
	'use strict';
	if (window.__jfBandersnatch) return;
	// Jellyfin Media Player / Jellyfin Desktop render video with mpv under the web layer,
	// there is no <video> element to drive, so stay completely out of the way there.
	if (window.jmpInfo || window.api && window.api.player || /JellyfinMediaPlayer|Jellyfin ?Desktop|QtWebEngine/i.test(navigator.userAgent)) return;
	window.__jfBandersnatch = true;

	var BASE = '/InteractiveVideo/Web/assets/';
	var TARGET_DURATION = 18734.28;
	var STORE_KEY = 'jfBandersnatchState';

	var video = null;          // active Jellyfin <video>
	var overlay = null;
	var dataPromise = null;

	// ---------- data loading ----------
	function loadScript(src) {
		return new Promise(function (resolve, reject) {
			var s = document.createElement('script');
			s.src = src;
			s.onload = resolve;
			s.onerror = reject;
			document.head.appendChild(s);
		});
	}
	function loadData() {
		if (!dataPromise) {
			dataPromise = Promise.all([
				loadScript(BASE + 'bandersnatch.js'),
				loadScript(BASE + 'SegmentMap.js'),
				loadScript(BASE + 'choices/en.js')
			]).then(initData);
		}
		return dataPromise;
	}

	var segmentMap, bv, choicePoints, momentsBySegment, segmentGroups, labels;
	var ls = {};

	function initData() {
		segmentMap = window.SegmentMap;
		bv = window.bandersnatch.videos['80988062'].interactiveVideoMoments.value;
		choicePoints = bv.choicePointNavigatorMetadata.choicePointsMetadata.choicePoints;
		momentsBySegment = bv.momentsBySegment;
		segmentGroups = bv.segmentGroups;
		labels = window.en || {};
		try { ls = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { ls = {}; }
		if (!ls.initialized) resetState();
	}
	function saveState() {
		try { localStorage.setItem(STORE_KEY, JSON.stringify(ls)); } catch (e) { /* ignore */ }
	}
	function resetState() {
		ls = {};
		for (var k in bv.stateHistory) ls['persistentState_' + k] = JSON.stringify(bv.stateHistory[k]);
		ls.initialized = 't';
		saveState();
	}

	// ---------- branching engine ----------
	function getCurrentMs() { return Math.round(video.currentTime * 1000.0); }

	function preconditionToJS(cond) {
		if (cond[0] == 'persistentState') return 'JSON.parse(ls["persistentState_' + cond[1] + '"])';
		if (cond[0] == 'not') return '!(' + preconditionToJS(cond[1]) + ')';
		if (cond[0] == 'and') return '(' + cond.slice(1).map(preconditionToJS).join(' && ') + ')';
		if (cond[0] == 'or') return '(' + cond.slice(1).map(preconditionToJS).join(' || ') + ')';
		if (cond[0] == 'eql' && cond.length == 3) return '(' + cond.slice(1).map(preconditionToJS).join(' == ') + ')';
		if (cond === false) return 'false';
		if (cond === true) return 'true';
		if (typeof cond === 'string') return JSON.stringify(cond);
		return 'true';
	}
	function evalPrecondition(precondition) {
		if (!precondition) return true;
		try { return eval(preconditionToJS(precondition)); } catch (e) { return true; }
	}
	function checkPrecondition(id) { return evalPrecondition(bv.preconditions[id]); }

	function resolveSegmentGroup(sg) {
		var results = [];
		for (var v of segmentGroups[sg]) {
			if (v.precondition && !checkPrecondition(v.precondition)) continue;
			if (v.segmentGroup) results.push(resolveSegmentGroup(v.segmentGroup));
			else if (v.segment) results.push(v.segment);
			else { if (!checkPrecondition(v)) continue; results.push(v); }
		}
		return results[0];
	}
	function getSegmentId(ms) {
		for (var k in segmentMap.segments) {
			var v = segmentMap.segments[k];
			if (ms >= v.startTimeMs && (!v.endTimeMs || ms < v.endTimeMs)) return k;
		}
		return null;
	}
	function getMoments(segmentId, ms) {
		var result = {};
		var list = momentsBySegment[segmentId] || [];
		for (var i = 0; i < list.length; i++) {
			var m = list[i];
			if (ms >= m.startMs && ms < m.endMs && evalPrecondition(m.precondition)) result[segmentId + '/' + i] = m;
		}
		return result;
	}
	function applyImpression(d) {
		if (d && d.type == 'userState') {
			for (var k in d.data.persistent) ls['persistentState_' + k] = JSON.stringify(d.data.persistent[k]);
			saveState();
		}
	}
	function seek(ms) {
		video.currentTime = ms / 1000.0;
		ontimeupdate();
	}
	function playSegment(segmentId) {
		if (getSegmentId(getCurrentMs()) == segmentId) return false; // already playing it (contiguous)
		seek(segmentMap.segments[segmentId].startTimeMs);
		return true;
	}

	var nextChoice = -1, currentChoiceMoment = null;
	var timerId = 0, lastMs = 0, currentSegment = null, lastSegment = null;
	var segmentTransition = false, lastMoments = {};

	function playNextSegment(prevSegment) {
		var next = null;
		if (nextChoice >= 0 && currentChoiceMoment) {
			var x = currentChoiceMoment.choices[nextChoice];
			if (x.segmentId) next = x.segmentId;
			else if (x.sg) next = resolveSegmentGroup(x.sg);
			nextChoice = -1;
			ls.runChoices = (ls.runChoices || 0) + 1;
			applyImpression(x.impressionData);
		}
		if (!next && prevSegment && prevSegment in segmentGroups) next = resolveSegmentGroup(prevSegment);
		if (!next && prevSegment && segmentMap.segments[prevSegment].defaultNext) next = segmentMap.segments[prevSegment].defaultNext;
		if (!next) return false;
		segmentTransition = true;
		return playSegment(next);
	}

	function choose(index) {
		nextChoice = index;
		renderChoices(null, true);
		if (currentChoiceMoment && !(currentChoiceMoment.config && currentChoiceMoment.config.disableImmediateSceneTransition)) {
			playNextSegment(lastSegment);
		}
	}

	function ontimeupdate() {
		if (!video || !segmentMap) return;
		var ms = getCurrentMs();
		currentSegment = getSegmentId(ms);
		var segment = segmentMap.segments[currentSegment];
		if (timerId) { clearTimeout(timerId); timerId = 0; }

		var elapsed = ms - lastMs;
		var seeked = elapsed < 0 || elapsed >= 2000;
		lastMs = ms;
		if (ms < 5000 && (ls.runMs || 0) > ms + 5000) { ls.runMs = 0; ls.runChoices = 0; } // new run from the start
		if (!seeked && elapsed > 0) { ls.runMs = (ls.runMs || 0) + elapsed; if ((ls.runMs % 10000) < elapsed) saveState(); }
		updateStatus();

		if (lastSegment != currentSegment) {
			var prev = lastSegment;
			lastSegment = currentSegment;
			if (!seeked && prev) {
				if (playNextSegment(prev)) return;
			}
		}

		var natural = !seeked || segmentTransition;
		segmentTransition = false;

		var cur = getMoments(currentSegment, ms);
		for (var k in lastMoments) if (!(k in cur)) momentEnd(lastMoments[k]);
		for (k in lastMoments) if (k in cur) momentUpdate(lastMoments[k], ms);
		for (k in cur) if (!(k in lastMoments)) momentStart(cur[k], !natural);
		lastMoments = cur;

		var nextEvent = segment ? segment.endTimeMs : 0;
		for (k in cur) if (cur[k].endMs < nextEvent) nextEvent = cur[k].endMs;
		for (var m of momentsBySegment[currentSegment] || []) if (ms < m.startMs && m.startMs < nextEvent) nextEvent = m.startMs;
		var left = nextEvent - ms;
		if (left > 0 && !video.paused) timerId = setTimeout(ontimeupdate, left / (video.playbackRate || 1));
	}

	function momentStart(m, seeked) {
		if (m.type == 'scene:interstitialPostPlay_v2') {
			var key = currentSegment.replace(/[AB]$/, '');
			ls.endings = ls.endings || [];
			if (ls.endings.indexOf(key) < 0) { ls.endings.push(key); saveState(); }
		}
		if (m.choices) {
			currentChoiceMoment = m;
			nextChoice = m.defaultChoiceIndex;
			renderChoices(m);
		}
		if (!seeked) applyImpression(m.impressionData);
	}
	function momentUpdate(m, ms) {
		if (m.choices && overlay) {
			var p = 100 - ((ms - m.startMs) * 100.0 / (m.endMs - m.startMs));
			overlay.querySelector('.bs-progress').style.width = Math.max(0, p) + '%';
		}
	}
	function momentEnd(m) {
		if (m.choices) renderChoices(null);
	}

	// ---------- UI ----------
	function overlayHost() {
		var fs = document.fullscreenElement || document.webkitFullscreenElement;
		return (fs && fs.tagName !== 'VIDEO') ? fs : document.body;
	}
	function ensureOverlay() {
		var host = overlayHost();
		if (overlay && overlay.parentElement === host) return;
		if (overlay) overlay.remove();
		overlay = document.createElement('div');
		overlay.className = 'bs-overlay';
		overlay.innerHTML = '<div class="bs-caption"></div><div class="bs-choices"></div><div class="bs-bar"><div class="bs-progress"></div></div>';
		['click', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup', 'dblclick'].forEach(function (ev) {
			overlay.addEventListener(ev, function (e) { e.stopPropagation(); });
		});
		host.appendChild(overlay);
	}

	var status = null, statusTimer = 0;
	function ensureStatus() {
		if (!status) {
			status = document.createElement('div');
			status.className = 'bs-status';
		}
		var host = overlayHost();
		if (status.parentElement !== host) host.appendChild(status);
	}
	function updateStatus() {
		if (!status || !currentSegment) return;
		var bits = [];
		bits.push(Math.floor((ls.runMs || 0) / 60000) + ' min');
		bits.push('volby: ' + (ls.runChoices || 0));
		bits.push('nalezené konce: ' + ((ls.endings || []).length));
		status.textContent = 'Bandersnatch · ' + bits.join(' · ');
	}
	function pokeStatus() {
		if (!video || !status) return;
		updateStatus();
		status.classList.add('bs-show');
		clearTimeout(statusTimer);
		statusTimer = setTimeout(function () { status.classList.remove('bs-show'); }, 3500);
	}

	function choiceLabel(m, c, i) {
		var t = (labels[m.id] && labels[m.id][c.id]) || c.text;
		return t || ('#' + (i + 1));
	}

	function renderChoices(m, chosen) {
		if (!overlay) return;
		var box = overlay.querySelector('.bs-choices');
		var cap = overlay.querySelector('.bs-caption');
		if (!m) {
			if (!chosen) overlay.classList.remove('bs-active');
			else {
				box.querySelectorAll('button').forEach(function (b, i) { b.disabled = true; if (i === nextChoice) b.classList.add('bs-picked'); });
				setTimeout(function () { overlay.classList.remove('bs-active'); }, 600);
			}
			if (!chosen) overlay.querySelector('.bs-progress').style.width = 0;
			return;
		}
		box.innerHTML = '';
		cap.textContent = (m.id in choicePoints && choicePoints[m.id].description) || '';
		if (m.type == 'scene:cs_bs_phone') {
			renderPhone(box);
		} else {
			m.choices.forEach(function (c, i) {
				var b = document.createElement('button');
				b.type = 'button';
				b.className = 'bs-choice';
				b.textContent = choiceLabel(m, c, i);
				bindTap(b, function () { choose(i); });
				box.appendChild(b);
			});
		}
		overlay.classList.add('bs-active');
	}

	function bindTap(el, fn) {
		var last = 0;
		function fire(e) {
			e.stopPropagation();
			if (e.cancelable) e.preventDefault();
			var now = Date.now();
			if (now - last < 400) return;
			last = now;
			fn();
		}
		el.addEventListener('pointerup', fire);
		el.addEventListener('touchend', fire);
		el.addEventListener('click', fire);
	}

	function renderPhone(box) {
		var digits = [];
		var disp = document.createElement('div');
		disp.className = 'bs-code';
		disp.textContent = '- - - - -';
		var pad = document.createElement('div');
		pad.className = 'bs-pad';
		for (var i = 0; i < 10; i++) {
			(function (d) {
				var b = document.createElement('button');
				b.type = 'button';
				b.className = 'bs-choice bs-digit';
				b.textContent = d;
				bindTap(b, function () {
					if (digits.length >= 5) return;
					digits.push(d);
					var s = digits.join(' ');
					for (var j = digits.length; j < 5; j++) s += ' -';
					disp.textContent = s.trim();
					if (digits.length == 5) choose(digits.join('') == '20541' ? 0 : 1);
				});
				pad.appendChild(b);
			})(i);
		}
		box.appendChild(disp);
		box.appendChild(pad);
	}

	var css = '' +
		'.bs-overlay{position:fixed;left:0;right:0;bottom:14%;z-index:2147483000;touch-action:manipulation;display:none;flex-direction:column;align-items:center;gap:.8em;pointer-events:none;font-family:inherit}' +
		'.bs-overlay.bs-active{display:flex}' +
		'.bs-caption{color:#fff;font-size:1.3em;text-shadow:0 0 6px #000;text-transform:uppercase;letter-spacing:.05em}' +
		'.bs-choices{display:flex;gap:1.2em;flex-wrap:wrap;justify-content:center;align-items:center;pointer-events:auto;max-width:92%}' +
		'.bs-choice{background:rgba(0,0,0,.65);color:#fff;border:2px solid rgba(255,255,255,.85);border-radius:4px;padding:.7em 1.6em;font-size:1.25em;font-weight:600;cursor:pointer;min-width:9em;text-transform:uppercase;transition:transform .15s,background .15s}' +
		'.bs-choice:hover,.bs-choice:focus{background:rgba(255,255,255,.9);color:#000;transform:scale(1.05);outline:none}' +
		'.bs-choice.bs-picked{background:#fff;color:#000;transform:scale(1.1)}' +
		'.bs-choice:disabled:not(.bs-picked){opacity:.35}' +
		'.bs-code{color:#fff;font-size:1.8em;letter-spacing:.3em;width:100%;text-align:center;text-shadow:0 0 6px #000}' +
		'.bs-pad{display:grid;grid-template-columns:repeat(5,auto);gap:.5em}' +
		'.bs-digit{min-width:3em;padding:.5em}' +
		'.bs-bar{width:min(40em,80%);height:4px;background:rgba(255,255,255,.25);pointer-events:none}' +
		'.bs-progress{height:100%;width:0;background:#fff;margin:0 auto}' +
		'.bs-status{position:fixed;top:4.5em;left:50%;transform:translateX(-50%);z-index:2147483000;background:rgba(0,0,0,.6);color:#fff;padding:.45em 1em;border-radius:2em;font-size:.95em;pointer-events:none;opacity:0;transition:opacity .3s;white-space:nowrap}' +
		'.bs-status.bs-show{opacity:1}' +
		'@media (max-width:600px){.bs-overlay{font-size:.75em;bottom:18%}.bs-choice{min-width:7em;padding:.6em 1em}}';

	function injectCss() {
		if (document.getElementById('bs-style')) return;
		var st = document.createElement('style');
		st.id = 'bs-style';
		st.textContent = css;
		document.head.appendChild(st);
	}

	// ---------- attach / detach to Jellyfin's player ----------
	function onTime() { ontimeupdate(); }
	function onPause() { if (timerId) { clearTimeout(timerId); timerId = 0; } }

	function attach(v) {
		if (video === v) return;
		detach();
		video = v;
		injectCss();
		loadData().then(function () {
			if (video !== v) return;
			ensureOverlay();
			ensureStatus();
			lastMs = getCurrentMs();
			lastSegment = null;
			lastMoments = {};
			v.addEventListener('timeupdate', onTime);
			v.addEventListener('seeked', onTime);
			v.addEventListener('play', onTime);
			v.addEventListener('pause', onPause);
			ontimeupdate();
		});
	}
	function detach() {
		if (!video) return;
		video.removeEventListener('timeupdate', onTime);
		video.removeEventListener('seeked', onTime);
		video.removeEventListener('play', onTime);
		video.removeEventListener('pause', onPause);
		if (timerId) { clearTimeout(timerId); timerId = 0; }
		if (overlay) { overlay.remove(); overlay = null; }
		if (status) { status.remove(); }
		saveState();
		video = null;
	}
	function isBandersnatch(v) {
		return v && isFinite(v.duration) && Math.abs(v.duration - TARGET_DURATION) < 2;
	}
	function scan() {
		var vids = document.querySelectorAll('video');
		var found = null;
		for (var i = 0; i < vids.length; i++) {
			var v = vids[i];
			if (!v.__bsHooked) {
				v.__bsHooked = true;
				v.addEventListener('loadedmetadata', scan);
				v.addEventListener('durationchange', scan);
				v.addEventListener('emptied', scan);
			}
			if (isBandersnatch(v)) found = v;
		}
		if (found) attach(found);
		else if (video && (!document.contains(video) || !isBandersnatch(video))) detach();
	}

	function onFullscreen() { if (video && overlay) ensureOverlayKeepState(); }
	function ensureOverlayKeepState() {
		var host = overlayHost();
		if (overlay.parentElement !== host) host.appendChild(overlay);
		if (status && status.parentElement !== host) host.appendChild(status);
	}
	['mousemove', 'touchstart', 'keydown'].forEach(function (ev) { document.addEventListener(ev, pokeStatus, { passive: true }); });
	document.addEventListener('fullscreenchange', onFullscreen);
	document.addEventListener('webkitfullscreenchange', onFullscreen);

	new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
	scan();

	window.jfBandersnatch = { reset: function () { if (bv) resetState(); }, state: function () { return ls; } };
})();
