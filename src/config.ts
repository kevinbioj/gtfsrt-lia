import { Temporal } from "temporal-polyfill";

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
export const GTFS_RESOURCE_URL =
	process.env.GTFS_RESOURCE_URL ?? "https://www.data.gouv.fr/api/1/datasets/r/1e666e24-58ee-46b9-8952-ea2755ba88f2";
export const SIRI_ENDPOINT = process.env.SIRI_ENDPOINT ?? "https://opendata.siri.transports-lia.fr/api";
export const REQUESTOR_REF = process.env.REQUESTOR_REF ?? "opendata";

export const SIRI_CONSUMER_ADDRESS = requireEnv("SIRI_CONSUMER_ADDRESS");
export const SIRI_NOTIFY_TOKEN = requireEnv("SIRI_NOTIFY_TOKEN");

export const SIRI_SUBSCRIPTION_TTL_MINUTES = envNumber("SIRI_SUBSCRIPTION_TTL_MINUTES", 60);
export const SIRI_SUBSCRIPTION_RENEWAL_MINUTES = envNumber("SIRI_SUBSCRIPTION_RENEWAL_MINUTES", 50);
export const SIRI_SUBSCRIPTION_HEARTBEAT_TIMEOUT_SECONDS = envNumber("SIRI_SUBSCRIPTION_HEARTBEAT_TIMEOUT_SECONDS", 90);

export const SWEEP_THRESHOLD = Temporal.Duration.from({
	minutes: envNumber("SWEEP_THRESHOLD_MINUTES", 10),
}).total("milliseconds");
