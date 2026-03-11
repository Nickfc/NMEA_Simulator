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
const speedDisplay             = document.getElementById("speedDisplay");
const bearingDisplay           = document.getElementById("bearingDisplay");
const timeDisplay              = document.getElementById("timeDisplay");
const speedLimitDisplay        = document.getElementById("speedLimitDisplay");
const roadTypeDisplay          = document.getElementById("roadTypeDisplay");
const roadTypeSelect           = document.getElementById("roadType");
const trafficDensitySelect     = document.getElementById("trafficDensity");

// ── Core objects ──
const conversion    = new Conversion();
const customization = new Customization();
const mapIntegration = new Integration();
const routePlanner  = new RoutePlanner();

let visualization       = null;
let originalMarkersLayer = L.layerGroup().addTo(mapIntegration.map);
let animationPlaybackRate = 1;
let animationState = "stopped";
let animationIndex = 0;
let animationMarker  = null;
let animationFrameId = null;
let cachedProcessedRoutePoints = null;
let cachedNMEAData = null;

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
searchBtn.addEventListener("click", handleAddressSearch);
addressSearchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleAddressSearch(); });

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

    // Snap real-world data to route points
    if (routeEnvironmentData) {
      snappedEnvironment = RoutePlanner.snapEnvironmentToRoute(routedCoordinates, routeEnvironmentData);
    } else {
      snappedEnvironment = null;
    }

    mapIntegration.drawRoute(routedCoordinates);
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

    if (routeEnvironmentData) {
      snappedEnvironment = RoutePlanner.snapEnvironmentToRoute(routedCoordinates, routeEnvironmentData);
    } else {
      snappedEnvironment = null;
    }

    mapIntegration.drawRoute(routedCoordinates);
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
  regenerateLoopBtn.disabled = true;
  conversion.routePoints = [];
  fileInput.value = "";
  fileInfo.classList.add("hidden");
  dropZone.classList.remove("hidden");
  progressBarEl.style.width = "0%";
  downloadNMEAButton.disabled = true;
  downloadCSVButton.disabled = true;
  downloadCSVAltButton.disabled = true;
  routeStatusEl.classList.add("hidden");
  speedDisplay.textContent = "—";
  bearingDisplay.textContent = "—";
  timeDisplay.textContent = "—";
  if (speedLimitDisplay) speedLimitDisplay.textContent = "—";
  if (roadTypeDisplay) roadTypeDisplay.textContent = "—";
  document.getElementById("totalDistanceDisplay").textContent = "—";
  document.getElementById("estimatedTimeDisplay").textContent = "—";
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

  const totalPoints = processedRoutePoints.length;
  progressBarEl.style.width = "0%";

  const nmeaData = [];
  let currentTime = 0;
  for (let pi = 0; pi < totalPoints; pi++) {
    const point = processedRoutePoints[pi];
    const nmeaSentence = generateNMEASentence(point, currentTime);
    nmeaData.push(nmeaSentence);
    progressBarEl.style.width = ((pi + 1) / totalPoints * 100).toFixed(1) + "%";
    currentTime += totalRouteTime * 1000 / totalPoints;
    if (pi % 200 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  cachedNMEAData = nmeaData;
  downloadNMEAButton.disabled = false;
  downloadCSVButton.disabled = false;
  downloadCSVAltButton.disabled = false;
}

// ═══════════════════════════════════════════
//   ③ EXPORT
// ═══════════════════════════════════════════

function handleDownloadNMEA() {
  if (!cachedNMEAData || cachedNMEAData.length === 0) return;
  const blob = new Blob([cachedNMEAData.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "nmea_data.txt";
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
//   NMEA helpers
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

function generateNMEASentence(point, currentTime) {
  const time = currentTime
    ? new Date(currentTime).toISOString().split(".")[0].replace("T", "").replace(/-/g, "").replace(/:/g, "").slice(-6)
      + "." + String(Math.floor(currentTime % 1000 / 10)).padStart(2, "0")
    : "000000.00";
  const lat = convertToNMEACoordinate(point.lat, true);
  const lon = convertToNMEACoordinate(point.lon, false);
  const ele = (point.ele || 0).toFixed(2);
  const nmeaString = `$GPGGA,${time},${lat},N,${lon},E,1,05,2.87,${ele},M,00.000,M,,`;
  const checksum = calculateChecksum(nmeaString);
  return nmeaString + "*" + checksum.toString(16).toUpperCase();
}

function convertToNMEACoordinate(coordinate, isLatitude) {
  const degrees = Math.abs(coordinate);
  let result = degrees.toFixed(7);
  result = result.padStart(isLatitude ? 9 : 10, "0");
  return result;
}

function calculateChecksum(nmeaString) {
  let checksum = 0;
  for (let i = 1; i < nmeaString.length; i++) checksum ^= nmeaString.charCodeAt(i);
  return checksum;
}

// ═══════════════════════════════════════════
//   ANIMATION (Play / Pause / Stop)
// ═══════════════════════════════════════════

function handlePlay() {
  if (visualization && animationState !== "playing") {
    animationState = "playing";
    const speedOrTime = document.getElementById("speedOrTime").value;
    const vehicleType = document.getElementById("vehicleType").value;
    const totalRouteTime = speedOrTime === "routeTime" ? parseFloat(totalRouteTimeInput.value) * 60 : null;
    const startTime = new Date(startTimeInput.value);

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

    const updateRate = totalRouteTime ? (totalRouteTime * 1000) / processedRoutePoints.length : 1000;

    if (!animationMarker) {
      animationMarker = L.marker([processedRoutePoints[0].lat, processedRoutePoints[0].lon]).addTo(visualization.markerLayer);
    }

    let lastTimestamp = null;
    let accumulatedTime = 0;

    function animate(timestamp) {
      if (animationState !== "playing") return;
      if (lastTimestamp === null) lastTimestamp = timestamp;
      const delta = timestamp - lastTimestamp;
      lastTimestamp = timestamp;
      accumulatedTime += delta;

      const frameInterval = updateRate / (animationPlaybackRate * parseFloat(frequencyInput.value));

      while (accumulatedTime >= frameInterval && animationIndex < processedRoutePoints.length - 1) {
        accumulatedTime -= frameInterval;
        const point = processedRoutePoints[animationIndex];
        const nextPoint = processedRoutePoints[Math.min(animationIndex + 1, processedRoutePoints.length - 1)];

        animationMarker.setLatLng([point.lat, point.lon]);
        if (!visualization.map.getBounds().pad(-0.2).contains(animationMarker.getLatLng())) {
          visualization.map.panTo([point.lat, point.lon]);
        }

        speedDisplay.textContent = `${point.speed.toFixed(1)} km/h`;
        bearingDisplay.textContent = `${(point.bearing || GeoUtils.calculateBearing(point, nextPoint)).toFixed(1)}°`;
        const elapsedTime = animationIndex * updateRate / parseFloat(frequencyInput.value);
        timeDisplay.textContent = new Date(startTime.getTime() + elapsedTime).toLocaleTimeString();
        if (speedLimitDisplay) speedLimitDisplay.textContent = point.speedLimit ? `${Math.round(point.speedLimit)} km/h` : '—';
        if (roadTypeDisplay) {
          const rt = point.roadType;
          const src = point.roadSource;
          const icon = src === "overpass" ? "🛰️" : src === "osrm" ? "📡" : "📐";
          roadTypeDisplay.textContent = rt ? `${icon} ${rt.charAt(0).toUpperCase() + rt.slice(1)}` : '—';
        }
        animationIndex++;
      }

      if (animationIndex < processedRoutePoints.length - 1) {
        animationFrameId = requestAnimationFrame(animate);
      } else {
        animationState = "stopped";
        animationIndex = 0;
        if (animationMarker) { visualization.markerLayer.removeLayer(animationMarker); animationMarker = null; }
      }
    }

    animationFrameId = requestAnimationFrame(animate);
  }
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
    if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
    if (animationMarker) { visualization.markerLayer.removeLayer(animationMarker); animationMarker = null; }
    visualization.markerLayer.clearLayers();
  }
}

function handleAnimationPlaybackRateChange() {
  animationPlaybackRate = parseFloat(animationPlaybackRateInput.value);
}