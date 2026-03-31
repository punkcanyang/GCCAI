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

    // Primary: Target DeepSeek's known DOM markers directly
    // .ds-markdown is the stable class for AI rendered responses
    const mdEls = Array.from(document.querySelectorAll('.ds-markdown'))
      .filter(el => !el.closest('nav, aside, header') && !el.parentElement?.closest('.ds-markdown'));

    if (mdEls.length > 0) {
      // Find chat container: lowest common ancestor of all .ds-markdown elements
      let chatContainer = mdEls[0].parentElement;
      for (let i = 1; i < mdEls.length; i++) {
        while (chatContainer && !chatContainer.contains(mdEls[i])) {
          chatContainer = chatContainer.parentElement;
        }
      }
      // For single-message conversations, walk up a few levels to capture user message
      if (mdEls.length === 1 && chatContainer) {
        for (let i = 0; i < 3 && chatContainer.parentElement && chatContainer.parentElement !== document.body; i++) {
          chatContainer = chatContainer.parentElement;
        }
      }

      if (chatContainer && chatContainer !== document.body) {
        // User messages: [dir="auto"] within chat container, not inside .ds-markdown
        const userEls = Array.from(chatContainer.querySelectorAll('[dir="auto"]'))
          .filter(el => {
            if (el.closest('.ds-markdown')) return false;
            if (el.querySelector('.ds-markdown')) return false;
            if (el.querySelector('[dir="auto"]')) return false;
            const text = el.textContent?.trim() || '';
            return text.length >= 2;
          });

        // Combine and sort by document order
        const candidates = [
          ...mdEls.map(el => ({ el, role: 'assistant' })),
          ...userEls.map(el => ({ el, role: 'user' }))
        ].sort((a, b) => {
          const pos = a.el.compareDocumentPosition(b.el);
          if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });

        // Deduplicate by content prefix and collect
        const seen = new Set();
        candidates.forEach(({ el, role }) => {
          const text = el.textContent?.trim() || '';
          if (text.length < 2) return;
          const key = text.substring(0, 200);
          if (seen.has(key)) return;
          seen.add(key);
          messages.push({ role, content: text.substring(0, 500) });
        });
      }
    }

    // Fallback: generic heuristic if targeted approach found nothing
    if (messages.length === 0) {
      const allElements = document.querySelectorAll('div, p, section, article');
      const textBlocks = [];
      allElements.forEach(el => {
        const text = el.textContent?.trim() || '';
        if (text.length > 50 && text.length < 1000) {
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
    - AI responses are identified by `.ds-markdown` class (targeted querySelectorAll, not broad iteration).
    - User messages are identified by `[dir="auto"]` scoped within the chat container (LCA of .ds-markdown elements) to avoid sidebar false positives.
    - Deduplication uses first 200 chars of text as key.
2.  Potential edge cases to watch:
    - DeepSeek may change `.ds-markdown` to completely generic hashes. In that case, the fallback heuristic kicks in.
    - Single-message conversations: chat container is found by walking up 3 levels from the .ds-markdown parent.
    - `[dir="auto"]` within the chat container could still match non-message elements (e.g., thinking blocks). Filter by `!el.querySelector('[dir="auto"]')` takes the deepest match only.
    - DeepSeek's SSR/SPA routing may swallow `window.location.href` mutation events; keep the `setInterval` robust.
3.  Dependencies on other modules:
    - Depends on `chrome.runtime.sendMessage` communicating with `background.js` and adhering to `UPDATE_CONVERSATIONS` & `UPDATE_MESSAGES` typings.
*/
