import { sleep } from "bun";
import dayjs from "dayjs";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { match } from "ts-pattern";

import {
  gtfsResourceHref,
  siriEndpoint,
  requestorRef,
  timeMatchingUncertainty,
  siriRatelimit,
  sweepThreshold,
  port,
} from "~/../config.json";

import type { TripUpdateEntity, VehiclePositionEntity } from "~/gtfs/@types";
import { downloadStaticResource } from "~/gtfs/download-resource";
import { encodePayload } from "~/gtfs/encode-payload";
import { wrapEntities } from "~/gtfs/wrap-entities";
import { fetchMonitoredLines } from "~/siri/fetch-monitored-lines";
import { fetchMonitoredVehicles } from "~/siri/fetch-monitored-vehicles";
import { checkCalendar } from "~/utils/check-calendar";
import { lambertToLatLong } from "~/utils/coordinates-converter";
import { parseSiriRef } from "~/utils/parse-ref";
import { parseTime } from "~/utils/parse-time";

const tripUpdates = new Map<string, TripUpdateEntity>();
const vehiclePositions = new Map<string, VehiclePositionEntity>();

const server = new Hono();
server.get("/trip-updates", (c) =>
  stream(c, async (stream) => {
    const payload = wrapEntities([...tripUpdates.values()]);
    const serialized = encodePayload(payload);
    await stream.write(serialized);
  })
);
server.get("/vehicle-positions", (c) =>
  stream(c, async (stream) => {
    const payload = wrapEntities([...vehiclePositions.values()]);
    const serialized = encodePayload(payload);
    await stream.write(serialized);
  })
);
server.get("/trip-updates.json", (c) => c.json(wrapEntities([...tripUpdates.values()])));
server.get("/vehicle-positions.json", (c) => c.json(wrapEntities([...vehiclePositions.values()])));
export default { fetch: server.fetch, port };

console.log("-- SIRI-VM TO GTFS --");

console.log("Loading GTFS resource into memory.");
let gtfsTrips = await downloadStaticResource(gtfsResourceHref);
let gtfsTime = dayjs();

console.log("Fetching monitored lines from SIRI service.");
let monitoredLines = await fetchMonitoredLines(siriEndpoint);
let monitoredLinesTime = dayjs();

let currentMonitoredLineIdx = 0;
let tryAgain = true;

async function fetchingLoop() {
  while (1) {
    await sleep(siriRatelimit * 1000);

    if (dayjs().diff(gtfsTime, "minutes") > 60) {
      console.log(`Updating GTFS resource in memory.`);
      try {
        gtfsTrips = await downloadStaticResource(gtfsResourceHref);
        gtfsTime = dayjs();
      } catch (e: unknown) {
        console.error(`Failed to update GTFS resource, using old one for now:`);
        console.error(e);
      }
    }

    if (dayjs().diff(monitoredLinesTime, "minutes") > 120) {
      console.log(`Updating monitored lines from SIRI service.`);
      try {
        monitoredLines = await fetchMonitoredLines(siriEndpoint);
        monitoredLinesTime = dayjs();
        await sleep(siriRatelimit * 1000);
      } catch (e: unknown) {
        console.error(`Failed to update monitored lines from SIRI service, using old one for now:`);
        console.error(e);
      }
    }

    if (currentMonitoredLineIdx > monitoredLines.length - 1) currentMonitoredLineIdx = 0;
    const monitoredLine = monitoredLines[currentMonitoredLineIdx];
    console.log(`Fetching monitored vehicles for line '${parseSiriRef(monitoredLine)}'.`);
    try {
      await fetchNextLine(monitoredLine);
      currentMonitoredLineIdx += 1;
      tryAgain = true;
    } catch (e: unknown) {
      console.error("Failed to fetch monitored vehicles, please see error below:");
      console.error(e);
      if (tryAgain) {
        console.warn("Will be retrying to fetch monitored vehicles for this line...");
        tryAgain = false;
      } else {
        console.warn("Skipping to the next line in the list.");
        currentMonitoredLineIdx += 1;
      }
    }
  }
}

fetchingLoop();
setTimeout(sweepEntries, 60_000);

// ---

