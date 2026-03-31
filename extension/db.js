// IndexedDB storage layer for GCCAI
const DB_NAME = 'gccai';
const DB_VERSION = 2;

let db = null;

// Open database
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      const oldVersion = event.oldVersion;

      // Conversations store
      if (!database.objectStoreNames.contains('conversations')) {
        const convStore = database.createObjectStore('conversations', { keyPath: 'id' });
        convStore.createIndex('platform', 'platform', { unique: false });
        convStore.createIndex('lastSynced', 'lastSynced', { unique: false });
        convStore.createIndex('folderId', 'folderId', { unique: false });
      } else if (oldVersion < 2) {
        // Add folderId index to existing conversations store
        const convStore = event.target.transaction.objectStore('conversations');
        if (!convStore.indexNames.contains('folderId')) {
          convStore.createIndex('folderId', 'folderId', { unique: false });
        }
      }

      // Messages store
      if (!database.objectStoreNames.contains('messages')) {
        const msgStore = database.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
        msgStore.createIndex('conversationKey', ['platform', 'conversationId'], { unique: false });
        msgStore.createIndex('platform', 'platform', { unique: false });
        msgStore.createIndex('content', 'content', { unique: false });
      }

      // Folders store (new in v2)
      if (!database.objectStoreNames.contains('folders')) {
        const folderStore = database.createObjectStore('folders', { keyPath: 'id' });
        folderStore.createIndex('name', 'name', { unique: false });
        folderStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

// Generic transaction helper
async function transaction(storeNames, mode, callback) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeNames, mode);
    // Support single store name as string for backward compatibility
    if (!(storeNames instanceof Array)) {
      storeNames = [storeNames];
    }
    const stores = {};
    storeNames.forEach(name => {
      stores[name] = tx.objectStore(name);
    });
    const result = callback(stores, tx);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

// ========== Conversations ==========

// Update or add conversations (safe mode - no deletion)
async function saveConversations(platform, conversations) {
  return transaction('conversations', 'readwrite', async (stores) => {
    const store = stores.conversations;

    // Add or update conversations only
    for (const conv of conversations) {
      const existing = await new Promise((resolve, reject) => {
        const getRequest = store.get(conv.id);
        getRequest.onsuccess = () => resolve(getRequest.result);
        getRequest.onerror = () => reject(getRequest.error);
      });
      
      // Preserve existing lastUpdated if new one is not provided
      const lastUpdated = conv.lastUpdated !== undefined 
        ? conv.lastUpdated 
        : (existing?.lastUpdated || Date.now());
      
      store.put({
        ...(existing || {}),
        ...conv,
        platform,
        lastUpdated,
        lastSynced: Date.now()
      });
    }
  });
}

// Update conversation's lastSynced timestamp
async function updateConversationLastSynced(platform, conversationId, timestamp = Date.now()) {
  return transaction('conversations', 'readwrite', async (stores) => {
    const store = stores.conversations;
    const existing = await new Promise((resolve, reject) => {
      const getRequest = store.get(conversationId);
      getRequest.onsuccess = () => resolve(getRequest.result);
      getRequest.onerror = () => reject(getRequest.error);
    });
    
    if (existing) {
      store.put({
        ...existing,
        lastSynced: timestamp
      });
    }
  });
}

// Update conversation's lastUpdated timestamp (best-effort "platform last change time")
async function updateConversationLastUpdated(platform, conversationId, timestamp = Date.now()) {
  return transaction('conversations', 'readwrite', async (stores) => {
    const store = stores.conversations;
    const existing = await new Promise((resolve, reject) => {
      const getRequest = store.get(conversationId);
      getRequest.onsuccess = () => resolve(getRequest.result);
      getRequest.onerror = () => reject(getRequest.error);
    });

    // Always update lastUpdated when messages are fetched
    // This reflects when the conversation was actually accessed
    if (existing) {
      store.put({
        ...existing,
        lastUpdated: timestamp
      });
    }
  });
}

