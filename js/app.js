/* ═══════════════════════════════════════════════════════════════
   NMEA Simulator – app.js
   Workflow:  ① Route Plan  →  ② Simulate  →  ③ Export
   ═══════════════════════════════════════════════════════════════ */

// ── DOM refs ──
const fileInput         = document.getElementById("file");
const vehicleTypeSelect = document.getElementById("vehicleType");
const totalRouteTimeInput = document.getElementById("totalRouteTime");
const frequencyInput    = document.getElementById("frequency");
const roadConditionsSelect    = document.getElementById("roadConditions");
const weatherConditionsSelect = document.getElementById("weatherConditions");
const driverBehaviorSelect    = document.getElementById("driverBehavior");
const generateNMEAButton      = document.getElementById("generateNMEA");
const clearRouteButton         = document.getElementById("clearRouteButton");
const downloadNMEAButton       = document.getElementById("downloadNMEA");
const downloadGPXButton        = document.getElementById("downloadGPX");
const downloadCSVButton        = document.getElementById("downloadCSV");
const downloadCSVAltButton     = document.getElementById("downloadCSVAlt");
const startTimeInput           = document.getElementById("startTime");
const playButton               = document.getElementById("play");
const pauseButton              = document.getElementById("pause");
const stopButton               = document.getElementById("stop");
const animationPlaybackRateInput = document.getElementById("animationPlaybackRate");
const playbackRateValue        = document.getElementById("playbackRateValue");
const sidebar                  = document.getElementById("sidebar");
const sidebarToggle            = document.getElementById("sidebarToggle");
const dropZone                 = document.getElementById("dropZone");
const fileInfo                 = document.getElementById("fileInfo");
const fileName                 = document.getElementById("fileName");
const clearFileBtn             = document.getElementById("clearFile");
const progressBarEl            = document.getElementById("progressBar");
const addressSearchInput       = document.getElementById("addressSearch");
const searchBtn                = document.getElementById("searchBtn");
const searchResultsEl          = document.getElementById("searchResults");
const waypointListEl           = document.getElementById("waypointList");
const wpCountEl                = document.getElementById("wpCount");
const routeWaypointsBtn        = document.getElementById("routeWaypoints");
const routeStatusEl            = document.getElementById("routeStatus");
const generateLoopBtn          = document.getElementById("generateLoop");
const regenerateLoopBtn        = document.getElementById("regenerateLoop");
const loopDistanceInput        = document.getElementById("loopDistance");
const loopShapeSelect          = document.getElementById("loopShape");
const loopHeadingSelect        = document.getElementById("loopHeading");
const loopProfileSelect        = document.getElementById("loopProfile");
const loopSeedInput            = document.getElementById("loopSeed");
const randomSeedBtn            = document.getElementById("randomSeed");
const wanderDurationInput      = document.getElementById("wanderDuration");
const wanderRadiusInput        = document.getElementById("wanderRadius");
const wanderProfileSelect      = document.getElementById("wanderProfile");
const wanderSeedInput          = document.getElementById("wanderSeed");
const randomWanderSeedBtn      = document.getElementById("randomWanderSeed");
const generateWanderBtn        = document.getElementById("generateWander");
const speedDisplay             = document.getElementById("speedDisplay");
const bearingDisplay           = document.getElementById("bearingDisplay");
const timeDisplay              = document.getElementById("timeDisplay");
const speedLimitDisplay        = document.getElementById("speedLimitDisplay");
const roadNameDisplay          = document.getElementById("roadNameDisplay");
const roadTypeDisplay          = document.getElementById("roadTypeDisplay");
const roadTypeSelect           = document.getElementById("roadType");
const trafficDensitySelect     = document.getElementById("trafficDensity");
const stopIndicator            = document.getElementById("stopIndicator");
const stopIcon                 = document.getElementById("stopIcon");
const stopLabel                = document.getElementById("stopLabel");

// ── Realism & Export panel refs ──
const exportModeSelect         = document.getElementById("exportMode");
const gpsNoiseCheckbox         = document.getElementById("gpsNoiseEnabled");
const gpsNoiseLevelInput       = document.getElementById("gpsNoiseLevel");
const noiseLevelValueEl        = document.getElementById("noiseLevelValue");
const satelliteSimCheckbox     = document.getElementById("satelliteSimEnabled");
const elevationCheckbox        = document.getElementById("elevationEnabled");

// ── Scrub bar refs ──
const scrubContainer           = document.getElementById("scrubContainer");
const scrubBar                 = document.getElementById("scrubBar");
const scrubTimeEl              = document.getElementById("scrubTime");
const scrubTotalEl             = document.getElementById("scrubTotal");

// ── Profile chart refs ──
const profileContainer         = document.getElementById("profileContainer");
const profileCanvas            = document.getElementById("profileChart");
const profileTooltip           = document.getElementById("profileTooltip");

// ── Gauge bar refs ──
const gaugeContainer           = document.getElementById("gaugeContainer");
const speedGaugeFill           = document.getElementById("speedGaugeFill");
const speedGaugeValue          = document.getElementById("speedGaugeValue");
const speedGaugeToggle         = document.getElementById("speedGaugeToggle");
const speedGaugeRow            = document.getElementById("speedGaugeRow");
const gForceFillLat            = document.getElementById("gForceFillLat");
const gForceFillLon            = document.getElementById("gForceFillLon");
const gForceGaugeValue         = document.getElementById("gForceGaugeValue");
const gForceGaugeToggle        = document.getElementById("gForceGaugeToggle");
const gForceGaugeRow           = document.getElementById("gForceGaugeRow");

// ── Core objects ──
const conversion    = new Conversion();
const customization = new Customization();
const mapIntegration = new Integration();
const routePlanner  = new RoutePlanner();
const nmeaGenerator = new NMEAGenerator();
const elevationService = new ElevationService();

// ── Default start time to NOW ──
{
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  startTimeInput.value = now.toISOString().slice(0, 16);
}
let visualization       = null;
let originalMarkersLayer = L.layerGroup().addTo(mapIntegration.map);
let animationPlaybackRate = 1;
let animationState = "stopped";
let animationIndex = 0;
let animationMarker  = null;
let animationFrameId = null;
let cachedProcessedRoutePoints = null;
let cachedNMEAData = null;

// ── Pause/resume state ──
let savedSimulationClock   = 0;
let savedProcessedPoints   = null;
let savedTimeScale         = 1;
let savedTotalSimTime      = 0;
let savedStartTime         = null;

