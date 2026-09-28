(() => {
    'use strict';

    const VERSION = '2.0.1';
    const BUILD = `st-keepalive-5m@${VERSION}`;
    const PIP_VIDEO_URL = new URL(`./pip-loop.mp4?v=${VERSION}`, import.meta.url).href;
    const KEEPALIVE_AUDIO_URL = new URL(`./silent-5m.mp3?v=${VERSION}`, import.meta.url).href;
    const DONE_AUDIO_URL = new URL(`./reply-done.mp3?v=${VERSION}`, import.meta.url).href;
    const BUTTON_ID = 'st-keepalive-5m-button';
    const VIDEO_ID = 'st-keepalive-5m-video';
    const DONE_SOUND_DELAY_MS = 350;
    const DONE_SOUND_VOLUME = 0.78;
    const KEEPALIVE_LIMIT_MS = 5 * 60 * 1000;

    if (globalThis.__ST_KEEPALIVE_5M__) return;

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
        viewportFixBound: false,
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

    function prepareMediaElement(media) {
        media.preload = 'auto';
        media.controls = false;
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

    function supportsPiP(video = state.video) {
        return supportsWebKitPiP(video) || supportsStandardPiP(video);
    }

    function detectMode() {
        const video = ensureVideo();
        // Safari 可能要等视频 metadata 就绪后，webkitSupportsPresentationMode 才给出最终结果。
        // 只要存在 PiP API，就优先保留视频路线，避免过早误判后启动音频兜底。
        state.mode = supportsPiP(video) || hasPiPAPI(video) ? 'pip-video' : 'audio-fallback';
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

    function ensureVideo() {
        if (state.video) return state.video;

        const video = prepareMediaElement(document.createElement('video'));
        video.id = VIDEO_ID;
        video.src = PIP_VIDEO_URL;
        video.loop = true;
        video.muted = true;
        video.defaultMuted = true;
        video.volume = 0;
        video.autoplay = false;
        video.disablePictureInPicture = false;
        video.setAttribute('muted', '');
        video.setAttribute('aria-hidden', 'true');

        video.addEventListener('loadedmetadata', () => {
            if (supportsPiP(video) || hasPiPAPI(video)) state.mode = 'pip-video';
            else if (state.mode === 'detecting') state.mode = 'audio-fallback';
            renderButton();
        });
        video.addEventListener('play', () => {
            if (state.mode === 'pip-video') state.playing = true;
            state.lastError = '';
            renderButton();
        });
        video.addEventListener('pause', () => {
            if (state.mode === 'pip-video') state.playing = false;
            renderButton();
        });
        video.addEventListener('error', () => {
            state.lastError = 'pip-video-error';
            state.playing = false;
            console.warn('[PiP后台支架] pip-loop.mp4 加载失败。请确认扩展目录里存在该文件，或替换成你自己的 H.264 MP4。');
            renderButton();
        });

        video.addEventListener('enterpictureinpicture', () => {
            state.pipActive = true;
            state.playing = true;
            state.lastError = '';
            renderButton();
        });
        video.addEventListener('leavepictureinpicture', () => {
            handlePiPLeft();
        });
        video.addEventListener('webkitpresentationmodechanged', () => {
            const active = video.webkitPresentationMode === 'picture-in-picture';
            if (active) {
                state.pipActive = true;
                state.playing = true;
                state.lastError = '';
                renderButton();
            } else if (state.pipActive) {
                handlePiPLeft();
            }
        });

        // 不能 display:none；Safari 需要一个真实的视频元素才能进入 PiP。
        (document.body || document.documentElement).appendChild(video);
        try { video.load(); } catch (_) {}

        state.video = video;
        return video;
    }

    function ensureFallbackAudio() {
        if (state.audio) return state.audio;
        const audio = prepareMediaElement(new Audio(KEEPALIVE_AUDIO_URL));
        audio.loop = false; // 文件本身约 5 分钟，仅作为不支持 PiP 时的兼容兜底。
        audio.addEventListener('play', () => {
            if (state.mode === 'audio-fallback') state.playing = true;
            state.lastError = '';
            renderButton();
        });
        audio.addEventListener('pause', () => {
            if (state.mode === 'audio-fallback') state.playing = false;
            renderButton();
        });
        audio.addEventListener('ended', () => {
            if (state.mode !== 'audio-fallback') return;
            state.keepaliveWanted = false;
            state.playing = false;
            state.reason = '';
            try { audio.currentTime = 0; } catch (_) {}
            renderButton();
        });
        audio.addEventListener('error', () => {
            state.lastError = 'keepalive-audio-error';
            state.playing = false;
            renderButton();
        });
        state.audio = audio;
        return audio;
    }

    function ensureDoneAudio() {
        if (state.doneAudio) return state.doneAudio;
        const audio = prepareMediaElement(new Audio(DONE_AUDIO_URL));
        audio.loop = false;
        audio.volume = DONE_SOUND_VOLUME;
        audio.addEventListener('error', () => {
            console.warn('[PiP后台支架] 回复完成提示音加载失败。');
        });
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

        // 用户从系统 PiP 浮窗主动关闭时，把支架一起停掉，避免 1px 隐藏视频继续耗电。
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
        renderButton();
    }

    async function exitPiP() {
        const video = state.video;
        if (!video || !state.pipActive) return;

        try {
            if (document.pictureInPictureElement === video && typeof document.exitPictureInPicture === 'function') {
                await document.exitPictureInPicture();
            } else if (supportsWebKitPiP(video) && video.webkitPresentationMode === 'picture-in-picture') {
                video.webkitSetPresentationMode('inline');
            }
        } catch (_) {}
        state.pipActive = false;
    }

    async function stopKeepAlive() {
        state.keepaliveWanted = false;
        state.reason = '';
        clearKeepaliveTimer();

        if (state.mode === 'pip-video') {
            const video = ensureVideo();
            await exitPiP();
            try { video.pause(); } catch (_) {}
            try { video.currentTime = 0; } catch (_) {}
        } else {
            const audio = ensureFallbackAudio();
            try { audio.pause(); } catch (_) {}
            try { audio.currentTime = 0; } catch (_) {}
        }

        state.playing = false;
        renderButton();
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
            console.warn('[PiP后台支架] 浏览器阻止了循环视频播放；请点一下右下角“PiP支架”按钮。', error);
            return false;
        } finally {
            renderButton();
        }
    }

    // 必须由用户点击直接触发。尤其是 iPhone Safari，不能在 GENERATION_STARTED 里可靠地自动进入 PiP。
    async function enterPiPFromGesture(reason = 'manual') {
        const video = ensureVideo();
        state.keepaliveWanted = true;
        state.reason = reason;
        state.lastError = '';
        video.muted = true;
        video.defaultMuted = true;
        video.volume = 0;

        // 先发起播放，但不要在 Safari 分支前等待异步操作，尽量保留当前点击的 user activation。
        const playPromise = video.play();

        try {
            if (supportsWebKitPiP(video)) {
                video.webkitSetPresentationMode('picture-in-picture');
            } else if (supportsStandardPiP(video)) {
                await video.requestPictureInPicture();
            } else if (hasPiPAPI(video)) {
                // API 存在但当前不可进入：常见于视频尚未就绪、系统 PiP 被关闭等情况。
                // 不自动切回音频，避免重新抢占 iPhone 的媒体会话。
                throw new DOMException('Picture-in-Picture is not available yet.', 'NotAllowedError');
            } else {
                state.mode = 'audio-fallback';
                try { video.pause(); } catch (_) {}
                return startAudioFallback(reason);
            }

            await playPromise;
            state.playing = true;
            state.pipActive = video.webkitPresentationMode === 'picture-in-picture'
                || document.pictureInPictureElement === video
                || state.pipActive;
            armKeepaliveTimer();
            renderButton();
            return true;
        } catch (error) {
            try { await playPromise; } catch (_) {}
            state.pipActive = false;
            state.playing = !video.paused;
            state.lastError = String(error?.name || error?.message || 'pip-blocked');
            console.warn('[PiP后台支架] 没能进入画中画。请确认系统允许 PiP，并在视频加载完成后再点一次按钮。', error);
            renderButton();
            return false;
        }
    }

    async function startAudioFallback(reason = 'manual') {
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
            console.warn('[PiP后台支架] 当前浏览器不支持 PiP，且音频兜底也被自动播放策略拦截；请点一下右下角按钮授权。', error);
        }
        renderButton();
        return state.playing;
    }

    async function startKeepAlive(reason = 'manual') {
        if (state.mode === 'detecting') detectMode();
        if (state.mode === 'pip-video') return playVideoInline(reason);
        return startAudioFallback(reason);
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
            console.warn('[PiP后台支架] 回复已经完成，但浏览器阻止了提示音播放。可先点一次 PiP 支架按钮完成媒体授权，或关闭提示音。', error);
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

    // 只解锁“回复完成提示音”。不再用首次触摸去播放 5 分钟静音音频，避免抢占 iPhone 媒体会话。
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

    function isMobileSafeLayout() {
        const vvWidth = Number(globalThis.visualViewport?.width || 0);
        const innerWidth = Number(globalThis.innerWidth || 0);
        const clientWidth = Number(document.documentElement?.clientWidth || 0);
        const visibleWidth = vvWidth || Math.min(innerWidth || Infinity, clientWidth || Infinity);
        const touch = Number(navigator.maxTouchPoints || 0) > 0;
        const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
        const ios = /iPad|iPhone|iPod/i.test(navigator.userAgent || '')
            || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);

        // 关键：iPhone 有时 layout viewport 仍然很宽，但 visualViewport 才是真正肉眼可见的宽度。
        // 不能只靠 CSS @media(max-width)，否则 right: 8px 可能被放到可视区域之外。
        return ios || (visibleWidth > 0 && visibleWidth <= 760) || (touch && coarse && innerWidth <= 1024);
    }

    function applyButtonViewportFix() {
        const button = document.getElementById(BUTTON_ID);
        if (!button) return;

        const mobileSafe = isMobileSafeLayout();
        button.classList.toggle('mobile-safe', mobileSafe);

        // 暴露一点诊断信息，方便之后直接在 Safari Web Inspector 里看。
        try {
            button.dataset.visualWidth = String(Math.round(globalThis.visualViewport?.width || 0));
            button.dataset.innerWidth = String(Math.round(globalThis.innerWidth || 0));
        } catch (_) {}
    }

    function bindButtonViewportFix() {
        if (state.viewportFixBound) return;
        state.viewportFixBound = true;

        const update = () => {
            requestAnimationFrame(() => {
                applyButtonViewportFix();
            });
        };

        globalThis.addEventListener?.('resize', update, { passive: true });
        globalThis.addEventListener?.('orientationchange', update, { passive: true });
        globalThis.visualViewport?.addEventListener?.('resize', update, { passive: true });
        globalThis.visualViewport?.addEventListener?.('scroll', update, { passive: true });
    }

    function renderButton() {
        const button = document.getElementById(BUTTON_ID);
        if (!button) return;

        applyButtonViewportFix();
        button.classList.toggle('is-playing', !!state.playing);
        button.classList.toggle('is-pip', !!state.pipActive);
        button.classList.toggle('needs-unlock', !!state.lastError && !state.pipActive);

        if (state.mode === 'audio-fallback') {
            if (state.playing) {
                button.textContent = '音频·5m';
                button.title = '当前浏览器未提供可用 PiP，正在使用旧版 5 分钟静音音频兜底。点一下可停止。';
            } else {
                button.textContent = state.lastError ? '点我授权' : '音频支架';
                button.title = '当前浏览器未提供可用 PiP；点一下启动 5 分钟静音音频兜底。';
            }
        } else if (state.pipActive) {
            button.textContent = 'PiP·5m';
            button.title = '循环视频正在系统画中画中播放。点一下退出 PiP 并停止支架。';
        } else if (state.playing) {
            button.textContent = '开PiP';
            button.title = '循环视频已播放，但还没有进入系统画中画。点一下进入 PiP。';
        } else if (state.lastError) {
            button.textContent = '再点PiP';
            button.title = '上次进入 PiP 失败。确认 pip-loop.mp4 可播放且系统允许画中画，然后再点一次。';
        } else {
            button.textContent = 'PiP支架';
            button.title = '点一下播放 pip-loop.mp4 并进入画中画；最长运行约 5 分钟。';
        }

        button.setAttribute('aria-pressed', state.pipActive || state.playing ? 'true' : 'false');
    }

    function ensureButton() {
        if (!document.body || document.getElementById(BUTTON_ID)) return;
        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = 'PiP支架';
        button.setAttribute('aria-label', '5分钟 PiP 后台支架');
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (state.mode === 'detecting') detectMode();

            if (state.mode === 'pip-video') {
                if (state.pipActive) {
                    await stopKeepAlive();
                } else {
                    // PiP 请求优先使用这一次点击的 user activation，再去解锁提示音。
                    await enterPiPFromGesture('manual');
                    unlockDoneAudioFromGesture().catch(() => {});
                }
            } else if (state.keepaliveWanted && state.playing) {
                await stopKeepAlive();
            } else {
                await unlockDoneAudioFromGesture();
                await startAudioFallback('manual');
            }
        });
        document.body.appendChild(button);
        bindButtonViewportFix();
        applyButtonViewportFix();
        renderButton();
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

            // 如果用户已经开着 PiP，就继续/重置 5 分钟；否则只启动静音循环视频，等待用户点“开PiP”。
            startKeepAlive('generation').catch(() => {});
        });

        source.on(generationEnded, () => {
            scheduleDoneSound();
        });

        source.on(generationStopped, () => {
            cancelPendingDoneSound();
            state.generationSerial += 1;
            state.lastGenerationStoppedAt = Date.now();
        });

        state.eventBound = true;
        console.info(`[PiP后台支架] ${BUILD} 已绑定 GENERATION_STARTED / GENERATION_ENDED / GENERATION_STOPPED。`);
        return true;
    }

    function boot() {
        ensureVideo();
        ensureDoneAudio();
        detectMode();
        ensureButton();
        bindGenerationEvents();

        let attempts = 0;
        const retry = () => {
            if (state.eventBound || attempts >= 40) return;
            attempts += 1;
            if (!bindGenerationEvents()) setTimeout(retry, 250);
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
            setDoneSoundEnabled: (enabled) => {
                state.doneSoundEnabled = !!enabled;
                return state.doneSoundEnabled;
            },
            status: () => ({
                build: state.build,
                mode: state.mode,
                pipSupported: supportsPiP(state.video),
                pipActive: state.pipActive,
                doneAudioUnlocked: state.doneAudioUnlocked,
                playing: state.playing,
                reason: state.reason,
                lastError: state.lastError,
                doneSoundEnabled: state.doneSoundEnabled,
                pipVideoUrl: PIP_VIDEO_URL,
                mobileSafeLayout: isMobileSafeLayout(),
                visualViewportWidth: Math.round(globalThis.visualViewport?.width || 0),
                innerWidth: Math.round(globalThis.innerWidth || 0),
            }),
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
