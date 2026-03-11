class Customization {
  constructor() {
    /*  Vehicle profiles – extended for PhysicsEngine v2
        ──────────────────────────────────────────────────
        maxSpeed    : km/h  – absolute top speed
        acceleration: m/s²  – peak longitudinal acceleration
        braking     : m/s²  – peak deceleration (positive number)
        maxLateralG : g     – lateral grip before loss of traction
        mass        : kg    – kerb weight
        dragCd      : –     – aerodynamic drag coefficient
        frontalArea : m²    – frontal cross-section
        rollingCr   : –     – tyre rolling resistance coefficient
        powerKw     : kW    – peak engine/motor power
        idleSpeed   : km/h  – minimum crawl / creep speed
    */
    this.vehicleProfiles = {
      car:             { maxSpeed: 120, acceleration: 2.8,  braking: 5.0,  maxLateralG: 0.38, mass: 1400, dragCd: 0.30, frontalArea: 2.2, rollingCr: 0.012, powerKw: 110, idleSpeed: 5 },
      bicycle:         { maxSpeed: 30,  acceleration: 0.8,  braking: 3.0,  maxLateralG: 0.25, mass: 85,   dragCd: 0.90, frontalArea: 0.5, rollingCr: 0.005, powerKw: 0.4, idleSpeed: 3 },
      motorcycle:      { maxSpeed: 160, acceleration: 3.5,  braking: 6.0,  maxLateralG: 0.45, mass: 220,  dragCd: 0.60, frontalArea: 0.7, rollingCr: 0.010, powerKw: 80,  idleSpeed: 5 },
      truck:           { maxSpeed: 90,  acceleration: 1.2,  braking: 3.5,  maxLateralG: 0.28, mass: 8000, dragCd: 0.60, frontalArea: 8.0, rollingCr: 0.007, powerKw: 250, idleSpeed: 5 },
      electricVehicle: { maxSpeed: 150, acceleration: 4.0,  braking: 5.5,  maxLateralG: 0.40, mass: 2000, dragCd: 0.23, frontalArea: 2.3, rollingCr: 0.010, powerKw: 200, idleSpeed: 4 },
      walking:         { maxSpeed: 6,   acceleration: 0.4,  braking: 1.5,  maxLateralG: 0.15, mass: 75,   dragCd: 1.10, frontalArea: 0.5, rollingCr: 0.000, powerKw: 0.08,idleSpeed: 2 },
      electricScooter: { maxSpeed: 25,  acceleration: 1.2,  braking: 3.0,  maxLateralG: 0.20, mass: 90,   dragCd: 0.80, frontalArea: 0.5, rollingCr: 0.008, powerKw: 0.5, idleSpeed: 3 },
      bus:             { maxSpeed: 80,  acceleration: 1.0,  braking: 3.0,  maxLateralG: 0.22, mass: 12000,dragCd: 0.65, frontalArea: 8.5, rollingCr: 0.007, powerKw: 220, idleSpeed: 5 },
      van:             { maxSpeed: 110, acceleration: 2.0,  braking: 4.0,  maxLateralG: 0.32, mass: 2200, dragCd: 0.35, frontalArea: 3.2, rollingCr: 0.012, powerKw: 120, idleSpeed: 5 },
      heavyTruck:      { maxSpeed: 85,  acceleration: 0.8,  braking: 2.8,  maxLateralG: 0.22, mass: 25000,dragCd: 0.70, frontalArea: 10., rollingCr: 0.006, powerKw: 350, idleSpeed: 5 },
      moped:           { maxSpeed: 45,  acceleration: 1.5,  braking: 3.5,  maxLateralG: 0.30, mass: 120,  dragCd: 0.70, frontalArea: 0.6, rollingCr: 0.010, powerKw: 3,   idleSpeed: 4 },
      skateboard:      { maxSpeed: 15,  acceleration: 0.6,  braking: 2.0,  maxLateralG: 0.18, mass: 78,   dragCd: 1.00, frontalArea: 0.5, rollingCr: 0.020, powerKw: 0.06,idleSpeed: 2 },
      wheelchair:      { maxSpeed: 8,   acceleration: 0.4,  braking: 1.5,  maxLateralG: 0.12, mass: 100,  dragCd: 1.00, frontalArea: 0.7, rollingCr: 0.015, powerKw: 0.25,idleSpeed: 2 },
      segway:          { maxSpeed: 20,  acceleration: 1.0,  braking: 2.5,  maxLateralG: 0.18, mass: 100,  dragCd: 0.90, frontalArea: 0.5, rollingCr: 0.008, powerKw: 1.5, idleSpeed: 3 },
      tram:            { maxSpeed: 70,  acceleration: 1.2,  braking: 3.5,  maxLateralG: 0.10, mass: 30000,dragCd: 0.50, frontalArea: 9.0, rollingCr: 0.002, powerKw: 400, idleSpeed: 5 },
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