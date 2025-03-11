/* global chrome */

import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { configureStore } from "@reduxjs/toolkit";
import App from './App';
import './index.css';
import networkReducer, { networkLog, clearLog } from './state/network';
import toolbarReducer from './state/toolbar';
import clipboardReducer from './state/clipboard';

let port, tabId;

// Setup port for communication with the background service worker
if (chrome) {
  try {
    tabId = chrome.devtools.inspectedWindow.tabId;
    
    // Connect to the background service worker
    port = chrome.runtime.connect(null, { name: "panel" });
    
    // Initialize the connection with the tabId
    port.postMessage({ tabId, action: "init" });
    
    // Listen for messages from the background service worker
    port.onMessage.addListener(_onMessageReceived);
    
    // Listen for tab updates to clear the log when page reloads
    chrome.tabs.onUpdated.addListener(_onTabUpdated);
  } catch (error) {
    console.warn("Not running app in chrome extension panel:", error);
  }
}

// Create Redux store
const store = configureStore({
  reducer: {
    network: networkReducer,
    toolbar: toolbarReducer,
    clipboard: clipboardReducer,
  }
});

// Handle messages received from the background service worker
function _onMessageReceived({ action, data }) {
  if (action === "gRPCNetworkCall") {
    store.dispatch(networkLog(data));
  }
}

// Handle tab updates to clear the log when the page is reloaded
function _onTabUpdated(tId, { status }) {
  if (tId === tabId && status === "loading") {
    store.dispatch(clearLog());
  }
}

// Render the React application
ReactDOM.render(
  <Provider store={store}>
    <App />
  </Provider>,
  document.getElementById('root')
);