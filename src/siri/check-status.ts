import { CHECK_STATUS } from "./payloads.js";
import { requestSiri } from "./request-siri.js";

export type CheckStatusResult = {
	status: boolean;
	serviceStartedTime: string | null;
};

export async function checkSiriStatus(siriEndpoint: string, requestorRef: string): Promise<CheckStatusResult | null> {
	try {
		const payload = await requestSiri(siriEndpoint, CHECK_STATUS(requestorRef), { timeoutMs: 10_000 });
		const answer = (
			payload as {
				Envelope?: {
					Body?: { CheckStatusResponse?: { Answer?: { Status?: unknown; ServiceStartedTime?: string } } };
				};
			}
		)?.Envelope?.Body?.CheckStatusResponse?.Answer;
		const status = answer?.Status === true || answer?.Status === "true";
		const serviceStartedTime = answer?.ServiceStartedTime ?? null;
		return { status, serviceStartedTime };
	} catch (cause) {
		console.error("✘ CheckStatus error", cause);
		return null;
	}
}
