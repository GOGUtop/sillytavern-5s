# SillyTavern 5分钟 PiP 后台支架

这是原“5分钟后台支架”的 PiP 版本，主要面向 iPhone / Safari / iOS WebKit。

## v2.0.1：iPhone 看不到按钮的修复

部分 iPhone / Safari / SillyTavern 布局会出现“页面布局宽度大于手机实际可视宽度”的情况。上一版按钮使用 `right` 固定定位时，可能实际上被摆到了手机屏幕右侧之外。

v2.0.1 会读取 `visualViewport` 并识别触屏/iOS：

- 桌面：仍放在右下角。
- iPhone / 窄可视区：强制放到**左下角可视区域**。
- 手机按钮提高到 42px，增加触摸面积。
- 提高 z-index，并强制 `display / visibility / opacity`，避免被主题样式藏掉。
- 旋转屏幕、Safari 地址栏变化、可视区变化时会重新判断。

如果你在手机上仍然完全看不到按钮，可以在控制台执行 `STKeepAlive5m.status()`，其中会显示 `mobileSafeLayout`、`visualViewportWidth` 和 `innerWidth`，方便继续定位。

## 为什么改成 PiP

旧版用 `silent-5m.mp3` 持续播放静音音频来尽量延缓页面后台冻结。iPhone 上这会占用媒体播放会话，容易和你正在看的视频/听的音频互相抢占。

v2.0.1 优先改用一个**没有音轨的循环视频**：

- 右下角点 **PiP支架**，把 `pip-loop.mp4` 放进系统画中画。
- PiP 视频循环播放，最长约 5 分钟；每次新的 AI 生成会重新计算这 5 分钟。
- AI 开始生成时会自动确保循环视频在播放；如果还没进 PiP，按钮会显示 **开PiP**。
- iOS 要求进入 PiP 通常由一次真实用户点击触发，所以扩展不会在生成开始时强行自动弹 PiP。
- 浏览器完全不支持 PiP 时，才会回退到旧的 `silent-5m.mp3` 音频支架。
- AI 正常回复完成后仍可播放 `reply-done.mp3` 提示音；手动停止生成不响。

## 换成你自己的 PiP 视频

直接把扩展目录中的：

```text
pip-loop.mp4
```

替换成你自己的同名视频即可。

为了 iPhone 兼容和省电，建议：

- MP4 容器
- H.264 / AVC 视频编码
- `yuv420p`
- **不要音轨**（最重要，避免重新抢占音频）
- 360p～720p 足够
- 3～15 秒短片，扩展会自动 `loop`
- 文件尽量小，避免每次加载浪费流量和内存

如果替换后 Safari 仍显示旧视频，刷新缓存，或者把 `manifest.json` / `index.js` 里的版本号再加一位。

## 使用方式（iPhone）

1. 打开 SillyTavern 页面后，点一次右下角 **PiP支架**。
2. 系统出现画中画小窗后，再切到别的 App 或去看别的视频。
3. AI 新一轮生成开始时，扩展会继续维持/重置支架时长。
4. 点插件按钮或直接关掉系统 PiP 小窗，即可停止支架。

如果系统层面禁用了画中画，网页无法绕过这个设置。

## 文件结构

```text
manifest.json
index.js
style.css
pip-loop.mp4       # PiP 循环视频，可自行替换
silent-5m.mp3      # 仅作为无 PiP 浏览器的兜底
reply-done.mp3     # 回复完成提示音
README.md
.gitignore
```

## 控制台 API

查看状态：

```js
STKeepAlive5m.status()
```

手动启动播放（不会绕过 iOS 的 PiP 点击限制）：

```js
STKeepAlive5m.start()
```

尝试进入 PiP（最好从用户点击事件中调用）：

```js
STKeepAlive5m.enterPiP()
```

停止：

```js
STKeepAlive5m.stop()
```

测试完成提示音：

```js
STKeepAlive5m.testDoneSound()
```

临时关闭 / 开启完成提示音：

```js
STKeepAlive5m.setDoneSoundEnabled(false)
STKeepAlive5m.setDoneSoundEnabled(true)
```

## iOS 限制

PiP 比“静音音频保活”更适合你这个一边等待 SillyTavern、一边使用其他 App 的场景，但它仍然受 iOS/WebKit 系统策略控制。系统可能因为省电、内存压力、媒体会话切换或用户关闭 PiP 而暂停/冻结页面，网页扩展无法保证永久后台运行。
