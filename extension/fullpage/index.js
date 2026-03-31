// Full page view logic
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

  // Elements
  const conversationListEl = document.getElementById('conversation-list');
  const previewPanelEl = document.getElementById('preview-panel');
  const welcomePanelEl = document.getElementById('welcome-panel');
  const previewTitleEl = document.getElementById('preview-title');
  const previewMessagesEl = document.getElementById('preview-messages');
  const openLinkBtnEl = document.getElementById('open-link-btn');
  const searchEl = document.getElementById('search');
  const searchBtnEl = document.getElementById('search-btn');
  const searchTitlesBtnEl = document.getElementById('search-titles');
  const searchContentBtnEl = document.getElementById('search-content');
  const searchResultsEl = document.getElementById('search-results');
  const searchResultsListEl = document.getElementById('search-results-list');
  const searchCountEl = document.getElementById('search-count');
  const closeSearchBtnEl = document.getElementById('close-search');
  const openSidePanelBtnEl = document.getElementById('open-sidepanel');
  const clearCacheBtnEl = document.getElementById('clear-cache-btn');
  const addFolderBtnEl = document.getElementById('add-folder-btn');
  const folderListEl = document.getElementById('folder-list');
  const moveToFolderBtnEl = document.getElementById('move-to-folder-btn');
  const folderModalEl = document.getElementById('folder-modal');
  const folderModalTitleEl = document.getElementById('folder-modal-title');
  const folderNameInputEl = document.getElementById('folder-name-input');
  const folderModalCancelEl = document.getElementById('folder-modal-cancel');
  const folderModalConfirmEl = document.getElementById('folder-modal-confirm');
  const moveToFolderModalEl = document.getElementById('move-to-folder-modal');
  const moveFolderListEl = document.getElementById('move-folder-list');
  const moveModalCancelEl = document.getElementById('move-modal-cancel');
  const statsEl = document.getElementById('stats');
  const platformFilterEls = document.querySelectorAll('.platform-filter');

  let allConversations = [];
  let allFolders = [];
  let selectedConversation = null;
  let selectedFolderId = 'all';
  let searchMode = 'titles';
  let activePlatformFilter = 'all';
  let editingFolderId = null;

  const RECENT_UPDATE_MS = 8000;
  const updatedAtByKey = new Map(); // `${platform}:${conversationId}` -> timestamp(ms)
  const updatedTimers = new Map(); // key -> timeoutId

  function getConvKey(platform, conversationId) {
    return `${platform}:${conversationId}`;
  }

  function isRecentlyUpdated(platform, conversationId) {
    const key = getConvKey(platform, conversationId);
    const ts = updatedAtByKey.get(key);
    return typeof ts === 'number' && (Date.now() - ts) <= RECENT_UPDATE_MS;
  }

  function markConversationUpdated(platform, conversationId) {
    const key = getConvKey(platform, conversationId);
    updatedAtByKey.set(key, Date.now());

    const itemEl = document.querySelector(
      `.conversation-item[data-platform="${platform}"][data-id="${conversationId}"]`
    );
    if (itemEl) itemEl.classList.add('updated');

    const existing = updatedTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      updatedAtByKey.delete(key);
      const el = document.querySelector(
        `.conversation-item[data-platform="${platform}"][data-id="${conversationId}"]`
      );
      if (el) el.classList.remove('updated');
    }, RECENT_UPDATE_MS);
    updatedTimers.set(key, timer);
  }

  // Load conversations from storage
  async function loadConversations() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_CONVERSATIONS' });
      // Convert grouped object to flat array
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
      
      renderConversationList();
      updateStats();
    } catch (e) {
      console.error('Failed to load conversations:', e);
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

  // Update statistics
  function updateStats() {
    let total = allConversations.length;
    const counts = {
      chatgpt: 0, claude: 0, gemini: 0, grok: 0, perplexity: 0, deepseek: 0
    };
    
    allConversations.forEach(conv => {
      if (counts.hasOwnProperty(conv.platform)) {
        counts[conv.platform]++;
      }
    });

    statsEl.innerHTML = `
      <div class="stat-item">
        <div class="stat-value">${total}</div>
        <div class="stat-label">总对话数</div>
      </div>
      ${Object.keys(counts).map(platform => `
        <div class="stat-item">
          <div class="stat-value">${counts[platform]}</div>
          <div class="stat-label">${platformNames[platform]}</div>
        </div>
      `).join('')}
    `;
  }

  // Load folders from storage
  async function loadFolders() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_FOLDERS' });
      allFolders = response || [];
      renderFolderList();
    } catch (e) {
      console.error('Failed to load folders:', e);
    }
  }

  // Render folder list
  function renderFolderList() {
    folderListEl.innerHTML = '';

    // All conversations folder
    const allFolder = document.createElement('div');
    allFolder.className = `folder-item${selectedFolderId === 'all' ? ' active' : ''}`;
    allFolder.dataset.folderId = 'all';
    allFolder.innerHTML = `
      <span class="folder-icon">📁</span>
      <span class="folder-name">全部对话</span>
    `;
    allFolder.addEventListener('click', () => selectFolder('all'));
    folderListEl.appendChild(allFolder);

    // User folders
    allFolders.forEach(folder => {
      const count = allConversations.filter(c => c.folderId === folder.id).length;
      const item = document.createElement('div');
      item.className = `folder-item${selectedFolderId === folder.id ? ' active' : ''}`;
      item.dataset.folderId = folder.id;
      item.innerHTML = `
        <span class="folder-icon">📂</span>
        <span class="folder-name">${escapeHtml(folder.name)}</span>
        <span class="folder-count">${count}</span>
        <div class="folder-actions">
          <button class="folder-action-btn rename" title="重命名">✏️</button>
          <button class="folder-action-btn delete" title="删除">🗑️</button>
        </div>
      `;

      // Click to select folder
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.folder-action-btn')) {
          selectFolder(folder.id);
        }
      });

      // Rename folder
      item.querySelector('.rename').addEventListener('click', (e) => {
        e.stopPropagation();
        openFolderModal(folder.id, folder.name);
      });

      // Delete folder
      item.querySelector('.delete').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteFolder(folder.id);
      });

      // Drag and drop support
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        item.classList.add('drag-over');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const convId = e.dataTransfer.getData('text/plain');
        if (convId) {
          await chrome.runtime.sendMessage({
            type: 'MOVE_TO_FOLDER',
            conversationId: convId,
            folderId: folder.id
          });
          await loadConversations();
        }
      });

      folderListEl.appendChild(item);
    });
  }

  // Select folder
  function selectFolder(folderId) {
    selectedFolderId = folderId;
    conversationListEl.dataset.folderId = folderId;
    renderFolderList();
    renderConversationList();
  }

  // Open folder modal
  function openFolderModal(folderId = null, currentName = '') {
    editingFolderId = folderId;
    folderModalTitleEl.textContent = folderId ? '重命名文件夹' : '新建文件夹';
    folderNameInputEl.value = currentName;
    folderModalEl.classList.remove('hidden');
    folderNameInputEl.focus();
  }

  // Close folder modal
  function closeFolderModal() {
    folderModalEl.classList.add('hidden');
    editingFolderId = null;
    folderNameInputEl.value = '';
  }

  // Save folder
  async function saveFolder() {
    const name = folderNameInputEl.value.trim();
    if (!name) return;

    try {
      if (editingFolderId) {
        await chrome.runtime.sendMessage({
          type: 'UPDATE_FOLDER',
          folderId: editingFolderId,
          name
        });
      } else {
        await chrome.runtime.sendMessage({
          type: 'CREATE_FOLDER',
          name
        });
      }
      closeFolderModal();
      await loadFolders();
    } catch (e) {
      console.error('Failed to save folder:', e);
    }
  }

  // Delete folder
  async function deleteFolder(folderId) {
    const folder = allFolders.find(f => f.id === folderId);
    if (!folder) return;

    const confirmed = confirm(`确定要删除文件夹"${folder.name}"吗？\n\n文件夹中的对话将被移出文件夹。`);
    if (!confirmed) return;

    try {
      await chrome.runtime.sendMessage({
        type: 'DELETE_FOLDER',
        folderId
      });
      if (selectedFolderId === folderId) {
        selectedFolderId = 'all';
      }
      await loadFolders();
      await loadConversations();
    } catch (e) {
      console.error('Failed to delete folder:', e);
    }
  }

  // Open move to folder modal
  function openMoveToFolderModal() {
    if (!selectedConversation) return;

    moveFolderListEl.innerHTML = '';

    // No folder option
    const noFolderItem = document.createElement('div');
    noFolderItem.className = 'move-folder-item';
    noFolderItem.innerHTML = `
      <span class="folder-icon">📁</span>
      <span>不在文件夹中</span>
    `;
    noFolderItem.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        type: 'MOVE_TO_FOLDER',
        conversationId: selectedConversation.id,
        folderId: null
      });
      closeMoveToFolderModal();
      await loadConversations();
    });
    moveFolderListEl.appendChild(noFolderItem);

    // User folders
    allFolders.forEach(folder => {
      const item = document.createElement('div');
      item.className = 'move-folder-item';
      if (selectedConversation.folderId === folder.id) {
        item.classList.add('selected');
      }
      item.innerHTML = `
        <span class="folder-icon">📂</span>
        <span>${escapeHtml(folder.name)}</span>
      `;
      item.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({
          type: 'MOVE_TO_FOLDER',
          conversationId: selectedConversation.id,
          folderId: folder.id
        });
        closeMoveToFolderModal();
        await loadConversations();
      });
      moveFolderListEl.appendChild(item);
    });

    moveToFolderModalEl.classList.remove('hidden');
  }

  // Close move to folder modal
  function closeMoveToFolderModal() {
    moveToFolderModalEl.classList.add('hidden');
  }

  // Render conversation list - unified by time with platform indicators
  function renderConversationList(filter = '', { preserveScroll = false } = {}) {
    const scrollTop = preserveScroll ? conversationListEl.scrollTop : 0;
    conversationListEl.innerHTML = '';

    let filtered = filter
      ? allConversations.filter(c =>
          c.title.toLowerCase().includes(filter.toLowerCase())
        )
      : allConversations;

    // Filter by folder
    if (selectedFolderId !== 'all') {
      filtered = filtered.filter(c => c.folderId === selectedFolderId);
    } else {
      // Show all conversations when "all" is selected
      filtered = filtered;
    }

    // Filter by platform if not "all"
    if (activePlatformFilter !== 'all') {
      filtered = filtered.filter(c => c.platform === activePlatformFilter);
    }

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
      const item = document.createElement('div');
      item.className = 'conversation-item';
      item.dataset.platform = conv.platform;
      item.dataset.id = conv.id;

      if (selectedConversation &&
          conv.platform === selectedConversation.platform &&
          conv.id === selectedConversation.id) {
        item.classList.add('active');
      }

      if (isRecentlyUpdated(conv.platform, conv.id)) {
        item.classList.add('updated');
      }

      item.innerHTML = `
        <span class="platform-icon ${conv.platform}"></span>
        <div class="conversation-info">
          <div class="conversation-title">${escapeHtml(conv.title)}</div>
          <div class="conversation-meta">${platformNames[conv.platform]} · ${formatTime(conv.lastUpdated ?? conv.lastSynced)}</div>
        </div>
        <button class="refresh-btn" data-platform="${conv.platform}" data-id="${conv.id}" title="刷新缓存">↻</button>
        <button class="conversation-link" data-url="${escapeHtml(conv.url)}">↗</button>
      `;

      // Click on item shows preview (entire item is clickable)
      item.addEventListener('click', (e) => {
        // Don't trigger if clicking on buttons
        if (e.target.closest('.refresh-btn') || e.target.closest('.conversation-link')) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        console.log('[GCCAI] Conversation clicked:', conv.title);
        selectConversation(conv);
      });

      // Click on refresh button refreshes cache in background
      item.querySelector('.refresh-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openConversation(conv.url, conv.platform, true);
      });

      // Click on link button opens in new tab
      item.querySelector('.conversation-link').addEventListener('click', (e) => {
        e.stopPropagation();
        openConversation(conv.url, conv.platform, false);
      });

      // Drag and drop support
      item.draggable = true;
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', conv.id);
        item.classList.add('dragging');
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });

      conversationListEl.appendChild(item);
    });

    if (preserveScroll) conversationListEl.scrollTop = scrollTop;
  }

  // Select a conversation and show preview
  async function selectConversation(conv) {
    console.log('[GCCAI] Selecting conversation:', conv.title, conv.platform, conv.id);
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
    welcomePanelEl.classList.add('hidden');
    previewPanelEl.classList.remove('hidden');
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
          <p>暂无预览内容</p>
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

  // Open conversation in original site
  function openConversation(url, platform, background = false) {
    chrome.runtime.sendMessage({
      type: 'OPEN_CONVERSATION',
      url,
      platform,
      background
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
      searchCountEl.textContent = '';
      searchResultsListEl.innerHTML = '<div class="no-results">没有找到匹配的结果</div>';
      return;
    }

    searchCountEl.textContent = `(${results.length} 个对话)`;

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
          <div class="search-result-header">
            <div class="search-result-title">${escapeHtml(conv.title)}</div>
            <span class="search-result-platform">${platformNames[result.platform]}</span>
          </div>
          ${result.matches.slice(0, 3).map(msg => `
            <div class="search-result-match">
              ${highlightText((msg.content || '').substring(0, 200), query)}
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

  openLinkBtnEl.addEventListener('click', () => {
    openConversation(openLinkBtnEl.dataset.url, openLinkBtnEl.dataset.platform);
  });

  openSidePanelBtnEl.addEventListener('click', () => {
    // Close this tab and open side panel
    chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  });

  clearCacheBtnEl.addEventListener('click', async () => {
    const confirmed = confirm('确定要清除所有缓存吗？\n\n这将删除所有已保存的对话和消息数据。');
    if (confirmed) {
      try {
        await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
        // Reset local state
        allConversations = [];
        selectedConversation = null;
        updatedAtByKey.clear();
        // Re-render
        renderConversationList();
        updateStats();
        // Show welcome panel
        welcomePanelEl.classList.remove('hidden');
        previewPanelEl.classList.add('hidden');
        alert('缓存已清除');
      } catch (e) {
        console.error('Failed to clear cache:', e);
        alert('清除缓存失败');
      }
    }
  });

  // Folder event listeners
  addFolderBtnEl.addEventListener('click', () => {
    openFolderModal();
  });

  moveToFolderBtnEl.addEventListener('click', () => {
    openMoveToFolderModal();
  });

  folderModalCancelEl.addEventListener('click', closeFolderModal);
  folderModalConfirmEl.addEventListener('click', saveFolder);
  moveModalCancelEl.addEventListener('click', closeMoveToFolderModal);

  // Close modals on backdrop click
  folderModalEl.addEventListener('click', (e) => {
    if (e.target === folderModalEl) closeFolderModal();
  });

  moveToFolderModalEl.addEventListener('click', (e) => {
    if (e.target === moveToFolderModalEl) closeMoveToFolderModal();
  });

  // Save folder on Enter key
  folderNameInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveFolder();
    if (e.key === 'Escape') closeFolderModal();
  });

  // Platform filter
  platformFilterEls.forEach(btn => {
    btn.addEventListener('click', () => {
      platformFilterEls.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePlatformFilter = btn.dataset.platform;
      renderConversationList(searchEl.value);
    });
  });

  // Listen for updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CONVERSATIONS_UPDATED' || message.type === 'DATA_UPDATED') {
      // Convert grouped object to flat array
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
      
      if (message.folders) {
        allFolders = message.folders;
        renderFolderList();
      }
      
      renderConversationList(searchEl.value, { preserveScroll: true });
      updateStats();
    }

    if (message.type === 'MESSAGES_UPDATED') {
      markConversationUpdated(message.platform, message.conversationId);

      if (selectedConversation &&
          message.platform === selectedConversation.platform &&
          message.conversationId === selectedConversation.id) {
        renderMessages(message.messages);
      }
    }
  });

  // Initial load
  loadFolders();
  loadConversations();

  console.log('[GCCAI] Full page view loaded');
})();
