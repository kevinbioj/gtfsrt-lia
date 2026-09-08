import GtfsRealtime from "gtfs-realtime-bindings";

import { POLL_INTERVAL_MS, TRIP_UPDATES_URL, VEHICLE_POSITIONS_URL } from "../config.js";
import type { GtfsResourceHolder } from "../gtfs/load-resource.js";

import { useVehicleLocator } from "./locate-vehicle.js";

export type RealtimeStore = ReturnType<typeof useUpstreamFeeds>;

async function fetchFeed(url: string) {
	const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });

	if (!response.ok) {
		throw new Error(`Failed to fetch feed at '${url}' (HTTP ${response.status})`);
	}

	return GtfsRealtime.transit_realtime.FeedMessage.decode(new Uint8Array(await response.arrayBuffer()));
}

/** Les identifiants véhicule de LiA ne sont pas normalisés : "3" et "003" désignent le même bus. */
function padVehicleId(vehicleId: string) {
	return vehicleId.padStart(3, "0");
}

/** L'amont préfixe ses identifiants de ligne par un code réseau ("7-A") absent du GTFS ("A"). */
function normalizeTrip(trip: GtfsRealtime.transit_realtime.ITripDescriptor | null | undefined) {
	if (trip?.routeId) trip.routeId = trip.routeId.replace(/^\d+-/, "");
}

export function useUpstreamFeeds(gtfsResource: GtfsResourceHolder) {
	const store = {
		tripUpdates: [] as GtfsRealtime.transit_realtime.IFeedEntity[],
		tripUpdatesTimestamp: 0,
		vehiclePositions: [] as GtfsRealtime.transit_realtime.IFeedEntity[],
		vehiclePositionsTimestamp: 0,
	};

	const { locateVehicle, sweepVehicleStates } = useVehicleLocator();

	async function pollTripUpdates() {
		const feed = await fetchFeed(TRIP_UPDATES_URL);

		for (const entity of feed.entity) {
			entity.id = `ET:${entity.tripUpdate?.trip.tripId}`;
			normalizeTrip(entity.tripUpdate?.trip);
		}

		store.tripUpdates = feed.entity;
		store.tripUpdatesTimestamp = Number(feed.header.timestamp ?? 0);
	}

	async function pollVehiclePositions() {
		const feed = await fetchFeed(VEHICLE_POSITIONS_URL);

		for (const entity of feed.entity) {
			const vehicle = entity.vehicle;
			if (!vehicle?.vehicle?.id) continue;

			vehicle.vehicle.id = padVehicleId(vehicle.vehicle.id);
			entity.id = `VM:${padVehicleId(entity.id)}`;
			delete vehicle.vehicle.label;

			normalizeTrip(vehicle.trip);

			if (vehicle.position) {
				vehicle.position.latitude = +vehicle.position.latitude.toFixed(4);
				vehicle.position.longitude = +vehicle.position.longitude.toFixed(4);

				if (vehicle.position.speed) {
					vehicle.position.speed = +(vehicle.position.speed / 3.6).toFixed(0);
				}
			}

			locateVehicle(vehicle, gtfsResource.gtfs);
		}

		sweepVehicleStates();

		store.vehiclePositions = feed.entity;
		store.vehiclePositionsTimestamp = Number(feed.header.timestamp ?? 0);
	}

	async function poll() {
		const startedAt = Date.now();

		const results = await Promise.allSettled([pollTripUpdates(), pollVehiclePositions()]);
		for (const result of results) {
			if (result.status === "rejected") {
				console.error("✘ Upstream poll failed, keeping last known feed", result.reason);
			}
		}

		setTimeout(poll, Math.max(POLL_INTERVAL_MS - (Date.now() - startedAt), 0));
	}

	void poll();

	return store;
}
