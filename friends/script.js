const API_BASE = 'https://api.grayflare.space';
let currentUserId = '';
let devMode = false;
let socket = null;
let useWebSocket = true; // WebSocket enabled by default, HTTP as fallback
let isConnecting = false;
let reconnectTimeout = null;

function devLog(...args) {
  if (devMode) console.log(...args);
}

function initializeWebSocket() {
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
  
  socket.on('location_requests_update', (data) => {
    devLog('[WebSocket] Location requests update:', data);
    handleLocationRequestsUpdate(data.requests);
  });
  
  socket.on('location_tracking_update', (data) => {
    devLog('[WebSocket] Location tracking update:', data);
    handleLocationTrackingUpdate(data.requests);
  });
  
  socket.on('received_locations_update', (data) => {
    devLog('[WebSocket] Received locations update:', data);
    handleReceivedLocationsUpdate(data.locations);
  });
  
  socket.on('location_request_received', (data) => {
    devLog('[WebSocket] New location request received:', data);
    refreshLocationRequests();
  });
  
  socket.on('location_request_cancelled', (data) => {
    devLog('[WebSocket] Location request cancelled:', data);
    refreshLocationRequests();
    updateLocationTrackingStatus();
  });
  
  socket.on('location_request_accepted', (data) => {
    devLog('[WebSocket] Location request accepted:', data);
    updateLocationTrackingStatus();
    showNotification('Location request accepted!', 'success');
  });
  
  socket.on('friend_request_received', (data) => {
    devLog('[WebSocket] Friend request received:', data);
    refreshRequests();
    showNotification('New friend request received!', 'info');
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
    if (data.location && data.location.pos_x && data.location.pos_y) {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ 
          type: 'setWaypoint', 
          x: data.location.pos_x, 
          y: data.location.pos_y 
        }, '*');
      }
    }
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
  
  socket.on('force_reload', (data) => {
    devLog('[WebSocket] Force reload received');
    showNotification('System update - reloading...', 'info', true);
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
    socket.emit('get_location_requests', { user_id: currentUserId });
    socket.emit('get_location_tracking', { user_id: currentUserId });
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



let toggleCooldown = new Set();

async function toggleLocationRequest(friendId) {
  devLog('[toggleLocationRequest] Called for friendId:', friendId);
  if (!currentUserId) {
    devLog('[toggleLocationRequest] No currentUserId, returning');
    return;
  }
  
  // Prevent spam clicking
  if (toggleCooldown.has(friendId)) {
    devLog('[toggleLocationRequest] Cooldown active for friendId:', friendId);
    return;
  }
  
  const hasRequest = activeLocationRequests.has(String(friendId));
  const isActiveTracking = activeLocationTracking.has(String(friendId));
  const willActivate = !(hasRequest || isActiveTracking);
  
  // Add cooldown
  toggleCooldown.add(friendId);
  setTimeout(() => toggleCooldown.delete(friendId), 2000);
  
  if (socket && socket.connected) {
    devLog('[toggleLocationRequest] Using WebSocket');
    
    // Immediately update UI state for instant feedback
    if (willActivate) {
      activeLocationRequests.add(String(friendId));
    } else {
      activeLocationRequests.delete(String(friendId));
      activeLocationTracking.delete(String(friendId));
      waypointNotificationShown.delete(String(friendId));
    }
    updateFriendsWindow();
    
    socket.emit('toggle_location_tracking', { requester_id: currentUserId, target_id: friendId, active: willActivate });
    return;
  }
  
  try {
    devLog('[toggleLocationRequest] Using HTTP fallback');
    const requestBody = { requester_id: currentUserId, target_id: friendId, active: willActivate };
    
    const response = await fetch(API_BASE + '/location/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const text = await response.text();
      showNotification('Server error: ' + response.status, 'error');
      return;
    }
    
    const result = await response.json();
    
    if (result.success) {
      if (!hasRequest && !isActiveTracking) {
        activeLocationRequests.add(String(friendId));
        showNotification('Location request sent to ' + friendId, 'success');
      } else if (hasRequest || isActiveTracking) {
        activeLocationRequests.delete(String(friendId));
        activeLocationTracking.delete(String(friendId));
        waypointNotificationShown.delete(String(friendId));
        showNotification('Location tracking stopped for ' + friendId, 'info');
      }
      updateFriendsWindow();
    } else {
      showNotification(result.error, 'error');
    }
  } catch (error) {
    devLog('[toggleLocationRequest] Exception:', error);
    showNotification('Connection error', 'error');
  }
}

let activeLocationSharing = new Set();
let acceptedLocationRequests = new Set();

function startLocationSharing() {
  devLog('[startLocationSharing] Starting location sharing interval');
  setInterval(async () => {
    if (currentUserId && acceptedLocationRequests.size > 0) {
      devLog('[startLocationSharing] Requesting location data once, accepted requests:', Array.from(acceptedLocationRequests));
      // Request current location from game ONCE per interval
      if (window.parent && window.parent !== window && !window.pendingAutoShare) {
        window.parent.postMessage({ 
          type: 'getNamedData', 
          keys: ['pos_x', 'pos_y']
        }, '*');
        window.pendingAutoShare = true;
      }
    }
  }, 5000);
}

startLocationSharing();

function shareLocationData(locationData, requesterId) {
  devLog('[shareLocationData] Sharing location with requesterId:', requesterId, 'data:', locationData);
  
  if (socket && socket.connected) {
    devLog('[shareLocationData] Using WebSocket');
    socket.emit('share_location', {
      sharer_id: currentUserId,
      requester_id: requesterId,
      location: locationData
    });
    return;
  }
  
  devLog('[shareLocationData] Using HTTP fallback');
  const requestBody = { 
    sharer_id: currentUserId, 
    requester_id: requesterId,
    location: locationData
  };
  devLog('[shareLocationData] Request body:', requestBody);
  
  fetch(API_BASE + '/location/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  }).then(response => {
    devLog('[shareLocationData] Response status:', response.status);
    if (!response.ok && response.status === 400) {
      devLog('[shareLocationData] 400 error - removing from acceptedLocationRequests:', requesterId);
      acceptedLocationRequests.delete(requesterId);
      return;
    }
    return response.json();
  }).then(result => {
    if (result) devLog('[shareLocationData] Success result:', result);
  }).catch(error => {
    devLog('[shareLocationData] Error:', error);
  });
}

let waypointNotificationShown = new Set();

let lastNotificationCheck = 0;

async function checkAdminNotifications() {
  if (socket && socket.connected) return;
  
  try {
    const response = await fetch(API_BASE + '/api/notifications/check?since=' + lastNotificationCheck);
    if (response.ok) {
      const result = await response.json();
      if (result.notifications && result.notifications.length > 0) {
        result.notifications.forEach(notif => {
          showNotification('Admin: ' + notif.message, 'info');
        });
        lastNotificationCheck = Date.now();
      }
    }
  } catch (error) {
    devLog('[checkAdminNotifications] Error:', error);
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
    return;
  }
  
  try {
    devLog('[checkLocationRequests] Using HTTP fallback');
    const response = await fetch(API_BASE + '/location/received/' + currentUserId);
    const result = await response.json();
    handleReceivedLocationsUpdate(result.locations);
  } catch (error) {
    devLog('[checkLocationRequests] Error:', error);
  }
}

function handleReceivedLocationsUpdate(locations) {
  if (locations && locations.length > 0) {
    devLog('[handleReceivedLocationsUpdate] Processing', locations.length, 'locations');
    locations.forEach(loc => {
      devLog('[handleReceivedLocationsUpdate] Setting waypoint from:', loc.sharer_name, 'at:', loc.pos_x, loc.pos_y);
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ 
          type: 'setWaypoint', 
          x: loc.pos_x, 
          y: loc.pos_y 
        }, '*');
      }
    });
  } else {
    devLog('[handleReceivedLocationsUpdate] No locations received');
  }
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
    return;
  }
  
  try {
    devLog('[sendFriendRequest] Using HTTP fallback');
    const requestBody = { sender_id: currentUserId, receiver_id: targetUser };
    const response = await fetch(API_BASE + '/friend/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    const result = await response.json();
    
    if (result.success) {
      document.getElementById('sendStatus').innerHTML = '<span class="status status-online">Request sent!</span>';
      document.getElementById('targetUser').value = '';
      showNotification('Friend request sent!', 'success');
    } else {
      document.getElementById('sendStatus').innerHTML = '<span class="status status-error">' + result.error + '</span>';
      showNotification(result.error, 'error');
    }
  } catch (error) {
    devLog('[sendFriendRequest] Error:', error);
    document.getElementById('sendStatus').innerHTML = '<span class="status status-error">Connection error</span>';
  }
}

