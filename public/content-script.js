// Copyright (c) 2019-2025 SafetyCulture Pty Ltd. All Rights Reserved.

// First, register the tab to ensure the service worker is active
chrome.runtime.sendMessage({action: "registerTab"})
  .catch(error => {
    // Service worker might not be active yet, which is okay
    console.log("Initial registration - service worker might not be active yet:", error);
  });

// Inject the grpc-web interceptor script
const injectGrpcWebInterceptor = () => {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('grpc-web-interceptor.js');
  script.onload = function() {
    this.remove();
  };
  document.documentElement.appendChild(script);
};

// Inject the connect-web interceptor script
const injectConnectWebInterceptor = () => {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('connect-web-interceptor.js');
  script.onload = function() {
    this.remove();
  };
  document.documentElement.appendChild(script);
};

// Inject our scripts when the page DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectGrpcWebInterceptor();
    injectConnectWebInterceptor();
  });
} else {
  injectGrpcWebInterceptor();
  injectConnectWebInterceptor();
}

// Port for communication with the background service worker
let port;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;
let cachedMessages = [];

// Set up port to background service worker if needed
function setupPortIfNeeded() {
  if (!port && connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
    connectionAttempts++;
    try {
      port = chrome.runtime.connect(null, { name: "content" });
      port.postMessage({ action: "init" });

      // Send any cached messages
      if (cachedMessages.length > 0) {
        for (const msg of cachedMessages) {
          sendGRPCNetworkCall(msg);
        }
        cachedMessages = [];
      }

      port.onDisconnect.addListener(() => {
        // Reset port when disconnected
        port = null;

        // Automatically try to reconnect
        if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
          setTimeout(setupPortIfNeeded, 200 * connectionAttempts);
        }
      });
    } catch (e) {
      console.error("Failed to connect to service worker:", e);
      port = null;

      // Try again with exponential backoff
      setTimeout(setupPortIfNeeded, 200 * connectionAttempts);
    }
  }
}

// Send gRPC network call data to the devtools panel
function sendGRPCNetworkCall(data) {
  try {
    // First, try to use the port if available
    setupPortIfNeeded();

    if (port) {
      port.postMessage({
        action: "gRPCNetworkCall",
        target: "panel",
        data,
      });
    } else {
      // Fall back to one-time message if port isn't available
      cachedMessages.push(data);
      chrome.runtime.sendMessage({
        action: "gRPCNetworkCall",
        data
      }).catch(error => {
        // Service worker might not be active yet, which is okay
        // Messages will be cached and sent when connection is established
      });
    }
  } catch (error) {
    console.error("Error sending gRPC network call:", error);
    // Cache the message to try again later
    cachedMessages.push(data);
  }
}

// Handle messages posted from injected scripts
function handleMessageEvent(event) {
  if (event.source !== window) return;
  if (event.data.type && event.data.type === "__GRPCWEB_DEVTOOLS__") {
    sendGRPCNetworkCall(event.data);
  }
}

// Listen for messages from the page
window.addEventListener("message", handleMessageEvent, false);

// Try to set up the port immediately
setupPortIfNeeded();
