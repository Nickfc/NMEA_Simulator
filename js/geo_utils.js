/**
 * Shared geographic utility functions.
 * Single source of truth for Haversine distance, bearing, and degree-to-radian conversion.
 * All distances returned in meters unless otherwise noted.
 */
const GeoUtils = {
  toRadians(deg) {
    return deg * (Math.PI / 180);
  },

  /**
   * Calculate great-circle distance between two points using the Haversine formula.
   * @returns {number} Distance in meters.
   */
  haversineDistance(point1, point2) {
    const R = 6371e3; // Earth's radius in meters
    const lat1 = GeoUtils.toRadians(point1.lat);
    const lat2 = GeoUtils.toRadians(point2.lat);
    const dLat = GeoUtils.toRadians(point2.lat - point1.lat);
    const dLon = GeoUtils.toRadians(point2.lon - point1.lon);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  },

  /**
   * Calculate the initial bearing from point1 to point2 using great-circle navigation.
   * @returns {number} Bearing in degrees (0-360).
   */
  calculateBearing(point1, point2) {
    const lat1 = GeoUtils.toRadians(point1.lat);
    const lat2 = GeoUtils.toRadians(point2.lat);
    const dLon = GeoUtils.toRadians(point2.lon - point1.lon);

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearing = Math.atan2(y, x) * (180 / Math.PI);

    return (bearing + 360) % 360;
  }
};
