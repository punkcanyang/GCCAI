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

  // Intercept fetch requests to capture conversation timestamps
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    
    // Check if this is a batchexecute request
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (url && url.includes('batchexecute')) {
      try {
        // Clone response to read it without consuming
        const clonedResponse = response.clone();
        const text = await clonedResponse.text();
        
        // Parse the response to extract conversation IDs and timestamps
        parseGeminiResponse(text, url);
      } catch (e) {
        console.error('[GCCAI] Gemini API intercept error:', e);
      }
    }
    
    return response;
  };

  // Also intercept XMLHttpRequest for older implementations
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
          const text = this.responseText;
          parseGeminiResponse(text, this._gccaiUrl);
        } catch (e) {
          console.error('[GCCAI] Gemini XHR intercept error:', e);
        }
      }
    });
    return originalXHRSend.apply(this, args);
  };

  // Parse Gemini's internal API response
  function parseGeminiResponse(text) {
    // Gemini returns data in a nested array format
    // Look for patterns like: ["conversation_id", "title", timestamp]
    
    // Pattern 1: 10-digit Unix timestamps (seconds)
    const timestampPattern1 = /(\d{10})/g;
    // Pattern 2: 13-digit Unix timestamps (milliseconds)
    const timestampPattern2 = /(\d{13})/g;
    
    // Find all potential conversation IDs and timestamps
    // Gemini IDs are typically alphanumeric strings
    const idPattern = /c_[a-f0-9]{12,}/gi;
    
    const ids = text.match(idPattern) || [];
    const timestamps10 = text.match(timestampPattern1) || [];
    const timestamps13 = text.match(timestampPattern2) || [];
    
    // Convert timestamps to milliseconds
    const allTimestamps = [
      ...timestamps10.map(t => parseInt(t) * 1000),
      ...timestamps13.map(t => parseInt(t))
    ].filter(t => t > 1600000000000 && t < Date.now() + 86400000); // Valid range
    
    // Try to match IDs with timestamps based on position
    // This is a heuristic approach since Gemini's format is complex
    if (ids.length > 0 && allTimestamps.length > 0) {
      // Store timestamps for each ID
      ids.forEach((id, index) => {
        if (index < allTimestamps.length) {
          conversationTimestamps.set(id, allTimestamps[index]);
        }
      });
      
      // Also try to find timestamp near each ID in the text
      ids.forEach(id => {
        const idIndex = text.indexOf(id);
        if (idIndex !== -1) {
          // Look for timestamp within 200 characters after the ID
          const nearbyText = text.substring(idIndex, idIndex + 200);
          const nearbyTs = nearbyText.match(/(\d{10,13})/);
          if (nearbyTs) {
            let ts = parseInt(nearbyTs[1]);
            if (ts < 1000000000000) ts *= 1000; // Convert to ms if needed
            if (ts > 1600000000000 && ts < Date.now() + 86400000) {
              conversationTimestamps.set(id, ts);
            }
          }
        }
      });
    }
    
    console.log('[GCCAI] Gemini parsed', conversationTimestamps.size, 'conversation timestamps');
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
