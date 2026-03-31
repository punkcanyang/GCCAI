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
      { regex: /\/chat\/([a-zA-Z0-9-_]+)/i, name: 'chat' },
      { regex: /\/conversation\/([a-zA-Z0-9-_]+)/i, name: 'conversation' },
      { regex: /\/c\/([a-zA-Z0-9-_]+)/i, name: 'c' },
      { regex: /\/s\/([a-zA-Z0-9-_]+)/i, name: 's' }
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
      const className = typeof el.className === 'string' ? el.className.toLowerCase() : '';
      
      // Skip short text, navigation, etc
      if (text.length < 20 || text.length > 2000) return;
      if (className.includes('nav') || className.includes('sidebar') || 
          className.includes('header') || className.includes('footer') ||
          className.includes('button')) return;
      if (el.closest('nav') || el.closest('aside') || el.closest('header')) return;
      
      // Check if this might be a message
      let isUser = className.includes('user') || className.includes('human') || className.includes('query') || className.includes('prompt');
      let isAssistant = className.includes('assistant') || className.includes('ai') || className.includes('response') || className.includes('answer');
      
      // Structural heuristics for DeepSeek (since classes are often obfuscated)
      if (!isUser && !isAssistant) {
        // Only target the specific element, avoid using querySelector to prevent capturing top-level wrappers containing sidemenus
        if (className.includes('ds-markdown') || className.includes('markdown')) {
          isAssistant = true;
        } else if (el.hasAttribute('dir') && el.getAttribute('dir') === 'auto') {
          isUser = true;
        }
      }
      
      if (isUser || isAssistant) {
        const truncatedContent = text.substring(0, 500);
        // Deduplicate messages with exact same content prefix
        if (!messages.some(m => m.content === truncatedContent)) {
          messages.push({
            role: isUser ? 'user' : 'assistant',
            content: truncatedContent
          });
        }
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
    const match = path.match(/\/(chat|conversation|c|s)\/([a-zA-Z0-9-_]+)/);
    return match ? match[2] : null;
  }

  function syncConversations() {
    try {
      const conversations = extractConversations();
      if (conversations.length === 0) return;

      const newHash = hashConversations(conversations);
      if (newHash === lastConversationsHash) return;

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
    } catch (e) {
      console.error('[GCCAI] Deepseek syncConversations error:', e);
    }
  }

  function syncCurrentMessages() {
    try {
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
    } catch (e) {
      console.error('[GCCAI] Deepseek syncCurrentMessages error:', e);
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
        syncCurrentMessages();
      }, 2000);
    }
    // DeepSeek uses virtual lists which disappear off-screen. We must periodically sync what enters the screen.
    syncConversations();
  }, 1500);

  // Observe DOM changes
  const observer = new MutationObserver(debouncedSyncConversations);
  observer.observe(document.body, { childList: true, subtree: true });

  console.log('[GCCAI] Deepseek content script loaded');
})();

/*
[For Future AI]
1.  Key assumptions made: 
    - Assuming DeepSeek chat URLs conform to `/\/([a-zA-Z0-9-_]+)$/` patterns like `/chat/s/ab12cd...`.
    - Assuming messages match `.ds-markdown` for AI responses, or `dir="auto"` / text leaves for User prompts.
    - Assumes the user wants identical messages deduplicated by exact match of the first 500 characters.
2.  Potential edge cases to watch: 
    - DeepSeek may change `.ds-markdown` to completely generic hashes. In that case, we need to inspect inline styles or node depth logic.
    - DeepSeek's SSR/SPA routing may swallow `window.location.href` mutation events; keep the `setInterval` robust.
    - If user messages start having `.ds-markdown` class, the scraper will think they are AI. 
3.  Dependencies on other modules: 
    - Depends on `chrome.runtime.sendMessage` communicating with `background.js` and adhering to `UPDATE_CONVERSATIONS` & `UPDATE_MESSAGES` typings.
*/
