/* ==========================================================================
   SafeRoad AI - Core JavaScript Controller
   ========================================================================== */

const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:5000/api"
  : "/api";
let currentUser = null;

// --------------------------------------------------------------------------
// 1. Initial State Database
// --------------------------------------------------------------------------
let db = {
  reports: [],
  activeView: "home",
  activeSos: false,
  sosCountdown: null,
  sosTimeRemaining: 10,
  sosCoordinates: [13.0827, 80.2707], // Chennai Center default
  userScore: 85,
  heatmapEnabled: true
};

// Map instances
let phoneMap = null;
let citizenMainMap = null;
let adminMap = null;
let phoneMarkers = [];
let citizenMainMarkers = [];
let adminMarkers = [];
let heatmapOverlayCircles = [];

// Chart.js instances
let riskTrendChart = null;
let categoryChart = null;

// Preset images (drawn dynamically via canvas if they fail to load to ensure fully robust demo)
const imagePresets = {
  pothole1: "https://images.unsplash.com/photo-1515162305285-0293e4767cc2?auto=format&fit=crop&q=80&w=600",
  crack1: "https://images.unsplash.com/photo-1598214886806-c87b2a370944?auto=format&fit=crop&q=80&w=600"
};

// Sound Elements
const sirenSound = document.getElementById("siren-sound-audio");

// --------------------------------------------------------------------------
// 2. DOM Initialization & Session Check
// --------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Update Live Time on Mobile StatusBar
  updatePhoneTime();
  setInterval(updatePhoneTime, 1000 * 60);

  // Initialize Maps
  initLeafletMaps();

  // Initialize Charts
  initAdminCharts();

  // Check login sessions
  loadUserSessions();

  // Initialize View Nav Toggles
  setupMobileToggle();
});

function updatePhoneTime() {
  const now = new Date();
  let hours = now.getHours();
  let minutes = now.getMinutes();
  hours = hours < 10 ? '0' + hours : hours;
  minutes = minutes < 10 ? '0' + minutes : minutes;
  const timeEl = document.getElementById("live-phone-time");
  if (timeEl) timeEl.innerText = `${hours}:${minutes}`;
}

function loadUserSessions() {
  // 1. Citizen Session Check
  const citizenSession = localStorage.getItem('citizen_session');
  if (citizenSession) {
    currentUser = JSON.parse(citizenSession);
    unlockCitizenApp(currentUser);
  } else {
    document.getElementById("citizen-auth-overlay").classList.remove("hidden");
    document.getElementById("phone-view-container").style.display = "none";
    document.getElementById("phone-navbar").style.display = "none";
  }

  // 2. Admin Session Check
  const adminSession = localStorage.getItem('admin_session');
  if (adminSession) {
    unlockAdminConsole(JSON.parse(adminSession));
  } else {
    document.getElementById("admin-auth-overlay").classList.remove("hidden");
    document.getElementById("admin-main-panel").style.display = "none";
  }

  // Load initial reports from backend
  loadReportsFromDb();
}

async function loadReportsFromDb() {
  try {
    const res = await fetch(`${API_BASE}/reports`);
    if (res.ok) {
      db.reports = await res.json();
    }
  } catch (err) {
    console.warn("Express server unreachable. Using local mock reports.", err.message);
    // Fallback: local initial mockup data
    db.reports = [
      {
        id: "SR-9041",
        type: "Pothole",
        severity: "85%",
        coords: [13.0822, 80.2755],
        landmark: "Near Chennai Central Metro Station",
        status: "pending",
        visual: "pothole1",
        timestamp: new Date()
      },
      {
        id: "SR-3304",
        type: "Waterlog",
        severity: "60%",
        coords: [13.0425, 80.2560],
        landmark: "Opposite Express Avenue Mall, Mount Road",
        status: "assigned",
        visual: "pothole2",
        timestamp: new Date()
      }
    ];
  }
  renderReports();
  syncMapMarkers();
  updateChartData();
}

// --------------------------------------------------------------------------
// 3. View Switcher System (Citizen App)
// --------------------------------------------------------------------------
function switchPhoneView(viewId) {
  // Hide all views
  const views = document.querySelectorAll(".phone-view");
  views.forEach(v => v.classList.remove("active-view"));

  // Deactivate navigation icons
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach(n => n.classList.remove("active-nav"));

  // Show target view
  const targetView = document.getElementById(`view-${viewId}`);
  if (targetView) {
    targetView.classList.add("active-view");
    db.activeView = viewId;
  }

  // Highlight bottom navigation matching the main views
  let navId = `nav-${viewId}`;
  if (viewId === 'roadsos') navId = 'nav-sos';
  const navBtn = document.getElementById(navId);
  if (navBtn) {
    navBtn.classList.add("active-nav");
  }

  // Trigger leaflet redraw if map tab is active
  if (viewId === 'map' && citizenMainMap) {
    setTimeout(() => {
      citizenMainMap.invalidateSize();
    }, 100);
  } else if (viewId === 'roadwatch' && phoneMap) {
    setTimeout(() => {
      phoneMap.invalidateSize();
    }, 100);
  }
}

// Mobile/Tablet switch between Citizen App & Admin Panel
function setupMobileToggle() {
  const toggleBtn = document.getElementById("view-toggle-btn");
  const leftPane = document.getElementById("citizen-app-pane");
  const rightPane = document.getElementById("admin-dashboard-pane");

  toggleBtn.addEventListener("click", () => {
    const isShowingAdmin = rightPane.classList.contains("mobile-active-pane");
    if (isShowingAdmin) {
      // Switch back to Citizen App
      rightPane.classList.remove("mobile-active-pane");
      leftPane.classList.remove("mobile-hidden-pane");
      toggleBtn.innerHTML = `<i class="fa-solid fa-laptop-code"></i> Switch to Admin`;
    } else {
      // Switch to Admin
      rightPane.classList.add("mobile-active-pane");
      leftPane.classList.add("mobile-hidden-pane");
      toggleBtn.innerHTML = `<i class="fa-solid fa-mobile-screen-button"></i> Switch to App`;
      
      // Force Map/Charts redrawing inside Admin
      setTimeout(() => {
        if (adminMap) adminMap.invalidateSize();
        if (riskTrendChart) riskTrendChart.resize();
        if (categoryChart) categoryChart.resize();
      }, 100);
    }
  });
}

