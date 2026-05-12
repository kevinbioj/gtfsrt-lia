import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { Temporal } from "temporal-polyfill";

import { GTFS_RESOURCE_URL, PORT, SIRI_ENDPOINT, SIRI_SUBSCRIPTION_RENEWAL_MINUTES } from "./config.js";
import { useGtfsResource } from "./gtfs/load-resource.js";
import { handleRequest } from "./gtfs-rt/handle-request.js";
import { useRealtimeStore } from "./gtfs-rt/use-realtime-store.js";
import { fetchMonitoredLines } from "./siri/fetch-monitored-lines.js";
import { makeNotificationHandler } from "./siri/handle-notification.js";
import {
	heartbeatTick,
	renewAllSubscriptions,
	syncSubscriptions,
	terminateAllSubscriptions,
} from "./siri/subscriptions.js";

console.log(` ,----.,--------.,------.,---.        ,------.,--------. ,--.   ,--.  ,---.
'  .-./'--.  .--'|  .---'   .-',-----.|  .--. '--.  .--' |  |   \`--' /  O  \\
|  | .---.|  |   |  \`--,\`.  \`-.'-----'|  '--'.'  |  |    |  |   ,--.|  .-.  |
'  '--'  ||  |   |  |\`  .-'    |      |  |\\  \\   |  |    |  '--.|  ||  | |  |
 \`------' \`--'   \`--'   \`-----'       \`--' '--'  \`--'    \`-----'\`--'\`--' \`--'`);

const store = useRealtimeStore();
const gtfsResource = await useGtfsResource(GTFS_RESOURCE_URL);

const hono = new Hono();

const publicLimiter = rateLimiter({
	windowMs: 10_000,
	limit: 1,
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
await syncSubscriptions(monitoredLines);

setInterval(
	async () => {
		console.log("➔ Refreshing monitored lines from SIRI");
		try {
			monitoredLines = await fetchMonitoredLines(SIRI_ENDPOINT);
			await syncSubscriptions(monitoredLines);
		} catch (cause) {
			console.error("✘ Failed to refresh monitored lines", cause);
		}
	},
	Temporal.Duration.from({ hours: 1 }).total("milliseconds"),
);

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

setInterval(
	() => {
		heartbeatTick().catch((cause) => console.error("✘ Heartbeat tick failed", cause));
	},
	Temporal.Duration.from({ seconds: 15 }).total("milliseconds"),
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