async function acceptRequest(senderId) {
  devLog('[acceptRequest] Called for senderId:', senderId);
  
  if (socket && socket.connected) {
    devLog('[acceptRequest] Using WebSocket');
    socket.emit('accept_friend_request', { sender_id: senderId, receiver_id: currentUserId });
    return;
  }
  
  try {
    devLog('[acceptRequest] Using HTTP fallback');
    const requestBody = { sender_id: senderId, receiver_id: currentUserId };
    const response = await fetch(API_BASE + '/friend/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    const result = await response.json();
    
    if (result.success) {
      refreshRequests();
      refreshFriends();
      showNotification('Friend request accepted!', 'success');
    } else {
      showNotification(result.error || 'Failed to accept request', 'error');
    }
  } catch (error) {
    devLog('[acceptRequest] Error:', error);
    showNotification('Connection error', 'error');
  }
}

async function declineRequest(senderId) {
  devLog('[declineRequest] Called for senderId:', senderId);
  
  if (socket && socket.connected) {
    devLog('[declineRequest] Using WebSocket');
    socket.emit('decline_friend_request', { sender_id: senderId, receiver_id: currentUserId });
    return;
  }
  
  try {
    devLog('[declineRequest] Using HTTP fallback');
    const requestBody = { sender_id: senderId, receiver_id: currentUserId };
    const response = await fetch(API_BASE + '/friend/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    const result = await response.json();
    
    if (result.success) {
      refreshRequests();
      showNotification('Friend request declined', 'info');
    } else {
      showNotification(result.error || 'Failed to decline request', 'error');
    }
  } catch (error) {
    devLog('[declineRequest] Error:', error);
    showNotification('Connection error', 'error');
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
    return;
  }
  
  devLog('[refreshRequests] WebSocket not available - socket:', !!socket, 'connected:', socket ? socket.connected : 'N/A');
  
  try {
    devLog('[refreshRequests] Using HTTP fallback');
    const response = await fetch(API_BASE + '/friend/requests/' + currentUserId);
    const result = await response.json();
    handleFriendRequestsUpdate(result.requests);
  } catch (error) {
    document.getElementById('requestsList').innerHTML = '<div style="text-align: center; color: #f44336; font-size: 0.8rem;">Error loading requests</div>';
  }
}

function handleFriendRequestsUpdate(requests) {
  const requestsList = document.getElementById('requestsList');
  if (requests && requests.length > 0) {
    if (requests.length > lastRequestCount && lastRequestCount >= 0) {
      showNotification('New friend request received!', 'info');
    }
    lastRequestCount = requests.length;
    
    // Get player names for the requests
    const namesMap = {};
    if (cached_players) {
      for (const player of cached_players) {
        namesMap[player[2]] = player[0];
      }
    }
    
    requestsList.innerHTML = requests.map(req => {
      const senderName = namesMap[parseInt(req.sender_id)] || 'Unknown';
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
let lastUpdateTime = Math.floor(Date.now() / 1000);
let cached_players = [];
let soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
let friendsWindow = document.getElementById('friendsWindow');

// Set initial button states
setTimeout(() => {
  if (document.getElementById('soundToggle')) {
    document.getElementById('soundToggle').textContent = soundEnabled ? '🔊' : '🔇';
  }
  if (document.getElementById('hideIdsToggle')) {
    document.getElementById('hideIdsToggle').textContent = hideIds ? '🙈' : '👁️';
  }
  friendsWindow = document.getElementById('friendsWindow');
}, 100);
let previousOnlineFriends = new Set();
let activeLocationRequests = new Set();
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
  return baseSeconds + elapsedSinceUpdate;
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
    return;
  }
  
  devLog('[refreshFriends] WebSocket not available - socket:', !!socket, 'connected:', socket ? socket.connected : 'N/A');
  
  try {
    devLog('[refreshFriends] Using HTTP fallback');
    // Also fetch players data for username lookup
    const playersResponse = await fetch(API_BASE + '/players');
    const playersResult = await playersResponse.json();
    
    // Cache players data for friend requests
    if (playersResult.players) {
      cached_players = playersResult.players.map(p => [p.name, '', parseInt(p.id), '', '', p.job || 'Unemployed']);
      devLog('[refreshFriends] Cached', cached_players.length, 'players');
    }
    
    const response = await fetch(API_BASE + '/friends/' + currentUserId);
    const result = await response.json();
    const newFriendsData = result.friends || [];
    handleFriendsUpdate(newFriendsData);
  } catch (error) {
    devLog('[refreshFriends] Error:', error);
  }
}

function handleFriendsUpdate(newFriendsData) {
  devLog('[handleFriendsUpdate] Got', newFriendsData ? newFriendsData.length : 0, 'friends, data:', newFriendsData);
  
  if (!newFriendsData) {
    newFriendsData = [];
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
  lastUpdateTime = Math.floor(Date.now() / 1000);
  updateFriendsWindow();
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
    const hasRequest = activeLocationRequests.has(friend.friend_id);
    const isActive = activeLocationTracking.has(friend.friend_id);
    const buttonStyle = isActive ? 'background: #43a047; color: white;' : (hasRequest ? 'background: #ffa500; color: white;' : 'background: #5865f2; color: white;');
    const buttonText = isActive ? '📍✓' : (hasRequest ? '📍⏳' : '📍');
    const idText = hideIds ? '' : ' (ID: ' + friend.friend_id + ')';
    const spanStyle = hideIds ? 'flex: 0 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' : 'flex: 1;';
    devLog('[updateFriendsWindow] Friend', friend.name, '- hasRequest:', hasRequest, 'isActive:', isActive);
    return '<div style="display: flex; justify-content: space-between; align-items: center; line-height: 1; padding: 1px 0;"><span style="' + spanStyle + '">' + friend.name + idText + betaIndicator + ' (' + timeStr + ')</span><button onclick="toggleLocationRequest(' + friend.friend_id + ')" style="' + buttonStyle + ' border: none; border-radius: 3px; padding: 2px 6px; font-size: 0.7rem; cursor: pointer; flex-shrink: 0; margin-left: 5px;">' + buttonText + '</button></div>';
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
    return;
  }
  
  try {
    devLog('[removeFriendById] Using HTTP fallback');
    const response = await fetch(API_BASE + '/friend/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUserId, friend_id: friendId })
    });
    const result = await response.json();
    
    if (result.success) {
      document.getElementById('removeStatus').innerHTML = '<span class="status status-online">Friend removed!</span>';
      document.getElementById('removeFriendId').value = '';
      suppressOfflineNotifications = true;
      refreshFriends();
      setTimeout(() => suppressOfflineNotifications = false, 1000);
      showNotification('Friend removed!', 'success');
    } else {
      document.getElementById('removeStatus').innerHTML = '<span class="status status-error">' + result.error + '</span>';
      showNotification(result.error, 'error');
    }
  } catch (error) {
    document.getElementById('removeStatus').innerHTML = '<span class="status status-error">Connection error</span>';
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
    return;
  }
  
  try {
    devLog('[blockUser] Using HTTP fallback');
    const response = await fetch(API_BASE + '/user/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocker_id: currentUserId, blocked_id: blockId })
    });
    const result = await response.json();
    
    if (result.success) {
      document.getElementById('blockStatus').innerHTML = '<span class="status status-online">User blocked!</span>';
      document.getElementById('blockUserId').value = '';
      refreshFriends();
      showNotification('User blocked!', 'success');
    } else {
      document.getElementById('blockStatus').innerHTML = '<span class="status status-error">' + result.error + '</span>';
      showNotification(result.error, 'error');
    }
  } catch (error) {
    document.getElementById('blockStatus').innerHTML = '<span class="status status-error">Connection error</span>';
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
    return;
  }
  
  try {
    const response = await fetch(API_BASE + '/user/unblock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocker_id: currentUserId, blocked_id: unblockId })
    });
    const result = await response.json();
    
    if (response.ok && result.success) {
      document.getElementById('blockStatus').innerHTML = '<span class="status status-online">User unblocked!</span>';
      document.getElementById('blockUserId').value = '';
      showNotification('User unblocked!', 'success');
    } else {
      document.getElementById('blockStatus').innerHTML = '<span class="status status-error">' + result.error + '</span>';
      showNotification(result.error, 'error');
    }
  } catch (error) {
    document.getElementById('blockStatus').innerHTML = '<span class="status status-error">Connection error</span>';
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
    
    // Handle one-time location share
    if (window.pendingLocationShare) {
      devLog('[message] Location data received for one-time share:', locationData, 'to:', window.pendingLocationShare);
      shareLocationData(locationData, window.pendingLocationShare);
      window.pendingLocationShare = null;
    }
    
    // Handle automatic location sharing for accepted requests
    if (window.pendingAutoShare && acceptedLocationRequests.size > 0) {
      devLog('[message] Location data received for auto-share:', locationData, 'to:', Array.from(acceptedLocationRequests));
      acceptedLocationRequests.forEach(requesterId => {
        shareLocationData(locationData, requesterId);
      });
      window.pendingAutoShare = false;
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

async function refreshLocationRequests() {
  devLog('[refreshLocationRequests] Called');
  if (!currentUserId) {
    devLog('[refreshLocationRequests] No currentUserId, returning');
    return;
  }
  
  if (socket && socket.connected) {
    devLog('[refreshLocationRequests] Using WebSocket');
    socket.emit('get_location_requests', { user_id: currentUserId });
    return;
  }
  
  try {
    devLog('[refreshLocationRequests] Using HTTP fallback');
    const response = await fetch(API_BASE + '/location/requests/' + currentUserId);
    const result = await response.json();
    handleLocationRequestsUpdate(result.requests);
  } catch (error) {
    devLog('[refreshLocationRequests] Error:', error);
    document.getElementById('locationRequestsList').innerHTML = '<div style="text-align: center; color: #f44336; font-size: 0.8rem;">Error loading requests</div>';
  }
}

function handleLocationRequestsUpdate(requests) {
  devLog('[handleLocationRequestsUpdate] Processing requests:', requests);
  const locationRequestsList = document.getElementById('locationRequestsList');
  if (requests && requests.length > 0) {
    if (requests.length > lastLocationRequestCount && lastLocationRequestCount >= 0) {
      devLog('[handleLocationRequestsUpdate] New request detected, showing notification');
      showNotification('New location tracking request!', 'info');
    }
    lastLocationRequestCount = requests.length;
    
    locationRequestsList.innerHTML = requests.map(req => {
      devLog('[handleLocationRequestsUpdate] Processing incoming request:', req);
      if (req.status === 'pending') {
        return '<div class="request-item"><div><strong>' + req.requester_name + '</strong><div style="font-size: 0.7rem; color: #99aab5;">ID: ' + req.requester_id + ' • Wants to track your location</div></div><div><button onclick="acceptLocationRequest(' + req.requester_id + ')" style="background: #43a047; color: white; border: none; border-radius: 3px; padding: 6px 8px; margin-right: 4px; cursor: pointer;">Accept</button><button onclick="denyLocationRequest(' + req.requester_id + ')" style="background: #f44336; color: white; border: none; border-radius: 3px; padding: 6px 8px; cursor: pointer;">Deny</button></div></div>';
      } else {
        devLog('[handleLocationRequestsUpdate] Adding to acceptedLocationRequests:', req.requester_id);
        acceptedLocationRequests.add(String(req.requester_id));
        return '<div class="request-item"><div><strong>' + req.requester_name + '</strong><div style="font-size: 0.7rem; color: #99aab5;">ID: ' + req.requester_id + ' • Sharing location</div></div><div><button onclick="declineLocationRequest(' + req.requester_id + ')" style="background: #f44336; color: white; border: none; border-radius: 3px; padding: 6px 8px; cursor: pointer;">Stop</button></div></div>';
      }
    }).join('');
    
    devLog('[handleLocationRequestsUpdate] acceptedLocationRequests updated:', Array.from(acceptedLocationRequests));
  } else {
    if (lastLocationRequestCount === -1) lastLocationRequestCount = 0;
    else lastLocationRequestCount = 0;
    locationRequestsList.innerHTML = '<div style="text-align: center; color: #99aab5; font-size: 0.8rem; padding: 1rem;">No location requests</div>';
    devLog('[handleLocationRequestsUpdate] No incoming requests');
  }
}



async function acceptLocationRequest(requesterId) {
  if (socket && socket.connected) {
    socket.emit('accept_location_request', { requester_id: requesterId, target_id: currentUserId });
    return;
  }
  
  try {
    const response = await fetch(API_BASE + '/location/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester_id: requesterId, target_id: currentUserId })
    });
    const result = await response.json();
    
    if (result.success) {
      acceptedLocationRequests.add(String(requesterId));
      refreshLocationRequests();
      showNotification('Location sharing started', 'success');
    }
  } catch (error) {
    console.error('Error accepting location request:', error);
  }
}

async function denyLocationRequest(requesterId) {
  if (socket && socket.connected) {
    socket.emit('deny_location_request', { requester_id: requesterId, target_id: currentUserId });
    return;
  }
  
  try {
    const response = await fetch(API_BASE + '/location/deny', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester_id: requesterId, target_id: currentUserId })
    });
    const result = await response.json();
    
    if (result.success) {
      refreshLocationRequests();
      showNotification('Location request denied', 'info');
    }
  } catch (error) {
    console.error('Error denying location request:', error);
  }
}

