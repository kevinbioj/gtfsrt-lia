export type SiriVehicleActivity = {
  RecordedAtTime: string;
  MonitoredVehicleJourney: {
    LineRef: string;
    OriginRef: string;
    DestinationRef: string;
    VehicleRef: string;
    Monitored: 'true' | 'false';
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
  Order: number;
  VehicleAtStop: 'true' | 'false';
  AimedArrivalTime: string;
  ExpectedArrivalTime: string;
};
