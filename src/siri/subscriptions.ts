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
import { DELETE_SUBSCRIPTION, SUBSCRIBE_ESTIMATED_TIMETABLE, SUBSCRIBE_VEHICLE_MONITORING } from "./payloads.js";
import { requestSiri } from "./request-siri.js";

export type SubscriptionType = "vm" | "et";

type SubscriptionState = {
	type: SubscriptionType;
	subscriptionRef: string;
	lineRef: string;
	subscribedAt: Temporal.Instant;
	lastNotificationAt: Temporal.Instant | null;
	terminationTime: Temporal.Instant;
};

const registry = new Map<string, SubscriptionState>();
const stateBySubscriptionRef = new Map<string, SubscriptionState>();

function registryKey(type: SubscriptionType, lineRef: string): string {
	return `${type}:${lineRef}`;
}

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

function buildSubscribeBody(
	type: SubscriptionType,
	params: {
		requestorRef: string;
		consumerAddress: string;
		subscriptionIdentifier: string;
		initialTerminationTime: string;
		lineRef: string;
	},
): string {
	return type === "vm" ? SUBSCRIBE_VEHICLE_MONITORING(params) : SUBSCRIBE_ESTIMATED_TIMETABLE(params);
}

async function subscribeLine(type: SubscriptionType, lineRef: string): Promise<boolean> {
	const subscriptionRef = randomUUID();
	const terminationTime = Temporal.Now.instant().add({ minutes: SIRI_SUBSCRIPTION_TTL_MINUTES });

	const body = buildSubscribeBody(type, {
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
			console.error(`✘ Subscribe[${type}] rejected for line '${lineId}': ${errorCondition}`);
			return false;
		}
	} catch (cause) {
		console.error(`✘ Subscribe[${type}] HTTP error for line '${lineId}'`, cause);
		return false;
	}

	const state: SubscriptionState = {
		type,
		subscriptionRef,
		lineRef,
		subscribedAt: Temporal.Now.instant(),
		lastNotificationAt: null,
		terminationTime,
	};
	registry.set(registryKey(type, lineRef), state);
	stateBySubscriptionRef.set(subscriptionRef, state);
	console.log(`✓ Subscribed[${type}] to line '${lineId}' (${subscriptionRef})`);
	return true;
}

async function unsubscribeLine(type: SubscriptionType, lineRef: string): Promise<void> {
	const state = registry.get(registryKey(type, lineRef));
	if (!state) return;

	const lineId = extractSiriRef(lineRef)[3];
	const body = DELETE_SUBSCRIPTION(REQUESTOR_REF, state.subscriptionRef);

	try {
		await requestSiri(SIRI_ENDPOINT, body, { timeoutMs: 10_000 });
		console.log(`✓ Unsubscribed[${type}] from line '${lineId}'`);
	} catch (cause) {
		console.error(`✘ DeleteSubscription[${type}] error for line '${lineId}'`, cause);
	}

	registry.delete(registryKey(type, lineRef));
	stateBySubscriptionRef.delete(state.subscriptionRef);
}

function linesOfType(type: SubscriptionType): string[] {
	const out: string[] = [];
	for (const state of registry.values()) {
		if (state.type === type) out.push(state.lineRef);
	}
	return out;
}

export async function syncSubscriptions(type: SubscriptionType, monitoredLines: string[]): Promise<void> {
	const desired = new Set(monitoredLines);
	const current = new Set(linesOfType(type));

	const toAdd = [...desired].filter((l) => !current.has(l));
	const toRemove = [...current].filter((l) => !desired.has(l));

	for (const lineRef of toRemove) {
		await unsubscribeLine(type, lineRef);
	}

	let successes = 0;
	for (const lineRef of toAdd) {
		const ok = await subscribeLine(type, lineRef);
		if (ok) successes += 1;
	}

	if (toAdd.length > 0 && successes === 0 && linesOfType(type).length === 0) {
		throw new Error(`All ${type} subscriptions failed — aborting to let orchestrator restart`);
	}
}

export async function renewAllSubscriptions(): Promise<void> {
	console.log("➔ Renewing all SIRI subscriptions");
	const entries = [...registry.values()];
	for (const state of entries) {
		await unsubscribeLine(state.type, state.lineRef);
		await subscribeLine(state.type, state.lineRef);
	}
}

export async function terminateAllSubscriptions(): Promise<void> {
	console.log("➔ Terminating all SIRI subscriptions");
	const entries = [...registry.values()];
	await Promise.allSettled(entries.map((s) => unsubscribeLine(s.type, s.lineRef)));
}

export function markNotification(subscriptionRef: string): SubscriptionState | undefined {
	const state = stateBySubscriptionRef.get(subscriptionRef);
	if (!state) return undefined;
	state.lastNotificationAt = Temporal.Now.instant();
	return state;
}

export async function heartbeatTick(): Promise<void> {
	const now = Temporal.Now.instant();
	const threshold = SIRI_SUBSCRIPTION_HEARTBEAT_TIMEOUT_SECONDS;

	const stale: SubscriptionState[] = [];
	for (const state of registry.values()) {
		if (now.since(state.subscribedAt).total("seconds") < threshold) continue;
		const last = state.lastNotificationAt ?? state.subscribedAt;
		if (now.since(last).total("seconds") < threshold) continue;
		stale.push(state);
	}

	if (stale.length === 0) return;

	console.log(`➔ Heartbeat watchdog: ${stale.length} subscription(s) silent past ${threshold}s, probing CheckStatus`);
	const producerHealthy = await checkSiriStatus(SIRI_ENDPOINT, REQUESTOR_REF);

	if (!producerHealthy) {
		console.error("✘ CheckStatus failed, rebinding stale subscriptions");
		for (const state of stale) {
			await unsubscribeLine(state.type, state.lineRef);
			await subscribeLine(state.type, state.lineRef);
		}
	} else {
		console.log("⛛ CheckStatus OK — producer is up, leaving subscriptions in place");
	}
}

export function getRegistrySize(): number {
	return registry.size;
}
