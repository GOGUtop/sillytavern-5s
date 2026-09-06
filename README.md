# SillyTavern 5分钟后台支架

一个独立的 SillyTavern 前端扩展，主要给 iPhone / 手机浏览器使用。

## 功能

- SillyTavern 开始生成时播放约 5 分钟的静音媒体，尽量延缓移动端后台冻结。
- AI **正常回复完成**后自动播放一声短促提示音。
- 如果用户手动点“停止生成”，不会播放“完成”提示音。
- 自动续写/紧接着开始下一次生成时，会取消上一段的待播放提示音，减少中途误响。
- 右下角“支架”按钮可手动启动或提前停止 5 分钟静音支架。
- 首次触摸页面时尝试解锁 iOS 的媒体播放权限。
- 不劫持 `fetch`，不扫描聊天 DOM，不修改消息正文和聊天数据。

## GitHub 安装 / 订阅

把这些文件直接放在 GitHub 仓库根目录：

```text
manifest.json
index.js
style.css
silent-5m.mp3
reply-done.mp3
README.md
.gitignore
```

然后在 SillyTavern：

**Extensions → Install Extension → 粘贴 GitHub 仓库地址 → Install**

例如：

```text
https://github.com/你的用户名/st-keepalive-5m
```

`manifest.json` 已设置 `auto_update: true`，从 Git 仓库安装后可以继续通过 SillyTavern 更新。

## v1.1.0

新增 `reply-done.mp3` 完成提示音，并监听 SillyTavern 的 `GENERATION_ENDED` 事件。生成开始使用 `GENERATION_STARTED`，手动停止使用 `GENERATION_STOPPED`。

完成提示音默认开启。需要临时测试时可在浏览器控制台运行：

```js
STKeepAlive5m.testDoneSound()
```

临时关闭/开启完成提示音：

```js
STKeepAlive5m.setDoneSoundEnabled(false)
STKeepAlive5m.setDoneSoundEnabled(true)
```

## 关于提示音

网上筛选时参考了 CC0 / Public Domain 的移动通知音资源风格。为了避免把来源不清或后续失效的外部二进制文件直接塞进公开 GitHub 仓库，本包中的 `reply-done.mp3` 是重新生成的短双音提示音，不依赖外链，也没有第三方音频版权依赖。

## iOS 说明

Safari / iOS WebKit 对自动播放和后台执行有系统级限制。本扩展只能尽量维持媒体活动，不能保证页面永远不被冻结。首次使用建议先在 SillyTavern 页面点一下“支架”按钮，确保静音支架和完成提示音都获得媒体播放授权。
