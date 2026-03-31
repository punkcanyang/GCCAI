// Perplexity conversation list scraper - focused on DOM scraping
(function() {
  'use strict';

  const PLATFORM = 'perplexity';
  let knownConversationIds = new Set();

  function hashConversations(conversations) {
    return conversations.map(c => c.id).join(',');
  }
  let lastConversationsHash = '';

  // Try to extract from IndexedDB as well
  async function readFromIndexedDB() {
    const dbNames = ['perplexity', 'perplexity-db', 'perplexity_web'];
    const conversations = [];
    
    for (const dbName of dbNames) {
      try {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(null);
        }).catch(() => null);
        
        if (!db) continue;
        
        const storeNames = Array.from(db.objectStoreNames);
        console.log('[GCCAI] Perplexity IndexedDB stores:', storeNames);
        
        for (const storeName of storeNames) {
          try {
            const tx = db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const data = await new Promise((resolve, reject) => {
              const request = store.getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject([]);
            }).catch(() => []);
            
            if (Array.isArray(data)) {
              data.forEach(item => {
                const id = item.id || item.uuid || item.thread_id || item.key;
                const title = item.title || item.name || item.query || '';
                const timestamp = item.created_at || item.updated_at || item.timestamp;
                
                if (id && title && !conversations.some(c => c.id === String(id))) {
                  let lastUpdated = null;
                  if (timestamp) {
                    lastUpdated = typeof timestamp === 'number' 
                      ? (timestamp < 1000000000000 ? timestamp * 1000 : timestamp)
                      : Date.parse(timestamp);
                  }
                  
                  conversations.push({
                    id: String(id),
                    platform: PLATFORM,
                    title: String(title).substring(0, 100),
                    url: `${window.location.origin}/search/${id}`,
                    lastUpdated: lastUpdated || undefined
                  });
                }
              });
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
    
    return conversations;
  }

  // Aggressive DOM scraping
  function extractFromDOM() {
    const conversations = [];
    const seenIds = new Set();

    // Try all possible selectors for conversation links
    const selectors = [
      'a[href*="/search/"]',
      'a[href*="/thread/"]',
      'a[href*="/c/"]',
      'a[href*="perplexity.ai/search/"]',
      '[class*="thread"] a',
      '[class*="history"] a',
      '[class*="conversation"] a',
      '[class*="sidebar"] a',
      'nav a',
      'aside a',
      '[role="navigation"] a',
      '[role="listitem"] a'
    ];

    for (const selector of selectors) {
      try {
        const links = document.querySelectorAll(selector);
        
        links.forEach(link => {
          const href = link.getAttribute('href') || '';
          if (!href) return;
          
          // Skip non-conversation links
          if (href === '#' || href === '/' || href.includes('settings') || href.includes('login')) return;
          
          // Extract ID from URL
          let id = null;
          const searchMatch = href.match(/\/search\/([a-f0-9-]+)/);
          const threadMatch = href.match(/\/thread\/([a-f0-9-]+)/);
          const cMatch = href.match(/\/c\/([a-f0-9-]+)/);
          const uuidMatch = href.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
          
          id = (searchMatch || threadMatch || cMatch || uuidMatch)?.[1] || null;
          
          if (!id || seenIds.has(id)) return;
          
          const title = link.textContent?.trim() || link.querySelector('span, div, p')?.textContent?.trim() || '';
          if (!title || title.length < 3) return;
          
          seenIds.add(id);
          const fullUrl = href.startsWith('http') ? href : window.location.origin + href;
          
          conversations.push({
            id,
            platform: PLATFORM,
            title: title.substring(0, 100),
            url: fullUrl
          });
        });
        
        if (conversations.length > 0) break;
      } catch (e) {}
    }

    return conversations;
  }

  async function extractConversations() {
    // Try IndexedDB first
    const indexedDBConvs = await readFromIndexedDB();
    console.log('[GCCAI] Perplexity IndexedDB conversations:', indexedDBConvs.length);
    
    // Also try DOM
    const domConvs = extractFromDOM();
    console.log('[GCCAI] Perplexity DOM conversations:', domConvs.length);
    
    // Merge, preferring IndexedDB data
    const allConversations = [...indexedDBConvs];
    domConvs.forEach(domConv => {
      if (!allConversations.some(c => c.id === domConv.id)) {
        allConversations.push(domConv);
      }
    });
    
    console.log('[GCCAI] Perplexity total conversations:', allConversations.length);
    return allConversations;
  }

  function extractMessages() {
    const messages = [];

    const selectors = [
      '[class*="QueryBox"]',
      '[class*="query"]',
      '[class*="user"]',
      '[class*="human"]',
      '[class*="Ask"]'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        const content = el.textContent?.trim() || '';
        if (content && content.length > 5) {
          messages.push({ role: 'user', content: content.substring(0, 500) });
        }
      });
      if (messages.length > 0) break;
    }

    const answerSelectors = [
      '[class*="AnswerBox"]',
      '[class*="answer"]',
      '[class*="prose"]',
      '[class*="response"]',
      '[class*="markdown"]'
    ];

    for (const selector of answerSelectors) {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        const content = el.textContent?.trim() || '';
        if (content && content.length > 10) {
          messages.push({ role: 'assistant', content: content.substring(0, 500) });
        }
      });
      if (messages.length > 1) break;
    }

    return messages;
  }

  function getCurrentConversationId() {
    const path = window.location.pathname;
    const searchMatch = path.match(/\/search\/([a-f0-9-]+)/);
    const threadMatch = path.match(/\/thread\/([a-f0-9-]+)/);
    const cMatch = path.match(/\/c\/([a-f0-9-]+)/);
    const uuidMatch = path.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    
    return (searchMatch || threadMatch || cMatch || uuidMatch)?.[1] || null;
  }

  async function syncConversations() {
    const conversations = await extractConversations();
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

  // Initial sync
  setTimeout(() => {
    syncConversations();
    syncCurrentMessages();
  }, 3000);

  // Observe sidebar
  const sidebar = document.querySelector('nav, aside, [class*="sidebar"]');
  if (sidebar) {
    const observer = new MutationObserver((mutations) => {
      const hasChanges = mutations.some(m =>
        m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)
      );
      if (hasChanges) debouncedSyncConversations();
    });
    observer.observe(sidebar, { childList: true, subtree: false });
  }

  // Sync on navigation
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

  // Sync messages when content changes
  const messageArea = document.querySelector('main, [class*="search"], [class*="thread"]');
  if (messageArea) {
    const messageObserver = new MutationObserver((mutations) => {
      const hasNewMessages = mutations.some(m => m.type === 'childList' && m.addedNodes.length > 0);
      if (hasNewMessages) debouncedSyncMessages();
    });
    messageObserver.observe(messageArea, { childList: true, subtree: true });
  }

  console.log('[GCCAI] Perplexity content script loaded');
})();
