export type SiriVehicleActivity = {
  RecordedAtTime: string;
  ProgressBetweenStops: {
    Percentage: number;
  };
  MonitoredVehicleJourney: {
    LineRef: string;
    OriginRef: string;
    DestinationRef: string;
    DestinationName: string;
    VehicleRef: string;
    Monitored: "true" | "false";
    VehicleLocation?: {
      Coordinates: string;
    };
    Bearing: number;
    Delay: string;
    MonitoredCall: SiriStopCall;
  };
};

export type SiriStopCall = {
  StopPointRef: string;
  StopPointName: string;
  Order: number;
  VehicleAtStop: boolean;
  AimedDepartureTime: string;
  ExpectedDepartureTime: string;
};
