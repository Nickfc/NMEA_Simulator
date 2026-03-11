/**
 * RoutePlanner – handles geocoding, OSRM routing, and closed-loop generation.
 *
 * APIs used (all free, no key):
 *   Geocoding  → Nominatim  (OpenStreetMap)
 *   Routing    → OSRM demo  (project-osrm.org)
 */
class RoutePlanner {
  constructor() {
    this.NOMINATIM = "https://nominatim.openstreetmap.org";
    this.OSRM      = "https://router.project-osrm.org";
  }

  /* ─── Geocoding ─── */

  /** Search for a place and return an array of { display_name, lat, lon }. */
  async geocode(query) {
    const url = `${this.NOMINATIM}/search?` + new URLSearchParams({
      q: query, format: "json", limit: 5, addressdetails: 1,
    });
    const res = await fetch(url, {
      headers: { "Accept-Language": "en" },
    });
    if (!res.ok) throw new Error("Geocoding failed");
    const data = await res.json();
    return data.map((r) => ({
      display_name: r.display_name,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
    }));
  }

  /** Reverse-geocode a lat/lon to a short label. */
  async reverseGeocode(lat, lon) {
    const url = `${this.NOMINATIM}/reverse?` + new URLSearchParams({
      lat, lon, format: "json", zoom: 16,
    });
    const res = await fetch(url, {
      headers: { "Accept-Language": "en" },
    });
    if (!res.ok) return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const data = await res.json();
    // Build a short label: road, city (or just display_name truncated)
    const a = data.address || {};
    const short = a.road || a.hamlet || a.village || a.town || a.city || "";
    const city  = a.city || a.town || a.village || a.state || "";
    if (short && city && short !== city) return `${short}, ${city}`;
    if (short) return short;
    return (data.display_name || "").split(",").slice(0, 2).join(",").trim();
  }

  /* ─── Routing ─── */

  /**
   * Get a routed path between an ordered array of waypoints [{lat,lon},...].
   * Returns { coordinates: [{lat, lon, ele}], distanceKm, durationSec }.
   */
  async route(waypoints) {
    if (waypoints.length < 2) throw new Error("Need at least 2 waypoints");

    const coords = waypoints.map((w) => `${w.lon},${w.lat}`).join(";");
    const url = `${this.OSRM}/route/v1/driving/${coords}?` + new URLSearchParams({
      overview: "full",
      geometries: "geojson",
      steps: "false",
    });

    const res = await fetch(url);
    if (!res.ok) throw new Error("Routing request failed");
    const data = await res.json();
    if (!data.routes || data.routes.length === 0) throw new Error("No route found");

    const route = data.routes[0];
    const coordinates = route.geometry.coordinates.map(([lon, lat]) => ({
      lat, lon, ele: 0,
    }));

    return {
      coordinates,
      distanceKm: route.distance / 1000,
      durationSec: route.duration,
    };
  }

  /* ─── Closed-loop generation ─── */

  /**
   * Generate a closed-loop route of approximately `targetKm` kilometres
   * starting and ending at `start` {lat,lon}.
   *
   * Strategy: place 4–6 intermediate waypoints in a rough circle around the
   * start, then route through them and back to start via OSRM.
   * The actual routed distance will differ from the target because roads
   * don't follow straight lines, so we do one iteration of scaling.
   */
  async closedLoop(start, targetKm) {
    if (targetKm < 0.5) throw new Error("Minimum loop distance is 0.5 km");

    // Rough radius in degrees (1° lat ≈ 111 km)
    let radiusKm = targetKm / (2 * Math.PI) * 1.15;   // slight oversize
    const numPoints = targetKm < 3 ? 4 : targetKm < 15 ? 5 : 6;

    // Build attempt with scaling
    for (let attempt = 0; attempt < 3; attempt++) {
      const radiusDeg = radiusKm / 111;
      const waypoints = [{ lat: start.lat, lon: start.lon }];

      for (let i = 0; i < numPoints; i++) {
        const angle = (2 * Math.PI * i) / numPoints - Math.PI / 2;
        // Add small random jitter (10-20%) so it's not a perfect circle
        const jitter = 0.85 + Math.random() * 0.3;
        const lat = start.lat + radiusDeg * Math.sin(angle) * jitter;
        const lon = start.lon + radiusDeg * Math.cos(angle) * jitter / Math.cos(start.lat * Math.PI / 180);
        waypoints.push({ lat, lon });
      }

      // Close the loop
      waypoints.push({ lat: start.lat, lon: start.lon });

      const result = await this.route(waypoints);

      // Check how far off we are
      const ratio = targetKm / result.distanceKm;
      if (Math.abs(ratio - 1) < 0.15) {
        // Close enough (within 15%)
        return result;
      }
      // Scale radius for next attempt
      radiusKm *= ratio;
    }

    // Final attempt – just return whatever we got
    const radiusDeg = radiusKm / 111;
    const waypoints = [{ lat: start.lat, lon: start.lon }];
    for (let i = 0; i < numPoints; i++) {
      const angle = (2 * Math.PI * i) / numPoints - Math.PI / 2;
      const jitter = 0.85 + Math.random() * 0.3;
      const lat = start.lat + radiusDeg * Math.sin(angle) * jitter;
      const lon = start.lon + radiusDeg * Math.cos(angle) * jitter / Math.cos(start.lat * Math.PI / 180);
      waypoints.push({ lat, lon });
    }
    waypoints.push({ lat: start.lat, lon: start.lon });
    return this.route(waypoints);
  }
}
