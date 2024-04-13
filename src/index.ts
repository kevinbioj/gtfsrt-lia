import Cron from "croner";
import dayjs from "dayjs";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { P, match } from "ts-pattern";
import type { Trip, TripUpdateEntity, VehiclePositionEntity } from "~/gtfs/@types";
import { downloadStaticResource } from "~/gtfs/download-resource";
import { encodePayload } from "~/gtfs/encode-payload";
import { wrapEntities } from "~/gtfs/wrap-entities";
import type { SiriVehicleActivity } from "~/siri/@types";
import { computeSiriEntries } from "~/siri/compute-entries";
import { checkCalendar } from "~/utils/check-calendar";
import { lambertToLatLong } from "~/utils/coordinates-converter";
import { parseDelay } from "~/utils/parse-delay";
import { parseSiriRef } from "~/utils/parse-ref";

import { parseTime } from "~/utils/parse-time";

const server = new Hono();

const gtfsHref = "https://www.data.gouv.fr/fr/datasets/r/1e666e24-58ee-46b9-8952-ea2755ba88f2";
const siriWsdl = "https://opendata.siri.transports-lia.fr/api?wsdl";

const onlineLineRefs = [
  "LIAOD:Line::T:LOC",
  "LIAOD:Line::01:LOC",
  "LIAOD:Line::C2:LOC",
  "LIAOD:Line::03:LOC",
  "LIAOD:Line::04:LOC",
  "LIAOD:Line::05:LOC",
  "LIAOD:Line::06:LOC",
  "LIAOD:Line::07:LOC",
  "LIAOD:Line::08:LOC",
  "LIAOD:Line::09:LOC",
  "LIAOD:Line::10:LOC",
  "LIAOD:Line::11:LOC",
  "LIAOD:Line::12:LOC",
  "LIAOD:Line::13:LOC",
  "LIAOD:Line::14:LOC",
  "LIAOD:Line::15:LOC",
  "LIAOD:Line::16:LOC",
  "LIAOD:Line::17:LOC",
  "LIAOD:Line::18:LOC",
  "LIAOD:Line::19:LOC",
  "LIAOD:Line::21:LOC",
  "LIAOD:Line::22:LOC",
  "LIAOD:Line::30:LOC",
  "LIAOD:Line::31:LOC",
  "LIAOD:Line::40:LOC",
  "LIAOD:Line::41:LOC",
  "LIAOD:Line::50:LOC",
  "LIAOD:Line::60:LOC",
  "LIAOD:Line::70:LOC",
  "LIAOD:Line::71:LOC",
  "LIAOD:Line::80:LOC",
  "LIAOD:Line::90:LOC",
  "LIAOD:Line::91:LOC",
];
let currentLineRefIndex = 0;

const siriEntries = new Map<string, SiriVehicleActivity[]>();
let trips: Trip[] | null = null;

let currentVehiclePositions: VehiclePositionEntity[] = [];
let currentTripUpdates: TripUpdateEntity[] = [];

//- DOWNLOAD SIRI VEHICLES

async function downloadNextSiriEntries() {
  const lineRef = onlineLineRefs[currentLineRefIndex];
  const vehicles = await computeSiriEntries(siriWsdl, lineRef);
  if (vehicles !== null) {
    console.log(`SIRI   Downloaded ${vehicles.length} vehicles for line '${lineRef}'.`);
    siriEntries.set(lineRef, vehicles);
  } else {
    console.warn(`SIRI  Failed to download vehicles for line '${lineRef}'.`);
  }
  currentLineRefIndex =
    currentLineRefIndex + 1 > onlineLineRefs.length - 1 ? 0 : currentLineRefIndex + 1;
  setTimeout(downloadNextSiriEntries, 3000);
}

//- UPDATE GTFS RESOURCE

async function updateGtfsResource() {
  console.log("GTFS     Updating GTFS resource...");
  try {
    const updatedTrips = await downloadStaticResource(gtfsHref);
    trips = updatedTrips;
    console.log("GTFS     Finished updating GTFS resource!");
  } catch (e: unknown) {
    const stack = e instanceof Error ? e.stack : e;
    console.error("GTFS     Failed to update resource, check out stack trace below:");
    console.error(stack);
  }
}

