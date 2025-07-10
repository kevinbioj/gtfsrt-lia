import proj4 from "proj4";

export const lambertToLatLong = (input: string) => {
	const [x, y] = input.split(" ");
	// as of 2025/07, coordinates are in meters so we / 100 to get the right result
	const coordinates = proj4(
		"+proj=lcc +lat_1=49 +lat_2=44 +lat_0=46.5 +lon_0=3 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
		"+proj=longlat +datum=WGS84 +no_defs",
		[+x / 100, +y / 100],
	);
	return {
		latitude: coordinates[1],
		longitude: coordinates[0],
	};
};
