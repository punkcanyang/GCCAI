# GCCAI 工作日报

## 2026-03-31
- 修复了 DeepSeek (`deepseek.js`) 抓取组件：
  - 更新提取对话 URL 的正则为 `[a-zA-Z0-9-_]+` 修复全英文及新路径格式。
  - 应用了规避混淆类名的数据结构解构技术，精准定位 `ds-markdown` 提取 AI 回答，提取 User 回答由之前的 `isUser` 启发式提取改变为了基于 `dir="auto"` 的辅助回退定位。
  - 为防止异常退出引起 DOM 断联，对 `syncConversations` 和 `syncCurrentMessages` 添加了 `try...catch` 块。
  - 并在文件末补充了符合 AI 架构规范的 `[For Future AI]` 注释。
- 修复了 Perplexity (`perplexity.js`) 抓取组件：
  - 更新包含短横线和全英文字符兼容的会话 Slug 正则。
  - 重排其消息捕获策略，依赖是否存在 `prose` 等标记寻找回复正文，由 Tailwind 特有类名辅助侦测提问内容。
  - 增加了全方位的异常拦截。
  - 并在文件末补充了 `[For Future AI]` 注释。
- 完善所有其他平台 Content Scripts（`chatgpt.js`, `claude.js`, `gemini.js`, `grok.js`）的异常处理：
  - 在监听 API 拦截的空 `catch` 中补全了 `console.error` 的异常抛出输出信息。
- 优化了 Extension 侧边栏（`sidepanel/index.js`）的预览信息加载策略：
  - 弃用传统的遍历串行 `await` 获取方法，采用 `Promise.allSettled()` 同步发送并等待全部数据结构返回，大大缩短首页白屏和等待时间。
- 清理持久层的数据库一致性危机：
  - 移除了 `db.js` 的 `syncConversationsWithDeletion` 中的事件循环死锁风险等待（避免 Transaction 判定失效被取消）。
  - 修补 `background.js` 中使用 Cursor 迭代删除旧数据的方式，直接抽取所需所有的主键并在同个方法闭包内抹除。