// Home screen radial gauge
function setHomeSafetyGauge(score) {
  const circle = document.getElementById("home-gauge-progress");
  const scoreVal = document.getElementById("home-score-value");
  if (!circle || !scoreVal) return;

  scoreVal.innerText = score;
  
  // Calculate circumference: r = 40 => 2 * pi * r = 251.2
  const maxOffset = 251.2;
  const offset = maxOffset - (score / 100) * maxOffset;
  circle.style.strokeDashoffset = offset;
}

// --------------------------------------------------------------------------
// 4. Map Operations (Leaflet Engine)
// --------------------------------------------------------------------------
function initLeafletMaps() {
  const centralChennai = [13.0827, 80.2707];
  const mapConfig = {
    zoomControl: false,
    attributionControl: false
  };

  // Helper to create tile layers with robust offline fallback
  function createSafeTileLayer() {
    const layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    });
    layer.on('tileload', function(event) {
      if (event.tile) {
        event.tile.style.opacity = '0.85';
      }
    });
    layer.on('tileerror', function(error) {
      if (error.tile) {
        error.tile.style.opacity = '0';
        error.tile.style.display = 'none';
      }
    });
    return layer;
  }

  // 1. Citizen Map Setup
  phoneMap = L.map("phone-leaflet-map", mapConfig).setView(centralChennai, 12);
  createSafeTileLayer().addTo(phoneMap);

  // Set up secondary full map inside the phone app map view
  const citizenMainMapContainer = document.getElementById("citizen-main-map");
  citizenMainMap = L.map(citizenMainMapContainer, mapConfig).setView(centralChennai, 12);
  createSafeTileLayer().addTo(citizenMainMap);

  // Add Zoom control in citizen full map
  L.control.zoom({ position: 'topright' }).addTo(citizenMainMap);

  // 2. Admin Portal Map Setup
  adminMap = L.map("admin-leaflet-map", {
    attributionControl: false
  }).setView(centralChennai, 12);
  createSafeTileLayer().addTo(adminMap);

  // Map markers icon generators
  syncMapMarkers();
}

