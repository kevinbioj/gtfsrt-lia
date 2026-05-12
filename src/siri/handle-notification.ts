import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { gunzip as gunzipCb } from "node:zlib";
import type { Context } from "hono";

import { REQUESTOR_REF, SIRI_NOTIFY_TOKEN } from "../config.js";
import type { useGtfsResource } from "../gtfs/load-resource.js";
import { processVehicleActivity } from "../gtfs-rt/process-vehicle-activity.js";
import type { useRealtimeStore } from "../gtfs-rt/use-realtime-store.js";

import type { VehicleActivity } from "./fetch-monitored-vehicles.js";
import { NOTIFY_VEHICLE_MONITORING_RESPONSE } from "./payloads.js";
import { siriXmlParser } from "./request-siri.js";
import { markNotification } from "./subscriptions.js";

const gunzip = promisify(gunzipCb);

type GtfsLiveResource = Awaited<ReturnType<typeof useGtfsResource>>;
type RealtimeStore = ReturnType<typeof useRealtimeStore>;

function safeTokenCompare(provided: string | undefined): boolean {
	if (!provided) return false;
	const a = Buffer.from(provided);
	const b = Buffer.from(SIRI_NOTIFY_TOKEN);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

function toArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

export function makeNotificationHandler(gtfsResource: GtfsLiveResource, store: RealtimeStore) {
	return async function handleNotification(c: Context): Promise<Response> {
		if (!safeTokenCompare(c.req.query("token"))) {
			return c.text("Unauthorized", 401);
		}

		let xml: string;
		try {
			const buf = Buffer.from(await c.req.arrayBuffer());
			const encoding = c.req.header("content-encoding")?.toLowerCase();
			xml = encoding === "gzip" ? (await gunzip(buf)).toString("utf8") : buf.toString("utf8");
		} catch (cause) {
			console.error("✘ Failed to read notification body", cause);
			return c.body(
				NOTIFY_VEHICLE_MONITORING_RESPONSE({ requestorRef: REQUESTOR_REF, requestMessageRef: "", status: false }),
				200,
				{ "Content-Type": "application/xml" },
			);
		}

		let requestMessageRef = "";
		try {
			const payload = siriXmlParser.parse(xml);
			const notify = payload?.Envelope?.Body?.NotifyVehicleMonitoring;
			requestMessageRef = notify?.NotificationInfo?.MessageIdentifier ?? notify?.NotifyInfo?.MessageIdentifier ?? "";

			const deliveries = toArray<{
				SubscriptionRef?: string;
				VehicleActivity?: VehicleActivity | VehicleActivity[];
			}>(notify?.Notification?.VehicleMonitoringDelivery);

			for (const delivery of deliveries) {
				if (delivery.SubscriptionRef) {
					markNotification(delivery.SubscriptionRef);
				}
				for (const vehicle of toArray<VehicleActivity>(delivery.VehicleActivity)) {
					try {
						processVehicleActivity(vehicle, gtfsResource, store);
					} catch (cause) {
						console.error("✘ Failed to process VehicleActivity", cause);
					}
				}
			}
		} catch (cause) {
			console.error("✘ Failed to parse notification", cause);
			return c.body(
				NOTIFY_VEHICLE_MONITORING_RESPONSE({ requestorRef: REQUESTOR_REF, requestMessageRef, status: false }),
				200,
				{ "Content-Type": "application/xml" },
			);
		}

		return c.body(
			NOTIFY_VEHICLE_MONITORING_RESPONSE({ requestorRef: REQUESTOR_REF, requestMessageRef, status: true }),
			200,
			{ "Content-Type": "application/xml" },
		);
	};
}
