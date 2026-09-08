import GtfsRealtime from "gtfs-realtime-bindings";

export function createFeed(
	entities: GtfsRealtime.transit_realtime.IFeedEntity[],
	timestamp: number,
): GtfsRealtime.transit_realtime.FeedMessage {
	return GtfsRealtime.transit_realtime.FeedMessage.create({
		header: {
			gtfsRealtimeVersion: "2.0",
			incrementality: GtfsRealtime.transit_realtime.FeedHeader.Incrementality.FULL_DATASET,
			timestamp,
		},
		entity: entities,
	});
}
