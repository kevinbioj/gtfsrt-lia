import Cron from 'croner';
import dayjs from 'dayjs';
import { Hono } from 'hono';
import proj4 from 'proj4';
import type {
  Trip,
  TripUpdateEntity,
  VehiclePositionEntity,
} from '~/gtfs/@types';
import { downloadStaticResource } from '~/gtfs/download-resource';
import { computeSiriEntries } from '~/siri/compute-entries';
import { checkCalendar } from '~/utils/check-calendar';
import { parseSiriRef } from '~/utils/parse-ref';

import '~/utils/parse-time';
import { parseTime } from '~/utils/parse-time';

const server = new Hono();

const gtfsHref =
  'https://www.data.gouv.fr/fr/datasets/r/1e666e24-58ee-46b9-8952-ea2755ba88f2';
const siriWsdl = 'https://opendata.siri.transports-lia.fr/api?wsdl';

const onlineLineRefs = [
  'LIAOD:Line::T:LOC',
  'LIAOD:Line::01:LOC',
  'LIAOD:Line::02:LOC',
  'LIAOD:Line::03:LOC',
];

let trips: Trip[] | null = null;

let currentVehiclePositions: VehiclePositionEntity[] = [];
let currentTripUpdates: TripUpdateEntity[] = [];

//- UPDATE GTFS RESOURCE

async function updateGtfsResource() {
  console.log('GTFS     Updating GTFS resource...');
  try {
    const updatedTrips = await downloadStaticResource(gtfsHref);
    trips = updatedTrips;
    console.log('GTFS     Finished updating GTFS resource!');
  } catch (e: unknown) {
    const stack = e instanceof Error ? e.stack : e;
    console.error(
      'GTFS     Failed to update resource, check out stack trace below:'
    );
    console.error(stack);
  }
}

Cron('0 0 * * * *', updateGtfsResource);

//- UPDATE GTFS-RT ENTRIES

