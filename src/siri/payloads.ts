import { randomUUID } from "node:crypto";

export const LINES_DISCOVERY = (requestorRef: string) =>
	`<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
    <S:Body>
      <sw:LinesDiscovery xmlns:sw="http://wsdl.siri.org.uk" xmlns:siri="http://www.siri.org.uk/siri">
        <Request>
          <siri:RequestTimestamp>${Temporal.Now.zonedDateTimeISO("Europe/Paris").toString({ timeZoneName: "never" })}</siri:RequestTimestamp>
          <siri:RequestorRef>${requestorRef}</siri:RequestorRef>
          <siri:MessageIdentifier>BUS-TRACKER.FR::Message::${randomUUID()}</siri:MessageIdentifier>
        </Request>
        <RequestExtension/>
      </sw:LinesDiscovery>
    </S:Body>
  </S:Envelope>`;

export const GET_VEHICLE_MONITORING = (requestorRef: string, lineRef: string) => {
	const requestTimestamp = Temporal.Now.zonedDateTimeISO("Europe/Paris").toString({ timeZoneName: "never" });
	const messageIdentifier = `BUS-TRACKER.FR::Message::${randomUUID()}`;
	return `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
      <S:Body>
        <sw:GetVehicleMonitoring xmlns:sw="http://wsdl.siri.org.uk" xmlns:siri="http://www.siri.org.uk/siri">
          <ServiceRequestInfo>
            <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
            <siri:RequestorRef>${requestorRef}</siri:RequestorRef>
            <siri:MessageIdentifier>${messageIdentifier}</siri:MessageIdentifier>
          </ServiceRequestInfo>
          <Request version="2.0:FR-IDF-2.4">
            <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
            <siri:MessageIdentifier>${messageIdentifier}</siri:MessageIdentifier>
            <siri:LineRef>${lineRef}</siri:LineRef>
          </Request>
          <RequestExtension/>
        </sw:GetVehicleMonitoring>
      </S:Body>
    </S:Envelope>`;
};

export type GetEstimatedTimetableInput = {
	requestorRef: string;
	lineRef: string;
	previewInterval?: string;
	startTime?: string;
	directionRef?: string;
	operatorRef?: string;
	includeRegularJourney?: boolean;
	language?: string;
};

export const GET_ESTIMATED_TIMETABLE = ({
	requestorRef,
	lineRef,
	previewInterval = "PT1H",
	startTime,
	directionRef,
	operatorRef,
	includeRegularJourney,
	language,
}: GetEstimatedTimetableInput) => {
	const requestTimestamp = Temporal.Now.zonedDateTimeISO("Europe/Paris").toString({ timeZoneName: "never" });
	const messageIdentifier = `BUS-TRACKER.FR::Message::${randomUUID()}`;
	const tag = (name: string, value: string | number | boolean | undefined) =>
		value === undefined ? "" : `<siri:${name}>${value}</siri:${name}>`;
	return `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
      <S:Body>
        <sw:GetEstimatedTimetable xmlns:sw="http://wsdl.siri.org.uk" xmlns:siri="http://www.siri.org.uk/siri">
          <ServiceRequestInfo>
            <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
            <siri:RequestorRef>${requestorRef}</siri:RequestorRef>
            <siri:MessageIdentifier>${messageIdentifier}</siri:MessageIdentifier>
          </ServiceRequestInfo>
          <Request version="2.0:FR-IDF-2.4">
            <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
            <siri:MessageIdentifier>${messageIdentifier}</siri:MessageIdentifier>
            ${tag("StartTime", startTime)}
            ${tag("PreviewInterval", previewInterval)}
            ${tag("Language", language)}
            <siri:Lines>
              <siri:LineDirection>
                <siri:LineRef>${lineRef}</siri:LineRef>
                ${tag("DirectionRef", directionRef)}
              </siri:LineDirection>
            </siri:Lines>
            ${operatorRef ? `<siri:Operators><siri:OperatorRef>${operatorRef}</siri:OperatorRef></siri:Operators>` : ""}
            ${tag("IncludeRegularJourney", includeRegularJourney)}
          </Request>
          <RequestExtension/>
        </sw:GetEstimatedTimetable>
      </S:Body>
    </S:Envelope>`;
};

export type SubscribeVehicleMonitoringInput = {
	requestorRef: string;
	consumerAddress: string;
	subscriptionIdentifier: string;
	initialTerminationTime: string;
	lineRef: string;
	previewInterval?: string;
	startTime?: string;
	directionRef?: string;
	destinationRef?: string;
	operatorRef?: string;
	vehicleRef?: string;
	vehicleMonitoringRef?: string;
	vehicleMonitoringDetailLevel?: "minimum" | "basic" | "normal" | "calls" | "full";
	maximumVehicles?: number;
	language?: string;
	incrementalUpdates?: boolean;
	updateInterval?: string;
	changeBeforeUpdates?: string;
};

