class Conversion {
  constructor() {
    this.routePoints = [];
  }

  parseGPX(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "application/xml");

    const trkpts = xmlDoc.getElementsByTagName("trkpt");
    for (let i = 0; i < trkpts.length; i++) {
      const lat = parseFloat(trkpts[i].getAttribute("lat"));
      const lon = parseFloat(trkpts[i].getAttribute("lon"));
      const ele = trkpts[i].getElementsByTagName("ele")[0]
        ? parseFloat(trkpts[i].getElementsByTagName("ele")[0].textContent)
        : 0;
      const time = trkpts[i].getElementsByTagName("time")[0]
        ? new Date(trkpts[i].getElementsByTagName("time")[0].textContent)
        : null;

      this.routePoints.push({ lat, lon, ele, time });
    }
  }

  parseKML(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "application/xml");

    const coordinates = xmlDoc.getElementsByTagName("coordinates");
    for (let i = 0; i < coordinates.length; i++) {
      const coords = coordinates[i].textContent.trim().split(/\s+/);
      coords.forEach((coord) => {
        const [lon, lat, ele] = coord.split(",").map(parseFloat);
        this.routePoints.push({ lat, lon, ele: ele || 0 });
      });
    }
  }

  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const fileContent = event.target.result;
        if (file.name.endsWith(".gpx")) {
          this.parseGPX(fileContent);
        } else if (file.name.endsWith(".kml")) {
          this.parseKML(fileContent);
        } else {
          reject(new Error("Invalid file format"));
        }
        resolve(this.routePoints);
      };
      reader.onerror = (error) => {
        reject(error);
      };
      reader.readAsText(file);
    });
  }

  calculateDistance(point1, point2) {
    const R = 6371e3; // Earth's radius in meters
    const lat1 = point1.lat * (Math.PI / 180);
    const lat2 = point2.lat * (Math.PI / 180);
    const dLat = (point2.lat - point1.lat) * (Math.PI / 180);
    const dLon = (point2.lon - point1.lon) * (Math.PI / 180);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  interpolateRoutePoints(totalRouteTime, frequency) {
    const totalPoints = Math.ceil(totalRouteTime * frequency);
    const interpolatedPoints = [this.routePoints[0]];

    let remainingPoints = totalPoints - 1;
    let remainingDistance = 0;

    for (let i = 1; i < this.routePoints.length; i++) {
      remainingDistance += this.calculateDistance(this.routePoints[i - 1], this.routePoints[i]);
    }

    for (let i = 1; i < this.routePoints.length; i++) {
      const segmentDistance = this.calculateDistance(this.routePoints[i - 1], this.routePoints[i]);
      const segmentPoints = Math.round(segmentDistance / remainingDistance * remainingPoints);

      for (let j = 1; j <= segmentPoints; j++) {
        const t = j / (segmentPoints + 1);
        const lat = this.routePoints[i - 1].lat + t * (this.routePoints[i].lat - this.routePoints[i - 1].lat);
        const lon = this.routePoints[i - 1].lon + t * (this.routePoints[i].lon - this.routePoints[i - 1].lon);
        const ele = this.routePoints[i - 1].ele + t * (this.routePoints[i].ele - this.routePoints[i - 1].ele);

        interpolatedPoints.push({ lat, lon, ele });
      }

      remainingPoints -= segmentPoints;
      remainingDistance -= segmentDistance;
    }

    this.routePoints = interpolatedPoints;
  }
}