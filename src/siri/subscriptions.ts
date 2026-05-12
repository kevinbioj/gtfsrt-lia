import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";

import {
	REQUESTOR_REF,
	SIRI_CONSUMER_ADDRESS,
	SIRI_ENDPOINT,
	SIRI_NOTIFY_TOKEN,
	SIRI_SUBSCRIPTION_HEARTBEAT_TIMEOUT_SECONDS,
	SIRI_SUBSCRIPTION_TTL_MINUTES,
} from "../config.js";
import { extractSiriRef } from "../utils/extract-siri-ref.js";

import { checkSiriStatus } from "./check-status.js";
import { SUBSCRIBE_VEHICLE_MONITORING } from "./payloads.js";
import { requestSiri } from "./request-siri.js";

type SubscriptionState = {
	subscriptionRef: string;
	lineRef: string;
	subscribedAt: Temporal.Instant;
	lastNotificationAt: Temporal.Instant | null;
	terminationTime: Temporal.Instant;
};

const registry = new Map<string, SubscriptionState>();
const lineRefBySubscriptionRef = new Map<string, string>();

function consumerAddress(): string {
	const url = new URL(SIRI_CONSUMER_ADDRESS);
	url.searchParams.set("token", SIRI_NOTIFY_TOKEN);
	return url.toString();
}

function extractSubscribeStatus(payload: unknown): { ok: boolean; errorCondition?: string } {
	const responseStatus = (
		payload as { Envelope?: { Body?: { SubscribeResponse?: { Answer?: { ResponseStatus?: unknown } } } } }
	)?.Envelope?.Body?.SubscribeResponse?.Answer?.ResponseStatus;
	if (!responseStatus) return { ok: false, errorCondition: "missing ResponseStatus" };
	const first = Array.isArray(responseStatus) ? responseStatus[0] : responseStatus;
	const status = (first as { Status?: unknown }).Status;
	const ok = status === true || status === "true";
	if (ok) return { ok: true };
	const err = (first as { ErrorCondition?: unknown }).ErrorCondition;
	return { ok: false, errorCondition: JSON.stringify(err ?? null) };
}

async function subscribeLine(lineRef: string): Promise<boolean> {
	const subscriptionRef = randomUUID();
	const terminationTime = Temporal.Now.instant().add({ minutes: SIRI_SUBSCRIPTION_TTL_MINUTES });

	const body = SUBSCRIBE_VEHICLE_MONITORING({
		requestorRef: REQUESTOR_REF,
		consumerAddress: consumerAddress(),
		subscriptionIdentifier: subscriptionRef,
		initialTerminationTime: terminationTime.toString(),
		lineRef,
	});

	const lineId = extractSiriRef(lineRef)[3];

	try {
		const payload = await requestSiri(SIRI_ENDPOINT, body, { timeoutMs: 20_000 });
		const { ok, errorCondition } = extractSubscribeStatus(payload);
		if (!ok) {
			console.error(`✘ Subscribe rejected for line '${lineId}': ${errorCondition}`);
			return false;
		}
	} catch (cause) {
		console.error(`✘ Subscribe HTTP error for line '${lineId}'`, cause);
		return false;
	}

	registry.set(lineRef, {
		subscriptionRef,
		lineRef,
		subscribedAt: Temporal.Now.instant(),
		lastNotificationAt: null,
		terminationTime,
	});
	lineRefBySubscriptionRef.set(subscriptionRef, lineRef);
	console.log(`✓ Subscribed to line '${lineId}' (${subscriptionRef})`);
	return true;
}

async function unsubscribeLine(lineRef: string): Promise<void> {
	const state = registry.get(lineRef);
	if (!state) return;

	const lineId = extractSiriRef(lineRef)[3];

	// LiA's DeleteSubscription ignores SubscriptionRef and wipes every subscription
	// matching SubscriberRef — which collides across instances sharing
	// RequestorRef="opendata". Skip the SIRI call and let InitialTerminationTime
	// handle server-side cleanup.
	registry.delete(lineRef);
	lineRefBySubscriptionRef.delete(state.subscriptionRef);
	console.log(`⛛ Released line '${lineId}' locally (LiA-side expires at ${state.terminationTime})`);
}

export async function syncSubscriptions(monitoredLines: string[]): Promise<void> {
	const desired = new Set(monitoredLines);
	const current = new Set(registry.keys());

	const toAdd = [...desired].filter((l) => !current.has(l));
	const toRemove = [...current].filter((l) => !desired.has(l));

	for (const lineRef of toRemove) {
		await unsubscribeLine(lineRef);
	}

	let successes = 0;
	for (const lineRef of toAdd) {
		const ok = await subscribeLine(lineRef);
		if (ok) successes += 1;
	}

	if (toAdd.length > 0 && successes === 0 && registry.size === 0) {
		throw new Error("All subscriptions failed — aborting to let orchestrator restart");
	}
}

export async function renewAllSubscriptions(): Promise<void> {
	console.log("➔ Renewing all SIRI subscriptions");
	const lineRefs = [...registry.keys()];
	for (const lineRef of lineRefs) {
		await unsubscribeLine(lineRef);
		await subscribeLine(lineRef);
	}
}

export async function terminateAllSubscriptions(): Promise<void> {
	console.log("➔ Terminating all SIRI subscriptions");
	const entries = [...registry.entries()];
	await Promise.allSettled(entries.map(([lineRef]) => unsubscribeLine(lineRef)));
}

export function markNotification(subscriptionRef: string): string | undefined {
	const lineRef = lineRefBySubscriptionRef.get(subscriptionRef);
	if (!lineRef) return undefined;
	const state = registry.get(lineRef);
	if (state) {
		state.lastNotificationAt = Temporal.Now.instant();
	}
	return lineRef;
}

export async function heartbeatTick(): Promise<void> {
	const now = Temporal.Now.instant();
	const threshold = SIRI_SUBSCRIPTION_HEARTBEAT_TIMEOUT_SECONDS;

	const stale: string[] = [];
	for (const [lineRef, state] of registry) {
		if (now.since(state.subscribedAt).total("seconds") < threshold) continue;
		const last = state.lastNotificationAt ?? state.subscribedAt;
		if (now.since(last).total("seconds") < threshold) continue;
		stale.push(lineRef);
	}

	if (stale.length === 0) return;

	console.log(`➔ Heartbeat watchdog: ${stale.length} subscription(s) silent past ${threshold}s, probing CheckStatus`);
	const producerHealthy = await checkSiriStatus(SIRI_ENDPOINT, REQUESTOR_REF);

	if (!producerHealthy) {
		console.error("✘ CheckStatus failed, rebinding stale subscriptions");
		for (const lineRef of stale) {
			await unsubscribeLine(lineRef);
			await subscribeLine(lineRef);
		}
	} else {
		console.log("⛛ CheckStatus OK — producer is up, leaving subscriptions in place");
	}
}

export function getRegistrySize(): number {
	return registry.size;
}
