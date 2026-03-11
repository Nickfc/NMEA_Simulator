const fileInput = document.getElementById("file");
const vehicleTypeSelect = document.getElementById("vehicleType");
const totalRouteTimeInput = document.getElementById("totalRouteTime");
const frequencyInput = document.getElementById("frequency");
const roadConditionsSelect = document.getElementById("roadConditions");
const weatherConditionsSelect = document.getElementById("weatherConditions");
const driverBehaviorSelect = document.getElementById("driverBehavior");
const generateNMEAButton = document.getElementById("generateNMEA");
const clearRouteButton = document.getElementById("clearRouteButton");
const downloadNMEAButton = document.getElementById("downloadNMEA");
const startTimeInput = document.getElementById("startTime");
const playButton = document.getElementById("play");
const pauseButton = document.getElementById("pause");
const stopButton = document.getElementById("stop");
const animationPlaybackRateInput = document.getElementById("animationPlaybackRate");
const playbackRateValue = document.getElementById("playbackRateValue");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const dropZone = document.getElementById("dropZone");
const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const clearFileBtn = document.getElementById("clearFile");
const progressBarEl = document.getElementById("progressBar");

const pastSpeeds = [];
const numPastPoints = 5;

fileInput.addEventListener("change", handleFileInputChange, false);
generateNMEAButton.addEventListener("click", handleGenerateNMEA, false);
clearRouteButton.addEventListener("click", handleClearRoute, false);
downloadNMEAButton.addEventListener("click", handleDownloadNMEA, false);
playButton.addEventListener("click", handlePlay, false);
pauseButton.addEventListener("click", handlePause, false);
stopButton.addEventListener("click", handleStop, false);
animationPlaybackRateInput.addEventListener("input", handleAnimationPlaybackRateChange, false);

// ── Sidebar toggle ──
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
  // Let Leaflet recalculate map size after transition
  setTimeout(() => mapIntegration.map.invalidateSize(), 300);
});

// ── Collapsible panels ──
document.querySelectorAll(".panel-header").forEach((header) => {
  header.addEventListener("click", () => {
    const expanded = header.getAttribute("aria-expanded") === "true";
    header.setAttribute("aria-expanded", String(!expanded));
    header.nextElementSibling.classList.toggle("open", !expanded);
  });
});

// ── Chip selectors ──
document.querySelectorAll(".chip-group").forEach((group) => {
  const selectId = group.dataset.for;
  const hiddenSelect = document.getElementById(selectId);
  group.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      group.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      if (hiddenSelect) hiddenSelect.value = chip.dataset.value;
    });
  });
});

// ── Drag & drop ──
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

// ── Playback rate label ──
animationPlaybackRateInput.addEventListener("input", () => {
  playbackRateValue.textContent = parseFloat(animationPlaybackRateInput.value).toFixed(1) + "×";
});

const conversion = new Conversion();
const customization = new Customization();
const mapIntegration = new Integration();

let visualization = null;
let timeLapseInterval = null;
let originalMarkersLayer = L.layerGroup().addTo(mapIntegration.map);
let animationPlaybackRate = 1;
let animationState = "stopped";
let animationIndex = 0;
let animationMarker = null;
let animationFrameId = null;
let cachedProcessedRoutePoints = null;
let cachedNMEAData = null;

async function handleFileInputChange(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const routePoints = await conversion.readFile(file);
    mapIntegration.clearRoute();
    routePoints.forEach((point) => mapIntegration.addRoutePoint([point.lat, point.lon]));
    // Show file chip
    fileName.textContent = file.name;
    fileInfo.classList.remove("hidden");
    dropZone.classList.add("hidden");
  } catch (error) {
    alert("Error: " + error.message);
  }
}

function handleClearRoute() {
  mapIntegration.clearRoute();
  cachedProcessedRoutePoints = null;
  cachedNMEAData = null;
  fileInput.value = "";
  fileInfo.classList.add("hidden");
  dropZone.classList.remove("hidden");
  progressBarEl.style.width = "0%";
  downloadNMEAButton.disabled = true;
  downloadCSVButton.disabled = true;
  downloadCSVAltButton.disabled = true;
}