function syncMapMarkers() {
  // Clear previous markers
  phoneMarkers.forEach(m => phoneMap.removeLayer(m));
  citizenMainMarkers.forEach(m => citizenMainMap.removeLayer(m));
  adminMarkers.forEach(m => adminMap.removeLayer(m));
  heatmapOverlayCircles.forEach(c => adminMap.removeLayer(c));
  
  phoneMarkers = [];
  citizenMainMarkers = [];
  adminMarkers = [];
  heatmapOverlayCircles = [];

  db.reports.forEach(report => {
    let colorClass = "bg-yellow ring-yellow"; // default pothole
    if (report.type === 'Waterlogging') colorClass = "bg-yellow ring-yellow";
    if (report.type === 'Broken Signal') colorClass = "bg-cyan ring-cyan";
    if (report.status === 'resolved') colorClass = "bg-green ring-green";

    // Custom Glowing DivIcon
    const customIcon = L.divIcon({
      className: 'custom-leaflet-marker',
      html: `
        <div class="marker-radar-ring ${colorClass.split(' ')[1]}"></div>
        <div class="marker-pin-dot ${colorClass.split(' ')[0]}"></div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    // Add marker to Phone RoadWatch mini-map
    const pMarker = L.marker(report.coords, { icon: customIcon }).addTo(phoneMap);
    pMarker.bindPopup(`<strong>${report.type}</strong><br>${report.landmark}<br>Severity: ${report.severity}`);
    phoneMarkers.push(pMarker);

    // Add marker to Citizen Main Map
    if (citizenMainMap) {
      const cMarker = L.marker(report.coords, { icon: customIcon }).addTo(citizenMainMap);
      cMarker.bindPopup(`<strong>${report.type}</strong><br>${report.landmark}<br>Severity: ${report.severity}`);
      citizenMainMarkers.push(cMarker);
    }

    // Add to Admin Map
    const aMarker = L.marker(report.coords, { icon: customIcon }).addTo(adminMap);
    aMarker.bindPopup(`<strong>${report.id}: ${report.type}</strong><br>${report.landmark}<br>Status: ${report.status.toUpperCase()}`);
    adminMarkers.push(aMarker);

    // Dynamic Heatmap Circles (Glowing Risk Zones)
    if (db.heatmapEnabled) {
      let heatColor = "#ffcc00"; // yellow
      let radiusSize = 250;
      if (report.type === 'Pothole' && parseFloat(report.severity) > 80) {
        heatColor = "#ff3355"; // high risk red
        radiusSize = 350;
      }

      const heatCircle = L.circle(report.coords, {
        color: 'transparent',
        fillColor: heatColor,
        fillOpacity: 0.20,
        radius: radiusSize
      }).addTo(adminMap);
      heatmapOverlayCircles.push(heatCircle);
    }
  });

  // Center maps on last report for citizen, fit bounds for admin
  if (db.reports.length > 0) {
    const lastReport = db.reports[db.reports.length - 1];
    phoneMap.panTo(lastReport.coords);
    if (citizenMainMap) citizenMainMap.panTo(lastReport.coords);
    
    if (adminMarkers.length > 0) {
      try {
        const group = L.featureGroup(adminMarkers);
        adminMap.fitBounds(group.getBounds().pad(0.15));
      } catch (err) {
        adminMap.panTo(lastReport.coords);
      }
    } else {
      adminMap.panTo(lastReport.coords);
    }
  }
}

function toggleMapHeatmap(enable) {
  db.heatmapEnabled = enable;
  const btns = document.querySelectorAll(".admin-controls .admin-btn");
  btns.forEach(btn => btn.classList.remove("active-admin-btn"));
  
  if (enable) {
    btns[0].classList.add("active-admin-btn");
  } else {
    btns[1].classList.add("active-admin-btn");
  }
  
  syncMapMarkers();
}

function filterMapMarkers(category) {
  const badges = document.querySelectorAll(".map-controls .map-filter-badge");
  badges.forEach(b => b.classList.remove("active"));
  
  // Highlight badge
  if (category === 'all') document.getElementById("map-filter-all").classList.add("active");
  if (category === 'pothole') document.getElementById("map-filter-potholes").classList.add("active");
  if (category === 'accident') document.getElementById("map-filter-accidents").classList.add("active");

  // Filter rendering logic (simple opacity or hide)
  db.reports.forEach((report, index) => {
    let matches = true;
    if (category === 'pothole' && report.type !== 'Pothole') matches = false;
    if (category === 'accident' && parseFloat(report.severity) < 70) matches = false; // High severity issues as risk hotspots

    if (phoneMarkers[index]) {
      if (matches) phoneMarkers[index].setOpacity(1);
      else phoneMarkers[index].setOpacity(0);
    }
  });
}

// --------------------------------------------------------------------------
// 5. DriveLegal AI Chatbot
// --------------------------------------------------------------------------
function handleChatInputSubmit() {
  const inputEl = document.getElementById("chat-user-input");
  const query = inputEl.value.trim();
  if (!query) return;

  // Add User message
  addChatMessage(query, "user-msg");
  inputEl.value = "";

  // Simulate AI Typing
  setTimeout(() => {
    processChatResponse(query);
  }, 1000);
}

function sendSuggestedChat(text) {
  addChatMessage(text, "user-msg");
  setTimeout(() => {
    processChatResponse(text);
  }, 800);
}

function addChatMessage(content, senderClass) {
  const container = document.getElementById("chat-messages-box");
  const msgDiv = document.createElement("div");
  msgDiv.className = `chat-message ${senderClass}`;
  
  if (typeof content === 'string') {
    msgDiv.innerHTML = `<p>${content}</p>`;
  } else {
    msgDiv.appendChild(content);
  }
  
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function processChatResponse(query) {
  const cleanQuery = query.toLowerCase();
  let botReply = "";
  let cardDetails = null;

  if (cleanQuery.includes("helmet") || cleanQuery.includes("head")) {
    botReply = "Under Indian road safety laws, riding a two-wheeler without a protective helmet is a severe violation. Here is the legal breakdown:";
    cardDetails = {
      name: "No Helmet Penalty",
      fine: "₹1,000",
      section: "Section 129 & Section 194D of Motor Vehicles Act (Amendment 2019)",
      tip: "Your license can be suspended for up to 3 months. Wearing a helmet reduces the risk of death in crashes by 40%."
    };
  } else if (cleanQuery.includes("speed") || cleanQuery.includes("fast") || cleanQuery.includes("limit")) {
    botReply = "Over-speeding poses major safety risks. Under Section 183 of the MVA, fines differ based on vehicle class. Check details below:";
    cardDetails = {
      name: "Over-speeding (LMV)",
      fine: "₹1,000 - ₹2,000",
      section: "Section 183(1) of Motor Vehicles Act, 1988",
      tip: "Medium/Heavy passenger or goods vehicles are charged ₹2,000 - ₹4,000. Second offense results in license impounding."
    };
  } else if (cleanQuery.includes("license") || cleanQuery.includes("permit") || cleanQuery.includes("dl")) {
    botReply = "Driving without a valid license or allowing an unauthorized minor to drive results in heavy legal action:";
    cardDetails = {
      name: "Driving Without License",
      fine: "₹5,000",
      section: "Section 181 of Motor Vehicles Act",
      tip: "Digital licenses on government portals like DigiLocker and mParivahan are legally accepted. Keep yours updated!"
    };
  } else if (cleanQuery.includes("drunk") || cleanQuery.includes("alcohol") || cleanQuery.includes("drinking")) {
    botReply = "Drunk driving is a criminal offense in India. The blood alcohol limit is 30mg per 100ml. Penalties are severe:";
    cardDetails = {
      name: "Drunk Driving (First Offense)",
      fine: "₹10,000 and/or 6 months Jail",
      section: "Section 185 of Motor Vehicles Amendment Act 2019",
      tip: "For a second offense within three years, the fine increases to ₹15,000 and/or up to 2 years imprisonment. Never drink and drive."
    };
  } else {
    botReply = "I can help with standard fines and legal codes in India. Please try one of our suggested templates above, or type 'helmet fine', 'speed limit', or 'drunk driving'.";
  }

  // Construct response wrapper
  const responseWrapper = document.createElement("div");
  responseWrapper.innerHTML = `<p>${botReply}</p>`;

  if (cardDetails) {
    const card = document.createElement("div");
    card.className = "law-response-card";
    card.innerHTML = `
      <div class="law-title-tag">${cardDetails.name}</div>
      <div class="law-fine-box">
        <span>Standard Fine:</span>
        <span class="text-cyan">${cardDetails.fine}</span>
      </div>
      <div class="law-section">${cardDetails.section}</div>
      <div class="law-tip-box">
        <strong>Safety Tip:</strong> ${cardDetails.tip}
      </div>
    `;
    responseWrapper.appendChild(card);
  }

  addChatMessage(responseWrapper, "bot-msg");
}

// Simulated voice recognition
let voiceSimInterval = null;
const voiceTrigger = document.getElementById("voice-input-simulator");
const voiceOverlay = document.getElementById("voice-wave-container");

voiceTrigger.addEventListener("click", () => {
  toggleVoiceSimulation(true);
});

function toggleVoiceSimulation(show) {
  if (show) {
    voiceOverlay.classList.remove("hidden");
    // Simulate speech detection
    const voiceStatusText = document.getElementById("voice-status-text");
    voiceStatusText.innerText = "Listening for speech...";
    
    const presets = ["Drunk driving fines", "Helmet laws in Chennai", "No license penalty"];
    const randomSpeech = presets[Math.floor(Math.random() * presets.length)];

    setTimeout(() => {
      voiceStatusText.innerText = `Detected: "${randomSpeech}"`;
    }, 1500);

    setTimeout(() => {
      toggleVoiceSimulation(false);
      const inputEl = document.getElementById("chat-user-input");
      inputEl.value = randomSpeech;
      handleChatInputSubmit();
    }, 2800);
  } else {
    voiceOverlay.classList.add("hidden");
  }
}

function toggleFineCalcCollapse() {
  const body = document.getElementById("fine-calc-body");
  const arrow = document.querySelector(".calc-arrow");
  body.classList.toggle("hidden");
  arrow.classList.toggle("rotate-180");
}

function updateCalcPreview() {
  const offense = document.getElementById("calc-offense").value;
  const fineLabel = document.getElementById("calc-fine-amount");
  const lawLabel = document.getElementById("calc-fine-law");

  if (offense === 'helmet') {
    fineLabel.innerText = "₹1,000";
    lawLabel.innerText = "Sec 177 / 194D MVA (License Suspended)";
  } else if (offense === 'speeding') {
    fineLabel.innerText = "₹1,500";
    lawLabel.innerText = "Sec 183(1) MVA (Light Motor Vehicle)";
  } else if (offense === 'seatbelt') {
    fineLabel.innerText = "₹1,000";
    lawLabel.innerText = "Sec 194B(1) Motor Vehicles Act";
  } else if (offense === 'redlight') {
    fineLabel.innerText = "₹5,000";
    lawLabel.innerText = "Sec 184 MVA (Dangerous Driving Penalty)";
  } else if (offense === 'drunk') {
    fineLabel.innerText = "₹10,000";
    lawLabel.innerText = "Sec 185 MVA (Court Appearance Mandatory)";
  }
}

// --------------------------------------------------------------------------
// 6. RoadWatch - Visual AI Damage Detection
// --------------------------------------------------------------------------
let activeDetectionData = null;

function loadPresetImage(presetId) {
  const dzPrompt = document.getElementById("dz-prompt-view");
  const scannerView = document.getElementById("scanner-preview-view");
  const previewImg = document.getElementById("scanner-src-img");
  const canvas = document.getElementById("scanner-canvas");
  const statusText = document.getElementById("scanner-status-text");
  const metaForm = document.getElementById("report-metadata-form");

  // Show Scanner Mode
  dzPrompt.classList.add("hidden");
  metaForm.classList.add("hidden");
  scannerView.classList.remove("hidden");
  previewImg.src = imagePresets[presetId];

  // Laser scanner start
  const laser = document.getElementById("scanner-laser");
  laser.style.display = "block";

  // Simulate AI latency
  statusText.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-cyan"></i> Running Neural Net Classification...`;

  setTimeout(() => {
    // Canvas dimensions setup matching the image size
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw visual scanning indicators
    laser.style.display = "none";

    if (presetId === 'pothole1') {
      // Draw Red bounding box around simulated pothole
      ctx.strokeStyle = "#ff3355";
      ctx.lineWidth = 4;
      ctx.strokeRect(50, 40, 150, 70);

      // Label background
      ctx.fillStyle = "#ff3355";
      ctx.fillRect(50, 15, 110, 24);
      
      // Text
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText("POTHOLE 85%", 55, 31);

      statusText.innerHTML = `<span class="text-red"><i class="fa-solid fa-circle-check"></i> Analysis Complete: Severe Pothole (85%)</span>`;
      
      activeDetectionData = {
        class: "Pothole",
        severity: "85%",
        coords: [13.0425, 80.2560], // Opposite Express Avenue Mall
        landmark: "Opposite Express Avenue Mall, Mount Road",
        visual: "pothole1"
      };

      document.getElementById("detected-class-field").value = "Pothole (Class A)";
      document.getElementById("detected-severity-field").value = "85% - High Risk";
      document.getElementById("reported-category").value = "Pothole";
    } else {
      // Crack Preset
      ctx.strokeStyle = "#ffcc00";
      ctx.lineWidth = 3;
      ctx.strokeRect(30, 20, 220, 90);

      ctx.fillStyle = "#ffcc00";
      ctx.fillRect(30, 0, 100, 20);
      
      ctx.fillStyle = "#000000";
      ctx.font = "bold 10px sans-serif";
      ctx.fillText("ROAD CRACK 42%", 35, 14);

      statusText.innerHTML = `<span class="text-amber"><i class="fa-solid fa-circle-check"></i> Analysis Complete: Road Crack (42%)</span>`;

      activeDetectionData = {
        class: "Road Crack",
        severity: "42%",
        coords: [13.0104, 80.2156],
        landmark: "Near Kathipara Junction Flyover, Guindy",
        visual: "crack1"
      };

      document.getElementById("detected-class-field").value = "Road Crack (Class C)";
      document.getElementById("detected-severity-field").value = "42% - Moderate";
      document.getElementById("reported-category").value = "Road Crack";
    }

    // Show input forms
    metaForm.classList.remove("hidden");
  }, 2200);
}

function submitRoadWatchReport() {
  if (!activeDetectionData) return;

  const userCategory = document.getElementById("reported-category").value;
  const userLandmark = document.getElementById("reported-landmark").value || activeDetectionData.landmark;
  const newId = `SR-${Math.floor(1000 + Math.random() * 9000)}`;

  const newReport = {
    id: newId,
    type: userCategory,
    severity: activeDetectionData.severity,
    coords: activeDetectionData.coords,
    landmark: userLandmark,
    status: "pending",
    visual: activeDetectionData.visual,
    reportedBy: currentUser ? currentUser.username : "guest",
    timestamp: new Date()
  };

  fetch(`${API_BASE}/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newReport)
  })
  .then(res => res.ok ? res.json() : Promise.reject())
  .then(savedReport => {
    db.reports.push(savedReport);
    completeSubmitUI();
  })
  .catch(() => {
    db.reports.push(newReport);
    completeSubmitUI();
  });

  function completeSubmitUI() {
    renderReports();
    syncMapMarkers();
    updateChartData();

    document.getElementById("dz-prompt-view").classList.remove("hidden");
    document.getElementById("scanner-preview-view").classList.add("hidden");
    document.getElementById("report-metadata-form").classList.add("hidden");
    document.getElementById("reported-landmark").value = "";
    activeDetectionData = null;

    switchPhoneView("reports");
  }
}

// --------------------------------------------------------------------------
// 7. RoadSoS - Incident Impact Simulation & Emergency Workflows
// --------------------------------------------------------------------------
function triggerAccidentSimulation() {
  const chassis = document.querySelector(".phone-chassis");
  chassis.classList.add("phone-shake-active");

  sirenSound.currentTime = 0;
  sirenSound.play().catch(e => console.log("Audio play needs user interaction first", e));

  const overlay = document.getElementById("crash-countdown-view");
  overlay.classList.remove("hidden");

  db.sosTimeRemaining = 10;
  const timerLabel = document.getElementById("countdown-seconds-label");
  const progressStroke = document.getElementById("timer-countdown-stroke");
  timerLabel.innerText = db.sosTimeRemaining;

  progressStroke.style.strokeDasharray = 282.7;
  progressStroke.style.strokeDashoffset = 0;

  if (db.sosCountdown) clearInterval(db.sosCountdown);

  db.sosCountdown = setInterval(() => {
    db.sosTimeRemaining--;
    timerLabel.innerText = db.sosTimeRemaining;
    
    const offset = 282.7 - (db.sosTimeRemaining / 10) * 282.7;
    progressStroke.style.strokeDashoffset = offset;

    if (db.sosTimeRemaining <= 0) {
      clearInterval(db.sosCountdown);
      triggerManualSOS();
    }
  }, 1000);
}

function cancelAccidentTrigger() {
  sirenSound.pause();
  sirenSound.currentTime = 0;
  const chassis = document.querySelector(".phone-chassis");
  chassis.classList.remove("phone-shake-active");

  document.getElementById("crash-countdown-view").classList.add("hidden");
  
  if (db.sosCountdown) {
    clearInterval(db.sosCountdown);
    db.sosCountdown = null;
  }
}

function triggerManualSOS() {
  cancelAccidentTrigger();

  document.getElementById("rescue-dispatch-status").classList.remove("hidden");
  db.activeSos = true;

  document.getElementById("admin-active-sos-count").innerText = "1";
  document.getElementById("admin-active-sos-count").classList.add("pulse-red");

  const crashId = `CR-${Math.floor(1000 + Math.random() * 9000)}`;
  const landmarkText = document.getElementById("user-location-text") ? document.getElementById("user-location-text").innerText : "Marina Beach, Chennai";
  const crashReport = {
    id: crashId,
    type: "Critical Crash",
    severity: "98%",
    coords: db.sosCoordinates,
    landmark: "Live distress trigger near " + landmarkText,
    status: "assigned",
    visual: "crash",
    reportedBy: currentUser ? currentUser.username : "guest",
    timestamp: new Date()
  };

  fetch(`${API_BASE}/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(crashReport)
  })
  .then(res => res.ok ? res.json() : Promise.reject())
  .then(saved => {
    db.reports.push(saved);
    postTriggerSos();
  })
  .catch(() => {
    db.reports.push(crashReport);
    postTriggerSos();
  });

  function postTriggerSos() {
    renderReports();
    syncMapMarkers();
    updateChartData();

    const sosArea = document.querySelector(".roadsos-scroll-area");
    if (sosArea) sosArea.scrollTop = 0;
    
    let ambulanceEta = 6;
    const etaLabel = document.getElementById("dispatch-eta");
    const etaInterval = setInterval(() => {
      ambulanceEta--;
      if (ambulanceEta <= 0) {
        clearInterval(etaInterval);
        if (etaLabel) etaLabel.innerText = "Arrived";
        const pStep = document.querySelector(".dispatch-step.pending");
        if (pStep) pStep.classList.add("active");
        const aStep = document.querySelector(".dispatch-step.active");
        if (aStep) aStep.classList.remove("active");
      } else {
        if (etaLabel) etaLabel.innerText = `${ambulanceEta} mins`;
      }
    }, 4000);
  }
}

// --------------------------------------------------------------------------
// 8. Renderer Functions (Dynamic DOM Syncer)
// --------------------------------------------------------------------------
function renderReports() {
  const adminBody = document.getElementById("admin-reports-table-body");
  const citizenFeed = document.getElementById("user-reports-feed-container");
  const totalReportsBadge = document.getElementById("user-total-reports-badge");
  const emptyPlaceholder = document.getElementById("empty-feed-placeholder");

  if (!adminBody || !citizenFeed) return;

  adminBody.innerHTML = "";
  
  const feedCards = citizenFeed.querySelectorAll(".user-report-card");
  feedCards.forEach(c => c.remove());

  let userReportsCount = 0;

  db.reports.slice().reverse().forEach(report => {
    const tr = document.createElement("tr");
    
    let badgeClass = "tag-pending";
    if (report.status === 'assigned') badgeClass = "tag-assigned";
    if (report.status === 'resolved') badgeClass = "tag-resolved";

    let imgTag = `<i class="fa-solid fa-image-portrait text-cyan"></i>`;
    if (report.visual === 'pothole1') {
      imgTag = `<img src="${imagePresets.pothole1}" class="table-img-thumbnail">`;
    } else if (report.visual === 'crack1') {
      imgTag = `<img src="${imagePresets.crack1}" class="table-img-thumbnail">`;
    } else if (report.visual === 'crash') {
      imgTag = `<div class="table-img-thumbnail" style="background:#ff3355;display:flex;justify-content:center;align-items:center;"><i class="fa-solid fa-burst" style="color:white;font-size:12px;"></i></div>`;
    } else {
      imgTag = `<div class="table-img-thumbnail" style="background:#00f0ff;display:flex;justify-content:center;align-items:center;"><i class="fa-solid fa-road" style="color:black;font-size:12px;"></i></div>`;
    }

    tr.innerHTML = `
      <td><strong>${report.id}</strong></td>
      <td>${imgTag}</td>
      <td><span class="text-cyan">${report.type}</span></td>
      <td><strong>${report.severity}</strong></td>
      <td><code>${report.coords[0].toFixed(4)}, ${report.coords[1].toFixed(4)}</code></td>
      <td>${report.landmark}</td>
      <td><span class="ur-status-tag ${badgeClass}">${report.status}</span></td>
      <td>
        <div class="admin-table-actions">
          ${report.status !== 'resolved' ? `<button class="action-btn-small action-btn-resolve" onclick="resolveReportAdmin('${report.id}')">Resolve</button>` : ''}
          ${report.status === 'pending' ? `<button class="action-btn-small" onclick="assignReportAdmin('${report.id}')">Assign GCC</button>` : ''}
        </div>
      </td>
    `;
    adminBody.appendChild(tr);

    const isReportedByMe = currentUser && (report.reportedBy === currentUser.username || (report.reportedBy === undefined && currentUser.username === 'dharun'));
    if (isReportedByMe) {
      userReportsCount++;
      if (emptyPlaceholder) emptyPlaceholder.classList.add("hidden");

      const card = document.createElement("div");
      card.className = "user-report-card";
      
      let citizenImg = `<div class="ur-thumb" style="background:var(--accent-cyan);display:flex;justify-content:center;align-items:center;"><i class="fa-solid fa-road"></i></div>`;
      if (report.visual === 'pothole1') {
        citizenImg = `<img src="${imagePresets.pothole1}" class="ur-thumb">`;
      } else if (report.visual === 'crack1') {
        citizenImg = `<img src="${imagePresets.crack1}" class="ur-thumb">`;
      } else if (report.visual === 'crash') {
        citizenImg = `<div class="ur-thumb" style="background:#ff3355;display:flex;justify-content:center;align-items:center;"><i class="fa-solid fa-burst" style="color:white;"></i></div>`;
      }

      // Render readable date
      let timeText = "Just now";
      if (report.timestamp) {
        const d = new Date(report.timestamp);
        if (!isNaN(d.getTime())) {
          timeText = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      }

      card.innerHTML = `
        ${citizenImg}
        <div class="ur-meta">
          <div class="ur-header">
            <h5>${report.type}</h5>
            <span class="ur-status-tag ${badgeClass}">${report.status}</span>
          </div>
          <p class="ur-desc">${report.landmark}</p>
          <div class="ur-coords">GPS: ${report.coords[0].toFixed(4)}, ${report.coords[1].toFixed(4)} • ${timeText}</div>
        </div>
      `;
      citizenFeed.appendChild(card);
    }
  });

  if (totalReportsBadge) totalReportsBadge.innerText = userReportsCount;
  if (userReportsCount === 0 && emptyPlaceholder) {
    emptyPlaceholder.classList.remove("hidden");
  }

  document.getElementById("admin-total-hazards").innerText = db.reports.filter(r => r.status !== 'resolved').length;
  document.getElementById("stat-reported-num").innerText = db.reports.length;
  document.getElementById("stat-resolved-num").innerText = db.reports.filter(r => r.status === 'resolved').length;
}

// Admin Action Buttons
function assignReportAdmin(reportId) {
  const r = db.reports.find(item => item.id === reportId);
  if (r) {
    fetch(`${API_BASE}/reports/${reportId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "assigned" })
    })
    .then(res => {
      r.status = "assigned";
      renderReports();
      syncMapMarkers();
    })
    .catch(() => {
      r.status = "assigned";
      renderReports();
      syncMapMarkers();
    });
  }
}

// --------------------------------------------------------------------------
// 9. Admin Analytics Config (Chart.js Engine)
// --------------------------------------------------------------------------
function initAdminCharts() {
  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = 'Inter';

  // 1. Line Chart: Accident Risk & Road Defect Prediction
  const lineCtx = document.getElementById("risk-trend-chart").getContext("2d");
  const lineGradient = lineCtx.createLinearGradient(0, 0, 0, 200);
  lineGradient.addColorStop(0, 'rgba(0, 240, 255, 0.4)');
  lineGradient.addColorStop(1, 'rgba(0, 240, 255, 0)');

  riskTrendChart = new Chart(lineCtx, {
    type: 'line',
    data: {
      labels: ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'],
      datasets: [{
        label: 'Accident Probability Index',
        data: [24, 68, 45, 38, 52, 84, 72, 35], // Sample hourly risk trends
        borderColor: '#00f0ff',
        borderWidth: 2,
        backgroundColor: lineGradient,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#00f0ff',
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.05)' } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, min: 0, max: 100 }
      }
    }
  });

  // 2. Doughnut Chart: Hazard Category Breakdown
  const doughnutCtx = document.getElementById("category-distribution-chart").getContext("2d");
  
  categoryChart = new Chart(doughnutCtx, {
    type: 'doughnut',
    data: {
      labels: ['Pothole', 'Waterlog', 'Signal Failure', 'Road Crack', 'Critical Crash'],
      datasets: [{
        data: calculateCategoryCounts(),
        backgroundColor: [
          '#ffcc00', // Pothole - Amber
          '#0088ff', // Waterlog - Blue
          '#00f0ff', // Signal - Cyan
          'rgba(255, 255, 255, 0.15)', // Crack - Slate
          '#ff3355'  // Crash - Red
        ],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { font: { size: 9 }, boxWidth: 10 }
        }
      },
      cutout: '65%'
    }
  });
}

function calculateCategoryCounts() {
  const counts = { Pothole: 0, Waterlogging: 0, 'Broken Signal': 0, 'Road Crack': 0, 'Critical Crash': 0 };
  db.reports.forEach(r => {
    if (r.type === 'Pothole') counts.Pothole++;
    else if (r.type === 'Waterlogging') counts.Waterlogging++;
    else if (r.type === 'Broken Signal') counts['Broken Signal']++;
    else if (r.type === 'Road Crack') counts['Road Crack']++;
    else if (r.type === 'Critical Crash') counts['Critical Crash']++;
  });
  return [counts.Pothole, counts.Waterlogging, counts['Broken Signal'], counts['Road Crack'], counts['Critical Crash']];
}

function updateChartData() {
  if (categoryChart) {
    categoryChart.data.datasets[0].data = calculateCategoryCounts();
    categoryChart.update();
  }
}

// --------------------------------------------------------------------------
// 10. User Authentication & Session Controllers
// --------------------------------------------------------------------------

function quickFillCitizen(u, p) {
  document.getElementById("citizen-username").value = u;
  document.getElementById("citizen-password").value = p;
}

function quickFillAdmin(u, p) {
  document.getElementById("admin-username").value = u;
  document.getElementById("admin-password").value = p;
}

function toggleCitizenAuthMode(isRegister) {
  const loginForm = document.getElementById("citizen-login-form");
  const regForm = document.getElementById("citizen-register-form");
  if (isRegister) {
    loginForm.classList.add("hidden");
    regForm.classList.remove("hidden");
  } else {
    loginForm.classList.remove("hidden");
    regForm.classList.add("hidden");
  }
}

async function handleCitizenLogin() {
  const u = document.getElementById("citizen-username").value.trim();
  const p = document.getElementById("citizen-password").value.trim();
  if (!u || !p) {
    alert("Please enter both username and password.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    });
    const data = await res.json();
    if (res.ok) {
      currentUser = data.user;
      localStorage.setItem('citizen_session', JSON.stringify(currentUser));
      unlockCitizenApp(currentUser);
    } else {
      alert("Error: " + (data.error || "Invalid credentials"));
    }
  } catch (err) {
    alert("API server offline. Unlocking offline preview mode.");
    currentUser = { username: u, role: "citizen", safetyScore: 85, rewardPoints: 720 };
    unlockCitizenApp(currentUser);
  }
}

async function handleCitizenRegister() {
  const u = document.getElementById("citizen-reg-username").value.trim();
  const p = document.getElementById("citizen-reg-password").value.trim();
  if (!u || !p) {
    alert("Please fill all username and password fields.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p, role: "citizen" })
    });
    const data = await res.json();
    if (res.ok) {
      alert("Signup successful!");
      currentUser = data.user;
      localStorage.setItem('citizen_session', JSON.stringify(currentUser));
      unlockCitizenApp(currentUser);
    } else {
      alert("Error: " + (data.error || "Could not register"));
    }
  } catch (err) {
    alert("API server offline. Cannot register.");
  }
}

function unlockCitizenApp(user) {
  document.getElementById("citizen-auth-overlay").classList.add("hidden");
  document.getElementById("phone-view-container").style.display = "block";
  document.getElementById("phone-navbar").style.display = "flex";

  document.getElementById("profile-user-name").innerText = user.username;
  document.getElementById("profile-reward-points").innerText = user.rewardPoints || 0;
  
  db.userScore = user.safetyScore || 85;
  setHomeSafetyGauge(db.userScore);

  requestLiveLocation();
}

function handleCitizenLogout() {
  currentUser = null;
  localStorage.removeItem('citizen_session');
  
  document.getElementById("citizen-username").value = "";
  document.getElementById("citizen-password").value = "";
  document.getElementById("citizen-reg-username").value = "";
  document.getElementById("citizen-reg-password").value = "";

  document.getElementById("citizen-auth-overlay").classList.remove("hidden");
  document.getElementById("phone-view-container").style.display = "none";
  document.getElementById("phone-navbar").style.display = "none";
}

async function handleAdminLogin() {
  const u = document.getElementById("admin-username").value.trim();
  const p = document.getElementById("admin-password").value.trim();
  if (!u || !p) {
    alert("Please enter admin credentials.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    });
    const data = await res.json();
    if (res.ok) {
      if (data.user.role !== 'admin') {
        alert("Access Denied: This credential does not have administrative rights.");
        return;
      }
      localStorage.setItem('admin_session', JSON.stringify(data.user));
      unlockAdminConsole(data.user);
    } else {
      alert("Error: " + (data.error || "Invalid admin credentials"));
    }
  } catch (err) {
    alert("API server offline. Unlocking admin offline preview.");
    if (u === 'admin' && p === 'admin') {
      const localAdmin = { username: "admin", role: "admin" };
      localStorage.setItem('admin_session', JSON.stringify(localAdmin));
      unlockAdminConsole(localAdmin);
    } else {
      alert("Please use admin / admin to bypass offline.");
    }
  }
}

function unlockAdminConsole(adminUser) {
  document.getElementById("admin-auth-overlay").classList.add("hidden");
  document.getElementById("admin-main-panel").style.display = "flex";
  
  setTimeout(() => {
    if (adminMap) adminMap.invalidateSize();
  }, 100);
}

function handleAdminLogout() {
  localStorage.removeItem('admin_session');
  document.getElementById("admin-username").value = "";
  document.getElementById("admin-password").value = "";

  document.getElementById("admin-auth-overlay").classList.remove("hidden");
  document.getElementById("admin-main-panel").style.display = "none";
}

// --------------------------------------------------------------------------
// 11. GPS Geolocation & Open-Meteo Weather Services
// --------------------------------------------------------------------------

function requestLiveLocation() {
  const locLabel = document.getElementById("user-location-text");
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser.");
    return;
  }

  if (locLabel) {
    locLabel.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Locating GPS...`;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      db.sosCoordinates = [lat, lng];

      if (phoneMap) phoneMap.setView([lat, lng], 13);
      if (citizenMainMap) citizenMainMap.setView([lat, lng], 13);
      if (adminMap) adminMap.setView([lat, lng], 13);

      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.display_name) {
            const addr = data.address;
            const street = addr.road || addr.suburb || addr.neighbourhood || "Live Coordinates";
            const city = addr.city || addr.town || addr.county || "Tamil Nadu";
            if (locLabel) {
              locLabel.innerText = `${street}, ${city}`;
            }
          } else {
            if (locLabel) locLabel.innerText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          }
        }
      } catch (err) {
        if (locLabel) locLabel.innerText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      }

      fetchRealWeather(lat, lng);
    },
    (error) => {
      console.warn("Geolocation request failed, using default Chennai Central location:", error.message);
      if (locLabel) {
        locLabel.innerText = "Marina Beach, Chennai (Default)";
      }
      fetchRealWeather(13.0827, 80.2707);
    },
    { timeout: 8000 }
  );
}

async function fetchRealWeather(lat, lng) {
  try {
    const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
    if (weatherRes.ok) {
      const data = await weatherRes.json();
      const curr = data.current_weather;
      if (curr) {
        const temp = Math.round(curr.temperature);
        const tempEl = document.getElementById("weather-temp");
        if (tempEl) tempEl.innerText = `${temp}°C`;
        
        const code = curr.weathercode;
        let iconClass = "fa-solid fa-sun text-yellow";
        let desc = "Clear Sky";
        if (code >= 1 && code <= 3) {
          iconClass = "fa-solid fa-cloud-sun text-slate";
          desc = "Partly Cloudy";
        } else if (code >= 45 && code <= 48) {
          iconClass = "fa-solid fa-smog text-slate";
          desc = "Foggy";
        } else if (code >= 51 && code <= 67) {
          iconClass = "fa-solid fa-cloud-rain text-cyan";
          desc = "Drizzle/Rain";
        } else if (code >= 71 && code <= 77) {
          iconClass = "fa-solid fa-snowflake text-white";
          desc = "Snowy";
        } else if (code >= 80 && code <= 82) {
          iconClass = "fa-solid fa-cloud-showers-heavy text-blue";
          desc = "Heavy Rain";
        } else if (code >= 95 && code <= 99) {
          iconClass = "fa-solid fa-cloud-bolt text-amber";
          desc = "Thunderstorm";
        }
        
        const iconEl = document.getElementById("weather-icon");
        if (iconEl) {
          iconEl.className = `${iconClass} weather-icon`;
        }
      }
    }

    const aqiRes = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=pm2_5`);
    if (aqiRes.ok) {
      const data = await aqiRes.json();
      if (data && data.current && data.current.pm2_5 !== undefined) {
        const pmVal = Math.round(data.current.pm2_5);
        let category = "Good";
        if (pmVal > 50) category = "Moderate";
        if (pmVal > 100) category = "Unhealthy";
        const aqiEl = document.getElementById("weather-aqi");
        if (aqiEl) aqiEl.innerText = `PM 2.5: ${pmVal} (${category})`;
      }
    }
  } catch (err) {
    console.warn("Failed to fetch live weather details:", err.message);
  }
}

async function resolveReportAdmin(reportId) {
  const r = db.reports.find(item => item.id === reportId);
  if (r) {
    try {
      const res = await fetch(`${API_BASE}/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" })
      });
      if (res.ok) {
        r.status = "resolved";
      }
    } catch (err) {
      r.status = "resolved";
    }

    if (r.type === "Critical Crash") {
      document.getElementById("admin-active-sos-count").innerText = "0";
      document.getElementById("admin-active-sos-count").classList.remove("pulse-red");
      db.activeSos = false;
      const rescueBox = document.getElementById("rescue-dispatch-status");
      if (rescueBox) rescueBox.classList.add("hidden");
    }
    
    db.userScore = Math.min(db.userScore + 5, 100);
    setHomeSafetyGauge(db.userScore);

    renderReports();
    syncMapMarkers();
    updateChartData();
  }
}

