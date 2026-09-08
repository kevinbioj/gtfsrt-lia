import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { rateLimiter } from "hono-rate-limiter";

import { GTFS_RESOURCE_URL, PORT } from "./config.js";
import { useGtfsResource } from "./gtfs/load-resource.js";
import { handleRequest } from "./gtfs-rt/handle-request.js";
import { useUpstreamFeeds } from "./gtfs-rt/poll-upstream.js";

console.log(` ,----.,--------.,------.,---.        ,------.,--------. ,--.   ,--.  ,---.
'  .-./'--.  .--'|  .---'   .-',-----.|  .--. '--.  .--' |  |   \`--' /  O  \\
|  | .---.|  |   |  \`--,\`.  \`-.'-----'|  '--'.'  |  |    |  |   ,--.|  .-.  |
'  '--'  ||  |   |  |\`  .-'    |      |  |\\  \\   |  |    |  '--.|  ||  | |  |
 \`------' \`--'   \`--'   \`-----'       \`--' '--'  \`--'    \`-----'\`--'\`--' \`--'`);

const gtfsResource = await useGtfsResource(GTFS_RESOURCE_URL);
const store = useUpstreamFeeds(gtfsResource);

const hono = new Hono();

const publicLimiter = rateLimiter({
	windowMs: 5_000,
	limit: 5,
	keyGenerator: (c) => `${c.req.header("CF-Connecting-IP")}_${c.req.method}_${c.req.path}`,
	handler: (c) => c.json({ code: 429, message: "Too many requests, please try again later." }, 429),
});

hono.get("/trip-updates", publicLimiter, (c) =>
	handleRequest(c, "protobuf", store.tripUpdates, store.tripUpdatesTimestamp),
);
hono.get("/trip-updates.json", publicLimiter, (c) =>
	handleRequest(c, "json", store.tripUpdates, store.tripUpdatesTimestamp),
);
hono.get("/vehicle-positions", publicLimiter, (c) =>
	handleRequest(c, "protobuf", store.vehiclePositions, store.vehiclePositionsTimestamp),
);
hono.get("/vehicle-positions.json", publicLimiter, (c) =>
	handleRequest(c, "json", store.vehiclePositions, store.vehiclePositionsTimestamp),
);
hono.get("/", publicLimiter, (c) =>
	handleRequest(
		c,
		c.req.query("format") === "json" ? "json" : "protobuf",
		[...store.tripUpdates, ...store.vehiclePositions],
		Math.max(store.tripUpdatesTimestamp, store.vehiclePositionsTimestamp),
	),
);

const server = serve({ fetch: hono.fetch, port: PORT });
console.log(`➔ Listening on :${PORT}`);

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
	process.exit(0);
}

process.on("SIGINT", () => {
	void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
	void shutdown("SIGTERM");
});
