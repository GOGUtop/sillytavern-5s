# SillyTavern 5分钟 PiP 后台支架 v2.1.0

这一版专门处理 iPhone 上“按钮完全看不到”的情况。

## v2.1.0 改了什么

1. **强制绕过 iPhone Safari 旧缓存**：manifest 不再加载固定的 `index.js` / `style.css`，而是加载唯一文件名 `pip-bridge-v2.1.0.js` / `.css`。
2. **关键按钮样式由 JS 直接写入 inline `!important`**：不再依赖 CSS 是否被缓存。
3. **按 `visualViewport` 计算按钮坐标**：手机上直接把按钮放在当前肉眼可见视口左下附近。
4. **DOM 自动修复**：如果 SillyTavern 的界面重绘把按钮移除，MutationObserver 会重新插回。
5. **增加第二入口**：打开 SillyTavern 的“扩展程序”面板，会出现 `PiP 后台支架` 抽屉和一个大按钮。即使浮动按钮被主题/布局影响，也能从这里启动。
6. **iPhone 主屏幕/PWA 检测**：如果是“添加到主屏幕”的独立 Web App，并且 WebKit probe 明确不允许 PiP，不会再退回静音音频，而会提示改用 Safari。
7. **保留 `pip-loop.mp4` 可替换**：直接覆盖同名文件即可。建议 H.264 / MP4 / 360p~720p / 无音轨 / 几秒到几十秒循环。

## iPhone 特别说明

截至 2026 年，WebKit 仍有一个已公开的问题：iOS/iPadOS 的 Home Screen Web App（PWA/standalone）里，`document.pictureInPictureEnabled` 可能显示为可用，但实际 `requestPictureInPicture()` 会失败；同一页面用 Safari 直接打开则可以正常 PiP。

因此如果你从 iPhone 主屏幕图标打开 SillyTavern，看到 `Safari PiP`，请：

- 复制/打开同一个 SillyTavern 地址到 Safari；
- 在 Safari 页面里点插件的 `PiP支架` / `启动 PiP`；
- PiP 开启后再切换到其他 App。

## 入口

- 浮动按钮：手机可视区域左下附近。
- 备用入口：顶部“扩展程序” → `PiP 后台支架`。

## 调试

Safari Web Inspector 控制台可运行：

```js
STKeepAlive5m.status()
```

强制重建 UI：

```js
STKeepAlive5m.repairUI()
```
