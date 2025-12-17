const EARTH_RADIUS_KM = 6371;
const WALK_SPEED_KMH = 4.8; // brisk walk

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function walkingMinutes(distanceKm, speedKmh = WALK_SPEED_KMH) {
  if (distanceKm <= 0) {
    return 0;
  }
  return (distanceKm / speedKmh) * 60;
}

function parseTimeToMinutes(value) {
  const [h = '0', m = '0', s = '0'] = value.split(':');
  return Number(h) * 60 + Number(m) + Number(s) / 60;
}

module.exports = {
  haversineKm,
  walkingMinutes,
  parseTimeToMinutes,
};