// Sync conversations with deletion detection
// Sync conversations with deletion detection
// Call this when you're confident the list is complete
async function syncConversationsWithDeletion(platform, conversations) {
  return transaction(['conversations', 'messages'], 'readwrite', async (stores) => {
    const store = stores.conversations;
    const msgStore = stores.messages;
    const index = store.index('platform');
    const request = index.getAll(platform);

    const existing = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    const existingIds = new Set(existing.map(c => c.id));
    const newIds = new Set(conversations.map(c => c.id));

    // Diff on any non-empty scraping result
    const isSubstantialList = conversations.length > 0;
    
    if (isSubstantialList) {
      // Delete conversations that no longer exist
      for (const conv of existing) {
        if (!newIds.has(conv.id)) {
          store.delete(conv.id);
          // Also delete associated messages inside same transaction without nested global transactions
          const msgIndex = msgStore.index('conversationKey');
          const range = IDBKeyRange.only([platform, conv.id]);
          const cursorRequest = msgIndex.openCursor(range);
          cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              msgStore.delete(cursor.primaryKey);
              cursor.continue();
            }
          };
        }
      }
    }

    // Add or update conversations
    for (const conv of conversations) {
      const existingRecord = await new Promise((resolve, reject) => {
        const getRequest = store.get(conv.id);
        getRequest.onsuccess = () => resolve(getRequest.result);
        getRequest.onerror = () => reject(getRequest.error);
      });
      
      store.put({
        ...(existingRecord || {}),
        ...conv,
        platform,
        lastSynced: Date.now()
      });
    }
  });
}

async function getAllConversations() {
  return transaction('conversations', 'readonly', (stores) => {
    const store = stores.conversations;
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const conversations = request.result;
        // Group by platform
        const grouped = {
          chatgpt: [],
          claude: [],
          gemini: [],
          grok: [],
          perplexity: [],
          deepseek: []
        };
        conversations.forEach(conv => {
          if (grouped[conv.platform]) {
            grouped[conv.platform].push(conv);
          }
        });
        // Sort by platform last change time (best-effort).
        // Fallback to lastSynced for older/partial records.
        Object.keys(grouped).forEach(platform => {
          grouped[platform].sort(
            (a, b) => ((b.lastUpdated ?? b.lastSynced ?? 0) - (a.lastUpdated ?? a.lastSynced ?? 0))
          );
        });
        resolve(grouped);
      };

      request.onerror = () => reject(request.error);
    });
  });
}

// Get preview text for conversations
async function getConversationPreviews(platform) {
  return transaction(['conversations', 'messages'], 'readonly', (stores) => {
    const convStore = stores.conversations;
    const msgStore = stores.messages;

    const convIndex = convStore.index('platform');
    const convRequest = convIndex.getAll(platform);

    return new Promise((resolve, reject) => {
      const previews = {};

      const previewFromMessage = (message, limit) => {
        const text = (message?.content || '').trim();
        if (text) return text.substring(0, limit);

        const imageUrls = Array.isArray(message?.imageUrls) ? message.imageUrls : [];
        if (imageUrls.length > 0) return '包含图片';
        return '';
      };

      convRequest.onsuccess = () => {
        const conversations = convRequest.result;
        let pending = conversations.length;

        if (pending === 0) {
          resolve(previews);
          return;
        }

        conversations.forEach(conv => {
          const msgIndex = msgStore.index('conversationKey');
          const range = IDBKeyRange.only([platform, conv.id]);
          const msgRequest = msgIndex.getAll(range);

          msgRequest.onsuccess = () => {
            const messages = msgRequest.result;
            if (messages.length > 0) {
              // Get last user message and last assistant message
              const lastUserMsg = messages.filter(m => m.role === 'user').pop();
              const lastAssistantMsg = messages.filter(m => m.role === 'assistant').pop();

              previews[conv.id] = {
                userPreview: previewFromMessage(lastUserMsg, 100),
                assistantPreview: previewFromMessage(lastAssistantMsg, 150)
              };
            }

            pending--;
            if (pending === 0) {
              resolve(previews);
            }
          };
        });
      };

      convRequest.onerror = () => reject(convRequest.error);
    });
  });
}

// ========== Messages ==========

async function saveMessages(platform, conversationId, messages) {
  return transaction('messages', 'readwrite', (stores) => {
    const store = stores.messages;

    // Delete existing messages for this conversation
    const index = store.index('conversationKey');
    const range = IDBKeyRange.only([platform, conversationId]);
    const deleteRequest = index.openCursor(range);

    deleteRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      } else {
        // Add new messages
        messages.forEach(msg => {
          store.add({
            platform,
            conversationId,
            role: msg.role,
            content: msg.content || '',
            imageUrls: Array.isArray(msg.imageUrls) ? msg.imageUrls : [],
            timestamp: Date.now()
          });
        });
      }
    };
  });
}

