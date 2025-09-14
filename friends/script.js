const API_BASE = 'https://api.grayflare.space';
let currentUserId = '';
let devMode = false;
let socket = null;
let useWebSocket = true; // WebSocket only - no HTTP fallback
let isConnecting = false;
let reconnectTimeout = null;

function devLog(...args) {
  if (devMode) console.log(...args);
}

function initializeWebSocket() {
  // Clean up any stuck friend blips from previous sessions
  if (window.parent && window.parent !== window) {
    for (let i = 0; i < 100; i++) {
      window.parent.postMessage({ type: 'removeBlip', id: `friend_${i}` }, '*');
    }
  }
  
  // Prevent multiple simultaneous connection attempts
  if (socket && (socket.connected || isConnecting)) {
    devLog('[initializeWebSocket] Already connected or connecting, skipping');
    return;
  }
  
  // Check if Socket.IO is available
  if (typeof io === 'undefined') {
    devLog('[initializeWebSocket] Socket.IO library not available, retrying in 1 second...');
    setTimeout(initializeWebSocket, 1000);
    return;
  }
  
  // Clean up existing socket
  if (socket) {
    devLog('[initializeWebSocket] Cleaning up existing socket');
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  
  // Clear any pending reconnect
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  isConnecting = true;
  devLog('[initializeWebSocket] Connecting to WebSocket');
  
  try {
    socket = io(API_BASE, {
      transports: ['websocket', 'polling'],
      timeout: 10000,
      reconnection: false, // Disable auto-reconnection to handle manually
      forceNew: true // Force new connection
    });
    
    // Fallback to HTTP if WebSocket doesn't connect within 10 seconds
    setTimeout(() => {
      if (!socket || !socket.connected) {
        devLog('[initializeWebSocket] WebSocket timeout, starting HTTP fallback');
        isConnecting = false;
      }
    }, 10000);
  } catch (error) {
    devLog('[initializeWebSocket] Failed to create socket:', error);
    isConnecting = false;
    return;
  }
  
  socket.on('connect', () => {
    devLog('[WebSocket] Connected successfully');
    isConnecting = false;
    if (currentUserId) {
      socket.emit('join_user', { user_id: currentUserId });
    }
    // Reset restart detection after reconnection
    if (serverRestartDetected) {
      setTimeout(() => {
        devLog('[WebSocket] Server back online after restart');
        showNotification('Server back online', 'success', true);
        serverRestartDetected = false;
        suppressOfflineNotifications = false;
      }, 5000);
    }
  });
  
  socket.on('disconnect', (reason) => {
    devLog('[WebSocket] Disconnected:', reason);
    isConnecting = false;
    
    // Only attempt reconnection for unexpected disconnects
    if (useWebSocket && reason !== 'io client disconnect') {
      // Clear any existing reconnect timeout
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      
      reconnectTimeout = setTimeout(() => {
        if (!socket || !socket.connected) {
          devLog('[WebSocket] Attempting reconnection after disconnect...');
          initializeWebSocket();
        }
      }, 5000); // Increased delay to prevent spam
    }
  });
  
  socket.on('connect_error', (error) => {
    devLog('[WebSocket] Connection error:', error);
    isConnecting = false;
    
    // Clear any existing reconnect timeout
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    
    // Only retry a limited number of times
    reconnectTimeout = setTimeout(() => {
      if (!socket || !socket.connected) {
        devLog('[WebSocket] Retrying connection after error...');
        initializeWebSocket();
      }
    }, 5000); // Increased delay
  });
  
  socket.on('friends_update', (data) => {
    devLog('[WebSocket] Friends update received:', data);
    handleFriendsUpdate(data ? data.friends : []);
  });
  
  socket.on('friend_requests_update', (data) => {
    devLog('[WebSocket] Friend requests update:', data);
    handleFriendRequestsUpdate(data.requests);
  });
  
  // Old location request handlers removed
  
  socket.on('received_locations_update', (data) => {
    devLog('[WebSocket] Received locations update:', data);
    handleReceivedLocationsUpdate(data.locations);
  });
  
  // Old location request event handlers removed
  
  socket.on('friend_request_received', (data) => {
    devLog('[WebSocket] Friend request received:', data);
    refreshRequests();
    const senderName = data.sender_name || 'Unknown';
    showNotification(`Friend request from ${senderName}!`, 'info');
  });
  
  socket.on('friend_request_declined', (data) => {
    devLog('[WebSocket] Friend request declined:', data);
    showNotification('Friend request was declined', 'info');
  });
  
  socket.on('friend_added', (data) => {
    devLog('[WebSocket] Friend added:', data);
    refreshFriends();
  });
  
  socket.on('friend_removed', (data) => {
    devLog('[WebSocket] Friend removed:', data);
    suppressOfflineNotifications = true;
    refreshFriends();
    setTimeout(() => suppressOfflineNotifications = false, 1000);
  });
  
  socket.on('user_blocked', (data) => {
    devLog('[WebSocket] User blocked:', data);
    refreshFriends();
  });
  
  socket.on('location_shared', (data) => {
    devLog('[WebSocket] Location shared:', data);
    // Location sharing handled by received_locations_update event
  });
  
  socket.on('server_restarting', (data) => {
    devLog('[WebSocket] Server restart detected, suppressing offline notifications');
    serverRestartDetected = true;
    suppressOfflineNotifications = true;
    showNotification('Server restarting...', 'info', true);
  });
  
  socket.on('admin_notification', (data) => {
    devLog('[WebSocket] Admin notification:', data);
    showNotification('Admin: ' + data.message, 'info');
  });
  
  socket.on('friend_stopped_sharing', (data) => {
    devLog('[WebSocket] Friend stopped sharing:', data);
    removeFriendBlip(data.friend_id, data.blip_id);
  });
  
  socket.on('force_reload', (data) => {
    devLog('[WebSocket] Force reload received');
    showNotification('System update - reloading...', 'info', true);
    
    // Clean up all friend blips before reload
    friendBlips.forEach((blipData, friendId) => {
      removeFriendBlip(friendId);
    });
    
    setTimeout(() => {
      localStorage.setItem('shouldPinAfterReload', 'true');
      window.location.reload();
    }, 2000);
  });
  
  socket.on('action_result', (data) => {
    devLog('[WebSocket] Action result:', data);
    if (data.success) {
      if (data.message.includes('Friend request sent')) {
        document.getElementById('sendStatus').innerHTML = '<span class="status status-online">Request sent!</span>';
        document.getElementById('targetUser').value = '';
        showNotification('Friend request sent!', 'success');
      } else if (data.message.includes('accepted')) {
        showNotification('Friend request accepted!', 'success');
      } else if (data.message.includes('declined')) {
        showNotification('Friend request declined', 'info');
      } else if (data.message.includes('Friend removed')) {
        document.getElementById('removeStatus').innerHTML = '<span class="status status-online">Friend removed!</span>';
        document.getElementById('removeFriendId').value = '';
        showNotification('Friend removed!', 'success');
      } else if (data.message.includes('User blocked')) {
        document.getElementById('blockStatus').innerHTML = '<span class="status status-online">User blocked!</span>';
        document.getElementById('blockUserId').value = '';
        showNotification('User blocked!', 'success');
      } else if (data.message.includes('Name updated')) {
        document.getElementById('nameStatus').innerHTML = '<span class="status status-online">Name updated!</span>';
        document.getElementById('friendNameId').value = '';
        document.getElementById('friendCustomName').value = '';
        showNotification('Friend name updated!', 'success');
        refreshFriends();
      } else {
        showNotification(data.message, 'success');
      }
    } else {
      if (data.message.includes('Friend request')) {
        document.getElementById('sendStatus').innerHTML = '<span class="status status-error">' + data.message + '</span>';
      } else if (data.message.includes('Name') || data.message.includes('friends')) {
        document.getElementById('nameStatus').innerHTML = '<span class="status status-error">' + data.message + '</span>';
      }
      showNotification(data.message, 'error');
    }
  });
  
  // Auto-request data when connected
  socket.on('joined', (data) => {
    devLog('[WebSocket] Joined room for user:', data.user_id);
    // Request initial data
    devLog('[WebSocket] Requesting friends for user:', currentUserId);
    socket.emit('get_friends', { user_id: currentUserId });
    socket.emit('get_friend_requests', { user_id: currentUserId });
  });
  
  socket.on('error', (data) => {
    devLog('[WebSocket] Error:', data);
  });
}

function showNotification(message, type = 'info', noSound = false) {
  devLog('[showNotification] Message:', message, 'Type:', type);
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Play notification sound if enabled and not suppressed
  if (soundEnabled && !noSound) {
    devLog('[showNotification] Playing sound');
    const audio = new Audio('notification.mp3');
    audio.volume = 0.1;
    audio.play().catch(() => {});
  }
  
  setTimeout(() => notification.classList.add('show'), 100);
  
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => document.body.removeChild(notification), 300);
  }, 5000);
}

