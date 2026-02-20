import { Temporal } from "temporal-polyfill";

import type { GtfsResource, Trip } from "../gtfs/import-resource.js";

import { isServiceOperatingOn } from "./is-service-operating-on.js";

export function getOperatingTripsByLineAndDirection(gtfs: GtfsResource) {
	const now = Temporal.Now.zonedDateTimeISO("Europe/Paris");
	const today = now.toPlainDate().subtract({ days: now.hour < 3 ? 1 : 0 });

	console.log("Computing trips for " + today.toString());

	const tripsByLineAndDirection = new Map<string, Trip[]>();

	for (const trip of gtfs.trips.values()) {
		if (!isServiceOperatingOn(trip.service, today)) {
			continue;
		}

		const key = `${trip.routeId}:${trip.directionId}`;
		let list = tripsByLineAndDirection.get(key);
		if (list === undefined) {
			list = [];
			tripsByLineAndDirection.set(key, list);
		}

		list.push(trip);
	}

	return tripsByLineAndDirection;
}