async function getMessages(platform, conversationId) {
  return transaction('messages', 'readonly', (stores) => {
    const store = stores.messages;
    const index = store.index('conversationKey');
    const range = IDBKeyRange.only([platform, conversationId]);
    const request = index.getAll(range);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => reject(request.error);
    });
  });
}

async function deleteMessagesForConversation(platform, conversationId) {
  return transaction('messages', 'readwrite', (stores) => {
    const store = stores.messages;
    const index = store.index('conversationKey');
    const range = IDBKeyRange.only([platform, conversationId]);
    const request = index.openCursor(range);

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
  });
}

// ========== Full Text Search ==========

async function searchMessages(query) {
  if (!query || query.trim().length === 0) {
    return [];
  }

  return transaction('messages', 'readonly', (stores) => {
    const store = stores.messages;
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const messages = request.result;
        const lowerQuery = query.toLowerCase();

        // Filter messages containing the query
        const results = messages.filter(msg =>
          (msg.content || '').toLowerCase().includes(lowerQuery)
        );

        // Group by conversation
        const grouped = {};
        results.forEach(msg => {
          const key = `${msg.platform}:${msg.conversationId}`;
          if (!grouped[key]) {
            grouped[key] = {
              platform: msg.platform,
              conversationId: msg.conversationId,
              matches: []
            };
          }
          grouped[key].matches.push(msg);
        });

        resolve(Object.values(grouped));
      };

      request.onerror = () => reject(request.error);
    });
  });
}

// ========== Folders ==========

// Create a new folder
async function createFolder(name) {
  const id = 'folder_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const folder = {
    id,
    name,
    createdAt: Date.now()
  };
  
  return transaction('folders', 'readwrite', (stores) => {
    stores.folders.put(folder);
    return folder;
  });
}

// Get all folders
async function getAllFolders() {
  return transaction('folders', 'readonly', (stores) => {
    const request = stores.folders.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const folders = request.result;
        folders.sort((a, b) => a.createdAt - b.createdAt);
        resolve(folders);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

// Update folder name
async function updateFolder(folderId, name) {
  return transaction('folders', 'readwrite', async (stores) => {
    const existing = await new Promise((resolve, reject) => {
      const request = stores.folders.get(folderId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    if (existing) {
      stores.folders.put({
        ...existing,
        name
      });
    }
  });
}

// Delete folder and move conversations out
async function deleteFolder(folderId) {
  return transaction(['folders', 'conversations'], 'readwrite', async (stores) => {
    // Delete folder
    stores.folders.delete(folderId);
    
    // Move conversations out of folder
    const convIndex = stores.conversations.index('folderId');
    const request = convIndex.openCursor(folderId);
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const conv = cursor.value;
        stores.conversations.put({
          ...conv,
          folderId: null
        });
        cursor.continue();
      }
    };
  });
}

// Move conversation to folder
async function moveConversationToFolder(conversationId, folderId) {
  return transaction('conversations', 'readwrite', async (stores) => {
    const existing = await new Promise((resolve, reject) => {
      const request = stores.conversations.get(conversationId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    if (existing) {
      stores.conversations.put({
        ...existing,
        folderId: folderId || null
      });
    }
  });
}

// Get conversations by folder
async function getConversationsByFolder(folderId) {
  return transaction('conversations', 'readonly', (stores) => {
    const index = stores.conversations.index('folderId');
    const request = index.getAll(folderId);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const conversations = request.result;
        conversations.sort((a, b) => ((b.lastUpdated ?? b.lastSynced ?? 0) - (a.lastUpdated ?? a.lastSynced ?? 0)));
        resolve(conversations);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

// ========== Clear Cache ==========

async function clearAllCache() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['conversations', 'messages', 'folders'], 'readwrite');
    
    tx.objectStore('conversations').clear();
    tx.objectStore('messages').clear();
    tx.objectStore('folders').clear();
    
    tx.oncomplete = () => {
      console.log('[GCCAI] All cache cleared');
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    openDatabase,
    saveConversations,
    updateConversationLastSynced,
    updateConversationLastUpdated,
    syncConversationsWithDeletion,
    getAllConversations,
    getConversationPreviews,
    saveMessages,
    getMessages,
    deleteMessagesForConversation,
    searchMessages,
    createFolder,
    getAllFolders,
    updateFolder,
    deleteFolder,
    moveConversationToFolder,
    getConversationsByFolder,
    clearAllCache
  };
}
