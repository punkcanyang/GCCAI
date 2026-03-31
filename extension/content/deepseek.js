// Deepseek conversation list scraper - simplified DOM-only version
(function() {
  'use strict';

  const PLATFORM = 'deepseek';
  let knownConversationIds = new Set();

  function hashConversations(conversations) {
    return conversations.map(c => c.id).join(',');
  }
  let lastConversationsHash = '';

  function extractConversations() {
    const conversations = [];
    console.log('[GCCAI] Deepseek: Starting conversation extraction...');
    console.log('[GCCAI] Deepseek: Current URL:', window.location.href);

    // Log all links on the page for debugging
    const allLinks = document.querySelectorAll('a');
    console.log('[GCCAI] Deepseek: Total links found:', allLinks.length);

    // Find links that look like conversation links
    allLinks.forEach((link, index) => {
      const href = link.getAttribute('href') || '';
      const text = link.textContent?.trim() || '';
      
      // Log potential conversation links
      if (href.includes('/chat/') || href.includes('/conversation/') || 
          href.length > 20 || text.length > 5) {
        console.log(`[GCCAI] Deepseek: Link ${index}:`, { href: href.substring(0, 100), text: text.substring(0, 50) });
      }
    });

    // Try different URL patterns
    const patterns = [
      { regex: /\/chat\/([a-f0-9-]+)/i, name: 'chat' },
      { regex: /\/conversation\/([a-f0-9-]+)/i, name: 'conversation' },
      { regex: /\/c\/([a-f0-9-]+)/i, name: 'c' }
    ];

    allLinks.forEach(link => {
      const href = link.getAttribute('href') || '';
      const text = link.textContent?.trim() || '';
      
      if (!href || href === '/' || href === '#') return;
      if (href.startsWith('http') && !href.includes('deepseek')) return;
      if (text.length < 2 || text.length > 200) return;

      for (const pattern of patterns) {
        const match = href.match(pattern.regex);
        if (match && match[1]) {
          const id = match[1];
          if (!conversations.some(c => c.id === id)) {
            console.log(`[GCCAI] Deepseek: Found conversation (${pattern.name}):`, { id, text: text.substring(0, 50) });
            conversations.push({
              id,
              platform: PLATFORM,
              title: text || 'Untitled',
              url: href.startsWith('http') ? href : window.location.origin + href
            });
          }
          break;
        }
      }
    });

    // Also try to find conversations in sidebar elements
    const sidebarSelectors = ['nav', 'aside', '[class*="sidebar"]', '[class*="history"]', '[class*="chat-list"]'];
    for (const selector of sidebarSelectors) {
      const sidebar = document.querySelector(selector);
      if (sidebar) {
        console.log('[GCCAI] Deepseek: Found sidebar element:', selector);
        const items = sidebar.querySelectorAll('a, [role="link"], [class*="item"]');
        items.forEach(item => {
          const href = item.getAttribute('href') || '';
          const text = item.textContent?.trim() || '';
          
          for (const pattern of patterns) {
            const match = href.match(pattern.regex);
            if (match && match[1]) {
              const id = match[1];
              if (!conversations.some(c => c.id === id)) {
                console.log(`[GCCAI] Deepseek: Found in sidebar:`, { id, text: text.substring(0, 50) });
                conversations.push({
                  id,
                  platform: PLATFORM,
                  title: text || 'Untitled',
                  url: href.startsWith('http') ? href : window.location.origin + href
                });
              }
              break;
            }
          }
        });
        break;
      }
    }

    console.log('[GCCAI] Deepseek: Total conversations found:', conversations.length);
    return conversations;
  }

  function extractMessages() {
    const messages = [];
    console.log('[GCCAI] Deepseek: Extracting messages...');

    // Find all text blocks that might be messages
    const allElements = document.querySelectorAll('div, p, section, article');
    
    allElements.forEach(el => {
      const text = el.textContent?.trim() || '';
      const classList = (el.className || '').toLowerCase();
      
      // Skip short text, navigation, etc
      if (text.length < 20 || text.length > 2000) return;
      if (classList.includes('nav') || classList.includes('sidebar') || 
          classList.includes('header') || classList.includes('footer') ||
          classList.includes('button')) return;
      if (el.closest('nav') || el.closest('aside') || el.closest('header')) return;
      
      // Check if this might be a message
      const isUser = classList.includes('user') || classList.includes('human') || 
                     classList.includes('query') || classList.includes('prompt');
      const isAssistant = classList.includes('assistant') || classList.includes('ai') || 
                          classList.includes('response') || classList.includes('answer');
      
      if (isUser || isAssistant) {
        messages.push({
          role: isUser ? 'user' : 'assistant',
          content: text.substring(0, 500)
        });
      }
    });

    // If no messages found with class detection, try alternating pattern
    if (messages.length === 0) {
      const textBlocks = [];
      allElements.forEach(el => {
        const text = el.textContent?.trim() || '';
        if (text.length > 50 && text.length < 1000) {
          // Check if this is a leaf element (no children or only text)
          if (el.children.length === 0 || el.querySelector('p, span')) {
            textBlocks.push(text);
          }
        }
      });
      
      for (let i = 0; i < Math.min(textBlocks.length, 4); i++) {
        messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: textBlocks[i].substring(0, 500)
        });
      }
    }

    console.log('[GCCAI] Deepseek: Messages found:', messages.length);
    return messages;
  }

  function getCurrentConversationId() {
    const path = window.location.pathname;
    const match = path.match(/\/(chat|conversation|c)\/([a-f0-9-]+)/);
    return match ? match[2] : null;
  }

  function syncConversations() {
    const conversations = extractConversations();
    if (conversations.length === 0) return;

    const newHash = hashConversations(conversations);
    if (newHash === lastConversationsHash) return;

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

  function syncCurrentMessages() {
    const conversationId = getCurrentConversationId();
    if (!conversationId) return;

    const messages = extractMessages();
    if (messages.length === 0) return;

    chrome.runtime.sendMessage({
      type: 'UPDATE_MESSAGES',
      platform: PLATFORM,
      conversationId,
      messages
    });
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
    console.log('[GCCAI] Deepseek: Initial sync...');
    syncConversations();
    syncCurrentMessages();
  }, 3000);

  // Sync on navigation
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      console.log('[GCCAI] Deepseek: URL changed, syncing...');
      setTimeout(() => {
        syncConversations();
        syncCurrentMessages();
      }, 2000);
    }
  }, 1000);

  // Observe DOM changes
  const observer = new MutationObserver(debouncedSyncConversations);
  observer.observe(document.body, { childList: true, subtree: true });

  console.log('[GCCAI] Deepseek content script loaded');
})();
