// Claude conversation list scraper with API interception
(function() {
  'use strict';

  const PLATFORM = 'claude';
  let knownConversationIds = new Set();
  let conversationTimestamps = new Map();

  function hashConversations(conversations) {
    return conversations.map(c => c.id).join(',');
  }
  let lastConversationsHash = '';

  // Intercept fetch requests
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (url && (url.includes('/api/organizations') || url.includes('/chat_conversations'))) {
      try {
        const clonedResponse = response.clone();
        const data = await clonedResponse.json();
        parseClaudeResponse(data);
      } catch (e) {}
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
      if (this._gccaiUrl && (this._gccaiUrl.includes('/api/organizations') || this._gccaiUrl.includes('/chat_conversations'))) {
        try {
          const data = JSON.parse(this.responseText);
          parseClaudeResponse(data);
        } catch (e) {}
      }
    });
    return originalXHRSend.apply(this, args);
  };

  // Parse Claude API response
  function parseClaudeResponse(data) {
    if (!data) return;
    
    // Claude returns conversations in various formats
    const conversations = data.chat_conversations || data.conversations || 
                        (Array.isArray(data) ? data : []);
    
    conversations.forEach(conv => {
      if (conv.uuid || conv.id) {
        const id = conv.uuid || conv.id;
        // Claude uses updated_at in ISO format or Unix timestamp
        let timestamp = null;
        
        if (conv.updated_at) {
          timestamp = typeof conv.updated_at === 'string' 
            ? Date.parse(conv.updated_at) 
            : (conv.updated_at < 1000000000000 ? conv.updated_at * 1000 : conv.updated_at);
        } else if (conv.created_at) {
          timestamp = typeof conv.created_at === 'string' 
            ? Date.parse(conv.created_at) 
            : (conv.created_at < 1000000000000 ? conv.created_at * 1000 : conv.created_at);
        }
        
        if (timestamp && timestamp > 1600000000000) {
          conversationTimestamps.set(id, timestamp);
        }
      }
    });
    
    console.log('[GCCAI] Claude parsed', conversationTimestamps.size, 'conversation timestamps');
  }

  function extractConversations() {
    const conversations = [];

    const links = document.querySelectorAll('a[href*="/chat/"]');

    links.forEach(link => {
      const href = link.getAttribute('href');
      if (!href || !href.includes('/chat/')) return;
      
      let title = '';
      const titleEl = link.querySelector('[class*="title"]') || 
                      link.querySelector('span') ||
                      link.querySelector('div');
      title = titleEl?.textContent?.trim() || link.textContent?.trim() || '';
      title = title.replace(/\s+/g, ' ').trim();
      
      const match = href.match(/\/chat\/([a-f0-9-]+)/);
      const id = match ? match[1] : null;

      if (id && title && title.length > 0) {
        if (!conversations.some(c => c.id === id)) {
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
      }
    });

    return conversations;
  }

  function extractMessages() {
    const messages = [];

    // Claude message containers - try multiple approaches
    // Approach 1: Look for conversation turns
    const turns = document.querySelectorAll('[data-testid*="conversation-turn"], [class*="conversation-turn"], [class*="turn"]');
    
    for (const turn of turns) {
      if (turn.textContent?.length < 10) continue;
      
      // Determine role from the turn container
      let role = 'unknown';
      const turnClass = (turn.className || '').toLowerCase();
      const turnTestId = (turn.getAttribute('data-testid') || '').toLowerCase();
      
      if (turnClass.includes('user') || turnTestId.includes('user') || turnClass.includes('human')) {
        role = 'user';
      } else if (turnClass.includes('assistant') || turnTestId.includes('assistant') || turnClass.includes('claude')) {
        role = 'assistant';
      }
      
      // If role still unknown, check child elements
      if (role === 'unknown') {
        const userIndicator = turn.querySelector('[class*="user"], [class*="human"]');
        const assistantIndicator = turn.querySelector('[class*="assistant"], [class*="claude"], [class*="response"]');
        
        if (userIndicator) role = 'user';
        else if (assistantIndicator) role = 'assistant';
      }
      
      // Get the message content
      const contentEl = turn.querySelector('[class*="content"], [class*="text"], [class*="markdown"], p');
      const content = contentEl?.textContent?.trim() || turn.textContent?.trim() || '';

      if (content && (role === 'user' || role === 'assistant') && content.length > 5) {
        messages.push({
          role,
          content: content.substring(0, 500)
        });
      }
    }
    
    // Approach 2: If no turns found, try to find messages directly
    if (messages.length === 0) {
      const allElements = document.querySelectorAll('div, article, section');
      const textBlocks = [];
      
      for (const el of allElements) {
        const text = el.textContent?.trim() || '';
        if (text.length < 20 || text.length > 2000) continue;
        
        const classList = (el.className || '').toLowerCase();
        if (classList.includes('sidebar') || classList.includes('nav') || 
            classList.includes('header') || classList.includes('footer') ||
            classList.includes('button') || classList.includes('input')) {
          continue;
        }
        
        // Skip if this is a container element
        if (el.querySelector('[class*="message"], [class*="turn"]')) continue;
        
        // Skip if parent already processed
        let isChild = false;
        for (const block of textBlocks) {
          if (block.element.contains(el)) {
            isChild = true;
            break;
          }
        }
        if (isChild) continue;
        
        textBlocks.push({
          element: el,
          text: text,
          classList: classList
        });
      }
      
      // Assign roles based on position and class hints
      for (let i = 0; i < textBlocks.length; i++) {
        const block = textBlocks[i];
        let role = 'unknown';
        
        if (block.classList.includes('user') || block.classList.includes('human')) {
          role = 'user';
        } else if (block.classList.includes('assistant') || block.classList.includes('claude') || block.classList.includes('response')) {
          role = 'assistant';
        } else {
          // Alternate based on position
          role = i % 2 === 0 ? 'user' : 'assistant';
        }
        
        messages.push({
          role,
          content: block.text.substring(0, 500)
        });
      }
    }

    return messages;
  }

  function getCurrentConversationId() {
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  function syncConversations() {
    const conversations = extractConversations();
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

  const messageArea = document.querySelector('main, [class*="conversation"]');
  if (messageArea) {
    const messageObserver = new MutationObserver((mutations) => {
      const hasNewMessages = mutations.some(m => m.type === 'childList' && m.addedNodes.length > 0);
      if (hasNewMessages) debouncedSyncMessages();
    });
    messageObserver.observe(messageArea, { childList: true, subtree: true });
  }

  console.log('[GCCAI] Claude content script loaded with API interception');
})();
