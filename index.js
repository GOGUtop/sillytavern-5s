(() => {
    'use strict';

    const VERSION = '1.0.1';
    const BUILD = `st-keepalive-5m@${VERSION}`;
    // SillyTavern loads third-party extension entry files as ES modules.
    // Resolve the bundled MP3 relative to this file so GitHub repo/folder renames do not break it.
    const AUDIO_URL = new URL(`./silent-5m.mp3?v=${VERSION}`, import.meta.url).href;
    const BUTTON_ID = 'st-keepalive-5m-button';

    if (globalThis.__ST_KEEPALIVE_5M__) return;

    const state = {
        build: BUILD,
        audio: null,
        unlocked: false,
        keepaliveWanted: false,
        playing: false,
        reason: '',
        lastError: '',
        eventBound: false,
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

    function ensureAudio() {
        if (state.audio) return state.audio;
        const audio = new Audio(AUDIO_URL);
        audio.preload = 'auto';
        audio.loop = false; // 文件本身约5分钟，不做永久循环。
        audio.controls = false;
        audio.playsInline = true;
        audio.setAttribute('playsinline', '');
        audio.setAttribute('webkit-playsinline', '');
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
            state.lastError = 'audio-error';
            state.playing = false;
            renderButton();
        });
        state.audio = audio;
        return audio;
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

    // iOS Safari / WKWebView 对媒体播放有用户手势限制。
    // 第一次触摸页面时，只做一次极短的“媒体解锁”，不做 DOM 扫描、不做轮询。
    async function unlockFromGesture() {
        if (state.unlocked || state.keepaliveWanted) return;
        const audio = ensureAudio();
        try {
            audio.currentTime = 0;
            await audio.play();
            state.unlocked = true;
            setTimeout(() => {
                if (state.keepaliveWanted) return;
                try { audio.pause(); } catch (_) {}
                try { audio.currentTime = 0; } catch (_) {}
                state.playing = false;
                renderButton();
            }, 120);
        } catch (_) {
            // 不弹错误；用户仍可通过支架按钮手动授权。
        }
    }

    function renderButton() {
        const button = document.getElementById(BUTTON_ID);
        if (!button) return;
        button.classList.toggle('is-playing', !!state.playing);
        button.classList.toggle('needs-unlock', !!state.lastError && !state.playing);
        if (state.playing) {
            button.textContent = '支架·5m';
            button.title = '5分钟静音支架正在运行。点一下可提前停止。';
        } else if (state.lastError) {
            button.textContent = '点我授权';
            button.title = '浏览器拦截了自动播放。点一下完成媒体授权并启动5分钟支架。';
        } else {
            button.textContent = '支架';
            button.title = '点一下手动启动5分钟后台支架。SillyTavern原生生成开始时也会自动尝试启动。';
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
            if (state.playing) stopKeepAlive();
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

        // 不接管生成、不改请求。只旁听 SillyTavern 原生“生成开始”事件。
        const generationStarted = types.GENERATION_STARTED || 'GENERATION_STARTED';
        source.on(generationStarted, () => {
            startKeepAlive('generation').catch(() => {});
        });

        state.eventBound = true;
        console.info(`[5分钟后台支架] ${BUILD} 已绑定 GENERATION_STARTED；无 fetch 劫持、无 DOM 轮询。`);
        return true;
    }

    function boot() {
        ensureAudio();
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

        // 对 VVV 或其他扩展开放一个可选接口；不要求任何扩展接入。
        globalThis.STKeepAlive5m = Object.freeze({
            start: () => startKeepAlive('api'),
            stop: () => stopKeepAlive(),
            status: () => ({
                build: state.build,
                unlocked: state.unlocked,
                playing: state.playing,
                reason: state.reason,
                lastError: state.lastError,
            }),
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
