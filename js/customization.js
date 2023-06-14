class Customization {
  constructor() {
    this.vehicleProfiles = {
      car: { maxSpeed: 120, acceleration: 2.5 },
      bicycle: { maxSpeed: 30, acceleration: 1 },
      motorcycle: { maxSpeed: 160, acceleration: 3 },
      truck: { maxSpeed: 80, acceleration: 1.5 },
      electricVehicle: { maxSpeed: 150, acceleration: 3 },
      walking: { maxSpeed: 6, acceleration: 0.5 },
      electricScooter: { maxSpeed: 25, acceleration: 1 },
      bus: { maxSpeed: 60, acceleration: 1.5 },
      van: { maxSpeed: 100, acceleration: 2 },
      heavyTruck: { maxSpeed: 90, acceleration: 1.2 },
      moped: { maxSpeed: 45, acceleration: 1.5 },
      skateboard: { maxSpeed: 15, acceleration: 0.8 },
      wheelchair: { maxSpeed: 8, acceleration: 0.5 },
      segway: { maxSpeed: 20, acceleration: 1 },
      tram: { maxSpeed: 70, acceleration: 1.5 },
    };

    this.roadConditions = ["dry", "wet", "icy", "gravel"];
    this.weatherConditions = ["clear", "rain", "snow", "fog"];
    this.driverBehaviors = ["aggressive", "normal", "conservative"];
  }

  setVehicleProfile(vehicleType, maxSpeed, acceleration) {
    if (!this.vehicleProfiles[vehicleType]) {
      this.vehicleProfiles[vehicleType] = {};
    }
    this.vehicleProfiles[vehicleType].maxSpeed = maxSpeed;
    this.vehicleProfiles[vehicleType].acceleration = acceleration;
  }

  getVehicleProfile(vehicleType) {
    return this.vehicleProfiles[vehicleType];
  }
}