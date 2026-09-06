# SillyTavern 5分钟后台支架

一个独立的 SillyTavern 前端扩展。生成开始时尝试播放一段约 5 分钟的静音音频，尽量降低手机浏览器切到后台后页面被快速冻结的概率。

## 功能

- 监听 SillyTavern 原生 `GENERATION_STARTED` 事件。
- 每次开始生成时，从头播放 `silent-5m.mp3`。
- 右下角提供“支架”按钮，可手动启动或提前停止。
- 首次触摸页面时尝试完成一次媒体播放授权，兼容 iOS autoplay 限制。
- 不劫持 `window.fetch`。
- 不代理或中转 API 请求。
- 不扫描聊天 DOM，不修改回复正文或聊天数据。
- 不依赖 Server Plugin。

## GitHub 安装 / 订阅

1. 把本仓库文件上传到 GitHub，确保 `manifest.json` 位于**仓库根目录**。
2. 打开 SillyTavern。
3. 进入 **Extensions（扩展） → Install Extension（安装扩展）**。
4. 粘贴你的 GitHub 仓库地址，例如：

   ```text
   https://github.com/你的用户名/st-keepalive-5m
   ```

5. 安装完成后刷新 SillyTavern 页面。

`manifest.json` 已设置：

```json
"auto_update": true
```

因此从 Git 仓库安装后，可使用 SillyTavern 的扩展更新功能拉取后续提交。

## 更新版本

发布新版本时建议同时：

1. 修改 `manifest.json` 中的 `version`。
2. 修改 `index.js` 顶部的 `VERSION`。
3. 提交并 push 到同一个 GitHub 仓库。

用户在 SillyTavern 中检查/执行扩展更新即可获取新版本。

## 文件结构

```text
st-keepalive-5m/
├── manifest.json
├── index.js
├── style.css
├── silent-5m.mp3
└── README.md
```

## 注意

Safari / iOS WKWebView 的普通网页没有原生 App 的 `UIBackgroundModes` 权限。静音媒体只能尽量延缓 WebKit 冻结，不能保证后台持续执行；iOS 内存回收、强制结束应用或浏览器策略仍可能中止页面。
