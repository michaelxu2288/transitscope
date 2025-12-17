const { parseTimeToMinutes } = require('./geo');

async function loadStops(pool) {
  const [rows] = await pool.query(
    `
      SELECT stop_id, stop_name, stop_lat AS latitude, stop_lon AS longitude
      FROM Stops
    `,
  );
  return rows.map((row) => ({
    stop_id: row.stop_id,
    stop_name: row.stop_name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  }));
}

async function loadRoutes(pool) {
  const [rows] = await pool.query(
    `
      SELECT route_id, route_short_name, route_long_name
      FROM Routes
    `,
  );
  return rows.map((row) => ({
    route_id: row.route_id,
    route_short_name: row.route_short_name,
    route_long_name: row.route_long_name,
  }));
}

async function loadTrips(pool) {
  const [rows] = await pool.query(
    `
      SELECT trip_id, route_id
      FROM Trip
    `,
  );
  const map = new Map();
  rows.forEach((row) => {
    map.set(row.trip_id, row.route_id);
  });
  return map;
}

async function loadStopTimes(pool) {
  const [rows] = await pool.query(
    `
      SELECT trip_id,
             stop_sequence,
             arrival_time,
             departure_time,
             stop_id
      FROM StopTime
      ORDER BY trip_id, stop_sequence
    `,
  );
  return rows.map((row) => ({
    trip_id: row.trip_id,
    stop_sequence: Number(row.stop_sequence),
    arrival_time: row.arrival_time,
    departure_time: row.departure_time,
    arrival_minutes: parseTimeToMinutes(row.arrival_time),
    departure_minutes: parseTimeToMinutes(row.departure_time),
    stop_id: row.stop_id,
  }));
}

async function loadPoiCategories(pool) {
  const [rows] = await pool.query(
    `
      SELECT category_name
      FROM POICategories
    `,
  );
  return rows.map((row) => row.category_name);
}

async function loadPois(pool) {
  const [rows] = await pool.query(
    `
      SELECT poi_id, name, category_name, latitude, longitude
      FROM POIs
    `,
  );
  return rows.map((row) => ({
    poi_id: Number(row.poi_id),
    name: row.name,
    category_name: row.category_name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  }));
}

async function loadTransitDataset(pool) {
  const [stops, routes, trips, stopTimes, poiCategories, pois] = await Promise.all([
    loadStops(pool),
    loadRoutes(pool),
    loadTrips(pool),
    loadStopTimes(pool),
    loadPoiCategories(pool),
    loadPois(pool),
  ]);

  const stopsById = new Map();
  stops.forEach((stop) => {
    stopsById.set(stop.stop_id, stop);
  });

  const routesById = new Map();
  routes.forEach((route) => {
    routesById.set(route.route_id, route);
  });

  const poisByCategory = new Map();
  pois.forEach((poi) => {
    if (!poisByCategory.has(poi.category_name)) {
      poisByCategory.set(poi.category_name, []);
    }
    poisByCategory.get(poi.category_name).push(poi);
  });

  let latSum = 0;
  let lonSum = 0;
  let latlonCount = 0;
  let fallbackStop = null;
  stops.forEach((stop) => {
    const validLat = Number.isFinite(stop.latitude);
    const validLon = Number.isFinite(stop.longitude);
    if (validLat && validLon) {
      latSum += stop.latitude;
      lonSum += stop.longitude;
      latlonCount += 1;
      if (!fallbackStop) {
        fallbackStop = stop;
      }
    }
  });
  const averageLat = latlonCount > 0 ? latSum / latlonCount : fallbackStop?.latitude || 0;
  const averageLon = latlonCount > 0 ? lonSum / latlonCount : fallbackStop?.longitude || 0;

  return {
    stops,
    stopsById,
    stopTimes,
    routesById,
    trips,
    poiCategories,
    pois,
    poisByCategory,
    defaultLocation: {
      latitude: averageLat,
      longitude: averageLon,
    },
    stats: {
      stops: stops.length,
      stopTimes: stopTimes.length,
      routes: routes.length,
      pois: pois.length,
    },
  };
}

module.exports = {
  loadTransitDataset,
};
