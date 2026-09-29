# 原生通知桥接 v3.3.0

配套：

- iOS 原生壳 v1.4.0+
- SillyTavern Server Plugin `st-native-monitor` v1.0.0+

## v3.3.0 改动

最重要的变化是：**后台回复完成提醒不再以 `generation_ended` 为唯一依据。**

iOS 后台可能冻结 WKWebView JavaScript，因此旧版经常需要重新打开 App 后 `generation_ended` 才执行。v3.3 会在原生 App 环境下把以下文本生成请求透明转发给 Server Plugin：

- `/api/backends/chat-completions/generate`
- `/api/backends/text-completions/generate`
- `/api/backends/kobold/generate`
- `/api/novelai/generate`

Server Plugin 再转发到原始 SillyTavern 端点，浏览器收到的响应格式保持不变。原生 App 独立轮询服务端状态并发通知。

`generation_ended` 仍保留为 Server Plugin 不可用时的自动降级方案。

## 设置面板

仍使用 SillyTavern 标准折叠抽屉。展开后会显示：

- 系统通知权限
- 测试系统横幅
- 原生壳版本
- PiP 状态
- 服务端监听版本/状态

如果看到 `服务端监听：未连接（后台提醒仍可能延迟）`，请检查 Server Plugin 是否已安装并重启 SillyTavern。
