const API_BASE = 'https://api.grayflare.space';
let currentUserId = '';

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // Play notification sound if enabled
  if (soundEnabled) {
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
  soundEnabled = !soundEnabled;
  localStorage.setItem('soundEnabled', soundEnabled);
  document.getElementById('soundToggle').textContent = soundEnabled ? '🔊' : '🔇';
}

async function toggleLocationRequest(friendId) {
  if (!currentUserId) return;
  
  const hasRequest = activeLocationRequests.has(friendId);
  const isActiveTracking = activeLocationTracking.has(friendId);
  
  // If there's already a pending request (orange state), don't allow new requests
  if (hasRequest && !isActiveTracking) {
    showNotification('Location request already pending', 'info');
    return;
  }
  
  try {
    const response = await fetch(API_BASE + '/location/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester_id: currentUserId, target_id: friendId, active: !hasRequest })
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.error('Server error:', response.status, text);
      showNotification('Server error: ' + response.status, 'error');
      return;
    }
    
    const result = await response.json();
    
    if (result.success) {
      if (!hasRequest) {
        activeLocationRequests.add(friendId);
        showNotification('Location request sent to ' + friendId, 'success');
      } else {
        activeLocationRequests.delete(friendId);
        activeLocationTracking.delete(friendId);
        waypointNotificationShown.delete(friendId);
        showNotification('Location tracking stopped for ' + friendId, 'info');
      }
      updateFriendsWindow();
    } else {
      showNotification(result.error, 'error');
    }
  } catch (error) {
    console.error('Error toggling location request:', error);
    showNotification('Connection error', 'error');
  }
}

let activeLocationSharing = new Set();
let acceptedLocationRequests = new Set();

function startLocationSharing() {
  setInterval(async () => {
    if (currentUserId && acceptedLocationRequests.size > 0) {
      // Request current location from game
      if (window.parent && window.parent !== window) {
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
  fetch(API_BASE + '/location/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      sharer_id: currentUserId, 
      requester_id: requesterId,
      location: locationData
    })
  }).then(response => response.json())
  .then(result => {
    // No notification needed - waypoint notification handles this
  }).catch(error => {
    console.error('Error sharing location:', error);
  });
}

let waypointNotificationShown = new Set();

async function checkLocationRequests() {
  if (!currentUserId) return;
  
  try {
    const response = await fetch(API_BASE + '/location/received/' + currentUserId);
    const result = await response.json();
    
    if (result.locations && result.locations.length > 0) {
      result.locations.forEach(loc => {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ 
            type: 'setWaypoint', 
            x: loc.pos_x, 
            y: loc.pos_y 
          }, '*');
          if (!waypointNotificationShown.has(loc.sharer_id)) {
            showNotification('Waypoint set from ' + loc.sharer_name, 'success');
            waypointNotificationShown.add(loc.sharer_id);
          }
        }
      });
    }
  } catch (error) {
    console.error('Error checking location requests:', error);
  }
}

