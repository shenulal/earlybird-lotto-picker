// Global variables
let tickets = [];
let winners = [];
let rolling = false;
let intervalId;
let appSettings = {}; // Application settings loaded from appsettings.json
let confettiTimeoutId = null; // Track confetti timeout

// DOM elements
const slot = document.getElementById("slot");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const resetBtn = document.getElementById("resetBtn");
const totalPrizesEl = document.getElementById("totalPrizes");
const remainingPrizesEl = document.getElementById("remainingPrizes");
const winnersCountEl = document.getElementById("winnersCount");
const winnersListEl = document.getElementById("winnersList");
const loadingEl = document.getElementById("loading");

// Initialize the application
async function init() {
  try {
    await loadAppSettings();
    await loadTickets();
    applySettings();
    updateStats();
    hideLoading();
  } catch (error) {
    console.error("Failed to initialize application:", error);
    slot.innerHTML = "<span>❌ Failed to load application</span>";
    hideLoading();
  }
}

// Load application settings from appsettings.json
async function loadAppSettings() {
  try {
    const response = await fetch('appsettings.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    appSettings = data.appSettings;
    console.log('Loaded application settings:', appSettings);
  } catch (error) {
    console.error("Error loading app settings:", error);
    // Use default settings if file not found
    appSettings = {
      totalPrizes: 10,
      eventName: "Earlybird Lottery 2024",
      organizationName: "Your Organization",
      animation: { rollingSpeed: 80, confettiDuration: 5000, confettiCount: 150, winnerAnnouncementDelay: 2000, confettiStartDelay: 500 },
      display: { showMobileInWinner: true, showTicketIdInAnimation: true, autoStopWhenPrizesExhausted: true },
      ui: { primaryColor: "#ffeb3b", backgroundColor: "radial-gradient(circle at top, #1d2671, #c33764)", showOrganizationName: true }
    };
  }
}

// Apply settings to the application
function applySettings() {
  // Update page title and heading if specified
  if (appSettings.eventName) {
    document.title = appSettings.eventName;
    const heading = document.getElementById('eventTitle');
    if (heading) {
      heading.innerHTML = `${appSettings.eventName}`;
    }
  }

  // Show organization name if configured
  if (appSettings.ui.showOrganizationName && appSettings.organizationName) {
    const orgNameEl = document.getElementById('organizationName');
    if (orgNameEl) {
      orgNameEl.textContent = appSettings.organizationName;
      orgNameEl.style.display = 'block';
    }
  }

  console.log(`Application configured with ${appSettings.totalPrizes} total prizes`);
}

// Load tickets from JSON file
async function loadTickets() {
  try {
    const response = await fetch('tickets.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    tickets = shuffle([...data.tickets]); // Create a copy and shuffle
    console.log(`Loaded ${tickets.length} tickets with ${appSettings.totalPrizes} total prizes`);
  } catch (error) {
    console.error("Error loading tickets:", error);
    throw error;
  }
}

// Fisher-Yates shuffle algorithm
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Update statistics display
function updateStats() {
  const remainingPrizes = appSettings.totalPrizes - winners.length;
  totalPrizesEl.textContent = appSettings.totalPrizes;
  remainingPrizesEl.textContent = Math.max(0, remainingPrizes);
  winnersCountEl.textContent = winners.length;
}

// Hide loading screen
function hideLoading() {
  loadingEl.classList.add('hidden');
}

// Start the slot machine
function startSlot() {
  if (rolling) return;

  // Check if we've reached the maximum number of prizes
  if (winners.length >= appSettings.totalPrizes) {
    slot.innerHTML = "<span>🎉 All prizes have been awarded!</span>";
    return;
  }

  const candidates = tickets.filter(t => t.processed === 0);
  if (candidates.length === 0) {
    slot.innerHTML = "<span>🎉 All tickets processed!</span>";
    return;
  }

  // Clear any existing confetti only when starting a new round
  clearConfetti();

  rolling = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  slot.classList.add('rolling');

  intervalId = setInterval(() => {
    const availableTickets = tickets.filter(t => t.processed === 0);
    if (availableTickets.length === 0) {
      stopSlot();
      return;
    }

    const randomTicket = availableTickets[Math.floor(Math.random() * availableTickets.length)];
    slot.innerHTML = `
      <span style="font-size: 2.5rem; font-weight: bold; color: ${appSettings.ui.primaryColor};">
        ${randomTicket.ticket}
      </span>
    `;
  }, appSettings.animation.rollingSpeed); // Rolling speed from settings
}

// Stop the slot machine and select winner
function stopSlot() {
  if (!rolling) return;

  clearInterval(intervalId);
  rolling = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  slot.classList.remove('rolling');

  // Check if we've reached the maximum number of prizes
  if (winners.length >= appSettings.totalPrizes) {
    slot.innerHTML = "<span>🎉 All prizes have been awarded!</span>";
    return;
  }

  const candidates = tickets.filter(t => t.processed === 0);
  if (candidates.length === 0) {
    slot.innerHTML = "<span>🎉 All tickets processed!</span>";
    return;
  }

  // Select a random winner
  const winner = candidates[Math.floor(Math.random() * candidates.length)];
  winner.processed = 1;

  // Calculate prize number BEFORE adding to winners array
  const prizeNumber = winners.length + 1;

  winners.push({
    ...winner,
    timestamp: new Date().toLocaleString()
  });

  // Show dramatic winner announcement with animation
  showWinnerAnnouncement(winner, prizeNumber);
}

// Reset the lottery
function resetLottery() {
  if (rolling) {
    clearInterval(intervalId);
    rolling = false;
  }

  // Clear confetti
  clearConfetti();

  // Reset all tickets
  tickets.forEach(ticket => ticket.processed = 0);
  winners = [];

  // Shuffle tickets again
  tickets = shuffle(tickets);

  // Reset UI
  slot.innerHTML = "<span>Press Start 🎰</span>";
  startBtn.disabled = false;
  stopBtn.disabled = true;
  slot.classList.remove('rolling');

  // Update displays
  updateStats();
  updateWinnersList();

  console.log("Lottery reset - all tickets are available again");
}

// Show dramatic winner announcement with different animations
async function showWinnerAnnouncement(winner, prizeNumber) {
  const animations = [
    'fadeInScale', 'slideInFromLeft', 'bounceIn', 'rotateIn', 'flipIn',
    'zoomIn', 'slideInFromTop', 'slideInFromRight', 'slideInFromBottom', 'pulseIn'
  ];

  // Get animation based on prize number (cycle through animations)
  const animationType = animations[(prizeNumber - 1) % animations.length];

  // Step 1: Show "WINNER!" announcement with delay
  slot.innerHTML = `
    <div class="winner-announcement ${animationType}">
      <div class="winner-title">🎉 WINNER! 🎉</div>
      <div class="prize-number">Prize #${prizeNumber}</div>
    </div>
  `;

  // Step 2: After 2 seconds, reveal the winner details
  setTimeout(() => {
    const mobileDisplay = appSettings.display.showMobileInWinner && winner.mobile ? `📱 ${winner.mobile}<br>` : '';
    slot.innerHTML = `
      <div class="winner-details-reveal ${animationType}">
        <div class="winner-name-big">${winner.name}</div>
        <div class="winner-info">
          ${winner.college}<br>
          ${mobileDisplay}
          🎫 ${winner.ticket}
        </div>
      </div>
    `;

    // Update stats and winners list
    updateStats();
    updateWinnersList();

    // Launch confetti after winner is revealed
    setTimeout(() => {
      startConfetti();
    }, appSettings.animation.confettiStartDelay || 500);

  }, appSettings.animation.winnerAnnouncementDelay || 2000);
}

// Update winners list display
function updateWinnersList() {
  if (winners.length === 0) {
    winnersListEl.innerHTML = '<p class="no-winners">No winners yet. Start the lottery!</p>';
    return;
  }

  winnersListEl.innerHTML = winners.map((winner, index) => {
    const mobileDisplay = appSettings.display.showMobileInWinner && winner.mobile ? ` | 📱 ${winner.mobile}` : '';
    return `
      <div class="winner-item">
        <div class="winner-name">#${index + 1} - ${winner.name}</div>
        <div class="winner-details">
          ${winner.college} | 🎫 ${winner.ticket}${mobileDisplay}<br>
          <small style="opacity: 0.7;">🕒 ${winner.timestamp}</small>
        </div>
      </div>
    `;
  }).join('');
}

// Confetti Animation System
const confettiCanvas = document.getElementById("confettiCanvas");
const ctx = confettiCanvas.getContext("2d");
let confettiPieces = [];
let confettiAnimationId;

// Resize canvas
function resizeCanvas() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}

// Confetti piece constructor
function ConfettiPiece() {
  this.x = Math.random() * confettiCanvas.width;
  this.y = Math.random() * confettiCanvas.height - confettiCanvas.height;
  this.size = Math.random() * 8 + 4;
  this.speed = Math.random() * 3 + 2;
  this.color = `hsl(${Math.random() * 360}, 100%, 50%)`;
  this.rotation = Math.random() * 360;
  this.rotationSpeed = (Math.random() - 0.5) * 10;
  this.opacity = Math.random() * 0.8 + 0.2;
}

// Clear confetti animation
function clearConfetti() {
  confettiPieces = [];
  if (confettiAnimationId) {
    cancelAnimationFrame(confettiAnimationId);
    confettiAnimationId = null;
  }
  // Clear any pending confetti timeout
  if (confettiTimeoutId) {
    clearTimeout(confettiTimeoutId);
    confettiTimeoutId = null;
  }
  // Clear the canvas
  ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

// Start confetti animation
function startConfetti() {
  // Clear any existing confetti first
  clearConfetti();

  confettiPieces = [];
  for (let i = 0; i < appSettings.animation.confettiCount; i++) {
    confettiPieces.push(new ConfettiPiece());
  }
  animateConfetti();

  // Stop confetti after configured duration
  confettiTimeoutId = setTimeout(() => {
    clearConfetti();
  }, appSettings.animation.confettiDuration);
}

// Animate confetti
function animateConfetti() {
  ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  
  confettiPieces.forEach((piece, index) => {
    piece.y += piece.speed;
    piece.rotation += piece.rotationSpeed;
    
    if (piece.y > confettiCanvas.height) {
      confettiPieces[index] = new ConfettiPiece();
    }
    
    ctx.save();
    ctx.translate(piece.x, piece.y);
    ctx.rotate(piece.rotation * Math.PI / 180);
    ctx.fillStyle = piece.color;
    ctx.globalAlpha = piece.opacity;
    ctx.beginPath();
    ctx.arc(0, 0, piece.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  
  if (confettiPieces.length > 0) {
    confettiAnimationId = requestAnimationFrame(animateConfetti);
  }
}

// Event listeners
window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', () => {
  resizeCanvas();
  init();
});

// Initialize canvas size
resizeCanvas();
