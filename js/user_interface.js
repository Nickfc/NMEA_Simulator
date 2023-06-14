// Function to handle form submission
function handleFormSubmit(event) {
  event.preventDefault();

  const fileInput = document.getElementById('fileInput');
  const vehicleType = document.getElementById('vehicleType').value;
  const weatherCondition = document.getElementById('weatherCondition').value;
  const trafficCondition = document.getElementById('trafficCondition').value;
  const roadCondition = document.getElementById('roadCondition').value;
  const vehicleLoad = document.getElementById('vehicleLoad').value;
  const driverBehavior = document.getElementById('driverBehavior').value;

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = (e) => {
    const fileContent = e.target.result;
    const fileType = file.name.split('.').pop().toLowerCase();

    // Call the convertFile function from conversion.js
    const nmeaData = convertFile(fileContent, fileType, { smoothingFactor: 0.5 });

    // Process the NMEA data using the processNMEAData function from physics_engine.js
    const processedData = processNMEAData(nmeaData, vehicleType);

    // Apply customizations using the applyCustomizations function from customization.js
    const customizations = {
      vehicleType,
      weatherCondition,
      trafficCondition,
      roadCondition,
      vehicleLoad,
      driverBehavior,
    };
    const customizedData = applyCustomizations(processedData, customizations);

    // Generate visualizations and report using functions from visualization.js
    generateHeatmap(customizedData, map);
    generateTimeLapse(customizedData, map);
    generateReport(customizedData);
  };

  reader.readAsText(file);
}

// Initialize the form event listener
const form = document.getElementById('customizationForm');
form.addEventListener('submit', handleFormSubmit);