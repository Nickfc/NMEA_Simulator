/**
 * Integration – manages the Leaflet map, numbered waypoint markers,
 * and the routed polyline overlay.
 */
class Integration {
  constructor() {
    const mapContainer = document.getElementById("map");
    if (!mapContainer._leaflet_id) {
      this.map = L.map("map").setView([51.505, -0.09], 13);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
      }).addTo(this.map);
    } else {
      this.map = L.map._instances[mapContainer._leaflet_id];
    }

    /** Ordered waypoints – each { lat, lon, label, marker } */
    this.waypoints = [];

    /** Layer for waypoint markers */
    this.waypointLayer = L.layerGroup().addTo(this.map);

    /** Layer for the routed polyline */
    this.routeLayer = L.layerGroup().addTo(this.map);

    /** Layer for traffic stop markers on route */
    this.trafficLayer = L.layerGroup().addTo(this.map);

    /** The polyline drawn after routing */
    this.routePolyline = null;

    /** Callback fired whenever the waypoint list changes */
    this.onWaypointsChanged = null;

    /** Callback fired when a specific waypoint marker is dragged (receives index, wp) */
    this.onWaypointDragged = null;

    // Click-to-add waypoint
    this.map.on("click", (e) => {
      this.addWaypoint(e.latlng.lat, e.latlng.lng);
    });
  }

  /* ─── Waypoint management ─── */

  /** Create a numbered circle marker for a waypoint. */
  _createMarker(wp, index) {
    const icon = L.divIcon({
      className: "wp-marker",
      html: `<span>${index + 1}</span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const marker = L.marker([wp.lat, wp.lon], {
      icon,
      draggable: true,
      zIndexOffset: 1000,
    });

    marker.on("dragend", (e) => {
      const pos = e.target.getLatLng();
      wp.lat = pos.lat;
      wp.lon = pos.lng;
      this._notifyChange();
      if (typeof this.onWaypointDragged === "function") {
        this.onWaypointDragged(index, wp);
      }
    });

    // Right-click to remove
    marker.on("contextmenu", () => {
      this.removeWaypoint(this.waypoints.indexOf(wp));
    });

    marker.addTo(this.waypointLayer);
    return marker;
  }

  /** Rebuild all markers (renumber after add/remove/reorder). */
  _rebuildMarkers() {
    this.waypointLayer.clearLayers();
    this.waypoints.forEach((wp, i) => {
      wp.marker = this._createMarker(wp, i);
    });
  }

  _notifyChange() {
    if (typeof this.onWaypointsChanged === "function") {
      this.onWaypointsChanged(this.waypoints);
    }
  }

  /** Add a waypoint at the end. Returns the waypoint object. */
  addWaypoint(lat, lon, label) {
    const wp = { lat, lon, label: label || "", marker: null };
    this.waypoints.push(wp);
    this._rebuildMarkers();
    this._notifyChange();
    return wp;
  }

  /** Remove a waypoint by index. */
  removeWaypoint(index) {
    if (index < 0 || index >= this.waypoints.length) return;
    this.waypoints.splice(index, 1);
    this._rebuildMarkers();
    this._notifyChange();
  }

  /** Move a waypoint from one index to another (drag-reorder in list). */
  reorderWaypoint(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const [wp] = this.waypoints.splice(fromIndex, 1);
    this.waypoints.splice(toIndex, 0, wp);
    this._rebuildMarkers();
    this._notifyChange();
  }

  /** Draw the routed polyline from an array of {lat,lon} coords. */
  drawRoute(coords) {
    this.routeLayer.clearLayers();
    const latlngs = coords.map((c) => [c.lat, c.lon]);
    this.routePolyline = L.polyline(latlngs, {
      color: "#4f8cff",
      weight: 4,
      opacity: 0.85,
    }).addTo(this.routeLayer);
    this.map.fitBounds(this.routePolyline.getBounds(), { padding: [50, 50] });
  }

  /**
   * Draw traffic light & stop sign markers along the route.
   * @param {Array} coordinates - [{lat, lon}, ...]
   * @param {Object} snappedEnv - from RoutePlanner.snapEnvironmentToRoute
   */
  drawTrafficMarkers(coordinates, snappedEnv) {
    this.trafficLayer.clearLayers();
    if (!coordinates || !snappedEnv) return;

    for (let i = 0; i < coordinates.length; i++) {
      const c = coordinates[i];
      if (snappedEnv.trafficSignals[i]) {
        L.circleMarker([c.lat, c.lon], {
          radius: 5, fillColor: '#f44336', color: '#b71c1c',
          weight: 1.5, fillOpacity: 0.85,
        }).bindTooltip('Traffic Light', { direction: 'top', className: 'traffic-tooltip' })
         .addTo(this.trafficLayer);
      } else if (snappedEnv.stopSigns[i]) {
        L.circleMarker([c.lat, c.lon], {
          radius: 4.5, fillColor: '#ff9800', color: '#e65100',
          weight: 1.5, fillOpacity: 0.85,
        }).bindTooltip('Stop Sign', { direction: 'top', className: 'traffic-tooltip' })
         .addTo(this.trafficLayer);
      }
    }
  }

  /** Clear everything. */
  clearRoute() {
    this.waypoints = [];
    this.waypointLayer.clearLayers();
    this.routeLayer.clearLayers();
    this.trafficLayer.clearLayers();
    this.routePolyline = null;
    this._notifyChange();
  }

  /** Get simple waypoint coords for the planner [{lat,lon}]. */
  getWaypointCoords() {
    return this.waypoints.map((wp) => ({ lat: wp.lat, lon: wp.lon }));
  }
}