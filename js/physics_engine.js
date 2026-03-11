/* ═══════════════════════════════════════════════════════════════
   PhysicsEngine v2 – high-fidelity vehicle dynamics simulation
   ═══════════════════════════════════════════════════════════════

   Pipeline:
     1. Geometry pass   – segment distances, bearings, turn angles, gradients
     2. Curvature pass  – per-point curvature via Menger curvature of triplets
     3. Speed limit     – cornering-G limit, grade limit, vehicle max
     4. Forward sweep   – enforce max acceleration (can't exceed what the
                          engine + traction can deliver)
     5. Backward sweep  – enforce max braking (decelerate in time for the
                          next speed limit)
     6. Conditions      – road / weather / driver multipliers
     7. Jitter & micro  – optional realistic GPS-like micro-variation
     8. Output          – enriched route points with speed, bearing, accel, etc.

   Each output point: { lat, lon, ele, speed, bearing, acceleration,
                        distance, elapsed, grade }
   speed     → km/h
   bearing   → degrees 0-360
   accel     → m/s²
   distance  → cumulative metres from start
   elapsed   → cumulative seconds from start
   grade     → dimensionless slope (rise/run)
   ═══════════════════════════════════════════════════════════════ */

class PhysicsEngine {
  /**
   * @param {Array}  routePoints    – [{lat, lon, ele, …}, …]
   * @param {Object} vehicleProfile – from Customization (see below for fields)
   * @param {string} roadConditions
   * @param {string} weatherConditions
   * @param {string} driverBehavior
   */
  constructor(routePoints, vehicleProfile, roadConditions, weatherConditions, driverBehavior) {
    // Deep-clone so we never mutate the caller's array
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
    this.vMax       = (vp.maxSpeed       || 120) / 3.6;        // m/s
    this.aMax       = vp.acceleration    || 2.5;               // m/s²
    this.bMax       = vp.braking         || 4.5;               // m/s²  (decel)
    this.lateralG   = vp.maxLateralG     || 0.35;              // g
    this.mass       = vp.mass            || 1500;              // kg
    this.dragCd     = vp.dragCd          || 0.30;              // drag coefficient
    this.frontalArea = vp.frontalArea    || 2.2;               // m²
    this.rollingCr  = vp.rollingCr       || 0.012;             // rolling resistance
    this.powerKw    = vp.powerKw         || 100;               // engine power kW
    this.idleSpeed  = (vp.idleSpeed      || 5) / 3.6;         // m/s – minimum crawl

    this.roadConditions    = roadConditions    || "dry";
    this.weatherConditions = weatherConditions || "clear";
    this.driverBehavior    = driverBehavior    || "normal";

    // Gravity
    this.G = 9.81;
    // Air density kg/m³
    this.rho = 1.225;
  }

  /* ═══════════════════════════════════════════
     PUBLIC API
     ═══════════════════════════════════════════ */

  /** Full pipeline – returns enriched route points. */
  processRoute() {
    if (this.pts.length < 2) return this.pts;

    this._geometryPass();
    this._curvatureSpeedLimits();
    this._gradeSpeedLimits();
    this._capToVMax();
    this._powerLimitedAccel();
    this._forwardSweep();
    this._backwardSweep();
    this._applyConditions();
    this._enforceMinSpeed();
    this._computeTimeline();
    this._setBearings();
    this._convertUnits();

    return this.pts;
  }

