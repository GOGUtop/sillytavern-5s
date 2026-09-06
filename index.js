(() => {
    'use strict';

    const VERSION = '1.1.0';
    const BUILD = `st-keepalive-5m@${VERSION}`;
    const KEEPALIVE_AUDIO_URL = new URL(`./silent-5m.mp3?v=${VERSION}`, import.meta.url).href;
    const DONE_AUDIO_URL = new URL(`./reply-done.mp3?v=${VERSION}`, import.meta.url).href;
    const BUTTON_ID = 'st-keepalive-5m-button';
    const DONE_SOUND_DELAY_MS = 350;
    const DONE_SOUND_VOLUME = 0.78;

    if (globalThis.__ST_KEEPALIVE_5M__) return;

    const state = {
        build: BUILD,
        audio: null,
        doneAudio: null,
        unlocked: false,
        doneAudioUnlocked: false,
        keepaliveWanted: false,
        playing: false,
        reason: '',
        lastError: '',
        eventBound: false,
        doneSoundEnabled: true,
        doneSoundTimer: null,
        generationSerial: 0,
        lastGenerationStoppedAt: 0,
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

    function prepareMediaElement(audio) {
        audio.preload = 'auto';
        audio.controls = false;
        audio.playsInline = true;
        audio.setAttribute('playsinline', '');
        audio.setAttribute('webkit-playsinline', '');
        return audio;
    }

    function ensureAudio() {
        if (state.audio) return state.audio;
        const audio = prepareMediaElement(new Audio(KEEPALIVE_AUDIO_URL));
        audio.loop = false; // 文件本身约5分钟，不做永久循环。
        audio.addEventListener('play', () => {
            state.playing = true;
            state.lastError = '';
            renderButton();
        });
        audio.addEventListener('pause', () => {
            state.playing = false;
            renderButton();
        });
        audio.addEventListener('ended', () => {
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
            console.warn('[5分钟后台支架] 回复完成提示音加载失败。');
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

    function stopKeepAlive() {
        state.keepaliveWanted = false;
        state.reason = '';
        const audio = ensureAudio();
        try { audio.pause(); } catch (_) {}
        try { audio.currentTime = 0; } catch (_) {}
        state.playing = false;
        renderButton();
    }

    async function startKeepAlive(reason = 'manual') {
        const audio = ensureAudio();
        state.keepaliveWanted = true;
        state.reason = reason;
        state.lastError = '';
        try {
            audio.pause();
            audio.currentTime = 0; // 每次新生成从完整5分钟重新计算。
            await audio.play();
            state.unlocked = true;
            state.playing = true;
        } catch (error) {
            state.playing = false;
            state.lastError = String(error?.name || error?.message || 'play-blocked');
            console.warn('[5分钟后台支架] 浏览器阻止了静音媒体播放；请点一下右下角“支架”按钮完成一次媒体授权。', error);
        }
        renderButton();
        return state.playing;
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
            console.warn('[5分钟后台支架] 回复已经完成，但浏览器阻止了提示音播放。请先在页面上点一次“支架”按钮完成媒体授权。', error);
            return false;
        }
    }

    function scheduleDoneSound() {
        cancelPendingDoneSound();

        // 如果用户刚刚手动停止生成，不把它当作“正常回复完成”。
        if (Date.now() - state.lastGenerationStoppedAt < 1500) return;

        const serial = state.generationSerial;
        state.doneSoundTimer = setTimeout(() => {
            state.doneSoundTimer = null;
            // 350ms 内如果又开始了续写/自动继续，则取消这次提示音，避免在回复中途响。
            if (serial !== state.generationSerial) return;
            playDoneSound().catch(() => {});
        }, DONE_SOUND_DELAY_MS);
    }

    // iOS Safari / WKWebView 对媒体播放有用户手势限制。
    // 第一次触摸页面时，同时解锁静音支架和完成提示音两个媒体元素。
    async function unlockFromGesture() {
        if (state.unlocked && state.doneAudioUnlocked) return;

        const keepalive = ensureAudio();
        const doneAudio = ensureDoneAudio();

        if (!state.unlocked && !state.keepaliveWanted) {
            try {
                keepalive.currentTime = 0;
                await keepalive.play();
                state.unlocked = true;
                setTimeout(() => {
                    if (state.keepaliveWanted) return;
                    try { keepalive.pause(); } catch (_) {}
                    try { keepalive.currentTime = 0; } catch (_) {}
                    state.playing = false;
                    renderButton();
                }, 120);
            } catch (_) {
                // 用户仍可通过支架按钮手动授权。
            }
        }

        if (!state.doneAudioUnlocked) {
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
    }

    function renderButton() {
        const button = document.getElementById(BUTTON_ID);
        if (!button) return;
        button.classList.toggle('is-playing', !!state.playing);
        button.classList.toggle('needs-unlock', !!state.lastError && !state.playing);
        if (state.playing) {
            button.textContent = '支架·5m';
            button.title = '5分钟静音支架正在运行；AI正常回复完成后会播放一声提示音。点一下可提前停止支架。';
        } else if (state.lastError) {
            button.textContent = '点我授权';
            button.title = '浏览器拦截了自动播放。点一下完成媒体授权并启动5分钟支架。';
        } else {
            button.textContent = '支架';
            button.title = '点一下手动启动5分钟后台支架；AI正常回复完成后会播放一声提示音。';
        }
        button.setAttribute('aria-pressed', state.playing ? 'true' : 'false');
    }

    function ensureButton() {
        if (!document.body || document.getElementById(BUTTON_ID)) return;
        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = '支架';
        button.setAttribute('aria-label', '5分钟后台支架');
        button.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await unlockFromGesture();
            if (state.keepaliveWanted && state.playing) stopKeepAlive();
            else await startKeepAlive('manual');
        });
        document.body.appendChild(button);
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
        console.info(`[5分钟后台支架] ${BUILD} 已绑定 GENERATION_STARTED / GENERATION_ENDED / GENERATION_STOPPED。`);
        return true;
    }

    function boot() {
        ensureAudio();
        ensureDoneAudio();
        ensureButton();
        bindGenerationEvents();

        // 只重试事件总线初始化，不做持续扫描；最多约10秒后停止。
        let attempts = 0;
        const retry = () => {
            if (state.eventBound || attempts >= 40) return;
            attempts += 1;
            if (!bindGenerationEvents()) setTimeout(retry, 250);
        };
        retry();

        document.addEventListener('pointerdown', unlockFromGesture, { once: true, capture: true, passive: true });
        document.addEventListener('touchstart', unlockFromGesture, { once: true, capture: true, passive: true });

        globalThis.STKeepAlive5m = Object.freeze({
            start: () => startKeepAlive('api'),
            stop: () => stopKeepAlive(),
            testDoneSound: () => playDoneSound(),
            setDoneSoundEnabled: (enabled) => {
                state.doneSoundEnabled = !!enabled;
                return state.doneSoundEnabled;
            },
            status: () => ({
                build: state.build,
                unlocked: state.unlocked,
                doneAudioUnlocked: state.doneAudioUnlocked,
                playing: state.playing,
                reason: state.reason,
                lastError: state.lastError,
                doneSoundEnabled: state.doneSoundEnabled,
            }),
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