function toggleSound() {
  devLog('[toggleSound] Called, current state:', soundEnabled);
  soundEnabled = !soundEnabled;
  localStorage.setItem('soundEnabled', soundEnabled);
  document.getElementById('soundToggle').textContent = soundEnabled ? '🔊' : '🔇';
  devLog('[toggleSound] New state:', soundEnabled);
}

function toggleGPS() {
  devLog('[toggleGPS] Called, current state:', gpsEnabled);
  gpsEnabled = !gpsEnabled;
  localStorage.setItem('gpsEnabled', gpsEnabled);
  document.getElementById('gpsToggle').textContent = gpsEnabled ? '🧭' : '🗺️';
  devLog('[toggleGPS] New state:', gpsEnabled);
  
  // Update all existing friend blips
  friendBlips.forEach((blipData, friendId) => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'setBlipRoute',
        id: `friend_${friendId}`,
        route: gpsEnabled
      }, '*');
    }
  });
}

function toggleLocationSharing() {
  devLog('[toggleLocationSharing] Called, current state:', locationSharingEnabled);
  locationSharingEnabled = !locationSharingEnabled;
  localStorage.setItem('locationSharingEnabled', locationSharingEnabled);
  document.getElementById('shareToggle').textContent = locationSharingEnabled ? '📍' : '📏';
  devLog('[toggleLocationSharing] New state:', locationSharingEnabled);
  
  if (socket && socket.connected && currentUserId) {
    socket.emit('set_location_sharing', { user_id: currentUserId, enabled: locationSharingEnabled });
  }
}

