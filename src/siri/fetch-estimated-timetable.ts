import type { EstimatedVehicleJourney } from "./estimated-vehicle-journey.js";
import { GET_ESTIMATED_TIMETABLE } from "./payloads.js";
import { requestSiri } from "./request-siri.js";

type Frame = {
	RecordedAtTime?: string;
	EstimatedVehicleJourney?: EstimatedVehicleJourney | EstimatedVehicleJourney[];
};

function toArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

export async function fetchEstimatedTimetable(
	siriEndpoint: string,
	requestorRef: string,
	lineRef: string,
): Promise<EstimatedVehicleJourney[]> {
	const payload = await requestSiri(siriEndpoint, GET_ESTIMATED_TIMETABLE(requestorRef, lineRef), {
		timeoutMs: 15_000,
	});
	const delivery = (
		payload as {
			Envelope?: {
				Body?: {
					GetEstimatedTimetableResponse?: { Answer?: { EstimatedTimetableDelivery?: unknown } };
				};
			};
		}
	)?.Envelope?.Body?.GetEstimatedTimetableResponse?.Answer?.EstimatedTimetableDelivery;
	if (!delivery) return [];

	const deliveries = toArray<{ EstimatedJourneyVersionFrame?: Frame | Frame[] }>(delivery);

	const journeys: EstimatedVehicleJourney[] = [];
	for (const d of deliveries) {
		for (const frame of toArray<Frame>(d.EstimatedJourneyVersionFrame)) {
			for (const journey of toArray<EstimatedVehicleJourney>(frame.EstimatedVehicleJourney)) {
				journeys.push(journey);
			}
		}
	}
	return journeys;
}
