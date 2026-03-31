// Grok conversation list scraper with API interception
(function() {
  'use strict';

  const PLATFORM = 'grok';
  let knownConversationIds = new Set();
  let conversationTimestamps = new Map();

  function extractConversationIdFromHref(href) {
    if (!href) return null;
    const patterns = [
      /\/c\/([a-f0-9-]+)/i,
      /\/chat\/([a-f0-9-]+)/i,
      /\/messages\/([a-f0-9-]+)/i,
      /\/conversation\/([a-f0-9-]+)/i,
      /\/thread\/([a-f0-9-]+)/i,
      /\/([a-f0-9]{8,})/i
    ];
    for (const re of patterns) {
      const m = href.match(re);
      if (m && m[1]) return m[1];
    }
    return null;
  }

  function hashConversations(conversations) {
    return conversations.map(c => c.id).join(',');
  }
  let lastConversationsHash = '';

  // Intercept fetch requests
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (url && (url.includes('/api/conversations') || url.includes('/api/chat'))) {
      try {
        const clonedResponse = response.clone();
        const data = await clonedResponse.json();
        parseGrokResponse(data);
      } catch (e) {
        console.error('[GCCAI] Grok API intercept error:', e);
      }
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
      if (this._gccaiUrl && (this._gccaiUrl.includes('/api/conversations') || this._gccaiUrl.includes('/api/chat'))) {
        try {
          const data = JSON.parse(this.responseText);
          parseGrokResponse(data);
        } catch (e) {
          console.error('[GCCAI] Grok XHR intercept error:', e);
        }
      }
    });
    return originalXHRSend.apply(this, args);
  };

  // Parse Grok API response
  function parseGrokResponse(data) {
    if (!data) return;
    
    // Grok returns conversations in various formats
    const conversations = data.conversations || data.items || data.results || 
                        (Array.isArray(data) ? data : []);
    
    conversations.forEach(conv => {
      const id = conv.id || conv.conversation_id || conv.uuid;
      if (!id) return;
      
      let timestamp = null;
      
      if (conv.updated_at) {
        timestamp = typeof conv.updated_at === 'string' 
          ? Date.parse(conv.updated_at) 
          : (conv.updated_at < 1000000000000 ? conv.updated_at * 1000 : conv.updated_at);
      } else if (conv.created_at) {
        timestamp = typeof conv.created_at === 'string' 
          ? Date.parse(conv.created_at) 
          : (conv.created_at < 1000000000000 ? conv.created_at * 1000 : conv.created_at);
      } else if (conv.timestamp) {
        timestamp = conv.timestamp < 1000000000000 ? conv.timestamp * 1000 : conv.timestamp;
      }
      
      if (timestamp && timestamp > 1600000000000) {
        conversationTimestamps.set(id, timestamp);
      }
    });
    
    console.log('[GCCAI] Grok parsed', conversationTimestamps.size, 'conversation timestamps');
  }

  function extractImageUrls(container) {
    const urls = [];
    const imgs = container.querySelectorAll('img');
    imgs.forEach(img => {
      if (urls.length >= 6) return;
      let src = img.getAttribute('src') || img.getAttribute('data-src') || '';
      if (!src || src.startsWith('data:')) return;
      if (src.startsWith('/')) src = window.location.origin + src;
      if (!urls.includes(src)) urls.push(src);
    });
    return urls;
  }

  function extractConversations() {
    const conversations = [];

    const selectors = [
      'a[href*="/c/"]',
      'a[href*="/chat/"]',
      'a[href*="/conversation/"]',
      'nav a',
      'aside a',
      '[class*="sidebar"] a'
    ];

    for (const selector of selectors) {
      const links = document.querySelectorAll(selector);
      
      links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        
        if (href.startsWith('http') && !href.includes('grok.com') && !href.includes('x.ai')) return;
        
        let id = extractConversationIdFromHref(href);
        const title = link.textContent?.trim() || 
                      link.querySelector('[class*="title"]')?.textContent?.trim() || 
                      'Untitled';

        if (id && title && title.length > 0 && title !== 'Untitled') {
          if (!conversations.some(c => c.id === id)) {
            const fullUrl = href.startsWith('http') ? href : window.location.origin + href;
            const conv = {
              id,
              platform: PLATFORM,
              title,
              url: fullUrl
            };
            
            // Only set lastUpdated if we have a real timestamp from API
            const realTimestamp = conversationTimestamps.get(id);
            if (realTimestamp) {
              conv.lastUpdated = realTimestamp;
            }
            
            conversations.push(conv);
          }
        }
      });
      if (conversations.length > 0) break;
    }

    console.log('[GCCAI] Grok conversations found:', conversations.length);
    return conversations;
  }

  function extractMessages() {
    const messages = [];
    const seenContent = new Set();

    const selectors = [
      '[data-message-author-role]',
      '[data-role]',
      '[data-testid*="message"]',
      '[class*="Message"]',
      '[class*="message"]',
      '[class*="turn"]',
      '[class*="response"]',
      'article'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      
      elements.forEach(el => {
        const text = el.textContent?.trim() || '';
        if (seenContent.has(text) || text.length < 10 || text.length > 5000) return;
        
        const classList = (el.className || '').toLowerCase();
        if (classList.includes('sidebar') || classList.includes('nav') || 
            classList.includes('header') || classList.includes('footer') ||
            classList.includes('button') || classList.includes('input')) {
          return;
        }

        let role = 'unknown';
        const dataRole = (el.getAttribute('data-role') || el.getAttribute('data-message-author-role') || '').toLowerCase();
        
        if (dataRole === 'user' || dataRole === 'human') {
          role = 'user';
        } else if (dataRole === 'assistant' || dataRole === 'ai' || dataRole === 'grok') {
          role = 'assistant';
        } else if (classList.includes('user') || classList.includes('human') || classList.includes('query')) {
          role = 'user';
        } else if (classList.includes('assistant') || classList.includes('ai') || 
                   classList.includes('grok') || classList.includes('response')) {
          role = 'assistant';
        }

        if (role === 'unknown') {
          let parent = el.parentElement;
          for (let i = 0; i < 3 && parent; i++) {
            const parentClass = (parent.className || '').toLowerCase();
            if (parentClass.includes('user') || parentClass.includes('human')) {
              role = 'user';
              break;
            } else if (parentClass.includes('assistant') || parentClass.includes('ai') || parentClass.includes('grok')) {
              role = 'assistant';
              break;
            }
            parent = parent.parentElement;
          }
        }

        if (role === 'unknown' && messages.length > 0) {
          role = messages[messages.length - 1].role === 'user' ? 'assistant' : 'user';
        } else if (role === 'unknown') {
          role = 'user';
        }

        seenContent.add(text);
        const imageUrls = extractImageUrls(el);
        
        messages.push({
          role,
          content: text.substring(0, 500),
          imageUrls
        });
      });

      if (messages.length >= 2) break;
    }

    return messages;
  }

  function getCurrentConversationId() {
    return extractConversationIdFromHref(window.location.pathname);
  }

  function syncConversations() {
    const conversations = extractConversations();
    const newHash = hashConversations(conversations);

    if (newHash !== lastConversationsHash && conversations.length > 0) {
      lastConversationsHash = newHash;

      lastConversationsHash = newHash;
      const currentIds = new Set(conversations.map(c => c.id));
      // Accumulate known IDs rather than replacing them to prevent wiping virtual lists
      currentIds.forEach(id => knownConversationIds.add(id));

      chrome.runtime.sendMessage({
        type: 'UPDATE_CONVERSATIONS',
        platform: PLATFORM,
        conversations
      });
      
      // Disabled auto-delete: Virtual DOM removes records from viewport, triggering false deletions otherwise.
    }
  }

  function syncCurrentMessages() {
    const conversationId = getCurrentConversationId();
    const messages = extractMessages();
    
    if (conversationId && messages.length > 0) {
      chrome.runtime.sendMessage({
        type: 'UPDATE_MESSAGES',
        platform: PLATFORM,
        conversationId,
        messages
      });
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
  }, 3000);

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
      }, 2000);
    }
  }, 1000);

  const messageAreaSelectors = ['main', '[class*="conversation"]', '[class*="chat"]', 'section', 'article'];
  for (const selector of messageAreaSelectors) {
    const messageArea = document.querySelector(selector);
    if (messageArea) {
      const messageObserver = new MutationObserver((mutations) => {
        const hasNewMessages = mutations.some(m => m.type === 'childList' && m.addedNodes.length > 0);
        if (hasNewMessages) debouncedSyncMessages();
      });
      messageObserver.observe(messageArea, { childList: true, subtree: true });
      break;
    }
  }

  console.log('[GCCAI] Grok content script loaded with API interception');
})();
