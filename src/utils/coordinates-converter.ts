export const lambertToLatLong = (input: string) => {
	const [lon, lat] = input.split(" ");
	return { latitude: +lat / 100000000, longitude: +lon / 100000000 };
};