Cron("0 0 * * * *", updateGtfsResource);

//- UPDATE GTFS-RT ENTRIES

async function updateGtfsRtEntries() {
  if (trips === null) return console.error("GTFS-RT  Resource is not ready, skipping.");

  const processedVehicles: string[] = [];
  const vehiclePositions: VehiclePositionEntity[] = [];
  const tripUpdates: TripUpdateEntity[] = [];
  console.log("GTFS-RT  Processing vehicles to build up GTFS-RT...");
  [...siriEntries.values()]
    .flat()
    .sort((a, b) => +b.ProgressBetweenStops.Percentage - +a.ProgressBetweenStops.Percentage)
    .forEach((vehicle) => {
      if (typeof vehicle === "undefined" || typeof vehicle.MonitoredVehicleJourney === "undefined")
        return;

      const vehicleJourney = vehicle.MonitoredVehicleJourney;
      const id = parseSiriRef(vehicleJourney.VehicleRef);

      if (processedVehicles.includes(id)) return;

      if (typeof vehicleJourney.LineRef === "undefined" || !vehicleJourney.Monitored)
        return console.warn(`GTFS-RT  Vehicle '${id}' is not monitored or has no declared line.`);

      const lineId = parseSiriRef(vehicleJourney.LineRef);
      if (typeof vehicleJourney.MonitoredCall === "undefined")
        return console.warn(`GTFS-RT  Vehicle '${id}' (line '${lineId}') has no monitored call.`);
      if (typeof vehicleJourney.VehicleLocation === "undefined")
        return console.warn(`GTFS-RT  Vehicle '${id}' (line '${lineId}') has no position.`);

      const monitoredCall = vehicleJourney.MonitoredCall;
      const vehicleLocation = vehicleJourney.VehicleLocation;

      const compatibleTrips =
        trips?.filter((t) => {
          if (t.route !== parseSiriRef(vehicleJourney.LineRef)) return false;
          const lastStop = t.stops.at(-1)?.stop;
          if (typeof lastStop === "undefined") return false;
          if (
            lastStop.id !== parseSiriRef(vehicleJourney.DestinationRef) &&
            lastStop.name !== vehicleJourney.DestinationName
          )
            return false;

          if (!checkCalendar(t.calendar)) return false;
          return t.stops.some(
            (s) =>
              (s.stop.id === parseSiriRef(monitoredCall.StopPointRef) ||
                s.stop.name === monitoredCall.StopPointName ||
                s.sequence === monitoredCall.Order) &&
              Math.abs(
                dayjs(monitoredCall.AimedDepartureTime).diff(parseTime(s.time), "seconds")
              ) <= 60
          );
        }) ?? [];

      if (compatibleTrips.length === 0)
        return console.warn(`GTFS-RT  No trip found for vehicle '${id}' (line '${lineId}') .`);
      if (compatibleTrips.length > 1) {
        console.warn(
          `GTFS-RT   ${compatibleTrips.length} trips for vehicle '${id}' (line '${lineId}') .`
        );
        console.warn(`GTFS-RT   Trips are: ${compatibleTrips.map((t) => t.id).join(" - ")}`);
        return;
      }

      const [trip] = compatibleTrips;

      const monitoredStopTimeIndex = trip.stops.findIndex(
        (s) =>
          (s.stop.id === parseSiriRef(monitoredCall.StopPointRef) ||
            s.stop.name === monitoredCall.StopPointName ||
            s.sequence === monitoredCall.Order) &&
          Math.abs(dayjs(monitoredCall.AimedDepartureTime).diff(parseTime(s.time), "seconds")) < 30
      )!;
      const atStop =
        monitoredCall.VehicleAtStop ||
        (monitoredCall.Order === 1 && dayjs().isBefore(dayjs(monitoredCall.ExpectedDepartureTime)));
      const currentStopTime =
        trip.stops[atStop ? monitoredStopTimeIndex : monitoredStopTimeIndex + 1];
      const delay = parseDelay(vehicleJourney.Delay);

      const [x, y] = vehicleLocation.Coordinates.split(" ").map(Number);
      const [latitude, longitude] = lambertToLatLong(x, y);

      // Tramway - on renvoie la ligne A ou B selon le couple départ-terminus
      const route =
        trip.route !== "T"
          ? trip.route
          : match([trip.stops.at(0)!.stop.name, trip.stops.at(-1)!.stop.name])
              .with(
                P.union(
                  ["La Plage", "Grand Hameau"],
                  ["Rond-Point", "Grand Hameau"],
                  ["Grand Hameau", "Rond-Point"],
                  ["Grand Hameau", "La Plage"]
                ),
                () => "A"
              )
              .with(
                P.union(
                  ["La Plage", "Pré Fleuri"],
                  ["Pré Fleuri", "La Plage"],
                  ["Rond-Point", "La Plage"],
                  ["Pré Fleuri", "Rond-Point"]
                ),
                () => "B"
              )
              .otherwise(() => "T");

      tripUpdates.push({
        id: `SM:${trip.id}`,
        tripUpdate: {
          stopTimeUpdate: currentStopTime
            ? trip.stops
                .filter((s) => s.sequence >= currentStopTime.sequence)
                .map((stopTime) => {
                  const expectedTime = parseTime(stopTime.time)
                    .add(delay, "seconds")
                    .unix()
                    .toString();
                  return {
                    scheduleRelationship: "SCHEDULED" as const,
                    arrival: {
                      delay,
                      time: expectedTime,
                    },
                    departure: {
                      delay,
                      time: expectedTime,
                    },
                    stopId: stopTime.stop.id,
                    stopSequence: stopTime.sequence,
                  };
                })
            : [],
          timestamp: dayjs(vehicle.RecordedAtTime).unix().toString(),
          trip: {
            tripId: trip.id,
            routeId: route,
            directionId: trip.direction,
          },
          vehicle: {
            id,
            label: id,
          },
        },
      });

      vehiclePositions.push({
        id: `VM:${id}`,
        vehicle: {
          bearing: +vehicleJourney.Bearing,
          currentStatus:
            atStop || typeof currentStopTime === "undefined" ? "STOPPED_AT" : "IN_TRANSIT_TO",
          currentStopSequence: currentStopTime?.sequence ?? trip.stops.at(-1)!.sequence,
          position: {
            latitude,
            longitude,
          },
          timestamp: dayjs(vehicle.RecordedAtTime).unix().toString(),
          trip: {
            tripId: trip.id,
            routeId: route,
            directionId: trip.direction,
          },
          vehicle: {
            id,
            label: id,
          },
        },
      });

      processedVehicles.push(id);
    });
  currentTripUpdates = tripUpdates.sort((a, b) => a.id.localeCompare(b.id));
  currentVehiclePositions = vehiclePositions.sort(
    (a, b) => +a.vehicle.vehicle.id - +b.vehicle.vehicle.id
  );
  console.log("GTFS-RT  Updated trip updates and vehicle positions!");
}

updateGtfsResource().then(async () => {
  console.log("Initialization done! Starting fetching data.");
  await downloadNextSiriEntries();
  await updateGtfsRtEntries();
  Cron("0,10,20,30,40,50 * * * * *", updateGtfsRtEntries);
});

server.get("/gtfs-rt/trip-updates.json", (c) => c.json(wrapEntities(currentTripUpdates)));
server.get("/gtfs-rt/vehicle-positions.json", (c) => c.json(wrapEntities(currentVehiclePositions)));

server.get("/gtfs-rt/trip-updates", (c) => {
  const payload = wrapEntities(currentTripUpdates);
  const encoded = encodePayload(payload);
  c.status(200);
  c.header("Content-Type", "application/x-protobuf");
  return stream(c, async (stream) => {
    await stream.write(encoded);
  });
});
server.get("/gtfs-rt/vehicle-positions", (c) => {
  const payload = wrapEntities(currentVehiclePositions);
  const encoded = encodePayload(payload);
  c.status(200);
  c.header("Content-Type", "application/x-protobuf");
  return stream(c, async (stream) => {
    await stream.write(encoded);
  });
});

export default {
  fetch: server.fetch,
  port: 40404,
};
