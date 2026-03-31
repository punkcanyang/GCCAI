// Side panel logic
(function() {
  'use strict';

  const platformNames = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    gemini: 'Gemini',
    grok: 'Grok',
    perplexity: 'Perplexity',
    deepseek: 'Deepseek'
  };

  const conversationListEl = document.getElementById('conversation-list');
  const previewPanelEl = document.getElementById('preview-panel');
  const previewTitleEl = document.getElementById('preview-title');
  const previewMessagesEl = document.getElementById('preview-messages');
  const backBtnEl = document.getElementById('back-btn');
  const openLinkBtnEl = document.getElementById('open-link-btn');
  const openFullpageBtnEl = document.getElementById('open-fullpage');
  const searchEl = document.getElementById('search');
  const searchBtnEl = document.getElementById('search-btn');
  const searchTitlesBtnEl = document.getElementById('search-titles');
  const searchContentBtnEl = document.getElementById('search-content');
  const searchResultsEl = document.getElementById('search-results');
  const searchResultsListEl = document.getElementById('search-results-list');
  const closeSearchBtnEl = document.getElementById('close-search');
  const clearCacheBtnEl = document.getElementById('clear-cache-btn');

  let allConversations = [];
  let conversationPreviews = {};
  let selectedConversation = null;
  let searchMode = 'titles';

  // Load conversations from storage
  async function loadConversations() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_CONVERSATIONS' });
      // Convert grouped object to flat array and sort by lastSynced
      const grouped = response || {};
      allConversations = [];
      
      const platforms = ['chatgpt', 'claude', 'gemini', 'grok', 'perplexity', 'deepseek'];
      platforms.forEach(platform => {
        (grouped[platform] || []).forEach(conv => {
          allConversations.push(conv);
        });
      });
      
      // Sort all conversations by platform last change time descending
      allConversations.sort(
        (a, b) => ((b.lastUpdated ?? b.lastSynced ?? 0) - (a.lastUpdated ?? a.lastSynced ?? 0))
      );
      
      await loadPreviews();
      renderConversationList();
    } catch (e) {
      console.error('Failed to load conversations:', e);
    }
  }

  // Load previews for all platforms
  async function loadPreviews() {
    const platforms = ['chatgpt', 'claude', 'gemini', 'grok', 'perplexity', 'deepseek'];
    for (const platform of platforms) {
      try {
        const previews = await chrome.runtime.sendMessage({
          type: 'GET_CONVERSATION_PREVIEWS',
          platform
        });
        conversationPreviews[platform] = previews || {};
      } catch (e) {
        console.error(`Failed to load previews for ${platform}:`, e);
      }
    }
  }

  // Load messages for a conversation
  async function loadMessages(platform, conversationId) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_MESSAGES',
        platform,
        conversationId
      });
      return response || [];
    } catch (e) {
      console.error('Failed to load messages:', e);
      return [];
    }
  }

  // Render conversation list - unified by time, not grouped by platform
  function renderConversationList(filter = '') {
    conversationListEl.innerHTML = '';

    const filtered = filter
      ? allConversations.filter(c =>
          c.title.toLowerCase().includes(filter.toLowerCase())
        )
      : allConversations;

    if (filtered.length === 0) {
      conversationListEl.innerHTML = `
        <div class="empty-state">
          <p>还没有对话</p>
          <small>打开 AI 网站后，对话会自动同步到这里</small>
        </div>
      `;
      return;
    }

    filtered.forEach(conv => {
      const preview = conversationPreviews[conv.platform]?.[conv.id];
      const previewText = preview?.assistantPreview || preview?.userPreview || '';

      const item = document.createElement('div');
      item.className = 'conversation-item';
      item.dataset.platform = conv.platform;
      item.dataset.id = conv.id;

      if (previewText) {
        item.innerHTML = `
          <span class="platform-icon ${conv.platform}"></span>
          <div class="conversation-content">
            <div class="conversation-title">${escapeHtml(conv.title)}</div>
            <div class="conversation-preview">${escapeHtml(previewText)}</div>
          </div>
          <button class="conversation-link" data-url="${escapeHtml(conv.url)}">↗</button>
        `;
      } else {
        item.innerHTML = `
          <span class="platform-icon ${conv.platform}"></span>
          <div class="conversation-content">
            <div class="conversation-title">${escapeHtml(conv.title)}</div>
          </div>
          <button class="conversation-link" data-url="${escapeHtml(conv.url)}">↗</button>
        `;
      }

      // Click on item shows preview
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('conversation-link')) {
          selectConversation(conv);
        }
      });

      // Click on link button opens in new tab
      item.querySelector('.conversation-link').addEventListener('click', (e) => {
        e.stopPropagation();
        openConversation(conv.url, conv.platform);
      });

      conversationListEl.appendChild(item);
    });
  }

  // Select a conversation and show preview
  async function selectConversation(conv) {
    selectedConversation = conv;

    // Update UI
    document.querySelectorAll('.conversation-item').forEach(el => {
      el.classList.remove('active');
    });
    const activeEl = document.querySelector(
      `.conversation-item[data-platform="${conv.platform}"][data-id="${conv.id}"]`
    );
    if (activeEl) {
      activeEl.classList.add('active');
    }

    // Show preview panel
    conversationListEl.classList.add('hidden');
    previewPanelEl.classList.remove('hidden');
    backBtnEl.classList.remove('hidden');
    openLinkBtnEl.classList.remove('hidden');
    previewTitleEl.textContent = conv.title;

    // Store URL for open button
    openLinkBtnEl.dataset.url = conv.url;
    openLinkBtnEl.dataset.platform = conv.platform;

    // Load and show messages
    previewMessagesEl.innerHTML = '<div class="loading">加载中...</div>';
    const messages = await loadMessages(conv.platform, conv.id);

    if (messages.length === 0) {
      previewMessagesEl.innerHTML = `
        <div class="no-preview">
          <p>暂无预览</p>
          <small>打开此对话后会自动保存预览内容</small>
        </div>
      `;
    } else {
      renderMessages(messages);
    }
  }

  // Render messages
  function renderMessages(messages) {
    previewMessagesEl.innerHTML = '';

    messages.forEach(msg => {
      const item = document.createElement('div');
      item.className = `message-item ${msg.role}`;
      const imageUrls = Array.isArray(msg.imageUrls) ? msg.imageUrls.slice(0, 6) : [];
      const imagesHtml = imageUrls.length
        ? `<div class="message-images">${imageUrls.map(url => `
            <img src="${escapeAttr(url)}" loading="lazy" alt="图片缩略图" />
          `).join('')}</div>`
        : '';
      const content = msg.content || '';
      item.innerHTML = `
        <div class="message-role">${msg.role === 'user' ? '用户' : 'AI'}</div>
        ${imagesHtml}
        <div class="message-content">${escapeHtml(content)}</div>
      `;
      previewMessagesEl.appendChild(item);
    });

    // Scroll to top to show first messages
    previewMessagesEl.scrollTop = 0;
  }

  // Go back to conversation list
  function goBack() {
    selectedConversation = null;
    previewPanelEl.classList.add('hidden');
    conversationListEl.classList.remove('hidden');
    backBtnEl.classList.add('hidden');
    openLinkBtnEl.classList.add('hidden');

    // Remove active state
    document.querySelectorAll('.conversation-item').forEach(el => {
      el.classList.remove('active');
    });
  }

  // Open conversation in original site
  function openConversation(url, platform) {
    chrome.runtime.sendMessage({
      type: 'OPEN_CONVERSATION',
      url,
      platform
    });
  }

  // Full-text search
  async function performSearch(query) {
    if (!query || query.trim().length === 0) {
      searchResultsEl.classList.add('hidden');
      return;
    }

    searchResultsListEl.innerHTML = '<div class="loading">搜索中...</div>';
    searchResultsEl.classList.remove('hidden');

    try {
      const results = await chrome.runtime.sendMessage({
        type: 'SEARCH_MESSAGES',
        query
      });

      renderSearchResults(results, query);
    } catch (e) {
      console.error('Search failed:', e);
      searchResultsListEl.innerHTML = '<div class="no-results">搜索失败</div>';
    }
  }

  // Render search results
  function renderSearchResults(results, query) {
    searchResultsListEl.innerHTML = '';

    if (!results || results.length === 0) {
      searchResultsListEl.innerHTML = '<div class="no-results">没有找到匹配的结果</div>';
      return;
    }

    results.forEach(result => {
      const conv = allConversations.find(c =>
        c.platform === result.platform && c.id === result.conversationId
      );

      if (!conv) return;

      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `
        <span class="platform-icon ${result.platform}"></span>
        <div class="search-result-content">
          <div class="search-result-title">${escapeHtml(conv.title)}</div>
          <div class="search-result-platform">${platformNames[result.platform]}</div>
          ${result.matches.slice(0, 3).map(msg => `
            <div class="search-result-match">
              ${highlightText((msg.content || '').substring(0, 150), query)}
            </div>
          `).join('')}
        </div>
      `;

      item.addEventListener('click', () => {
        selectConversation(conv);
        searchResultsEl.classList.add('hidden');
      });

      searchResultsListEl.appendChild(item);
    });
  }

  // Highlight search query in text
  function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return escaped.replace(regex, '<span class="highlight">$1</span>');
  }

  // Escape regex special characters
  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Format timestamp
  function formatTime(timestamp) {
    if (!timestamp) return '未知';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return date.toLocaleDateString('zh-CN');
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeAttr(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Event listeners
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (searchMode === 'content') {
        performSearch(searchEl.value);
      } else {
        renderConversationList(searchEl.value);
      }
    }
  });

  searchBtnEl.addEventListener('click', () => {
    if (searchMode === 'content') {
      performSearch(searchEl.value);
    } else {
      renderConversationList(searchEl.value);
    }
  });

  searchTitlesBtnEl.addEventListener('click', () => {
    searchMode = 'titles';
    searchTitlesBtnEl.classList.add('active');
    searchContentBtnEl.classList.remove('active');
    searchResultsEl.classList.add('hidden');
    renderConversationList(searchEl.value);
  });

  searchContentBtnEl.addEventListener('click', () => {
    searchMode = 'content';
    searchContentBtnEl.classList.add('active');
    searchTitlesBtnEl.classList.remove('active');
  });

  closeSearchBtnEl.addEventListener('click', () => {
    searchResultsEl.classList.add('hidden');
  });

  backBtnEl.addEventListener('click', goBack);

  openLinkBtnEl.addEventListener('click', () => {
    openConversation(openLinkBtnEl.dataset.url, openLinkBtnEl.dataset.platform);
  });

  openFullpageBtnEl.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_FULLPAGE' });
  });

  clearCacheBtnEl.addEventListener('click', async () => {
    const confirmed = confirm('确定要清除所有缓存吗？\n\n这将删除所有已保存的对话和消息数据。');
    if (confirmed) {
      try {
        await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
        // Reset local state
        allConversations = [];
        conversationPreviews = {};
        selectedConversation = null;
        // Re-render
        renderConversationList();
        goBack();
        alert('缓存已清除');
      } catch (e) {
        console.error('Failed to clear cache:', e);
        alert('清除缓存失败');
      }
    }
  });

  // Listen for updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CONVERSATIONS_UPDATED') {
      // Convert grouped object to flat array and sort by lastSynced
      const grouped = message.conversations || {};
      allConversations = [];
      
      const platforms = ['chatgpt', 'claude', 'gemini', 'grok', 'perplexity', 'deepseek'];
      platforms.forEach(platform => {
        (grouped[platform] || []).forEach(conv => {
          allConversations.push(conv);
        });
      });
      
      // Sort all conversations by platform last change time descending
      allConversations.sort(
        (a, b) => ((b.lastUpdated ?? b.lastSynced ?? 0) - (a.lastUpdated ?? a.lastSynced ?? 0))
      );
      
      loadPreviews().then(() => {
        renderConversationList(searchEl.value);
      });
    }

    if (message.type === 'MESSAGES_UPDATED' && selectedConversation) {
      if (
        message.platform === selectedConversation.platform &&
        message.conversationId === selectedConversation.id
      ) {
        renderMessages(message.messages);
      }
      // Refresh previews
      loadPreviews().then(() => {
        renderConversationList(searchEl.value);
      });
    }
  });

  // Initial load
  loadConversations();

  console.log('[GCCAI] Side panel loaded');
})();
