import GtfsRealtime from "gtfs-realtime-bindings";

import { ALERTS_POLL_INTERVAL_MS, SERVICE_ALERTS_URL } from "../config.js";
import { htmlToText } from "../utils/sanitize-html.js";

const { Effect } = GtfsRealtime.transit_realtime.Alert;

const TIME_ZONE = "Europe/Paris";
/** Le réseau LiA chez Cityway : une ligne d'un autre réseau n'a pas d'équivalent dans le GTFS. */
const NETWORK_ID = 25;
const AGENCY_ID = "LIA";

type DisruptionStop = { code: string };

type DisruptionLine = {
	code: string;
	networkId: number;
	affectedDirections: { internalId: number; affectedStops: DisruptionStop[] }[];
};

type DisruptionCode = { code: string } | null;

type Disruption = {
	internalId: number;
	title: string;
	description: string | null;
	isPublished: boolean;
	effect: DisruptionCode;
	effectiveStartDate: string | null;
	effectiveEndDate: string | null;
	publicationStartDate: string | null;
	publicationEndDate: string | null;
	affectedLines: DisruptionLine[];
	affectedStops: DisruptionStop[];
	affectedNetworks: unknown[];
};

type DisruptionsResponse = { statusCode: number; message: string | null; data: Disruption[] };

/**
 * L'effet d'une perturbation, lu dans son texte faute d'être renseigné par l'exploitant. La première
 * règle qui correspond l'emporte : un « Nouvel itinéraire » qui cite ses « arrêts provisoires » est
 * une déviation, pas un arrêt déplacé.
 *
 * `null` désigne l'arrêt non desservi, dont l'effet dépend de ce que l'alerte cible (cf. `matchEffect`).
 */
const EFFECT_RULES: [RegExp, GtfsRealtime.transit_realtime.Alert.Effect | null][] = [
	[/\bascenseurs?\b|\bescalators?\b|escaliers? mecaniques?|accessibilite|\bpmr\b/, Effect.ACCESSIBILITY_ISSUE],
	[
		/interromp|ne circulen?t? pas|ne circuleront pas|aucun (bus|tram|service|vehicule)|suspendue?s?\b|pas de service|trafic coupe|(ligne|service) (non assuree?|supprimee?)/,
		Effect.NO_SERVICE,
	],
	[/\bdevi(e|ee|es|ees|ation|ations)\b|nouvel itineraire|itineraire modifie|\bemprunte(ra|nt|ront)?\b/, Effect.DETOUR],
	[
		/\breport(e|ee|es|ees)\b|\bdeplace(e|es|ees)?\b|(arret|poteau|terminus) provisoire|\btransfere(e|es|ees)?\b/,
		Effect.STOP_MOVED,
	],
	[/non desservie?s?|pas desservie?s?|ne dessert (pas|plus)|ne desservira pas/, null],
	[/\bretards?\b|ralenti/, Effect.SIGNIFICANT_DELAYS],
	[/renfort|supplementaire|\bnavettes?\b/, Effect.ADDITIONAL_SERVICE],
	[/frequence reduite|service reduit|allege|reduction/, Effect.REDUCED_SERVICE],
	[/horaires? modifies?|modification|substitution/, Effect.MODIFIED_SERVICE],
];

export function useServiceAlerts() {
	const store = {
		serviceAlerts: [] as GtfsRealtime.transit_realtime.IFeedEntity[],
		serviceAlertsTimestamp: 0,
	};

	async function pollAlerts() {
		const response = await fetch(SERVICE_ALERTS_URL, { signal: AbortSignal.timeout(10_000) });

		if (!response.ok) {
			throw new Error(`Failed to fetch disruptions at '${SERVICE_ALERTS_URL}' (HTTP ${response.status})`);
		}

		const payload = (await response.json()) as DisruptionsResponse;
		if (payload.statusCode !== 200 || !Array.isArray(payload.data)) {
			throw new Error(`Disruptions API answered with status ${payload.statusCode} (${payload.message})`);
		}

		const now = Date.now() / 1000;
		store.serviceAlerts = payload.data.flatMap((disruption) => {
			if (!disruption.isPublished) return [];

			const publicationEnd = toEpoch(disruption.publicationEndDate);
			if (publicationEnd !== undefined && publicationEnd < now) return [];

			return [toAlertEntity(disruption)];
		});
		store.serviceAlertsTimestamp = Math.floor(now);
	}

	async function poll() {
		const startedAt = Date.now();

		try {
			await pollAlerts();
		} catch (cause) {
			console.error("✘ Service alerts poll failed, keeping last known feed", cause);
		}

		setTimeout(poll, Math.max(ALERTS_POLL_INTERVAL_MS - (Date.now() - startedAt), 0));
	}

	void poll();

	return store;
}

