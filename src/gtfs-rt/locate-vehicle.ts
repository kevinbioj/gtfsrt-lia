import GtfsRealtime from "gtfs-realtime-bindings";

import { BACKWARD_TOLERANCE, INCOMING_AT_RADIUS, STOPPED_AT_RADIUS } from "../config.js";
import type { GtfsResource, TripStop } from "../gtfs/import-resource.js";
import { findSegmentIndex, projectOnShape } from "../gtfs/project-on-shape.js";

const { VehicleStopStatus } = GtfsRealtime.transit_realtime.VehiclePosition;

type VehicleState = { tripId: string; distance: number };

export function useVehicleLocator() {
	let states = new Map<string, VehicleState>();
	let nextStates = new Map<string, VehicleState>();

	/**
	 * Détermine `currentStatus`, `currentStopSequence` et `stopId` en projetant la position du véhicule
	 * sur le tracé de sa course. Le véhicule est laissé tel quel si sa course est inconnue du GTFS.
	 */
	function locateVehicle(vehicle: GtfsRealtime.transit_realtime.IVehiclePosition, gtfs: GtfsResource) {
		const vehicleId = vehicle.vehicle?.id;
		const tripId = vehicle.trip?.tripId;
		const position = vehicle.position;
		if (!vehicleId || !tripId || !position) return;

		const trip = gtfs.trips.get(tripId);
		const shape = trip !== undefined ? gtfs.shapes.get(trip.shapeId) : undefined;
		if (trip === undefined || shape === undefined || trip.stops.length === 0) return;

		const previousState = states.get(vehicleId);
		const fromIndex =
			previousState?.tripId === tripId ? findSegmentIndex(shape, previousState.distance - BACKWARD_TOLERANCE) : 0;

		const projection = projectOnShape(shape, position.latitude, position.longitude, fromIndex);
		if (projection === undefined) return;

		const { stop, remaining } = resolveCurrentStop(trip.stops, projection.distance);

		vehicle.currentStatus =
			remaining <= STOPPED_AT_RADIUS
				? VehicleStopStatus.STOPPED_AT
				: remaining <= INCOMING_AT_RADIUS
					? VehicleStopStatus.INCOMING_AT
					: VehicleStopStatus.IN_TRANSIT_TO;
		vehicle.currentStopSequence = stop.sequence;
		vehicle.stopId = stop.stopId;

		nextStates.set(vehicleId, { tripId, distance: projection.distance });
	}

	/** Oublie les véhicules absents du dernier cycle de localisation. */
	function sweepVehicleStates() {
		states = nextStates;
		nextStates = new Map();
	}

	return { locateVehicle, sweepVehicleStates };
}

/**
 * Rattache une abscisse curviligne à un arrêt de la course, et renvoie la distance qu'il reste à parcourir
 * pour l'atteindre. Un véhicule à quai finit par dépasser la borne de son arrêt de quelques mètres : tant
 * qu'il ne s'en est pas éloigné, on continue de le rattacher à cet arrêt plutôt qu'au suivant.
 */
function resolveCurrentStop(stops: TripStop[], distance: number) {
	const aheadIndex = stops.findIndex((stop) => stop.distance >= distance);

	// Passé le dernier arrêt, le véhicule est arrivé à son terminus.
	if (aheadIndex === -1) {
		// biome-ignore lint/style/noNonNullAssertion: stops is not empty
		return { stop: stops.at(-1)!, remaining: 0 };
	}

	// biome-ignore lint/style/noNonNullAssertion: aheadIndex is a valid index
	const ahead = stops[aheadIndex]!;
	const behind = aheadIndex > 0 ? stops[aheadIndex - 1] : undefined;

	if (behind !== undefined && distance - behind.distance <= STOPPED_AT_RADIUS) {
		return { stop: behind, remaining: 0 };
	}

	return { stop: ahead, remaining: ahead.distance - distance };
}
