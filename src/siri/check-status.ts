import { CHECK_STATUS } from "./payloads.js";
import { requestSiri } from "./request-siri.js";

export async function checkSiriStatus(siriEndpoint: string, requestorRef: string): Promise<boolean> {
	try {
		const payload = await requestSiri(siriEndpoint, CHECK_STATUS(requestorRef), { timeoutMs: 10_000 });
		const status = payload?.Envelope?.Body?.CheckStatusResponse?.Answer?.Status;
		return status === true || status === "true";
	} catch (cause) {
		console.error("✘ CheckStatus failed", cause);
		return false;
	}
}
