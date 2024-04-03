import { exec } from 'node:child_process';
import { join } from 'node:path';

import { groupBy } from '~/utils/group-by';
import { parseCsv } from '~/utils/parse-csv';
import type { Calendar, Stop, Trip } from '~/gtfs/@types';

const $ = (command: string) =>
  new Promise<string>((resolve, reject) =>
    exec(command, (error, stdout) => {
      if (error !== null) reject(error);
      else resolve(stdout.trim());
    })
  );

export async function downloadStaticResource(href: string) {
  const tmpdir = await $('mktemp -d');
  await $(`wget -T 10 -O "${join(tmpdir, 'gtfs.zip')}" "${href}"`);
  await $(`unzip -o ${join(tmpdir, 'gtfs.zip')} -d ${tmpdir}`);
  const [calendars, stops] = await Promise.all([
    loadCalendars(tmpdir),
    loadStops(tmpdir),
  ]);
  const trips = await loadTrips(tmpdir, calendars, stops);
  await $(`rm -r "${tmpdir}"`);
  return trips;
}

// ---

async function loadCalendars(resourcePath: string) {
  const calendars = await Bun.file(join(resourcePath, 'calendar.txt'))
    .text()
    .then(parseCsv)
    .catch(() => []);
  const calendarDates = await Bun.file(join(resourcePath, 'calendar_dates.txt'))
    .text()
    .then(parseCsv)
    .catch(() => []);
  const calendarSet = calendars.reduce((calendars, calendar) => {
    calendars.set(calendar.service_id, {
      id: calendar.service_id,
      days: [
        !!+calendar.sunday,
        !!+calendar.monday,
        !!+calendar.tuesday,
        !!+calendar.wednesday,
        !!+calendar.thursday,
        !!+calendar.friday,
        !!+calendar.saturday,
      ],
      blacklist: [],
      whitelist: [],
      from: calendar.start_date,
      to: calendar.end_date,
    });
    return calendars;
  }, new Map<string, Calendar>());
  calendarDates.forEach((calendarDate) => {
    if (!calendarSet.has(calendarDate.service_id)) {
      calendarSet.set(calendarDate.service_id, {
        id: calendarDate.service_id,
        days: [false, false, false, false, false, false, false],
        blacklist: [],
        whitelist: [],
        from: '20000101',
        to: '20991231',
      });
    }
    const calendar = calendarSet.get(calendarDate.service_id)!;
    switch (+calendarDate.exception_type) {
      case 1:
        calendar.whitelist.push(calendarDate.date);
        break;
      case 2:
        calendar.blacklist.push(calendarDate.date);
        break;
      default:
    }
  });
  return calendarSet;
}

async function loadStops(resourcePath: string) {
  const stops = await Bun.file(join(resourcePath, 'stops.txt'))
    .text()
    .then(parseCsv);
  return stops.reduce((stops, stop) => {
    stops.set(stop.stop_id, {
      id: stop.stop_id,
      name: stop.stop_name,
      lat: +stop.stop_lat,
      lon: +stop.stop_lon,
    });
    return stops;
  }, new Map<string, Stop>());
}

async function loadTrips(
  resourcePath: string,
  calendars: Map<string, Calendar>,
  stops: Map<string, Stop>
) {
  const trips = await Bun.file(join(resourcePath, 'trips.txt'))
    .text()
    .then(parseCsv);
  const stopTimes = groupBy(
    await Bun.file(join(resourcePath, 'stop_times.txt')).text().then(parseCsv),
    (stopTime) => stopTime.trip_id
  );
  return trips.map(
    (trip) =>
      ({
        id: trip.trip_id,
        calendar: calendars.get(trip.service_id)!,
        block: trip.block_id || null,
        route: trip.route_id,
        direction: +trip.direction_id,
        headsign: trip.trip_headsign,
        stops: (stopTimes.get(trip.trip_id) ?? [])
          .map((stopTime) => ({
            sequence: +stopTime.stop_sequence,
            stop: stops.get(stopTime.stop_id)!,
            time: stopTime.departure_time,
            distanceTraveled: stopTime.shape_dist_traveled
              ? +stopTime.shape_dist_traveled
              : null,
          }))
          .sort((a, b) => a.sequence - b.sequence),
      } as Trip)
  );
}
