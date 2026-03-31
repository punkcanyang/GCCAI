// Deepseek conversation list scraper - reads from IndexedDB
(function() {
  'use strict';

  const PLATFORM = 'deepseek';
  const DB_NAME = 'deepseek-chat';
  let knownConversationIds = new Set();

  function hashConversations(conversations) {
    return conversations.map(c => c.id).join(',');
  }
  let lastConversationsHash = '';

  // Read conversations from IndexedDB
  async function readConversationsFromIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      
      request.onerror = () => {
        console.log('[GCCAI] Deepseek: Cannot open IndexedDB');
        resolve([]);
      };
      
      request.onsuccess = (event) => {
        const db = event.target.result;
        const conversations = [];
        
        // Get all object stores
        const storeNames = Array.from(db.objectStoreNames);
        console.log('[GCCAI] Deepseek object stores:', storeNames);
        
        // Try to find conversations in various stores
        let pending = storeNames.length;
        
        if (pending === 0) {
          resolve([]);
          return;
        }
        
        storeNames.forEach(storeName => {
          try {
            const tx = db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            
            request.onsuccess = () => {
              const data = request.result;
              if (Array.isArray(data)) {
                data.forEach(item => {
                  // Look for conversation-like objects
                  const id = item.id || item.chat_id || item.conversation_id || item.key;
                  const title = item.title || item.name || item.topic || '';
                  const timestamp = item.create_time || item.update_time || item.created_at || item.updated_at || item.timestamp;
                  
                  if (id && title) {
                    let lastUpdated = null;
                    if (timestamp) {
                      lastUpdated = typeof timestamp === 'number' 
                        ? (timestamp < 1000000000000 ? timestamp * 1000 : timestamp)
                        : Date.parse(timestamp);
                    }
                    
                    if (!conversations.some(c => c.id === String(id))) {
                      conversations.push({
                        id: String(id),
                        platform: PLATFORM,
                        title: String(title),
                        url: `${window.location.origin}/chat/${id}`,
                        lastUpdated: lastUpdated || undefined
                      });
                    }
                  }
                });
              }
              
              pending--;
              if (pending === 0) {
                console.log('[GCCAI] Deepseek found', conversations.length, 'conversations from IndexedDB');
                resolve(conversations);
              }
            };
            
            request.onerror = () => {
              pending--;
              if (pending === 0) {
                resolve(conversations);
              }
            };
          } catch (e) {
            pending--;
            if (pending === 0) {
              resolve(conversations);
            }
          }
        });
      };
    });
  }

  // Also try to extract from DOM as fallback
  function extractConversationsFromDOM() {
    const conversations = [];

    const selectors = [
      'a[href*="/chat/"]',
      '[class*="chat"] a',
      '[class*="conversation"] a',
      '[class*="history"] a',
      'nav a',
      'aside a'
    ];

    for (const selector of selectors) {
      const links = document.querySelectorAll(selector);
      
      links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        
        if (href.startsWith('http') && !href.includes('deepseek')) return;
        
        const chatMatch = href.match(/\/chat\/([a-f0-9-]+)/);
        const id = chatMatch?.[1] || null;
        const title = link.textContent?.trim() || 'Untitled';

        if (id && title && title.length > 0 && title !== 'Untitled') {
          if (!conversations.some(c => c.id === id)) {
            const fullUrl = href.startsWith('http') ? href : window.location.origin + href;
            conversations.push({
              id,
              platform: PLATFORM,
              title,
              url: fullUrl
            });
          }
        }
      });
      
      if (conversations.length > 0) break;
    }

    return conversations;
  }

  async function extractConversations() {
    // Try IndexedDB first
    const indexedDBConversations = await readConversationsFromIndexedDB();
    
    // Also try DOM as fallback
    const domConversations = extractConversationsFromDOM();
    
    // Merge, preferring IndexedDB data
    const allConversations = [...indexedDBConversations];
    domConversations.forEach(domConv => {
      if (!allConversations.some(c => c.id === domConv.id)) {
        allConversations.push(domConv);
      }
    });
    
    console.log('[GCCAI] Deepseek total conversations:', allConversations.length);
    return allConversations;
  }

  function extractMessages() {
    const messages = [];

    const selectors = [
      '[class*="message"]',
      '[class*="chat-item"]',
      '[class*="turn"]',
      '[class*="response"]',
      'article'
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      
      elements.forEach(el => {
        if (el.textContent?.length < 10) return;
        
        const classList = (el.className || '').toLowerCase();
        if (classList.includes('sidebar') || classList.includes('nav') || 
            classList.includes('header') || classList.includes('footer')) {
          return;
        }
        
        let role = 'unknown';
        if (classList.includes('user') || classList.includes('human') || classList.includes('query')) {
          role = 'user';
        } else if (classList.includes('assistant') || classList.includes('ai') || classList.includes('response')) {
          role = 'assistant';
        }
        
        if (role === 'unknown') {
          role = messages.length % 2 === 0 ? 'user' : 'assistant';
        }
        
        const content = el.textContent?.trim() || '';
        if (content && content.length > 5) {
          messages.push({
            role,
            content: content.substring(0, 500)
          });
        }
      });
      
      if (messages.length >= 2) break;
    }

    return messages;
  }

  function getCurrentConversationId() {
    const path = window.location.pathname;
    const chatMatch = path.match(/\/chat\/([a-f0-9-]+)/);
    return chatMatch?.[1] || null;
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
  }, 2000);

  // Observe sidebar changes
  const sidebar = document.querySelector('nav, [class*="sidebar"], aside');
  if (sidebar) {
    const observer = new MutationObserver((mutations) => {
      const hasStructuralChanges = mutations.some(m =>
        m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)
      );
      if (hasStructuralChanges) debouncedSyncConversations();
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
      }, 1500);
    }
  }, 1000);

  // Sync messages when content changes
  const messageArea = document.querySelector('main, [class*="chat"], [class*="conversation"]');
  if (messageArea) {
    const messageObserver = new MutationObserver((mutations) => {
      const hasNewMessages = mutations.some(m => m.type === 'childList' && m.addedNodes.length > 0);
      if (hasNewMessages) debouncedSyncMessages();
    });
    messageObserver.observe(messageArea, { childList: true, subtree: true });
  }

  console.log('[GCCAI] Deepseek content script loaded');
})();
