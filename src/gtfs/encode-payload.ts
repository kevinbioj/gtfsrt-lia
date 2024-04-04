import { join } from "node:path";
import { loadSync } from "protobufjs";
import type { GtfsRtTripUpdate, GtfsRtVehiclePosition } from "~/gtfs/@types";

const proto = loadSync(join(import.meta.dirname, "gtfs-realtime.proto")).root.lookupType(
  "transit_realtime.FeedMessage"
);

export function encodePayload(payload: GtfsRtTripUpdate | GtfsRtVehiclePosition) {
  return proto.encode(payload).finish();
}
