// Deepseek conversation list scraper - simplified DOM-only version
(function() {
  'use strict';

  const PLATFORM = 'deepseek';
  let knownConversationIds = new Set();

  function hashConversations(conversations) {
    return conversations.map(c => c.id).join(',');
  }
  let lastConversationsHash = '';

  // Convert DeepSeek group label to an ISO date string (best approximation)
  // Labels: "30 天内" → today's date, "2025-12" → "2025-12-01", etc.
  function groupLabelToDate(label) {
    if (!label) return null;
    const monthMatch = label.match(/^(\d{4})-(\d{2})$/);
    if (monthMatch) {
      return `${monthMatch[1]}-${monthMatch[2]}-01`;
    }
    // "30 天内" or any other recent label → use today
    if (/天内|今天|yesterday|recent/i.test(label)) {
      return new Date().toISOString().slice(0, 10);
    }
    return null;
  }

  function extractConversations() {
    const conversations = [];
    console.log('[GCCAI] Deepseek: Starting conversation extraction...');

    // DeepSeek URL pattern: /a/chat/s/{UUID}
    // Sidebar structure: ._3098d02 > .f3d18f6a (group label) + a[href^="/a/chat/s/"]
    const links = document.querySelectorAll('a[href^="/a/chat/s/"]');
    console.log('[GCCAI] Deepseek: Chat links found:', links.length);

    links.forEach(link => {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/a\/chat\/s\/([a-zA-Z0-9-_]+)/);
      if (!match) return;

      const id = match[1];
      if (conversations.some(c => c.id === id)) return;

      const title = link.textContent?.trim() || 'Untitled';
      if (title.length < 1 || title.length > 200) return;

      // Get the month/year group label from the nearest ._3098d02 ancestor
      const groupLabel = link.closest('._3098d02')?.querySelector('.f3d18f6a')?.textContent?.trim() || null;
      const lastUpdated = groupLabelToDate(groupLabel);

      console.log('[GCCAI] Deepseek: Found conversation:', { id, title: title.substring(0, 50), groupLabel, lastUpdated });
      const conv = {
        id,
        platform: PLATFORM,
        title,
        url: window.location.origin + href,
      };
      if (lastUpdated) conv.lastUpdated = Date.parse(lastUpdated) || undefined;
      conversations.push(conv);
    });

    console.log('[GCCAI] Deepseek: Total conversations found:', conversations.length);
    return conversations;
  }

  function extractMessages() {
    const messages = [];
    console.log('[GCCAI] Deepseek: Extracting messages...');

    // AI responses: .ds-markdown (exclude nested / nav elements)
    const mdEls = Array.from(document.querySelectorAll('.ds-markdown'))
      .filter(el => !el.closest('nav, aside, header') && !el.parentElement?.closest('.ds-markdown'));

    if (mdEls.length > 0) {
      // Find lowest common ancestor of all .ds-markdown elements
      let chatContainer = mdEls[0].parentElement;
      for (let i = 1; i < mdEls.length; i++) {
        while (chatContainer && !chatContainer.contains(mdEls[i])) {
          chatContainer = chatContainer.parentElement;
        }
      }
      if (mdEls.length === 1 && chatContainer) {
        for (let i = 0; i < 3 && chatContainer.parentElement && chatContainer.parentElement !== document.body; i++) {
          chatContainer = chatContainer.parentElement;
        }
      }

      if (chatContainer && chatContainer !== document.body) {
        // User messages: .d29f3d7d.ds-message > .fbb737a4 (direct text container, no [dir="auto"])
        const userEls = Array.from(chatContainer.querySelectorAll('.d29f3d7d.ds-message .fbb737a4'))
          .filter(el => {
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

    // Fallback if nothing found
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
    // DeepSeek URL: /a/chat/s/{UUID}
    const match = window.location.pathname.match(/\/a\/chat\/s\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  function syncConversations() {
    try {
      const conversations = extractConversations();
      if (conversations.length === 0) return;

      const newHash = hashConversations(conversations);
      if (newHash === lastConversationsHash) return;

      lastConversationsHash = newHash;
      const currentIds = new Set(conversations.map(c => c.id));
      currentIds.forEach(id => knownConversationIds.add(id));

      chrome.runtime.sendMessage({
        type: 'UPDATE_CONVERSATIONS',
        platform: PLATFORM,
        conversations
      });
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

  // Sync on navigation and virtual list updates
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      console.log('[GCCAI] Deepseek: URL changed, syncing...');
      setTimeout(() => {
        syncCurrentMessages();
      }, 2000);
    }
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
    - DeepSeek chat URLs follow the pattern `/a/chat/s/{UUID}`.
    - AI responses are identified by `.ds-markdown` (stable class).
    - User messages are identified by `.d29f3d7d.ds-message .fbb737a4` — DeepSeek does NOT use [dir="auto"] on user messages; text is a direct text node inside .fbb737a4.
    - Conversation time is sourced from the sidebar group label (.f3d18f6a inside ._3098d02). Labels are "30 天内" (within 30 days → today's date) or "YYYY-MM" (→ first day of that month). No per-conversation precise timestamp is exposed in the DOM.
    - Sidebar structure: a[href^="/a/chat/s/"] links inside ._3098d02 groups, each group has a .f3d18f6a label.
2.  Potential edge cases:
    - DeepSeek may rename hashed class names (.d29f3d7d, .fbb737a4, ._3098d02, .f3d18f6a). If parsing breaks, check these selectors first.
    - Virtual list: only visible items are in the DOM. The setInterval keeps scanning as the user scrolls.
    - Single-message conversations: chat container walked up 3 levels from .ds-markdown parent.
3.  Dependencies:
    - Depends on chrome.runtime.sendMessage → background.js → UPDATE_CONVERSATIONS / UPDATE_MESSAGES typings.
*/