// Routed coordinates (the detailed path from OSRM)
let routedCoordinates = null;

// Environment data from OSRM + Overpass (snapped to route)
let routeEnvironmentData = null;
let snappedEnvironment = null;

// Loop state – tracks whether a loop is active so we can regenerate on drag
let loopActive = false;
let loopDragDebounce = null;

// ═══════════════════════════════════════════
//   UI WIRING
// ═══════════════════════════════════════════

// Event listeners
generateNMEAButton.addEventListener("click", handleGenerateNMEA);
clearRouteButton.addEventListener("click", handleClearAll);
downloadNMEAButton.addEventListener("click", handleDownloadNMEA);
if (downloadGPXButton) downloadGPXButton.addEventListener("click", handleDownloadGPX);
downloadCSVButton.addEventListener("click", () => handleDownloadCSV(false));
downloadCSVAltButton.addEventListener("click", () => handleDownloadCSV(true));
playButton.addEventListener("click", handlePlay);
pauseButton.addEventListener("click", handlePause);
stopButton.addEventListener("click", handleStop);
animationPlaybackRateInput.addEventListener("input", handleAnimationPlaybackRateChange);
fileInput.addEventListener("change", handleFileInputChange);
routeWaypointsBtn.addEventListener("click", handleRouteWaypoints);
generateLoopBtn.addEventListener("click", handleGenerateLoop);
regenerateLoopBtn.addEventListener("click", handleGenerateLoop);
randomSeedBtn.addEventListener("click", () => {
  loopSeedInput.value = Math.floor(Math.random() * 999) + 1;
});
randomWanderSeedBtn.addEventListener("click", () => {
  wanderSeedInput.value = Math.floor(Math.random() * 999) + 1;
});
generateWanderBtn.addEventListener("click", handleGenerateWander);
searchBtn.addEventListener("click", handleAddressSearch);
addressSearchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleAddressSearch(); });

// ── Realism panel listeners ──
if (gpsNoiseLevelInput) {
  gpsNoiseLevelInput.addEventListener("input", () => {
    noiseLevelValueEl.textContent = parseFloat(gpsNoiseLevelInput.value).toFixed(1);
  });
}

// ── Scrub bar listeners ──
if (scrubBar) {
  let scrubbing = false;
  scrubBar.addEventListener("input", () => {
    scrubbing = true;
    handleScrub(parseInt(scrubBar.value, 10));
  });
  scrubBar.addEventListener("change", () => { scrubbing = false; });
}

// ── Gauge toggle listeners ──
if (speedGaugeToggle) {
  speedGaugeToggle.addEventListener("click", () => {
    speedGaugeToggle.classList.toggle("active");
    speedGaugeRow.classList.toggle("disabled", !speedGaugeToggle.classList.contains("active"));
  });
}
if (gForceGaugeToggle) {
  gForceGaugeToggle.addEventListener("click", () => {
    gForceGaugeToggle.classList.toggle("active");
    gForceGaugeRow.classList.toggle("disabled", !gForceGaugeToggle.classList.contains("active"));
  });
}

// Close search results when clicking outside
document.addEventListener("click", (e) => {
  if (!searchResultsEl.contains(e.target) && e.target !== searchBtn && e.target !== addressSearchInput) {
    searchResultsEl.classList.add("hidden");
  }
});

// Sidebar toggle
sidebarToggle.addEventListener("click", () => {
  const collapsed = sidebar.classList.toggle("collapsed");
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  if (collapsed) {
    sidebarToggle.classList.add("floating");
    sidebarToggle.innerHTML = '<i class="fas fa-angles-right"></i>';
  } else {
    sidebarToggle.classList.remove("floating");
    sidebarToggle.innerHTML = '<i class="fas fa-angles-left"></i>';
  }
  setTimeout(() => mapIntegration.map.invalidateSize(), 300);
});

// Collapsible panels
document.querySelectorAll(".panel-header").forEach((header) => {
  header.addEventListener("click", () => {
    const expanded = header.getAttribute("aria-expanded") === "true";
    header.setAttribute("aria-expanded", String(!expanded));
    header.nextElementSibling.classList.toggle("open", !expanded);
  });
});

// Chip selectors
document.querySelectorAll(".chip-group").forEach((group) => {
  const hiddenSelect = document.getElementById(group.dataset.for);
  group.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      group.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      if (hiddenSelect) hiddenSelect.value = chip.dataset.value;
    });
  });
});

// Drag & drop
["dragenter", "dragover"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
});
["dragleave", "drop"].forEach((evt) => {
  dropZone.addEventListener(evt, () => dropZone.classList.remove("drag-over"));
});
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("change"));
  }
});
clearFileBtn.addEventListener("click", () => {
  fileInput.value = "";
  fileInfo.classList.add("hidden");
  dropZone.classList.remove("hidden");
});

// Playback rate label
animationPlaybackRateInput.addEventListener("input", () => {
  playbackRateValue.textContent = parseFloat(animationPlaybackRateInput.value).toFixed(1) + "×";
});

// Waypoint change callback → rebuild list
mapIntegration.onWaypointsChanged = (waypoints) => {
  renderWaypointList(waypoints);
};

// When WP1 is dragged while a loop is active → auto-regenerate
mapIntegration.onWaypointDragged = (index, wp) => {
  if (loopActive && index === 0) {
    clearTimeout(loopDragDebounce);
    loopDragDebounce = setTimeout(() => handleGenerateLoop(), 350);
  }
};

// ═══════════════════════════════════════════
//   ① ROUTE PLANNING
// ═══════════════════════════════════════════

/** Address search via Nominatim. */
async function handleAddressSearch() {
  const query = addressSearchInput.value.trim();
  if (!query) return;

  searchResultsEl.innerHTML = '<li class="no-results"><i class="fas fa-spinner fa-spin"></i> Searching…</li>';
  searchResultsEl.classList.remove("hidden");

  try {
    const results = await routePlanner.geocode(query);
    if (results.length === 0) {
      searchResultsEl.innerHTML = '<li class="no-results">No results found</li>';
      return;
    }
    searchResultsEl.innerHTML = "";
    results.forEach((r) => {
      const li = document.createElement("li");
      li.innerHTML = `<i class="fas fa-location-dot"></i><span>${r.display_name}</span>`;
      li.addEventListener("click", () => {
        mapIntegration.addWaypoint(r.lat, r.lon, r.display_name.split(",")[0]);
        mapIntegration.map.setView([r.lat, r.lon], 14);
        searchResultsEl.classList.add("hidden");
        addressSearchInput.value = "";
      });
      searchResultsEl.appendChild(li);
    });
  } catch (err) {
    searchResultsEl.innerHTML = `<li class="no-results">Error: ${err.message}</li>`;
  }
}

