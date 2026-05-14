import GtfsRealtime from "gtfs-realtime-bindings";
import { Temporal } from "temporal-polyfill";

import type { Trip } from "../gtfs/import-resource.js";
import type { useGtfsResource } from "../gtfs/load-resource.js";
import type { EstimatedCall, EstimatedVehicleJourney } from "../siri/estimated-vehicle-journey.js";
import { extractSiriId } from "../utils/extract-siri-ref.js";
import { toArray } from "../utils/to-array.js";

import type { useRealtimeStore } from "./use-realtime-store.js";

type GtfsLiveResource = Awaited<ReturnType<typeof useGtfsResource>>;
type RealtimeStore = ReturnType<typeof useRealtimeStore>;

function isCancelled(value: boolean | string | undefined): boolean {
	return value === true || value === "true";
}

function findTrip(
	journey: EstimatedVehicleJourney,
	gtfsResource: GtfsLiveResource,
): { trip: Trip; direct: boolean } | undefined {
	const saeivCourseId = extractSiriId(journey.FramedVehicleJourneyRef?.DatedVehicleJourneyRef);
	if (saeivCourseId) {
		const direct = gtfsResource.tripsBySaeivCourse.get(saeivCourseId);
		if (direct) return { trip: direct, direct: true };
	}

	const lineId = extractSiriId(journey.LineRef);
	const estimatedCalls = toArray(journey.EstimatedCalls?.EstimatedCall);
	const recordedCalls = toArray(journey.RecordedCalls?.RecordedCall);

	const originCall = recordedCalls[0] ?? estimatedCalls[0];
	if (!originCall) return undefined;

	const originAimed = originCall.AimedDepartureTime ?? originCall.AimedArrivalTime;
	if (!originAimed) return undefined;

	const originStopId = extractSiriId(originCall.StopPointRef);
	const originAimedTime = Temporal.Instant.from(originAimed).toZonedDateTimeISO("Europe/Paris").toPlainTime();

	const candidates: Trip[] = [
		...(gtfsResource.operatingTripsByLineDirection.get(`${lineId}:0`) ?? []),
		...(gtfsResource.operatingTripsByLineDirection.get(`${lineId}:1`) ?? []),
	];

	const exact = candidates.find(
		(trip) => trip.stopTimes[0]?.stop.id === originStopId && trip.stopTimes[0]?.time.equals(originAimedTime),
	);
	if (exact) return { trip: exact, direct: false };

	const fallback = candidates
		.filter((trip) => trip.stopTimes[0]?.stop.id === originStopId)
		.toSorted((a, b) =>
			Temporal.Duration.compare(
				originAimedTime.since(a.stopTimes[0].time).abs(),
				originAimedTime.since(b.stopTimes[0].time).abs(),
			),
		)
		.at(0);

	return fallback ? { trip: fallback, direct: false } : undefined;
}

function epochSeconds(iso: string): number {
	return Math.floor(Temporal.Instant.from(iso).epochMilliseconds / 1000);
}

function delaySeconds(expected: string | undefined, aimed: string | undefined): number {
	if (!expected || !aimed) return 0;
	return Temporal.Instant.from(expected).since(Temporal.Instant.from(aimed)).total("seconds");
}

export function processEstimatedJourney(
	journey: EstimatedVehicleJourney,
	gtfsResource: GtfsLiveResource,
	store: RealtimeStore,
): void {
	const match = findTrip(journey, gtfsResource);
	if (!match) return;
	const { trip, direct: directMatch } = match;

	const lineId = extractSiriId(journey.LineRef);
	const callsByStopId = new Map<string, EstimatedCall>();
	for (const call of toArray(journey.EstimatedCalls?.EstimatedCall)) {
		callsByStopId.set(extractSiriId(call.StopPointRef), call);
	}

	const recordedStopIds = new Set<string>();
	for (const call of toArray(journey.RecordedCalls?.RecordedCall)) {
		recordedStopIds.add(extractSiriId(call.StopPointRef));
	}

	const journeyCancelled = isCancelled(journey.Cancellation);

	const stopTimeUpdates: GtfsRealtime.transit_realtime.TripUpdate.IStopTimeUpdate[] = [];

	for (let index = 0; index < trip.stopTimes.length; index += 1) {
		const stopTime = trip.stopTimes[index];
		if (recordedStopIds.has(stopTime.stop.id)) continue;

		const call = callsByStopId.get(stopTime.stop.id);
		if (!call) continue;

		const stopCancelled =
			isCancelled(call.Cancellation) || call.ArrivalStatus === "cancelled" || call.DepartureStatus === "cancelled";

		if (stopCancelled) {
			stopTimeUpdates.push({
				stopId: stopTime.stop.id,
				stopSequence: stopTime.sequence,
				scheduleRelationship: GtfsRealtime.transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship.SKIPPED,
			});
			continue;
		}

		const arrivalRef = call.ExpectedArrivalTime ?? call.AimedArrivalTime;
		const departureRef = call.ExpectedDepartureTime ?? call.AimedDepartureTime;

		const arrival = arrivalRef
			? { time: epochSeconds(arrivalRef), delay: delaySeconds(call.ExpectedArrivalTime, call.AimedArrivalTime) }
			: undefined;
		const departure = departureRef
			? { time: epochSeconds(departureRef), delay: delaySeconds(call.ExpectedDepartureTime, call.AimedDepartureTime) }
			: undefined;

		if (!arrival && !departure) continue;

		stopTimeUpdates.push({
			stopId: stopTime.stop.id,
			stopSequence: stopTime.sequence,
			arrival,
			departure,
			scheduleRelationship: GtfsRealtime.transit_realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship.SCHEDULED,
		});
	}

	const tripDescriptor: GtfsRealtime.transit_realtime.ITripDescriptor = {
		tripId: trip.id,
		routeId: lineId,
		directionId: trip.directionId,
		scheduleRelationship: journeyCancelled
			? GtfsRealtime.transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED
			: GtfsRealtime.transit_realtime.TripDescriptor.ScheduleRelationship.SCHEDULED,
	};

	const recordedAt = journey.RecordedAtTime ? Temporal.Instant.from(journey.RecordedAtTime) : Temporal.Now.instant();

	store.tripUpdates.set(`ET:${trip.id}`, {
		stopTimeUpdate: journeyCancelled ? [] : stopTimeUpdates,
		timestamp: Math.floor(recordedAt.epochMilliseconds / 1000),
		trip: tripDescriptor,
	});

	console.log(
		` 	ET\t${lineId}\t${trip.id} ${directMatch ? "=" : "✓"}\t${stopTimeUpdates.length} stop(s)${journeyCancelled ? " [CANCELED]" : ""}`,
	);
}