async function updateGtfsRtEntries() {
  if (trips === null) {
    console.error('GTFS-RT  Ignoring entries update as resource is not ready');
    return;
  }
  console.log(
    'GTFS-RT  Downloading all entries from SIRI VehicleMonitoring...'
  );
  const vehicles = (
    await Promise.all(
      onlineLineRefs.map((lineRef) => computeSiriEntries(siriWsdl, lineRef))
    )
  ).flat();

  const vehiclePositions: VehiclePositionEntity[] = [];
  const tripUpdates: TripUpdateEntity[] = [];
  console.log('GTFS-RT  Processing vehicles to build up GTFS-RT...');
  vehicles.forEach((vehicle) => {
    if (typeof vehicle === 'undefined') return;
    const id = parseSiriRef(vehicle.MonitoredVehicleJourney.VehicleRef);
    if (typeof vehicle.MonitoredVehicleJourney.MonitoredCall === 'undefined')
      return console.warn(
        `GTFS-RT  Vehicle '${id}' has no monitored call, ignoring.`
      );
    if (typeof vehicle.MonitoredVehicleJourney.VehicleLocation === 'undefined')
      return console.warn(
        `GTFS-RT  Vehicle '${id}' has no available position, ignoring.`
      );
    const compatibleTrips =
      trips?.filter((t) => {
        if (t.route !== parseSiriRef(vehicle.MonitoredVehicleJourney.LineRef))
          return false;
        if (
          t.stops.at(-1)!.stop.id !==
          parseSiriRef(vehicle.MonitoredVehicleJourney.DestinationRef)
        )
          return false;
        if (!checkCalendar(t.calendar)) return false;
        const monitoredStopTime = t.stops.find(
          (s) =>
            s.stop.id ===
            parseSiriRef(
              vehicle.MonitoredVehicleJourney.MonitoredCall.StopPointRef
            )
        );
        if (typeof monitoredStopTime === 'undefined') return false;
        if (
          !dayjs(
            vehicle.MonitoredVehicleJourney.MonitoredCall.AimedArrivalTime
          ).isSame(parseTime(monitoredStopTime.time), 'minute')
        )
          return false;
        return true;
      }) ?? [];
    if (compatibleTrips.length === 0)
      return console.warn(
        `GTFS-RT  No trip found for vehicle '${id}', ignoring.`
      );
    if (compatibleTrips.length > 1)
      return console.warn(
        `GTFS-RT  Too many trips found for vehicle '${id}', ignoring: ${compatibleTrips
          .map((t) => t.id)
          .join(', ')}.`
      );

    const [trip] = compatibleTrips;
    const currentStopTime = trip.stops.find(
      (s) =>
        s.stop.id ===
        parseSiriRef(vehicle.MonitoredVehicleJourney.MonitoredCall.StopPointRef)
    )!;
    const delay = dayjs(
      vehicle.MonitoredVehicleJourney.MonitoredCall.ExpectedArrivalTime
    ).diff(
      vehicle.MonitoredVehicleJourney.MonitoredCall.AimedArrivalTime,
      'seconds'
    );
    const [x, y] =
      vehicle.MonitoredVehicleJourney.VehicleLocation?.Coordinates.split(' ');

    const [latitude, longitude] = proj4(
      '+proj=lcc +lat_1=46.8 +lat_0=46.8 +lon_0=0 +k_0=0.99987742 +x_0=600000 +y_0=2200000 +a=6378249.2 +b=6356515 +towgs84=-168,-60,320,0,0,0,0 +pm=paris +units=m +no_defs',
      '+proj=longlat +datum=WGS84 +no_defs',
      [+x, +y]
    );

    tripUpdates.push({
      id: `SM:${trip.id}`,
      tripUpdate: {
        stopTimeUpdate: trip.stops
          .filter((s) => s.sequence >= currentStopTime.sequence)
          .map((stopTime) => {
            return {
              scheduleRelationship: 'SCHEDULED' as const,
              arrival: {
                delay,
                time: parseTime(stopTime.time)
                  .add(delay, 'seconds')
                  .unix()
                  .toString(),
              },
              stopId: stopTime.stop.id,
              stopSequence: stopTime.sequence,
            };
          }),
        timestamp: dayjs(vehicle.RecordedAtTime).unix().toString(),
        trip: {
          tripId: trip.id,
          routeId: trip.route,
          directionId: trip.direction,
        },
        vehicle: {
          id,
          label: id,
        },
      },
    });
    vehiclePositions.push({
      id: `VM:${id}`,
      vehicle: {
        bearing: +vehicle.MonitoredVehicleJourney.Bearing,
        currentStatus:
          vehicle.MonitoredVehicleJourney.MonitoredCall.VehicleAtStop === 'true'
            ? 'STOPPED_AT'
            : 'IN_TRANSIT_TO',
        currentStopSequence: currentStopTime.sequence,
        position: {
          latitude,
          longitude,
        },
        timestamp: dayjs(vehicle.RecordedAtTime).unix().toString(),
        trip: {
          tripId: trip.id,
          routeId: trip.route,
          directionId: trip.direction,
        },
        vehicle: {
          id,
          label: id,
        },
      },
    });
  });
  currentTripUpdates = tripUpdates;
  currentVehiclePositions = vehiclePositions;
}

updateGtfsResource().then(async () => {
  await updateGtfsRtEntries();
  Cron('0,30 * * * * *', updateGtfsRtEntries);
});

server.get('/gtfs-rt.json', (c) => {
  return c.json({
    header: {
      gtfs_realtime_version: '2.0',
      timestamp: dayjs().unix().toString(),
    },
    entity: [...currentTripUpdates, ...currentVehiclePositions],
  });
});

server.get('/gtfs-rt/vehicle-positions.json', (c) => {
  return c.json({
    header: {
      gtfs_realtime_version: '2.0',
      timestamp: dayjs().unix().toString(),
    },
    entity: currentVehiclePositions,
  });
});

server.get('/gtfs-rt/trip-updates.json', (c) => {
  return c.json({
    header: {
      gtfs_realtime_version: '2.0',
      timestamp: dayjs().unix().toString(),
    },
    entity: currentTripUpdates,
  });
});

export const port = 40505;
export default server;
