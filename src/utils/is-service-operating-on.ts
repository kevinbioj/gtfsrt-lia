import { Temporal } from "temporal-polyfill";

import type { Service } from "../gtfs/import-resource.js";

const cache = new Map<string, boolean>();

export function isServiceOperatingOn(service: Service, date: Temporal.PlainDate) {
	const cached = cache.get(service.id);
	if (cached !== undefined) {
		return cached;
	}

	if (service.includedDays.some((d) => d.equals(date))) {
		cache.set(service.id, true);
		return true;
	}

	if (service.excludedDays.some((d) => d.equals(date))) {
		cache.set(service.id, false);
		return false;
	}

	if (
		Temporal.PlainDate.compare(date, service.startDate) < 0 ||
		Temporal.PlainDate.compare(date, service.endDate) > 0
	) {
		cache.set(service.id, false);
		return false;
	}

	const workingOnDay = service.days[date.dayOfWeek];
	cache.set(service.id, workingOnDay);
	return workingOnDay;
}
