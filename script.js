// Make windows draggable
const windows = document.querySelectorAll('.window');
windows.forEach(window => {
  const header = window.querySelector('.window-header');
  header.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const offsetX = e.clientX - window.offsetLeft;
    const offsetY = e.clientY - window.offsetTop;

    const onMouseMove = (e) => {
      window.style.left = `${e.clientX - offsetX}px`;
      window.style.top = `${e.clientY - offsetY}px`;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
});

// Timer functionality
let timerInterval;
let time = 0;
const timerDisplay = document.getElementById('timer-display');

function updateTimer() {
  const hours = Math.floor(time / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((time % 3600) / 60).toString().padStart(2, '0');
  const seconds = (time % 60).toString().padStart(2, '0');
  timerDisplay.textContent = `${hours}:${minutes}:${seconds}`;
}

function timerEnd() {
  let flashCount = 0;
  const flashInterval = setInterval(() => {
    timerDisplay.style.visibility = timerDisplay.style.visibility === 'hidden' ? 'visible' : 'hidden';
    flashCount++;
    if (flashCount >= 6) {
      clearInterval(flashInterval);
      timerDisplay.style.visibility = 'visible';
    }
  }, 200);

  timerDisplay.classList.add('rainbow');
  setTimeout(() => {
    timerDisplay.classList.remove('rainbow');
  }, 5000);

  const sound = new Audio('https://cdn.pixabay.com/download/audio/2021/08/09/audio_3ddd1e5402.mp3?filename=bomb-countdown-beeps-6868.mp3');
  sound.volume = 0.3;
  sound.play();
}

document.getElementById('start-timer').addEventListener('click', () => {
  if (!timerInterval) {
    timerInterval = setInterval(() => {
      time--;
      if (time <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        time = 0;
        timerEnd();
      }
      updateTimer();
    }, 1000);
  }
});

document.getElementById('pause-timer').addEventListener('click', () => {
  clearInterval(timerInterval);
  timerInterval = null;
});

document.getElementById('stop-timer').addEventListener('click', () => {
  clearInterval(timerInterval);
  timerInterval = null;
  time = 0;
  updateTimer();
});

document.getElementById('reset-timer').addEventListener('click', () => {
  time = 0;
  updateTimer();
});

document.getElementById('add-1').addEventListener('click', () => {
  time += 60;
  updateTimer();
});

document.getElementById('add-5').addEventListener('click', () => {
  time += 300;
  updateTimer();
});

document.getElementById('add-10').addEventListener('click', () => {
  time += 600;
  updateTimer();
});

// Video player functionality
let player;
let sponsorSegments = [];
let currentVideoId = null;
let isAdblockEnabled = false;
let isSponsorBlockEnabled = false;

const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
  // The API will call this function when it's ready.
}

document.getElementById('load-video').addEventListener('click', () => {
  const urlOrId = document.getElementById('video-url').value.trim();
  const videoFrame = document.getElementById('video-frame');
  const playerDiv = document.getElementById('player');

  if (!urlOrId) {
    return;
  }

  let videoId = extractYouTubeVideoId(urlOrId);
  if (!videoId && /^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) {
    videoId = urlOrId;
  }

  if (videoId) {
    playerDiv.style.display = 'block';
    videoFrame.style.display = 'none';
    videoFrame.src = ''; // Clear iframe src
    currentVideoId = videoId;

    if (player) {
        player.destroy();
    }

    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        host: isAdblockEnabled ? 'https://www.youtube-nocookie.com' : 'https://www.youtube.com',
        playerVars: {
            'playsinline': 1,
            'origin': window.location.origin,
            'autoplay': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
  } else if (urlOrId.includes('twitch.tv')) {
    const embedUrl = getTwitchEmbedUrl(urlOrId);
    if (embedUrl) {
      playerDiv.style.display = 'none';
      videoFrame.style.display = 'block';
      if (player) {
        player.destroy();
        player = null;
      }
      currentVideoId = null;
      videoFrame.src = embedUrl;
    } else {
      alert('Invalid Twitch URL.');
    }
  } else if (urlOrId.includes('kick.com')) {
    const embedUrl = getKickEmbedUrl(urlOrId);
    if (embedUrl) {
      playerDiv.style.display = 'none';
      videoFrame.style.display = 'block';
      if (player) {
        player.destroy();
        player = null;
      }
      currentVideoId = null;
      videoFrame.src = embedUrl;
    } else {
      alert('Invalid Kick URL.');
    }
  } else {
    // Fallback for other URLs
    playerDiv.style.display = 'none';
    videoFrame.style.display = 'block';
    if (player) {
        player.destroy();
        player = null;
    }
    currentVideoId = null;
    videoFrame.src = urlOrId;
  }
});

function onPlayerReady(event) {
  if (isSponsorBlockEnabled) {
    fetchSponsorSegments(currentVideoId);
  }
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING && isSponsorBlockEnabled) {
    checkSponsorSegments();
  } else {
    clearInterval(sponsorCheckInterval);
  }
}

let sponsorCheckInterval;

function checkSponsorSegments() {
    clearInterval(sponsorCheckInterval);
    sponsorCheckInterval = setInterval(() => {
        if (player && player.getPlayerState() === YT.PlayerState.PLAYING) {
            const currentTime = player.getCurrentTime();
            for (const segment of sponsorSegments) {
                if (currentTime >= segment.segment[0] && currentTime < segment.segment[1]) {
                    player.seekTo(segment.segment[1]);
                }
            }
        }
    }, 500);
}

async function fetchSponsorSegments(videoId) {
  if (!videoId) return;
  try {
    const response = await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}`);
    if (response.ok) {
      sponsorSegments = await response.json();
    } else {
      sponsorSegments = [];
    }
  } catch (error) {
    console.error('Error fetching sponsor segments:', error);
    sponsorSegments = [];
  }
}

function extractYouTubeVideoId(url) {
  const regex = /(?:youtube\.com\/(?:[^/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

function getTwitchEmbedUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const pathSegments = parsedUrl.pathname.split('/').filter(p => p);
    let type, id;

    if (pathSegments.length >= 3 && pathSegments[1] === 'v') {
      type = 'video';
      id = pathSegments[2];
    } else if (pathSegments.length >= 3 && pathSegments[1] === 'clip') {
      type = 'clip';
      id = pathSegments[2];
    } else if (pathSegments.length >= 1) {
      type = 'channel';
      id = pathSegments[0];
    } else {
      return null;
    }

    const parentHost = window.location.hostname || 'localhost';
    return `https://player.twitch.tv/?${type}=${encodeURIComponent(id)}&parent=${parentHost}`;
  } catch (e) {
    return null;
  }
}

function getKickEmbedUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const pathSegments = parsedUrl.pathname.split('/').filter(p => p);

    if (pathSegments.length >= 1) {
      const channelName = pathSegments[0];
      return `https://player.kick.com/${channelName}`;
    } else {
      return null;
    }
  } catch (e) {
    return null;
  }
}

const settingsButton = document.getElementById('settings-button');
const settingsPanel = document.getElementById('global-settings');

settingsButton.addEventListener('click', () => {
  settingsPanel.style.display = settingsPanel.style.display === 'block' ? 'none' : 'block';
});

function setGlobalOpacity(opacity) {
  windows.forEach(window => {
    window.style.opacity = opacity;
  });
}

function toggleWindow(windowId) {
  const window = document.querySelector(`.${windowId}`);
  if (window.style.display === 'none' || window.style.display === '') {
    window.style.display = 'block';
  } else {
    window.style.display = 'none';
  }
}

document.getElementById('adblock-toggle').addEventListener('click', (event) => {
  isAdblockEnabled = !isAdblockEnabled;
  event.target.classList.toggle('active', isAdblockEnabled);
  if (player && currentVideoId) {
    const currentTime = player.getCurrentTime();
    player.destroy();
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: currentVideoId,
        host: isAdblockEnabled ? 'https://www.youtube-nocookie.com' : 'https://www.youtube.com',
        playerVars: {
            'playsinline': 1,
            'origin': window.location.origin,
            'start': Math.floor(currentTime)
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
  }
});

document.getElementById('sponsorblock-toggle').addEventListener('click', (event) => {
  isSponsorBlockEnabled = !isSponsorBlockEnabled;
  event.target.classList.toggle('active', isSponsorBlockEnabled);
  if (isSponsorBlockEnabled && currentVideoId) {
    fetchSponsorSegments(currentVideoId);
    checkSponsorSegments();
  } else {
    clearInterval(sponsorCheckInterval);
    sponsorSegments = [];
  }
});

let isWatchingMode = false;
let watchModeClicks = 0;
let watchModeTimer = null;
const superSecretButton = document.getElementById('super-secret-button');

function toggleWatchingMode() {
  const videoWindow = document.querySelector('.video-window');
  const watchToggleButton = document.getElementById('watch-toggle');

  isWatchingMode = !isWatchingMode;

  if (isWatchingMode) {
    videoWindow.classList.add('watching-mode');
    watchToggleButton.textContent = 'Change Video';
  } else {
    videoWindow.classList.remove('watching-mode');
    watchToggleButton.textContent = 'Watching Mode';
  }

  watchModeClicks++;
  if (watchModeClicks === 2) {
    superSecretButton.style.display = 'block';
    watchModeClicks = 0;
    if (watchModeTimer) clearTimeout(watchModeTimer);
    watchModeTimer = setTimeout(() => {
      superSecretButton.style.display = 'none';
    }, 500000);
  }
}

function openSecretWindow() {
  const secretWindow = document.createElement('div');
  secretWindow.className = 'window secret-window';
  secretWindow.innerHTML = `
    <div class="window-header">
      <span>:plp:</span>
    </div>
    <div class="window-content">
      <iframe src="https://www.youtube.com/embed/xvFZjo5PgG0?autoplay=1" allowfullscreen></iframe>
    </div>
  `;

  document.body.appendChild(secretWindow);

  setTimeout(() => {
    secretWindow.remove();
  }, 9000);
}