/** Render the waypoint sidebar list from the Integration waypoints. */
function renderWaypointList(waypoints) {
  wpCountEl.textContent = waypoints.length;
  if (waypoints.length === 0) {
    waypointListEl.innerHTML = '<li class="wp-empty">No waypoints yet — search or click the map</li>';
    return;
  }
  waypointListEl.innerHTML = "";
  waypoints.forEach((wp, i) => {
    const li = document.createElement("li");
    li.className = "wp-item";
    const label = wp.label || `${wp.lat.toFixed(5)}, ${wp.lon.toFixed(5)}`;
    li.innerHTML = `
      <span class="wp-number">${i + 1}</span>
      <span class="wp-label" title="${label}">${label}</span>
      <div class="wp-actions">
        ${i > 0 ? `<button class="wp-action-btn" data-action="up" title="Move up"><i class="fas fa-chevron-up"></i></button>` : ""}
        ${i < waypoints.length - 1 ? `<button class="wp-action-btn" data-action="down" title="Move down"><i class="fas fa-chevron-down"></i></button>` : ""}
        <button class="wp-action-btn remove" data-action="remove" title="Remove"><i class="fas fa-xmark"></i></button>
      </div>`;
    // Wire actions
    li.querySelectorAll(".wp-action-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === "remove") mapIntegration.removeWaypoint(i);
        else if (action === "up") mapIntegration.reorderWaypoint(i, i - 1);
        else if (action === "down") mapIntegration.reorderWaypoint(i, i + 1);
      });
    });
    waypointListEl.appendChild(li);
  });

  // Reverse-geocode labels for map-clicked waypoints that have no label
  waypoints.forEach(async (wp, i) => {
    if (!wp.label) {
      wp.label = await routePlanner.reverseGeocode(wp.lat, wp.lon);
      // Update just the label text
      const labelEl = waypointListEl.querySelectorAll(".wp-label")[i];
      if (labelEl) { labelEl.textContent = wp.label; labelEl.title = wp.label; }
    }
  });
}

/** Route between all waypoints via OSRM. */
async function handleRouteWaypoints() {
  const coords = mapIntegration.getWaypointCoords();
  if (coords.length < 2) {
    showRouteStatus("Need at least 2 waypoints to route", "error");
    return;
  }
  showRouteStatus('<i class="fas fa-spinner fa-spin"></i> Routing & enriching…', "loading");
  try {
    const result = await routePlanner.route(coords);
    routedCoordinates = result.coordinates;
    routeEnvironmentData = result.environmentData || null;

    // Fetch real elevation data
    await fetchRouteElevation(routedCoordinates);

    // Snap real-world data to route points
    if (routeEnvironmentData) {
      snappedEnvironment = RoutePlanner.snapEnvironmentToRoute(routedCoordinates, routeEnvironmentData);
    } else {
      snappedEnvironment = null;
    }

    mapIntegration.drawRoute(routedCoordinates);
    mapIntegration.drawTrafficMarkers(routedCoordinates, snappedEnvironment);
    conversion.routePoints = routedCoordinates.map((c) => ({ lat: c.lat, lon: c.lon, ele: c.ele || 0 }));

    const src = routeEnvironmentData ? routeEnvironmentData.source : "basic";
    const badge = src === "osrm+overpass" ? "🛰️ OSM+OSRM" : src === "osrm" ? "🛰️ OSRM" : "📐 Geometry";
    showRouteStatus(`<i class="fas fa-check"></i> ${result.distanceKm.toFixed(1)} km — ${formatDuration(result.durationSec)}  <span class="data-badge">${badge}</span>`, "success");
  } catch (err) {
    showRouteStatus(`<i class="fas fa-exclamation-triangle"></i> ${err.message}`, "error");
  }
}

/** Generate a closed-loop route from waypoint 1 using all loop settings. */
async function handleGenerateLoop() {
  const coords = mapIntegration.getWaypointCoords();
  if (coords.length === 0) {
    showRouteStatus("Add at least 1 waypoint as the start/end point", "error");
    return;
  }
  const start = coords[0];
  const targetKm = parseFloat(loopDistanceInput.value);
  if (!targetKm || targetKm < 0.5) {
    showRouteStatus("Enter a distance ≥ 0.5 km", "error");
    return;
  }

  const opts = {
    shape:   loopShapeSelect.value,
    heading: loopHeadingSelect.value,
    profile: loopProfileSelect.value,
    seed:    parseInt(loopSeedInput.value, 10) || 1,
  };

  showRouteStatus('<i class="fas fa-spinner fa-spin"></i> Generating loop…', "loading");
  try {
    const result = await routePlanner.closedLoop(start, targetKm, opts);
    routedCoordinates = result.coordinates;
    routeEnvironmentData = result.environmentData || null;

    // Fetch real elevation data
    await fetchRouteElevation(routedCoordinates);

    if (routeEnvironmentData) {
      snappedEnvironment = RoutePlanner.snapEnvironmentToRoute(routedCoordinates, routeEnvironmentData);
    } else {
      snappedEnvironment = null;
    }

    mapIntegration.drawRoute(routedCoordinates);
    mapIntegration.drawTrafficMarkers(routedCoordinates, snappedEnvironment);
    conversion.routePoints = routedCoordinates.map((c) => ({ lat: c.lat, lon: c.lon, ele: c.ele || 0 }));
    loopActive = true;
    regenerateLoopBtn.disabled = false;

    const src = routeEnvironmentData ? routeEnvironmentData.source : "basic";
    const badge = src === "osrm+overpass" ? "🛰️ OSM+OSRM" : src === "osrm" ? "🛰️ OSRM" : "📐 Geometry";
    showRouteStatus(`<i class="fas fa-check"></i> Loop: ${result.distanceKm.toFixed(1)} km — ${formatDuration(result.durationSec)}  <span class="data-badge">${badge}</span>`, "success");
  } catch (err) {
    showRouteStatus(`<i class="fas fa-exclamation-triangle"></i> ${err.message}`, "error");
  }
}

