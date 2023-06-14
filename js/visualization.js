class Visualization {
  constructor(map, routePoints, customization, vehicleType) {
    this.routePoints = routePoints;
    this.map = map;
    this.customization = customization;
    this.vehicleType = vehicleType;

    this.markerLayer = L.layerGroup().addTo(this.map);
    this.routeLayer = L.layerGroup().addTo(this.map);
    this.originalRouteLayer = L.layerGroup().addTo(this.map);
    this.originalMarkerLayer = L.layerGroup().addTo(this.map);

    this.routePolyline = L.polyline(this.routePoints, { color: "blue" }).addTo(this.routeLayer);

    this.updateSecondaryHUD();
  }

  updateSecondaryHUD() {
    const totalDistance = this.calculateTotalDistance();
    const estimatedTime = this.calculateEstimatedTime(totalDistance);

    document.getElementById("totalDistanceDisplay").textContent = `Total Distance: ${totalDistance.toFixed(2)} km`;
    document.getElementById("estimatedTimeDisplay").textContent = `Estimated Time: ${estimatedTime.toFixed(2)} hours`;
  }

  calculateTotalDistance() {
    let totalDistance = 0;
    for (let i = 0; i < this.routePoints.length - 1; i++) {
      const point1 = this.routePoints[i];
      const point2 = this.routePoints[i + 1];
      totalDistance += this.calculateDistance(point1, point2);
    }
    return totalDistance;
  }

  calculateEstimatedTime(totalDistance) {
    const vehicleProfile = this.customization.getVehicleProfile(this.vehicleType);
    const averageSpeed = vehicleProfile.maxSpeed; // Use the max speed of the selected vehicle
    return totalDistance / averageSpeed;
  }

  calculateDistance(point1, point2) {
    const R = 6371; // Radius of the Earth in km
    const dLat = this.deg2rad(point2.lat - point1.lat);
    const dLon = this.deg2rad(point2.lon - point1.lon);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(point1.lat)) * Math.cos(this.deg2rad(point2.lat)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
  }

  deg2rad(deg) {
    return deg * (Math.PI / 180);
  }

  toggleRoutePolyline(visible) {
    if (visible) {
      this.routePolyline.addTo(this.routeLayer);
    } else {
      this.routeLayer.removeLayer(this.routePolyline);
    }
  }

  toggleOriginalRoutePolyline(visible) {
    if (visible) {
      this.originalRouteLayer.eachLayer((layer) => {
        layer.addTo(this.originalRouteLayer);
      });
    } else {
      this.originalRouteLayer.clearLayers();
    }
  }

  toggleOriginalMarkers(visible) {
    if (visible) {
      this.originalMarkerLayer.eachLayer((layer) => {
        layer.addTo(this.originalMarkerLayer);
      });
    } else {
      this.originalMarkerLayer.clearLayers();
    }
  }

  async createTimeLapse(interval, interpolation) {
    this.markerLayer.clearLayers();

    const ticks = (interpolation + 1);
    const stepInterval = interval / ticks;
    for (let index = 0; index < this.routePoints.length - 1; index++) {
      const startPoint = this.routePoints[index];
      const endPoint = this.routePoints[index + 1];
      const latStep = (endPoint.lat - startPoint.lat) / ticks;
      const lonStep = (endPoint.lon - startPoint.lon) / ticks;

      for (let i = 0; i <= interpolation; i++) {
        const interpolatedLat = startPoint.lat + latStep * i;
        const interpolatedLon = startPoint.lon + lonStep * i;
        const marker = L.marker([interpolatedLat, interpolatedLon]).addTo(this.markerLayer);

        await new Promise((resolve) => setTimeout(resolve, stepInterval));
        this.markerLayer.removeLayer(marker);
      }
    }
  }
}