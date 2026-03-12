/* ═══════════════════════════════════════════════════════════════
   PhysicsEngine v5 – real-data + environment-aware vehicle dynamics
   ═══════════════════════════════════════════════════════════════

   v5 integrates real-world map data:
     ⓐ Layered data sources: Overpass API → OSRM annotations → geometry
     ⓑ Real traffic lights & stop signs from OpenStreetMap
     ⓒ Real posted speed limits (maxspeed tags)
     ⓓ Real road classifications (highway=* tags)
     ⓔ OSRM annotation speeds as per-segment reference
     ⓕ Fallback to geometry-based detection when real data unavailable

   Pipeline (20 passes):
     1.  Geometry           – segment distances, turn angles, raw grades
     2.  Grade smoothing    – 7-point windowed average on raw grades
     3.  Air density        – per-point ρ from barometric formula
     4.  Road classification– real OSM tags → OSRM → geometry fallback
     5.  Speed limits       – real maxspeed → OSRM speed → type default
     6.  Curvature limits   – Menger curvature → cornering-G speed cap
     7.  Grade limits       – uphill / downhill speed adjustments
     8.  Cap to limits      – min(vMax, roadSpeedLimit)
     9.  Traffic stops      – real signals/stops → probabilistic fallback
    10.  Power + traction   – power-limited, traction-limited, friction-circle
    11.  Forward sweep      – accel-limited (kinematic v²=v₀²+2ad)
    12.  Backward sweep     – grade-aware, friction-circle braking
    13.  Conditions         – road / weather / driver multipliers
    14.  Post-cond sweeps   – re-verify accel & braking under reduced grip
    15.  Jerk limiting      – smooth extreme accel sign-changes
    16.  Enforce min speed  – floor at idle / crawl (respects stops)
    17.  Timeline           – elapsed seconds + dwell time at stops
    18.  Bearings           – heading at each point
    19.  Annotate env       – tag output with roadType, speedLimit, stopType, dataSource
    20.  Unit conversion    – m/s → km/h

   Output per point:
     { lat, lon, ele, speed (km/h), bearing (°), acceleration (m/s²),
       distance (m cumulative), elapsed (s cumulative), grade (rise/run),
       roadType, speedLimit (km/h), isStop, stopType, dataSource }
   ═══════════════════════════════════════════════════════════════ */

