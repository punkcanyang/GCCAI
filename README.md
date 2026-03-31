# GCCAI - Multi AI Chat Manager

[English](#english) | [中文](#中文)

---

## English

### Overview

GCCAI is a Chrome extension that unifies your AI conversations from multiple platforms into a single interface. Manage your ChatGPT, Claude, Gemini, Grok, Perplexity, and Deepseek conversations all in one place.

### Features

- **Multi-Platform Support**: ChatGPT, Claude, Gemini, Grok, Perplexity, Deepseek
- **Unified Interface**: View all conversations in one list, sorted by last update time
- **Two View Modes**:
  - Side Panel: Quick access while browsing
  - Full Page: Dedicated management interface
- **Message Preview**: See conversation content without opening each chat
- **Full-Text Search**: Search across all conversation titles and content
- **Platform Filtering**: Filter conversations by platform
- **Real Timestamp**: Intercepts API requests to get actual last-update times
- **Cache Management**: Clear all cached data with one click
- **Offline Access**: All data stored locally in IndexedDB

### Installation

1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `extension/` folder

### Usage

1. **Open Side Panel**: Click the extension icon in the toolbar
2. **Open Full Page**: Right-click the extension icon → "Open Full Page Mode"
3. **View Conversations**: All your AI conversations appear automatically
4. **Search**: Use the search bar to find conversations
5. **Filter**: Click platform buttons to filter by platform
6. **Preview**: Click any conversation to see message preview
7. **Open Original**: Click ↗ to open conversation in original platform
8. **Clear Cache**: Click 🗑️ to clear all cached data

### Architecture

```
extension/
├── manifest.json           # Extension configuration
├── background.js           # Service worker (data management)
├── db.js                   # IndexedDB storage layer
├── content/                # Content scripts for each platform
│   ├── chatgpt.js
│   ├── claude.js
│   ├── gemini.js
│   ├── grok.js
│   ├── perplexity.js
│   └── deepseek.js
├── sidepanel/              # Side Panel UI
│   ├── index.html
│   ├── index.js
│   └── index.css
└── fullpage/               # Full Page UI
    ├── index.html
    ├── index.js
    └── index.css
```

### How It Works

1. **Content Scripts** inject into each AI platform website
2. **API Interception** captures conversation lists and timestamps from network requests
3. **DOM Scraping** extracts conversation titles and message content
4. **IndexedDB** stores all data locally in the browser
5. **Side Panel / Full Page** displays unified conversation list

### Privacy

- All data is stored locally in your browser
- No data is sent to any external server
- No account or login required for the extension itself

### License

MIT

---

## 中文

### 简介

GCCAI 是一个 Chrome 扩展，将多个 AI 平台的对话统一到一个界面中管理。支持 ChatGPT、Claude、Gemini、Grok、Perplexity 和 Deepseek。

### 功能

- **多平台支持**：ChatGPT、Claude、Gemini、Grok、Perplexity、Deepseek
- **统一对话列表**：所有平台的对话按最后更新时间排序
- **两种视图模式**：
  - Side Panel：浏览时快速访问
  - 全屏模式：专注的管理界面
- **消息预览**：无需打开每个对话即可预览内容
- **全文搜索**：搜索对话标题和消息内容
- **平台筛选**：按平台过滤对话
- **真实时间戳**：拦截 API 请求获取真正的最后更新时间
- **缓存管理**：一键清除所有缓存数据
- **离线访问**：所有数据存储在本地 IndexedDB

### 安装

1. 克隆此仓库
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启「开发者模式」（右上角）
4. 点击「加载已解压的扩展程序」
5. 选择 `extension/` 文件夹

### 使用方法

1. **打开 Side Panel**：点击工具栏中的扩展图标
2. **打开全屏模式**：右键点击扩展图标 → 「打开全视窗模式」
3. **查看对话**：所有 AI 对话自动显示
4. **搜索**：使用搜索栏查找对话
5. **筛选**：点击平台按钮按平台筛选
6. **预览**：点击任意对话查看消息预览
7. **打开原文**：点击 ↗ 在原平台打开对话
8. **清除缓存**：点击 🗑️ 清除所有缓存数据

### 架构

```
extension/
├── manifest.json           # 扩展配置
├── background.js           # 后台服务（数据管理）
├── db.js                   # IndexedDB 存储层
├── content/                # 各平台的内容脚本
│   ├── chatgpt.js
│   ├── claude.js
│   ├── gemini.js
│   ├── grok.js
│   ├── perplexity.js
│   └── deepseek.js
├── sidepanel/              # Side Panel 界面
│   ├── index.html
│   ├── index.js
│   └── index.css
└── fullpage/               # 全屏模式界面
    ├── index.html
    ├── index.js
    └── index.css
```

### 工作原理

1. **内容脚本**注入到各 AI 平台网站
2. **API 拦截**从网络请求中捕获对话列表和时间戳
3. **DOM 抓取**提取对话标题和消息内容
4. **IndexedDB**将所有数据存储在浏览器本地
5. **Side Panel / 全屏模式**显示统一对话列表

### 隐私

- 所有数据存储在您的浏览器本地
- 不会将任何数据发送到外部服务器
- 扩展本身无需账号或登录

### 许可证

MIT
