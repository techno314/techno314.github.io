        // --- Constants for localStorage keys ---
        const LOCAL_STORAGE_PIN_ENABLED_KEY = 'money-tracker-pinEnabled';
        const LOCAL_STORAGE_POSITION_KEY = 'money-tracker-position';
        const LOCAL_STORAGE_SIZE_KEY = 'money-tracker-size';

        // New persistence keys
        const LOCAL_STORAGE_IS_TRACKING_KEY = 'money-tracker-isTracking';
        const LOCAL_STORAGE_START_TIME_KEY = 'money-tracker-startTime'; // This will now store sessionStartTime
        const LOCAL_STORAGE_STARTING_WALLET_KEY = 'money-tracker-startingWallet'; // This will now store sessionStartingWallet
        const LOCAL_STORAGE_CURRENT_WALLET_KEY = 'money-tracker-currentWallet';
        const LOCAL_STORAGE_TOTAL_MONEY_MADE_KEY = 'money-tracker-totalMoneyMade';
        const LOCAL_STORAGE_TOTAL_TIME_TRACKED_MS_KEY = 'money-tracker-totalTimeTrackedMs';

        // --- State and Visibility Management ---
        let lastKnownState = { focused: false, tabbed: false };
        let pinEnabled = localStorage.getItem(LOCAL_STORAGE_PIN_ENABLED_KEY) === 'true';

        function updateVisibility(newState) {
            if (newState) {
                lastKnownState.focused = newState.focused ?? lastKnownState.focused;
                lastKnownState.tabbed = newState.tabbed ?? lastKnownState.tabbed;
            }

            const { focused, tabbed } = lastKnownState;
            const shouldBeVisible = focused || tabbed || pinEnabled;
            const moneyTrackerContainer = document.getElementById('moneyTrackerContainer');
            moneyTrackerContainer.style.display = shouldBeVisible ? 'flex' : 'none';

            const shouldBeHighlighted = focused || pinEnabled;
            moneyTrackerContainer.style.border = 'var(--container-border)';
        }

        function sendCommand(command) {
            if (window.parent && window.parent !== window) {
                window.parent.postMessage(command, '*');
            }
        }

        class MoneyTracker {
            constructor() {
                this.isTracking = false;
                this.sessionStartTime = null; // Renamed from startTime
                this.sessionStartingWallet = 0; // Renamed from startingWallet
                this.currentWallet = 0;
                this.isConnected = false;
                this.updateInterval = null;
                this.totalMoneyMade = 0; // New property for accumulated money
                this.totalTimeTrackedMs = 0; // New property for accumulated time in milliseconds
                
                this.initializeElements();
                this.attachEventListeners();
                this.requestGameData();
                this.loadState(); // Load state on initialization
                
                // Update display every second when tracking
                setInterval(() => {
                    if (this.isTracking) {
                        this.updateDisplay();
                    }
                }, 1000);

                // Save state periodically
                setInterval(() => {
                    this.saveState();
                }, 1000); // Save every 1 seconds
            }

            saveState() {
                localStorage.setItem(LOCAL_STORAGE_IS_TRACKING_KEY, this.isTracking.toString());
                // Only save session-specific data if tracking is active
                if (this.isTracking) {
                    localStorage.setItem(LOCAL_STORAGE_START_TIME_KEY, this.sessionStartTime ? this.sessionStartTime.toISOString() : '');
                    localStorage.setItem(LOCAL_STORAGE_STARTING_WALLET_KEY, this.sessionStartingWallet.toString());
                } else {
                    // Clear session-specific data if not tracking
                    localStorage.removeItem(LOCAL_STORAGE_START_TIME_KEY);
                    localStorage.removeItem(LOCAL_STORAGE_STARTING_WALLET_KEY);
                }
                localStorage.setItem(LOCAL_STORAGE_CURRENT_WALLET_KEY, this.currentWallet.toString());
                localStorage.setItem(LOCAL_STORAGE_TOTAL_MONEY_MADE_KEY, this.totalMoneyMade.toString());
                localStorage.setItem(LOCAL_STORAGE_TOTAL_TIME_TRACKED_MS_KEY, this.totalTimeTrackedMs.toString());
            }

            loadState() {
                // Always default to tracking being stopped on load
                this.isTracking = false; 
                // Load accumulated data
                this.totalMoneyMade = parseFloat(localStorage.getItem(LOCAL_STORAGE_TOTAL_MONEY_MADE_KEY) || '0');
                this.totalTimeTrackedMs = parseFloat(localStorage.getItem(LOCAL_STORAGE_TOTAL_TIME_TRACKED_MS_KEY) || '0');
                this.currentWallet = parseFloat(localStorage.getItem(LOCAL_STORAGE_CURRENT_WALLET_KEY) || '0');

                // Session-specific data is NOT loaded here, it's set when tracking starts
                this.sessionStartTime = null;
                this.sessionStartingWallet = 0;

                // Update UI based on loaded state
                this.updateDisplay();
                this.updateTrackingStatus();

                // Adjust button states to reflect tracking being stopped
                this.elements.startBtn.disabled = false;
                this.elements.stopBtn.disabled = true;
            }

            initializeElements() {
                this.elements = {
                    connectionStatus: document.getElementById('connectionStatus'),
                    currentWallet: document.getElementById('currentWallet'),
                    compactWallet: document.getElementById('compactWallet'),
                    trackingStatus: document.getElementById('trackingStatus'),
                    compactStatus: document.getElementById('compactStatus'),
                    moneyMade: document.getElementById('moneyMade'),
                    compactMoneyMade: document.getElementById('compactMoneyMade'),
                    timeTracked: document.getElementById('timeTracked'),
                    compactTimeTracked: document.getElementById('compactTimeTracked'),
                    moneyPerHour: document.getElementById('moneyPerHour'),
                    compactRate: document.getElementById('compactRate'),
                    moneyPerMinute: document.getElementById('moneyPerMinute'),
                    startBtn: document.getElementById('startTrackingBtn'),
                    stopBtn: document.getElementById('stopTrackingBtn'),
                    resetBtn: document.getElementById('resetBtn'),
                    activityLog: document.getElementById('activityLog')
                };
            }

            attachEventListeners() {
                this.elements.startBtn.addEventListener('click', () => this.startTracking());
                this.elements.stopBtn.addEventListener('click', () => this.stopTracking());
                this.elements.resetBtn.addEventListener('click', () => this.reset());

                // Listen for messages from game client
                window.addEventListener('message', (event) => {
                    if (typeof event.data === 'object' && event.data !== null) {
                        this.handleGameData(event.data);
                    }
                });
            }

            handleGameData(data) {
                // Ignore empty data objects
                if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
                    return;
                }

                if (!this.isConnected) {
                    this.isConnected = true;
                    this.updateConnectionStatus();
                    this.addLogEntry('Connected to game data stream');
                }

                // The actual game data is nested in the 'data' property
                const gameData = data.data;
                
                if (gameData && typeof gameData === 'object') {
                    // Check for wallet property in the nested data
                    if (gameData.hasOwnProperty('wallet') && typeof gameData.wallet === 'number') {
                        const newWallet = gameData.wallet;
                        const walletChange = newWallet - this.currentWallet;
                        
                        // Log wallet detection
                        if (this.currentWallet === 0) {
                            this.addLogEntry(`Initial wallet detected: $${this.formatNumber(newWallet)}`);
                        } else if (Math.abs(walletChange) > 0.01) {
                            if (walletChange > 0) {
                                this.addLogEntry(`Wallet increased by $${this.formatNumber(walletChange)}`, 'earnings');
                            } else {
                                this.addLogEntry(`Wallet decreased by $${this.formatNumber(Math.abs(walletChange))}`, 'loss');
                            }
                        }
                        
                        this.currentWallet = newWallet;
                        this.updateDisplay();
                        this.saveState(); // Save state when wallet changes
                    }
                }

                // Handle visibility based on game client messages
                if (gameData && typeof gameData === 'object' && typeof gameData.focused === 'boolean') {
                    updateVisibility({ focused: gameData.focused, tabbed: gameData.tabbed });
                }
            }

            startTracking() {
                if (this.currentWallet <= 0) {
                    this.addLogEntry('Cannot start tracking - no wallet data received');
                    return;
                }

                this.isTracking = true;
                this.sessionStartTime = new Date(); // Use sessionStartTime
                this.sessionStartingWallet = this.currentWallet; // Use sessionStartingWallet
                
                this.elements.startBtn.disabled = true;
                this.elements.stopBtn.disabled = false;
                
                this.updateTrackingStatus();
                this.addLogEntry(`Started tracking with wallet balance: ${this.formatNumber(this.sessionStartingWallet)}`);
                this.updateDisplay();
                this.saveState(); // Save state after starting tracking
            }

            stopTracking() {
                if (!this.isTracking) return;

                // Calculate money made and time tracked for this session
                const moneyMadeThisSession = this.currentWallet - this.sessionStartingWallet;
                const timeElapsedThisSessionMs = new Date() - this.sessionStartTime;

                // Add to total accumulated values
                this.totalMoneyMade += moneyMadeThisSession;
                this.totalTimeTrackedMs += timeElapsedThisSessionMs;

                this.isTracking = false;
                this.sessionStartTime = null; // Clear session start time
                this.sessionStartingWallet = 0; // Clear session starting wallet
                
                this.elements.startBtn.disabled = false;
                this.elements.stopBtn.disabled = true;
                
                this.updateTrackingStatus();
                
                const timeElapsedFormatted = this.formatTime(timeElapsedThisSessionMs);
                this.addLogEntry(`Stopped tracking. Made ${this.formatNumber(moneyMadeThisSession)} in ${timeElapsedFormatted}`);
                this.saveState(); // Save state after stopping tracking
            }

            reset() {
                this.isTracking = false;
                this.sessionStartTime = null;
                this.sessionStartingWallet = 0;
                this.totalMoneyMade = 0; // Reset total money made
                this.totalTimeTrackedMs = 0; // Reset total time tracked

                // Clear localStorage
                localStorage.removeItem(LOCAL_STORAGE_IS_TRACKING_KEY);
                localStorage.removeItem(LOCAL_STORAGE_START_TIME_KEY);
                localStorage.removeItem(LOCAL_STORAGE_STARTING_WALLET_KEY);
                localStorage.removeItem(LOCAL_STORAGE_CURRENT_WALLET_KEY);
                localStorage.removeItem(LOCAL_STORAGE_TOTAL_MONEY_MADE_KEY);
                localStorage.removeItem(LOCAL_STORAGE_TOTAL_TIME_TRACKED_MS_KEY);
                
                this.elements.startBtn.disabled = false;
                this.elements.stopBtn.disabled = true;
                
                this.updateTrackingStatus();
                this.updateDisplay();
                this.addLogEntry('Tracker reset');
                this.saveState(); // Save the reset state
            }

            updateDisplay() {
                // Current wallet (both normal and compact)
                const walletText = `${this.formatNumber(this.currentWallet)}`;
                this.elements.currentWallet.textContent = walletText;
                this.elements.compactWallet.textContent = walletText;

                let currentMoneyMade = this.totalMoneyMade;
                let currentTotalTimeTrackedMs = this.totalTimeTrackedMs;

                if (this.isTracking && this.sessionStartTime) {
                    const sessionElapsedMs = new Date() - this.sessionStartTime;
                    currentTotalTimeTrackedMs += sessionElapsedMs;
                    currentMoneyMade += (this.currentWallet - this.sessionStartingWallet);
                }

                const timeElapsedFormatted = this.formatTime(currentTotalTimeTrackedMs);
                const moneyMadeText = `${this.formatNumber(currentMoneyMade)}`;

                this.elements.moneyMade.textContent = moneyMadeText;
                this.elements.compactMoneyMade.textContent = moneyMadeText;
                this.elements.timeTracked.textContent = timeElapsedFormatted;
                this.elements.compactTimeTracked.textContent = timeElapsedFormatted;

                // Calculate rates
                const elapsedMinutes = currentTotalTimeTrackedMs / (1000 * 60);
                const elapsedHours = elapsedMinutes / 60;

                let rateText = '$0/hr';
                if (elapsedHours > 0) {
                    const moneyPerHour = currentMoneyMade / elapsedHours;
                    rateText = `${this.formatNumber(moneyPerHour)}/hr`;
                    this.elements.moneyPerHour.textContent = rateText;
                } else {
                    this.elements.moneyPerHour.textContent = '$0/hr';
                }
                this.elements.compactRate.textContent = rateText;

                if (elapsedMinutes > 0) {
                    const moneyPerMinute = currentMoneyMade / elapsedMinutes;
                    this.elements.moneyPerMinute.textContent = `${this.formatNumber(moneyPerMinute)}/min`;
                } else {
                    this.elements.moneyPerMinute.textContent = '$0/min';
                }
            }

            formatTime(ms) {
                if (ms < 0) ms = 0;
                const hours = Math.floor(ms / (1000 * 60 * 60));
                const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((ms % (1000 * 60)) / 1000);
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }

            updateConnectionStatus() {
                if (this.isConnected) {
                    this.elements.connectionStatus.textContent = 'Connected';
                    this.elements.connectionStatus.className = 'connection-status connected';
                } else {
                    this.elements.connectionStatus.textContent = 'Disconnected';
                    this.elements.connectionStatus.className = 'connection-status disconnected';
                }
            }

            updateTrackingStatus() {
                const statusElement = this.elements.trackingStatus;
                const compactStatusElement = this.elements.compactStatus;
                
                if (this.isTracking) {
                    statusElement.innerHTML = '<span class="status-dot"></span><span>Tracking Active</span>';
                    statusElement.className = 'status-indicator status-active';
                    compactStatusElement.className = 'compact-status status-active';
                } else {
                    statusElement.innerHTML = '<span class="status-dot"></span><span>Tracking Inactive</span>';
                    statusElement.className = 'status-indicator status-inactive';
                    compactStatusElement.className = 'compact-status status-inactive';
                }
            }

            getElapsedTime() {
                if (!this.startTime) return '00:00:00';
                
                const now = new Date();
                const elapsed = now - this.startTime;
                
                const hours = Math.floor(elapsed / (1000 * 60 * 60));
                const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);
                
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }

            getElapsedMinutes() {
                if (!this.startTime) return 0;
                const now = new Date();
                return (now - this.startTime) / (1000 * 60);
            }

            formatNumber(num) {
                if (num === null || num === undefined || isNaN(num)) return '0';
                
                // Round to whole numbers for display
                const rounded = Math.round(num);
                
                // Add commas for thousands separator
                return rounded.toLocaleString('en-US', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                });
            }

            addLogEntry(message, type = 'info') {
                const timestamp = new Date().toLocaleTimeString();
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                
                let messageClass = 'message';
                if (type === 'earnings') {
                    messageClass += ' earnings-highlight';
                } else if (type === 'loss') {
                    messageClass += ' loss-highlight';
                }
                
                logEntry.innerHTML = `
                    <span class="timestamp">[${timestamp}]</span>
                    <span class="${messageClass}">${message}</span>
                `;
                
                this.elements.activityLog.appendChild(logEntry);
                this.elements.activityLog.scrollTop = this.elements.activityLog.scrollHeight;
                
                // Keep only last 20 log entries
                while (this.elements.activityLog.children.length > 20) {
                    this.elements.activityLog.removeChild(this.elements.activityLog.firstChild);
                }
            }

            requestGameData() {
                // Send command to request initial data
                sendCommand({ type: 'getData' });
            }
        }

        // --- Dragging and Resizing Logic ---
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        function initializeDragAndResize() {
            const moneyTrackerContainer = document.getElementById('moneyTrackerContainer');
            
            // Restore saved position based on current mode
            function restorePosition() {
                const isCompact = moneyTrackerContainer.classList.contains('compact-mode');
                const positionKey = isCompact ? 'money-tracker-compact-position' : LOCAL_STORAGE_POSITION_KEY;
                const savedPosition = JSON.parse(localStorage.getItem(positionKey) || '{}');
                
                if (savedPosition.x !== undefined && savedPosition.y !== undefined) {
                    moneyTrackerContainer.style.left = `${savedPosition.x}px`;
                    moneyTrackerContainer.style.top = `${savedPosition.y}px`;
                } else if (isCompact) {
                    // Default compact position (top-right)
                    moneyTrackerContainer.style.left = 'auto';
                    moneyTrackerContainer.style.right = '20px';
                    moneyTrackerContainer.style.top = '20px';
                }
            }

            restorePosition();

            // Restore saved size (only for normal mode)
            let savedSize = JSON.parse(localStorage.getItem(LOCAL_STORAGE_SIZE_KEY) || '{}');
            if (savedSize.width !== undefined && savedSize.height !== undefined && !moneyTrackerContainer.classList.contains('compact-mode')) {
                const minWidth = parseInt(window.getComputedStyle(moneyTrackerContainer).minWidth) || 400;
                const minHeight = parseInt(window.getComputedStyle(moneyTrackerContainer).minHeight) || 500;
                const width = Math.max(savedSize.width, minWidth);
                const height = Math.max(savedSize.height, minHeight);
                moneyTrackerContainer.style.width = width + 'px';
                moneyTrackerContainer.style.height = height + 'px';
                savedSize = { width, height };
            }

            // Drag functionality (on header)
            const header = document.querySelector('#moneyTrackerContainer header');
            header.addEventListener("mousedown", (e) => {
                e.preventDefault(); // Prevent text selection
                // Allow dragging in both normal and compact mode
                const style = window.getComputedStyle(moneyTrackerContainer);
                const cursor = style.getPropertyValue('cursor');
                if (cursor.includes('resize')) {
                    isDragging = false;
                    return;
                }
                
                // In normal mode, check for resize edges
                if (!moneyTrackerContainer.classList.contains('compact-mode')) {
                    const rect = moneyTrackerContainer.getBoundingClientRect();
                    const edgeSize = 10;
                    if (
                        e.clientX >= rect.right - edgeSize ||
                        e.clientX <= rect.left + edgeSize ||
                        e.clientY >= rect.bottom - edgeSize ||
                        e.clientY <= rect.top + edgeSize
                    ) {
                        isDragging = false;
                        return;
                    }
                }
                
                isDragging = true;
                offsetX = e.clientX - moneyTrackerContainer.offsetLeft;
                offsetY = e.clientY - moneyTrackerContainer.offsetTop;
            });

            document.addEventListener("mouseup", () => isDragging = false);

            let rafScheduled = false;
            let savePositionDebounceTimeout = null;
            const DEBOUNCE_TIME = 50; // milliseconds

            document.addEventListener("mousemove", (e) => {
                if (isDragging) {
                    const newX = e.clientX - offsetX;
                    const newY = e.clientY - offsetY;

                    if (!rafScheduled) {
                        rafScheduled = true;
                        requestAnimationFrame(() => {
                            moneyTrackerContainer.style.left = `${newX}px`;
                            moneyTrackerContainer.style.top = `${newY}px`;
                            rafScheduled = false;
                        });
                    }

                    // Debounce localStorage.setItem
                    if (savePositionDebounceTimeout) {
                        clearTimeout(savePositionDebounceTimeout);
                    }
                    savePositionDebounceTimeout = setTimeout(() => {
                        const positionKey = moneyTrackerContainer.classList.contains('compact-mode') 
                            ? 'money-tracker-compact-position' 
                            : LOCAL_STORAGE_POSITION_KEY;
                        localStorage.setItem(positionKey, JSON.stringify({ x: newX, y: newY }));
                    }, DEBOUNCE_TIME);
                }
            });

            // Persist resize using ResizeObserver with debounce
            let resizeTimeout = null;
            const resizeObserver = new ResizeObserver(entries => {
                if (resizeTimeout) clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    for (let entry of entries) {
                        let width = moneyTrackerContainer.offsetWidth;
                        let height = moneyTrackerContainer.offsetHeight;
                        const minWidth = parseInt(window.getComputedStyle(moneyTrackerContainer).minWidth) || 400;
                        const minHeight = parseInt(window.getComputedStyle(moneyTrackerContainer).minHeight) || 500;
                        width = Math.max(width, minWidth);
                        height = Math.max(height, minHeight);
                        localStorage.setItem(LOCAL_STORAGE_SIZE_KEY, JSON.stringify({ width: Math.round(width), height: Math.round(height) }));
                    }
                }, 1);
            });

            resizeObserver.observe(moneyTrackerContainer);
        }

        // --- Pin Toggle Button Logic ---
        function initializePinLogic() {
            const pinToggleBtn = document.getElementById('pinToggleBtn');
            const moneyTrackerContainer = document.getElementById('moneyTrackerContainer');

            function updatePinButton() {
                if (pinEnabled) {
                    pinToggleBtn.textContent = 'Unpin';
                    pinToggleBtn.style.backgroundColor = 'rgba(220,53,69,0.7)';
                    moneyTrackerContainer.classList.add('compact-mode');
                    
                    // Restore compact position or set default
                    const savedCompactPosition = JSON.parse(localStorage.getItem('money-tracker-compact-position') || '{}');
                    if (savedCompactPosition.x !== undefined && savedCompactPosition.y !== undefined) {
                        moneyTrackerContainer.style.left = `${savedCompactPosition.x}px`;
                        moneyTrackerContainer.style.top = `${savedCompactPosition.y}px`;
                        moneyTrackerContainer.style.right = 'auto';
                    }
                    else {
                        // Default to top-right corner
                        moneyTrackerContainer.style.left = 'auto';
                        moneyTrackerContainer.style.right = '20px';
                        moneyTrackerContainer.style.top = '20px';
                    }
                }
                else {
                    pinToggleBtn.textContent = 'Pin Panel: Off';
                    pinToggleBtn.style.backgroundColor = 'rgba(70,130,180,0.5)';
                    moneyTrackerContainer.classList.remove('compact-mode');
                    
                    // Restore normal position
                    const savedNormalPosition = JSON.parse(localStorage.getItem(LOCAL_STORAGE_POSITION_KEY) || '{}');
                    if (savedNormalPosition.x !== undefined && savedNormalPosition.y !== undefined) {
                        moneyTrackerContainer.style.left = `${savedNormalPosition.x}px`;
                        moneyTrackerContainer.style.top = `${savedNormalPosition.y}px`;
                        moneyTrackerContainer.style.right = 'auto';
                    }
                }
                if (window.moneyTrackerInstance) {
                    window.moneyTrackerInstance.updateDisplay();
                }
            }

            pinToggleBtn.addEventListener('click', () => {
                pinEnabled = !pinEnabled;
                localStorage.setItem(LOCAL_STORAGE_PIN_ENABLED_KEY, pinEnabled.toString());
                updatePinButton();
                updateVisibility();
            });

            updatePinButton();
        }

        // Handle ESC key to send pin command
        window.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                sendCommand({ type: "pin" });
            }
        });

        // Initialize everything when the page loads
        document.addEventListener('DOMContentLoaded', () => {
            window.moneyTrackerInstance = new MoneyTracker();
            initializeDragAndResize();
            initializePinLogic();

            // Prevent text selection and native drag-and-drop on the entire document
            document.addEventListener('selectstart', (e) => {
                e.preventDefault();
            });
            document.addEventListener('dragstart', (e) => {
                e.preventDefault();
            });
        });

        // Request an initial data dump when the app loads (like bk.html line 324)
        sendCommand({ type: 'getData' });