async function declineLocationRequest(requesterId) {
  if (socket && socket.connected) {
    socket.emit('toggle_location_tracking', { requester_id: requesterId, target_id: currentUserId, active: false });
    acceptedLocationRequests.delete(String(requesterId));
    waypointNotificationShown.delete(requesterId);
    return;
  }
  
  try {
    const response = await fetch(API_BASE + '/location/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester_id: requesterId, target_id: currentUserId, active: false })
    });
    const result = await response.json();
    
    if (result.success) {
      acceptedLocationRequests.delete(String(requesterId));
      waypointNotificationShown.delete(requesterId);
      refreshLocationRequests();
      showNotification('Location tracking stopped', 'info');
    }
  } catch (error) {
    console.error('Error stopping location tracking:', error);
  }
}

let activeLocationTracking = new Set();

async function updateLocationTrackingStatus() {
  devLog('[updateLocationTrackingStatus] Called');
  if (!currentUserId) {
    devLog('[updateLocationTrackingStatus] No currentUserId, returning');
    return;
  }
  
  if (socket && socket.connected) {
    devLog('[updateLocationTrackingStatus] Using WebSocket');
    socket.emit('get_location_tracking', { user_id: currentUserId });
    return;
  }
  
  try {
    devLog('[updateLocationTrackingStatus] Using HTTP fallback');
    const response = await fetch(API_BASE + '/location/sent/' + currentUserId);
    const result = await response.json();
    handleLocationTrackingUpdate(result.requests);
  } catch (error) {
    devLog('[updateLocationTrackingStatus] Error:', error);
  }
}

