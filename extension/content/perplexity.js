// Perplexity conversation list scraper - simplified DOM-only version
(function() {
  'use strict';

  const PLATFORM = 'perplexity';
  let knownConversationIds = new Set();

  function hashConversations(conversations) {
    return conversations.map(c => c.id).join(',');
  }
  let lastConversationsHash = '';

  function extractConversations() {
    const conversations = [];
    console.log('[GCCAI] Perplexity: Starting conversation extraction...');
    console.log('[GCCAI] Perplexity: Current URL:', window.location.href);

    // Log all links on the page for debugging
    const allLinks = document.querySelectorAll('a');
    console.log('[GCCAI] Perplexity: Total links found:', allLinks.length);

    // Find links that look like conversation links
    allLinks.forEach((link, index) => {
      const href = link.getAttribute('href') || '';
      const text = link.textContent?.trim() || '';
      
      // Log potential conversation links
      if (href.includes('/search/') || href.includes('/thread/') || 
          href.length > 30 || text.length > 10) {
        console.log(`[GCCAI] Perplexity: Link ${index}:`, { href: href.substring(0, 100), text: text.substring(0, 50) });
      }
    });

    // Try different URL patterns
    const patterns = [
      { regex: /\/search\/([a-f0-9-]+)/i, name: 'search' },
      { regex: /\/thread\/([a-f0-9-]+)/i, name: 'thread' },
      { regex: /\/c\/([a-f0-9-]+)/i, name: 'c' },
      { regex: /\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i, name: 'uuid' }
    ];

    allLinks.forEach(link => {
      const href = link.getAttribute('href') || '';
      const text = link.textContent?.trim() || '';
      
      if (!href || href === '/' || href === '#') return;
      if (href.startsWith('http') && !href.includes('perplexity.ai')) return;
      if (text.length < 3 || text.length > 200) return;

      for (const pattern of patterns) {
        const match = href.match(pattern.regex);
        if (match && match[1]) {
          const id = match[1];
          if (!conversations.some(c => c.id === id)) {
            console.log(`[GCCAI] Perplexity: Found conversation (${pattern.name}):`, { id, text: text.substring(0, 50) });
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

    console.log('[GCCAI] Perplexity: Total conversations found:', conversations.length);
    return conversations;
  }

  function extractMessages() {
    const messages = [];
    console.log('[GCCAI] Perplexity: Extracting messages...');

    // Find all text blocks that might be messages
    const allElements = document.querySelectorAll('div, p, section');
    
    allElements.forEach(el => {
      const text = el.textContent?.trim() || '';
      const classList = (el.className || '').toLowerCase();
      
      // Skip short text, navigation, etc
      if (text.length < 20 || text.length > 2000) return;
      if (classList.includes('nav') || classList.includes('sidebar') || 
          classList.includes('header') || classList.includes('footer')) return;
      if (el.closest('nav') || el.closest('aside') || el.closest('header')) return;
      
      // Check if this might be a message
      const isQuery = classList.includes('query') || classList.includes('question') || 
                      classList.includes('user') || classList.includes('prompt');
      const isAnswer = classList.includes('answer') || classList.includes('response') || 
                       classList.includes('prose') || classList.includes('ai');
      
      if (isQuery || isAnswer) {
        messages.push({
          role: isQuery ? 'user' : 'assistant',
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
          if (!el.querySelector('div') || el.children.length === 0) {
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

    console.log('[GCCAI] Perplexity: Messages found:', messages.length);
    return messages;
  }

  function getCurrentConversationId() {
    const path = window.location.pathname;
    const match = path.match(/\/(search|thread|c)\/([a-f0-9-]+)/) ||
                  path.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    return match ? (match[2] || match[1]) : null;
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
    console.log('[GCCAI] Perplexity: Initial sync...');
    syncConversations();
    syncCurrentMessages();
  }, 3000);

  // Sync on navigation
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      console.log('[GCCAI] Perplexity: URL changed, syncing...');
      setTimeout(() => {
        syncConversations();
        syncCurrentMessages();
      }, 2000);
    }
  }, 1000);

  // Observe DOM changes
  const observer = new MutationObserver(debouncedSyncConversations);
  observer.observe(document.body, { childList: true, subtree: true });

  console.log('[GCCAI] Perplexity content script loaded');
})();
