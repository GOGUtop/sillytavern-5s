# 5分钟 PiP 后台支架 v2.4.0

这一版按实机结果调整：**iPhone Web App / PWA 不再被插件硬编码判定为“不支持 PiP”**。只要当前 WebKit/浏览器提供可调用的 PiP 接口，就直接尝试进入画中画。

## 目标组合

- Web App / PWA：PiP + 回复完成提示音 + 系统横幅（以设备实际 API/权限为准）
- iPhone Safari：PiP + 提示音；若当前容器允许通知权限，也会启用横幅
- 桌面浏览器：标准 PiP；没有可编程 PiP API 时显示原生视频预览，供浏览器自己的 PiP 入口使用

## 使用

1. 打开 SillyTavern → 扩展程序 → PiP 后台支架。
2. 点 **PiP视频开启**。
3. 点 **开启回复完成提醒**，这次点击会同时尝试授权提示音与系统通知。
4. 点 **测试提醒** 验证提示音和系统横幅。

## 视频替换

直接用你自己的视频覆盖 `pip-loop.mp4`。建议 H.264 MP4、无音轨、短循环。

## v2.4.0 关键变化

- 删除 `ios-standalone-no-pip` 硬拦截。
- Web App/PWA 和 Safari 使用同一套 PiP 实际调用逻辑。
- WebKit `webkitSetPresentationMode()` 存在时直接尝试，不再因为能力探针返回保守结果而提前拒绝。
- 保留回复完成提示音、Service Worker 系统横幅、桌面 PiP 兼容。
- 继续彻底禁用旧版右下角悬浮球。