async function handleGenerateNMEA() {
  const vehicleProfile = customization.getVehicleProfile(vehicleTypeSelect.value);
  const totalRouteTime = parseFloat(totalRouteTimeInput.value) * 60; // Convert to seconds
  const frequency = parseFloat(frequencyInput.value);

  conversion.interpolateRoutePoints(totalRouteTime, frequency);

  const physicsEngine = new PhysicsEngine(
    conversion.routePoints,
    vehicleProfile,
    roadConditionsSelect.value,
    weatherConditionsSelect.value,
    driverBehaviorSelect.value
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
  const totalRouteTimeMs = parseFloat(totalRouteTimeInput.value) * 60 * 1000;
  const csvData = [];
  let currentTime = 0;
  points.forEach((point) => {
    const time = currentTime / 1000; // Convert to seconds
    const ecefCoords = latLonAltToECEF(point.lat, point.lon, point.alt || 0);
    const data = `${time},${ecefCoords.x.toFixed(3)},${ecefCoords.y.toFixed(3)},${ecefCoords.z.toFixed(3)}`;
    csvData.push(data);
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

function latLonAltToECEF(lat, lon, alt) {
  const a = 6378137;  // semi-major axis
  const f = 1/298.257223563;  // flattening
  const e2 = 2*f - f*f;  // eccentricity^2
  const sinLat = Math.sin(lat * Math.PI / 180);
  const cosLat = Math.cos(lat * Math.PI / 180);
  const sinLon = Math.sin(lon * Math.PI / 180);
  const cosLon = Math.cos(lon * Math.PI / 180);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);

  return {
    x: (N + alt) * cosLat * cosLon,
    y: (N + alt) * cosLat * sinLon,
    z: (N * (1 - e2) + alt) * sinLat
  };
}

function generateNMEASentence(point, currentTime) {
  const time = currentTime
    ? new Date(currentTime).toISOString().split(".")[0].replace("T", "").replace(/-/g, "").replace(/:/g, "").slice(-6) + "." + String(Math.floor(currentTime % 1000 / 10)).padStart(2, "0")
    : "000000.00";

  const lat = convertToNMEACoordinate(point.lat, true);
  const lon = convertToNMEACoordinate(point.lon, false);
  const ele = point.ele.toFixed(2);

  const nmeaString = `$GPGGA,${time},${lat},N,${lon},E,1,05,2.87,${ele},M,00.000,M,,`;

  const checksum = calculateChecksum(nmeaString);
  return nmeaString + "*" + checksum.toString(16).toUpperCase();
}

function convertToNMEACoordinate(coordinate, isLatitude) {
  const degrees = Math.abs(coordinate);
  let result = degrees.toFixed(7);
  
  // Pad the result with leading zeros
  if (isLatitude) {
    // Latitude should be 2 digits before the decimal
    result = result.padStart(9, '0');
  } else {
    // Longitude should be 3 digits before the decimal
    result = result.padStart(10, '0');
  }

  return result;
}

function calculateChecksum(nmeaString) {
  let checksum = 0;
  for (let i = 1; i < nmeaString.length; i++) {
    checksum ^= nmeaString.charCodeAt(i);
  }
  return checksum;
}

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
      driverBehaviorSelect.value
    );

    const processedRoutePoints =
      speedOrTime === "routeTime"
        ? physicsEngine.processRoute()
        : physicsEngine.processRouteWithDynamicSpeed(1);

    const updateRate = totalRouteTime
      ? (totalRouteTime * 1000) / processedRoutePoints.length
      : 1000;

    // Create a single reusable marker instead of creating/destroying per frame
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

      // Recalculate each frame so playback rate changes take effect immediately
      const frameInterval = updateRate / (animationPlaybackRate * parseFloat(frequencyInput.value));

      while (accumulatedTime >= frameInterval && animationIndex < processedRoutePoints.length - 1) {
        accumulatedTime -= frameInterval;

        const point = processedRoutePoints[animationIndex];
        const nextPoint = processedRoutePoints[Math.min(animationIndex + 1, processedRoutePoints.length - 1)];

        animationMarker.setLatLng([point.lat, point.lon]);

        // Smart panning: only pan when marker nears the edge of visible bounds
        if (!visualization.map.getBounds().pad(-0.2).contains(animationMarker.getLatLng())) {
          visualization.map.panTo([point.lat, point.lon]);
        }

        speedDisplay.textContent = `${point.speed.toFixed(1)} km/h`;
        bearingDisplay.textContent = `${GeoUtils.calculateBearing(point, nextPoint).toFixed(1)}°`;

        const elapsedTime = animationIndex * updateRate / parseFloat(frequencyInput.value);
        timeDisplay.textContent = new Date(startTime.getTime() + elapsedTime).toLocaleTimeString();

        animationIndex++;
      }

      if (animationIndex < processedRoutePoints.length - 1) {
        animationFrameId = requestAnimationFrame(animate);
      } else {
        // Animation complete
        animationState = "stopped";
        animationIndex = 0;
        if (animationMarker) {
          visualization.markerLayer.removeLayer(animationMarker);
          animationMarker = null;
        }
      }
    }

    animationFrameId = requestAnimationFrame(animate);
  }
}


function handlePause() {
  if (animationState === "playing") {
    animationState = "paused";
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }
}

function handleStop() {
  if (animationState === "playing" || animationState === "paused") {
    animationState = "stopped";
    animationIndex = 0;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (animationMarker) {
      visualization.markerLayer.removeLayer(animationMarker);
      animationMarker = null;
    }
    visualization.markerLayer.clearLayers();
  }
}

function handleAnimationPlaybackRateChange() {
  animationPlaybackRate = parseFloat(animationPlaybackRateInput.value);
}

const downloadCSVButton = document.getElementById("downloadCSV");
const downloadCSVAltButton = document.getElementById("downloadCSVAlt");

downloadCSVButton.addEventListener("click", () => handleDownloadCSV(false), false);
downloadCSVAltButton.addEventListener("click", () => handleDownloadCSV(true), false);
