import { setTimeout } from "node:timers/promises";
import { serve } from "@hono/node-server";
import GtfsRealtime from "gtfs-realtime-bindings";
import { Hono } from "hono";
import { Temporal } from "temporal-polyfill";

import { GTFS_RESOURCE_URL, PORT, REQUESTOR_REF, SIRI_ENDPOINT, SIRI_RATELIMIT } from "./config.js";
import type { Trip } from "./gtfs/import-resource.js";
import { useGtfsResource } from "./gtfs/load-resource.js";
import { handleRequest } from "./gtfs-rt/handle-request.js";
import { useRealtimeStore } from "./gtfs-rt/use-realtime-store.js";
import { fetchMonitoredLines } from "./siri/fetch-monitored-lines.js";
import { fetchMonitoredVehicles } from "./siri/fetch-monitored-vehicles.js";
import { extractSiriRef } from "./utils/extract-siri-ref.js";

console.log(` ,----.,--------.,------.,---.        ,------.,--------. ,--.   ,--.  ,---.   
'  .-./'--.  .--'|  .---'   .-',-----.|  .--. '--.  .--' |  |   \`--' /  O  \\  
|  | .---.|  |   |  \`--,\`.  \`-.'-----'|  '--'.'  |  |    |  |   ,--.|  .-.  | 
'  '--'  ||  |   |  |\`  .-'    |      |  |\\  \\   |  |    |  '--.|  ||  | |  | 
 \`------' \`--'   \`--'   \`-----'       \`--' '--'  \`--'    \`-----'\`--'\`--' \`--'`);

const store = useRealtimeStore();

const hono = new Hono();
hono.get("/trip-updates", (c) => handleRequest(c, "protobuf", store.tripUpdates, null));
hono.get("/trip-updates.json", (c) => handleRequest(c, "json", store.tripUpdates, null));
hono.get("/vehicle-positions", (c) => handleRequest(c, "protobuf", null, store.vehiclePositions));
hono.get("/vehicle-positions.json", (c) => handleRequest(c, "json", null, store.vehiclePositions));
hono.get("/", (c) =>
	handleRequest(c, c.req.query("format") === "json" ? "json" : "protobuf", store.tripUpdates, store.vehiclePositions),
);
serve({ fetch: hono.fetch, port: PORT });
console.log(`|> Listening on :${PORT}`);

const gtfsResource = await useGtfsResource(GTFS_RESOURCE_URL);

let monitoredLines = await fetchMonitoredLines(SIRI_ENDPOINT);
setInterval(
	async () => (monitoredLines = await fetchMonitoredLines(SIRI_ENDPOINT)),
	Temporal.Duration.from({ hours: 1 }).total("milliseconds"),
);