function setFriendName(friendId, customName) {
  if (!currentUserId) return;
  
  devLog('[setFriendName] Setting name for friend', friendId, 'to:', customName);
  
  if (socket && socket.connected) {
    socket.emit('set_friend_name', { user_id: currentUserId, friend_id: friendId, custom_name: customName });
  }
}

function setFriendNameById() {
  if (!currentUserId) {
    document.getElementById('nameStatus').innerHTML = '<span class="status status-error">Set your user ID first</span>';
    return;
  }
  
  const friendId = document.getElementById('friendNameId').value.trim();
  const customName = document.getElementById('friendCustomName').value.trim();
  
  if (!friendId) {
    document.getElementById('nameStatus').innerHTML = '<span class="status status-error">Enter friend\'s user ID</span>';
    return;
  }
  
  setFriendName(friendId, customName);
}

function editFriendName(friendId) {
  const friend = friendsData.find(f => f.friend_id == friendId);
  if (!friend) return;
  
  const input = document.createElement('input');
  input.type = 'text';
  input.value = friend.name;
  input.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000; padding: 5px; border: 1px solid #555; background: #2d2d2d; color: white; border-radius: 3px;';
  
  let handled = false;
  
  input.onkeydown = (e) => {
    if (handled) return;
    if (e.key === 'Enter') {
      handled = true;
      setFriendName(friendId, input.value.trim());
      try { input.remove(); } catch(e) {}
    } else if (e.key === 'Escape') {
      handled = true;
      try { input.remove(); } catch(e) {}
    }
  };
  
  input.onblur = () => {
    if (handled) return;
    handled = true;
    setFriendName(friendId, input.value.trim());
    try { input.remove(); } catch(e) {}
  };
  
  document.body.appendChild(input);
  input.focus();
  input.select();
}



// Location sharing is now automatic when enabled

function startLocationSharing() {
  devLog('[startLocationSharing] Starting location sharing interval');
  setInterval(async () => {
    if (currentUserId && locationSharingEnabled && socket && socket.connected) {
      devLog('[startLocationSharing] Broadcasting location to friends');
      if (window.parent && window.parent !== window && !window.pendingBroadcast) {
        window.parent.postMessage({ 
          type: 'getNamedData', 
          keys: ['pos_x', 'pos_y']
        }, '*');
        window.pendingBroadcast = true;
      }
    }
  }, 2000);
}

startLocationSharing();

// Location sharing now handled by broadcast_location event

let waypointNotificationShown = new Set();
let friendBlips = new Map(); // Track active friend blips

let lastNotificationCheck = 0;

async function checkAdminNotifications() {
  if (!socket || !socket.connected) {
    devLog('[checkAdminNotifications] WebSocket not connected');
  }
}

async function checkLocationRequests() {
  devLog('[checkLocationRequests] Called');
  if (!currentUserId) {
    devLog('[checkLocationRequests] No currentUserId, returning');
    return;
  }
  
  if (socket && socket.connected) {
    devLog('[checkLocationRequests] Using WebSocket');
    socket.emit('get_received_locations', { user_id: currentUserId });
  } else {
    devLog('[checkLocationRequests] WebSocket not connected');
  }
}

function handleReceivedLocationsUpdate(locations) {
  if (!blipsEnabled) return;
  
  if (locations && locations.length > 0) {
    devLog('[handleReceivedLocationsUpdate] Processing', locations.length, 'locations');
    locations.forEach(loc => {
      devLog('[handleReceivedLocationsUpdate] Updating friend blip for:', loc.sharer_name, 'at:', loc.pos_x, loc.pos_y);
      updateFriendBlip(loc.sharer_id, loc.sharer_name, loc.pos_x, loc.pos_y);
    });
  } else {
    devLog('[handleReceivedLocationsUpdate] No locations received');
  }
}

