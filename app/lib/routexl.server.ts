type RouteXLLocation = {
  address: string;
  lat: string;
  lng: string;
  servicetime?: number;
};

type RouteXLRoutePoint = {
  name: string;
  arrival: number;
  distance: number;
};

type RouteXLTourResponse = {
  id?: string;
  count?: number;
  feasible?: boolean;
  route?: Record<string, RouteXLRoutePoint>;
};

export type OptimisedWaypoint = {
  name: string;
  arrivalMinutes: number;
  cumulativeDistanceKm: number;
};

export type OptimisedRoute = {
  routeId: string | null;
  feasible: boolean;
  waypoints: OptimisedWaypoint[];
  totalDistanceKm: number | null;
  totalDurationMinutes: number | null;
};

function getRouteXLCredentials() {
  const username = process.env.ROUTEXL_USERNAME;
  const password = process.env.ROUTEXL_PASSWORD;

  if (!username || !password) {
    throw new Error("RouteXL credentials are missing. Add ROUTEXL_USERNAME and ROUTEXL_PASSWORD to the app environment.");
  }

  return { username, password };
}

function buildAuthHeader(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function toRouteXLBody(locations: RouteXLLocation[], skipOptimisation = false) {
  const body = new URLSearchParams();
  body.set("locations", JSON.stringify(locations));

  if (skipOptimisation) {
    body.set("skipOptimisation", "true");
  }

  return body;
}

export async function optimiseLocations(locations: RouteXLLocation[], skipOptimisation = false): Promise<OptimisedRoute> {
  const { username, password } = getRouteXLCredentials();
  const response = await fetch("https://api.routexl.com/tour/", {
    method: "POST",
    headers: {
      Authorization: buildAuthHeader(username, password),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: toRouteXLBody(locations, skipOptimisation),
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("RouteXL rejected this route because it has too many stops for your account limit.");
    }

    if (response.status === 429) {
      throw new Error("RouteXL is already processing another route. Try again shortly.");
    }

    throw new Error(`RouteXL optimisation failed with status ${response.status}.`);
  }

  const payload = await response.json() as RouteXLTourResponse;
  const waypoints = Object.values(payload.route || {}).map((point) => ({
    name: point.name,
    arrivalMinutes: point.arrival,
    cumulativeDistanceKm: point.distance,
  }));
  const finalPoint = waypoints[waypoints.length - 1];

  return {
    routeId: payload.id || null,
    feasible: Boolean(payload.feasible),
    waypoints,
    totalDistanceKm: finalPoint?.cumulativeDistanceKm ?? null,
    totalDurationMinutes: finalPoint?.arrivalMinutes ?? null,
  };
}

export function buildRouteXLLocation(name: string, address: string, latitude: number, longitude: number, serviceTimeMinutes = 10): RouteXLLocation {
  return {
    address: `${name}, ${address}`,
    lat: String(latitude),
    lng: String(longitude),
    servicetime: serviceTimeMinutes,
  };
}
