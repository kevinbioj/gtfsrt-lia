//- GTFS Static

export type Calendar = {
  id: string;
  days: [boolean, boolean, boolean, boolean, boolean, boolean, boolean];
  whitelist: string[];
  blacklist: string[];
  from: string;
  to: string;
};

export type GtfsResource = {
  calendars: Map<string, Calendar>;
  stops: Map<string, Stop>;
  trips: Map<string, Trip>;
};

export type Stop = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

export type StopTime = {
  sequence: number;
  stop: Stop;
  time: string;
};

export type Trip = {
  id: string;
  calendar: Calendar;
  block: string | null;
  route: string;
  direction: number;
  headsign: string;
  stops: StopTime[];
};

//- GTFS Real-Time

export type StopTimeEvent = {
  delay?: number;
  time?: string;
};

export type VehicleDescriptor = {
  id: string;
  label?: string;
};

export type TripUpdateEntity = {
  id: string;
  tripUpdate: {
    stopTimeUpdate: Array<{
      scheduleRelationship?: 'SCHEDULED' | 'SKIPPED' | 'NO-DATA';
      arrival?: StopTimeEvent;
      departure?: StopTimeEvent;
      stopId: string;
      stopSequence?: number;
    }>;
    timestamp: string;
    trip: {
      tripId: string;
      routeId?: string;
      directionId?: number;
    };
    vehicle?: VehicleDescriptor;
  };
};

export type GtfsRtTripUpdate = {
  header: {
    gtfsRealtimeVersion: string;
    timestamp: string;
  };
  entity: TripUpdateEntity[];
};

export type VehiclePositionEntity = {
  id: string;
  vehicle: {
    currentStatus?: 'STOPPED_AT' | 'IN_TRANSIT_TO';
    currentStopSequence?: number;
    bearing: number;
    position: {
      latitude: number;
      longitude: number;
    };
    timestamp: string;
    trip: {
      tripId: string;
      routeId?: string;
      directionId?: number;
    };
    vehicle: VehicleDescriptor;
  };
};

export type GtfsRtVehiclePosition = {
  header: {
    gtfsRealtimeVersion: string;
    timestamp: string;
  };
  entity: VehiclePositionEntity[];
};

// ---

type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<
  T,
  Exclude<keyof T, Keys>
> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
  }[Keys];
