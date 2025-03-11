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

// Need to set up listeners when the service worker starts
self.onconnect = function(event) {
  const port = event.ports[0];
  port.start();
};

// Listen for connection attempts from devtools panel and content scripts
chrome.runtime.onConnect.addListener(port => {
  if (port.name != "panel" && port.name != "content") {
    return;
  }

  const extensionListener = message => {
    const tabId = port.sender.tab && port.sender.tab.id >= 0 ? port.sender.tab.id : message.tabId;

    // The original connection event doesn't include the tab ID of the
    // DevTools page, so we need to send it explicitly (attached
    // to the 'init' event).
    if (message.action == "init") {
      if (!connections[tabId]) {
        connections[tabId] = {};
      }
      connections[tabId][port.name] = port;
      return;
    }

    // Other messages are relayed to specified target if any
    // and if the connection exists.
    if (message.target) {
      const conn = connections[tabId]?.[message.target];
      if (conn) {
        conn.postMessage(message);
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
        }
        break;
      }
    }
  });
});

// Keep service worker alive
self.addEventListener('activate', event => {
  // This ensures the service worker doesn't terminate too early
  event.waitUntil(clients.claim());
});