function handleLocationTrackingUpdate(requests) {
  devLog('[handleLocationTrackingUpdate] Processing requests:', requests);
  
  // Store previous state for comparison
  const prevRequests = new Set(activeLocationRequests);
  const prevTracking = new Set(activeLocationTracking);
  
  // Only manage outgoing requests (what you sent to others)
  activeLocationRequests.clear();
  activeLocationTracking.clear();
  if (requests) {
    requests.forEach(req => {
      devLog('[handleLocationTrackingUpdate] Processing request:', req);
      if (req.status === 'pending') {
        activeLocationRequests.add(req.target_id);
      } else if (req.status === 'active') {
        activeLocationTracking.add(req.target_id);
      }
    });
  }
  
  devLog('[handleLocationTrackingUpdate] Updated state:');
  devLog('  activeLocationRequests:', Array.from(activeLocationRequests));
  devLog('  activeLocationTracking:', Array.from(activeLocationTracking));
  
  // Log changes
  const requestChanges = [...activeLocationRequests].filter(x => !prevRequests.has(x)).concat([...prevRequests].filter(x => !activeLocationRequests.has(x)));
  const trackingChanges = [...activeLocationTracking].filter(x => !prevTracking.has(x)).concat([...prevTracking].filter(x => !activeLocationTracking.has(x)));
  if (requestChanges.length > 0) devLog('[handleLocationTrackingUpdate] Request changes:', requestChanges);
  if (trackingChanges.length > 0) devLog('[handleLocationTrackingUpdate] Tracking changes:', trackingChanges);
}

setInterval(() => {
  if (currentUserId) {
    refreshRequests();
    refreshFriends();
    refreshLocationRequests();
    checkLocationRequests();
    updateLocationTrackingStatus();
    checkAdminNotifications();
  }
}, 5000);

setInterval(() => {
  if (friendsWindowVisible) {
    updateFriendsWindow();
  }
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