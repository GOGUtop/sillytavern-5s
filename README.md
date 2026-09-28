# PiP 原生桥接支架 v3.0.0

这一版与 **SillyTavernNativePiP iOS 原生壳** 配套使用。

## 功能

- 在原生壳内，“PiP视频开启”通过 `WKScriptMessageHandler` 调用 Swift。
- Swift 使用 `AVPictureInPictureController + AVPlayerLayer` 启动真正的 iOS 系统 PiP，不依赖主屏幕 Web App 的网页 PiP。
- 回复生成完毕时，插件把事件发给原生壳；原生壳用 `UNUserNotificationCenter` 显示系统横幅并播放系统通知声音。
- 在普通 Safari / 桌面浏览器打开时，仍会尝试网页 PiP，回复完成则回退到 `reply-done.mp3` 提示音。

## 安装

把整个 `SillyTavernExtension-v3.0.0` 文件夹安装为 SillyTavern 前端扩展。建议删除旧的 v2.x PiP 支架，避免重复监听回复完成事件。

## 自定义 PiP 视频

直接覆盖本目录的 `pip-loop.mp4`。原生壳启动 PiP 时会收到这个文件的实际 URL，因此以后换视频不需要重新编译 iOS App。

推荐 H.264 MP4、无音轨、360p~720p、短循环。