function updateFriendBlip(friendId, friendName, x, y, blipId) {
  if (!window.parent || window.parent === window || !blipsEnabled) return;
  
  const actualBlipId = blipId || `friend_${friendId}`;
  const color = getFriendColor(friendId);
  
  if (friendBlips.has(friendId)) {
    // Update existing blip position and timestamp
    const blipData = friendBlips.get(friendId);
    blipData.lastUpdate = Date.now();
    window.parent.postMessage({
      type: 'setBlipPosition',
      id: actualBlipId,
      x: x,
      y: y
    }, '*');
    
    // Update GPS routing if enabled
    if (gpsEnabled) {
      window.parent.postMessage({
        type: 'setBlipRoute',
        id: actualBlipId,
        route: true
      }, '*');
    }
  } else {
    // Create new friend blip with unique color
    window.parent.postMessage({
      type: 'buildBlip',
      id: actualBlipId,
      x: x,
      y: y,
      sprite: 1,
      color: color,
      alwaysVisible: true,
      route: gpsEnabled,
      ticked: false,
      name: friendName || `Friend ${friendId}`
    }, '*');
    friendBlips.set(friendId, { name: friendName, x: x, y: y, blipId: actualBlipId, lastUpdate: Date.now() });
  }
}

function removeFriendBlip(friendId, blipId) {
  if (!window.parent || window.parent === window) return;
  
  const actualBlipId = blipId || friendBlips.get(friendId)?.blipId || `friend_${friendId}`;
  window.parent.postMessage({
    type: 'removeBlip',
    id: actualBlipId
  }, '*');
  friendBlips.delete(friendId);
  friendGPSRouting.delete(friendId);
}

async function sendFriendRequest() {
  devLog('[sendFriendRequest] Called');
  if (!currentUserId) {
    devLog('[sendFriendRequest] No currentUserId');
    document.getElementById('sendStatus').innerHTML = '<span class="status status-error">Set your user ID first</span>';
    return;
  }
  
  const targetUser = document.getElementById('targetUser').value;
  devLog('[sendFriendRequest] Target user:', targetUser);
  if (!targetUser) {
    devLog('[sendFriendRequest] No target user entered');
    return;
  }
  
  if (socket && socket.connected) {
    devLog('[sendFriendRequest] Using WebSocket');
    socket.emit('send_friend_request', { sender_id: currentUserId, receiver_id: targetUser });
  } else {
    devLog('[sendFriendRequest] WebSocket not connected');
    document.getElementById('sendStatus').innerHTML = '<span class="status status-error">WebSocket not connected</span>';
  }
}

async function acceptRequest(senderId) {
  devLog('[acceptRequest] Called for senderId:', senderId);
  
  if (socket && socket.connected) {
    devLog('[acceptRequest] Using WebSocket');
    socket.emit('accept_friend_request', { sender_id: senderId, receiver_id: currentUserId });
  } else {
    devLog('[acceptRequest] WebSocket not connected');
    showNotification('WebSocket not connected', 'error');
  }
}

async function declineRequest(senderId) {
  devLog('[declineRequest] Called for senderId:', senderId);
  
  if (socket && socket.connected) {
    devLog('[declineRequest] Using WebSocket');
    socket.emit('decline_friend_request', { sender_id: senderId, receiver_id: currentUserId });
  } else {
    devLog('[declineRequest] WebSocket not connected');
    showNotification('WebSocket not connected', 'error');
  }
}

let lastRequestCount = -1;

async function refreshRequests() {
  devLog('[refreshRequests] Called');
  if (!currentUserId) {
    devLog('[refreshRequests] No currentUserId, returning');
    return;
  }
  
  if (socket && socket.connected) {
    devLog('[refreshRequests] Using WebSocket');
    socket.emit('get_friend_requests', { user_id: currentUserId });
  } else {
    devLog('[refreshRequests] WebSocket not connected');
    document.getElementById('requestsList').innerHTML = '<div style="text-align: center; color: #f44336; font-size: 0.8rem;">WebSocket not connected</div>';
  }
}

