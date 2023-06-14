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
const interpolationInput = document.getElementById("interpolation");

const routeToggle = document.getElementById("routeToggle");
const markersToggle = document.getElementById("markersToggle");
const originalMarkersToggle = document.getElementById("originalMarkersToggle");

const animationPlaybackRateInput = document.getElementById("animationPlaybackRate");

const pastSpeeds = [];
const numPastPoints = 5;

fileInput.addEventListener("change", handleFileInputChange, false);
generateNMEAButton.addEventListener("click", handleGenerateNMEA, false);
clearRouteButton.addEventListener("click", handleClearRoute, false);
downloadNMEAButton.addEventListener("click", handleDownloadNMEA, false);
playButton.addEventListener("click", handlePlay, false);
pauseButton.addEventListener("click", handlePause, false);
stopButton.addEventListener("click", handleStop, false);

routeToggle.addEventListener("change", handleRouteToggle, false);
markersToggle.addEventListener("change", handleMarkersToggle, false);
originalMarkersToggle.addEventListener("change", handleOriginalMarkersToggle, false);

animationPlaybackRateInput.addEventListener("input", handleAnimationPlaybackRateChange, false);

const conversion = new Conversion();
const customization = new Customization();
const mapIntegration = new Integration();

let visualization = null;
let timeLapseInterval = null;
let originalMarkersLayer = L.layerGroup().addTo(mapIntegration.map);
let animationPlaybackRate = 1;
let animationState = "stopped";
let animationIndex = 0;

async function handleFileInputChange(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const routePoints = await conversion.readFile(file);
    mapIntegration.clearRoute();
    routePoints.forEach((point) => mapIntegration.addRoutePoint([point.lat, point.lon]));
  } catch (error) {
    alert("Error: " + error.message);
  }
}

function handleClearRoute() {
  mapIntegration.clearRoute();
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

  visualization = new Visualization(mapIntegration.map, processedRoutePoints, customization, vehicleTypeSelect.value);

  progressBar.max = processedRoutePoints.length;
  progressBar.value = 0;

  const nmeaData = [];
  let currentTime = 0;
  for (const point of processedRoutePoints) {
    const nmeaSentence = generateNMEASentence(point, currentTime);
    nmeaData.push(nmeaSentence);
    progressBar.value += 1;
    currentTime += totalRouteTime * 1000 / processedRoutePoints.length;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  downloadNMEAButton.disabled = false;
}

function handleDownloadNMEA() {
  const nmeaData = [];
  let currentTime = 0;
  conversion.routePoints.forEach((point) => {
    const nmeaSentence = generateNMEASentence(point, currentTime);
    nmeaData.push(nmeaSentence);
    currentTime += parseFloat(totalRouteTimeInput.value) * 60 * 1000 / conversion.routePoints.length;
  });

  const blob = new Blob([nmeaData.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "nmea_data.txt";
  link.click();
  URL.revokeObjectURL(url);
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

async function handlePlay() {
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

    const animationUpdateRate = updateRate;

    for (; animationIndex < processedRoutePoints.length - 1; animationIndex++) {
      if (animationState !== "playing") break;

      const startPoint = processedRoutePoints[animationIndex];
      const endPoint = processedRoutePoints[animationIndex + 1];

      const marker = L.marker([startPoint.lat, startPoint.lon]).addTo(visualization.markerLayer);
      visualization.map.panTo([startPoint.lat, startPoint.lon]);

      speedDisplay.textContent = `Speed: ${startPoint.speed.toFixed(2)} km/h`;

      await new Promise((resolve) => setTimeout(resolve, animationUpdateRate / (animationPlaybackRate * parseFloat(frequencyInput.value))));

      bearingDisplay.textContent = `Bearing: ${calculateBearing(startPoint, endPoint).toFixed(2)}°`;

      const elapsedTime = animationIndex * animationUpdateRate / parseFloat(frequencyInput.value);
      timeDisplay.textContent = `Time: ${new Date(startTime.getTime() + elapsedTime).toLocaleTimeString()}`;

      visualization.markerLayer.removeLayer(marker);
    }
  }
}


function handlePause() {
  if (animationState === "playing") {
    animationState = "paused";
  }
}

function handleStop() {
  if (animationState === "playing" || animationState === "paused") {
    animationState = "stopped";
    animationIndex = 0;
    visualization.markerLayer.clearLayers();
  }
}

function handleRouteToggle() {
  if (visualization) {
    visualization.toggleRoutePolyline(routeToggle.checked);
  }
}

function handleMarkersToggle() {
  if (visualization) {
    visualization.markerLayer.eachLayer((layer) => {
      layer.setOpacity(markersToggle.checked ? 1 : 0);
    });
  }
}

function handleOriginalMarkersToggle() {
  if (originalMarkersLayer) {
    originalMarkersLayer.eachLayer((layer) => {
      layer.setOpacity(originalMarkersToggle.checked ? 1 : 0);
    });
  }
}

function handleAnimationPlaybackRateChange() {
  animationPlaybackRate = parseFloat(animationPlaybackRateInput.value);
}

function calculateBearing(point1, point2) {
  const lat1 = point1.lat * (Math.PI / 180);
  const lat2 = point2.lat * (Math.PI / 180);
  const dLon = (point2.lon - point1.lon) * (Math.PI / 180);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = Math.atan2(y, x) * (180 / Math.PI);

  return (bearing + 360) % 360;
}