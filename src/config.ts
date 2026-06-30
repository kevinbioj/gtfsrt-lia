function requireEnv(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`Missing required env var ${name}`);
	return v;
}

function envNumber(name: string, fallback: number): number {
	const v = process.env[name];
	if (!v) return fallback;
	const n = Number(v);
	if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number, got '${v}'`);
	return n;
}

export const PORT = envNumber("PORT", 3000);
export const GTFS_RESOURCE_URL = process.env.GTFS_RESOURCE_URL ?? "https://gtfs.bus-tracker.fr/lia.zip";
export const SIRI_ENDPOINT = process.env.SIRI_ENDPOINT ?? "https://opendata.siri.transports-lia.fr/api";
export const REQUESTOR_REF = process.env.REQUESTOR_REF ?? "opendata";

export const SIRI_CONSUMER_ADDRESS = requireEnv("SIRI_CONSUMER_ADDRESS");
export const SIRI_NOTIFY_TOKEN = requireEnv("SIRI_NOTIFY_TOKEN");

export const SIRI_SUBSCRIPTION_TTL_MINUTES = envNumber("SIRI_SUBSCRIPTION_TTL_MINUTES", 15);
export const SIRI_SUBSCRIPTION_RENEWAL_MINUTES = envNumber("SIRI_SUBSCRIPTION_RENEWAL_MINUTES", 10);
export const SIRI_ET_POLL_INTERVAL_MS = envNumber("SIRI_ET_POLL_INTERVAL_MS", 2000);

export const SWEEP_THRESHOLD = Temporal.Duration.from({
	minutes: envNumber("SWEEP_THRESHOLD_MINUTES", 10),
}).total("milliseconds");