function handleFriendRequestsUpdate(requests) {
  const requestsList = document.getElementById('requestsList');
  if (requests && requests.length > 0) {
    lastRequestCount = requests.length;
    
    // Get player names for the requests
    const namesMap = {};
    if (cached_players) {
      for (const player of cached_players) {
        namesMap[player[2]] = player[0];
      }
    }
    
    requestsList.innerHTML = requests.map(req => {
      const senderName = req.sender_name || namesMap[parseInt(req.sender_id)] || 'Unknown';
      return '<div class="request-item"><div><strong>' + senderName + '</strong><div style="font-size: 0.7rem; color: #99aab5;">ID: ' + req.sender_id + ' • ' + new Date(req.created_at).toUTCString() + '</div></div><div><button onclick="acceptRequest(\'' + req.sender_id + '\')" style="background: #43a047; color: white; border: none; border-radius: 3px; padding: 6px 8px; margin-right: 4px; cursor: pointer;">✓</button><button onclick="declineRequest(\'' + req.sender_id + '\')" style="background: #f44336; color: white; border: none; border-radius: 3px; padding: 6px 8px; cursor: pointer;">×</button></div></div>';
    }).join('');
  } else {
    if (lastRequestCount === -1) lastRequestCount = 0;
    else lastRequestCount = 0;
    requestsList.innerHTML = '<div style="text-align: center; color: #99aab5; font-size: 0.8rem; padding: 1rem;">No pending requests</div>';
  }
}

let friendsData = [];
let friendsWindowVisible = localStorage.getItem('friendsWindowVisible') === 'true';
let hideIds = localStorage.getItem('hideIds') === 'true';
let gpsEnabled = localStorage.getItem('gpsEnabled') === 'true';
let locationSharingEnabled = localStorage.getItem('locationSharingEnabled') === 'true';
let blipsEnabled = localStorage.getItem('blipsEnabled') !== 'false';
let lastUpdateTime = Math.floor(Date.now() / 1000);
let cached_players = [];
let soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
let friendsWindow = document.getElementById('friendsWindow');
let friendColors = new Map(); // Track friend colors
let friendGPSRouting = new Set(); // Track which friends have GPS routing enabled

// Set initial button states
setTimeout(() => {
  if (document.getElementById('soundToggle')) {
    document.getElementById('soundToggle').textContent = soundEnabled ? '🔊' : '🔇';
  }
  if (document.getElementById('hideIdsToggle')) {
    document.getElementById('hideIdsToggle').textContent = hideIds ? '🙈' : '👁️';
  }

  if (document.getElementById('shareToggle')) {
    document.getElementById('shareToggle').textContent = locationSharingEnabled ? '📍' : '📏';
  }
  if (document.getElementById('blipsToggle')) {
    document.getElementById('blipsToggle').textContent = blipsEnabled ? '👥' : '🚫';
  }
  friendsWindow = document.getElementById('friendsWindow');
}, 100);
let previousOnlineFriends = new Set();
let suppressOfflineNotifications = false;
let serverRestartDetected = false;

