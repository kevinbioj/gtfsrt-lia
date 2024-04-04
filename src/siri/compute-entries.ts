import { XMLParser } from "fast-xml-parser";

import type { SiriVehicleActivity } from "~/siri/@types";

const parser = new XMLParser({ removeNSPrefix: true });

const vehicleMonitoringRequestPayload = (lineRef: string) => {
  const now = new Date().toISOString();
  return `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <S:Body>
    <sw:GetVehicleMonitoring xmlns:sw="http://wsdl.siri.org.uk" xmlns:siri="http://www.siri.org.uk/siri">
      <ServiceRequestInfo>
        <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
        <siri:RequestorRef>opendata</siri:RequestorRef>
        <siri:MessageIdentifier>Test::Message::824b24b4-8f47-48e4-a56e-fac7bdc2204c</siri:MessageIdentifier>
      </ServiceRequestInfo>
      <Request version="2.0:FR-IDF-2.4">
        <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
        <siri:MessageIdentifier>Test::Message::824b24b4-8f47-48e4-a56e-fac7bdc2204c</siri:MessageIdentifier>
        <siri:LineRef>${lineRef}</siri:LineRef>
      </Request>
      <RequestExtension/>
    </sw:GetVehicleMonitoring>
  </S:Body>
</S:Envelope>
`;
};

export async function computeSiriEntries(wsdl: string, lineRef: string) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 10000);
  const body = vehicleMonitoringRequestPayload(lineRef);
  const response = await fetch(wsdl, {
    body: body,
    headers: {
      "Content-Type": "application/xml",
      "Content-Length": vehicleMonitoringRequestPayload.length.toString(),
      "User-Agent": "Bus-Tracker.xyz/1.0",
    },
    method: "POST",
    signal: abortController.signal,
  });
  clearInterval(timeout);
  if (!response.ok) return null;
  const payload = await response.text();
  const data = parser.parse(payload);
  const vehicles = data.Envelope.Body.GetVehicleMonitoringResponse.Answer.VehicleMonitoringDelivery
    .VehicleActivity as SiriVehicleActivity[] | SiriVehicleActivity;
  return Array.isArray(vehicles) ? vehicles : [vehicles];
}
