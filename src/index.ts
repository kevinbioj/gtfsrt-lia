import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { Temporal } from "temporal-polyfill";

import {
	GTFS_RESOURCE_URL,
	PORT,
	REQUESTOR_REF,
	SIRI_ENDPOINT,
	SIRI_ET_POLL_INTERVAL_MS,
	SIRI_SUBSCRIPTION_RENEWAL_MINUTES,
} from "./config.js";
import { useGtfsResource } from "./gtfs/load-resource.js";
import { handleRequest } from "./gtfs-rt/handle-request.js";
import { processEstimatedJourney } from "./gtfs-rt/process-estimated-journey.js";
import { useRealtimeStore } from "./gtfs-rt/use-realtime-store.js";
import { fetchEstimatedTimetable } from "./siri/fetch-estimated-timetable.js";
import { fetchMonitoredLines } from "./siri/fetch-monitored-lines.js";
import { makeNotificationHandler } from "./siri/handle-notification.js";
import { renewAllSubscriptions, syncSubscriptions, terminateAllSubscriptions } from "./siri/subscriptions.js";

console.log(` ,----.,--------.,------.,---.        ,------.,--------. ,--.   ,--.  ,---.
'  .-./'--.  .--'|  .---'   .-',-----.|  .--. '--.  .--' |  |   \`--' /  O  \\
|  | .---.|  |   |  \`--,\`.  \`-.'-----'|  '--'.'  |  |    |  |   ,--.|  .-.  |
'  '--'  ||  |   |  |\`  .-'    |      |  |\\  \\   |  |    |  '--.|  ||  | |  |
 \`------' \`--'   \`--'   \`-----'       \`--' '--'  \`--'    \`-----'\`--'\`--' \`--'`);

const store = useRealtimeStore();
const gtfsResource = await useGtfsResource(GTFS_RESOURCE_URL);

const hono = new Hono();

const publicLimiter = rateLimiter({
	windowMs: 5_000,
	limit: 5,
	keyGenerator: (c) => `${c.req.header("CF-Connecting-IP")}_${c.req.method}_${c.req.path}`,
	handler: (c) => c.json({ code: 429, message: "Too many requests, please try again later." }, 429),
});

hono.get("/trip-updates", publicLimiter, (c) => handleRequest(c, "protobuf", store.tripUpdates, null));
hono.get("/trip-updates.json", publicLimiter, (c) => handleRequest(c, "json", store.tripUpdates, null));
hono.get("/vehicle-positions", publicLimiter, (c) => handleRequest(c, "protobuf", null, store.vehiclePositions));
hono.get("/vehicle-positions.json", publicLimiter, (c) => handleRequest(c, "json", null, store.vehiclePositions));
hono.get("/", publicLimiter, (c) =>
	handleRequest(c, c.req.query("format") === "json" ? "json" : "protobuf", store.tripUpdates, store.vehiclePositions),
);

hono.post("/siri/notify", makeNotificationHandler(gtfsResource, store));

const server = serve({ fetch: hono.fetch, port: PORT });
console.log(`➔ Listening on :${PORT}`);

let monitoredLines = await fetchMonitoredLines(SIRI_ENDPOINT);
console.log(`✓ ${monitoredLines.length} line(s) to monitor`);
// VM in push (subscription). ET subscription is no-op on LiA's side (Status=true but no notifications)
// so we poll ET separately below.
await syncSubscriptions("vm", monitoredLines);

setInterval(
	async () => {
		console.log("➔ Refreshing monitored lines from SIRI");
		try {
			monitoredLines = await fetchMonitoredLines(SIRI_ENDPOINT);
			await syncSubscriptions("vm", monitoredLines);
		} catch (cause) {
			console.error("✘ Failed to refresh monitored lines", cause);
		}
	},
	Temporal.Duration.from({ hours: 1 }).total("milliseconds"),
);

let etPollIdx = 0;
async function pollEstimatedTimetable(): Promise<void> {
	if (monitoredLines.length === 0) {
		setTimeout(pollEstimatedTimetable, SIRI_ET_POLL_INTERVAL_MS);
		return;
	}
	if (etPollIdx >= monitoredLines.length) etPollIdx = 0;

	const startedAt = Date.now();
	const lineRef = monitoredLines[etPollIdx];
	etPollIdx += 1;

	try {
		const journeys = await fetchEstimatedTimetable(SIRI_ENDPOINT, REQUESTOR_REF, lineRef);
		for (const journey of journeys) {
			try {
				processEstimatedJourney(journey, gtfsResource, store);
			} catch (cause) {
				console.error("✘ Failed to process EstimatedVehicleJourney", cause);
			}
		}
	} catch (cause) {
		console.error(`✘ ET poll failed for ${lineRef}`, cause);
	}

	const wait = Math.max(SIRI_ET_POLL_INTERVAL_MS - (Date.now() - startedAt), 0);
	setTimeout(pollEstimatedTimetable, wait);
}
pollEstimatedTimetable();

setInterval(
	async () => {
		try {
			await renewAllSubscriptions();
		} catch (cause) {
			console.error("✘ Subscription renewal failed", cause);
		}
	},
	Temporal.Duration.from({ minutes: SIRI_SUBSCRIPTION_RENEWAL_MINUTES }).total("milliseconds"),
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`➔ ${signal} received, shutting down`);

	const hardTimeout = setTimeout(() => {
		console.error("✘ Shutdown took too long, forcing exit");
		process.exit(1);
	}, 15_000);
	hardTimeout.unref();

	server.close();
	await terminateAllSubscriptions();
	process.exit(0);
}

process.on("SIGINT", () => {
	void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
	void shutdown("SIGTERM");
});
