// ChatGPT conversation list scraper with API interception
(function() {
  'use strict';

  const PLATFORM = 'chatgpt';
  let knownConversationIds = new Set();
  let conversationTimestamps = new Map();

  function hashConversations(conversations) {
    return conversations.map(c => c.id).join(',');
  }
  let lastConversationsHash = '';

  // Intercept fetch requests
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (url && (url.includes('/backend-api/conversations') || url.includes('/api/conversation'))) {
      try {
        const clonedResponse = response.clone();
        const data = await clonedResponse.json();
        parseChatGPTResponse(data);
      } catch (e) {}
    }
    
    return response;
  };

  // Intercept XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._gccaiUrl = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };
  
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      if (this._gccaiUrl && (this._gccaiUrl.includes('/backend-api/conversations') || this._gccaiUrl.includes('/api/conversation'))) {
        try {
          const data = JSON.parse(this.responseText);
          parseChatGPTResponse(data);
        } catch (e) {}
      }
    });
    return originalXHRSend.apply(this, args);
  };

  // Parse ChatGPT API response
  function parseChatGPTResponse(data) {
    if (!data) return;
    
    // ChatGPT returns { items: [...], total: number, limit: number, offset: number }
    const items = data.items || data.conversations || [];
    
    items.forEach(item => {
      if (item.id && item.update_time) {
        // ChatGPT uses update_time in seconds
        const timestamp = typeof item.update_time === 'number' 
          ? (item.update_time < 1000000000000 ? item.update_time * 1000 : item.update_time)
          : Date.parse(item.update_time);
        
        if (timestamp && timestamp > 1600000000000) {
          conversationTimestamps.set(item.id, timestamp);
        }
      }
    });
    
    console.log('[GCCAI] ChatGPT parsed', conversationTimestamps.size, 'conversation timestamps');
  }

  function extractConversations() {
    const conversations = [];

    const links = document.querySelectorAll('a[href^="/c/"]');

    links.forEach(link => {
      const href = link.getAttribute('href');
      const title = link.textContent?.trim() || 'Untitled';
      const id = href.replace('/c/', '');

      if (id && title) {
        const conv = {
          id,
          platform: PLATFORM,
          title,
          url: window.location.origin + href
        };
        
        // Only set lastUpdated if we have a real timestamp from API
        const realTimestamp = conversationTimestamps.get(id);
        if (realTimestamp) {
          conv.lastUpdated = realTimestamp;
        }
        
        conversations.push(conv);
      }
    });

    return conversations;
  }

  function extractMessages() {
    const messages = [];

    const messageElements = document.querySelectorAll('[data-message-author-role]');

    messageElements.forEach(el => {
      const role = el.getAttribute('data-message-author-role');
      const contentEl = el.querySelector('.markdown, [class*="content"]');
      const content = contentEl?.textContent?.trim() || el.textContent?.trim() || '';

      if (content) {
        messages.push({
          role: role === 'user' ? 'user' : 'assistant',
          content: content.substring(0, 500)
        });
      }
    });

    return messages;
  }

  function getCurrentConversationId() {
    const match = window.location.pathname.match(/\/c\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  function syncConversations() {
    const conversations = extractConversations();
    const newHash = hashConversations(conversations);

    if (newHash !== lastConversationsHash && conversations.length > 0) {
      lastConversationsHash = newHash;

      const currentIds = new Set(conversations.map(c => c.id));
      const deletedIds = new Set([...knownConversationIds].filter(id => !currentIds.has(id)));

      knownConversationIds = currentIds;

      chrome.runtime.sendMessage({
        type: 'UPDATE_CONVERSATIONS',
        platform: PLATFORM,
        conversations
      });

      if (deletedIds.size > 0) {
        chrome.runtime.sendMessage({
          type: 'DELETE_CONVERSATIONS',
          platform: PLATFORM,
          conversationIds: Array.from(deletedIds)
        });
      }
    }
  }

  function syncCurrentMessages() {
    const conversationId = getCurrentConversationId();
    if (conversationId) {
      const messages = extractMessages();
      if (messages.length > 0) {
        chrome.runtime.sendMessage({
          type: 'UPDATE_MESSAGES',
          platform: PLATFORM,
          conversationId,
          messages
        });
      }
    }
  }

  function debounce(fn, delay) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  const debouncedSyncConversations = debounce(syncConversations, 1000);
  const debouncedSyncMessages = debounce(syncCurrentMessages, 1500);

  setTimeout(() => {
    syncConversations();
    syncCurrentMessages();
  }, 2000);

  const sidebar = document.querySelector('nav') || document.querySelector('[class*="sidebar"]');
  if (sidebar) {
    const observer = new MutationObserver((mutations) => {
      const hasStructuralChanges = mutations.some(m =>
        m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)
      );
      if (hasStructuralChanges) debouncedSyncConversations();
    });
    observer.observe(sidebar, { childList: true, subtree: false });
  }

  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      setTimeout(() => {
        syncConversations();
        syncCurrentMessages();
      }, 1500);
    }
  }, 1000);

  const messageArea = document.querySelector('main, [class*="conversation"]');
  if (messageArea) {
    const messageObserver = new MutationObserver((mutations) => {
      const hasNewMessages = mutations.some(m => m.type === 'childList' && m.addedNodes.length > 0);
      if (hasNewMessages) debouncedSyncMessages();
    });
    messageObserver.observe(messageArea, { childList: true, subtree: true });
  }

  console.log('[GCCAI] ChatGPT content script loaded with API interception');
})();