class PhysicsEngine {
  /**
   * @param {Array}  routePoints      – [{lat, lon, ele, …}, …]
   * @param {Object} vehicleProfile   – from Customization
   * @param {string} roadConditions   – dry | wet | icy | gravel
   * @param {string} weatherConditions– clear | rain | snow | fog
   * @param {string} driverBehavior   – aggressive | normal | conservative
   */
  constructor(routePoints, vehicleProfile, roadConditions, weatherConditions, driverBehavior, environmentConfig) {
    // Deep-clone – never mutate caller's data
    this.pts = routePoints.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      ele: p.ele || 0,
      speed: 0,
      bearing: 0,
      acceleration: 0,
      distance: 0,
      elapsed: 0,
      grade: 0,
    }));

    // ── Vehicle parameters (with sensible defaults) ──
    const vp = vehicleProfile || {};
    this.vMax       = (vp.maxSpeed       || 120) / 3.6;     // m/s
    this.aMax       = vp.acceleration    || 2.0;            // m/s² (gentle normal accel)
    this.bMax       = vp.braking         || 4.5;            // m/s² (decel)
    this.lateralG   = vp.maxLateralG     || 0.35;           // g
    this.mass       = vp.mass            || 1500;           // kg
    this.dragCd     = vp.dragCd          || 0.30;
    this.frontalArea = vp.frontalArea    || 2.2;            // m²
    this.rollingCr  = vp.rollingCr       || 0.012;
    this.powerKw    = vp.powerKw         || 100;            // kW
    this.idleSpeed  = (vp.idleSpeed      || 3) / 3.6;      // m/s (slow crawl near stops)

    this.roadConditions    = roadConditions    || "dry";
    this.weatherConditions = weatherConditions || "clear";
    this.driverBehavior    = driverBehavior    || "normal";

    this.G    = 9.81;
    this.rho0 = 1.225;  // sea-level air density kg/m³

    // ── Environment configuration ──
    const env = environmentConfig || {};
    this.envRoadType        = env.roadType        || "auto";
    this.envTrafficDensity  = env.trafficDensity  || "moderate";
    this.envSpeedLimitScale = env.speedLimitScale  || 1.0;

    // ── Real-world data (from RoutePlanner.snapEnvironmentToRoute) ──
    // snappedEnv = { speedLimits[], roadTypes[], trafficSignals[], stopSigns[],
    //               osrmSpeeds[], maneuverPoints[], source }
    this.realData = env.snappedEnv || null;
    this.dataSource = this.realData ? this.realData.source : "geometry";
  }

  /* ═══════════════════════════════════════════
     PUBLIC API
     ═══════════════════════════════════════════ */

  /** Full 20-pass pipeline – returns enriched route points. */
  processRoute() {
    if (this.pts.length < 2) return this.pts;

    this._geometryPass();            //  1
    this._smoothGrades();            //  2
    this._computeAirDensity();       //  3
    this._classifyRoadSegments();    //  4  ★ env
    this._assignSpeedLimits();       //  5  ★ env
    this._curvatureSpeedLimits();    //  6
    this._gradeSpeedLimits();        //  7
    this._capToSpeedLimits();        //  8  ★ env (was _capToVMax)
    this._applyTrafficStops();       //  9  ★ env
    this._powerTractionAccel();      // 10
    this._forwardSweep();            // 11
    this._backwardSweep();           // 12
    this._applyConditions();         // 13
    this._postConditionSweeps();     // 14
    this._jerkLimitPass();           // 15
    this._enforceMinSpeed();         // 16
    this._computeTimeline();         // 17
    this._setBearings();             // 18
    this._annotateEnvironment();     // 19  ★ env
    this._convertUnits();            // 20

    return this.pts;
  }

  /** Dynamic-speed variant used by animation (backward-compat). */
  processRouteWithDynamicSpeed(interpolation = 1) {
    this.processRoute();
    if (interpolation <= 1) return this.pts;

    const out = [];
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i];
      const b = this.pts[i + 1];
      for (let j = 0; j < interpolation; j++) {
        const t = j / interpolation;
        out.push({
          lat: a.lat + (b.lat - a.lat) * t,
          lon: a.lon + (b.lon - a.lon) * t,
          ele: a.ele + (b.ele - a.ele) * t,
          speed: a.speed + (b.speed - a.speed) * t,
          bearing: a.bearing,
          acceleration: a.acceleration,
          distance: a.distance + (b.distance - a.distance) * t,
          elapsed: a.elapsed + (b.elapsed - a.elapsed) * t,
          grade: a.grade,
        });
      }
    }
    out.push(this.pts[this.pts.length - 1]);
    return out;
  }

  /* ═══════════════════════════════════════════
     PASS 1 – Geometry: distances, raw grades, turn angles
     ═══════════════════════════════════════════ */
  _geometryPass() {
    const n = this.pts.length;
    this.segDist   = new Float64Array(n);
    this.turnAngle = new Float64Array(n);
    this._rawGrade = new Float64Array(n);

    let cumDist = 0;
    for (let i = 1; i < n; i++) {
      const d = GeoUtils.haversineDistance(this.pts[i - 1], this.pts[i]);
      this.segDist[i] = d;
      cumDist += d;
      this.pts[i].distance = cumDist;

      // Raw segment grade (kept for smoothing; output uses smoothed version)
      if (d > 0.5) {
        this._rawGrade[i] = (this.pts[i].ele - this.pts[i - 1].ele) / d;
      }
    }

    // Interior turn angles
    for (let i = 1; i < n - 1; i++) {
      const b1 = GeoUtils.calculateBearing(this.pts[i - 1], this.pts[i]);
      const b2 = GeoUtils.calculateBearing(this.pts[i], this.pts[i + 1]);
      let delta = Math.abs(b2 - b1);
      if (delta > 180) delta = 360 - delta;
      this.turnAngle[i] = delta;
    }
  }

  /* ═══════════════════════════════════════════
     PASS 2 – Grade smoothing  ★ NEW
     ═══════════════════════════════════════════
     GPS elevation is noisy; a 7-point windowed moving average
     removes spikes while preserving the overall hill profile.
  */
  _smoothGrades() {
    const n = this.pts.length;
    const halfWin = 3; // window radius → 7-point kernel
    for (let i = 0; i < n; i++) {
      let sum = 0, count = 0;
      const lo = Math.max(0, i - halfWin);
      const hi = Math.min(n - 1, i + halfWin);
      for (let j = lo; j <= hi; j++) {
        sum += this._rawGrade[j];
        count++;
      }
      this.pts[i].grade = sum / count;
    }
  }

  /* ═══════════════════════════════════════════
     PASS 3 – Altitude-adjusted air density  ★ NEW
     ═══════════════════════════════════════════
     Barometric formula: ρ(h) ≈ ρ₀ · exp(−h / 8500)
     At 1000 m → ρ ≈ 1.08  (−11 %)
     At 2500 m → ρ ≈ 0.91  (−26 %)
  */
  _computeAirDensity() {
    const n = this.pts.length;
    this._rhoAt = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const h = Math.max(this.pts[i].ele, 0);
      this._rhoAt[i] = this.rho0 * Math.exp(-h / 8500);
    }
  }

  /* ═══════════════════════════════════════════
     PASS 4 – Road segment classification  ★ REAL DATA
     ═══════════════════════════════════════════
     Priority: 1) User override  2) Real OSM highway tags
               3) Geometry-based auto-detect (fallback)

     OSM highway=* → internal classification:
       motorway, trunk, primary        → highway
       secondary, tertiary             → rural
       residential, living_street      → residential
       service, unclassified, *        → urban
  */
  _classifyRoadSegments() {
    const n = this.pts.length;
    this._roadClass = new Array(n);
    this._roadSource = new Array(n); // track data source per point

    // User override: all points get the same road type
    if (this.envRoadType !== "auto") {
      this._roadClass.fill(this.envRoadType);
      this._roadSource.fill("override");
      return;
    }

    // ── 1. Try real OSM highway tags from Overpass ──
    const OSM_MAP = {
      motorway: "highway", motorway_link: "highway",
      trunk: "highway", trunk_link: "highway",
      primary: "highway", primary_link: "highway",
      secondary: "rural", secondary_link: "rural",
      tertiary: "rural", tertiary_link: "rural",
      residential: "residential", living_street: "residential",
      service: "urban", unclassified: "urban",
    };

    let realCount = 0;
    if (this.realData && this.realData.roadTypes) {
      for (let i = 0; i < n; i++) {
        const osmTag = this.realData.roadTypes[i];
        if (osmTag && OSM_MAP[osmTag]) {
          this._roadClass[i] = OSM_MAP[osmTag];
          this._roadSource[i] = "overpass";
          realCount++;
        }
      }
    }

    // If > 70% of points have real data, fill gaps by interpolation
    if (realCount > n * 0.7) {
      let lastKnown = null;
      for (let i = 0; i < n; i++) {
        if (this._roadClass[i]) { lastKnown = this._roadClass[i]; }
        else if (lastKnown) {
          this._roadClass[i] = lastKnown;
          this._roadSource[i] = "interpolated";
        }
      }
      // Back-fill any remaining nulls at the start
      if (!this._roadClass[0]) {
        const first = this._roadClass.find(Boolean) || "urban";
        for (let i = 0; i < n; i++) {
          if (!this._roadClass[i]) {
            this._roadClass[i] = first;
            this._roadSource[i] = "interpolated";
          } else break;
        }
      }
      return;
    }

    // ── 2. Geometry-based fallback for uncovered points ──
    const windowHalf = 15;
    const rawScore = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      if (this._roadClass[i]) continue; // already classified
      let sumDist = 0, sumStraight = 0, count = 0;
      const lo = Math.max(1, i - windowHalf);
      const hi = Math.min(n - 1, i + windowHalf);
      for (let j = lo; j <= hi; j++) {
        sumDist += this.segDist[j];
        sumStraight += (1 - Math.min(this.turnAngle[j] / 90, 1));
        count++;
      }
      const avgDist = count > 0 ? sumDist / count : 0;
      const straightness = count > 0 ? sumStraight / count : 0.5;
      rawScore[i] = Math.min(avgDist / 120, 1) * 0.5 + straightness * 0.5;
    }

    // Smooth
    const smooth = new Float64Array(n);
    const smoothHalf = 10;
    for (let i = 0; i < n; i++) {
      if (this._roadClass[i]) { smooth[i] = 0; continue; }
      let sum = 0, cnt = 0;
      const lo = Math.max(0, i - smoothHalf);
      const hi = Math.min(n - 1, i + smoothHalf);
      for (let j = lo; j <= hi; j++) {
        if (!this._roadClass[j]) { sum += rawScore[j]; cnt++; }
      }
      smooth[i] = cnt > 0 ? sum / cnt : 0.5;
    }

    for (let i = 0; i < n; i++) {
      if (this._roadClass[i]) continue;
      const s = smooth[i];
      if      (s > 0.82) this._roadClass[i] = "highway";
      else if (s > 0.62) this._roadClass[i] = "rural";
      else if (s > 0.38) this._roadClass[i] = "urban";
      else               this._roadClass[i] = "residential";
      this._roadSource[i] = "geometry";
    }
  }

  /* ═══════════════════════════════════════════
     PASS 5 – Speed limits  ★ REAL DATA
     ═══════════════════════════════════════════
     Priority: 1) Real OSM maxspeed tags (Overpass)
               2) OSRM annotation speed (road reference speed)
               3) Road-type default table (fallback)
     All capped by the vehicle's own top speed.
  */
  _assignSpeedLimits() {
    const n = this.pts.length;
    this._speedLimit = new Float64Array(n);
    this._limitSource = new Array(n);

    // Realistic average travel speeds (not posted maximums)
    const LIMITS = {
      highway:      95 / 3.6,   // m/s – avg highway cruise
      rural:        65 / 3.6,   //       avg rural road
      urban:        40 / 3.6,   //       avg city driving
      residential:  25 / 3.6,   //       avg neighbourhood
    };

    for (let i = 0; i < n; i++) {
      let base = 0;
      let source = "type-default";

      // Priority 1: Real OSM maxspeed from Overpass
      if (this.realData && this.realData.speedLimits && this.realData.speedLimits[i]) {
        base = this.realData.speedLimits[i] / 3.6;
        source = "overpass";
      }
      // Priority 2: OSRM annotation speed (already a realistic reference speed)
      else if (this.realData && this.realData.osrmSpeeds && this.realData.osrmSpeeds[i] > 0) {
        base = this.realData.osrmSpeeds[i];
        source = "osrm";
      }
      // Priority 3: Road-type default
      else {
        base = LIMITS[this._roadClass[i]] || LIMITS.urban;
      }

      this._speedLimit[i] = Math.min(base * this.envSpeedLimitScale, this.vMax);
      this._limitSource[i] = source;
    }
  }

  /* ═══════════════════════════════════════════
     PASS 6 – Cornering speed limits (Menger curvature + lateral-G)
     ═══════════════════════════════════════════
     κ = 2·sin(θ/2) / chord   →   v_corner = √(a_lat · r)
     Stores curvature per point for friction-circle use later.
  */
  _curvatureSpeedLimits() {
    const n = this.pts.length;
    const aLat = this.lateralG * this.G;
    this._kappa = new Float64Array(n); // curvature for friction-circle

    this.pts[0].speed = this.vMax;
    this.pts[n - 1].speed = this.vMax;

    for (let i = 1; i < n - 1; i++) {
      const angle = this.turnAngle[i];
      if (angle < 1) {
        this.pts[i].speed = this.vMax;
        continue;
      }

      const chord = (this.segDist[i] + this.segDist[i + 1]) / 2;
      if (chord < 0.5) {
        this.pts[i].speed = this.idleSpeed;
        this._kappa[i] = 1.0; // high-curvature marker
        continue;
      }

      const angleRad = angle * Math.PI / 180;
      const kappa = 2 * Math.sin(angleRad / 2) / chord;
      this._kappa[i] = kappa;

      if (kappa > 1e-9) {
        const radius = 1 / kappa;
        const vCorner = Math.sqrt(aLat * radius);
        this.pts[i].speed = Math.min(vCorner, this.vMax);
      } else {
        this.pts[i].speed = this.vMax;
      }
    }

    // Look-ahead smoothing (anticipatory braking seed)
    const lookAhead = Math.min(12, Math.floor(n / 4));
    for (let i = 0; i < n; i++) {
      let minAhead = this.pts[i].speed;
      for (let j = 1; j <= lookAhead && i + j < n; j++) {
        minAhead = Math.min(minAhead, this.pts[i + j].speed);
      }
      this.pts[i].speed = this.pts[i].speed * 0.6 + minAhead * 0.4;
    }
  }

  /* ═══════════════════════════════════════════
     PASS 5 – Grade-limited speed
     ═══════════════════════════════════════════ */
  _gradeSpeedLimits() {
    for (let i = 0; i < this.pts.length; i++) {
      const grade = this.pts[i].grade;
      if (Math.abs(grade) < 0.01) continue;

      if (grade > 0) {
        // Uphill – at 10 % grade speed drops to ~55 % of limit
        const factor = 1 / (1 + 5 * grade);
        this.pts[i].speed = Math.min(this.pts[i].speed, this.vMax * factor);
      } else {
        // Downhill – slight increase capped at 115 %
        const factor = Math.min(1 + Math.abs(grade) * 1.5, 1.15);
        this.pts[i].speed = Math.min(this.pts[i].speed * factor, this.vMax);
      }
    }
  }

  /** Cap speed to min(vMax, road speed limit). */
  _capToSpeedLimits() {
    for (let i = 0; i < this.pts.length; i++) {
      const limit = this._speedLimit ? this._speedLimit[i] : this.vMax;
      this.pts[i].speed = Math.min(this.pts[i].speed, this.vMax, limit);
    }
  }

  /* ═══════════════════════════════════════════
     PASS 9 – Traffic lights & stop signs  ★ REAL DATA
     + Braking / acceleration ramps around each stop
     ═══════════════════════════════════════════
     Priority: 1) Real traffic signals & stop signs from Overpass
               2) OSRM maneuver points (likely intersections)
               3) Geometry-based probabilistic fallback

     Traffic density setting controls stop probability at
     real signals (green vs red) and dwell durations.
  */
  _applyTrafficStops() {
    const n = this.pts.length;
    this._isStop = new Uint8Array(n);       // 0=none, 1=traffic light, 2=stop sign
    this._stopDuration = new Float64Array(n); // seconds of dwell

    if (this.envTrafficDensity === "none") return;

    // Dwell (wait) duration range in seconds
    const DWELL = {
      light:    { min: 3,  max: 15 },
      moderate: { min: 8,  max: 30 },
      heavy:    { min: 15, max: 45 },
    };

    // Probability of catching a red light (signals only) by traffic density
    const RED_PROB = { light: 0.30, moderate: 0.55, heavy: 0.80 };

    const minSpacing = 80; // min metres between stops
    let lastStopDist = -minSpacing * 2;

    // ── 1. Real traffic signals from Overpass ──
    if (this.realData && this.realData.trafficSignals) {
      for (let i = 3; i < n - 3; i++) {
        if (!this.realData.trafficSignals[i]) continue;
        if (this.pts[i].distance - lastStopDist < minSpacing) continue;

        // Probabilistic: not every traffic light is red
        const prob = RED_PROB[this.envTrafficDensity] || 0.55;
        if (this._simpleHash(i) >= prob) continue;

        this._isStop[i] = 1; // traffic light
        const dwell = DWELL[this.envTrafficDensity] || DWELL.moderate;
        this._stopDuration[i] = dwell.min + this._simpleHash(i + 7919) * (dwell.max - dwell.min);
        this.pts[i].speed = 0;
        lastStopDist = this.pts[i].distance;
      }
    }

    // ── 2. Real stop signs from Overpass ──
    if (this.realData && this.realData.stopSigns) {
      for (let i = 3; i < n - 3; i++) {
        if (!this.realData.stopSigns[i]) continue;
        if (this._isStop[i]) continue; // already a traffic light
        if (this.pts[i].distance - lastStopDist < minSpacing) continue;

        this._isStop[i] = 2; // stop sign
        this._stopDuration[i] = Math.min(
          3 + this._simpleHash(i + 3571) * 5, 8
        );
        this.pts[i].speed = 0;
        lastStopDist = this.pts[i].distance;
      }
    }

    // ── 3. Probabilistic fallback for points without real data ──
    // Only if real data is sparse or unavailable
    const realStopCount = Array.from(this._isStop).filter(Boolean).length;
    const hasRealData = this.realData && (
      (this.realData.trafficSignals && Array.from(this.realData.trafficSignals).some(Boolean)) ||
      (this.realData.stopSigns && Array.from(this.realData.stopSigns).some(Boolean))
    );

    // Skip probabilistic fallback if we have real stop data
    if (hasRealData && realStopCount > 0) return;

    // Fallback: geometry-based intersection detection
    const STOP_PROB = {
      light:    { highway: 0, rural: 0.05, urban: 0.25, residential: 0.15 },
      moderate: { highway: 0, rural: 0.12, urban: 0.50, residential: 0.35 },
      heavy:    { highway: 0, rural: 0.20, urban: 0.75, residential: 0.55 },
    };

    for (let i = 3; i < n - 3; i++) {
      if (this._isStop[i]) continue;
      const road = this._roadClass[i];
      if (road === "highway") continue;

      const threshold = road === "residential" ? 22 : 30;
      if (this.turnAngle[i] < threshold) continue;
      if (this.pts[i].distance - lastStopDist < minSpacing) continue;

      const rng = this._simpleHash(i);
      const prob = (STOP_PROB[this.envTrafficDensity] || {})[road] || 0;
      if (rng >= prob) continue;

      this._isStop[i] = (road === "urban" || road === "rural") ? 1 : 2;

      const dwell = DWELL[this.envTrafficDensity] || DWELL.moderate;
      const baseDwell = dwell.min + this._simpleHash(i + 7919) * (dwell.max - dwell.min);
      this._stopDuration[i] = this._isStop[i] === 2
        ? Math.min(baseDwell, 8)
        : baseDwell;

      this.pts[i].speed = 0;
      lastStopDist = this.pts[i].distance;
    }
  }

  /** Deterministic hash for point index → [0, 1). */
  _simpleHash(idx) {
    const p = this.pts[Math.min(idx, this.pts.length - 1)];
    let h = 2166136261 >>> 0;
    h = ((h ^ idx) * 16777619) >>> 0;
    h = ((h ^ (Math.floor(p.lat * 1e5) & 0xFFFF)) * 16777619) >>> 0;
    h = ((h ^ (Math.floor(p.lon * 1e5) & 0xFFFF)) * 16777619) >>> 0;
    return (h >>> 0) / 4294967296;
  }

  /* ═══════════════════════════════════════════
     PASS 10 – Power + traction + friction-circle  ★ ENHANCED
     ═══════════════════════════════════════════
     Three limiters per point:
       a) Power-limited:     a = (P/v − Fdrag − Froll − Fgrade) / m
       b) Traction-limited:  a = μ_long · g  (tire grip ceiling)
       c) Friction-circle:   cornering eats lateral grip → less
                             longitudinal grip for accel
     Uses altitude-adjusted ρ and speed-dependent Cr.
  */
  _powerTractionAccel() {
    const n = this.pts.length;
    this._aAvail = new Float64Array(n);
    const P = this.powerKw * 1000; // watts

    // Longitudinal grip ≈ 2.2 × lateral G  (tire physics: longitudinal μ
    // is higher than lateral due to slip-angle dynamics)
    const muLong  = this.lateralG * 2.2;
    const aLatMax = this.lateralG * this.G;

    for (let i = 0; i < n; i++) {
      const v     = Math.max(this.pts[i].speed, this.idleSpeed);
      const grade = this.pts[i].grade;
      const rho   = this._rhoAt[i];

      // ── Aerodynamic drag (altitude-adjusted ρ) ──
      const Fdrag = 0.5 * rho * this.dragCd * this.frontalArea * v * v;

      // ── Rolling resistance (speed-dependent + slope-corrected) ──
      // Cr_eff = Cr₀ · (1 + 0.01·v)  — SAE-style speed correction
      // Normal force on slope: N = m·g·cos(θ) ≈ m·g / √(1+grade²)
      const CrEff    = this.rollingCr * (1 + 0.01 * v);
      const cosSlope = 1 / Math.sqrt(1 + grade * grade);
      const Froll    = CrEff * this.mass * this.G * cosSlope;

      // ── Grade resistance (gravity component along slope) ──
      const sinSlope = grade / Math.sqrt(1 + grade * grade);
      const Fgrade   = this.mass * this.G * Math.max(sinSlope, 0);

      // (a) Power-limited acceleration
      const aPower = ((P / v) - Fdrag - Froll - Fgrade) / this.mass;

      // (b) Traction-limited acceleration
      let aTraction = muLong * this.G;

      // (c) Friction circle: cornering uses lateral grip, reducing
      //     the longitudinal budget  →  a_long ∝ √(1 − f_lat²)
      const kappa = this._kappa[i] || 0;
      if (kappa > 1e-9) {
        const aLatUsed  = v * v * kappa;
        const lateralFrac = Math.min(aLatUsed / aLatMax, 0.95);
        aTraction *= Math.sqrt(1 - lateralFrac * lateralFrac);
      }

      const aNet = Math.min(aPower, aTraction);
      this._aAvail[i] = Math.min(Math.max(aNet, 0.05), this.aMax);
    }
  }

  /* ═══════════════════════════════════════════
     PASS 8 – Forward sweep: accel-limited
     ═══════════════════════════════════════════ */
  _forwardSweep() {
    this.pts[0].speed = Math.min(this.pts[0].speed, this.idleSpeed);

    for (let i = 1; i < this.pts.length; i++) {
      const d = this.segDist[i];
      const vPrev = this.pts[i - 1].speed;
      const a = this._aAvail[i - 1];
      const vReachable = Math.sqrt(vPrev * vPrev + 2 * a * d);
      this.pts[i].speed = Math.min(this.pts[i].speed, vReachable);
    }
  }

  /* ═══════════════════════════════════════════
     PASS 9 – Backward sweep: grade-aware + friction-circle  ★ ENHANCED
     ═══════════════════════════════════════════
     Downhill segments reduce effective braking (gravity fights decel).
     Uphill segments assist braking.
     Cornering reduces available longitudinal braking (friction circle).
  */
  _backwardSweep() {
    const n = this.pts.length;
    const aLatMax = this.lateralG * this.G;

    this.pts[n - 1].speed = Math.min(this.pts[n - 1].speed, this.idleSpeed);

    for (let i = n - 2; i >= 0; i--) {
      const d = this.segDist[i + 1];
      const vNext = this.pts[i + 1].speed;

      // ── Grade-aware braking ──
      // gradeAhead > 0 (uphill)   → gravity assists braking   → bEff > bMax
      // gradeAhead < 0 (downhill) → gravity fights braking    → bEff < bMax
      const gradeAhead = this.pts[i + 1].grade;
      const sinSlope   = gradeAhead / Math.sqrt(1 + gradeAhead * gradeAhead);
      let bEff = this.bMax + this.G * sinSlope;

      // ── Friction circle for braking in corners ──
      const kappa = this._kappa[i] || 0;
      if (kappa > 1e-9) {
        const v = this.pts[i].speed || this.idleSpeed;
        const aLatUsed  = v * v * kappa;
        const lateralFrac = Math.min(aLatUsed / aLatMax, 0.95);
        bEff *= Math.sqrt(1 - lateralFrac * lateralFrac);
      }

      // Never let effective braking drop below 25 % of base
      bEff = Math.max(bEff, this.bMax * 0.25);

      const vReachable = Math.sqrt(vNext * vNext + 2 * bEff * d);
      this.pts[i].speed = Math.min(this.pts[i].speed, vReachable);
    }
  }

  /* ═══════════════════════════════════════════
     PASS 10 – Road / weather / driver conditions  ★ ENHANCED
     ═══════════════════════════════════════════
     Now stores grip factor for the post-condition re-sweep.
  */
  _applyConditions() {
    let grip = 1.0;
    let vis  = 1.0;

    switch (this.roadConditions) {
      case "wet":    grip = 0.82; break;
      case "icy":    grip = 0.45; break;
      case "gravel": grip = 0.65; break;
    }
    switch (this.weatherConditions) {
      case "rain": vis = 0.88; grip *= 0.92; break;
      case "snow": vis = 0.72; grip *= 0.65; break;
      case "fog":  vis = 0.68;               break;
    }

    let driver = 1.0;
    switch (this.driverBehavior) {
      case "aggressive":   driver = 1.05; break;
      case "normal":       driver = 0.92; break;
      case "conservative": driver = 0.80; break;
    }

    // Persist for post-condition sweeps
    this._grip   = grip;
    this._driver = driver;

    const combined   = vis * driver;
    const gripFactor = Math.sqrt(grip);

    for (let i = 0; i < this.pts.length; i++) {
      this.pts[i].speed *= gripFactor * combined;
    }
  }

  /* ═══════════════════════════════════════════
     PASS 11 – Post-condition kinematic re-sweep  ★ NEW
     ═══════════════════════════════════════════
     After conditions scaled all speeds, acceleration and braking
     capabilities are also reduced by grip.  Re-verify that the
     speed profile is still kinematically achievable.
  */
  _postConditionSweeps() {
    const n    = this.pts.length;
    const grip = this._grip || 1.0;
    const driver = this._driver || 1.0;
    // Skip only when nothing changed (dry + clear + aggressive/default driver)
    if (grip >= 0.99 && driver >= 1.0) return;

    const P        = this.powerKw * 1000;
    const muLong   = this.lateralG * 2.2 * grip;
    const aMaxGrip = this.aMax * grip;
    const bMaxGrip = this.bMax * grip;
    const aLatMax  = this.lateralG * this.G * grip;

    // ── Forward re-sweep (grip-reduced acceleration) ──
    for (let i = 1; i < n; i++) {
      // ★ Preserve traffic stops
      if (this._isStop && this._isStop[i]) continue;
      const d     = this.segDist[i];
      const vPrev = this.pts[i - 1].speed;
      const v     = Math.max(vPrev, this.idleSpeed);
      const rho   = this._rhoAt[i - 1];
      const grade = this.pts[i - 1].grade;

      const Fdrag  = 0.5 * rho * this.dragCd * this.frontalArea * v * v;
      const CrEff  = this.rollingCr * (1 + 0.01 * v);
      const cosS   = 1 / Math.sqrt(1 + grade * grade);
      const Froll  = CrEff * this.mass * this.G * cosS;
      const sinS   = grade / Math.sqrt(1 + grade * grade);
      const Fgrade = this.mass * this.G * Math.max(sinS, 0);

      let a = Math.min(((P / v) - Fdrag - Froll - Fgrade) / this.mass,
                         muLong * this.G);

      // Friction circle
      const kappa = this._kappa[i - 1] || 0;
      if (kappa > 1e-9) {
        const aLatUsed = v * v * kappa;
        const latFrac  = Math.min(aLatUsed / aLatMax, 0.95);
        a *= Math.sqrt(1 - latFrac * latFrac);
      }

      a = Math.min(Math.max(a, 0.05), aMaxGrip);
      const vReachable = Math.sqrt(vPrev * vPrev + 2 * a * d);
      this.pts[i].speed = Math.min(this.pts[i].speed, vReachable);
    }

    // ── Backward re-sweep (grip-reduced braking) ──
    for (let i = n - 2; i >= 0; i--) {
      // ★ Preserve traffic stops
      if (this._isStop && this._isStop[i]) continue;
      const d     = this.segDist[i + 1];
      const vNext = this.pts[i + 1].speed;
      const gradeAhead = this.pts[i + 1].grade;
      const sinS  = gradeAhead / Math.sqrt(1 + gradeAhead * gradeAhead);
      let b = bMaxGrip + this.G * sinS;

      const kappa = this._kappa[i] || 0;
      if (kappa > 1e-9) {
        const v = this.pts[i].speed || this.idleSpeed;
        const aLatUsed = v * v * kappa;
        const latFrac  = Math.min(aLatUsed / aLatMax, 0.95);
        b *= Math.sqrt(1 - latFrac * latFrac);
      }

      b = Math.max(b, bMaxGrip * 0.25);
      const vReachable = Math.sqrt(vNext * vNext + 2 * b * d);
      this.pts[i].speed = Math.min(this.pts[i].speed, vReachable);
    }
  }

  /* ═══════════════════════════════════════════
     PASS 12 – Jerk limiting  ★ NEW
     ═══════════════════════════════════════════
     Jerk = da/dt (m/s³).  Real vehicles can't instantly flip
     between full throttle and full braking.  Detects points with
     extreme acceleration changes and smooths the speed there.
  */
  _jerkLimitPass() {
    const n = this.pts.length;
    if (n < 4) return;

    // Generous threshold – only catch the worst transitions
    const jerkThreshold = this.aMax * 2.0;

    // Save kinematic upper bounds
    const vCap = new Float64Array(n);
    for (let i = 0; i < n; i++) vCap[i] = this.pts[i].speed;

    // Two smoothing iterations
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 2; i < n; i++) {
        // ★ Never touch traffic-stop points — they must stay at 0
        if (this._isStop && this._isStop[i]) continue;

        const d1 = this.segDist[i - 1] || 1;
        const d2 = this.segDist[i]     || 1;

        const v0 = this.pts[i - 2].speed;
        const v1 = this.pts[i - 1].speed;
        const v2 = this.pts[i].speed;

        const dt1 = d1 / Math.max((v0 + v1) / 2, 0.5);
        const dt2 = d2 / Math.max((v1 + v2) / 2, 0.5);

        const a1 = (v1 - v0) / dt1;
        const a2 = (v2 - v1) / dt2;

        const dtMid = (dt1 + dt2) / 2;
        const jerk  = (a2 - a1) / dtMid;

        if (Math.abs(jerk) > jerkThreshold) {
          const clampedDeltaA = Math.sign(jerk) * jerkThreshold * dtMid;
          const newA2  = a1 + clampedDeltaA;
          const newV2  = v1 + newA2 * dt2;
          this.pts[i].speed = Math.max(this.idleSpeed,
                                       Math.min(newV2, vCap[i]));
        }
      }
    }
  }

  /* ═══════════════════════════════════════════
     PASS 16 – Enforce minimum speed (respects stops)
     ═══════════════════════════════════════════ */
  _enforceMinSpeed() {
    for (let i = 0; i < this.pts.length; i++) {
      // Let traffic stops stay at 0 — they represent actual vehicle stops
      if (this._isStop && this._isStop[i]) continue;
      this.pts[i].speed = Math.max(this.pts[i].speed, this.idleSpeed);
    }
  }

  /* ═══════════════════════════════════════════
     PASS 17 – Compute elapsed time, dwell & acceleration
     ═══════════════════════════════════════════ */
  _computeTimeline() {
    let cumTime = 0;
    this.pts[0].elapsed = 0;
    this.pts[0].acceleration = 0;

    for (let i = 1; i < this.pts.length; i++) {
      const d  = this.segDist[i];
      const v0 = this.pts[i - 1].speed;
      const v1 = this.pts[i].speed;
      const vAvg = (v0 + v1) / 2;
      const dt = vAvg > 0.01 ? d / vAvg : 0;

      cumTime += dt;

      // Dwell time at traffic stops (red light / stop sign wait)
      if (this._stopDuration && this._stopDuration[i] > 0) {
        cumTime += this._stopDuration[i];
      }

      this.pts[i].elapsed = cumTime;
      this.pts[i].acceleration = dt > 0.001 ? (v1 - v0) / dt : 0;
    }
  }

  /* ═══════════════════════════════════════════
     PASS 15 – Bearings
     ═══════════════════════════════════════════ */
  _setBearings() {
    for (let i = 0; i < this.pts.length - 1; i++) {
      this.pts[i].bearing = GeoUtils.calculateBearing(this.pts[i], this.pts[i + 1]);
    }
    if (this.pts.length > 1) {
      this.pts[this.pts.length - 1].bearing = this.pts[this.pts.length - 2].bearing;
    }
  }

  /* ═══════════════════════════════════════════
     PASS 19 – Annotate output with environment info  ★ REAL DATA
     ═══════════════════════════════════════════
     Tag each output point with roadType, speedLimit,
     stop information, and data source so the HUD and
     animation can display them.
  */
  _annotateEnvironment() {
    for (let i = 0; i < this.pts.length; i++) {
      this.pts[i].roadType   = this._roadClass  ? this._roadClass[i]           : "urban";
      this.pts[i].speedLimit = this._speedLimit  ? this._speedLimit[i] * 3.6   : this.vMax * 3.6;
      this.pts[i].isStop     = this._isStop      ? this._isStop[i] > 0         : false;
      this.pts[i].stopType   = this._isStop && this._isStop[i] === 1 ? "trafficLight" :
                               this._isStop && this._isStop[i] === 2 ? "stopSign"     : null;
      this.pts[i].stopDwell  = this._stopDuration ? this._stopDuration[i]      : 0;
      this.pts[i].dataSource = this.dataSource || "geometry";
      this.pts[i].roadSource = this._roadSource  ? this._roadSource[i]         : "geometry";
      this.pts[i].limitSource= this._limitSource ? this._limitSource[i]        : "type-default";
      this.pts[i].roadName   = (this.realData && this.realData.roadNames) ? this.realData.roadNames[i] || "" : "";
    }
  }

  /* ═══════════════════════════════════════════
     PASS 20 – Convert m/s → km/h
     ═══════════════════════════════════════════ */
  _convertUnits() {
    for (let i = 0; i < this.pts.length; i++) {
      this.pts[i].speed *= 3.6;
    }
  }
}