# SillyTavern 原生通知桥接 v3.2.0

配套 iOS App v1.3.0 使用。

## 变化

- **原生 App 中不再显示 PiP 开关按钮。**
- PiP 由 iOS App 自己在启动时常驻管理，并自动恢复/重新待命。
- 本扩展继续负责回复生成事件、后台保活和原生系统通知桥接。
- 在 Safari/桌面等没有原生桥的环境里，仍保留网页 PiP 降级能力。

安装后，原生 App 环境的状态应显示：

`PiP：原生App常驻/自动恢复`

## 后续架构

后续可以把回复完成检测迁移到 SillyTavern Server Plugin。这样 iOS App 的 PiP 完全原生，回复完成通知也由服务器触发，不再依赖 WKWebView 的前端事件。
