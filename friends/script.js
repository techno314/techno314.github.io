const API_BASE = 'https://api.grayflare.space';
let currentUserId = '';
let devMode = false;

function devLog(...args) {
  if (devMode) console.log(...args);
}

function showNotification(message, type = 'info') {
  devLog('[showNotification] Message:', message, 'Type:', type);
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Play notification sound if enabled
  if (soundEnabled) {
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
  devLog('[toggleLocationRequest] State check - hasRequest:', hasRequest, 'isActiveTracking:', isActiveTracking);
  devLog('[toggleLocationRequest] activeLocationRequests:', Array.from(activeLocationRequests));
  devLog('[toggleLocationRequest] activeLocationTracking:', Array.from(activeLocationTracking));
  
  // Allow all states: blue (send), orange (cancel), green (stop)
  
  // Don't show pending message if actively tracking (green state)
  if (isActiveTracking) {
    devLog('[toggleLocationRequest] Active tracking detected - allowing stop');
  }
  
  const willActivate = !(hasRequest || isActiveTracking);
  devLog('[toggleLocationRequest] Will activate:', willActivate);
  
  // Add cooldown
  toggleCooldown.add(friendId);
  setTimeout(() => toggleCooldown.delete(friendId), 2000);
  
  try {
    const requestBody = { requester_id: currentUserId, target_id: friendId, active: willActivate };
    devLog('[toggleLocationRequest] Sending request:', requestBody);
    
    const response = await fetch(API_BASE + '/location/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const text = await response.text();
      devLog('[toggleLocationRequest] Server error:', response.status, text);
      showNotification('Server error: ' + response.status, 'error');
      return;
    }
    
    const result = await response.json();
    devLog('[toggleLocationRequest] Server response:', result);
    
    if (result.success) {
      if (!hasRequest && !isActiveTracking) {
        // Sending new request
        devLog('[toggleLocationRequest] Adding to activeLocationRequests:', friendId);
        activeLocationRequests.add(String(friendId));
        showNotification('Location request sent to ' + friendId, 'success');
      } else if (hasRequest || isActiveTracking) {
        // Stopping existing request/tracking
        devLog('[toggleLocationRequest] Removing from tracking sets:', friendId);
        activeLocationRequests.delete(String(friendId));
        activeLocationTracking.delete(String(friendId));
        waypointNotificationShown.delete(String(friendId));
        showNotification('Location tracking stopped for ' + friendId, 'info');
      }
      updateFriendsWindow();
    } else {
      devLog('[toggleLocationRequest] Server returned error:', result.error);
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

async function checkLocationRequests() {
  devLog('[checkLocationRequests] Called');
  if (!currentUserId) {
    devLog('[checkLocationRequests] No currentUserId, returning');
    return;
  }
  
  try {
    devLog('[checkLocationRequests] Fetching received locations for user:', currentUserId);
    const response = await fetch(API_BASE + '/location/received/' + currentUserId);
    const result = await response.json();
    devLog('[checkLocationRequests] Server response:', result);
    
    if (result.locations && result.locations.length > 0) {
      devLog('[checkLocationRequests] Processing', result.locations.length, 'locations');
      result.locations.forEach(loc => {
        devLog('[checkLocationRequests] Setting waypoint from:', loc.sharer_name, 'at:', loc.pos_x, loc.pos_y);
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ 
            type: 'setWaypoint', 
            x: loc.pos_x, 
            y: loc.pos_y 
          }, '*');
        }
      });
    } else {
      devLog('[checkLocationRequests] No locations received');
    }
  } catch (error) {
    devLog('[checkLocationRequests] Error:', error);
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
  
  try {
    const requestBody = { sender_id: currentUserId, receiver_id: targetUser };
    devLog('[sendFriendRequest] Sending request:', requestBody);
    const response = await fetch(API_BASE + '/friend/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    const result = await response.json();
    devLog('[sendFriendRequest] Server response:', result);
    
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
  try {
    const requestBody = { sender_id: senderId, receiver_id: currentUserId };
    devLog('[acceptRequest] Sending request:', requestBody);
    const response = await fetch(API_BASE + '/friend/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    const result = await response.json();
    devLog('[acceptRequest] Server response:', result);
    
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
  try {
    const requestBody = { sender_id: senderId, receiver_id: currentUserId };
    devLog('[declineRequest] Sending request:', requestBody);
    const response = await fetch(API_BASE + '/friend/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    const result = await response.json();
    devLog('[declineRequest] Server response:', result);
    
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
  
  try {
    devLog('[refreshRequests] Fetching friend requests for user:', currentUserId);
    const response = await fetch(API_BASE + '/friend/requests/' + currentUserId);
    const result = await response.json();
    
    const requestsList = document.getElementById('requestsList');
    if (result.requests && result.requests.length > 0) {
      if (result.requests.length > lastRequestCount && lastRequestCount >= 0) {
        showNotification('New friend request received!', 'info');
      }
      lastRequestCount = result.requests.length;
      
      // Get player names for the requests
      const namesMap = {};
      if (cached_players) {
        for (const player of cached_players) {
          namesMap[player[2]] = player[0];
        }
      }
      
      requestsList.innerHTML = result.requests.map(req => {
        const senderName = namesMap[parseInt(req.sender_id)] || 'Unknown';
        return '<div class="request-item"><div><strong>' + senderName + '</strong><div style="font-size: 0.7rem; color: #99aab5;">ID: ' + req.sender_id + ' • ' + new Date(req.created_at).toUTCString() + '</div></div><div><button onclick="acceptRequest(\'' + req.sender_id + '\')" style="background: #43a047; color: white; border: none; border-radius: 3px; padding: 6px 8px; margin-right: 4px; cursor: pointer;">✓</button><button onclick="declineRequest(\'' + req.sender_id + '\')" style="background: #f44336; color: white; border: none; border-radius: 3px; padding: 6px 8px; cursor: pointer;">×</button></div></div>';
      }).join('');
    } else {
      if (lastRequestCount === -1) lastRequestCount = 0;
      else lastRequestCount = 0;
      requestsList.innerHTML = '<div style="text-align: center; color: #99aab5; font-size: 0.8rem; padding: 1rem;">No pending requests</div>';
    }
  } catch (error) {
    document.getElementById('requestsList').innerHTML = '<div style="text-align: center; color: #f44336; font-size: 0.8rem;">Error loading requests</div>';
  }
}

let friendsData = [];
let friendsWindowVisible = localStorage.getItem('friendsWindowVisible') === 'true';
let lastUpdateTime = Math.floor(Date.now() / 1000);
let cached_players = [];
let soundEnabled = localStorage.getItem('soundEnabled') !== 'false';
let previousOnlineFriends = new Set();
let activeLocationRequests = new Set();

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
  
  try {
    devLog('[refreshFriends] Fetching players and friends data');
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
    devLog('[refreshFriends] Got', newFriendsData.length, 'friends');
    
    // Check for friend join/leave notifications
    if (friendsData.length > 0) {
      const currentOnlineFriends = new Set(newFriendsData.filter(f => f.online).map(f => f.friend_id));
      
      // Check for friends who came online
      currentOnlineFriends.forEach(friendId => {
        if (!previousOnlineFriends.has(friendId)) {
          const friend = newFriendsData.find(f => f.friend_id === friendId);
          if (friend) {
            devLog('[refreshFriends] Friend came online:', friend.name);
            showNotification(friend.name + ' came online', 'success');
          }
        }
      });
      
      // Check for friends who went offline
      previousOnlineFriends.forEach(friendId => {
        if (!currentOnlineFriends.has(friendId)) {
          const friend = friendsData.find(f => f.friend_id === friendId);
          if (friend) {
            devLog('[refreshFriends] Friend went offline:', friend.name);
            showNotification(friend.name + ' went offline', 'info');
          }
        }
      });
      
      previousOnlineFriends = currentOnlineFriends;
    } else {
      previousOnlineFriends = new Set(newFriendsData.filter(f => f.online).map(f => f.friend_id));
    }
    
    friendsData = newFriendsData;
    lastUpdateTime = Math.floor(Date.now() / 1000);
    updateFriendsWindow();
  } catch (error) {
    devLog('[refreshFriends] Error:', error);
  }
}

function updateFriendsWindow() {
  devLog('[updateFriendsWindow] Called, visible:', friendsWindowVisible, 'friends count:', friendsData.length);
  if (!friendsWindowVisible || friendsData.length === 0) {
    friendsWindow.style.display = 'none';
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
    const isActive = activeLocationTracking.has(friend.friend_id) || acceptedLocationRequests.has(friend.friend_id);
    const buttonStyle = isActive ? 'background: #43a047; color: white;' : (hasRequest ? 'background: #ffa500; color: white;' : 'background: #5865f2; color: white;');
    const buttonText = isActive ? '📍✓' : (hasRequest ? '📍⏳' : '📍');
    devLog('[updateFriendsWindow] Friend', friend.name, '- hasRequest:', hasRequest, 'isActive:', isActive);
    return '<div style="display: flex; justify-content: space-between; align-items: center; line-height: 1; padding: 1px 0;"><span>' + friend.name + ' (ID: ' + friend.friend_id + ')' + betaIndicator + ' (' + timeStr + ')</span><button onclick="toggleLocationRequest(' + friend.friend_id + ')" style="' + buttonStyle + ' border: none; border-radius: 3px; padding: 2px 6px; font-size: 0.7rem; cursor: pointer;">' + buttonText + '</button></div>';
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



async function removeFriend(friendId) {
  if (!currentUserId) return;
  
  try {
    const response = await fetch(API_BASE + '/friend/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUserId, friend_id: friendId })
    });
    const result = await response.json();
    
    if (result.success) {
      refreshFriends();
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
  
  try {
    const response = await fetch(API_BASE + '/friend/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUserId, friend_id: friendId })
    });
    const result = await response.json();
    
    if (result.success) {
      document.getElementById('removeStatus').innerHTML = '<span class="status status-online">Friend removed!</span>';
      document.getElementById('removeFriendId').value = '';
      refreshFriends();
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
  
  try {
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
    refreshRequests();
    refreshFriends();
    refreshLocationRequests();
    updateLocationTrackingStatus();
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
  
  try {
    devLog('[refreshLocationRequests] Fetching incoming requests for user:', currentUserId);
    const response = await fetch(API_BASE + '/location/requests/' + currentUserId);
    const result = await response.json();
    devLog('[refreshLocationRequests] Server response:', result);
    
    const locationRequestsList = document.getElementById('locationRequestsList');
    if (result.requests && result.requests.length > 0) {
      if (result.requests.length > lastLocationRequestCount && lastLocationRequestCount >= 0) {
        devLog('[refreshLocationRequests] New request detected, showing notification');
        showNotification('New location tracking request!', 'info');
      }
      lastLocationRequestCount = result.requests.length;
      
      const prevAccepted = new Set(acceptedLocationRequests);
      
      locationRequestsList.innerHTML = result.requests.map(req => {
        devLog('[refreshLocationRequests] Processing incoming request:', req);
        if (req.status === 'pending') {
          return '<div class="request-item"><div><strong>' + req.requester_name + '</strong><div style="font-size: 0.7rem; color: #99aab5;">ID: ' + req.requester_id + ' • Wants to track your location</div></div><div><button onclick="acceptLocationRequest(' + req.requester_id + ')" style="background: #43a047; color: white; border: none; border-radius: 3px; padding: 6px 8px; margin-right: 4px; cursor: pointer;">Accept</button><button onclick="denyLocationRequest(' + req.requester_id + ')" style="background: #f44336; color: white; border: none; border-radius: 3px; padding: 6px 8px; cursor: pointer;">Deny</button></div></div>';
        } else {
          devLog('[refreshLocationRequests] Adding to acceptedLocationRequests:', req.requester_id);
          acceptedLocationRequests.add(String(req.requester_id));
          return '<div class="request-item"><div><strong>' + req.requester_name + '</strong><div style="font-size: 0.7rem; color: #99aab5;">ID: ' + req.requester_id + ' • Sharing location</div></div><div><button onclick="declineLocationRequest(' + req.requester_id + ')" style="background: #f44336; color: white; border: none; border-radius: 3px; padding: 6px 8px; cursor: pointer;">Stop</button></div></div>';
        }
      }).join('');
      
      devLog('[refreshLocationRequests] acceptedLocationRequests updated:', Array.from(acceptedLocationRequests));
    } else {
      if (lastLocationRequestCount === -1) lastLocationRequestCount = 0;
      else lastLocationRequestCount = 0;
      locationRequestsList.innerHTML = '<div style="text-align: center; color: #99aab5; font-size: 0.8rem; padding: 1rem;">No location requests</div>';
      devLog('[refreshLocationRequests] No incoming requests');
    }
  } catch (error) {
    devLog('[refreshLocationRequests] Error:', error);
    document.getElementById('locationRequestsList').innerHTML = '<div style="text-align: center; color: #f44336; font-size: 0.8rem;">Error loading requests</div>';
  }
}



async function acceptLocationRequest(requesterId) {
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
  
  try {
    devLog('[updateLocationTrackingStatus] Fetching sent requests for user:', currentUserId);
    const response = await fetch(API_BASE + '/location/sent/' + currentUserId);
    const result = await response.json();
    devLog('[updateLocationTrackingStatus] Server response:', result);
    
    // Store previous state for comparison
    const prevRequests = new Set(activeLocationRequests);
    const prevTracking = new Set(activeLocationTracking);
    
    // Only manage outgoing requests (what you sent to others)
    activeLocationRequests.clear();
    activeLocationTracking.clear();
    if (result.requests) {
      result.requests.forEach(req => {
        devLog('[updateLocationTrackingStatus] Processing request:', req);
        if (req.status === 'pending') {
          activeLocationRequests.add(req.target_id);
        } else if (req.status === 'active') {
          activeLocationTracking.add(req.target_id);
        }
      });
    }
    
    devLog('[updateLocationTrackingStatus] Updated state:');
    devLog('  activeLocationRequests:', Array.from(activeLocationRequests));
    devLog('  activeLocationTracking:', Array.from(activeLocationTracking));
    devLog('  acceptedLocationRequests:', Array.from(acceptedLocationRequests));
    
    // Log changes
    const requestChanges = [...activeLocationRequests].filter(x => !prevRequests.has(x)).concat([...prevRequests].filter(x => !activeLocationRequests.has(x)));
    const trackingChanges = [...activeLocationTracking].filter(x => !prevTracking.has(x)).concat([...prevTracking].filter(x => !activeLocationTracking.has(x)));
    if (requestChanges.length > 0) devLog('[updateLocationTrackingStatus] Request changes:', requestChanges);
    if (trackingChanges.length > 0) devLog('[updateLocationTrackingStatus] Tracking changes:', trackingChanges);
    
    updateFriendsWindow();
  } catch (error) {
    devLog('[updateLocationTrackingStatus] Error:', error);
  }
}

setInterval(() => {
  if (currentUserId) {
    refreshRequests();
    refreshFriends();
    refreshLocationRequests();
    checkLocationRequests();
    updateLocationTrackingStatus();
  }
}, 5000);

setInterval(() => {
  if (friendsWindowVisible) {
    updateFriendsWindow();
  }
}, 1000);

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