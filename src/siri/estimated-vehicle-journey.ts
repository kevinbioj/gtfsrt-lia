export type EstimatedCall = {
	StopPointRef: string;
	StopPointName?: string;
	Order: number;
	AimedArrivalTime?: string;
	ExpectedArrivalTime?: string;
	ArrivalStatus?: string;
	AimedDepartureTime?: string;
	ExpectedDepartureTime?: string;
	DepartureStatus?: string;
	Cancellation?: boolean | string;
};

export type RecordedCall = {
	StopPointRef: string;
	StopPointName?: string;
	Order: number;
	AimedArrivalTime?: string;
	ActualArrivalTime?: string;
	AimedDepartureTime?: string;
	ActualDepartureTime?: string;
};

export type EstimatedVehicleJourney = {
	RecordedAtTime?: string;
	LineRef: string;
	DirectionRef?: string;
	FramedVehicleJourneyRef?: {
		DataFrameRef?: string;
		DatedVehicleJourneyRef: string;
	};
	Monitored: boolean;
	PublishedLineName?: string;
	OriginRef?: string;
	OriginName?: string;
	DestinationRef?: string;
	DestinationName?: string;
	Cancellation?: boolean | string;
	RecordedCalls?: { RecordedCall?: RecordedCall | RecordedCall[] };
	EstimatedCalls?: { EstimatedCall?: EstimatedCall | EstimatedCall[] };
};
