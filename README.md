# 5分钟 PiP 后台支架 v2.3.0

这一版重点修复三个问题：回复完成提示音、桌面端 PiP 兼容、系统横幅通知。

## 使用

打开 SillyTavern → **扩展程序 → PiP 后台支架**。

1. 点 **PiP视频开启**：Safari / Chrome / Edge 等支持网页 PiP API 的浏览器会直接进入画中画。
2. 点 **开启回复完成提醒**：会先播放一次约 1 秒的测试提示音，并在浏览器允许时申请系统通知权限。
3. 点 **测试提醒**：随时测试提示音和系统横幅。

以后 AI 正常回复完成时，插件会尝试同时播放提示音和显示系统横幅；手动停止生成不会触发完成提醒。

## 桌面端

Chrome / Edge / macOS Safari 等支持标准或 WebKit PiP API 时，按钮会直接进入 PiP。

Firefox 等没有可编程 `requestPictureInPicture()` 的桌面浏览器，会在扩展面板里显示一个循环视频预览。此时可使用浏览器自己的视频画中画按钮；Firefox 也可以在视频上右键选择画中画。

## iPhone / iPad

- **直接用 Safari 打开**：PiP 可以工作；回复完成提示音会尽量播放。
- **添加到主屏幕 / Web App**：iOS 可提供系统通知权限，但 WebKit 当前可能限制这个容器里的 PiP。
- iPhone 普通 Safari 页面本身不能像主屏幕 Web App 一样申请 Web Push / 系统通知权限，所以“Safari PiP + iOS 系统横幅”无法只靠前端插件同时保证。

## 关于“系统横幅”

此版本实现的是浏览器/系统 Notifications API 的本地系统通知：只要页面代码仍在运行，回复完成后就能触发横幅。它不是带服务器 VAPID 的完整 Web Push，因此如果网页已经被系统彻底挂起或关闭，前端插件无法单独把它唤醒。

在移动浏览器上会优先使用 Service Worker 的 `showNotification()`；桌面端在 Service Worker 不可用时会回退到 `Notification()`。

## 自定义循环视频

直接用自己的视频覆盖插件目录中的 `pip-loop.mp4`。建议 MP4/H.264、无音轨、小分辨率短循环视频。
