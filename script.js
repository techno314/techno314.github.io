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
document.getElementById('load-video').addEventListener('click', () => {
  const url = document.getElementById('video-url').value.trim();
  const videoFrame = document.getElementById('video-frame');

  if (url) {
    // Check for YouTube URLs
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const videoId = extractYouTubeVideoId(url);
      if (videoId) {
        videoFrame.src = `https://www.youtube.com/embed/${videoId}`;
      } else {
        alert('Invalid YouTube URL. Please enter a valid YouTube link.');
      }
    }
    // Check for Twitch URLs
    else if (url.includes('twitch.tv')) {
      const embedUrl = getTwitchEmbedUrl(url);
      if (embedUrl) {
        videoFrame.src = embedUrl;
      } else {
        alert('Invalid Twitch URL. Please enter a valid Twitch channel, video, or clip URL.');
      }
    }
    // Check for Kick URLs
    else if (url.includes('kick.com')) {
      const embedUrl = getKickEmbedUrl(url);
      if (embedUrl) {
        videoFrame.src = embedUrl;
      }
      else {
        alert('Invalid Kick URL. Please enter a valid Kick channel URL.');
      }
    }
    // Handle other URLs
    else {
      videoFrame.src = url;
    }
  }
});

// Function to extract YouTube video ID from URL
function extractYouTubeVideoId(url) {
  const regex = /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Function to handle Twitch URLs
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

    // Use the current hostname for the parent parameter
    const parentHost = window.location.hostname || 'localhost';
    return `https://player.twitch.tv/?${type}=${encodeURIComponent(id)}&parent=${parentHost}`;
  } catch (e) {
    return null;
  }
}

// Function to handle Kick URLs
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

// Global settings functionality
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
    window.style.display = 'block'; // Show the window
  } else {
    window.style.display = 'none'; // Hide the window
  }
}

// Watching Mode functionality
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

  // Track clicks for Super Secret Button
  watchModeClicks++;
  if (watchModeClicks === 2) {
    superSecretButton.style.display = 'block'; // Show the Super Secret Button
    watchModeClicks = 0; // Reset click counter
    if (watchModeTimer) clearTimeout(watchModeTimer); // Reset the timer
    watchModeTimer = setTimeout(() => {
      superSecretButton.style.display = 'none'; // Hide the button after 500 seconds
    }, 500000); // 500 seconds
  }
}

// Super Secret Button functionality
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

  // Remove the secret window after 9 seconds
  setTimeout(() => {
    secretWindow.remove();
  }, 9000); // 9 seconds
}