async function sendFriendRequest() {
  if (!currentUserId) {
    document.getElementById('sendStatus').innerHTML = '<span class="status status-error">Set your user ID first</span>';
    return;
  }
  
  const targetUser = document.getElementById('targetUser').value;
  if (!targetUser) return;
  
  try {
    const response = await fetch(API_BASE + '/friend/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_id: currentUserId, receiver_id: targetUser })
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
    document.getElementById('sendStatus').innerHTML = '<span class="status status-error">Connection error</span>';
  }
}

async function acceptRequest(senderId) {
  try {
    const response = await fetch(API_BASE + '/friend/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_id: senderId, receiver_id: currentUserId })
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
    console.error('Error accepting request:', error);
    showNotification('Connection error', 'error');
  }
}

async function declineRequest(senderId) {
  try {
    const response = await fetch(API_BASE + '/friend/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_id: senderId, receiver_id: currentUserId })
    });
    const result = await response.json();
    
    if (result.success) {
      refreshRequests();
      showNotification('Friend request declined', 'info');
    } else {
      showNotification(result.error || 'Failed to decline request', 'error');
    }
  } catch (error) {
    console.error('Error declining request:', error);
    showNotification('Connection error', 'error');
  }
}

let lastRequestCount = -1;

async function refreshRequests() {
  if (!currentUserId) return;
  
  try {
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
  if (!currentUserId) return;
  
  try {
    // Also fetch players data for username lookup
    const playersResponse = await fetch(API_BASE + '/players');
    const playersResult = await playersResponse.json();
    
    // Cache players data for friend requests
    if (playersResult.players) {
      cached_players = playersResult.players.map(p => [p.name, '', parseInt(p.id), '', '', p.job || 'Unemployed']);
    }
    
    const response = await fetch(API_BASE + '/friends/' + currentUserId);
    const result = await response.json();
    const newFriendsData = result.friends || [];
    
    // Check for friend join/leave notifications
    if (friendsData.length > 0) {
      const currentOnlineFriends = new Set(newFriendsData.filter(f => f.online).map(f => f.friend_id));
      
      // Check for friends who came online
      currentOnlineFriends.forEach(friendId => {
        if (!previousOnlineFriends.has(friendId)) {
          const friend = newFriendsData.find(f => f.friend_id === friendId);
          if (friend) {
            showNotification(friend.name + ' came online', 'success');
          }
        }
      });
      
      // Check for friends who went offline
      previousOnlineFriends.forEach(friendId => {
        if (!currentOnlineFriends.has(friendId)) {
          const friend = friendsData.find(f => f.friend_id === friendId);
          if (friend) {
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
    console.error('Error loading friends:', error);
  }
}

function updateFriendsWindow() {
  if (!friendsWindowVisible || friendsData.length === 0) {
    friendsWindow.style.display = 'none';
    return;
  }
  
  friendsWindow.style.display = 'block';
  const onlineFriends = friendsData.filter(f => f.online);
  
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
    return '<div style="display: flex; justify-content: space-between; align-items: center; line-height: 1; padding: 1px 0;"><span>' + friend.name + ' (ID: ' + friend.friend_id + ')' + betaIndicator + ' (' + timeStr + ')</span><button onclick="toggleLocationRequest(' + friend.friend_id + ')" style="' + buttonStyle + ' border: none; border-radius: 3px; padding: 2px 6px; font-size: 0.7rem; cursor: pointer;">' + buttonText + '</button></div>';
  }).join('');
  
  friendsWindow.innerHTML = header + friendsList;
}

function toggleFriendsWindow() {
  friendsWindowVisible = !friendsWindowVisible;
  localStorage.setItem('friendsWindowVisible', friendsWindowVisible);
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
    updateVisibility({ focused: payload.focused, tabbed: payload.tabbed });
  }
  
  if (payload.user_id && !currentUserId) {
    currentUserId = payload.user_id.toString();
    document.getElementById('userStatus').innerHTML = '<div class="user-id-display">User ID: ' + currentUserId + '</div>';
    refreshRequests();
    refreshFriends();
  }
  
  // Handle location data response
  if (payload.pos_x && payload.pos_y) {
    const locationData = {
      pos_x: payload.pos_x,
      pos_y: payload.pos_y
    };
    
    // Handle one-time location share
    if (window.pendingLocationShare) {
      shareLocationData(locationData, window.pendingLocationShare);
      window.pendingLocationShare = null;
    }
    
    // Handle automatic location sharing for accepted requests
    if (window.pendingAutoShare && acceptedLocationRequests.size > 0) {
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
  if (!currentUserId) return;
  
  try {
    const response = await fetch(API_BASE + '/location/requests/' + currentUserId);
    const result = await response.json();
    
    const locationRequestsList = document.getElementById('locationRequestsList');
    if (result.requests && result.requests.length > 0) {
      if (result.requests.length > lastLocationRequestCount && lastLocationRequestCount >= 0) {
        showNotification('New location tracking request!', 'info');
      }
      lastLocationRequestCount = result.requests.length;
      
      locationRequestsList.innerHTML = result.requests.map(req => {
        if (req.status === 'pending') {
          return '<div class="request-item"><div><strong>' + req.requester_name + '</strong><div style="font-size: 0.7rem; color: #99aab5;">ID: ' + req.requester_id + ' • Wants to track your location</div></div><div><button onclick="acceptLocationRequest(' + req.requester_id + ')" style="background: #43a047; color: white; border: none; border-radius: 3px; padding: 6px 8px; margin-right: 4px; cursor: pointer;">Accept</button><button onclick="denyLocationRequest(' + req.requester_id + ')" style="background: #f44336; color: white; border: none; border-radius: 3px; padding: 6px 8px; cursor: pointer;">Deny</button></div></div>';
        } else {
          acceptedLocationRequests.add(req.requester_id);
          return '<div class="request-item"><div><strong>' + req.requester_name + '</strong><div style="font-size: 0.7rem; color: #99aab5;">ID: ' + req.requester_id + ' • Sharing location</div></div><div><button onclick="declineLocationRequest(' + req.requester_id + ')" style="background: #f44336; color: white; border: none; border-radius: 3px; padding: 6px 8px; cursor: pointer;">Stop</button></div></div>';
        }
      }).join('');
    } else {
      if (lastLocationRequestCount === -1) lastLocationRequestCount = 0;
      else lastLocationRequestCount = 0;
      locationRequestsList.innerHTML = '<div style="text-align: center; color: #99aab5; font-size: 0.8rem; padding: 1rem;">No location requests</div>';
    }
  } catch (error) {
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
      acceptedLocationRequests.add(requesterId);
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
      acceptedLocationRequests.delete(requesterId);
      waypointNotificationShown.delete(requesterId);
      refreshLocationRequests();
      showNotification('Location tracking stopped', 'info');
    }
  } catch (error) {
    console.error('Error stopping location tracking:', error);
  }
}

let activeLocationTracking = new Set();

async function syncActiveLocationRequests() {
  if (!currentUserId) return;
  
  try {
    const response = await fetch(API_BASE + '/location/sent/' + currentUserId);
    const result = await response.json();
    
    // Get all requests where current user is the requester
    const serverRequestTargets = new Set();
    const serverActiveTargets = new Set();
    if (result.requests) {
      result.requests.forEach(req => {
        serverRequestTargets.add(req.target_id);
        if (req.status === 'active') {
          serverActiveTargets.add(req.target_id);
        }
      });
    }
    
    // Sync local state with server state
    const toRemove = [];
    const toAdd = [];
    
    // Remove requests that no longer exist on server
    activeLocationRequests.forEach(friendId => {
      if (!serverRequestTargets.has(friendId)) {
        toRemove.push(friendId);
      }
    });
    
    // Add requests that exist on server but not locally
    serverRequestTargets.forEach(friendId => {
      if (!activeLocationRequests.has(friendId)) {
        toAdd.push(friendId);
      }
    });
    
    // Update active tracking set
    activeLocationTracking.clear();
    serverActiveTargets.forEach(friendId => {
      activeLocationTracking.add(friendId);
    });
    
    toRemove.forEach(friendId => {
      activeLocationRequests.delete(friendId);
      waypointNotificationShown.delete(friendId);
    });
    
    toAdd.forEach(friendId => {
      activeLocationRequests.add(friendId);
    });
    
    if (toRemove.length > 0 || toAdd.length > 0) {
      updateFriendsWindow();
    }
  } catch (error) {
    console.error('Error syncing location requests:', error);
  }
}

setInterval(() => {
  if (currentUserId) {
    refreshRequests();
    refreshFriends();
    refreshLocationRequests();
    checkLocationRequests();
    syncActiveLocationRequests();
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