// --------------------------------------------------------------------------
// 12. Global Window Exports for Inline HTML Handlers
// --------------------------------------------------------------------------
window.quickFillCitizen = quickFillCitizen;
window.quickFillAdmin = quickFillAdmin;
window.toggleCitizenAuthMode = toggleCitizenAuthMode;
window.handleCitizenLogin = handleCitizenLogin;
window.handleCitizenRegister = handleCitizenRegister;
window.unlockCitizenApp = unlockCitizenApp;
window.handleCitizenLogout = handleCitizenLogout;
window.handleAdminLogin = handleAdminLogin;
window.unlockAdminConsole = unlockAdminConsole;
window.handleAdminLogout = handleAdminLogout;
window.requestLiveLocation = requestLiveLocation;
window.fetchRealWeather = fetchRealWeather;
window.resolveReportAdmin = resolveReportAdmin;
window.assignReportAdmin = assignReportAdmin;
window.switchPhoneView = switchPhoneView;
window.toggleMapHeatmap = toggleMapHeatmap;
window.filterMapMarkers = filterMapMarkers;
window.handleChatInputSubmit = handleChatInputSubmit;
window.sendSuggestedChat = sendSuggestedChat;
window.toggleVoiceSimulation = toggleVoiceSimulation;
window.toggleFineCalcCollapse = toggleFineCalcCollapse;
window.updateCalcPreview = updateCalcPreview;
window.loadPresetImage = loadPresetImage;
window.submitRoadWatchReport = submitRoadWatchReport;
window.triggerAccidentSimulation = triggerAccidentSimulation;
window.cancelAccidentTrigger = cancelAccidentTrigger;
window.triggerManualSOS = triggerManualSOS;
