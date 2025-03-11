// Copyright (c) 2019-2025 SafetyCulture Pty Ltd. All Rights Reserved.

// Map of Panel connections. The 'tabId' is used as key.
// There are two connections/ports for every tabId
// 1) Port to the panel script
// 2) Port to the content script
//
// Example:
// connections[1].panel => panel port
// connections[1].content => content port
let connections = {};
let pendingMessages = {};

// Keep track of registered tabs for content script injection
let registeredTabs = new Set();

// Listen for when a tab is updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only react to complete navigation events
  if (changeInfo.status === 'complete' && tab.url.startsWith('http')) {
    // Register this tab if we haven't seen it before
    if (!registeredTabs.has(tabId)) {
      registeredTabs.add(tabId);

      // Re-inject content script to ensure it's running
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content-script.js']
      }).catch(error => {
        console.error(`Error injecting content script: ${error}`);
      });
    }
  }
});

// When a connection is made from either panel or content script
chrome.runtime.onConnect.addListener(port => {
  if (port.name != "panel" && port.name != "content") {
    return;
  }

  const extensionListener = message => {
    const tabId = port.sender?.tab?.id >= 0 ? port.sender.tab.id : message.tabId;

    // The original connection event doesn't include the tab ID of the
    // DevTools page, so we need to send it explicitly (attached
    // to the 'init' event).
    if (message.action == "init") {
      if (!connections[tabId]) {
        connections[tabId] = {};
        pendingMessages[tabId] = [];
      }
      connections[tabId][port.name] = port;

      // If there are any pending messages for this tab, process them now
      if (port.name === "panel" && pendingMessages[tabId]?.length > 0) {
        for (const pendingMsg of pendingMessages[tabId]) {
          port.postMessage(pendingMsg);
        }
        pendingMessages[tabId] = [];
      }
      return;
    }

    // Other messages are relayed to specified target if any
    // and if the connection exists.
    if (message.target) {
      const conn = connections[tabId]?.[message.target];
      if (conn) {
        conn.postMessage(message);
      } else if (message.target === "panel") {
        // If panel isn't connected yet, store the message for later
        if (!pendingMessages[tabId]) {
          pendingMessages[tabId] = [];
        }
        pendingMessages[tabId].push(message);
      }
    }
  };

  // Listen to messages sent from the panel script or content script
  port.onMessage.addListener(extensionListener);

  // Remove connection on disconnect
  port.onDisconnect.addListener(function(port) {
    port.onMessage.removeListener(extensionListener);

    const tabs = Object.keys(connections);
    for (let i = 0; i < tabs.length; i++) {
      if (connections[tabs[i]][port.name] === port) {
        delete connections[tabs[i]][port.name];

        // If there is no port associated with the tab, remove it
        // from the connections map.
        if (Object.keys(connections[tabs[i]]).length === 0) {
          delete connections[tabs[i]];
          delete pendingMessages[tabs[i]];
        }
        break;
      }
    }
  });
});

// Keep service worker alive
self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

// Handle messages from content scripts even when service worker wasn't active
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "registerTab") {
    const tabId = sender.tab.id;
    registeredTabs.add(tabId);
    sendResponse({success: true});
    return true;
  }

  // Handle gRPC network calls that come before a connection is established
  if (message.action === "gRPCNetworkCall") {
    const tabId = sender.tab.id;

    // Store the message if panel isn't connected yet
    if (!connections[tabId]?.panel) {
      if (!pendingMessages[tabId]) {
        pendingMessages[tabId] = [];
      }
      pendingMessages[tabId].push({
        action: "gRPCNetworkCall",
        target: "panel",
        data: message.data
      });
    } else {
      // Forward to panel if connected
      connections[tabId].panel.postMessage({
        action: "gRPCNetworkCall",
        target: "panel",
        data: message.data
      });
    }
    sendResponse({success: true});
    return true;
  }
});
