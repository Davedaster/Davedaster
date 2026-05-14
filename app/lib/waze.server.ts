type WazeLocation = {
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  formattedAddress?: string | null;
  postcode?: string | null;
} | null | undefined;

export function buildWazeUrl(location: WazeLocation) {
  if (!location) {
    return null;
  }

  if (typeof location.latitude === "number" && typeof location.longitude === "number") {
    return `https://waze.com/ul?ll=${location.latitude},${location.longitude}&navigate=yes`;
  }

  const query = [location.address, location.formattedAddress, location.postcode]
    .filter(Boolean)
    .join(", ");

  if (!query) {
    return null;
  }

  return `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;
}