let idx = 0;
while (true) {
	if (idx >= monitoredLines.length) {
		idx = 0;
	}

	const startedAt = Date.now();
	const lineRef = monitoredLines[idx];
	const lineId = extractSiriRef(lineRef)[3];
	console.log(`|> Fetching vehicles for line '${lineId}'.`);

	const vehicles = await fetchMonitoredVehicles(SIRI_ENDPOINT, REQUESTOR_REF, lineRef);

	for (const vehicle of vehicles) {
		if (
			vehicle.MonitoredVehicleJourney.VehicleLocation === undefined ||
			vehicle.MonitoredVehicleJourney.MonitoredCall === undefined
		) {
			continue;
		}

		const isCommercial = vehicle.MonitoredVehicleJourney.MonitoredCall.DestinationDisplay !== "SANS VOYAGEURS";
		const directionId = vehicle.MonitoredVehicleJourney.DirectionName === "A" ? 0 : 1;
		const vehicleRef = extractSiriRef(vehicle.VehicleMonitoringRef)[3].padStart(3, "0");

		const monitoredCall = vehicle.MonitoredVehicleJourney.MonitoredCall;
		const monitoredCallStopId = extractSiriRef(monitoredCall.StopPointRef)[3];
		let trip: Trip | undefined;
		let exactMatch = true;

		const monitoredCallAimedArrival = Temporal.Instant.from(monitoredCall.AimedArrivalTime)
			.toZonedDateTimeISO("Europe/Paris")
			.toPlainTime();
		const monitoredCallAimedDeparture = Temporal.Instant.from(monitoredCall.AimedDepartureTime)
			.toZonedDateTimeISO("Europe/Paris")
			.toPlainTime();

		if (isCommercial) {
			const relevantTrips = gtfsResource.operatingTripsByLineDirection.get(`${lineId}:${directionId}`);

			trip = relevantTrips?.find((trip) =>
				trip.stopTimes.some(
					(stopTime) =>
						(stopTime.stop.id === monitoredCallStopId || stopTime.stop.name === monitoredCall.StopPointName) &&
						(stopTime.time.equals(monitoredCallAimedDeparture) || stopTime.time.equals(monitoredCallAimedArrival)),
				),
			);

			if (trip === undefined) {
				trip = relevantTrips
					?.toSorted((a, b) => {
						const aStopTime = a.stopTimes.find(({ stop }) => stop.id === monitoredCallStopId);
						if (aStopTime === undefined) return 1;

						const bStopTime = b.stopTimes.find(({ stop }) => stop.id === monitoredCallStopId);
						if (bStopTime === undefined) return -1;

						return Temporal.Duration.compare(
							monitoredCallAimedDeparture.since(aStopTime.time).abs(),
							monitoredCallAimedDeparture.since(bStopTime.time).abs(),
						);
					})
					.at(0);

				exactMatch = false;
			}
		}

		const [longitude, latitude] = vehicle.MonitoredVehicleJourney.VehicleLocation.Coordinates.split(" ").map(Number);

		const recordedAt = Temporal.Instant.from(vehicle.RecordedAtTime).toZonedDateTimeISO("Europe/Paris");

		const tripDescriptor = isCommercial
			? {
					tripId: trip?.id,
					routeId: lineId,
					directionId: directionId,
					scheduleRelationship: GtfsRealtime.transit_realtime.TripDescriptor.ScheduleRelationship.SCHEDULED,
				}
			: undefined;

		const vehicleDescriptor = {
			id: vehicleRef,
			label: vehicle.MonitoredVehicleJourney.MonitoredCall.DestinationDisplay,
		};

		const atStop = vehicle.MonitoredVehicleJourney.MonitoredCall.ActualDepartureTime === undefined;
		const atTerminus =
			vehicle.MonitoredVehicleJourney.MonitoredCall.Order > 1 &&
			vehicle.MonitoredVehicleJourney.MonitoredCall.StopPointRef === vehicle.MonitoredVehicleJourney.DestinationRef;

		const monitoredStopTimeIndex = trip?.stopTimes.findIndex(
			(stopTime) => stopTime.stop.id === monitoredCallStopId || stopTime.stop.name === monitoredCall.StopPointName,
		);
		const monitoredStopTime =
			monitoredStopTimeIndex !== undefined && monitoredStopTimeIndex >= 0
				? trip?.stopTimes[monitoredStopTimeIndex + (atStop || atTerminus ? 0 : 1)]
				: undefined;

		store.vehiclePositions.set(`VM:${vehicleRef}`, {
			position: { latitude, longitude, bearing: vehicle.MonitoredVehicleJourney.Bearing },
			timestamp: Math.floor(recordedAt.epochMilliseconds / 1000),
			trip: tripDescriptor,
			vehicle: vehicleDescriptor,
			...(monitoredStopTime
				? {
						currentStatus:
							atStop || atTerminus
								? GtfsRealtime.transit_realtime.VehiclePosition.VehicleStopStatus.STOPPED_AT
								: GtfsRealtime.transit_realtime.VehiclePosition.VehicleStopStatus.IN_TRANSIT_TO,
						currentStopSequence: monitoredStopTime.sequence,
						stopId: monitoredStopTime.stop.id,
					}
				: undefined),
		});

		if (
			trip !== undefined &&
			tripDescriptor !== undefined &&
			monitoredStopTimeIndex !== undefined &&
			monitoredStopTimeIndex >= 0
		) {
			const delay = Temporal.Instant.from(monitoredCall.ExpectedDepartureTime).since(monitoredCall.AimedDepartureTime);

			store.tripUpdates.set(`ET:${trip.id}`, {
				stopTimeUpdate: trip.stopTimes.slice(monitoredStopTimeIndex).map((stopTime, index, stopTimes) => {
					const event = {
						delay: delay.total("seconds"),
						time: Math.floor(
							recordedAt
								.withPlainTime(stopTime.time)
								.add(delay)
								.add({ days: recordedAt.hour > 20 && stopTime.time.hour < 12 ? 1 : 0 }).epochMilliseconds / 1000,
						),
					};

					return {
						arrival: index > 0 ? event : undefined,
						departure: index < stopTimes.length ? event : undefined,
						scheduleRelationship:
							GtfsRealtime.transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship.SCHEDULED,
						stopId: stopTime.stop.id,
						stopSequence: stopTime.sequence,
					};
				}),
				timestamp: Math.floor(recordedAt.epochMilliseconds / 1000),
				trip: tripDescriptor,
			});
		}

		console.log(
			` 	${vehicleRef}\t${lineId}\t${vehicle.MonitoredVehicleJourney.DirectionName} > ${extractSiriRef(vehicle.MonitoredVehicleJourney.DestinationRef)[3]} @ ${extractSiriRef(vehicle.MonitoredVehicleJourney.MonitoredCall.StopPointRef)[3]} ${trip ? (exactMatch ? "✓" : "~") : "✘"} (#${monitoredStopTime?.sequence ?? "?"} - atStop: ${atStop} - atTerminus: ${atTerminus})`,
		);
	}

	idx += 1;
	const waitingTime = Math.max(SIRI_RATELIMIT - (Date.now() - startedAt), 0);
	console.log(`✓ Done processing vehicle batch, waiting for ${waitingTime}ms`);
	await setTimeout(waitingTime);
}
