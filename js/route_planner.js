/**
 * RoutePlanner – handles geocoding, OSRM routing, Overpass enrichment,
 * and closed-loop generation.
 *
 * APIs used (all free, no key):
 *   Geocoding  → Nominatim  (OpenStreetMap)
 *   Routing    → OSRM demo  (project-osrm.org)
 *   Map data   → Overpass   (overpass-api.de)
 */
class RoutePlanner {
  constructor() {
    this.NOMINATIM = "https://nominatim.openstreetmap.org";
    this.OSRM      = "https://router.project-osrm.org";
    this.OVERPASS  = "https://overpass-api.de/api/interpreter";
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
   * Returns { coordinates, distanceKm, durationSec, environmentData }.
   *
   * environmentData = {
   *   osrmSpeeds:      [{speed, distance}]   – per-segment from annotations
   *   maneuvers:       [{lat, lon, type, name, modifier}]  – from steps
   *   overpass:        {trafficSignals, stopSigns, speedLimits, roadTypes}
   *   source:          "osrm+overpass" | "osrm" | "basic"
   * }
   */
  async route(waypoints, profile = "driving") {
    if (waypoints.length < 2) throw new Error("Need at least 2 waypoints");

    const coords = waypoints.map((w) => `${w.lon},${w.lat}`).join(";");
    const url = `${this.OSRM}/route/v1/${profile}/${coords}?` + new URLSearchParams({
      overview: "full",
      geometries: "geojson",
      steps: "true",
      annotations: "speed,duration,nodes",
    });

    const res = await fetch(url);
    if (!res.ok) throw new Error("Routing request failed");
    const data = await res.json();
    if (!data.routes || data.routes.length === 0) throw new Error("No route found");

    const route = data.routes[0];
    const coordinates = route.geometry.coordinates.map(([lon, lat]) => ({
      lat, lon, ele: 0,
    }));

    // ── Parse OSRM annotations (per-segment speeds) ──
    const osrmSpeeds = [];
    if (route.legs) {
      for (const leg of route.legs) {
        if (leg.annotation && leg.annotation.speed) {
          const speeds = leg.annotation.speed;
          const dists  = leg.annotation.distance || [];
          for (let i = 0; i < speeds.length; i++) {
            osrmSpeeds.push({
              speed: speeds[i],       // m/s
              distance: dists[i] || 0, // metres
            });
          }
        }
      }
    }

    // ── Parse OSRM steps (maneuvers = real intersections) ──
    const maneuvers = [];
    if (route.legs) {
      for (const leg of route.legs) {
        if (leg.steps) {
          for (const step of leg.steps) {
            if (step.maneuver) {
              maneuvers.push({
                lat: step.maneuver.location[1],
                lon: step.maneuver.location[0],
                type: step.maneuver.type,       // turn, new name, roundabout, etc.
                modifier: step.maneuver.modifier || null,  // left, right, straight
                name: step.name || "",
                ref: step.ref || "",
                speedLimit: step.speed_limit || null,
              });
            }
          }
        }
      }
    }

    // ── Build environment data ──
    const environmentData = {
      osrmSpeeds,
      maneuvers,
      overpass: null,
      source: "osrm",
    };

    // ── Fetch Overpass enrichment (async, non-blocking on failure) ──
    try {
      const overpass = await this.queryOverpass(coordinates);
      if (overpass) {
        environmentData.overpass = overpass;
        environmentData.source = "osrm+overpass";
      }
    } catch (e) {
      console.warn("Overpass query failed, using OSRM-only data:", e.message);
    }

    return {
      coordinates,
      distanceKm: route.distance / 1000,
      durationSec: route.duration,
      environmentData,
    };
  }

  /* ─── Overpass API ─── */

  /**
   * Query Overpass for traffic signals, stop signs, speed limits, and road
   * types within the bounding box of the given route coordinates.
   * Returns { trafficSignals, stopSigns, speedLimits, roadTypes }.
   */
  async queryOverpass(coordinates) {
    if (!coordinates || coordinates.length < 2) return null;

    // Compute bounding box with a small padding (~200 m ≈ 0.002°)
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    for (const c of coordinates) {
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
      if (c.lon < minLon) minLon = c.lon;
      if (c.lon > maxLon) maxLon = c.lon;
    }
    const pad = 0.002;
    const bbox = `${minLat - pad},${minLon - pad},${maxLat + pad},${maxLon + pad}`;

    // Single Overpass query: traffic signals, stop signs, speed limits, road types
    const query = `
      [out:json][timeout:15][bbox:${bbox}];
      (
        node["highway"="traffic_signals"];
        node["highway"="stop"];
        node["highway"="give_way"];
        way["maxspeed"];
        way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street)$"];
      );
      out body geom;
    `;

    const res = await fetch(this.OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
    });

    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const data = await res.json();
    if (!data.elements) return null;

    // ── Sort elements into categories ──
    const trafficSignals = [];
    const stopSigns = [];
    const speedLimits = [];  // ways with maxspeed
    const roadTypes = [];    // ways with highway tag

    for (const el of data.elements) {
      if (el.type === "node") {
        const hw = el.tags && el.tags.highway;
        if (hw === "traffic_signals") {
          trafficSignals.push({ lat: el.lat, lon: el.lon, id: el.id });
        } else if (hw === "stop") {
          stopSigns.push({ lat: el.lat, lon: el.lon, id: el.id });
        }
        // give_way → treat as stop sign (yield)
        else if (hw === "give_way") {
          stopSigns.push({ lat: el.lat, lon: el.lon, id: el.id, yield: true });
        }
      }
      else if (el.type === "way" && el.geometry) {
        const tags = el.tags || {};
        const wayGeom = el.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));

        if (tags.maxspeed) {
          // Parse maxspeed: "50", "30 mph", "none", etc.
          const parsed = this._parseMaxspeed(tags.maxspeed);
          if (parsed > 0) {
            speedLimits.push({
              id: el.id,
              speedKmh: parsed,
              geometry: wayGeom,
              highway: tags.highway || "",
            });
          }
        }

        if (tags.highway) {
          roadTypes.push({
            id: el.id,
            highway: tags.highway,
            geometry: wayGeom,
            name: tags.name || "",
          });
        }
      }
    }

    return { trafficSignals, stopSigns, speedLimits, roadTypes };
  }

  /**
   * Parse an OSM maxspeed value to km/h.
   * Handles: "50", "30 mph", "none", "walk", "RO:urban", etc.
   */
  _parseMaxspeed(val) {
    if (!val || val === "none" || val === "signals") return 0;
    if (val === "walk" || val === "living_street") return 5;

    // Handle "XX mph"
    const mphMatch = val.match(/^(\d+)\s*mph$/i);
    if (mphMatch) return parseFloat(mphMatch[1]) * 1.60934;

    // Handle "XX" (km/h implied)
    const numMatch = val.match(/^(\d+)/);
    if (numMatch) return parseFloat(numMatch[1]);

    // Country-specific defaults (e.g. "RO:urban" → 50)
    if (val.includes(":urban")) return 50;
    if (val.includes(":rural")) return 90;
    if (val.includes(":motorway")) return 130;

    return 0;
  }

  /**
   * Snap Overpass + OSRM data to route coordinates.
   * Returns per-point arrays: { speedLimits[], roadTypes[], trafficSignals[], stopSigns[] }
   * Each array is same length as coords. Values are the nearest match or null.
   */
  static snapEnvironmentToRoute(coordinates, environmentData) {
    const n = coordinates.length;
    const result = {
      speedLimits:    new Array(n).fill(null),   // km/h or null
      roadTypes:      new Array(n).fill(null),   // OSM highway tag or null
      roadNames:      new Array(n).fill(null),   // street name or null
      trafficSignals: new Uint8Array(n),         // 1 = traffic light nearby
      stopSigns:      new Uint8Array(n),         // 1 = stop sign nearby
      osrmSpeeds:     new Float64Array(n),       // OSRM annotation speed m/s
      maneuverPoints: new Uint8Array(n),         // 1 = OSRM maneuver here
      signalCoords:   {},                        // { idx: {lat,lon} } actual signal positions
      stopCoords:     {},                        // { idx: {lat,lon} } actual stop-sign positions
      source:         environmentData.source || "basic",
    };

    // ── 1. OSRM annotation speeds → per-point ──
    // Annotations are per-segment (n-1 values for n coords).
    // Map segment i → point i (the start of that segment).
    if (environmentData.osrmSpeeds && environmentData.osrmSpeeds.length > 0) {
      const speeds = environmentData.osrmSpeeds;
      for (let i = 0; i < n; i++) {
        // Annotations can have fewer entries than coords (gaps between legs)
        const si = Math.min(i, speeds.length - 1);
        result.osrmSpeeds[i] = speeds[si] ? speeds[si].speed : 0;
      }
    }

    // ── 2. OSRM maneuvers → snap to nearest route point ──
    if (environmentData.maneuvers) {
      for (const m of environmentData.maneuvers) {
        const idx = RoutePlanner._nearestPointIndex(coordinates, m.lat, m.lon, 50);
        if (idx >= 0) result.maneuverPoints[idx] = 1;
      }
    }

    // ── 3. Overpass data ──
    const ov = environmentData.overpass;
    if (ov) {
      // Traffic signals → segment-based snap within 30 m
      if (ov.trafficSignals) {
        for (const ts of ov.trafficSignals) {
          const idx = RoutePlanner._findBestStopIndex(coordinates, ts.lat, ts.lon, 30);
          if (idx >= 0) {
            result.trafficSignals[idx] = 1;
            result.signalCoords[idx] = { lat: ts.lat, lon: ts.lon };
          }
        }
      }

      // Stop signs → segment-based snap within 25 m
      if (ov.stopSigns) {
        for (const ss of ov.stopSigns) {
          const idx = RoutePlanner._findBestStopIndex(coordinates, ss.lat, ss.lon, 25);
          if (idx >= 0) {
            result.stopSigns[idx] = 1;
            result.stopCoords[idx] = { lat: ss.lat, lon: ss.lon };
          }
        }
      }

      // Speed limits → for each way, snap its geometry midpoint and
      // tag all route points within that way's extent
      if (ov.speedLimits && ov.speedLimits.length > 0) {
        RoutePlanner._snapWaysToRoute(coordinates, ov.speedLimits, (i, way) => {
          result.speedLimits[i] = way.speedKmh;
        });
      }

      // Road types + road names → same approach
      if (ov.roadTypes && ov.roadTypes.length > 0) {
        RoutePlanner._snapWaysToRoute(coordinates, ov.roadTypes, (i, way) => {
          result.roadTypes[i] = way.highway;
          // Overpass way names as fallback (stored separately, OSRM takes priority)
          if (way.name) result._overpassNames = result._overpassNames || new Array(n).fill(null);
          if (way.name) result._overpassNames[i] = way.name;
        });
      }
    }

    // ── 4. Road names — OSRM step names are primary (they follow the actual route) ──
    if (environmentData.maneuvers) {
      // Sort maneuvers by their snapped index
      const indexed = environmentData.maneuvers
        .map(m => ({ ...m, idx: RoutePlanner._nearestPointIndex(coordinates, m.lat, m.lon, 60) }))
        .filter(m => m.idx >= 0 && m.name && m.name.trim() !== "")
        .sort((a, b) => a.idx - b.idx);

      // For each maneuver, fill forward until the next maneuver
      for (let mi = 0; mi < indexed.length; mi++) {
        const from = indexed[mi].idx;
        const to   = mi + 1 < indexed.length ? indexed[mi + 1].idx : n;
        for (let i = from; i < to; i++) {
          result.roadNames[i] = indexed[mi].name;
        }
      }
    }

    // ── 5. Fill gaps with Overpass way names (secondary source) ──
    if (result._overpassNames) {
      for (let i = 0; i < n; i++) {
        if (!result.roadNames[i] && result._overpassNames[i]) {
          result.roadNames[i] = result._overpassNames[i];
        }
      }
      delete result._overpassNames;
    }

    // Forward-fill any remaining nulls in roadNames
    let lastRoadName = null;
    for (let i = 0; i < n; i++) {
      if (result.roadNames[i]) lastRoadName = result.roadNames[i];
      else if (lastRoadName) result.roadNames[i] = lastRoadName;
    }

    return result;
  }

  /**
   * Find the index of the route point nearest to (lat, lon)
   * within maxDist metres. Returns -1 if none found.
   */
  static _nearestPointIndex(coords, lat, lon, maxDist) {
    let bestIdx = -1, bestDist = maxDist;
    for (let i = 0; i < coords.length; i++) {
      const d = GeoUtils.haversineDistance(coords[i], { lat, lon });
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
  }

  /**
   * Perpendicular distance from point P to segment [A, B].
   * Returns { dist (metres), t (projection parameter 0–1) }.
   */
  static _pointToSegmentInfo(pLat, pLon, aLat, aLon, bLat, bLon) {
    const toRad = Math.PI / 180;
    const R = 6371000;
    const cosLat = Math.cos(pLat * toRad);

    // Local metres relative to P (at origin)
    const ax = (aLon - pLon) * toRad * R * cosLat;
    const ay = (aLat - pLat) * toRad * R;
    const bx = (bLon - pLon) * toRad * R * cosLat;
    const by = (bLat - pLat) * toRad * R;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    if (lenSq < 0.01) {
      return { dist: Math.sqrt(ax * ax + ay * ay), t: 0 };
    }

    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return { dist: Math.sqrt(cx * cx + cy * cy), t };
  }

  /**
   * Segment-based snap for traffic features.
   * Finds the route segment closest to (lat, lon) and returns
   * the route point index that places the stop closest to the
   * feature while preferring the approach side (just before).
   */
  static _findBestStopIndex(coords, lat, lon, maxDist = 30) {
    const n = coords.length;
    if (n < 2) return RoutePlanner._nearestPointIndex(coords, lat, lon, maxDist);

    // Scan all segments for the one with minimum perpendicular distance
    let bestSegIdx = -1;
    let bestSegDist = maxDist;
    let bestT = 0;

    for (let i = 0; i < n - 1; i++) {
      const info = RoutePlanner._pointToSegmentInfo(
        lat, lon,
        coords[i].lat, coords[i].lon,
        coords[i + 1].lat, coords[i + 1].lon
      );
      if (info.dist < bestSegDist) {
        bestSegDist = info.dist;
        bestSegIdx = i;
        bestT = info.t;
      }
    }

    if (bestSegIdx < 0) return -1;

    // The signal projects onto segment [bestSegIdx, bestSegIdx+1] at t.
    // Pick the endpoint that is closer to the projection.
    // This minimises the visual gap between the stop and the signal marker.
    if (bestT > 0.5 && bestSegIdx + 1 < n) {
      return bestSegIdx + 1;
    }
    return bestSegIdx;
  }

  /**
   * For each OSM way, find the route points that lie along it
   * and call tagFn(pointIndex, way) for each match.
   */
  static _snapWaysToRoute(coords, ways, tagFn) {
    // For each way, compute its bounding extents, then scan route points
    for (const way of ways) {
      if (!way.geometry || way.geometry.length < 2) continue;

      // Way bounding box
      let wMinLat = Infinity, wMaxLat = -Infinity;
      let wMinLon = Infinity, wMaxLon = -Infinity;
      for (const g of way.geometry) {
        if (g.lat < wMinLat) wMinLat = g.lat;
        if (g.lat > wMaxLat) wMaxLat = g.lat;
        if (g.lon < wMinLon) wMinLon = g.lon;
        if (g.lon > wMaxLon) wMaxLon = g.lon;
      }
      // Expand by ~30 m ≈ 0.0003°
      const exp = 0.0003;
      wMinLat -= exp; wMaxLat += exp;
      wMinLon -= exp; wMaxLon += exp;

      // Tag all route points inside this way's bbox
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i];
        if (c.lat >= wMinLat && c.lat <= wMaxLat &&
            c.lon >= wMinLon && c.lon <= wMaxLon) {
          // Verify proximity to any segment of the way
          let close = false;
          for (let w = 0; w < way.geometry.length - 1; w++) {
            const d = RoutePlanner._pointToSegmentDist(
              c, way.geometry[w], way.geometry[w + 1]
            );
            if (d < 25) { close = true; break; }
          }
          if (close) tagFn(i, way);
        }
      }
    }
  }

  /**
   * Approximate distance (metres) from point P to segment AB.
   * Uses flat-earth approximation (fine for short distances).
   */
  static _pointToSegmentDist(p, a, b) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const cosLat = Math.cos(p.lat * toRad);

    // Convert to local metres
    const px = (p.lon - a.lon) * toRad * R * cosLat;
    const py = (p.lat - a.lat) * toRad * R;
    const bx = (b.lon - a.lon) * toRad * R * cosLat;
    const by = (b.lat - a.lat) * toRad * R;

    const lenSq = bx * bx + by * by;
    if (lenSq < 0.01) return Math.sqrt(px * px + py * py);

    const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
    const dx = px - t * bx;
    const dy = py - t * by;
    return Math.sqrt(dx * dx + dy * dy);
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

  /* ─── Wandering mode ─── */

  /**
   * Generate a wandering route that meanders within a given area for
   * approximately `targetMinutes` of driving time.
   *
   * Strategy: generate successive "wander legs" — random waypoints inside
   * the bounding circle routed via OSRM — until the cumulative OSRM
   * duration meets the target.  Each leg adds 1–3 random waypoints so the
   * path is organic and non-repetitive.
   *
   * @param {Object}  center           - {lat, lon} centre of the wander area
   * @param {number}  targetMinutes    - desired wander duration in minutes
   * @param {Object}  [opts]
   * @param {number}  [opts.radiusKm=2]   - radius of the wander area (km)
   * @param {string}  [opts.profile='driving']
   * @param {number}  [opts.seed=1]
   * @returns {{ coordinates, distanceKm, durationSec, environmentData }}
   */
  async wander(center, targetMinutes, opts = {}) {
    const radiusKm = opts.radiusKm  || 2;
    const profile  = opts.profile   || "driving";
    const seed     = opts.seed      || 1;
    const rng      = this._seededRng(seed);

    const targetSec = targetMinutes * 60;
    const radiusDeg = radiusKm / 111;
    const cosLat    = Math.cos(center.lat * Math.PI / 180);

    // Helper: random point inside the circle
    const randPoint = () => {
      // Uniform distribution inside a circle (sqrt trick)
      const r     = Math.sqrt(rng()) * radiusDeg;
      const theta = rng() * 2 * Math.PI;
      return {
        lat: center.lat + r * Math.sin(theta),
        lon: center.lon + r * Math.cos(theta) / cosLat,
      };
    };

    // Collect all coordinates and track cumulative time
    let allCoords  = [];
    let totalDist  = 0;   // metres
    let totalDur   = 0;   // seconds
    let lastPoint  = { lat: center.lat, lon: center.lon };
    let allEnvData = null; // will merge environment data from the final big route

    const MAX_LEGS = 40;  // safety cap

    for (let leg = 0; leg < MAX_LEGS && totalDur < targetSec; leg++) {
      // 1–3 intermediate waypoints per leg
      const numIntermediate = 1 + Math.floor(rng() * 3);
      const legWaypoints = [lastPoint];
      for (let w = 0; w < numIntermediate; w++) {
        legWaypoints.push(randPoint());
      }

      try {
        const result = await this.route(legWaypoints, profile);
        // Append coordinates (skip first point to avoid duplicates after leg 0)
        const newCoords = leg === 0 ? result.coordinates : result.coordinates.slice(1);
        allCoords = allCoords.concat(newCoords);
        totalDist += result.distanceKm * 1000;
        totalDur  += result.durationSec;
        lastPoint = result.coordinates[result.coordinates.length - 1];
      } catch (e) {
        // If a leg fails (e.g. unreachable point), skip and try a new one
        continue;
      }
    }

    if (allCoords.length < 2) {
      throw new Error("Could not generate a wander route — try a larger area");
    }

    // Run Overpass enrichment on the full combined route
    let environmentData = { osrmSpeeds: [], maneuvers: [], overpass: null, source: "osrm" };
    try {
      const overpass = await this.queryOverpass(allCoords);
      if (overpass) {
        environmentData.overpass = overpass;
        environmentData.source = "osrm+overpass";
      }
    } catch (e) {
      console.warn("Overpass query for wander route failed:", e.message);
    }

    return {
      coordinates: allCoords,
      distanceKm: totalDist / 1000,
      durationSec: totalDur,
      environmentData,
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
