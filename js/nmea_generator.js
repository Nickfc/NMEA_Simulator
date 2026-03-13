/* ═══════════════════════════════════════════════════════════════
   NMEA Generator – standards-compliant sentence generation
   ═══════════════════════════════════════════════════════════════
   Supports:
     • $GPGGA  – Fix data (position, altitude, satellites, DOP)
     • $GPRMC  – Recommended minimum (position, speed, heading, date)
     • $GPVTG  – Track & ground speed
     • $GPGSA  – Active satellites & DOP
     • $GPGSV  – Satellites in view (signal strengths)
   
   Two export modes:
     hackrf   – bare $GPGGA only (for gps-sdr-sim / HackRF)
     standard – multi-sentence per fix (realistic GPS receiver)
   ═══════════════════════════════════════════════════════════════ */

class NMEAGenerator {
  /**
   * @param {Object} opts
   * @param {string} opts.mode          – "hackrf" | "standard"
   * @param {boolean} opts.gpsNoise     – add position jitter
   * @param {number}  opts.noiseMeters  – noise σ in metres (default 2.5)
   * @param {boolean} opts.simulateSats – generate GSA/GSV sentences
   */
  constructor(opts = {}) {
    this.mode         = opts.mode         || "standard";
    this.gpsNoise     = opts.gpsNoise     ?? true;
    this.noiseMeters  = opts.noiseMeters  || 2.5;
    this.simulateSats = opts.simulateSats ?? true;

    // Satellite constellation state (persists across fixes)
    this._satSeed = 42;
    this._constellationCache = null;
    this._lastConstellationUpdate = -999;
  }

  /* ═══════════════════════════════════════════
     PUBLIC API
     ═══════════════════════════════════════════ */

  /**
   * Generate all NMEA sentences for one fix.
   * @param {Object} point – { lat, lon, ele, speed (km/h), bearing, elapsed (s), … }
   * @param {Date}   time  – UTC timestamp for this fix
   * @returns {string[]}   – array of NMEA sentence strings
   */
  generateFix(point, time) {
    // Apply GPS noise if enabled
    let lat = point.lat;
    let lon = point.lon;
    let ele = point.ele || 0;
    if (this.gpsNoise) {
      const n = this._gaussianNoise(this.noiseMeters);
      lat += (n.x / 111320);  // metres → degrees lat
      lon += (n.y / (111320 * Math.cos(lat * Math.PI / 180)));
      ele += this._gaussianNoise(this.noiseMeters * 1.5).x; // vertical noise is worse
    }

    // Satellite state
    const sats = this.simulateSats ? this._updateConstellation(point) : this._defaultSats();
    const hdop = sats.hdop;
    const numSats = sats.tracked;

    const speed = Math.max(point.speed || 0, 0);       // km/h
    const bearing = point.bearing || 0;

    const sentences = [];

    // Always produce GGA
    sentences.push(this._buildGGA(lat, lon, ele, time, numSats, hdop));

    if (this.mode === "standard") {
      sentences.push(this._buildRMC(lat, lon, speed, bearing, time));
      sentences.push(this._buildVTG(speed, bearing));
      sentences.push(this._buildGSA(sats));
      // GSV can be multiple sentences
      sentences.push(...this._buildGSV(sats));
    }

    return sentences;
  }

  /* ═══════════════════════════════════════════
     $GPGGA – Global Positioning System Fix Data
     ═══════════════════════════════════════════ */
  _buildGGA(lat, lon, ele, time, numSats, hdop) {
    const t   = this._formatTime(time);
    const latF = this._toDDMM(lat, true);
    const lonF = this._toDDMM(lon, false);
    const ns  = lat >= 0 ? 'N' : 'S';
    const ew  = lon >= 0 ? 'E' : 'W';
    const alt = ele.toFixed(1);
    const geoidSep = '0.0'; // simplified
    const fix = 1; // GPS fix
    const sats = String(numSats).padStart(2, '0');
    const h = hdop.toFixed(1);

    const body = `$GPGGA,${t},${latF},${ns},${lonF},${ew},${fix},${sats},${h},${alt},M,${geoidSep},M,,`;
    return body + '*' + this._checksum(body);
  }