async function fetchNextLine(lineRef: string) {
  if (gtfsTrips === null) return;

  const monitoredVehicles = (await fetchMonitoredVehicles(siriEndpoint, requestorRef, lineRef)).filter(
    (monitoredVehicle) =>
      monitoredVehicle.MonitoredVehicleJourney.Monitored &&
      typeof monitoredVehicle.MonitoredVehicleJourney.FramedVehicleJourneyRef?.DatedVehicleJourneyRef === "string" &&
      typeof monitoredVehicle.MonitoredVehicleJourney.LineRef === "string" &&
      typeof monitoredVehicle.MonitoredVehicleJourney.DirectionName === "string" &&
      typeof monitoredVehicle.MonitoredVehicleJourney.MonitoredCall !== "undefined" &&
      monitoredVehicle.MonitoredVehicleJourney.MonitoredCall.ArrivalStatus !== "noReport" &&
      monitoredVehicle.MonitoredVehicleJourney.MonitoredCall.DepartureStatus !== "noReport"
  );

  for (const monitoredVehicle of monitoredVehicles) {
    const vehicleRef = parseSiriRef(monitoredVehicle.VehicleMonitoringRef);
    const recordedAt = dayjs(monitoredVehicle.RecordedAtTime).unix();

    const routeId = parseSiriRef(monitoredVehicle.MonitoredVehicleJourney.LineRef);
    const directionId = match(monitoredVehicle.MonitoredVehicleJourney.DirectionName)
      .with("A", () => 0)
      .with("R", () => 1)
      .exhaustive();

    const monitoredCall = monitoredVehicle.MonitoredVehicleJourney.MonitoredCall!;
    let monitoredStopTimeIdx = -1;
    const guessedTrip = gtfsTrips.find(
      (trip) =>
        checkCalendar(trip.calendar) &&
        trip.route === routeId &&
        trip.direction === directionId &&
        trip.stops.at(-1)?.stop.id === parseSiriRef(monitoredVehicle.MonitoredVehicleJourney.DestinationRef) &&
        trip.stops.some((stopTime, index) => {
          const stopId = parseSiriRef(monitoredCall.StopPointRef);
          if (stopTime.sequence !== monitoredCall.Order && stopTime.stop.id !== stopId) return false;
          const aimedTime =
            monitoredCall.DepartureStatus !== "noReport"
              ? monitoredCall.AimedDepartureTime
              : monitoredCall.AimedArrivalTime;
          const delay = dayjs(aimedTime).diff(parseTime(stopTime.time), "seconds");
          if (Math.abs(delay) > timeMatchingUncertainty) return false;
          monitoredStopTimeIdx = index;
          return true;
        })
    );
    if (typeof guessedTrip === "undefined") {
      console.warn(`Failed to guess trip for vehicle '${vehicleRef}', skipping.`);
      continue;
    }

    const tripRef = guessedTrip.id;
    const expectedTime =
      monitoredCall.DepartureStatus !== "noReport"
        ? monitoredCall.ExpectedDepartureTime
        : monitoredCall.ExpectedArrivalTime;
    const atStop = monitoredCall.VehicleAtStop || (monitoredCall.Order === 1 && dayjs().isBefore(dayjs(expectedTime)));
    const nextStopTimes = guessedTrip.stops.slice(monitoredStopTimeIdx + (atStop ? 0 : 1));
    const delay = dayjs(expectedTime).diff(parseTime(guessedTrip.stops[monitoredStopTimeIdx].time), "seconds");

    tripUpdates.set(tripRef, {
      id: tripRef,
      tripUpdate: {
        stopTimeUpdate: nextStopTimes.map((stopTime) => ({
          stopId: stopTime.stop.id,
          stopSequence: stopTime.sequence,
          scheduleRelationship: "SCHEDULED",
          arrival: {
            delay,
            time: parseTime(stopTime.time).add(delay, "seconds").unix(),
          },
          departure: {
            delay,
            time: parseTime(stopTime.time).add(delay, "seconds").unix(),
          },
        })),
        timestamp: recordedAt,
        trip: {
          tripId: guessedTrip.id,
          routeId: guessedTrip.route,
          directionId: guessedTrip.direction,
        },
        vehicle: {
          id: vehicleRef,
          label: vehicleRef,
        },
      },
    });

    vehiclePositions.set(vehicleRef, {
      id: vehicleRef,
      vehicle: {
        bearing: monitoredVehicle.MonitoredVehicleJourney.Bearing,
        currentStatus: atStop ? "STOPPED_AT" : "IN_TRANSIT_TO",
        currentStopSequence: nextStopTimes[0].sequence,
        position: lambertToLatLong(monitoredVehicle.MonitoredVehicleJourney.VehicleLocation!.Coordinates),
        timestamp: recordedAt,
        trip: {
          tripId: guessedTrip.id,
          routeId: guessedTrip.route,
          directionId: guessedTrip.direction,
        },
        vehicle: {
          id: vehicleRef,
          label: vehicleRef,
        },
      },
    });
  }
}

function sweepEntries() {
  console.log("Sweeping old entries from trip updates and vehicle positions.");
  [...tripUpdates.values()]
    .filter((tripUpdate) => {
      const lastStop = tripUpdate.tripUpdate.stopTimeUpdate.at(-1);
      if (typeof lastStop === "undefined") {
        return dayjs().diff(dayjs.unix(tripUpdate.tripUpdate.timestamp), "seconds") > sweepThreshold;
      }
      if (lastStop.arrival.delay > 0) {
        return dayjs().diff(dayjs.unix(lastStop.arrival.time), "seconds") > sweepThreshold;
      }
      const theoricalTime = dayjs.unix(lastStop.arrival.time).subtract(lastStop.arrival.delay, "seconds");
      return dayjs().diff(theoricalTime, "seconds") > sweepThreshold;
    })
    .forEach((tripUpdate) => tripUpdates.delete(tripUpdate.id));
  [...vehiclePositions.values()]
    .filter((vehiclePosition) => {
      const associatedTrip = tripUpdates.get(vehiclePosition.vehicle.trip.tripId);
      if (dayjs().isBefore(dayjs.unix(associatedTrip?.tripUpdate.stopTimeUpdate.at(-1)?.arrival.time ?? 0)))
        return false;
      return dayjs().diff(dayjs.unix(vehiclePosition.vehicle.timestamp), "seconds") > sweepThreshold;
    })
    .forEach((vehiclePosition) => vehiclePositions.delete(vehiclePosition.id));
  setTimeout(sweepEntries, 60_000);
}
