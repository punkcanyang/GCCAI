// Gemini conversation list scraper with API interception
(function() {
  'use strict';

  const PLATFORM = 'gemini';
  let knownConversationIds = new Set();
  let conversationTimestamps = new Map(); // Store real timestamps from API

  function hashConversations(conversations) {
    return conversations.map(c => c.id).join(',');
  }
  let lastConversationsHash = '';

  // Intercept fetch requests to capture conversation timestamps from qpEbW RPC.
  // qpEbW fires on every conversation load. Response structure:
  //   [[[entry, ...], convId]]
  //   entry = [[type], flag, status, [unix_sec, nanosec], count1, count2]
  // The conv ID in the response matches the hex ID in the page URL (/app/{id}).
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);

    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (url && url.includes('batchexecute')) {
      try {
        const rpc = (url.match(/rpcids=([^&]+)/) || [])[1];
        if (rpc === 'qpEbW') {
          const clonedResponse = response.clone();
          const text = await clonedResponse.text();
          parseGeminiQpEbW(text, url);
        }
      } catch (e) {
        console.error('[GCCAI] Gemini API intercept error:', e);
      }
    }

    return response;
  };

  // Also intercept XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._gccaiUrl = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      if (this._gccaiUrl && this._gccaiUrl.includes('batchexecute')) {
        try {
          const rpc = (this._gccaiUrl.match(/rpcids=([^&]+)/) || [])[1];
          if (rpc === 'qpEbW') parseGeminiQpEbW(this.responseText, this._gccaiUrl);
        } catch (e) {
          console.error('[GCCAI] Gemini XHR intercept error:', e);
        }
      }
    });
    return originalXHRSend.apply(this, args);
  };

  // Parse qpEbW response to extract the last-modified timestamp for the current conversation.
  // URL contains source-path=%2Fapp%2F{convId} which gives us the conversation ID.
  function parseGeminiQpEbW(text, url) {
    // Extract conversation ID from request URL (source-path=/app/{hexId})
    const pathMatch = url && url.match(/source-path=%2Fapp%2F([a-f0-9]+)/i);
    if (!pathMatch) return;
    const convId = pathMatch[1];

    // Extract the JSON payload from batchexecute envelope:
    // )]}'  <newline>  <length>  <newline>  [["wrb.fr","qpEbW","<escaped-json>",...]...]
    const match = text.match(/\["wrb\.fr","qpEbW","([\s\S]+?)",null/);
    if (!match) return;

    try {
      const inner = JSON.parse('"' + match[1] + '"'); // unescape
      const parsed = JSON.parse(inner); // [[entries...], convId]
      const entries = parsed[0];
      if (!Array.isArray(entries)) return;

      // Each entry: [[type], flag, status, [unix_sec, nanosec], ...]
      // Take the maximum unix_sec across all entries as the last-updated time.
      let maxSec = 0;
      entries.forEach(entry => {
        const tsArr = entry[3];
        if (Array.isArray(tsArr) && typeof tsArr[0] === 'number') {
          if (tsArr[0] > maxSec) maxSec = tsArr[0];
        }
      });

      if (maxSec > 1600000000) {
        conversationTimestamps.set(convId, maxSec * 1000);
        console.log('[GCCAI] Gemini qpEbW timestamp for', convId, ':', new Date(maxSec * 1000).toISOString());
      }
    } catch (e) {
      console.error('[GCCAI] Gemini qpEbW parse error:', e);
    }
  }

  function extractConversations() {
    const conversations = [];

    // Gemini conversation links in sidebar
    const links = document.querySelectorAll('a[href*="/app/"]');

    links.forEach(link => {
      const href = link.getAttribute('href');
      const title = link.textContent?.trim() || 'Untitled';
      const match = href.match(/\/app\/([a-f0-9]+)/);
      const id = match ? match[1] : null;

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

    const messageElements = document.querySelectorAll('[class*="query-text"], [class*="response-text"]');

    messageElements.forEach(el => {
      const role = el.classList.contains('query-text') ? 'user' : 'assistant';
      const content = el.textContent?.trim() || '';

      if (content) {
        messages.push({
          role,
          content: content.substring(0, 500)
        });
      }
    });

    return messages;
  }

  function getCurrentConversationId() {
    const match = window.location.pathname.match(/\/app\/([a-f0-9]+)/);
    return match ? match[1] : null;
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
  const sidebar = document.querySelector('[class*="sidebar"], [class*="conversation-list"], nav');
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

  // Sync messages when conversation content changes
  const messageArea = document.querySelector('main, [class*="conversation"], [class*="chat"]');
  if (messageArea) {
    const messageObserver = new MutationObserver((mutations) => {
      const hasNewMessages = mutations.some(m => m.type === 'childList' && m.addedNodes.length > 0);
      if (hasNewMessages) debouncedSyncMessages();
    });
    messageObserver.observe(messageArea, { childList: true, subtree: true });
  }

  console.log('[GCCAI] Gemini content script loaded with API interception');
})();
