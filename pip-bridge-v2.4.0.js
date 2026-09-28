(() => {
    'use strict';

    const VERSION = '2.4.0';
    const BUILD = `st-keepalive-5m@${VERSION}`;
    const BASE_URL = import.meta.url;
    const PIP_VIDEO_URL = new URL(`./pip-loop.mp4?v=${VERSION}`, BASE_URL).href;
    const KEEPALIVE_AUDIO_URL = new URL(`./silent-5m.mp3?v=${VERSION}`, BASE_URL).href;
    const DONE_AUDIO_URL = new URL(`./reply-done.mp3?v=${VERSION}`, BASE_URL).href;
    const NOTIFICATION_SW_URL = new URL(`./notification-sw-v2.4.0.js?v=${VERSION}`, BASE_URL).href;
    const NOTIFICATION_SCOPE_URL = new URL('./', BASE_URL).href;

    const LEGACY_BUTTON_ID = 'st-keepalive-5m-button';
    const VIDEO_ID = 'st-keepalive-5m-video';
    const PANEL_ID = 'st-keepalive-5m-panel';
    const PANEL_BUTTON_ID = 'st-keepalive-5m-panel-button';
    const LEGACY_PREVIEW_ID = 'st-keepalive-5m-panel-preview';
    const DESKTOP_PREVIEW_ID = 'st-keepalive-5m-desktop-preview';
    const DONE_AUDIO_ID = 'st-keepalive-5m-done-audio';
    const ALERT_BUTTON_ID = 'st-keepalive-5m-alert-button';
    const TEST_ALERT_BUTTON_ID = 'st-keepalive-5m-test-alert-button';
    const STATUS_ID = 'st-keepalive-5m-status';
    const ALERT_STORAGE_KEY = 'st-keepalive-5m-completion-alert-v2';

    const DONE_SOUND_DELAY_MS = 350;
    const DONE_SOUND_VOLUME = 0.78;
    const KEEPALIVE_LIMIT_MS = 5 * 60 * 1000;

    // v2.4.0：Web App/PWA 不再硬编码禁用 PiP；实际能力以运行时 API 为准，同时保留提示音和系统横幅。
    // 如果页面里残留上一版实例，先尽力停掉并清理旧 DOM，而不是直接 return。
    try { globalThis.STKeepAlive5m?.stop?.(); } catch (_) {}
    for (const id of [LEGACY_BUTTON_ID, VIDEO_ID, PANEL_ID, LEGACY_PREVIEW_ID, DESKTOP_PREVIEW_ID, DONE_AUDIO_ID]) {
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
        completionAlertEnabled: true,
        notificationsEnabled: false,
        notificationPermission: ('Notification' in globalThis ? Notification.permission : 'unsupported'),
        swRegistration: null,
        doneSoundTimer: null,
        keepaliveTimer: null,
        generationSerial: 0,
        lastGenerationStoppedAt: 0,
        observer: null,
        manualPreviewVisible: false,
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

    function supportsPiP(video = state.video) {
        return supportsWebKitPiP(video) || supportsStandardPiP(video) || hasPiPAPI(video);
    }

    function detectMode() {
        const video = ensureVideo();
        // v2.4.0：不再因为 iPhone 主屏幕 Web App/standalone 模式而提前判死刑。
        // 某些 WebKit 版本的能力探针并不可靠，因此只要存在可调用的 PiP API 就允许用户实际尝试。
        if (supportsPiP(video)) {
            state.mode = 'pip-video';
        } else if (isIOS()) {
            // iPhone 上不回退静音音频，避免抢占用户真正的视频声音。
            state.mode = 'ios-no-pip';
        } else {
            // Firefox 等桌面浏览器没有 requestPictureInPicture()，但自身可能仍提供原生 PiP UI。
            state.mode = 'desktop-manual-pip';
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
        if (state.doneAudio?.isConnected) return state.doneAudio;
        let audio = document.getElementById(DONE_AUDIO_ID);
        if (!(audio instanceof HTMLAudioElement)) {
            audio = prepareMediaElement(document.createElement('audio'));
            audio.id = DONE_AUDIO_ID;
            audio.src = DONE_AUDIO_URL;
            audio.loop = false;
            audio.controls = false;
            audio.setAttribute('aria-hidden', 'true');
            audio.style.display = 'none';
            (document.body || document.documentElement).appendChild(audio);
        }
        audio.volume = DONE_SOUND_VOLUME;
        audio.addEventListener('error', () => console.warn('[PiP后台支架] 回复完成提示音加载失败。'), { once: true });
        try { audio.load(); } catch (_) {}
        state.doneAudio = audio;
        return audio;
    }

    function storageGet(key) {
        try { return localStorage.getItem(key); } catch (_) { return null; }
    }

    function storageSet(key, value) {
        try { localStorage.setItem(key, value); } catch (_) {}
    }

    function notificationAPIAvailable() {
        return 'Notification' in globalThis;
    }

    function notificationPermission() {
        try { return notificationAPIAvailable() ? Notification.permission : 'unsupported'; }
        catch (_) { return 'unsupported'; }
    }

    async function ensureNotificationServiceWorker() {
        if (!('serviceWorker' in navigator) || !globalThis.isSecureContext) return null;
        if (state.swRegistration) return state.swRegistration;
        try {
            state.swRegistration = await navigator.serviceWorker.register(NOTIFICATION_SW_URL, {
                scope: NOTIFICATION_SCOPE_URL,
                updateViaCache: 'none',
            });
            try { await state.swRegistration.update(); } catch (_) {}
            return state.swRegistration;
        } catch (error) {
            console.warn('[PiP后台支架] 通知 Service Worker 注册失败，将尝试桌面 Notification() 兜底。', error);
            return null;
        }
    }

    async function showSystemNotification(title = 'SillyTavern 回复完成', body = 'AI 回复已经完成，点这里返回聊天。') {
        state.notificationPermission = notificationPermission();
        if (!state.completionAlertEnabled || !state.notificationsEnabled || state.notificationPermission !== 'granted') return false;

        const options = {
            body,
            tag: 'sillytavern-reply-done',
            renotify: true,
            silent: false,
            data: { url: globalThis.location?.href || '/' },
        };

        const registration = await ensureNotificationServiceWorker();
        if (registration?.showNotification) {
            try {
                await registration.showNotification(title, options);
                return true;
            } catch (error) {
                console.warn('[PiP后台支架] Service Worker 系统通知失败。', error);
            }
        }

        // 桌面浏览器可以直接使用 Notification 构造器；移动端通常不允许，所以只作兜底。
        try {
            const notification = new Notification(title, options);
            notification.onclick = () => {
                try { globalThis.focus(); } catch (_) {}
                try { notification.close(); } catch (_) {}
            };
            return true;
        } catch (error) {
            console.warn('[PiP后台支架] 系统通知不可用。', error);
            return false;
        }
    }

    async function primeDoneAudioAudibly() {
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
            console.warn('[PiP后台支架] 提示音授权/测试失败。', error);
            return false;
        }
    }

    async function enableCompletionAlertsFromGesture() {
        state.completionAlertEnabled = true;
        storageSet(ALERT_STORAGE_KEY, '1');

        // 权限请求和有声播放都必须在这次真实点击的 transient user activation 还有效时立刻启动。
        // 因此先同步发起两个 Promise，再一起 await，不能先 await 音频后再请求通知。
        let permission = notificationPermission();
        let permissionPromise = Promise.resolve(permission);
        if (notificationAPIAvailable() && permission === 'default') {
            try { permissionPromise = Notification.requestPermission(); }
            catch (error) {
                console.warn('[PiP后台支架] 请求通知权限失败。', error);
                permissionPromise = Promise.resolve(notificationPermission());
            }
        }
        const soundPromise = primeDoneAudioAudibly();
        const [soundOk, resolvedPermission] = await Promise.all([soundPromise, permissionPromise]);
        permission = resolvedPermission || notificationPermission();
        state.notificationPermission = permission;
        state.notificationsEnabled = permission === 'granted';

        if (state.notificationsEnabled) {
            await ensureNotificationServiceWorker();
            const bannerOk = await showSystemNotification('SillyTavern 完成提醒已开启', '以后回复完成时会尝试显示系统横幅，并播放提示音。');
            if (bannerOk) toast(`回复完成提醒已开启：提示音${soundOk ? '✓' : '×'} + 系统横幅✓。`, 'success');
            else toast(soundOk ? '提示音已开启；通知权限已授予，但当前容器没能显示测试横幅。' : '通知权限已授予，但测试横幅和提示音都失败了。', 'warning');
        } else if (isIOS() && !isStandalone()) {
            toast(soundOk
                ? '提示音已开启；当前页面没有拿到系统横幅权限。若需要系统横幅，可在支持通知权限的 Web App/浏览器容器中开启。'
                : '当前无法启用提示音，系统横幅权限也不可用。', 'warning');
        } else if (permission === 'denied') {
            toast(soundOk ? '提示音已开启，但系统通知权限被拒绝。可在系统/浏览器通知设置中重新允许。' : '系统通知权限被拒绝，提示音也未能授权。', 'warning');
        } else {
            toast(soundOk ? '提示音已开启；当前浏览器/地址没有可用的系统通知 API。' : '当前环境无法启用系统通知或提示音。', 'warning');
        }
        renderAll();
        return soundOk || state.notificationsEnabled;
    }

    async function testCompletionAlertFromGesture() {
        if (!state.doneAudioUnlocked || (notificationAPIAvailable() && notificationPermission() === 'default')) {
            return enableCompletionAlertsFromGesture();
        }
        const sound = await playDoneSound();
        const banner = await showSystemNotification('SillyTavern 测试提醒', '如果你看到这条横幅，系统通知已经工作。');
        toast(`测试完成：声音${sound ? '✓' : '×'} / 横幅${banner ? '✓' : '×'}`, banner || sound ? 'success' : 'warning');
        return sound || banner;
    }

    function ensureDesktopPreview() {
        let preview = document.getElementById(DESKTOP_PREVIEW_ID);
        if (preview instanceof HTMLVideoElement) return preview;
        const host = document.querySelector(`#${PANEL_ID} .st-pip-preview-wrap`);
        if (!host) return null;
        preview = prepareMediaElement(document.createElement('video'));
        preview.id = DESKTOP_PREVIEW_ID;
        preview.src = PIP_VIDEO_URL;
        preview.loop = true;
        preview.muted = true;
        preview.defaultMuted = true;
        preview.controls = true;
        preview.disablePictureInPicture = false;
        preview.setAttribute('muted', '');
        preview.hidden = true;
        host.appendChild(preview);
        try { preview.load(); } catch (_) {}
        return preview;
    }

    async function showDesktopManualPiP() {
        const preview = ensureDesktopPreview();
        if (!preview) return false;
        preview.hidden = false;
        state.manualPreviewVisible = true;
        try { await preview.play(); } catch (_) {}
        toast('这个桌面浏览器没有可编程 PiP API。已显示视频预览：请点视频上的浏览器“画中画”图标；Firefox 也可在视频上右键选择画中画。', 'info');
        renderAll();
        return true;
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
        const preview = document.getElementById(DESKTOP_PREVIEW_ID);
        if (preview instanceof HTMLVideoElement) {
            try { preview.pause(); } catch (_) {}
            try { preview.currentTime = 0; } catch (_) {}
            preview.hidden = true;
        }
        state.manualPreviewVisible = false;
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

    async function enterPiPFromGesture(reason = 'manual') {
        const video = ensureVideo();
        detectMode();

        if (state.mode === 'ios-no-pip') {
            state.lastError = 'ios-pip-unsupported';
            renderAll();
            toast('当前容器没有检测到可调用的网页 PiP 接口。请确认系统画中画已开启，并尝试更新 iOS/WebKit。', 'warning');
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
            // Web App/PWA 也直接尝试。优先 WebKit presentationMode；如果能力探针说“不支持”
            // 但 setter 存在，仍允许实际调用一次，因为部分版本的探针结果可能比真实能力更保守。
            if (typeof video.webkitSetPresentationMode === 'function') {
                video.webkitSetPresentationMode('picture-in-picture');
            } else if (typeof video.requestPictureInPicture === 'function') {
                await video.requestPictureInPicture();
            } else if (!isIOS()) {
                state.mode = 'desktop-manual-pip';
                try { video.pause(); } catch (_) {}
                return showDesktopManualPiP();
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
            if (!isIOS()) {
                state.mode = 'desktop-manual-pip';
                state.lastError = '';
                return showDesktopManualPiP();
            }
            renderAll();
            toast(`进入 PiP 失败：${state.lastError}。当前为${isStandalone() ? ' Web App/独立模式' : '浏览器模式'}，可以再次点击重试。`, 'warning');
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
        if (state.mode === 'desktop-manual-pip') {
            const preview = ensureDesktopPreview();
            if (preview && !preview.hidden) {
                try { await preview.play(); return true; } catch (_) { return false; }
            }
            return false;
        }
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

    function scheduleDoneAlert() {
        cancelPendingDoneSound();
        if (Date.now() - state.lastGenerationStoppedAt < 1500) return;
        const serial = state.generationSerial;
        state.doneSoundTimer = setTimeout(() => {
            state.doneSoundTimer = null;
            if (serial !== state.generationSerial) return;
            Promise.allSettled([playDoneSound(), showSystemNotification()]).catch(() => {});
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
            // 仅做预加载；iOS 对“静音解锁后再有声播放”并不可靠。真正授权由“开启回复完成提醒”按钮完成。
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

        if (state.mode === 'pip-video' || state.mode === 'ios-no-pip') {
            await enterPiPFromGesture('manual');
            return;
        }

        if (state.mode === 'desktop-manual-pip') {
            const preview = ensureDesktopPreview();
            if (state.manualPreviewVisible && preview) {
                try { preview.pause(); } catch (_) {}
                preview.hidden = true;
                state.manualPreviewVisible = false;
                renderAll();
                return;
            }
            await showDesktopManualPiP();
            return;
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
                <button id="${ALERT_BUTTON_ID}" type="button" class="menu_button">开启回复完成提醒</button>
                <button id="${TEST_ALERT_BUTTON_ID}" type="button" class="menu_button st-pip-secondary">测试提醒</button>
                <div id="${STATUS_ID}" class="st-pip-status"></div>
                <div class="st-pip-preview-wrap"></div>
            </div>`;
        container.appendChild(panel);

        document.getElementById(PANEL_BUTTON_ID)?.addEventListener('click', handleControlClick);
        document.getElementById(ALERT_BUTTON_ID)?.addEventListener('click', enableCompletionAlertsFromGesture);
        document.getElementById(TEST_ALERT_BUTTON_ID)?.addEventListener('click', testCompletionAlertFromGesture);
        renderPanel();
        return panel;
    }

    function buttonText() {
        if (state.pipActive) return '关闭PiP视频';
        if (state.playing && state.mode === 'pip-video') return '进入PiP画中画';
        if (state.mode === 'desktop-manual-pip' && state.manualPreviewVisible) return '关闭桌面视频预览';
        if (state.lastError) return '重试PiP视频';
        return 'PiP视频开启';
    }

    function panelStatus() {
        if (state.mode === 'ios-no-pip') return '当前容器没有检测到可调用的网页 PiP 接口。Web App 模式不会被插件主动禁用；只要运行时提供接口就会直接尝试。';
        if (state.pipActive) return 'PiP 正在运行；循环视频最长约 5 分钟。再次点击可退出。';
        if (state.mode === 'desktop-manual-pip') return '此桌面浏览器没有可编程 PiP API；点击按钮会显示视频预览，再使用浏览器自带的画中画入口。';
        if (state.lastError) return `上次进入 PiP 失败：${state.lastError}。请再次点击“PiP视频开启”重试。Web App/PWA 与普通浏览器使用同一套 PiP 尝试逻辑。`;
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
        pButton.classList.toggle('is-warning', state.mode === 'ios-no-pip' || !!state.lastError);

        const alertButton = document.getElementById(ALERT_BUTTON_ID);
        const testButton = document.getElementById(TEST_ALERT_BUTTON_ID);
        const status = document.getElementById(STATUS_ID);
        state.notificationPermission = notificationPermission();
        if (alertButton) {
            const bannerReady = state.notificationsEnabled && state.notificationPermission === 'granted';
            alertButton.textContent = bannerReady && state.doneAudioUnlocked
                ? '回复提醒已开启（声音+横幅）'
                : (state.doneAudioUnlocked ? '回复提示音已开启' : '开启回复完成提醒');
        }
        if (testButton) testButton.textContent = '测试提醒';
        if (status) {
            const notificationText = state.notificationPermission === 'granted'
                ? '系统横幅：已授权'
                : state.notificationPermission === 'denied'
                    ? '系统横幅：已拒绝'
                    : state.notificationPermission === 'unsupported'
                        ? '系统横幅：当前容器不支持'
                        : '系统横幅：未授权';
            const soundText = state.doneAudioUnlocked ? '提示音：已授权' : '提示音：请点“开启回复完成提醒”';
            status.textContent = `${soundText} · ${notificationText}`;
        }
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
        source.on(generationEnded, scheduleDoneAlert);
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
        state.completionAlertEnabled = storageGet(ALERT_STORAGE_KEY) !== '0';
        state.notificationPermission = notificationPermission();
        state.notificationsEnabled = state.notificationPermission === 'granted';
        if (state.notificationsEnabled) ensureNotificationServiceWorker().catch(() => {});
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

        globalThis.STKeepAlive5m = Object.freeze({
            start: () => startKeepAlive('api'),
            stop: () => stopKeepAlive(),
            enterPiP: () => enterPiPFromGesture('api'),
            exitPiP: () => exitPiP(),
            testDoneSound: () => playDoneSound(),
            testCompletionAlert: () => Promise.allSettled([playDoneSound(), showSystemNotification()]),
            enableCompletionAlerts: () => enableCompletionAlertsFromGesture(),
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
                pwaPiPHardBlocked: false,
                webkitPiPSupported: supportsWebKitPiP(state.video),
                standardPiPSupported: supportsStandardPiP(state.video),
                pipActive: state.pipActive,
                playing: state.playing,
                reason: state.reason,
                lastError: state.lastError,
                doneSoundEnabled: state.doneSoundEnabled,
                doneAudioUnlocked: state.doneAudioUnlocked,
                completionAlertEnabled: state.completionAlertEnabled,
                notificationPermission: notificationPermission(),
                notificationsEnabled: state.notificationsEnabled,
                secureContext: !!globalThis.isSecureContext,
                serviceWorkerAvailable: 'serviceWorker' in navigator,
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
