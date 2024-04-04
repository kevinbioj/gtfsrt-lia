import dayjs from "dayjs";
import type {
  GtfsRtTripUpdate,
  GtfsRtVehiclePosition,
  TripUpdateEntity,
  VehiclePositionEntity,
} from "~/gtfs/@types";

export function wrapEntities(entities: (TripUpdateEntity | VehiclePositionEntity)[]) {
  return {
    header: {
      gtfsRealtimeVersion: "2.0",
      timestamp: dayjs().unix().toString(),
    },
    entity: entities,
  } as GtfsRtTripUpdate | GtfsRtVehiclePosition;
}
