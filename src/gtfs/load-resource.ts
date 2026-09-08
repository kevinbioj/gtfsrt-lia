import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { downloadResource } from "./download-resource.js";
import { importResource } from "./import-resource.js";

let currentInterval: NodeJS.Timeout | undefined;

export type GtfsResourceHolder = Awaited<ReturnType<typeof useGtfsResource>>;

export async function useGtfsResource(resourceUrl: string) {
	const initialResource = await loadResource(resourceUrl);

	const resource = {
		gtfs: initialResource.resource,
		lastModified: initialResource.lastModified,
		importedAt: Temporal.Now.instant(),
	};

	if (currentInterval !== undefined) {
		clearInterval(currentInterval);
	}

	currentInterval = setInterval(
		async () => {
			console.log("➔ Checking for GTFS resource staleness.");

			try {
				const response = await fetch(resourceUrl, {
					method: "HEAD",
					signal: AbortSignal.timeout(30_000),
				});

				if (!response.ok) {
					console.error(`    ⛛ Got HTTP ${response.status}, aborting.`);
					return;
				}

				if (response.headers.get("last-modified") === resource.lastModified) {
					console.log("    ⛛ GTFS resource is up-to-date.");
					return;
				}

				console.log("    ⛛ GTFS resource is stale, requesting update.");

				const newResource = await loadResource(resourceUrl);
				resource.gtfs = newResource.resource;
				resource.lastModified = newResource.lastModified;
				resource.importedAt = Temporal.Now.instant();
			} catch (cause) {
				console.error(`✘ GTFS update routine failed:`, cause);
			}
		},
		Temporal.Duration.from({ minutes: 5 }).total("milliseconds"),
	);

	return resource;
}

async function loadResource(resourceUrl: string) {
	console.log(`➔ Loading GTFS resource at '${resourceUrl}'.`);

	const workingDirectory = await mkdtemp(join(tmpdir(), "gtfsrt-lia_"));
	console.log(`    ⛛ Generated working directory at '${workingDirectory}'.`);

	try {
		const { lastModified } = await downloadResource(resourceUrl, workingDirectory);
		const resource = await importResource(workingDirectory);
		console.log(`✓ Successfully loaded resource! (${resource.trips.size} trips, ${resource.shapes.size} shapes)`);
		return { resource, lastModified };
	} catch (cause) {
		throw new Error("Failed to load GTFS resource", { cause });
	} finally {
		await rm(workingDirectory, { recursive: true });
	}
}
