import { XMLParser } from "fast-xml-parser";

export const siriXmlParser = new XMLParser({
	htmlEntities: true,
	removeNSPrefix: true,
});

export type RequestSiriOptions = {
	timeoutMs?: number;
};

export async function requestSiri(siriEndpoint: string, body: string, options: RequestSiriOptions = {}) {
	const response = await fetch(siriEndpoint, {
		body,
		headers: { "Content-Type": "application/xml" },
		method: "POST",
		signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
	});

	const serialized = await response.text();

	if (!response.ok) {
		throw new Error(
			`SIRI request failed: HTTP ${response.status} ${response.statusText} — ${serialized.slice(0, 500)}`,
		);
	}

	return siriXmlParser.parse(serialized);
}