export const SUBSCRIBE_VEHICLE_MONITORING = ({
	requestorRef,
	consumerAddress,
	subscriptionIdentifier,
	initialTerminationTime,
	lineRef,
	previewInterval,
	startTime,
	directionRef,
	destinationRef,
	operatorRef,
	vehicleRef,
	vehicleMonitoringRef,
	vehicleMonitoringDetailLevel,
	maximumVehicles,
	language,
	incrementalUpdates,
	updateInterval,
	changeBeforeUpdates,
}: SubscribeVehicleMonitoringInput) => {
	const requestTimestamp = Temporal.Now.zonedDateTimeISO("Europe/Paris").toString({ timeZoneName: "never" });
	const messageIdentifier = `BUS-TRACKER.FR::Message::${randomUUID()}`;
	const tag = (name: string, value: string | number | boolean | undefined) =>
		value === undefined ? "" : `<siri:${name}>${value}</siri:${name}>`;
	return `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
      <S:Body>
        <sw:Subscribe xmlns:sw="http://wsdl.siri.org.uk" xmlns:siri="http://www.siri.org.uk/siri">
          <SubscriptionRequestInfo>
            <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
            <siri:RequestorRef>${requestorRef}</siri:RequestorRef>
            <siri:MessageIdentifier>${messageIdentifier}</siri:MessageIdentifier>
            <siri:ConsumerAddress>${consumerAddress}</siri:ConsumerAddress>
          </SubscriptionRequestInfo>
          <Request version="2.0:FR-IDF-2.4">
            <siri:VehicleMonitoringSubscriptionRequest>
              <siri:SubscriberRef>${requestorRef}</siri:SubscriberRef>
              <siri:SubscriptionIdentifier>${subscriptionIdentifier}</siri:SubscriptionIdentifier>
              <siri:InitialTerminationTime>${initialTerminationTime}</siri:InitialTerminationTime>
              <siri:VehicleMonitoringRequest version="2.0:FR-IDF-2.4">
                <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
                <siri:MessageIdentifier>${messageIdentifier}</siri:MessageIdentifier>
                ${tag("PreviewInterval", previewInterval)}
                ${tag("StartTime", startTime)}
                <siri:LineRef>${lineRef}</siri:LineRef>
                ${tag("DirectionRef", directionRef)}
                ${tag("DestinationRef", destinationRef)}
                ${tag("OperatorRef", operatorRef)}
                ${tag("VehicleRef", vehicleRef)}
                ${tag("VehicleMonitoringRef", vehicleMonitoringRef)}
                ${tag("VehicleMonitoringDetailLevel", vehicleMonitoringDetailLevel)}
                ${tag("MaximumVehicles", maximumVehicles)}
                ${tag("Language", language)}
              </siri:VehicleMonitoringRequest>
              ${tag("IncrementalUpdates", incrementalUpdates)}
              ${tag("UpdateInterval", updateInterval)}
              ${tag("ChangeBeforeUpdates", changeBeforeUpdates)}
            </siri:VehicleMonitoringSubscriptionRequest>
          </Request>
          <RequestExtension/>
        </sw:Subscribe>
      </S:Body>
    </S:Envelope>`;
};

export const DELETE_SUBSCRIPTION = (requestorRef: string, subscriptionIdentifier: string) => {
	const requestTimestamp = Temporal.Now.zonedDateTimeISO("Europe/Paris").toString({ timeZoneName: "never" });
	const messageIdentifier = `BUS-TRACKER.FR::Message::${randomUUID()}`;
	return `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
      <S:Body>
        <sw:DeleteSubscription xmlns:sw="http://wsdl.siri.org.uk" xmlns:siri="http://www.siri.org.uk/siri">
          <DeleteSubscriptionInfo>
            <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
            <siri:RequestorRef>${requestorRef}</siri:RequestorRef>
            <siri:MessageIdentifier>${messageIdentifier}</siri:MessageIdentifier>
          </DeleteSubscriptionInfo>
          <Request>
            <siri:SubscriberRef>${requestorRef}</siri:SubscriberRef>
            <siri:SubscriptionRef>${subscriptionIdentifier}</siri:SubscriptionRef>
          </Request>
          <RequestExtension/>
        </sw:DeleteSubscription>
      </S:Body>
    </S:Envelope>`;
};

export const CHECK_STATUS = (requestorRef: string) => {
	const requestTimestamp = Temporal.Now.zonedDateTimeISO("Europe/Paris").toString({ timeZoneName: "never" });
	const messageIdentifier = `BUS-TRACKER.FR::Message::${randomUUID()}`;
	return `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
      <S:Body>
        <sw:CheckStatus xmlns:sw="http://wsdl.siri.org.uk" xmlns:siri="http://www.siri.org.uk/siri">
          <Request>
            <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
            <siri:RequestorRef>${requestorRef}</siri:RequestorRef>
            <siri:MessageIdentifier>${messageIdentifier}</siri:MessageIdentifier>
          </Request>
          <RequestExtension/>
        </sw:CheckStatus>
      </S:Body>
    </S:Envelope>`;
};