function toAlertEntity(disruption: Disruption): GtfsRealtime.transit_realtime.IFeedEntity {
	const informedEntity = informedEntities(disruption);
	const description = htmlToText(disruption.description ?? "");

	const activePeriod = toTimeRange(disruption.effectiveStartDate, disruption.effectiveEndDate);
	const communicationPeriod = toTimeRange(disruption.publicationStartDate, disruption.publicationEndDate);

	return {
		id: `SA:${disruption.internalId}`,
		alert: {
			activePeriod: activePeriod !== undefined ? [activePeriod] : [],
			communicationPeriod: communicationPeriod !== undefined ? [communicationPeriod] : [],
			informedEntity,
			effect: matchEffect(disruption, description, informedEntity),
			headerText: { translation: [{ text: disruption.title, language: "fr" }] },
			descriptionText: description.length > 0 ? { translation: [{ text: description, language: "fr" }] } : null,
		},
	};
}

/**
 * Ce que la perturbation cible. Les identifiants Cityway sont ceux du GTFS : le `code` d'une ligne
 * est son `route_id`, le `code` d'un arrêt son `stop_id`, et ses sens 1 et 2 sont les `direction_id`
 * 0 et 1.
 *
 * Un sens qui cite des arrêts ne concerne qu'eux ; une ligne citée dans tous ses sens sans arrêt la
 * concerne tout entière.
 */
function informedEntities(disruption: Disruption): GtfsRealtime.transit_realtime.IEntitySelector[] {
	const entities: GtfsRealtime.transit_realtime.IEntitySelector[] = [];

	for (const line of disruption.affectedLines ?? []) {
		if (line.networkId !== NETWORK_ID) continue;

		const routeId = line.code;
		const directions = (line.affectedDirections ?? []).filter(({ internalId }) => internalId === 1 || internalId === 2);

		const wholeLine =
			directions.every((direction) => direction.affectedStops.length === 0) &&
			(directions.length === 0 || new Set(directions.map(({ internalId }) => internalId)).size === 2);
		if (wholeLine) {
			entities.push({ routeId });
			continue;
		}

		for (const direction of directions) {
			const directionId = direction.internalId - 1;
			if (direction.affectedStops.length === 0) {
				entities.push({ routeId, directionId });
				continue;
			}
			for (const stop of direction.affectedStops) entities.push({ routeId, directionId, stopId: stop.code });
		}
	}

	for (const stop of disruption.affectedStops ?? []) entities.push({ stopId: stop.code });

	if ((disruption.affectedNetworks ?? []).length > 0 || entities.length === 0) entities.push({ agencyId: AGENCY_ID });

	// Un même arrêt peut revenir dans plusieurs sens d'une ligne qui le dessert dans les deux.
	const seen = new Set<string>();
	return entities.filter((entity) => {
		const key = `${entity.agencyId}|${entity.routeId}|${entity.directionId}|${entity.stopId}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function matchEffect(
	disruption: Disruption,
	description: string,
	informedEntity: GtfsRealtime.transit_realtime.IEntitySelector[],
): GtfsRealtime.transit_realtime.Alert.Effect {
	const upstream = fromUpstream(Effect, disruption.effect?.code);
	if (upstream !== undefined) return upstream;

	// Le titre résume l'effet ; la description, plus bavarde, ne sert qu'à défaut.
	for (const text of [disruption.title, description]) {
		const normalized = normalize(text);
		const rule = EFFECT_RULES.find(([pattern]) => pattern.test(normalized));
		if (rule === undefined) continue;

		const [, effect] = rule;
		if (effect !== null) return effect;

		// Un arrêt non desservi : sans arrêt ciblé, NO_SERVICE se lirait sur tout le sens de la ligne.
		return informedEntity.some((entity) => entity.stopId) ? Effect.NO_SERVICE : Effect.REDUCED_SERVICE;
	}

	return Effect.UNKNOWN_EFFECT;
}

/**
 * L'effet GTFS-RT depuis le code que Cityway renseigne pour d'autres exploitants,
 * tantôt tel quel (`STOP_MOVED`), tantôt en PascalCase (`OtherEffect`).
 */
function fromUpstream<T extends number>(values: Record<string, T | string>, code: string | undefined): T | undefined {
	if (!code) return undefined;
	const value = values[code.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()];
	return typeof value === "number" ? value : undefined;
}

/** Le texte en minuscules, sans accents ni apostrophes typographiques, pour la recherche de mots-clés. */
function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.replace(/[’‘]/g, "'")
		.toLowerCase();
}

/** Les dates Cityway sont locales et sans décalage : « 2026-04-28T08:45:00 ». */
function toEpoch(date: string | null): number | undefined {
	if (!date) return undefined;
	return Temporal.PlainDateTime.from(date).toZonedDateTime(TIME_ZONE).epochMilliseconds / 1000;
}

function toTimeRange(start: string | null, end: string | null): GtfsRealtime.transit_realtime.ITimeRange | undefined {
	const range = { start: toEpoch(start), end: toEpoch(end) };
	return range.start !== undefined || range.end !== undefined ? range : undefined;
}
