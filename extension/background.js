// Background service worker
// Manages conversation data from all platforms using IndexedDB

// Import database module
importScripts('db.js');

// All supported platforms
const PLATFORMS = ['chatgpt', 'claude', 'gemini', 'grok', 'perplexity', 'deepseek'];

// Listen for messages from content scripts and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // From content scripts
  if (message.type === 'UPDATE_CONVERSATIONS') {
    handleConversationUpdate(message.platform, message.conversations)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'DELETE_CONVERSATIONS') {
    handleDeleteConversations(message.platform, message.conversationIds)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'UPDATE_MESSAGES') {
    handleMessagesUpdate(message.platform, message.conversationId, message.messages)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // From side panel or full page
  if (message.type === 'GET_CONVERSATIONS') {
    getAllConversations()
      .then(sendResponse)
      .catch(err => sendResponse([]));
    return true;
  }

  if (message.type === 'GET_MESSAGES') {
    getMessages(message.platform, message.conversationId)
      .then(sendResponse)
      .catch(err => sendResponse([]));
    return true;
  }

  if (message.type === 'GET_CONVERSATION_PREVIEWS') {
    getConversationPreviews(message.platform)
      .then(sendResponse)
      .catch(err => sendResponse({}));
    return true;
  }

  if (message.type === 'SEARCH_MESSAGES') {
    searchMessages(message.query)
      .then(sendResponse)
      .catch(err => sendResponse([]));
    return true;
  }

  if (message.type === 'OPEN_CONVERSATION') {
    openConversation(message.url, message.platform, message.background);
    sendResponse({ success: true });
  }

  if (message.type === 'OPEN_FULLPAGE') {
    openFullPage();
    sendResponse({ success: true });
  }

  if (message.type === 'CLEAR_CACHE') {
    clearAllCache()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Folder operations
  if (message.type === 'GET_FOLDERS') {
    getAllFolders()
      .then(sendResponse)
      .catch(err => sendResponse([]));
    return true;
  }

  if (message.type === 'CREATE_FOLDER') {
    createFolder(message.name)
      .then(folder => {
        notifyViews();
        sendResponse({ success: true, folder });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'UPDATE_FOLDER') {
    updateFolder(message.folderId, message.name)
      .then(() => {
        notifyViews();
        sendResponse({ success: true });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'DELETE_FOLDER') {
    deleteFolder(message.folderId)
      .then(() => {
        notifyViews();
        sendResponse({ success: true });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'MOVE_TO_FOLDER') {
    moveConversationToFolder(message.conversationId, message.folderId)
      .then(() => {
        notifyViews();
        sendResponse({ success: true });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'GET_CONVERSATIONS_BY_FOLDER') {
    getConversationsByFolder(message.folderId)
      .then(sendResponse)
      .catch(err => sendResponse([]));
    return true;
  }
});

// Store conversations (safe mode - no deletion)
async function handleConversationUpdate(platform, conversations) {
  await saveConversations(platform, conversations);

  // Notify all views
  const allConversations = await getAllConversations();
  chrome.runtime.sendMessage({
    type: 'CONVERSATIONS_UPDATED',
    conversations: allConversations
  }).catch(() => {});
}

// Notify all views about data changes
async function notifyViews() {
  const allConversations = await getAllConversations();
  const folders = await getAllFolders();
  chrome.runtime.sendMessage({
    type: 'DATA_UPDATED',
    conversations: allConversations,
    folders
  }).catch(() => {});
}

// Handle deletion of conversations
async function handleDeleteConversations(platform, conversationIds) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['conversations', 'messages'], 'readwrite');
    const convStore = tx.objectStore('conversations');
    const msgStore = tx.objectStore('messages');

    conversationIds.forEach(id => {
      convStore.delete(id);
      // Fast path: get all primary keys to delete, avoiding cursor overhead
      const index = msgStore.index('conversationKey');
      const range = IDBKeyRange.only([platform, id]);
      const keysRequest = index.getAllKeys(range);
      
      keysRequest.onsuccess = (event) => {
        const keys = event.target.result || [];
        keys.forEach(key => msgStore.delete(key));
      };
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Store messages for a conversation and update last synced time
async function handleMessagesUpdate(platform, conversationId, messages) {
  await saveMessages(platform, conversationId, messages);
  // Update the conversation's last synced time to now
  await updateConversationLastSynced(platform, conversationId);
  // Also update "platform last change time" so sorting doesn't wait for the sidebar scrape.
  await updateConversationLastUpdated(platform, conversationId);

  // Notify all views
  chrome.runtime.sendMessage({
    type: 'MESSAGES_UPDATED',
    platform,
    conversationId,
    messages
  }).catch(() => {});
}

// Open a conversation in the correct tab
async function openConversation(url, platform, background = false) {
  const patterns = {
    chatgpt: ['chatgpt.com', 'chat.openai.com'],
    claude: ['claude.ai'],
    gemini: ['gemini.google.com'],
    grok: ['grok.com', 'www.grok.com', 'grok.x.com', 'x.ai'],
    perplexity: ['www.perplexity.ai'],
    deepseek: ['chat.deepseek.com']
  };

  const platformPatterns = patterns[platform] || [];

  // Find existing tab for this platform
  for (const pattern of platformPatterns) {
    const tabs = await chrome.tabs.query({ url: `*://${pattern}/*` });
    if (tabs.length > 0) {
      if (background) {
        // Update URL but don't activate the tab
        await chrome.tabs.update(tabs[0].id, { url, active: false });
      } else {
        await chrome.tabs.update(tabs[0].id, { url, active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
      }
      return;
    }
  }

  // Open new tab
  await chrome.tabs.create({ url, active: !background });
}

// Open full page view
async function openFullPage() {
  const fullpageUrl = chrome.runtime.getURL('fullpage/index.html');
  
  // Check if already open
  const tabs = await chrome.tabs.query({ url: fullpageUrl });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: fullpageUrl });
  }
}

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-fullpage',
    title: '打开全视窗模式',
    contexts: ['action']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'open-fullpage') {
    openFullPage();
  }
});

// Open side panel when clicking extension icon
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

console.log('[GCCAI] Background service worker started');
