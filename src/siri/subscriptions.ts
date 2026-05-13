import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";

import { setTimeout as sleep } from "node:timers/promises";

import {
	REQUESTOR_REF,
	SIRI_CONSUMER_ADDRESS,
	SIRI_ENDPOINT,
	SIRI_NOTIFY_TOKEN,
	SIRI_SUBSCRIPTION_TTL_MINUTES,
} from "../config.js";
import { extractSiriRef } from "../utils/extract-siri-ref.js";

import { DELETE_SUBSCRIPTION, SUBSCRIBE_ESTIMATED_TIMETABLE, SUBSCRIBE_VEHICLE_MONITORING } from "./payloads.js";
import { requestSiri } from "./request-siri.js";

export type SubscriptionType = "vm" | "et";

type SubscriptionState = {
	type: SubscriptionType;
	subscriptionRef: string;
	lineRef: string;
	terminationTime: Temporal.Instant;
};

const registry = new Map<string, SubscriptionState>();

function registryKey(type: SubscriptionType, lineRef: string): string {
	return `${type}:${lineRef}`;
}

function consumerAddress(nonce: string): string {
	const url = new URL(SIRI_CONSUMER_ADDRESS);
	url.searchParams.set("token", SIRI_NOTIFY_TOKEN);
	url.searchParams.set("nonce", nonce);
	return url.toString().replace(/&/g, "&amp;");
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
	if (type === "vm") {
		return SUBSCRIBE_VEHICLE_MONITORING({
			...params,
			changeBeforeUpdates: "PT15S",
		});
	}
	return SUBSCRIBE_ESTIMATED_TIMETABLE(params);
}

async function subscribeLine(type: SubscriptionType, lineRef: string): Promise<boolean> {
	const lineId = extractSiriRef(lineRef)[3];
	const subscriptionRef = `${type}-${lineId}-${Date.now()}`;
	const terminationTime = Temporal.Now.instant().add({ minutes: SIRI_SUBSCRIPTION_TTL_MINUTES });

	const body = buildSubscribeBody(type, {
		requestorRef: REQUESTOR_REF,
		consumerAddress: consumerAddress(randomUUID()),
		subscriptionIdentifier: subscriptionRef,
		initialTerminationTime: terminationTime.toString(),
		lineRef,
	});

	try {
		const payload = await requestSiri(SIRI_ENDPOINT, body, { timeoutMs: 20_000 });
		const responseStatus = (
			payload as { Envelope?: { Body?: { SubscribeResponse?: { Answer?: { ResponseStatus?: unknown } } } } }
		)?.Envelope?.Body?.SubscribeResponse?.Answer?.ResponseStatus;
		console.log(`     Subscribe[${type}] '${lineId}' ResponseStatus: ${JSON.stringify(responseStatus)}`);
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
		terminationTime,
	};
	registry.set(registryKey(type, lineRef), state);
	console.log(`✓ Subscribed[${type}] to line '${lineId}' (${subscriptionRef})`);
	return true;
}

async function unsubscribeLine(type: SubscriptionType, lineRef: string): Promise<void> {
	const state = registry.get(registryKey(type, lineRef));
	if (!state) return;

	const lineId = extractSiriRef(lineRef)[3];
	const body = DELETE_SUBSCRIPTION(REQUESTOR_REF, state.subscriptionRef);

	try {
		const payload = await requestSiri(SIRI_ENDPOINT, body, { timeoutMs: 10_000 });
		const terminationStatus = (
			payload as {
				Envelope?: {
					Body?: { DeleteSubscriptionResponse?: { Answer?: { TerminationResponseStatus?: unknown } } };
				};
			}
		)?.Envelope?.Body?.DeleteSubscriptionResponse?.Answer?.TerminationResponseStatus;
		console.log(
			`     Unsubscribe[${type}] '${lineId}' TerminationResponseStatus: ${JSON.stringify(terminationStatus)}`,
		);
		console.log(`✓ Unsubscribed[${type}] from line '${lineId}'`);
	} catch (cause) {
		console.error(`✘ DeleteSubscription[${type}] error for line '${lineId}'`, cause);
	}

	registry.delete(registryKey(type, lineRef));
}

function linesOfType(type: SubscriptionType): string[] {
	const out: string[] = [];
	for (const state of registry.values()) {
		if (state.type === type) out.push(state.lineRef);
	}
	return out;
}

const PER_REQUEST_GAP_MS = 1000;

export async function syncSubscriptions(type: SubscriptionType, monitoredLines: string[]): Promise<void> {
	const desired = new Set(monitoredLines);
	const current = new Set(linesOfType(type));

	const toAdd = [...desired].filter((l) => !current.has(l));
	const toRemove = [...current].filter((l) => !desired.has(l));

	for (const lineRef of toRemove) {
		await unsubscribeLine(type, lineRef);
		await sleep(PER_REQUEST_GAP_MS);
	}

	let successes = 0;
	for (const lineRef of toAdd) {
		const ok = await subscribeLine(type, lineRef);
		if (ok) successes += 1;
		await sleep(PER_REQUEST_GAP_MS);
	}

	if (toAdd.length > 0 && successes === 0 && linesOfType(type).length === 0) {
		throw new Error(`All ${type} subscriptions failed — aborting to let orchestrator restart`);
	}
}

export async function renewAllSubscriptions(): Promise<void> {
	console.log("➔ Renewing all SIRI subscriptions (Subscribe-only, old ones expire via TTL)");
	const entries = [...registry.values()];
	for (const state of entries) {
		await subscribeLine(state.type, state.lineRef);
		await sleep(PER_REQUEST_GAP_MS);
	}
}

export async function terminateAllSubscriptions(): Promise<void> {
	console.log("➔ Terminating all SIRI subscriptions");
	const entries = [...registry.values()];
	await Promise.allSettled(entries.map((s) => unsubscribeLine(s.type, s.lineRef)));
}

export function getRegistrySize(): number {
	return registry.size;
}