function formatSeconds(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs}h ${mins}m ${secs}s`;
}

function getConnectedSeconds(friend) {
  if (!friend.online) return 0;
  const baseSeconds = friend.sessionDuration || 0;
  const now = Math.floor(Date.now() / 1000);
  const elapsedSinceUpdate = now - lastUpdateTime;
  const totalSeconds = baseSeconds + elapsedSinceUpdate;
  
  devLog('[timeconnected] Friend:', friend.name, 'baseSeconds:', baseSeconds, 'elapsedSinceUpdate:', elapsedSinceUpdate, 'totalSeconds:', totalSeconds, 'lastUpdateTime:', lastUpdateTime);
  
  return totalSeconds;
}

async function refreshFriends() {
  devLog('[refreshFriends] Called');
  if (!currentUserId) {
    devLog('[refreshFriends] No currentUserId, returning');
    return;
  }
  
  if (socket && socket.connected) {
    devLog('[refreshFriends] Using WebSocket, requesting friends for user:', currentUserId);
    socket.emit('get_friends', { user_id: currentUserId });
  } else {
    devLog('[refreshFriends] WebSocket not connected');
  }
}

function handleFriendsUpdate(newFriendsData) {
  devLog('[handleFriendsUpdate] Got', newFriendsData ? newFriendsData.length : 0, 'friends, data:', newFriendsData);
  
  if (!newFriendsData) {
    newFriendsData = [];
  }
  
  // Remove blips for friends who stopped sharing location
  if (friendsData.length > 0) {
    friendsData.forEach(oldFriend => {
      const newFriend = newFriendsData.find(f => f.friend_id === oldFriend.friend_id);
      if (oldFriend.sharing_location && (!newFriend || !newFriend.sharing_location)) {
        devLog('[handleFriendsUpdate] Friend stopped sharing:', oldFriend.name);
        removeFriendBlip(oldFriend.friend_id, oldFriend.blip_id);
      }
    });
  }
  
  // Check for friend join/leave notifications
  if (friendsData.length > 0) {
    const currentOnlineFriends = new Set(newFriendsData.filter(f => f.online).map(f => f.friend_id));
    
    // Check for friends who came online
    currentOnlineFriends.forEach(friendId => {
      if (!previousOnlineFriends.has(friendId)) {
        const friend = newFriendsData.find(f => f.friend_id === friendId);
        if (friend) {
          devLog('[handleFriendsUpdate] Friend came online:', friend.name);
          showNotification(friend.name + ' came online', 'success');
        }
      }
    });
    
    // Check for friends who went offline (but not if we're suppressing notifications due to friend removal or server restart)
    if (!suppressOfflineNotifications && !serverRestartDetected) {
      previousOnlineFriends.forEach(friendId => {
        if (!currentOnlineFriends.has(friendId)) {
          const friend = friendsData.find(f => f.friend_id === friendId);
          if (friend) {
            devLog('[handleFriendsUpdate] Friend went offline:', friend.name);
            showNotification(friend.name + ' went offline', 'info');
          }
        }
      });
    }
    
    previousOnlineFriends = currentOnlineFriends;
  } else {
    previousOnlineFriends = new Set(newFriendsData.filter(f => f.online).map(f => f.friend_id));
  }
  
  friendsData = newFriendsData;
  const newLastUpdateTime = Math.floor(Date.now() / 1000);
  devLog('[timeconnected] Setting lastUpdateTime from', lastUpdateTime, 'to', newLastUpdateTime);
  lastUpdateTime = newLastUpdateTime;
  updateFriendsWindow();
}

function getFriendColor(friendId) {
  if (!friendColors.has(friendId)) {
    const colors = [1, 2, 3, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
    const colorIndex = parseInt(friendId) % colors.length;
    friendColors.set(friendId, colors[colorIndex]);
  }
  return friendColors.get(friendId);
}

function updateFriendsWindow() {
  devLog('[updateFriendsWindow] Called, visible:', friendsWindowVisible, 'friends count:', friendsData.length);
  if (!friendsWindowVisible) {
    friendsWindow.style.display = 'none';
    return;
  }
  
  if (friendsData.length === 0) {
    friendsWindow.style.display = 'block';
    friendsWindow.innerHTML = '<div style="font-weight: bold; margin-bottom: 0.5rem;">Friends Online (0)</div><div style="color: #99aab5;">No friends found</div>';
    return;
  }
  
  friendsWindow.style.display = 'block';
  const onlineFriends = friendsData.filter(f => f.online);
  devLog('[updateFriendsWindow] Online friends:', onlineFriends.length);
  
  if (onlineFriends.length === 0) {
    friendsWindow.innerHTML = '<div style="font-weight: bold; margin-bottom: 0.5rem;">Friends Online (0)</div><div style="color: #99aab5;">No friends online</div>';
    return;
  }
  
  const header = '<div style="font-weight: bold; margin-bottom: 0.5rem;">Friends Online (' + onlineFriends.length + ')</div>';
  const friendsList = onlineFriends.map(friend => {
    const sessionDuration = getConnectedSeconds(friend);
    const timeStr = formatSeconds(sessionDuration);
    const betaIndicator = friend.server === 'njyvop' ? ' [BETA]' : '';
    const idText = hideIds ? '' : ' (ID: ' + friend.friend_id + ')';
    const spanStyle = hideIds ? 'flex: 0 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' : 'flex: 1;';
    
    // Show colored dot if friend is sharing location, nothing if not
    let locationIndicator = '';
    if (friend.sharing_location) {
      const color = getFriendColor(friend.friend_id);
      const colorMap = {1:'red',2:'green',3:'blue',5:'yellow',6:'#ff6b6b',7:'#8b5cf6',8:'pink',9:'#ffa500',11:'#00ff7f',12:'#87ceeb',15:'cyan',17:'orange',20:'#ffd700',21:'#ff8c00',22:'#d3d3d3'};
      const colorName = colorMap[color] || 'white';
      locationIndicator = '<span onclick="toggleFriendGPS(\'' + friend.friend_id + '\')" style="color: ' + colorName + '; font-size: 1rem; margin-left: 5px; cursor: pointer;" title="Click to toggle GPS routing">●</span>';
    }
    
    return '<div style="display: flex; justify-content: space-between; align-items: center; line-height: 1; padding: 1px 0;"><span style="' + spanStyle + '">' + friend.name + idText + betaIndicator + ' (' + timeStr + ')' + locationIndicator + '</span></div>';
  }).join('');
  
  friendsWindow.innerHTML = header + friendsList;
}

function toggleFriendsWindow() {
  devLog('[toggleFriendsWindow] Called, current state:', friendsWindowVisible);
  friendsWindowVisible = !friendsWindowVisible;
  localStorage.setItem('friendsWindowVisible', friendsWindowVisible);
  devLog('[toggleFriendsWindow] New state:', friendsWindowVisible);
  updateFriendsWindow();
}

function toggleFriendGPS(friendId) {
  if (!window.parent || window.parent === window) return;
  
  const blipId = `friend_${friendId}`;
  if (friendBlips.has(friendId)) {
    const isRouting = friendGPSRouting.has(friendId);
    const newRoutingState = !isRouting;
    
    window.parent.postMessage({
      type: 'setBlipRoute',
      id: blipId,
      route: newRoutingState
    }, '*');
    
    if (newRoutingState) {
      friendGPSRouting.add(friendId);
      showNotification('GPS routing enabled for friend', 'success');
    } else {
      friendGPSRouting.delete(friendId);
      showNotification('GPS routing disabled for friend', 'info');
    }
  }
}

function toggleBlips() {
  blipsEnabled = !blipsEnabled;
  localStorage.setItem('blipsEnabled', blipsEnabled);
  if (document.getElementById('blipsToggle')) {
    document.getElementById('blipsToggle').textContent = blipsEnabled ? '👥' : '🚫';
  }
  
  if (!blipsEnabled) {
    // Remove all friend blips when disabled
    friendBlips.forEach((blipData, friendId) => {
      removeFriendBlip(friendId);
    });
  }
}

function toggleIds() {
  hideIds = !hideIds;
  localStorage.setItem('hideIds', hideIds);
  if (document.getElementById('hideIdsToggle')) {
    document.getElementById('hideIdsToggle').textContent = hideIds ? '🙈' : '👁️';
  }
  updateFriendsWindow();
}



async function removeFriend(friendId) {
  if (!currentUserId) return;
  
  if (socket && socket.connected) {
    socket.emit('remove_friend', { user_id: currentUserId, friend_id: friendId });
    return;
  }
  
  try {
    const response = await fetch(API_BASE + '/friend/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUserId, friend_id: friendId })
    });
    const result = await response.json();
    
    if (result.success) {
      suppressOfflineNotifications = true;
      refreshFriends();
      setTimeout(() => suppressOfflineNotifications = false, 1000);
    }
  } catch (error) {
    console.error('Error removing friend:', error);
  }
}

async function removeFriendById() {
  if (!currentUserId) {
    document.getElementById('removeStatus').innerHTML = '<span class="status status-error">Set your user ID first</span>';
    return;
  }
  
  const friendId = document.getElementById('removeFriendId').value;
  if (!friendId) return;
  
  if (socket && socket.connected) {
    devLog('[removeFriendById] Using WebSocket');
    socket.emit('remove_friend', { user_id: currentUserId, friend_id: friendId });
  } else {
    devLog('[removeFriendById] WebSocket not connected');
    document.getElementById('removeStatus').innerHTML = '<span class="status status-error">WebSocket not connected</span>';
  }
}

async function blockUser() {
  if (!currentUserId) {
    document.getElementById('blockStatus').innerHTML = '<span class="status status-error">Set your user ID first</span>';
    return;
  }
  
  const blockId = document.getElementById('blockUserId').value;
  if (!blockId) return;
  
  if (socket && socket.connected) {
    devLog('[blockUser] Using WebSocket');
    socket.emit('block_user', { blocker_id: currentUserId, blocked_id: blockId });
  } else {
    devLog('[blockUser] WebSocket not connected');
    document.getElementById('blockStatus').innerHTML = '<span class="status status-error">WebSocket not connected</span>';
  }
}

async function unblockUser() {
  if (!currentUserId) {
    document.getElementById('blockStatus').innerHTML = '<span class="status status-error">Set your user ID first</span>';
    return;
  }
  
  const unblockId = document.getElementById('blockUserId').value;
  if (!unblockId) return;
  
  if (socket && socket.connected) {
    socket.emit('unblock_user', { blocker_id: currentUserId, blocked_id: unblockId });
  } else {
    document.getElementById('blockStatus').innerHTML = '<span class="status status-error">WebSocket not connected</span>';
  }
}

let lastKnownState = { focused: false, tabbed: false };

function updateVisibility(newState) {
  if (newState) {
    lastKnownState.focused = newState.focused ?? lastKnownState.focused;
    lastKnownState.tabbed = newState.tabbed ?? lastKnownState.tabbed;
  }
  
  const { focused, tabbed } = lastKnownState;
  const shouldBeVisible = focused || tabbed;
  document.querySelector('.friends-container').style.display = shouldBeVisible ? 'block' : 'none';
  
  const shouldBeHighlighted = focused;
  document.querySelector('.friends-container').style.border = shouldBeHighlighted ? '2px solid #2d8cf0' : '1px solid #444';
}

window.addEventListener('message', (event) => {
  if (typeof event.data !== 'object' || event.data === null) return;
  const payload = event.data.data || event.data;
  if (typeof payload !== 'object' || payload === null) return;
  
  if (typeof payload.focused === 'boolean') {
    devLog('[message] Visibility update:', payload);
    updateVisibility({ focused: payload.focused, tabbed: payload.tabbed });
  }
  
  if (payload.user_id && !currentUserId) {
    currentUserId = payload.user_id.toString();
    devMode = currentUserId === '736186';
    devLog('[message] User ID received:', currentUserId, 'Dev mode:', devMode);
    document.getElementById('userStatus').innerHTML = '<div class="user-id-display">User ID: ' + currentUserId + '</div>';
    
    // Initialize WebSocket
    initializeWebSocket();
  }
  
  // Handle location data response
  if (payload.pos_x && payload.pos_y) {
    const locationData = {
      pos_x: payload.pos_x,
      pos_y: payload.pos_y
    };
    
    // Broadcast location to all friends if sharing is enabled
    if (window.pendingBroadcast && locationSharingEnabled && socket && socket.connected && currentUserId) {
      devLog('[message] Broadcasting location to friends:', locationData);
      socket.emit('broadcast_location', { user_id: currentUserId, location: locationData });
      window.pendingBroadcast = false;
    }
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'pin' }, '*');
    }
  }
});

let lastLocationRequestCount = -1;

// Old location request system removed

setInterval(() => {
  if (currentUserId) {
    refreshRequests();
    refreshFriends();
    checkLocationRequests();
    checkAdminNotifications();
  }
}, 5000);

setInterval(() => {
  if (friendsWindowVisible) {
    updateFriendsWindow();
  }
}, 1000);

// Clean up stale friend blips every 5 seconds
setInterval(() => {
  const now = Date.now();
  const staleBlips = [];
  
  friendBlips.forEach((blipData, friendId) => {
    if (now - blipData.lastUpdate > 15000) { // 15 seconds
      staleBlips.push(friendId);
    }
  });
  
  staleBlips.forEach(friendId => {
    devLog('[cleanup] Removing stale blip for friend:', friendId);
    removeFriendBlip(friendId);
  });
}, 5000);

let isDragging = false;
let isDraggingFriends = false;
let offsetX = 0;
let offsetY = 0;
let dragOffsetFriendsX = 0;
let dragOffsetFriendsY = 0;

function setupDragging() {
  const container = document.querySelector('.friends-container');
  const friendsWindow = document.getElementById('friendsWindow');

  // Restore saved positions
  const savedMainPos = localStorage.getItem('mainWindowPosition');
  const savedFriendsPos = localStorage.getItem('friendsWindowPosition');
  
  if (savedMainPos) {
    const pos = JSON.parse(savedMainPos);
    container.style.left = pos.left + 'px';
    container.style.top = pos.top + 'px';
  }
  
  if (savedFriendsPos) {
    const pos = JSON.parse(savedFriendsPos);
    friendsWindow.style.left = pos.left + 'px';
    friendsWindow.style.top = pos.top + 'px';
    friendsWindow.style.right = 'auto';
    friendsWindow.style.bottom = 'auto';
  }

  container.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    isDragging = true;
    offsetX = e.clientX - container.offsetLeft;
    offsetY = e.clientY - container.offsetTop;
  });

  friendsWindow.addEventListener('mousedown', (e) => {
    isDraggingFriends = true;
    dragOffsetFriendsX = e.clientX - friendsWindow.getBoundingClientRect().left;
    dragOffsetFriendsY = e.clientY - friendsWindow.getBoundingClientRect().top;
    e.preventDefault();
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      localStorage.setItem('mainWindowPosition', JSON.stringify({
        left: container.offsetLeft,
        top: container.offsetTop
      }));
    }
    if (isDraggingFriends) {
      localStorage.setItem('friendsWindowPosition', JSON.stringify({
        left: friendsWindow.offsetLeft,
        top: friendsWindow.offsetTop
      }));
    }
    isDragging = false;
    isDraggingFriends = false;
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      container.style.left = (e.clientX - offsetX) + 'px';
      container.style.top = (e.clientY - offsetY) + 'px';
    }
    if (isDraggingFriends) {
      let newLeft = e.clientX - dragOffsetFriendsX;
      let newTop = e.clientY - dragOffsetFriendsY;
      const maxLeft = window.innerWidth - friendsWindow.offsetWidth;
      const maxTop = window.innerHeight - friendsWindow.offsetHeight;
      newLeft = Math.min(Math.max(0, newLeft), maxLeft);
      newTop = Math.min(Math.max(0, newTop), maxTop);
      friendsWindow.style.left = newLeft + 'px';
      friendsWindow.style.top = newTop + 'px';
      friendsWindow.style.right = 'auto';
      friendsWindow.style.bottom = 'auto';
    }
  });
}

setupDragging();

function requestGameData() {
  devLog('[requestGameData] Requesting user ID from parent window');
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'getNamedData', keys: ['user_id'] }, '*');
  }
}

requestGameData();

setTimeout(() => {
  if (!currentUserId) {
    requestGameData();
  }
}, 2000);

if (localStorage.getItem('shouldPinAfterReload') === 'true') {
  localStorage.removeItem('shouldPinAfterReload');
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'pin' }, '*');
  }
}