import dayjs from "dayjs";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { match } from "ts-pattern";
import { setTimeout as sleep } from "node:timers/promises";

import { gtfsResourceHref, siriEndpoint, requestorRef, siriRatelimit, sweepThreshold, port } from "~/../config.json";

import type { StopTime, Trip, TripUpdateEntity, VehiclePositionEntity } from "~/gtfs/@types";
import { downloadStaticResource } from "~/gtfs/download-resource";
import { encodePayload } from "~/gtfs/encode-payload";
import { wrapEntities } from "~/gtfs/wrap-entities";
import { fetchMonitoredLines } from "~/siri/fetch-monitored-lines";
import { fetchMonitoredVehicles } from "~/siri/fetch-monitored-vehicles";
import { checkCalendar } from "~/utils/check-calendar";
import { lambertToLatLong } from "~/utils/coordinates-converter";
import { parseSiriRef } from "~/utils/parse-ref";
import { parseTime } from "~/utils/parse-time";
import { serve } from "@hono/node-server";

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

console.log("-- SIRI-VM TO GTFS --");

console.log("Loading GTFS resource into memory.");
let gtfsTrips = await downloadStaticResource(gtfsResourceHref);
let gtfsTime = dayjs();
let relevantLines = gtfsTrips.reduce((lines, trip) => {
  lines.add(trip.route);
  return lines;
}, new Set<string>());

