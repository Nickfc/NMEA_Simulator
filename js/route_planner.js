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
   * @param {Array} waypoints
   * @param {string} [profile='driving'] - OSRM profile: driving | cycling | foot
   * Returns { coordinates: [{lat, lon, ele}], distanceKm, durationSec }.
   */
  async route(waypoints, profile = "driving") {
    if (waypoints.length < 2) throw new Error("Need at least 2 waypoints");

    const coords = waypoints.map((w) => `${w.lon},${w.lat}`).join(";");
    const url = `${this.OSRM}/route/v1/${profile}/${coords}?` + new URLSearchParams({
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
   * Simple seeded PRNG (mulberry32) so the same seed gives the same jitter.
   * Returns a function that yields numbers in [0, 1).
   */
  _seededRng(seed) {
    let s = seed | 0;
    return function () {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /**
   * Generate a closed-loop route of approximately `targetKm` kilometres
   * starting and ending at `start` {lat,lon}.
   *
   * @param {Object} start           - {lat, lon}
   * @param {number} targetKm        - desired loop distance
   * @param {Object} [opts]          - optional settings
   * @param {string} [opts.shape='circular']    - circular | elongated | random
   * @param {string|number} [opts.heading='any'] - 'any' or degrees 0-360
   * @param {string} [opts.profile='driving']    - driving | cycling | foot
   * @param {number} [opts.seed=1]               - deterministic variation seed
   */
  async closedLoop(start, targetKm, opts = {}) {
    if (targetKm < 0.5) throw new Error("Minimum loop distance is 0.5 km");

    const shape   = opts.shape   || "circular";
    const heading = opts.heading != null && opts.heading !== "any" ? parseFloat(opts.heading) : null;
    const profile = opts.profile || "driving";
    const seed    = opts.seed    || 1;
    const rng     = this._seededRng(seed);

    let radiusKm = targetKm / (2 * Math.PI) * 1.15;
    const numPoints = targetKm < 3 ? 4 : targetKm < 15 ? 5 : 6;

    // Heading offset in radians (rotates the entire loop)
    const headingRad = heading != null ? (heading * Math.PI / 180) : (rng() * 2 * Math.PI);

    for (let attempt = 0; attempt < 3; attempt++) {
      const waypoints = this._buildLoopWaypoints(start, radiusKm, numPoints, shape, headingRad, rng);
      const result = await this.route(waypoints, profile);

      const ratio = targetKm / result.distanceKm;
      if (Math.abs(ratio - 1) < 0.15) return result;
      radiusKm *= ratio;
    }

    // Final attempt – return whatever we get
    const waypoints = this._buildLoopWaypoints(start, radiusKm, numPoints, shape, headingRad, rng);
    return this.route(waypoints, profile);
  }

  /**
   * Build an array of loop waypoints around `start`.
   * @private
   */
  _buildLoopWaypoints(start, radiusKm, numPoints, shape, headingRad, rng) {
    const radiusDeg = radiusKm / 111;
    const cosLat = Math.cos(start.lat * Math.PI / 180);
    const waypoints = [{ lat: start.lat, lon: start.lon }];

    for (let i = 0; i < numPoints; i++) {
      const baseAngle = (2 * Math.PI * i) / numPoints + headingRad;

      // Shape modifiers
      let rX = 1, rY = 1;
      if (shape === "elongated") {
        // Stretch along the heading axis, compress perpendicular
        rX = 1.8;  // along heading
        rY = 0.45; // across heading
      } else if (shape === "random") {
        rX = 0.5 + rng() * 1.5;
        rY = 0.5 + rng() * 1.5;
      }

      // Deterministic jitter per point (±15%)
      const jitter = 0.85 + rng() * 0.3;

      // Compute in local frame then rotate by headingRad
      const localX = Math.cos(baseAngle) * rX;
      const localY = Math.sin(baseAngle) * rY;

      const lat = start.lat + radiusDeg * localY * jitter;
      const lon = start.lon + radiusDeg * localX * jitter / cosLat;
      waypoints.push({ lat, lon });
    }

    // Close the loop
    waypoints.push({ lat: start.lat, lon: start.lon });
    return waypoints;
  }
}
