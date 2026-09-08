import type { ShapePoint } from "./import-resource.js";

const EARTH_RADIUS = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;

export type Projection = {
	/** Abscisse curviligne le long du tracé, en mètres. */
	distance: number;
	/** Écart entre la position et le tracé, en mètres. */
	offset: number;
	/** Indice du segment retenu. */
	index: number;
};

/**
 * Projette une position sur le tracé et renvoie l'abscisse curviligne correspondante.
 * La recherche démarre au segment `fromIndex`, ce qui permet de lever l'ambiguïté sur les tracés
 * qui repassent au même endroit (boucles, aller-retours).
 */
export function projectOnShape(
	shape: ShapePoint[],
	latitude: number,
	longitude: number,
	fromIndex = 0,
): Projection | undefined {
	let projection: Projection | undefined;

	for (let index = Math.max(fromIndex, 0); index < shape.length - 1; index += 1) {
		// biome-ignore lint/style/noNonNullAssertion: index is bound by the loop
		const from = shape[index]!;
		// biome-ignore lint/style/noNonNullAssertion: index is bound by the loop
		const to = shape[index + 1]!;

		// Projection équirectangulaire locale : à l'échelle d'un segment de tracé, l'erreur est négligeable.
		const scale = Math.cos(from.latitude * DEG_TO_RAD) * DEG_TO_RAD * EARTH_RADIUS;
		const segmentX = (to.longitude - from.longitude) * scale;
		const segmentY = (to.latitude - from.latitude) * DEG_TO_RAD * EARTH_RADIUS;
		const pointX = (longitude - from.longitude) * scale;
		const pointY = (latitude - from.latitude) * DEG_TO_RAD * EARTH_RADIUS;

		const squaredLength = segmentX * segmentX + segmentY * segmentY;
		const ratio =
			squaredLength === 0 ? 0 : Math.min(Math.max((pointX * segmentX + pointY * segmentY) / squaredLength, 0), 1);

		const offset = Math.hypot(pointX - ratio * segmentX, pointY - ratio * segmentY);
		if (projection !== undefined && offset >= projection.offset) {
			continue;
		}

		projection = { distance: from.distance + ratio * (to.distance - from.distance), offset, index };
	}

	return projection;
}

/** Indice du dernier segment dont le tracé n'a pas encore dépassé `distance`. */
export function findSegmentIndex(shape: ShapePoint[], distance: number) {
	let low = 0;
	let high = shape.length - 1;

	while (low < high) {
		const middle = (low + high + 1) >> 1;
		// biome-ignore lint/style/noNonNullAssertion: middle is bound by the loop
		if (shape[middle]!.distance <= distance) {
			low = middle;
		} else {
			high = middle - 1;
		}
	}

	return low;
}