/** Generate a wandering route from waypoint 1 using wander settings. */
async function handleGenerateWander() {
  const coords = mapIntegration.getWaypointCoords();
  if (coords.length === 0) {
    showRouteStatus("Add at least 1 waypoint as the wander centre", "error");
    return;
  }
  const center = coords[0];
  const targetMin = parseFloat(wanderDurationInput.value);
  if (!targetMin || targetMin < 1) {
    showRouteStatus("Enter a wander time ≥ 1 min", "error");
    return;
  }
  const radiusKm = parseFloat(wanderRadiusInput.value) || 2;

  const opts = {
    radiusKm,
    profile: wanderProfileSelect.value,
    seed:    parseInt(wanderSeedInput.value, 10) || 1,
  };

  showRouteStatus('<i class="fas fa-spinner fa-spin"></i> Generating wander route…', "loading");
  try {
    const result = await routePlanner.wander(center, targetMin, opts);
    routedCoordinates = result.coordinates;
    routeEnvironmentData = result.environmentData || null;

    // Fetch real elevation data
    await fetchRouteElevation(routedCoordinates);

    if (routeEnvironmentData) {
      snappedEnvironment = RoutePlanner.snapEnvironmentToRoute(routedCoordinates, routeEnvironmentData);
    } else {
      snappedEnvironment = null;
    }

    mapIntegration.drawRoute(routedCoordinates);
    mapIntegration.drawTrafficMarkers(routedCoordinates, snappedEnvironment);
    conversion.routePoints = routedCoordinates.map((c) => ({ lat: c.lat, lon: c.lon, ele: c.ele || 0 }));
    loopActive = false;
    regenerateLoopBtn.disabled = true;

    const src = routeEnvironmentData ? routeEnvironmentData.source : "basic";
    const badge = src === "osrm+overpass" ? "🛰️ OSM+OSRM" : src === "osrm" ? "🛰️ OSRM" : "📐 Geometry";
    showRouteStatus(
      `<i class="fas fa-check"></i> Wander: ${result.distanceKm.toFixed(1)} km — ${formatDuration(result.durationSec)}  <span class="data-badge">${badge}</span>`,
      "success"
    );
  } catch (err) {
    showRouteStatus(`<i class="fas fa-exclamation-triangle"></i> ${err.message}`, "error");
  }
}

function showRouteStatus(html, type) {
  routeStatusEl.className = `route-status ${type}`;
  routeStatusEl.innerHTML = html;
  routeStatusEl.classList.remove("hidden");
}

function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ═══════════════════════════════════════════
//   ② SIMULATE (file import / NMEA gen)
// ═══════════════════════════════════════════

async function handleFileInputChange(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const routePoints = await conversion.readFile(file);
    mapIntegration.clearRoute();
    routePoints.forEach((p) => mapIntegration.addWaypoint(p.lat, p.lon));
    routedCoordinates = routePoints;
    mapIntegration.drawRoute(routePoints);
    fileName.textContent = file.name;
    fileInfo.classList.remove("hidden");
    dropZone.classList.add("hidden");
  } catch (error) {
    alert("Error: " + error.message);
  }
}

function handleClearAll() {
  mapIntegration.clearRoute();
  cachedProcessedRoutePoints = null;
  cachedNMEAData = null;
  routedCoordinates = null;
  routeEnvironmentData = null;
  snappedEnvironment = null;
  loopActive = false;
  savedProcessedPoints = null;
  savedSimulationClock = 0;
  regenerateLoopBtn.disabled = true;
  conversion.routePoints = [];
  fileInput.value = "";
  fileInfo.classList.add("hidden");
  dropZone.classList.remove("hidden");
  progressBarEl.style.width = "0%";
  downloadNMEAButton.disabled = true;
  if (downloadGPXButton) downloadGPXButton.disabled = true;
  downloadCSVButton.disabled = true;
  downloadCSVAltButton.disabled = true;
  routeStatusEl.classList.add("hidden");
  speedDisplay.textContent = "—";
  bearingDisplay.textContent = "—";
  timeDisplay.textContent = "—";
  if (speedLimitDisplay) speedLimitDisplay.textContent = "—";
  if (roadNameDisplay) roadNameDisplay.textContent = "—";
  if (roadTypeDisplay) roadTypeDisplay.textContent = "—";
  if (stopIndicator) { stopIndicator.classList.remove('hud-stop-visible'); stopIndicator.classList.add('hud-stop-hidden'); }
  document.getElementById("totalDistanceDisplay").textContent = "—";
  document.getElementById("estimatedTimeDisplay").textContent = "—";
  // Hide profile chart, scrub bar, and gauge bars
  if (profileContainer) profileContainer.classList.add("hidden");
  if (scrubContainer) scrubContainer.classList.add("hidden");
  if (gaugeContainer) gaugeContainer.classList.add("hidden");
}

