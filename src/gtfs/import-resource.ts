import { join } from "node:path";

import { parseCsv } from "../utils/parse-csv.js";

export type ShapePoint = { latitude: number; longitude: number; distance: number };

export type TripStop = { sequence: number; stopId: string; distance: number };

export type Trip = { id: string; shapeId: string; stops: TripStop[] };

export type GtfsResource = Awaited<ReturnType<typeof importResource>>;

export async function importResource(directory: string) {
	const shapes = await importShapes(directory);
	const trips = await importTrips(directory);
	return { shapes, trips };
}

type ShapeRecord = {
	shape_id: string;
	shape_pt_lat: string;
	shape_pt_lon: string;
	shape_pt_sequence: string;
	shape_dist_traveled: string;
};

async function importShapes(directory: string) {
	const shapes = new Map<string, (ShapePoint & { sequence: number })[]>();

	await parseCsv<ShapeRecord>(join(directory, "shapes.txt"), (shapeRecord) => {
		let points = shapes.get(shapeRecord.shape_id);
		if (points === undefined) {
			points = [];
			shapes.set(shapeRecord.shape_id, points);
		}

		points.push({
			latitude: +shapeRecord.shape_pt_lat,
			longitude: +shapeRecord.shape_pt_lon,
			distance: +shapeRecord.shape_dist_traveled,
			sequence: +shapeRecord.shape_pt_sequence,
		});
	});

	shapes.forEach((points) => {
		points.sort((a, b) => a.sequence - b.sequence);
	});

	return shapes as Map<string, ShapePoint[]>;
}

type TripRecord = { trip_id: string; shape_id: string };

type StopTimeRecord = { trip_id: string; stop_id: string; stop_sequence: string; shape_dist_traveled: string };

async function importTrips(directory: string) {
	const trips = new Map<string, Trip>();

	await parseCsv<TripRecord>(join(directory, "trips.txt"), (tripRecord) => {
		trips.set(tripRecord.trip_id, {
			id: tripRecord.trip_id,
			shapeId: tripRecord.shape_id,
			stops: [],
		});
	});

	await parseCsv<StopTimeRecord>(join(directory, "stop_times.txt"), (stopTimeRecord) => {
		const trip = trips.get(stopTimeRecord.trip_id);
		if (trip === undefined) {
			return;
		}

		trip.stops.push({
			sequence: +stopTimeRecord.stop_sequence,
			stopId: stopTimeRecord.stop_id,
			distance: +stopTimeRecord.shape_dist_traveled,
		});
	});

	trips.forEach((trip) => {
		trip.stops.sort((a, b) => a.sequence - b.sequence);
	});

	return trips;
}
