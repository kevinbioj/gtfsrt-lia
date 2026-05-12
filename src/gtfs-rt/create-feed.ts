import GtfsRealtime from "gtfs-realtime-bindings";
import { Temporal } from "temporal-polyfill";

function dedupeTripUpdates(
	tripUpdates: Map<string, GtfsRealtime.transit_realtime.ITripUpdate>,
): { id: string; tripUpdate: GtfsRealtime.transit_realtime.ITripUpdate }[] {
	const byTripId = new Map<string, GtfsRealtime.transit_realtime.ITripUpdate>();
	for (const [id, tripUpdate] of tripUpdates) {
		if (!tripUpdate.stopTimeUpdate?.length) continue;
		if (!id.startsWith("ET:")) continue;
		const tripId = tripUpdate.trip?.tripId;
		if (!tripId) continue;
		byTripId.set(tripId, tripUpdate);
	}
	for (const [id, tripUpdate] of tripUpdates) {
		if (!tripUpdate.stopTimeUpdate?.length) continue;
		if (!id.startsWith("VM:")) continue;
		const tripId = tripUpdate.trip?.tripId;
		if (!tripId || byTripId.has(tripId)) continue;
		byTripId.set(tripId, tripUpdate);
	}
	return Array.from(byTripId, ([tripId, tripUpdate]) => ({ id: `ET:${tripId}`, tripUpdate }));
}

export function createFeed(
	tripUpdates: Map<string, GtfsRealtime.transit_realtime.ITripUpdate> | null,
	vehiclePositions: Map<string, GtfsRealtime.transit_realtime.IVehiclePosition> | null,
) {
	return GtfsRealtime.transit_realtime.FeedMessage.create({
		header: {
			gtfsRealtimeVersion: "2.0",
			incrementality: GtfsRealtime.transit_realtime.FeedHeader.Incrementality.FULL_DATASET,
			timestamp: Math.floor(Temporal.Now.instant().epochMilliseconds / 1000),
		},
		entity: [
			...(tripUpdates !== null ? dedupeTripUpdates(tripUpdates) : []),
			...(vehiclePositions !== null
				? vehiclePositions
						.entries()
						.map(([id, vehicle]) => ({ id, vehicle }))
						.toArray()
				: []),
		],
	});
}