export type SubscribeEstimatedTimetableInput = {
	requestorRef: string;
	consumerAddress: string;
	subscriptionIdentifier: string;
	initialTerminationTime: string;
	lineRef: string;
	previewInterval?: string;
	startTime?: string;
	directionRef?: string;
	operatorRef?: string;
	includeRegularJourney?: boolean;
	language?: string;
	incrementalUpdates?: boolean;
	changeBeforeUpdates?: string;
};

export const SUBSCRIBE_ESTIMATED_TIMETABLE = ({
	requestorRef,
	consumerAddress,
	subscriptionIdentifier,
	initialTerminationTime,
	lineRef,
	previewInterval = "PT2H",
	startTime,
	directionRef,
	operatorRef,
	includeRegularJourney,
	language,
	incrementalUpdates,
	changeBeforeUpdates,
}: SubscribeEstimatedTimetableInput) => {
	const requestTimestamp = Temporal.Now.zonedDateTimeISO("Europe/Paris").toString({ timeZoneName: "never" });
	const messageIdentifier = `BUS-TRACKER.FR::Message::${randomUUID()}`;
	const tag = (name: string, value: string | number | boolean | undefined) =>
		value === undefined ? "" : `<siri:${name}>${value}</siri:${name}>`;
	return `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
      <S:Body>
        <sw:Subscribe xmlns:sw="http://wsdl.siri.org.uk" xmlns:siri="http://www.siri.org.uk/siri">
          <SubscriptionRequestInfo>
            <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
            <siri:RequestorRef>${requestorRef}</siri:RequestorRef>
            <siri:MessageIdentifier>${messageIdentifier}</siri:MessageIdentifier>
            <siri:ConsumerAddress>${consumerAddress}</siri:ConsumerAddress>
          </SubscriptionRequestInfo>
          <Request version="2.0:FR-IDF-2.4">
            <siri:EstimatedTimetableSubscriptionRequest>
              <siri:SubscriberRef>${requestorRef}</siri:SubscriberRef>
              <siri:SubscriptionIdentifier>${subscriptionIdentifier}</siri:SubscriptionIdentifier>
              <siri:InitialTerminationTime>${initialTerminationTime}</siri:InitialTerminationTime>
              <siri:EstimatedTimetableRequest version="2.0:FR-IDF-2.4">
                <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
                <siri:MessageIdentifier>${messageIdentifier}</siri:MessageIdentifier>
                ${tag("StartTime", startTime)}
                ${tag("PreviewInterval", previewInterval)}
                ${tag("Language", language)}
                <siri:Lines>
                  <siri:LineDirection>
                    <siri:LineRef>${lineRef}</siri:LineRef>
                    ${tag("DirectionRef", directionRef)}
                  </siri:LineDirection>
                </siri:Lines>
                ${operatorRef ? `<siri:Operators><siri:OperatorRef>${operatorRef}</siri:OperatorRef></siri:Operators>` : ""}
                ${tag("IncludeRegularJourney", includeRegularJourney)}
              </siri:EstimatedTimetableRequest>
              ${tag("IncrementalUpdates", incrementalUpdates)}
              ${tag("ChangeBeforeUpdates", changeBeforeUpdates)}
            </siri:EstimatedTimetableSubscriptionRequest>
          </Request>
          <RequestExtension/>
        </sw:Subscribe>
      </S:Body>
    </S:Envelope>`;
};

export type NotifyResponseInput = {
	requestorRef: string;
	requestMessageRef: string;
	status: boolean;
};

function notifyResponseEnvelope(wrapper: string, { requestorRef, requestMessageRef, status }: NotifyResponseInput) {
	const responseTimestamp = Temporal.Now.zonedDateTimeISO("Europe/Paris").toString({ timeZoneName: "never" });
	return `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
      <S:Body>
        <sw:${wrapper} xmlns:sw="http://wsdl.siri.org.uk" xmlns:siri="http://www.siri.org.uk/siri">
          <SubscriptionAnswerInfo>
            <siri:ResponseTimestamp>${responseTimestamp}</siri:ResponseTimestamp>
            <siri:ResponderRef>${requestorRef}</siri:ResponderRef>
            <siri:RequestMessageRef>${requestMessageRef}</siri:RequestMessageRef>
          </SubscriptionAnswerInfo>
          <Answer>
            <siri:ResponseTimestamp>${responseTimestamp}</siri:ResponseTimestamp>
            <siri:ResponderRef>${requestorRef}</siri:ResponderRef>
            <siri:Status>${status}</siri:Status>
          </Answer>
          <AnswerExtension/>
        </sw:${wrapper}>
      </S:Body>
    </S:Envelope>`;
}

export const NOTIFY_VEHICLE_MONITORING_RESPONSE = (input: NotifyResponseInput) =>
	notifyResponseEnvelope("NotifyVehicleMonitoringResponse", input);

export const NOTIFY_ESTIMATED_TIMETABLE_RESPONSE = (input: NotifyResponseInput) =>
	notifyResponseEnvelope("NotifyEstimatedTimetableResponse", input);