  /** Dynamic-speed variant used by animation (kept for backward compat). */
  processRouteWithDynamicSpeed(interpolation = 1) {
    this.processRoute();

    if (interpolation <= 1) return this.pts;

    // Sub-sample between each pair
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
     PASS 1 – Geometry: distances, grades, turn angles
     ═══════════════════════════════════════════ */
  _geometryPass() {
    const n = this.pts.length;
    // Segment distances & cumulative distance
    this.segDist = new Float64Array(n);     // distance TO this point from previous
    this.turnAngle = new Float64Array(n);   // degrees of turn at this point

    let cumDist = 0;
    for (let i = 1; i < n; i++) {
      const d = GeoUtils.haversineDistance(this.pts[i - 1], this.pts[i]);
      this.segDist[i] = d;
      cumDist += d;
      this.pts[i].distance = cumDist;

      // Grade (slope)
      if (d > 0.5) { // avoid divide-by-near-zero for very close points
        this.pts[i].grade = (this.pts[i].ele - this.pts[i - 1].ele) / d;
      }
    }

    // Turn angles at each interior point
    for (let i = 1; i < n - 1; i++) {
      const b1 = GeoUtils.calculateBearing(this.pts[i - 1], this.pts[i]);
      const b2 = GeoUtils.calculateBearing(this.pts[i], this.pts[i + 1]);
      let delta = Math.abs(b2 - b1);
      if (delta > 180) delta = 360 - delta;
      this.turnAngle[i] = delta;
    }
  }

  /* ═══════════════════════════════════════════
     PASS 2 – Cornering speed limits via lateral-G
     ═══════════════════════════════════════════
     Uses Menger curvature: κ = 2·sin(θ) / chord
     v_max = sqrt(a_lat / κ)  where a_lat = lateralG × 9.81
  */
  _curvatureSpeedLimits() {
    const n = this.pts.length;
    const aLat = this.lateralG * this.G;

    // First and last points → vehicle max
    this.pts[0].speed = this.vMax;
    this.pts[n - 1].speed = this.vMax;

    for (let i = 1; i < n - 1; i++) {
      const angle = this.turnAngle[i]; // degrees
      if (angle < 1) {
        // Essentially straight
        this.pts[i].speed = this.vMax;
        continue;
      }

      // Chord length: average of the two adjacent segments
      const chord = (this.segDist[i] + this.segDist[i + 1]) / 2;
      if (chord < 0.5) {
        this.pts[i].speed = this.idleSpeed;
        continue;
      }

      // Menger curvature
      const angleRad = angle * Math.PI / 180;
      const kappa = 2 * Math.sin(angleRad / 2) / chord;

      if (kappa > 1e-9) {
        const radius = 1 / kappa;
        // v = sqrt(a_lat * r)
        const vCorner = Math.sqrt(aLat * radius);
        this.pts[i].speed = Math.min(vCorner, this.vMax);
      } else {
        this.pts[i].speed = this.vMax;
      }
    }

    // Look-ahead smoothing: if a sharp corner is N points ahead,
    // start pulling speed down earlier (anticipatory braking cue).
    // This is refined further by the backward sweep, but seeding helps.
    const lookAhead = Math.min(12, Math.floor(n / 4));
    for (let i = 0; i < n; i++) {
      let minAhead = this.pts[i].speed;
      for (let j = 1; j <= lookAhead && i + j < n; j++) {
        minAhead = Math.min(minAhead, this.pts[i + j].speed);
      }
      // Blend: keep 60% of own limit, 40% from look-ahead minimum
      this.pts[i].speed = this.pts[i].speed * 0.6 + minAhead * 0.4;
    }
  }

  /* ═══════════════════════════════════════════
     PASS 3 – Grade-limited speed
     ═══════════════════════════════════════════
     Steep uphills reduce available traction;
     steep downhills limit speed for safety (engine braking zone).
  */
  _gradeSpeedLimits() {
    for (let i = 0; i < this.pts.length; i++) {
      const grade = this.pts[i].grade;
      if (Math.abs(grade) < 0.01) continue; // flat-ish, no adjustment

      if (grade > 0) {
        // Uphill: reduce proportionally to grade
        // At 10% grade (~6°), speed drops to ~55% of limit
        const factor = 1 / (1 + 5 * grade);
        this.pts[i].speed = Math.min(this.pts[i].speed, this.vMax * factor);
      } else {
        // Downhill: slight speed increase but cap for safety
        // At -10% grade, allow up to 110% of current limit
        const factor = Math.min(1 + Math.abs(grade) * 1.5, 1.15);
        this.pts[i].speed = Math.min(this.pts[i].speed * factor, this.vMax);
      }
    }
  }

  /** Hard-cap to vehicle max. */
  _capToVMax() {
    for (let i = 0; i < this.pts.length; i++) {
      this.pts[i].speed = Math.min(this.pts[i].speed, this.vMax);
    }
  }

  /* ═══════════════════════════════════════════
     PASS 4 – Power-limited acceleration
     ═══════════════════════════════════════════
     At higher speeds, aerodynamic drag eats into available power.
     a_avail = (P/v − F_drag − F_roll − F_grade) / m
  */
  _powerLimitedAccel() {
    // Pre-compute max achievable acceleration at each point's speed
    // (used by forward sweep)
    this._aAvail = new Float64Array(this.pts.length);
    const P = this.powerKw * 1000; // watts

    for (let i = 0; i < this.pts.length; i++) {
      const v = Math.max(this.pts[i].speed, this.idleSpeed);
      const Fdrag = 0.5 * this.rho * this.dragCd * this.frontalArea * v * v;
      const Froll = this.rollingCr * this.mass * this.G;
      const Fgrade = this.mass * this.G * Math.max(this.pts[i].grade, 0);
      const Fnet = (P / v) - Fdrag - Froll - Fgrade;
      this._aAvail[i] = Math.min(Math.max(Fnet / this.mass, 0.1), this.aMax);
    }
  }

  /* ═══════════════════════════════════════════
     PASS 5a – Forward sweep: accel-limited
     ═══════════════════════════════════════════
     Starting from rest (or an initial speed), we can't exceed the
     acceleration limit over each segment.
     v² = v₀² + 2·a·d  →  v = sqrt(v₀² + 2·a·d)
  */
  _forwardSweep() {
    // Start from a low speed (vehicle starting)
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
     PASS 5b – Backward sweep: braking-limited
     ═══════════════════════════════════════════
     Walking backward from each speed limit, we can't decelerate
     faster than bMax.
     v₀ = sqrt(v² + 2·b·d)  → the max speed at point i given point i+1
  */
  _backwardSweep() {
    const n = this.pts.length;
    // End at low speed (vehicle stopping or approaching end gently)
    this.pts[n - 1].speed = Math.min(this.pts[n - 1].speed, this.idleSpeed);

    for (let i = n - 2; i >= 0; i--) {
      const d = this.segDist[i + 1];
      const vNext = this.pts[i + 1].speed;
      const vReachable = Math.sqrt(vNext * vNext + 2 * this.bMax * d);
      this.pts[i].speed = Math.min(this.pts[i].speed, vReachable);
    }
  }

  /* ═══════════════════════════════════════════
     PASS 6 – Road / weather / driver conditions
     ═══════════════════════════════════════════ */
  _applyConditions() {
    let grip = 1.0;    // traction multiplier (affects cornering & braking)
    let vis  = 1.0;    // visibility factor (affects top speed willingness)

    // Road surface → traction
    switch (this.roadConditions) {
      case "wet":    grip = 0.82; break;
      case "icy":    grip = 0.45; break;
      case "gravel": grip = 0.65; break;
      // "dry" → 1.0
    }

    // Weather → visibility & secondary grip
    switch (this.weatherConditions) {
      case "rain": vis = 0.88; grip *= 0.92; break;
      case "snow": vis = 0.72; grip *= 0.65; break;
      case "fog":  vis = 0.68;               break;
    }

    // Driver behaviour → aggressiveness multiplier
    let driver = 1.0;
    switch (this.driverBehavior) {
      case "aggressive":   driver = 1.12; break;
      case "conservative": driver = 0.82; break;
    }

    // Combined multiplier – grip reduces cornering limits,
    // vis & driver scale the overall speed
    const combined = vis * driver;

    for (let i = 0; i < this.pts.length; i++) {
      // Cornering was computed with lateralG; reduce by grip
      // Re-derive: if cornering speed ∝ sqrt(grip), factor = sqrt(grip)
      const gripFactor = Math.sqrt(grip);
      this.pts[i].speed *= gripFactor * combined;
    }
  }

  /** Never let speed fall below idle (prevents 0 and division issues). */
  _enforceMinSpeed() {
    for (let i = 0; i < this.pts.length; i++) {
      this.pts[i].speed = Math.max(this.pts[i].speed, this.idleSpeed);
    }
  }

  /* ═══════════════════════════════════════════
     PASS 7 – Compute time & acceleration
     ═══════════════════════════════════════════ */
  _computeTimeline() {
    let cumTime = 0;
    this.pts[0].elapsed = 0;
    this.pts[0].acceleration = 0;

    for (let i = 1; i < this.pts.length; i++) {
      const d = this.segDist[i];
      const v0 = this.pts[i - 1].speed; // m/s (still in m/s at this point)
      const v1 = this.pts[i].speed;
      const vAvg = (v0 + v1) / 2;
      const dt = vAvg > 0.01 ? d / vAvg : 0;

      cumTime += dt;
      this.pts[i].elapsed = cumTime;
      this.pts[i].acceleration = dt > 0.001 ? (v1 - v0) / dt : 0;
    }
  }

  /* ═══════════════════════════════════════════
     PASS 8 – Bearings
     ═══════════════════════════════════════════ */
  _setBearings() {
    for (let i = 0; i < this.pts.length - 1; i++) {
      this.pts[i].bearing = GeoUtils.calculateBearing(this.pts[i], this.pts[i + 1]);
    }
    // Last point inherits previous bearing
    if (this.pts.length > 1) {
      this.pts[this.pts.length - 1].bearing = this.pts[this.pts.length - 2].bearing;
    }
  }

  /* ═══════════════════════════════════════════
     PASS 9 – Convert internal m/s → km/h for output
     ═══════════════════════════════════════════ */
  _convertUnits() {
    for (let i = 0; i < this.pts.length; i++) {
      this.pts[i].speed *= 3.6; // m/s → km/h
    }
  }
}