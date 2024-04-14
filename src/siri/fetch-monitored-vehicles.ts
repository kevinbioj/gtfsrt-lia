import { GET_VEHICLE_MONITORING } from "~/siri/payloads";
import { requestSiri } from "~/siri/request-siri";

export type VehicleActivity = {
  RecordedAtTime: string;
  VehicleMonitoringRef: string;
  MonitoredVehicleJourney: {
    LineRef: string;
    DirectionName: "A" | "R";
    DestinationRef: string;
    Monitored: boolean;
    Delay: string;
    Bearing: number;
    FramedVehicleJourneyRef?: {
      DatedVehicleJourneyRef: string;
    };
    VehicleLocation?: {
      Coordinates: string;
    };
    MonitoredCall?: {
      Order: number;
      VehicleAtStop: boolean;
      StopPointRef: string;
      StopPointName: string;
      ArrivalStatus: string;
      AimedArrivalTime: string;
      ExpectedArrivalTime: string;
      DepartureStatus: string;
      AimedDepartureTime: string;
      ExpectedDepartureTime: string;
    };
  };
};

export async function fetchMonitoredVehicles(siriEndpoint: string, requestorRef: string, lineRef: string) {
  const payload = await requestSiri(siriEndpoint, GET_VEHICLE_MONITORING(requestorRef, lineRef));
  const vehicleActivities = payload.Envelope.Body.GetVehicleMonitoringResponse.Answer.VehicleMonitoringDelivery
    .VehicleActivity as VehicleActivity | VehicleActivity[] | undefined;
  if (typeof vehicleActivities === "undefined") return [];
  return Array.isArray(vehicleActivities) ? vehicleActivities : [vehicleActivities];
}
