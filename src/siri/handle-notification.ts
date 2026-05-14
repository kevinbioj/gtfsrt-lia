import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { gunzip as gunzipCb } from "node:zlib";
import type { Context } from "hono";

import { REQUESTOR_REF, SIRI_NOTIFY_TOKEN } from "../config.js";
import type { useGtfsResource } from "../gtfs/load-resource.js";
import { processEstimatedJourney } from "../gtfs-rt/process-estimated-journey.js";
import { processVehicleActivity } from "../gtfs-rt/process-vehicle-activity.js";
import type { useRealtimeStore } from "../gtfs-rt/use-realtime-store.js";
import { toArray } from "../utils/to-array.js";

import type { EstimatedVehicleJourney } from "./estimated-vehicle-journey.js";
import type { VehicleActivity } from "./fetch-monitored-vehicles.js";
import { NOTIFY_ESTIMATED_TIMETABLE_RESPONSE, NOTIFY_VEHICLE_MONITORING_RESPONSE } from "./payloads.js";
import { siriXmlParser } from "./request-siri.js";

const gunzip = promisify(gunzipCb);

type GtfsLiveResource = Awaited<ReturnType<typeof useGtfsResource>>;
type RealtimeStore = ReturnType<typeof useRealtimeStore>;

type NotificationKind = "vm" | "et" | "unknown";

function safeTokenCompare(provided: string | undefined): boolean {
	if (!provided) return false;
	const a = Buffer.from(provided);
	const b = Buffer.from(SIRI_NOTIFY_TOKEN);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

function detectKind(body: unknown): NotificationKind {
	const root = (body as { Envelope?: { Body?: Record<string, unknown> } })?.Envelope?.Body;
	if (!root) return "unknown";
	if ("NotifyVehicleMonitoring" in root) return "vm";
	if ("NotifyEstimatedTimetable" in root) return "et";
	console.warn(`✘ Unknown SOAP body root keys: [${Object.keys(root).join(", ")}]`);
	return "unknown";
}

function extractRequestMessageRef(notify: unknown): string {
	const info =
		(notify as { NotificationInfo?: { MessageIdentifier?: string }; NotifyInfo?: { MessageIdentifier?: string } }) ??
		{};
	return info?.NotificationInfo?.MessageIdentifier ?? info?.NotifyInfo?.MessageIdentifier ?? "";
}

function buildAckResponse(kind: NotificationKind, requestMessageRef: string, status: boolean): string {
	const input = { requestorRef: REQUESTOR_REF, requestMessageRef, status };
	return kind === "et" ? NOTIFY_ESTIMATED_TIMETABLE_RESPONSE(input) : NOTIFY_VEHICLE_MONITORING_RESPONSE(input);
}

function processVehicleMonitoringNotification(
	notify: unknown,
	gtfsResource: GtfsLiveResource,
	store: RealtimeStore,
): void {
	type Delivery = { SubscriptionRef?: string; VehicleActivity?: VehicleActivity | VehicleActivity[] };
	const deliveries = toArray<Delivery>(
		(notify as { Notification?: { VehicleMonitoringDelivery?: Delivery | Delivery[] } })?.Notification
			?.VehicleMonitoringDelivery,
	);

	for (const delivery of deliveries) {
		for (const vehicle of toArray<VehicleActivity>(delivery.VehicleActivity)) {
			try {
				processVehicleActivity(vehicle, gtfsResource, store);
			} catch (cause) {
				console.error("✘ Failed to process VehicleActivity", cause);
			}
		}
	}
}

function processEstimatedTimetableNotification(
	notify: unknown,
	gtfsResource: GtfsLiveResource,
	store: RealtimeStore,
): void {
	type Frame = {
		RecordedAtTime?: string;
		EstimatedVehicleJourney?: EstimatedVehicleJourney | EstimatedVehicleJourney[];
	};
	type Delivery = { SubscriptionRef?: string; EstimatedJourneyVersionFrame?: Frame | Frame[] };

	const deliveries = toArray<Delivery>(
		(notify as { Notification?: { EstimatedTimetableDelivery?: Delivery | Delivery[] } })?.Notification
			?.EstimatedTimetableDelivery,
	);

	for (const delivery of deliveries) {
		for (const frame of toArray<Frame>(delivery.EstimatedJourneyVersionFrame)) {
			for (const journey of toArray<EstimatedVehicleJourney>(frame.EstimatedVehicleJourney)) {
				try {
					processEstimatedJourney(journey, gtfsResource, store);
				} catch (cause) {
					console.error("✘ Failed to process EstimatedVehicleJourney", cause);
				}
			}
		}
	}
}

export function makeNotificationHandler(gtfsResource: GtfsLiveResource, store: RealtimeStore) {
	return async function handleNotification(c: Context): Promise<Response> {
		if (!safeTokenCompare(c.req.query("token"))) {
			console.warn("✘ /siri/notify: bad token");
			return c.text("Unauthorized", 401);
		}

		const ackHeaders = { "Content-Type": "application/xml", Connection: "close" };

		let xml: string;
		try {
			const buf = Buffer.from(await c.req.arrayBuffer());
			const encoding = c.req.header("content-encoding")?.toLowerCase();
			xml = encoding === "gzip" ? (await gunzip(buf)).toString("utf8") : buf.toString("utf8");
		} catch (cause) {
			console.error("✘ Failed to read notification body", cause);
			return c.body(buildAckResponse("unknown", "", false), 200, ackHeaders);
		}

		let kind: NotificationKind = "unknown";
		let requestMessageRef = "";

		try {
			const payload = siriXmlParser.parse(xml);
			kind = detectKind(payload);

			if (kind === "vm") {
				const notify = payload?.Envelope?.Body?.NotifyVehicleMonitoring;
				requestMessageRef = extractRequestMessageRef(notify);
				processVehicleMonitoringNotification(notify, gtfsResource, store);
			} else if (kind === "et") {
				const notify = payload?.Envelope?.Body?.NotifyEstimatedTimetable;
				requestMessageRef = extractRequestMessageRef(notify);
				processEstimatedTimetableNotification(notify, gtfsResource, store);
			} else {
				console.warn("✘ Unknown notification body shape, ignoring");
				return c.body(buildAckResponse("unknown", "", false), 200, ackHeaders);
			}
		} catch (cause) {
			console.error("✘ Failed to parse notification", cause);
			return c.body(buildAckResponse(kind, requestMessageRef, false), 200, ackHeaders);
		}

		return c.body(buildAckResponse(kind, requestMessageRef, true), 200, ackHeaders);
	};
}
