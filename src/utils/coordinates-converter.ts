import proj4 from "proj4";

proj4.defs(
	"EPSG:27572",
	"+proj=lcc +lat_1=45.89891888888889 +lat_2=47.69601444444444 " +
		"+lat_0=46.8 +lon_0=2.337229166666667 +x_0=600000 +y_0=2200000 " +
		"+ellps=clrk80ign +units=m +no_defs",
);

export const lambertToLatLong = (input: string) => {
	const [x, y] = input.split(" ");
	// as of 2025/07, coordinates are in meters so we / 100 to get the right result
	const coordinates = proj4("EPSG:27572", "EPSG:4326", [+x / 1000, +y / 1000]);
	return {
		latitude: coordinates[1],
		longitude: coordinates[0],
	};
};
