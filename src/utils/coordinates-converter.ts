import proj4 from "proj4";

export const lambertToLatLong = (input: string) => {
  const [x, y] = input.split(" ");
  const coordinates = proj4(
    "+proj=lcc +lat_1=46.8 +lat_0=46.8 +lon_0=0 +k_0=0.99987742 +x_0=600000 +y_0=2200000 +a=6378249.2 +b=6356515 +towgs84=-168,-60,320,0,0,0,0 +pm=paris +units=m +no_defs",
    "+proj=longlat +datum=WGS84 +no_defs",
    [+x, +y]
  );
  return {
    latitude: coordinates[1],
    longitude: coordinates[0],
  };
};
