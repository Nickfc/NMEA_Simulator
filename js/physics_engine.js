class PhysicsEngine {
  constructor(routePoints, vehicleProfile, roadConditions, weatherConditions, driverBehavior) {
    this.routePoints = routePoints;
    this.vehicleProfile = vehicleProfile;
    this.roadConditions = roadConditions;
    this.weatherConditions = weatherConditions;
    this.driverBehavior = driverBehavior;
  }

  // Calculate the angle between three points using great-circle distance
  calculateTrajectory(point1, point2, point3) {
    const bearing1 = GeoUtils.calculateBearing(point1, point2);
    const bearing2 = GeoUtils.calculateBearing(point2, point3);

    let angle = Math.abs(bearing1 - bearing2);
    if (angle > 180) {
      angle = 360 - angle;
    }

    return angle;
  }

  // Calculate the average curvature of a set of points
  calculateCurvature(points) {
    let totalAngle = 0;

    for (let i = 1; i < points.length - 1; i++) {
      const angle = this.calculateTrajectory(points[i - 1], points[i], points[i + 1]);
      totalAngle += angle;
    }

    return totalAngle / (points.length - 2);
  }

  // Look ahead a certain number of points and calculate the average curvature
  lookAhead(index, lookAheadCount) {
    const endIndex = Math.min(index + lookAheadCount, this.routePoints.length - 1);
    const lookAheadPoints = this.routePoints.slice(index, endIndex);
    const curvature = this.calculateCurvature(lookAheadPoints);

    return curvature;
  }

  // Adjust the speed of each point based on the trajectory (look-ahead mechanism)
  adjustSpeedForTrajectory() {
    const lookAheadCount = 5;

    for (let i = 1; i < this.routePoints.length - 1; i++) {
      const curvature = this.lookAhead(i, lookAheadCount);
      const speedFactor = 1 - Math.min(curvature / 180, 1);
      this.routePoints[i].speed = this.vehicleProfile.maxSpeed * speedFactor;
    }
  }

  // Adjust the speed of each point based on the elevation change
  adjustSpeedForElevation() {
    for (let i = 1; i < this.routePoints.length; i++) {
      const elevationChange = this.routePoints[i].ele - this.routePoints[i - 1].ele;
      const distance = GeoUtils.haversineDistance(this.routePoints[i], this.routePoints[i - 1]);
      const slope = elevationChange / distance;

      const slopeFactor = 1 - Math.min(Math.abs(slope) * 10, 1);
      this.routePoints[i].speed *= slopeFactor;
    }
  }

  // Apply customizations for road conditions, weather conditions, and driver behavior
  applyCustomizations() {
    this.routePoints.forEach((point) => {
      let speedFactor = 1;

      // Road conditions
      if (this.roadConditions === "wet") {
        speedFactor *= 0.9;
      } else if (this.roadConditions === "icy") {
        speedFactor *= 0.7;
      } else if (this.roadConditions === "gravel") {
        speedFactor *= 0.8;
      }

      // Weather conditions
      if (this.weatherConditions === "rain") {
        speedFactor *= 0.9;
      } else if (this.weatherConditions === "snow") {
        speedFactor *= 0.8;
      } else if (this.weatherConditions === "fog") {
        speedFactor *= 0.85;
      }

      // Driver behavior
      if (this.driverBehavior === "aggressive") {
        speedFactor *= 1.1;
      } else if (this.driverBehavior === "conservative") {
        speedFactor *= 0.9;
      }

      point.speed *= speedFactor;
    });
  }

  // Smooth out small speed differences between consecutive points
  smoothSpeedChanges(smoothingFactor) {
    for (let i = 1; i < this.routePoints.length - 1; i++) {
      const previousSpeed = this.routePoints[i - 1].speed;
      const currentSpeed = this.routePoints[i].speed;
      const nextSpeed = this.routePoints[i + 1].speed;

      const averageSpeed = (previousSpeed + currentSpeed + nextSpeed) / 3;
      const speedDifference = Math.abs(currentSpeed - averageSpeed);

      if (speedDifference < smoothingFactor) {
        this.routePoints[i].speed = averageSpeed;
      }
    }
  }

  // Process the route by adjusting speed based on trajectory, elevation, customizations, and smoothing
  processRoute() {
    this.adjustSpeedForTrajectory();
    this.adjustSpeedForElevation();
    this.applyCustomizations();
    this.smoothSpeedChanges(5); // Smoothing factor (in km/h)
    return this.routePoints;
  }

  // Calculate dynamic speed based on acceleration, braking, and road conditions
  calculateDynamicSpeed(index, interpolation) {
    const startPoint = this.routePoints[index];
    const endPoint = this.routePoints[index + 1];
    const segmentDistance = GeoUtils.haversineDistance(startPoint, endPoint);
    const segmentTime = (segmentDistance / startPoint.speed) * 3.6;
    const acceleration = (endPoint.speed - startPoint.speed) / segmentTime;

    const interpolatedSpeed = startPoint.speed + acceleration * (segmentTime / interpolation);
    return interpolatedSpeed;
  }

  // Process the route with dynamic speed changes and synchronized animation speed
  processRouteWithDynamicSpeed(interpolation) {
    this.adjustSpeedForTrajectory();
    this.adjustSpeedForElevation();
    this.applyCustomizations();
    this.smoothSpeedChanges(5); // Smoothing factor (in km/h)

    const processedRoutePoints = [];

    for (let index = 0; index < this.routePoints.length - 1; index++) {
      const startPoint = this.routePoints[index];
      const endPoint = this.routePoints[index + 1];
      const latStep = (endPoint.lat - startPoint.lat) / interpolation;
      const lonStep = (endPoint.lon - startPoint.lon) / interpolation;
      const eleStep = (endPoint.ele - startPoint.ele) / interpolation;

      for (let i = 0; i < interpolation; i++) {
        const interpolatedLat = startPoint.lat + latStep * i;
        const interpolatedLon = startPoint.lon + lonStep * i;
        const interpolatedEle = startPoint.ele + eleStep * i;
        const interpolatedSpeed = this.calculateDynamicSpeed(index, interpolation);

        processedRoutePoints.push({
          lat: interpolatedLat,
          lon: interpolatedLon,
          ele: interpolatedEle,
          speed: interpolatedSpeed,
        });
      }
    }

    processedRoutePoints.push(this.routePoints[this.routePoints.length - 1]);
    return processedRoutePoints;
  }
}