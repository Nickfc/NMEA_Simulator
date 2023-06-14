class Integration {
  constructor() {
    const mapContainer = document.getElementById("map");
    if (!mapContainer._leaflet_id) {
      this.map = L.map("map").setView([51.505, -0.09], 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">Open StreetMap</a> contributors',
      }).addTo(this.map);
    } else {
      this.map = L.map._instances[mapContainer._leaflet_id];
    }

    this.routePoints = [];

    this.map.on("click", (event) => {
      this.addRoutePoint(event.latlng);
    });

    this.routeLayer = L.layerGroup().addTo(this.map);
  }

  addRoutePoint(latlng) {
    this.routePoints.push(latlng);

    if (this.routePoints.length > 1) {
      const lastIndex = this.routePoints.length - 1;
      const polyline = L.polyline([this.routePoints[lastIndex - 1], this.routePoints[lastIndex]], { color: "red" }).addTo(this.routeLayer);
    }
  }

  clearRoute() {
    this.routeLayer.clearLayers();
    this.routePoints = [];
  }
}