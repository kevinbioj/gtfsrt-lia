function envNumber(name: string, fallback: number): number {
	const v = process.env[name];
	if (!v) return fallback;
	const n = Number(v);
	if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number, got '${v}'`);
	return n;
}

export const PORT = envNumber("PORT", 3000);
export const GTFS_RESOURCE_URL = process.env.GTFS_RESOURCE_URL ?? "https://gtfs.bus-tracker.fr/lia.zip";

export const TRIP_UPDATES_URL =
	process.env.TRIP_UPDATES_URL ?? "https://opendata.transports-lia.fr/gtfs-rt/TripUpdate.pb";
export const VEHICLE_POSITIONS_URL =
	process.env.VEHICLE_POSITIONS_URL ?? "https://opendata.transports-lia.fr/gtfs-rt/VehiclePosition.pb";

export const POLL_INTERVAL_MS = envNumber("POLL_INTERVAL_MS", 15_000);

export const SERVICE_ALERTS_URL =
	process.env.SERVICE_ALERTS_URL ??
	"https://api.maas-fr.cityway.fr/disrupt/api/v1/fr/disruptions?IncludeLines=true&OperatorsIds=25";
export const ALERTS_POLL_INTERVAL_MS = envNumber("ALERTS_POLL_INTERVAL_MS", 300_000);

/** Distance restante jusqu'au prochain arrêt, en mètres, en dessous de laquelle on considère le véhicule à quai. */
export const STOPPED_AT_RADIUS = envNumber("STOPPED_AT_RADIUS", 30);
/** Idem pour l'approche de l'arrêt. */
export const INCOMING_AT_RADIUS = envNumber("INCOMING_AT_RADIUS", 100);
/** Recul autorisé, en mètres, lors de la reprise de la projection d'un véhicule déjà localisé. */
export const BACKWARD_TOLERANCE = envNumber("BACKWARD_TOLERANCE", 150);
