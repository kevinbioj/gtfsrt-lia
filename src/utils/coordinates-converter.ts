export const lambertToLatLong = (input: string) => {
	const [lat, lon] = input.split(" ");
	return { latitude: +lat / 100000, longitude: +lon / 100000 };
};
