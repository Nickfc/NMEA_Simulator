/* ═══════════════════════════════════════════════════════════════
   ElevationService – fetch real elevation data for route points
   ═══════════════════════════════════════════════════════════════
   Uses Open-Elevation API (open-elevation.com) which provides
   SRTM 30m resolution elevation data worldwide.
   
   Batches requests (max 200 points per call) and fills in
   the .ele field on each coordinate object.
   ═══════════════════════════════════════════════════════════════ */

class ElevationService {
  constructor() {
    this.API_URL = "https://api.open-elevation.com/api/v1/lookup";
    this.BATCH_SIZE = 200;  // API limit per request
    this.cache = new Map(); // simple coordinate cache
  }

  /**
   * Fetch elevation for an array of {lat, lon, ele} coordinates.
   * Modifies the objects in-place (sets .ele) and returns the array.
   * Gracefully degrades to flat (ele=0) on failure.
   *
   * @param {Array} coords – [{lat, lon, ele, …}, …]
   * @param {Function} [onProgress] – callback(fraction 0–1) for progress
   * @returns {Promise<Array>} – same coords array with .ele populated
   */
  async fetchElevations(coords, onProgress) {
    if (!coords || coords.length === 0) return coords;

    // Thin the sample: for very long routes, sample every Nth point
    // and interpolate between samples to reduce API calls
    const MAX_API_POINTS = 600; // max total points to query
    const step = Math.max(1, Math.floor(coords.length / MAX_API_POINTS));

    // Collect sample indices
    const sampleIndices = [];
    for (let i = 0; i < coords.length; i += step) {
      sampleIndices.push(i);
    }
    // Always include last point
    if (sampleIndices[sampleIndices.length - 1] !== coords.length - 1) {
      sampleIndices.push(coords.length - 1);
    }

    // Build sample points, checking cache first
    const uncached = [];
    const uncachedIdxMap = []; // maps uncached position → sampleIndices index
    for (let si = 0; si < sampleIndices.length; si++) {
      const idx = sampleIndices[si];
      const key = `${coords[idx].lat.toFixed(5)},${coords[idx].lon.toFixed(5)}`;
      if (this.cache.has(key)) {
        coords[idx].ele = this.cache.get(key);
      } else {
        uncached.push({ latitude: coords[idx].lat, longitude: coords[idx].lon });
        uncachedIdxMap.push(si);
      }
    }

    // Batch-fetch uncached elevations
    if (uncached.length > 0) {
      const batches = [];
      for (let i = 0; i < uncached.length; i += this.BATCH_SIZE) {
        batches.push(uncached.slice(i, i + this.BATCH_SIZE));
      }

      let fetched = 0;
      for (const batch of batches) {
        try {
          const res = await fetch(this.API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locations: batch }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          for (let j = 0; j < data.results.length; j++) {
            const globalBatchIdx = fetched + j;
            const si = uncachedIdxMap[globalBatchIdx];
            const idx = sampleIndices[si];
            const ele = data.results[j].elevation || 0;
            coords[idx].ele = ele;
            const key = `${coords[idx].lat.toFixed(5)},${coords[idx].lon.toFixed(5)}`;
            this.cache.set(key, ele);
          }
        } catch (err) {
          console.warn("Elevation API batch failed, using 0:", err.message);
          // Leave .ele as-is (0) for failed points
        }

        fetched += batch.length;
        if (onProgress) {
          onProgress(fetched / uncached.length);
        }
      }
    }

    // Interpolate between sample points for non-sampled coords
    for (let si = 0; si < sampleIndices.length - 1; si++) {
      const iA = sampleIndices[si];
      const iB = sampleIndices[si + 1];
      const eleA = coords[iA].ele || 0;
      const eleB = coords[iB].ele || 0;
      const span = iB - iA;
      for (let k = 1; k < span; k++) {
        const t = k / span;
        coords[iA + k].ele = eleA + t * (eleB - eleA);
      }
    }

    return coords;
  }
}
