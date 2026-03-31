# GCCAI TODO List

## 已知问题

### 1. 平台兼容性问题
- [ ] **Grok 平台**: selector 不稳定，需要更健壮的选择器策略
- [ ] **Gemini 平台**: `batchexecute` 响应解析逻辑可能不稳定
- [ ] **Claude 平台**: 消息提取的 fallback 策略（Approach 2）可能产生误判

### 2. 错误处理
- [ ] content scripts 中的 `try-catch` 块静默失败，缺少错误上报机制
- [ ] API 拦截失败时无重试逻辑
- [ ] 数据库事务失败时的用户反馈不够明确

### 3. 性能优化
- [ ] 全文搜索 `searchMessages` 一次性加载所有消息，大数据量时性能差
- [ ] 预览加载 `loadPreviews` 串行请求各平台，应改为并行
- [ ] 消息内容限制 500 字符，可能导致重要信息丢失

### 4. 数据一致性
- [ ] 删除对话时，关联消息的删除逻辑在 `handleDeleteConversations` 中存在异步问题
- [ ] `syncConversationsWithDeletion` 的 `isSubstantialList` 阈值（5）可能不合理
- [ ] 时间戳处理逻辑在各平台不统一

### 5. UI/UX 问题
- [ ] 全屏模式（fullpage）的 UI 实现待完善
- [ ] 文件夹功能的拖拽排序未实现
- [ ] 搜索结果高亮可能导致 XSS 风险（需验证 `escapeHtml` 是否足够）

### 6. 功能缺失
- [ ] 缺少对话导出功能
- [ ] 缺少对话标签/收藏功能
- [ ] 缺少跨平台对话合并/关联功能
- [ ] 缺少数据备份/恢复功能

### 7. 测试与质量
- [ ] 无单元测试覆盖
- [ ] 无集成测试
- [ ] 缺少 CI/CD 流程

### 8. 文档
- [ ] 缺少开发文档
- [ ] 缺少贡献指南
- [ ] 缺少故障排除指南

## 待探索

- [ ] 支持更多 AI 平台（Copilot、Mistral、Llama 等）
- [ ] 支持对话加密存储
- [ ] 支持多设备同步（通过 Chrome Sync 或自建服务）
- [ ] 支持对话统计分析功能