async function handleGenerateNMEA() {
  if (!conversion.routePoints || conversion.routePoints.length < 2) {
    alert("Route your waypoints first (or import a file) before generating NMEA data.");
    return;
  }

  const vehicleProfile = customization.getVehicleProfile(vehicleTypeSelect.value);
  const totalRouteTime = parseFloat(totalRouteTimeInput.value) * 60;
  const frequency = parseFloat(frequencyInput.value);

  conversion.interpolateRoutePoints(totalRouteTime, frequency);

  // ── Fetch elevation if enabled ──
  if (elevationCheckbox && elevationCheckbox.checked) {
    showRouteStatus('<i class="fas fa-mountain-sun"></i> Fetching elevation data…', "loading");
    try {
      await elevationService.fetchElevations(conversion.routePoints, (frac) => {
        progressBarEl.style.width = (frac * 30).toFixed(1) + "%"; // first 30% for elevation
      });
    } catch (e) {
      console.warn("Elevation fetch failed, continuing with flat:", e);
    }
  }

  const physicsEngine = new PhysicsEngine(
    conversion.routePoints,
    vehicleProfile,
    roadConditionsSelect.value,
    weatherConditionsSelect.value,
    driverBehaviorSelect.value,
    {
      roadType: roadTypeSelect.value,
      trafficDensity: trafficDensitySelect.value,
      snappedEnv: snappedEnvironment,
    }
  );

  const processedRoutePoints = physicsEngine.processRoute();
  cachedProcessedRoutePoints = processedRoutePoints;

  visualization = new Visualization(mapIntegration.map, processedRoutePoints, customization, vehicleTypeSelect.value);

  // ── Configure NMEA generator from UI ──
  nmeaGenerator.mode         = exportModeSelect ? exportModeSelect.value : "standard";
  nmeaGenerator.gpsNoise     = gpsNoiseCheckbox ? gpsNoiseCheckbox.checked : true;
  nmeaGenerator.noiseMeters  = gpsNoiseLevelInput ? parseFloat(gpsNoiseLevelInput.value) : 2.5;
  nmeaGenerator.simulateSats = satelliteSimCheckbox ? satelliteSimCheckbox.checked : true;

  const totalPoints = processedRoutePoints.length;
  const startTime = startTimeInput.value ? new Date(startTimeInput.value) : new Date();

  const nmeaData = [];
  for (let pi = 0; pi < totalPoints; pi++) {
    const point = processedRoutePoints[pi];
    const fixTime = new Date(startTime.getTime() + (point.elapsed || 0) * 1000);
    const sentences = nmeaGenerator.generateFix(point, fixTime);
    nmeaData.push(sentences.join("\r\n"));
    progressBarEl.style.width = (30 + (pi + 1) / totalPoints * 70).toFixed(1) + "%";
    if (pi % 200 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  cachedNMEAData = nmeaData;
  downloadNMEAButton.disabled = false;
  if (downloadGPXButton) downloadGPXButton.disabled = false;
  downloadCSVButton.disabled = false;
  downloadCSVAltButton.disabled = false;

  // ── Render route profile chart ──
  renderProfileChart(processedRoutePoints);

  showRouteStatus(`<i class="fas fa-check"></i> ${totalPoints} NMEA fixes generated (${nmeaGenerator.mode} mode)`, "success");
}

// ═══════════════════════════════════════════
//   ③ EXPORT
// ═══════════════════════════════════════════

function handleDownloadNMEA() {
  if (!cachedNMEAData || cachedNMEAData.length === 0) return;
  const ext = nmeaGenerator.mode === "hackrf" ? "txt" : "nmea";
  const blob = new Blob([cachedNMEAData.join("\r\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `nmea_data.${ext}`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Export a GPX track file. */
function handleDownloadGPX() {
  const points = cachedProcessedRoutePoints;
  if (!points || points.length === 0) return;
  const startTime = startTimeInput.value ? new Date(startTimeInput.value) : new Date();
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="NMEA Simulator">\n<trk><name>Simulated Route</name><trkseg>\n`;
  for (const pt of points) {
    const t = new Date(startTime.getTime() + (pt.elapsed || 0) * 1000).toISOString();
    gpx += `  <trkpt lat="${pt.lat.toFixed(7)}" lon="${pt.lon.toFixed(7)}"><ele>${(pt.ele || 0).toFixed(1)}</ele><time>${t}</time></trkpt>\n`;
  }
  gpx += `</trkseg></trk>\n</gpx>`;
  const blob = new Blob([gpx], { type: "application/gpx+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "route.gpx";
  link.click();
  URL.revokeObjectURL(url);
}

function handleDownloadCSV(includeAltitude = false) {
  const points = cachedProcessedRoutePoints || conversion.routePoints;
  if (!points || points.length === 0) return;
  const totalRouteTimeMs = parseFloat(totalRouteTimeInput.value) * 60 * 1000;
  const csvData = [];
  let currentTime = 0;
  points.forEach((point) => {
    const time = currentTime / 1000;
    const ecefCoords = latLonAltToECEF(point.lat, point.lon, point.alt || point.ele || 0);
    csvData.push(`${time},${ecefCoords.x.toFixed(3)},${ecefCoords.y.toFixed(3)},${ecefCoords.z.toFixed(3)}`);
    currentTime += totalRouteTimeMs / points.length;
  });
  const blob = new Blob([csvData.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data.csv";
  link.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════
//   NMEA helpers (ECEF only – old NMEA gen removed)
// ═══════════════════════════════════════════

function latLonAltToECEF(lat, lon, alt) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const sinLat = Math.sin(lat * Math.PI / 180);
  const cosLat = Math.cos(lat * Math.PI / 180);
  const sinLon = Math.sin(lon * Math.PI / 180);
  const cosLon = Math.cos(lon * Math.PI / 180);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  return {
    x: (N + alt) * cosLat * cosLon,
    y: (N + alt) * cosLat * sinLon,
    z: (N * (1 - e2) + alt) * sinLat,
  };
}

// ═══════════════════════════════════════════
//   ROUTE PROFILE CHART (speed vs distance)
// ═══════════════════════════════════════════

function renderProfileChart(points) {
  if (!profileCanvas || !profileContainer || !points || points.length < 2) return;
  profileContainer.classList.remove("hidden");

  const ctx = profileCanvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = profileContainer.getBoundingClientRect();
  const W = rect.width - 24;   // account for padding
  const H = rect.height - 16;
  profileCanvas.width  = W * dpr;
  profileCanvas.height = H * dpr;
  profileCanvas.style.width  = W + "px";
  profileCanvas.style.height = H + "px";
  ctx.scale(dpr, dpr);

  // Compute cumulative distance
  const dist = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = (points[i].lat - points[i - 1].lat) * 111320;
    const dy = (points[i].lon - points[i - 1].lon) * 111320 * Math.cos(points[i].lat * Math.PI / 180);
    dist.push(dist[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalDist = dist[dist.length - 1] || 1;
  const maxSpeed = Math.max(...points.map(p => p.speed || 0), 1);
  const maxEle = Math.max(...points.map(p => p.ele || 0), 1);
  const minEle = Math.min(...points.map(p => p.ele || 0), 0);
  const eleRange = (maxEle - minEle) || 1;

  // Margin for labels
  const ML = 36, MR = 8, MT = 6, MB = 18;
  const cW = W - ML - MR;
  const cH = H - MT - MB;

  // Clear
  ctx.clearRect(0, 0, W, H);

  // Draw elevation fill (subtle)
  ctx.beginPath();
  ctx.moveTo(ML, MT + cH);
  for (let i = 0; i < points.length; i++) {
    const x = ML + (dist[i] / totalDist) * cW;
    const y = MT + cH - ((points[i].ele || 0) - minEle) / eleRange * cH * 0.4;
    if (i === 0) ctx.moveTo(x, MT + cH);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(ML + cW, MT + cH);
  ctx.closePath();
  ctx.fillStyle = "rgba(79,140,255,0.08)";
  ctx.fill();

  // Draw elevation line
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const x = ML + (dist[i] / totalDist) * cW;
    const y = MT + cH - ((points[i].ele || 0) - minEle) / eleRange * cH * 0.4;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(79,140,255,0.3)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Color map for road types
  const roadColors = {
    motorway: "#f87171", trunk: "#fb923c", primary: "#fbbf24",
    secondary: "#a3e635", tertiary: "#34d399", residential: "#60a5fa",
    unclassified: "#a78bfa", service: "#818cf8", default: "#4f8cff",
  };

  // Draw speed line with road-type coloring
  ctx.lineWidth = 1.5;
  for (let i = 1; i < points.length; i++) {
    const x0 = ML + (dist[i - 1] / totalDist) * cW;
    const y0 = MT + cH - (points[i - 1].speed || 0) / maxSpeed * cH;
    const x1 = ML + (dist[i] / totalDist) * cW;
    const y1 = MT + cH - (points[i].speed || 0) / maxSpeed * cH;

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    const rt = (points[i].roadType || "default").toLowerCase();
    ctx.strokeStyle = roadColors[rt] || roadColors.default;
    ctx.stroke();
  }

  // Mark stops as red dots
  for (let i = 0; i < points.length; i++) {
    if (points[i].isStop) {
      const x = ML + (dist[i] / totalDist) * cW;
      const y = MT + cH;
      ctx.beginPath();
      ctx.arc(x, y - 2, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "#f87171";
      ctx.fill();
    }
  }

  // Axis labels
  ctx.fillStyle = "#4b5563";
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(maxSpeed)}`, ML - 4, MT + 10);
  ctx.fillText("0", ML - 4, MT + cH);
  ctx.textAlign = "left";
  ctx.fillText("0", ML, MT + cH + 14);
  ctx.textAlign = "right";
  ctx.fillText(`${(totalDist / 1000).toFixed(1)} km`, ML + cW, MT + cH + 14);
  // Y-axis label
  ctx.save();
  ctx.translate(10, MT + cH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("km/h", 0, 0);
  ctx.restore();

  // Grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 0.5;
  for (let g = 0; g <= 4; g++) {
    const y = MT + (g / 4) * cH;
    ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(ML + cW, y); ctx.stroke();
  }

  // Store chart data for tooltip/scrub hover
  profileCanvas._chartData = { points, dist, totalDist, maxSpeed, ML, MR, MT, MB, cW, cH };

  // Tooltip on hover
  profileCanvas.addEventListener("mousemove", handleProfileHover);
  profileCanvas.addEventListener("mouseleave", () => {
    if (profileTooltip) profileTooltip.classList.add("hidden");
  });
}

function handleProfileHover(e) {
  if (!profileCanvas._chartData || !profileTooltip) return;
  const { points, dist, totalDist, maxSpeed, ML, cW, cH, MT } = profileCanvas._chartData;
  const rect = profileCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left - ML;
  if (mx < 0 || mx > cW) { profileTooltip.classList.add("hidden"); return; }
  const frac = mx / cW;
  const targetDist = frac * totalDist;

  // Find closest point by distance
  let idx = 0;
  for (let i = 1; i < dist.length; i++) {
    if (dist[i] >= targetDist) { idx = i; break; }
  }
  const pt = points[idx];
  profileTooltip.classList.remove("hidden");
  profileTooltip.innerHTML = `<b>${(pt.speed || 0).toFixed(1)} km/h</b><br>${(dist[idx] / 1000).toFixed(2)} km · ${(pt.ele || 0).toFixed(0)} m ele<br>${pt.roadType || '—'} ${pt.roadName ? '· ' + pt.roadName : ''}`;
  profileTooltip.style.left = (e.clientX - profileContainer.getBoundingClientRect().left + 12) + "px";
  profileTooltip.style.top = "4px";
}

// ═══════════════════════════════════════════
//   SCRUB BAR HELPERS
// ═══════════════════════════════════════════

function formatScrubTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showScrubBar(totalSimTime) {
  if (!scrubContainer || !scrubBar) return;
  scrubContainer.classList.remove("hidden");
  scrubBar.max = 1000;
  scrubBar.value = 0;
  scrubTotalEl.textContent = formatScrubTime(totalSimTime);
  scrubTimeEl.textContent = "0:00";
}

function updateScrubBar(simulationClock, totalSimTime) {
  if (!scrubBar || scrubContainer.classList.contains("hidden")) return;
  const frac = Math.min(simulationClock / totalSimTime, 1);
  scrubBar.value = Math.round(frac * 1000);
  scrubTimeEl.textContent = formatScrubTime(simulationClock);
}

function handleScrub(value) {
  // Only works while paused or stopped with cached data
  if (!savedProcessedPoints || savedTotalSimTime <= 0) return;
  const frac = value / 1000;
  const targetClock = frac * savedTotalSimTime;
  savedSimulationClock = targetClock;

  // Find the right index
  let idx = 0;
  for (let i = 0; i < savedProcessedPoints.length - 1; i++) {
    if (savedProcessedPoints[i + 1].elapsed > targetClock) { idx = i; break; }
    idx = i;
  }
  animationIndex = idx;
  const pt = savedProcessedPoints[idx];

  // Update marker position
  if (animationMarker) {
    animationMarker.setLatLng([pt.lat, pt.lon]);
    visualization.map.panTo([pt.lat, pt.lon]);
  }

  // Update HUD
  speedDisplay.textContent = `${(pt.speed || 0).toFixed(1)} km/h`;
  bearingDisplay.textContent = `${(pt.bearing || 0).toFixed(1)}°`;
  if (savedStartTime) {
    timeDisplay.textContent = new Date(savedStartTime.getTime() + targetClock * 1000).toLocaleTimeString();
  }
  scrubTimeEl.textContent = formatScrubTime(targetClock);
}

// ═══════════════════════════════════════════
//   ANIMATION (Play / Pause / Resume / Stop)
// ═══════════════════════════════════════════

function handlePlay() {
  if (!visualization) return;

  // ── RESUME from pause ──
  if (animationState === "paused" && savedProcessedPoints) {
    animationState = "playing";
    _runAnimationLoop(savedProcessedPoints, savedTotalSimTime, savedTimeScale, savedStartTime, savedSimulationClock);
    return;
  }

  if (animationState === "playing") return;

  // ── FRESH START ──
  animationState = "playing";
  const speedOrTime = document.getElementById("speedOrTime").value;
  const vehicleType = document.getElementById("vehicleType").value;
  const totalRouteTime = speedOrTime === "routeTime" ? parseFloat(totalRouteTimeInput.value) * 60 : null;
  const startTime = startTimeInput.value ? new Date(startTimeInput.value) : new Date();

  // Restore original route points
  if (routedCoordinates) {
    conversion.routePoints = routedCoordinates.map(c => ({ lat: c.lat, lon: c.lon, ele: c.ele || 0 }));
  }

  const physicsEngine = new PhysicsEngine(
    conversion.routePoints,
    customization.getVehicleProfile(vehicleType),
    roadConditionsSelect.value,
    weatherConditionsSelect.value,
    driverBehaviorSelect.value,
    {
      roadType: roadTypeSelect.value,
      trafficDensity: trafficDensitySelect.value,
      snappedEnv: snappedEnvironment,
    }
  );

  const processedRoutePoints = speedOrTime === "routeTime"
    ? physicsEngine.processRoute()
    : physicsEngine.processRouteWithDynamicSpeed(1);

  const totalSimTime = processedRoutePoints[processedRoutePoints.length - 1].elapsed;
  const timeScale = (totalRouteTime && totalSimTime > 0)
    ? totalRouteTime / totalSimTime : 1;

  // Save for pause/resume and scrub
  savedProcessedPoints = processedRoutePoints;
  savedTotalSimTime    = totalSimTime;
  savedTimeScale       = timeScale;
  savedStartTime       = startTime;
  savedSimulationClock = 0;
  cachedProcessedRoutePoints = processedRoutePoints;

  animationIndex = 0;
  if (!animationMarker) {
    animationMarker = L.marker([processedRoutePoints[0].lat, processedRoutePoints[0].lon]).addTo(visualization.markerLayer);
  } else {
    animationMarker.setLatLng([processedRoutePoints[0].lat, processedRoutePoints[0].lon]);
  }

// Show scrub bar & gauge bars
    showScrubBar(totalSimTime * timeScale);
    if (gaugeContainer) gaugeContainer.classList.remove("hidden");

  // Render profile chart if not already shown
  if (processedRoutePoints.length > 2) renderProfileChart(processedRoutePoints);

  // Reset gauge state for fresh start
  _lastGaugeSpeed = 0;
  _lastGaugeBearing = processedRoutePoints[0].bearing || 0;
  _lastGaugeClock = 0;
  _smoothLonG = 0;
  _smoothLatG = 0;

  _runAnimationLoop(processedRoutePoints, totalSimTime, timeScale, startTime, 0);
}

function _runAnimationLoop(processedRoutePoints, totalSimTime, timeScale, startTime, startClock) {
  let lastTimestamp = null;
  let simulationClock = startClock;
  let lastStopBadge = false;

  function animate(timestamp) {
    if (animationState !== "playing") return;
    if (lastTimestamp === null) lastTimestamp = timestamp;
    const delta = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    simulationClock += (delta / 1000) * animationPlaybackRate / timeScale;
    savedSimulationClock = simulationClock;

    while (animationIndex < processedRoutePoints.length - 1 &&
           processedRoutePoints[animationIndex + 1].elapsed <= simulationClock) {
      animationIndex++;
    }

    const pt  = processedRoutePoints[animationIndex];
    const ni  = Math.min(animationIndex + 1, processedRoutePoints.length - 1);
    const npt = processedRoutePoints[ni];

    let lat = pt.lat, lon = pt.lon;
    let speed = pt.speed, bearing = pt.bearing;
    if (animationIndex < processedRoutePoints.length - 1) {
      const span = npt.elapsed - pt.elapsed;
      if (span > 0.001) {
        const frac = Math.max(0, Math.min((simulationClock - pt.elapsed) / span, 1));
        lat  = pt.lat  + frac * (npt.lat  - pt.lat);
        lon  = pt.lon  + frac * (npt.lon  - pt.lon);
        speed   = pt.speed   + frac * (npt.speed   - pt.speed);
        bearing = pt.bearing + frac * (npt.bearing - pt.bearing);
      }
    }

    animationMarker.setLatLng([lat, lon]);
    if (!visualization.map.getBounds().pad(-0.2).contains(animationMarker.getLatLng())) {
      visualization.map.panTo([lat, lon]);
    }

    // HUD updates
    speedDisplay.textContent = `${speed.toFixed(1)} km/h`;
    bearingDisplay.textContent = `${(bearing || 0).toFixed(1)}°`;
    timeDisplay.textContent = new Date(startTime.getTime() + simulationClock * timeScale * 1000).toLocaleTimeString();
    if (speedLimitDisplay) speedLimitDisplay.textContent = pt.speedLimit ? `${Math.round(pt.speedLimit)} km/h` : '—';
    if (roadNameDisplay) roadNameDisplay.textContent = pt.roadName || '—';
    if (roadTypeDisplay) {
      const rt = pt.roadType;
      const src = pt.roadSource;
      const icon = src === "overpass" ? "🛰️" : src === "osrm" ? "📡" : "📐";
      roadTypeDisplay.textContent = rt ? `${icon} ${rt.charAt(0).toUpperCase() + rt.slice(1)}` : '—';
    }

    // Stop indicator
    if (stopIndicator) {
      if (pt.isStop) {
        if (!lastStopBadge) {
          stopIndicator.classList.remove('hud-stop-hidden');
          stopIndicator.classList.add('hud-stop-visible');
          if (stopIcon) stopIcon.textContent = pt.stopType === 'trafficLight' ? '🚥' : '🛑';
          if (stopLabel) {
            const dwellSec = pt.stopDwell ? Math.round(pt.stopDwell) : '';
            stopLabel.textContent = pt.stopType === 'trafficLight'
              ? `Red Light${dwellSec ? ' ' + dwellSec + 's' : ''}`
              : `Stop Sign${dwellSec ? ' ' + dwellSec + 's' : ''}`;
          }
          lastStopBadge = true;
        }
      } else {
        if (lastStopBadge) {
          stopIndicator.classList.remove('hud-stop-visible');
          stopIndicator.classList.add('hud-stop-hidden');
          lastStopBadge = false;
        }
      }
    }

    // Scrub bar update
    updateScrubBar(simulationClock * timeScale, totalSimTime * timeScale);

    // Gauge bar updates
    updateGaugeBars(speed, pt, npt, simulationClock);

    // Continue or finish
    if (simulationClock < totalSimTime) {
      animationFrameId = requestAnimationFrame(animate);
    } else {
      animationState = "stopped";
      animationIndex = 0;
      savedProcessedPoints = null;
      if (animationMarker) { visualization.markerLayer.removeLayer(animationMarker); animationMarker = null; }
      if (scrubContainer) scrubContainer.classList.add("hidden");
      if (gaugeContainer) gaugeContainer.classList.add("hidden");
    }
  }

  animationFrameId = requestAnimationFrame(animate);
}

function handlePause() {
  if (animationState === "playing") {
    animationState = "paused";
    if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
  }
}

function handleStop() {
  if (animationState === "playing" || animationState === "paused") {
    animationState = "stopped";
    animationIndex = 0;
    savedProcessedPoints = null;
    savedSimulationClock = 0;
    if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
    if (animationMarker) { visualization.markerLayer.removeLayer(animationMarker); animationMarker = null; }
    if (visualization) visualization.markerLayer.clearLayers();
    if (scrubContainer) scrubContainer.classList.add("hidden");
    if (gaugeContainer) gaugeContainer.classList.add("hidden");
  }
}

function handleAnimationPlaybackRateChange() {
  animationPlaybackRate = parseFloat(animationPlaybackRateInput.value);
}

// ═══════════════════════════════════════════
//   GAUGE BARS (Speed & G-Force)
// ═══════════════════════════════════════════

let _lastGaugeSpeed = 0;
let _lastGaugeBearing = 0;
let _lastGaugeClock = 0;

// EMA-smoothed G values – prevents flickering between segments
let _smoothLonG = 0;
let _smoothLatG = 0;
const G_SMOOTH_UP   = 0.25;  // fast rise (feel the force quickly)
const G_SMOOTH_DOWN = 0.08;  // slow decay (hold the reading briefly)

function updateGaugeBars(speed, pt, npt, simClock) {
  const maxDisplaySpeed = Math.max(pt.speedLimit || 120, 160);

  // ── Speed gauge ──
  if (speedGaugeFill && speedGaugeRow && !speedGaugeRow.classList.contains("disabled")) {
    const pct = Math.min(speed / maxDisplaySpeed * 100, 100);
    speedGaugeFill.style.width = pct + "%";
    speedGaugeFill.style.backgroundPosition = (pct * 2) + "% 0";
    if (speedGaugeValue) speedGaugeValue.textContent = Math.round(speed);
  }

  // ── G-Force gauge ──
  if (gForceFillLat && gForceFillLon && gForceGaugeRow && !gForceGaugeRow.classList.contains("disabled")) {
    const G = 9.80665;
    const dt = simClock - _lastGaugeClock;

    // Raw longitudinal G from speed delta
    let rawLonG = 0;
    if (dt > 0.005 && dt < 2) {
      const dv = (speed - _lastGaugeSpeed) / 3.6;
      rawLonG = (dv / dt) / G;
    }
    rawLonG = Math.max(-1.5, Math.min(1.5, rawLonG));

    // Raw lateral G from heading rate
    let rawLatG = 0;
    if (dt > 0.005 && dt < 2 && speed > 3) {
      let dBearing = (pt.bearing || 0) - _lastGaugeBearing;
      if (dBearing > 180) dBearing -= 360;
      if (dBearing < -180) dBearing += 360;
      const headingRate = (dBearing * Math.PI / 180) / dt;
      const v = speed / 3.6;
      rawLatG = (v * headingRate) / G;
    }
    rawLatG = Math.max(-1.5, Math.min(1.5, rawLatG));

    // EMA smoothing — rise fast, decay slow ("hold" effect)
    const lonAlpha = Math.abs(rawLonG) > Math.abs(_smoothLonG) ? G_SMOOTH_UP : G_SMOOTH_DOWN;
    const latAlpha = Math.abs(rawLatG) > Math.abs(_smoothLatG) ? G_SMOOTH_UP : G_SMOOTH_DOWN;
    _smoothLonG = _smoothLonG + lonAlpha * (rawLonG - _smoothLonG);
    _smoothLatG = _smoothLatG + latAlpha * (rawLatG - _smoothLatG);

    // Dead-zone: zero out tiny residuals
    if (Math.abs(_smoothLonG) < 0.01) _smoothLonG = 0;
    if (Math.abs(_smoothLatG) < 0.01) _smoothLatG = 0;

    const totalG = Math.sqrt(_smoothLonG * _smoothLonG + _smoothLatG * _smoothLatG);

    // Lateral bar: left/right from center
    const latPct = Math.min(Math.abs(_smoothLatG) / 1.0 * 50, 50);
    if (_smoothLatG >= 0) {
      gForceFillLat.style.width = "0%";
      gForceFillLat.style.left = "50%";
      gForceFillLon.style.width = latPct + "%";
      gForceFillLon.style.left = "50%";
      gForceFillLon.style.transform = "none";
      gForceFillLon.style.borderRadius = "0 3px 3px 0";
    } else {
      gForceFillLon.style.width = "0%";
      gForceFillLat.style.width = latPct + "%";
      gForceFillLat.style.left = (50 - latPct) + "%";
      gForceFillLat.style.transform = "none";
      gForceFillLat.style.borderRadius = "3px 0 0 3px";
    }

    // Colour tint: braking=red, accel=green, neutral=default
    if (_smoothLonG < -0.12) {
      const a = Math.min(Math.abs(_smoothLonG) * 0.8 + 0.2, 0.9);
      gForceFillLon.style.background = `rgba(248,113,113,${a})`;
      gForceFillLat.style.background = `rgba(248,113,113,${a})`;
    } else if (_smoothLonG > 0.08) {
      const a = Math.min(_smoothLonG * 0.8 + 0.2, 0.9);
      gForceFillLon.style.background = `rgba(52,211,153,${a})`;
      gForceFillLat.style.background = `rgba(52,211,153,${a})`;
    } else {
      gForceFillLon.style.background = "rgba(79,140,255,0.7)";
      gForceFillLat.style.background = "rgba(251,191,36,0.7)";
    }

    if (gForceGaugeValue) gForceGaugeValue.textContent = totalG.toFixed(2);
  }

  _lastGaugeSpeed = speed;
  _lastGaugeBearing = pt.bearing || 0;
  _lastGaugeClock = simClock;
}

// ═══════════════════════════════════════════
//   ELEVATION FETCH FOR ROUTING
// ═══════════════════════════════════════════

/** Fetch elevation data after routing, if enabled. */
async function fetchRouteElevation(coords) {
  if (!elevationCheckbox || !elevationCheckbox.checked) return;
  try {
    showRouteStatus('<i class="fas fa-mountain-sun"></i> Fetching elevation…', "loading");
    await elevationService.fetchElevations(coords);
  } catch (e) {
    console.warn("Elevation fetch failed:", e);
  }
}