(() => {
    'use strict';

    const VERSION = '3.0.0';
    const BASE_URL = import.meta.url;
    const PIP_VIDEO_URL = new URL(`./pip-loop.mp4?v=${VERSION}`, BASE_URL).href;
    const DONE_AUDIO_URL = new URL(`./reply-done.mp3?v=${VERSION}`, BASE_URL).href;

    const PANEL_ID = 'st-native-pip-panel';
    const PIP_BUTTON_ID = 'st-native-pip-button';
    const NOTIFY_BUTTON_ID = 'st-native-notify-button';
    const TEST_BUTTON_ID = 'st-native-test-button';
    const STATUS_ID = 'st-native-pip-status';
    const VIDEO_ID = 'st-native-pip-hidden-video';

    const state = {
        native: false,
        nativeVersion: '',
        pipActive: false,
        notificationStatus: 'default',
        eventBound: false,
        booted: false,
        doneAudioUnlocked: false,
        doneAudio: null,
        webVideo: null,
        lastStoppedAt: 0,
        generationSerial: 0,
    };

    function context() {
        try {
            if (globalThis.SillyTavern?.getContext) return globalThis.SillyTavern.getContext();
            if (globalThis.SillyTavern?.context) return globalThis.SillyTavern.context;
            if (globalThis.getContext) return globalThis.getContext();
        } catch (_) {}
        return null;
    }

    function toast(message, type = 'info') {
        try {
            if (globalThis.toastr?.[type]) return globalThis.toastr[type](message, 'PiP 原生桥接支架');
        } catch (_) {}
        if (type === 'error' || type === 'warning') {
            try { alert(message); } catch (_) {}
        }
    }

    function bridgeHandler() {
        try { return globalThis.webkit?.messageHandlers?.stNative; } catch (_) { return null; }
    }

    function nativeAvailable() {
        const h = bridgeHandler();
        return !!h && typeof h.postMessage === 'function';
    }

    function nativePost(action, extra = {}) {
        const h = bridgeHandler();
        if (!h || typeof h.postMessage !== 'function') return false;
        try {
            h.postMessage({ action, ...extra });
            return true;
        } catch (error) {
            console.warn('[PiP原生桥] postMessage failed', error);
            return false;
        }
    }

    function ensureDoneAudio() {
        if (state.doneAudio) return state.doneAudio;
        const audio = new Audio(DONE_AUDIO_URL);
        audio.preload = 'auto';
        audio.volume = 0.8;
        state.doneAudio = audio;
        return audio;
    }

    async function playDoneSound() {
        const audio = ensureDoneAudio();
        try {
            audio.pause();
            audio.currentTime = 0;
            audio.muted = false;
            await audio.play();
            state.doneAudioUnlocked = true;
            return true;
        } catch (_) {
            return false;
        }
    }

    function ensureWebVideo() {
        if (state.webVideo?.isConnected) return state.webVideo;
        const video = document.createElement('video');
        video.id = VIDEO_ID;
        video.src = PIP_VIDEO_URL;
        video.loop = true;
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.disablePictureInPicture = false;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('muted', '');
        video.addEventListener('enterpictureinpicture', () => { state.pipActive = true; render(); });
        video.addEventListener('leavepictureinpicture', () => { state.pipActive = false; render(); });
        video.addEventListener('webkitpresentationmodechanged', () => {
            state.pipActive = video.webkitPresentationMode === 'picture-in-picture';
            render();
        });
        (document.body || document.documentElement).appendChild(video);
        state.webVideo = video;
        return video;
    }

    async function startWebPiP() {
        const video = ensureWebVideo();
        try {
            await video.play();
            if (typeof video.webkitSetPresentationMode === 'function' &&
                typeof video.webkitSupportsPresentationMode === 'function' &&
                video.webkitSupportsPresentationMode('picture-in-picture')) {
                video.webkitSetPresentationMode('picture-in-picture');
                return true;
            }
            if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
                await video.requestPictureInPicture();
                return true;
            }
            toast('当前浏览器没有可调用的网页 PiP。iPhone 主屏幕 Web App 请使用配套的原生壳。', 'warning');
            return false;
        } catch (error) {
            toast(`网页 PiP 启动失败：${error?.name || error?.message || 'unknown'}`, 'warning');
            return false;
        }
    }

    async function stopWebPiP() {
        try {
            if (document.pictureInPictureElement && document.exitPictureInPicture) {
                await document.exitPictureInPicture();
            } else if (state.webVideo?.webkitPresentationMode === 'picture-in-picture') {
                state.webVideo.webkitSetPresentationMode('inline');
            }
        } catch (_) {}
        try { state.webVideo?.pause(); } catch (_) {}
        state.pipActive = false;
        render();
    }

    async function handlePiPClick() {
        state.native = nativeAvailable();
        if (state.native) {
            nativePost(state.pipActive ? 'stopPiP' : 'startPiP', {
                videoURL: PIP_VIDEO_URL,
                maxDurationSeconds: 300,
            });
            return;
        }
        if (state.pipActive) await stopWebPiP();
        else await startWebPiP();
    }

    async function handleNotifyClick() {
        state.native = nativeAvailable();
        if (state.native) {
            nativePost('requestNotifications');
            return;
        }
        // Safari/桌面降级：先用真实用户点击解锁提示音。
        const ok = await playDoneSound();
        if (ok) toast('回复完成提示音已开启。普通 iPhone Safari 不提供配套原生系统横幅。', 'success');
        render();
    }

    function handleTestClick() {
        state.native = nativeAvailable();
        if (state.native) {
            nativePost('testNotification', {
                title: 'SillyTavern 测试提醒',
                body: '原生系统横幅和通知声音工作正常。',
            });
            return;
        }
        playDoneSound();
    }

    function ensurePanel() {
        const container = document.getElementById('extensions_settings');
        if (!container) return null;
        let panel = document.getElementById(PANEL_ID);
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = 'inline-drawer';
        panel.innerHTML = `
          <div class="inline-drawer-header"><b>PiP 原生桥接支架</b></div>
          <div class="st-native-pip-content">
            <button id="${PIP_BUTTON_ID}" type="button" class="menu_button">PiP视频开启</button>
            <button id="${NOTIFY_BUTTON_ID}" type="button" class="menu_button">开启系统通知</button>
            <button id="${TEST_BUTTON_ID}" type="button" class="menu_button">测试系统横幅</button>
            <div id="${STATUS_ID}" class="st-native-status"></div>
          </div>`;
        container.appendChild(panel);
        document.getElementById(PIP_BUTTON_ID)?.addEventListener('click', handlePiPClick);
        document.getElementById(NOTIFY_BUTTON_ID)?.addEventListener('click', handleNotifyClick);
        document.getElementById(TEST_BUTTON_ID)?.addEventListener('click', handleTestClick);
        render();
        return panel;
    }

    function render() {
        state.native = nativeAvailable();
        const pipButton = document.getElementById(PIP_BUTTON_ID);
        const notifyButton = document.getElementById(NOTIFY_BUTTON_ID);
        const status = document.getElementById(STATUS_ID);
        if (pipButton) pipButton.textContent = state.pipActive ? '关闭PiP视频' : 'PiP视频开启';
        if (notifyButton) {
            const granted = ['granted', 'provisional', 'ephemeral'].includes(state.notificationStatus);
            notifyButton.textContent = granted ? '系统通知已开启' : '开启系统通知';
        }
        if (status) {
            if (state.native) {
                const notify = ['granted', 'provisional', 'ephemeral'].includes(state.notificationStatus)
                    ? '横幅：已授权'
                    : `横幅：${state.notificationStatus === 'denied' ? '被拒绝，请去系统设置开启' : '未授权'}`;
                status.textContent = `原生壳：已连接${state.nativeVersion ? ` v${state.nativeVersion}` : ''} · PiP：原生 AVKit · ${notify}`;
                status.className = 'st-native-status st-native-ok';
            } else {
                status.textContent = `原生壳：未连接 · PiP：浏览器降级 · 回复完成：提示音降级`;
                status.className = 'st-native-status st-native-warning';
            }
        }
    }

    function sendCompletionAlert() {
        if (Date.now() - state.lastStoppedAt < 1500) return;
        const serial = state.generationSerial;
        setTimeout(() => {
            if (serial !== state.generationSerial) return;
            state.native = nativeAvailable();
            if (state.native) {
                nativePost('notifyDone', {
                    title: 'SillyTavern 回复完成',
                    body: '当前回复已经生成完毕。',
                });
            } else {
                playDoneSound();
            }
        }, 350);
    }

    function bindGenerationEvents() {
        if (state.eventBound) return true;
        const c = context();
        const source = c?.eventSource;
        const types = c?.event_types || c?.eventTypes || globalThis.event_types || {};
        if (!source?.on) return false;

        const started = types.GENERATION_STARTED || 'generation_started';
        const ended = types.GENERATION_ENDED || 'generation_ended';
        const stopped = types.GENERATION_STOPPED || 'generation_stopped';

        source.on(started, () => {
            state.generationSerial += 1;
            state.lastStoppedAt = 0;
        });
        source.on(ended, sendCompletionAlert);
        source.on(stopped, () => {
            state.generationSerial += 1;
            state.lastStoppedAt = Date.now();
        });
        state.eventBound = true;
        return true;
    }

    function bindNativeEvents() {
        globalThis.addEventListener('st-native-ready', (event) => {
            state.native = true;
            state.nativeVersion = String(event?.detail?.bridgeVersion || '');
            nativePost('notificationStatus');
            render();
        });
        globalThis.addEventListener('st-native-pip-state', (event) => {
            state.pipActive = !!event?.detail?.active;
            const error = event?.detail?.error;
            if (error) toast(`原生 PiP：${error}`, 'warning');
            render();
        });
        globalThis.addEventListener('st-native-notification-state', (event) => {
            state.notificationStatus = String(event?.detail?.status || (event?.detail?.granted ? 'granted' : 'default'));
            if (event?.detail?.granted) toast('系统横幅通知已开启。', 'success');
            else if (state.notificationStatus === 'denied') toast('系统通知被拒绝，请到 iPhone 设置 → 通知 中为本 App 开启。', 'warning');
            render();
        });
        globalThis.addEventListener('st-native-notification-result', (event) => {
            if (event?.detail?.ok === false && event?.detail?.status === 'notification-permission-not-granted') {
                toast('系统横幅尚未授权，请先点“开启系统通知”。', 'warning');
            }
        });
    }

    function boot() {
        if (state.booted) return;
        state.booted = true;
        bindNativeEvents();
        ensureDoneAudio();
        ensurePanel();
        bindGenerationEvents();
        state.native = nativeAvailable();
        if (state.native) {
            nativePost('ping');
            nativePost('notificationStatus');
        }

        let attempts = 0;
        const repair = () => {
            ensurePanel();
            if (!state.eventBound && attempts < 80) {
                attempts += 1;
                bindGenerationEvents();
                setTimeout(repair, 250);
            }
        };
        repair();

        const observer = new MutationObserver(() => {
            if (!document.getElementById(PANEL_ID)) ensurePanel();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        globalThis.STNativePiPBridge = Object.freeze({
            version: VERSION,
            status: () => ({ ...state, doneAudio: undefined, webVideo: undefined }),
            startPiP: handlePiPClick,
            requestNotifications: handleNotifyClick,
            testNotification: handleTestClick,
        });
        render();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})();