  /* ═══════════════════════════════════════════
     $GPRMC – Recommended Minimum Specific GNSS Data
     ═══════════════════════════════════════════ */
  _buildRMC(lat, lon, speedKmh, bearing, time) {
    const t   = this._formatTime(time);
    const d   = this._formatDate(time);
    const latF = this._toDDMM(lat, true);
    const lonF = this._toDDMM(lon, false);
    const ns  = lat >= 0 ? 'N' : 'S';
    const ew  = lon >= 0 ? 'E' : 'W';
    const knots = (speedKmh / 1.852).toFixed(1);  // km/h → knots
    const brg = bearing.toFixed(1);
    const magVar = '0.0,E'; // simplified

    const body = `$GPRMC,${t},A,${latF},${ns},${lonF},${ew},${knots},${brg},${d},${magVar},A`;
    return body + '*' + this._checksum(body);
  }

  /* ═══════════════════════════════════════════
     $GPVTG – Track Made Good and Ground Speed
     ═══════════════════════════════════════════ */
  _buildVTG(speedKmh, bearing) {
    const brg = bearing.toFixed(1);
    const knots = (speedKmh / 1.852).toFixed(1);
    const kmh = speedKmh.toFixed(1);

    const body = `$GPVTG,${brg},T,,M,${knots},N,${kmh},K,A`;
    return body + '*' + this._checksum(body);
  }

  /* ═══════════════════════════════════════════
     $GPGSA – GNSS DOP and Active Satellites
     ═══════════════════════════════════════════ */
  _buildGSA(sats) {
    const mode = 'A'; // automatic
    const fix = 3;    // 3D fix
    // List up to 12 tracked PRN numbers
    const prns = sats.tracked_list.slice(0, 12);
    const prnStr = prns.map(p => String(p).padStart(2, '0')).join(',');
    // Pad to 12 slots
    const slots = 12 - prns.length;
    const padding = slots > 0 ? ',' + Array(slots).fill('').join(',') : '';

    const pdop = sats.pdop.toFixed(1);
    const hdop = sats.hdop.toFixed(1);
    const vdop = sats.vdop.toFixed(1);

    const body = `$GPGSA,${mode},${fix},${prnStr}${padding},${pdop},${hdop},${vdop}`;
    return body + '*' + this._checksum(body);
  }

  /* ═══════════════════════════════════════════
     $GPGSV – GNSS Satellites in View
     ═══════════════════════════════════════════ */
  _buildGSV(sats) {
    const visible = sats.visible;
    const totalMsgs = Math.ceil(visible.length / 4);
    const sentences = [];

    for (let msg = 0; msg < totalMsgs; msg++) {
      const start = msg * 4;
      const group = visible.slice(start, start + 4);
      let fields = `$GPGSV,${totalMsgs},${msg + 1},${String(visible.length).padStart(2, '0')}`;

      for (const sat of group) {
        fields += `,${String(sat.prn).padStart(2, '0')},${String(sat.elevation).padStart(2, '0')},${String(sat.azimuth).padStart(3, '0')},${String(sat.snr).padStart(2, '0')}`;
      }
      // Pad remaining slots if less than 4 sats in this message
      for (let i = group.length; i < 4; i++) {
        fields += ',,,,';
      }

      sentences.push(fields + '*' + this._checksum(fields));
    }

    return sentences;
  }

  /* ═══════════════════════════════════════════
     NMEA formatting helpers
     ═══════════════════════════════════════════ */

  /** Convert decimal degrees to NMEA DDMM.MMMMM format. */
  _toDDMM(decimalDeg, isLat) {
    const abs = Math.abs(decimalDeg);
    const deg = Math.floor(abs);
    const min = (abs - deg) * 60;
    const degStr = String(deg).padStart(isLat ? 2 : 3, '0');
    const minStr = min.toFixed(5).padStart(8, '0'); // MM.MMMMM
    return degStr + minStr;
  }

  /** Format Date → HHMMSS.SS */
  _formatTime(date) {
    const h = String(date.getUTCHours()).padStart(2, '0');
    const m = String(date.getUTCMinutes()).padStart(2, '0');
    const s = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(Math.floor(date.getUTCMilliseconds() / 10)).padStart(2, '0');
    return `${h}${m}${s}.${ms}`;
  }

