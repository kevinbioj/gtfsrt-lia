import GtfsRealtime from "gtfs-realtime-bindings";
import { Temporal } from "temporal-polyfill";
import type { Trip } from "../gtfs/import-resource.js";
import type { useGtfsResource } from "../gtfs/load-resource.js";
import type { VehicleActivity } from "../siri/fetch-monitored-vehicles.js";
import { extractSiriRef } from "../utils/extract-siri-ref.js";

import type { useRealtimeStore } from "./use-realtime-store.js";

type GtfsLiveResource = Awaited<ReturnType<typeof useGtfsResource>>;
type RealtimeStore = ReturnType<typeof useRealtimeStore>;

export function processVehicleActivity(
	vehicle: VehicleActivity,
	gtfsResource: GtfsLiveResource,
	store: RealtimeStore,
): void {
	if (
		vehicle.MonitoredVehicleJourney.VehicleLocation === undefined ||
		vehicle.MonitoredVehicleJourney.MonitoredCall === undefined
	) {
		return;
	}

	const lineId = extractSiriRef(vehicle.MonitoredVehicleJourney.LineRef)[3];
	const isCommercial = vehicle.MonitoredVehicleJourney.MonitoredCall.DestinationDisplay !== "SANS VOYAGEURS";
	const directionId = vehicle.MonitoredVehicleJourney.DirectionName === "A" ? 0 : 1;
	const vehicleRef = extractSiriRef(vehicle.VehicleMonitoringRef)[3].padStart(3, "0");

	const monitoredCall = vehicle.MonitoredVehicleJourney.MonitoredCall;
	const monitoredCallStopId = extractSiriRef(monitoredCall.StopPointRef)[3];
	let trip: Trip | undefined;
	let exactMatch = true;
	let directMatch = false;

	const monitoredCallAimedArrival = Temporal.Instant.from(monitoredCall.AimedArrivalTime)
		.toZonedDateTimeISO("Europe/Paris")
		.toPlainTime();
	const monitoredCallAimedDeparture = Temporal.Instant.from(monitoredCall.AimedDepartureTime)
		.toZonedDateTimeISO("Europe/Paris")
		.toPlainTime();

	const saeivCourseId = extractSiriRef(
		vehicle.MonitoredVehicleJourney.FramedVehicleJourneyRef?.DatedVehicleJourneyRef,
	)[3];
	if (saeivCourseId) {
		trip = gtfsResource.tripsBySaeivCourse.get(saeivCourseId);
		if (trip) directMatch = true;
	}

	if (isCommercial && trip === undefined) {
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

	if (trip && isCommercial && monitoredStopTimeIndex !== undefined && monitoredStopTimeIndex >= 0 && tripDescriptor) {
		const arrivalDelay = Math.floor(
			Temporal.Instant.from(monitoredCall.ExpectedArrivalTime)
				.since(Temporal.Instant.from(monitoredCall.AimedArrivalTime))
				.total("seconds"),
		);
		const departureDelay = Math.floor(
			Temporal.Instant.from(monitoredCall.ExpectedDepartureTime)
				.since(Temporal.Instant.from(monitoredCall.AimedDepartureTime))
				.total("seconds"),
		);

		const propagateFromIndex = monitoredStopTimeIndex + (atStop || atTerminus ? 0 : 1);
		const stopTimeUpdates: GtfsRealtime.transit_realtime.TripUpdate.IStopTimeUpdate[] = [];
		for (let index = propagateFromIndex; index < trip.stopTimes.length; index += 1) {
			const stopTime = trip.stopTimes[index];
			stopTimeUpdates.push({
				stopId: stopTime.stop.id,
				stopSequence: stopTime.sequence,
				arrival: { delay: arrivalDelay },
				departure: { delay: departureDelay },
				scheduleRelationship: GtfsRealtime.transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship.SCHEDULED,
			});
		}

		store.tripUpdates.set(`VM:${trip.id}`, {
			stopTimeUpdate: stopTimeUpdates,
			timestamp: Math.floor(recordedAt.epochMilliseconds / 1000),
			trip: tripDescriptor,
		});
	}

	console.log(
		` 	${vehicleRef}\t${lineId}\t${vehicle.MonitoredVehicleJourney.DirectionName} > ${extractSiriRef(vehicle.MonitoredVehicleJourney.DestinationRef)[3]} @ ${extractSiriRef(vehicle.MonitoredVehicleJourney.MonitoredCall.StopPointRef)[3]} ${trip ? (directMatch ? "=" : exactMatch ? "✓" : "~") : "✘"} (#${monitoredStopTime?.sequence ?? "?"} - atStop: ${atStop} - atTerminus: ${atTerminus})`,
	);
}