console.log("Fetching monitored lines from SIRI service.");
let monitoredLines = (await fetchMonitoredLines(siriEndpoint)).filter((line) => relevantLines.has(parseSiriRef(line)));
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
        relevantLines = gtfsTrips.reduce((lines, trip) => {
          lines.add(trip.route);
          return lines;
        }, new Set<string>());
      } catch (e: unknown) {
        console.error(`Failed to update GTFS resource, using old one for now:`);
        console.error(e);
      }
    }

    if (dayjs().diff(monitoredLinesTime, "minutes") > 120) {
      console.log(`Updating monitored lines from SIRI service.`);
      try {
        monitoredLines = (await fetchMonitoredLines(siriEndpoint)).filter((line) =>
          relevantLines.has(parseSiriRef(line))
        );
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
      // monitoredVehicle.MonitoredVehicleJourney.Monitored &&
      typeof monitoredVehicle.MonitoredVehicleJourney.FramedVehicleJourneyRef?.DatedVehicleJourneyRef === "string" &&
      typeof monitoredVehicle.MonitoredVehicleJourney.LineRef === "string" &&
      typeof monitoredVehicle.MonitoredVehicleJourney.DirectionName === "string" &&
      typeof monitoredVehicle.MonitoredVehicleJourney.MonitoredCall !== "undefined" &&
      monitoredVehicle.MonitoredVehicleJourney.MonitoredCall.ArrivalStatus !== "noReport" &&
      monitoredVehicle.MonitoredVehicleJourney.MonitoredCall.DepartureStatus !== "noReport" &&
      monitoredVehicle.MonitoredVehicleJourney.MonitoredCall.DestinationDisplay !== "SANS VOYAGEUR"
  );

  const guessableTrips = gtfsTrips.filter(
    (trip) => checkCalendar(trip.calendar) && trip.route === parseSiriRef(lineRef)
  );
  const processedTrips = new Set<string>();

  for (const monitoredVehicle of monitoredVehicles) {
    const vehicleRef = parseSiriRef(monitoredVehicle.VehicleMonitoringRef).padStart(3, "0");
    const recordedAt = dayjs(monitoredVehicle.RecordedAtTime).unix();

    let guessedTrip: Trip | undefined = undefined;
    let atStop: boolean | undefined = undefined;
    let nextStopTimes: StopTime[] | undefined = undefined;

    if (monitoredVehicle.MonitoredVehicleJourney.MonitoredCall?.DestinationDisplay !== "SANS VOYAGEUR") {
      const directionId = match(monitoredVehicle.MonitoredVehicleJourney.DirectionName)
        .with("A", () => 0)
        .with("R", () => 1)
        .exhaustive();

      const monitoredCall = monitoredVehicle.MonitoredVehicleJourney.MonitoredCall!;
      const referenceTime = dayjs(
        monitoredCall.DepartureStatus === "noReport" ? monitoredCall.AimedDepartureTime : monitoredCall.AimedArrivalTime
      );

      const findStopTime = (s: StopTime) =>
        s.stop.id === parseSiriRef(monitoredCall.StopPointRef) || monitoredCall.StopPointName.includes(s.stop.name);

      guessedTrip = guessableTrips
        .filter(
          (trip) =>
            // !processedTrips.has(trip.id) && // Until bug is fixed
            trip.direction === directionId &&
            (trip.stops.at(-1)?.stop.id === parseSiriRef(monitoredVehicle.MonitoredVehicleJourney.DestinationRef) ||
              monitoredVehicle.MonitoredVehicleJourney.DestinationName.includes(trip.stops.at(-1)?.stop.name ?? "")) &&
            trip.stops.some(
              (s) =>
                s.stop.id === parseSiriRef(monitoredCall.StopPointRef) ||
                monitoredCall.StopPointName.includes(s.stop.name)
            )
        )
        .sort((a, b) => {
          const aStopTime = parseTime(a.stops.find(findStopTime)!.time);
          const bStopTime = parseTime(b.stops.find(findStopTime)!.time);
          return Math.abs(referenceTime.diff(aStopTime)) - Math.abs(referenceTime.diff(bStopTime));
        })
        .at(0);
      if (
        typeof guessedTrip === "undefined" ||
        referenceTime.diff(guessedTrip.stops.find(findStopTime)?.time, "seconds") > 120
      ) {
        console.warn(`Failed to guess trip for vehicle '${vehicleRef}', skipping.`);
        continue;
      }

      processedTrips.add(guessedTrip.id);
      const monitoredStopTimeIdx = guessedTrip.stops.findIndex(
        (s) => s.stop.id === parseSiriRef(monitoredCall.StopPointRef) || s.stop.name === monitoredCall.StopPointName
      );

      const tripRef = guessedTrip.id;
      const expectedTime =
        monitoredCall.DepartureStatus !== "noReport"
          ? monitoredCall.ExpectedDepartureTime
          : monitoredCall.ExpectedArrivalTime;
      atStop = monitoredCall.VehicleAtStop || dayjs().isBefore(dayjs(expectedTime));
      nextStopTimes = guessedTrip.stops.slice(monitoredStopTimeIdx + (atStop ? 0 : 1));
      const delay = dayjs(expectedTime).diff(parseTime(guessedTrip.stops[monitoredStopTimeIdx].time), "seconds");

      tripUpdates.set(tripRef, {
        id: `SM:${tripRef}`,
        tripUpdate: {
          stopTimeUpdate: nextStopTimes.map((stopTime) => ({
            arrival: {
              delay,
              time: parseTime(stopTime.time).add(delay, "seconds").unix(),
            },
            departure: {
              delay,
              time: parseTime(stopTime.time).add(delay, "seconds").unix(),
            },
            stopId: stopTime.stop.id,
            stopSequence: stopTime.sequence,
            scheduleRelationship: "SCHEDULED",
          })),
          timestamp: recordedAt,
          trip: {
            routeId: guessedTrip.route,
            directionId: guessedTrip.direction,
            tripId: guessedTrip.id,
            scheduleRelationship: "SCHEDULED",
          },
          vehicle: {
            id: vehicleRef,
            label: vehicleRef,
          },
        },
      });
    }

    vehiclePositions.set(vehicleRef, {
      id: `VM:${vehicleRef}`,
      vehicle: {
        currentStatus: typeof atStop === "boolean" ? (atStop ? "STOPPED_AT" : "IN_TRANSIT_TO") : undefined,
        currentStopSequence: nextStopTimes?.[0].sequence,
        position: {
          ...lambertToLatLong(monitoredVehicle.MonitoredVehicleJourney.VehicleLocation!.Coordinates),
          bearing: monitoredVehicle.MonitoredVehicleJourney.Bearing,
        },
        stopId: nextStopTimes?.[0].stop.id,
        timestamp: recordedAt,
        trip: guessedTrip
          ? {
              routeId: guessedTrip.route,
              directionId: guessedTrip.direction,
              tripId: guessedTrip.id,
              scheduleRelationship: "SCHEDULED",
            }
          : undefined,
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
      if (vehiclePosition.vehicle.trip) {
        const associatedTrip = tripUpdates.get(vehiclePosition.vehicle.trip.tripId);
        if (dayjs().isBefore(dayjs.unix(associatedTrip?.tripUpdate.stopTimeUpdate.at(-1)?.arrival.time ?? 0)))
          return false;
      }
      return dayjs().diff(dayjs.unix(vehiclePosition.vehicle.timestamp), "seconds") > sweepThreshold;
    })
    .forEach((vehiclePosition) => vehiclePositions.delete(vehiclePosition.id));
  setTimeout(sweepEntries, 60_000);
}

serve({ fetch: server.fetch, port });