  /** Format Date → DDMMYY */
  _formatDate(date) {
    const d = String(date.getUTCDate()).padStart(2, '0');
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const y = String(date.getUTCFullYear() % 100).padStart(2, '0');
    return `${d}${m}${y}`;
  }

  /** XOR checksum between $ and * → 2-char hex. */
  _checksum(sentence) {
    let cs = 0;
    for (let i = 1; i < sentence.length; i++) {
      cs ^= sentence.charCodeAt(i);
    }
    return cs.toString(16).toUpperCase().padStart(2, '0');
  }

  /* ═══════════════════════════════════════════
     GPS noise simulation
     ═══════════════════════════════════════════ */

  /** Box-Muller Gaussian random pair with σ = sigma metres. */
  _gaussianNoise(sigma) {
    const u1 = Math.random();
    const u2 = Math.random();
    const mag = sigma * Math.sqrt(-2 * Math.log(u1 + 1e-12));
    return {
      x: mag * Math.cos(2 * Math.PI * u2),
      y: mag * Math.sin(2 * Math.PI * u2),
    };
  }

  /* ═══════════════════════════════════════════
     Satellite constellation simulation
     ═══════════════════════════════════════════ */

  _defaultSats() {
    return {
      tracked: 8, tracked_list: [3, 7, 8, 11, 14, 19, 22, 28],
      hdop: 1.2, vdop: 1.8, pdop: 2.2,
      visible: [],
    };
  }

  /** Update simulated constellation every ~10s of sim time. */
  _updateConstellation(point) {
    const elapsed = point.elapsed || 0;
    if (this._constellationCache && Math.abs(elapsed - this._lastConstellationUpdate) < 10) {
      return this._constellationCache;
    }
    this._lastConstellationUpdate = elapsed;

    // Simulate 8–12 visible sats with varying signal strengths
    const seed = this._hashFloat(elapsed * 1000 + point.lat * 100);
    const numVisible = 8 + Math.floor(this._seededRandom(seed) * 5);      // 8–12
    const numTracked = Math.max(4, numVisible - Math.floor(this._seededRandom(seed + 1) * 3)); // lose 0–2

    const visible = [];
    const tracked_list = [];
    const PRN_POOL = [1,2,3,5,6,7,8,9,11,13,14,15,17,19,20,21,22,24,25,28,30,31,32];

    for (let i = 0; i < numVisible; i++) {
      const prn = PRN_POOL[(Math.floor(this._seededRandom(seed + i * 7) * PRN_POOL.length)) % PRN_POOL.length];
      const elevation = 5 + Math.floor(this._seededRandom(seed + i * 13) * 80); // 5–84°
      const azimuth = Math.floor(this._seededRandom(seed + i * 19) * 360);
      // SNR: higher elevation → generally better signal
      const baseSNR = 25 + elevation * 0.4;
      const snr = Math.max(0, Math.min(50, Math.round(baseSNR + (this._seededRandom(seed + i * 31) - 0.5) * 15)));

      visible.push({ prn, elevation, azimuth, snr });
      if (i < numTracked) tracked_list.push(prn);
    }

    // DOP values from geometry (simplified)
    const hdop = 0.8 + this._seededRandom(seed + 100) * 1.5;  // 0.8–2.3
    const vdop = 1.0 + this._seededRandom(seed + 200) * 2.0;  // 1.0–3.0
    const pdop = Math.sqrt(hdop * hdop + vdop * vdop);

    this._constellationCache = { tracked: numTracked, tracked_list, hdop, vdop, pdop, visible };
    return this._constellationCache;
  }

  _seededRandom(seed) {
    let h = (seed * 2654435761) >>> 0;
    h = ((h >> 16) ^ h) * 2246822519 >>> 0;
    h = ((h >> 13) ^ h) * 3266489917 >>> 0;
    h = (h >> 16) ^ h;
    return (h >>> 0) / 4294967296;
  }

  _hashFloat(v) {
    return Math.floor(Math.abs(v * 7919)) % 2147483647;
  }
}
