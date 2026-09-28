(() => {
    'use strict';

    const VERSION = '2.2.0';
    const BUILD = `st-keepalive-5m@${VERSION}`;
    const BASE_URL = import.meta.url;
    const PIP_VIDEO_URL = new URL(`./pip-loop.mp4?v=${VERSION}`, BASE_URL).href;
    const KEEPALIVE_AUDIO_URL = new URL(`./silent-5m.mp3?v=${VERSION}`, BASE_URL).href;
    const DONE_AUDIO_URL = new URL(`./reply-done.mp3?v=${VERSION}`, BASE_URL).href;

    const LEGACY_BUTTON_ID = 'st-keepalive-5m-button';
    const VIDEO_ID = 'st-keepalive-5m-video';
    const PANEL_ID = 'st-keepalive-5m-panel';
    const PANEL_BUTTON_ID = 'st-keepalive-5m-panel-button';
    const LEGACY_PREVIEW_ID = 'st-keepalive-5m-panel-preview';

    const DONE_SOUND_DELAY_MS = 350;
    const DONE_SOUND_VOLUME = 0.78;
    const KEEPALIVE_LIMIT_MS = 5 * 60 * 1000;

    // v2.2.0 取消悬浮按钮，只在 SillyTavern 扩展程序面板中提供常驻 PiP 按钮。
    // 如果页面里残留上一版实例，先尽力停掉并清理旧 DOM，而不是直接 return。
    try { globalThis.STKeepAlive5m?.stop?.(); } catch (_) {}
    for (const id of [LEGACY_BUTTON_ID, VIDEO_ID, PANEL_ID, LEGACY_PREVIEW_ID]) {
        try { document.getElementById(id)?.remove(); } catch (_) {}
    }

    const state = {
        build: BUILD,
        audio: null,
        video: null,
        doneAudio: null,
        doneAudioUnlocked: false,
        keepaliveWanted: false,
        playing: false,
        pipActive: false,
        mode: 'detecting',
        reason: '',
        lastError: '',
        eventBound: false,
        doneSoundEnabled: true,
        doneSoundTimer: null,
        keepaliveTimer: null,
        generationSerial: 0,
        lastGenerationStoppedAt: 0,
        observer: null,
        booted: false,
    };
    globalThis.__ST_KEEPALIVE_5M__ = state;

    function context() {
        try {
            if (globalThis.SillyTavern?.getContext) return globalThis.SillyTavern.getContext();
            if (globalThis.SillyTavern?.context) return globalThis.SillyTavern.context;
            if (globalThis.getContext) return globalThis.getContext();
        } catch (_) {}
        return null;
    }

    function isIOS() {
        return /iPad|iPhone|iPod/i.test(navigator.userAgent || '')
            || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
    }

    function isStandalone() {
        try {
            return navigator.standalone === true
                || globalThis.matchMedia?.('(display-mode: standalone)')?.matches === true
                || globalThis.matchMedia?.('(display-mode: fullscreen)')?.matches === true;
        } catch (_) {
            return navigator.standalone === true;
        }
    }

    function isIOSStandalone() {
        return isIOS() && isStandalone();
    }

    function toast(message, type = 'info') {
        try {
            if (globalThis.toastr?.[type]) {
                globalThis.toastr[type](message, 'PiP 后台支架');
                return;
            }
        } catch (_) {}
        if (type === 'error' || type === 'warning') {
            try { alert(message); } catch (_) {}
        }
    }

    function prepareMediaElement(media) {
        media.preload = 'auto';
        media.playsInline = true;
        media.setAttribute('playsinline', '');
        media.setAttribute('webkit-playsinline', '');
        return media;
    }

    function supportsWebKitPiP(video = state.video) {
        if (!video) return false;
        try {
            return typeof video.webkitSupportsPresentationMode === 'function'
                && video.webkitSupportsPresentationMode('picture-in-picture')
                && typeof video.webkitSetPresentationMode === 'function';
        } catch (_) {
            return false;
        }
    }

    function supportsStandardPiP(video = state.video) {
        if (!video) return false;
        return !!document.pictureInPictureEnabled
            && typeof video.requestPictureInPicture === 'function';
    }

    function hasPiPAPI(video = state.video) {
        if (!video) return false;
        return typeof video.webkitSetPresentationMode === 'function'
            || typeof video.requestPictureInPicture === 'function';
    }

    function iosStandaloneProbeRejectsPiP(video = state.video) {
        if (!isIOSStandalone() || !video) return false;
        try {
            // iOS 主屏幕 Web App 中，标准 document.pictureInPictureEnabled 可能仍错误返回 true；
            // WebKit probe 在当前实现里更可靠。
            if (typeof video.webkitSupportsPresentationMode === 'function') {
                return !video.webkitSupportsPresentationMode('picture-in-picture');
            }
        } catch (_) {}
        return false;
    }

    function supportsPiP(video = state.video) {
        if (iosStandaloneProbeRejectsPiP(video)) return false;
        return supportsWebKitPiP(video) || supportsStandardPiP(video);
    }

    function detectMode() {
        const video = ensureVideo();
        if (iosStandaloneProbeRejectsPiP(video)) {
            state.mode = 'ios-standalone-no-pip';
        } else if (supportsPiP(video) || hasPiPAPI(video)) {
            state.mode = 'pip-video';
        } else if (isIOS()) {
            // iPhone 上用户的目标就是避免音频抢媒体会话，所以不自动回退静音音频。
            state.mode = 'ios-no-pip';
        } else {
            state.mode = 'audio-fallback';
        }
        renderAll();
        return state.mode;
    }

    function clearKeepaliveTimer() {
        if (state.keepaliveTimer !== null) {
            clearTimeout(state.keepaliveTimer);
            state.keepaliveTimer = null;
        }
    }

    function armKeepaliveTimer() {
        clearKeepaliveTimer();
        state.keepaliveTimer = setTimeout(() => {
            state.keepaliveTimer = null;
            stopKeepAlive().catch(() => {});
        }, KEEPALIVE_LIMIT_MS);
    }

    function applyHiddenVideoStyle(video) {
        const s = video.style;
        s.setProperty('position', 'fixed', 'important');
        s.setProperty('left', '1px', 'important');
        s.setProperty('top', '1px', 'important');
        s.setProperty('width', '2px', 'important');
        s.setProperty('height', '2px', 'important');
        s.setProperty('opacity', '0.01', 'important');
        s.setProperty('pointer-events', 'none', 'important');
        s.setProperty('z-index', '2147483000', 'important');
        s.setProperty('display', 'block', 'important');
    }

    function ensureVideo() {
        if (state.video?.isConnected) return state.video;

        const video = prepareMediaElement(document.createElement('video'));
        video.id = VIDEO_ID;
        video.src = PIP_VIDEO_URL;
        video.loop = true;
        video.muted = true;
        video.defaultMuted = true;
        video.volume = 0;
        video.autoplay = false;
        video.controls = false;
        video.disablePictureInPicture = false;
        video.setAttribute('muted', '');
        video.setAttribute('aria-hidden', 'true');
        applyHiddenVideoStyle(video);

        video.addEventListener('loadedmetadata', () => {
            detectMode();
        });
        video.addEventListener('canplay', () => {
            detectMode();
        });
        video.addEventListener('play', () => {
            state.playing = true;
            state.lastError = '';
            renderAll();
        });
        video.addEventListener('pause', () => {
            if (!state.pipActive) state.playing = false;
            renderAll();
        });
        video.addEventListener('error', () => {
            state.lastError = 'pip-video-error';
            state.playing = false;
            console.warn('[PiP后台支架] pip-loop.mp4 加载失败。请确认文件存在，编码建议 H.264 MP4。');
            renderAll();
        });
        video.addEventListener('enterpictureinpicture', () => {
            state.pipActive = true;
            state.playing = true;
            state.lastError = '';
            renderAll();
        });
        video.addEventListener('leavepictureinpicture', handlePiPLeft);
        video.addEventListener('webkitpresentationmodechanged', () => {
            const active = video.webkitPresentationMode === 'picture-in-picture';
            if (active) {
                state.pipActive = true;
                state.playing = true;
                state.lastError = '';
                renderAll();
            } else if (state.pipActive) {
                handlePiPLeft();
            }
        });

        (document.body || document.documentElement).appendChild(video);
        try { video.load(); } catch (_) {}
        state.video = video;
        return video;
    }

    function ensureFallbackAudio() {
        if (state.audio) return state.audio;
        const audio = prepareMediaElement(new Audio(KEEPALIVE_AUDIO_URL));
        audio.loop = false;
        audio.addEventListener('play', () => {
            state.playing = true;
            state.lastError = '';
            renderAll();
        });
        audio.addEventListener('pause', () => {
            state.playing = false;
            renderAll();
        });
        audio.addEventListener('ended', () => {
            state.keepaliveWanted = false;
            state.playing = false;
            state.reason = '';
            try { audio.currentTime = 0; } catch (_) {}
            renderAll();
        });
        audio.addEventListener('error', () => {
            state.lastError = 'keepalive-audio-error';
            state.playing = false;
            renderAll();
        });
        state.audio = audio;
        return audio;
    }

    function ensureDoneAudio() {
        if (state.doneAudio) return state.doneAudio;
        const audio = prepareMediaElement(new Audio(DONE_AUDIO_URL));
        audio.loop = false;
        audio.volume = DONE_SOUND_VOLUME;
        audio.addEventListener('error', () => console.warn('[PiP后台支架] 回复完成提示音加载失败。'));
        state.doneAudio = audio;
        return audio;
    }

    function cancelPendingDoneSound() {
        if (state.doneSoundTimer !== null) {
            clearTimeout(state.doneSoundTimer);
            state.doneSoundTimer = null;
        }
    }

    function handlePiPLeft() {
        state.pipActive = false;
        if (state.keepaliveWanted && state.mode === 'pip-video') {
            state.keepaliveWanted = false;
            state.reason = '';
            clearKeepaliveTimer();
            const video = state.video;
            if (video) {
                try { video.pause(); } catch (_) {}
                try { video.currentTime = 0; } catch (_) {}
            }
            state.playing = false;
        }
        renderAll();
    }

    async function exitPiP() {
        const video = state.video;
        if (!video || !state.pipActive) return;
        try {
            if (document.pictureInPictureElement === video && typeof document.exitPictureInPicture === 'function') {
                await document.exitPictureInPicture();
            } else if (typeof video.webkitSetPresentationMode === 'function' && video.webkitPresentationMode === 'picture-in-picture') {
                video.webkitSetPresentationMode('inline');
            }
        } catch (_) {}
        state.pipActive = false;
    }

    async function stopKeepAlive() {
        state.keepaliveWanted = false;
        state.reason = '';
        clearKeepaliveTimer();

        const video = state.video;
        if (video) {
            await exitPiP();
            try { video.pause(); } catch (_) {}
            try { video.currentTime = 0; } catch (_) {}
        }
        if (state.audio) {
            try { state.audio.pause(); } catch (_) {}
            try { state.audio.currentTime = 0; } catch (_) {}
        }
        state.playing = false;
        renderAll();
    }

    async function playVideoInline(reason = 'manual') {
        const video = ensureVideo();
        state.keepaliveWanted = true;
        state.reason = reason;
        state.lastError = '';
        video.muted = true;
        video.defaultMuted = true;
        video.volume = 0;
        try {
            await video.play();
            state.playing = true;
            armKeepaliveTimer();
            return true;
        } catch (error) {
            state.playing = false;
            state.lastError = String(error?.name || error?.message || 'video-play-blocked');
            console.warn('[PiP后台支架] 浏览器阻止了循环视频播放，请点 PiP 按钮。', error);
            return false;
        } finally {
            renderAll();
        }
    }

    function pwaUnsupportedMessage() {
        return '当前看起来是 iPhone“添加到主屏幕/独立 Web App”模式。这个容器目前存在 WebKit PiP 限制；请用 Safari 直接打开同一个 SillyTavern 地址，再点“启动 PiP”。插件不会在这里退回静音音频，以免继续抢占你的视频声音。';
    }

    async function enterPiPFromGesture(reason = 'manual') {
        const video = ensureVideo();
        detectMode();

        if (state.mode === 'ios-standalone-no-pip') {
            state.lastError = 'ios-standalone-pip-unsupported';
            renderAll();
            toast(pwaUnsupportedMessage(), 'warning');
            return false;
        }
        if (state.mode === 'ios-no-pip') {
            state.lastError = 'ios-pip-unsupported';
            renderAll();
            toast('当前 iPhone 浏览器没有提供可用的网页 PiP。请确认是在 Safari 中打开，并在“设置 → 通用 → 画中画”中允许画中画。', 'warning');
            return false;
        }

        state.keepaliveWanted = true;
        state.reason = reason;
        state.lastError = '';
        video.muted = true;
        video.defaultMuted = true;
        video.volume = 0;

        // 由这次点击直接触发，尽量保留 user activation。
        let playPromise;
        try { playPromise = video.play(); } catch (error) { playPromise = Promise.reject(error); }

        try {
            if (supportsWebKitPiP(video)) {
                video.webkitSetPresentationMode('picture-in-picture');
            } else if (supportsStandardPiP(video) && !iosStandaloneProbeRejectsPiP(video)) {
                await video.requestPictureInPicture();
            } else if (hasPiPAPI(video)) {
                throw new DOMException('Picture-in-Picture is not available in this container.', 'NotSupportedError');
            } else if (!isIOS()) {
                state.mode = 'audio-fallback';
                try { video.pause(); } catch (_) {}
                return startAudioFallback(reason);
            } else {
                state.mode = 'ios-no-pip';
                throw new DOMException('Picture-in-Picture is not supported.', 'NotSupportedError');
            }

            await playPromise;
            state.playing = true;
            state.pipActive = video.webkitPresentationMode === 'picture-in-picture'
                || document.pictureInPictureElement === video
                || state.pipActive;
            armKeepaliveTimer();
            renderAll();
            return true;
        } catch (error) {
            try { await playPromise; } catch (_) {}
            state.pipActive = false;
            state.playing = !video.paused;
            state.lastError = String(error?.name || error?.message || 'pip-blocked');
            console.warn('[PiP后台支架] 没能进入画中画。', error);
            renderAll();
            if (isIOSStandalone()) toast(pwaUnsupportedMessage(), 'warning');
            return false;
        }
    }

    async function startAudioFallback(reason = 'manual') {
        if (isIOS()) return false;
        const audio = ensureFallbackAudio();
        state.keepaliveWanted = true;
        state.reason = reason;
        state.lastError = '';
        try {
            audio.pause();
            audio.currentTime = 0;
            await audio.play();
            state.playing = true;
        } catch (error) {
            state.playing = false;
            state.lastError = String(error?.name || error?.message || 'play-blocked');
        }
        renderAll();
        return state.playing;
    }

    async function startKeepAlive(reason = 'manual') {
        if (state.mode === 'detecting') detectMode();
        if (state.mode === 'pip-video') return playVideoInline(reason);
        if (state.mode === 'audio-fallback') return startAudioFallback(reason);
        return false;
    }

    async function playDoneSound() {
        if (!state.doneSoundEnabled) return false;
        const audio = ensureDoneAudio();
        try {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = DONE_SOUND_VOLUME;
            audio.muted = false;
            await audio.play();
            state.doneAudioUnlocked = true;
            return true;
        } catch (error) {
            console.warn('[PiP后台支架] 回复完成，但浏览器阻止了提示音播放。', error);
            return false;
        }
    }

    function scheduleDoneSound() {
        cancelPendingDoneSound();
        if (Date.now() - state.lastGenerationStoppedAt < 1500) return;
        const serial = state.generationSerial;
        state.doneSoundTimer = setTimeout(() => {
            state.doneSoundTimer = null;
            if (serial !== state.generationSerial) return;
            playDoneSound().catch(() => {});
        }, DONE_SOUND_DELAY_MS);
    }

    async function unlockDoneAudioFromGesture() {
        if (state.doneAudioUnlocked) return;
        const doneAudio = ensureDoneAudio();
        try {
            const previousMuted = doneAudio.muted;
            doneAudio.muted = true;
            doneAudio.currentTime = 0;
            await doneAudio.play();
            doneAudio.pause();
            doneAudio.currentTime = 0;
            doneAudio.muted = previousMuted;
            state.doneAudioUnlocked = true;
        } catch (_) {
            try { doneAudio.muted = false; } catch (_) {}
        }
    }

    async function handleControlClick(event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (state.mode === 'detecting') detectMode();

        if (state.pipActive) {
            await stopKeepAlive();
            return;
        }

        if (state.mode === 'pip-video' || state.mode === 'ios-standalone-no-pip' || state.mode === 'ios-no-pip') {
            await enterPiPFromGesture('manual');
            unlockDoneAudioFromGesture().catch(() => {});
            return;
        }

        if (state.keepaliveWanted && state.playing) await stopKeepAlive();
        else {
            await unlockDoneAudioFromGesture();
            await startAudioFallback('manual');
        }
    }

    function ensureSettingsPanel() {
        const container = document.getElementById('extensions_settings');
        if (!container) return null;

        // v2.2.0: 永久移除旧版本的悬浮按钮，避免旧 DOM/缓存把它重新显示出来。
        try { document.getElementById(LEGACY_BUTTON_ID)?.remove(); } catch (_) {}

        let panel = document.getElementById(PANEL_ID);
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = 'inline-drawer st-pip-static-panel';
        panel.innerHTML = `
            <div class="inline-drawer-header st-pip-panel-header">
                <b>PiP 后台支架</b>
            </div>
            <div class="st-pip-panel-content">
                <button id="${PANEL_BUTTON_ID}" type="button" class="menu_button">PiP视频开启</button>
            </div>`;
        container.appendChild(panel);

        document.getElementById(PANEL_BUTTON_ID)?.addEventListener('click', handleControlClick);
        renderPanel();
        return panel;
    }

    function buttonText() {
        if (state.pipActive) return '关闭PiP视频';
        if (state.playing && state.mode === 'pip-video') return '进入PiP画中画';
        if (state.lastError) return '重试PiP视频';
        return 'PiP视频开启';
    }

    function panelStatus() {
        if (state.mode === 'ios-standalone-no-pip') return pwaUnsupportedMessage();
        if (state.mode === 'ios-no-pip') return '当前 iPhone 浏览器未报告可用网页 PiP；建议直接用 Safari 打开，而不是应用内网页或主屏幕 Web App。';
        if (state.pipActive) return 'PiP 正在运行；循环视频最长约 5 分钟。再次点击可退出。';
        if (state.mode === 'audio-fallback') return '此浏览器没有 PiP，非 iPhone 环境下使用旧音频兜底。';
        if (state.lastError) return `上次进入 PiP 失败：${state.lastError}。请再次点击“PiP视频开启”；若是 iPhone 主屏幕 Web App，请改用 Safari 打开。`;
        return '点击“PiP视频开启”后，pip-loop.mp4 会循环进入系统画中画。你可以直接用自己的 H.264 MP4 覆盖同名文件。';
    }

    function renderPanel() {
        ensureSettingsPanel();
        const pButton = document.getElementById(PANEL_BUTTON_ID);
        if (!pButton) return;
        pButton.textContent = buttonText();
        pButton.setAttribute('aria-pressed', state.pipActive || state.playing ? 'true' : 'false');
        pButton.title = panelStatus();
        pButton.classList.toggle('is-pip', !!state.pipActive);
        pButton.classList.toggle('is-warning', state.mode === 'ios-standalone-no-pip' || state.mode === 'ios-no-pip' || !!state.lastError);
    }

    function renderAll() {
        renderPanel();
    }

    function bindDomRepairObserver() {
        if (state.observer || !document.documentElement) return;
        let queued = false;
        state.observer = new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                try { document.getElementById(LEGACY_BUTTON_ID)?.remove(); } catch (_) {}
                if (!document.getElementById(VIDEO_ID)) ensureVideo();
                if (!document.getElementById(PANEL_ID)) ensureSettingsPanel();
            });
        });
        state.observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function bindGenerationEvents() {
        if (state.eventBound) return true;
        const c = context();
        const source = c?.eventSource;
        const types = c?.event_types || c?.eventTypes || globalThis.event_types || {};
        if (!source?.on) return false;

        const generationStarted = types.GENERATION_STARTED || 'generation_started';
        const generationEnded = types.GENERATION_ENDED || 'generation_ended';
        const generationStopped = types.GENERATION_STOPPED || 'generation_stopped';

        source.on(generationStarted, () => {
            cancelPendingDoneSound();
            state.generationSerial += 1;
            state.lastGenerationStoppedAt = 0;
            // 已经在 PiP 时，重新计时；没进 PiP 时只尝试视频播放，不在 iPhone 上退回音频。
            startKeepAlive('generation').catch(() => {});
        });
        source.on(generationEnded, scheduleDoneSound);
        source.on(generationStopped, () => {
            cancelPendingDoneSound();
            state.generationSerial += 1;
            state.lastGenerationStoppedAt = Date.now();
        });

        state.eventBound = true;
        console.info(`[PiP后台支架] ${BUILD} 已绑定生成事件。`);
        return true;
    }

    function boot() {
        if (state.booted) {
            renderAll();
            return;
        }
        state.booted = true;
        ensureVideo();
        ensureDoneAudio();
        ensureSettingsPanel();
        bindDomRepairObserver();
        detectMode();
        bindGenerationEvents();

        let attempts = 0;
        const retry = () => {
            try { document.getElementById(LEGACY_BUTTON_ID)?.remove(); } catch (_) {}
            ensureSettingsPanel();
            if (!state.eventBound && attempts < 60) {
                attempts += 1;
                bindGenerationEvents();
                setTimeout(retry, 250);
            }
        };
        retry();

        document.addEventListener('pointerdown', unlockDoneAudioFromGesture, { once: true, capture: true, passive: true });
        document.addEventListener('touchstart', unlockDoneAudioFromGesture, { once: true, capture: true, passive: true });

        globalThis.STKeepAlive5m = Object.freeze({
            start: () => startKeepAlive('api'),
            stop: () => stopKeepAlive(),
            enterPiP: () => enterPiPFromGesture('api'),
            exitPiP: () => exitPiP(),
            testDoneSound: () => playDoneSound(),
            repairUI: () => { try { document.getElementById(LEGACY_BUTTON_ID)?.remove(); } catch (_) {} ensureSettingsPanel(); renderAll(); return true; },
            setDoneSoundEnabled: (enabled) => {
                state.doneSoundEnabled = !!enabled;
                return state.doneSoundEnabled;
            },
            status: () => ({
                build: state.build,
                mode: state.mode,
                ios: isIOS(),
                standalone: isStandalone(),
                iosStandalone: isIOSStandalone(),
                webkitPiPSupported: supportsWebKitPiP(state.video),
                standardPiPSupported: supportsStandardPiP(state.video),
                pipActive: state.pipActive,
                playing: state.playing,
                reason: state.reason,
                lastError: state.lastError,
                doneSoundEnabled: state.doneSoundEnabled,
                pipVideoUrl: PIP_VIDEO_URL,
                legacyFloatingButtonExists: !!document.getElementById(LEGACY_BUTTON_ID),
                panelExists: !!document.getElementById(PANEL_ID),
                visualViewportWidth: Math.round(globalThis.visualViewport?.width || 0),
                visualViewportHeight: Math.round(globalThis.visualViewport?.height || 0),
                innerWidth: Math.round(globalThis.innerWidth || 0),
                innerHeight: Math.round(globalThis.innerHeight || 0),
            }),
        });

        console.info(`[PiP后台支架] ${BUILD} 启动。`, globalThis.STKeepAlive5m.status());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
