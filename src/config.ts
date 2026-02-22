import { Temporal } from "temporal-polyfill";

export const GTFS_RESOURCE_URL = "https://www.data.gouv.fr/api/1/datasets/r/1e666e24-58ee-46b9-8952-ea2755ba88f2";
export const PORT = 3000;
export const REFRESH_INTERVAL = Temporal.Duration.from({ minutes: 10 }).total("milliseconds");
export const REQUESTOR_REF = "opendata";
export const SIRI_ENDPOINT = "https://opendata.siri.transports-lia.fr/api?wsdl";
export const SIRI_RATELIMIT = Temporal.Duration.from({ seconds: process.env.NODE_ENV === "production" ? 1 : 10 }).total(
	"milliseconds",
);
export const SWEEP_THRESHOLD = Temporal.Duration.from({ minutes: 10 }).total("milliseconds");
