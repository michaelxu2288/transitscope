const { haversineKm, walkingMinutes } = require('./geo');

const DEFAULT_NEAREST_COUNT = 8;
const MAX_WALK_MINUTES = 18;

class IsochroneEngine {
  constructor(dataset) {
    this.dataset = dataset;
    this.adjacency = this.buildAdjacency(dataset.stopTimes, dataset.trips);
  }

  buildAdjacency(stopTimes, trips) {
    const adjacency = new Map();
    const tripsMap = new Map();

    stopTimes.forEach((record) => {
      if (!tripsMap.has(record.trip_id)) {
        tripsMap.set(record.trip_id, []);
      }
      tripsMap.get(record.trip_id).push(record);
    });

    for (const tripRecords of tripsMap.values()) {
      tripRecords.sort((a, b) => a.stop_sequence - b.stop_sequence);
      for (let i = 0; i < tripRecords.length - 1; i += 1) {
        const current = tripRecords[i];
        const next = tripRecords[i + 1];
        const travelMinutes = Math.max(0.5, next.arrival_minutes - current.departure_minutes);
        if (!adjacency.has(current.stop_id)) {
          adjacency.set(current.stop_id, []);
        }
        adjacency.get(current.stop_id).push({
          to: next.stop_id,
          minutes: travelMinutes,
          trip_id: current.trip_id,
          route_id: trips.get(current.trip_id) || null,
        });
      }
    }

    return adjacency;
  }

  getNearestStops(lat, lon, count = DEFAULT_NEAREST_COUNT) {
    const scores = this.dataset.stops.map((stop) => {
      const distanceKm = haversineKm(lat, lon, stop.latitude, stop.longitude);
      return { ...stop, distanceKm };
    });
    scores.sort((a, b) => a.distanceKm - b.distanceKm);
    return scores.slice(0, count);
  }

  runDijkstra(origin, maxMinutes) {
    const frontier = [];
    const seen = new Map();

    const startCandidates = this.getNearestStops(origin.latitude, origin.longitude, DEFAULT_NEAREST_COUNT);
    startCandidates.forEach((stop) => {
      const walkMinutes = walkingMinutes(stop.distanceKm);
      if (walkMinutes <= MAX_WALK_MINUTES && walkMinutes <= maxMinutes) {
        frontier.push({ stop_id: stop.stop_id, minutes: walkMinutes });
        seen.set(stop.stop_id, walkMinutes);
      }
    });

    while (frontier.length > 0) {
      frontier.sort((a, b) => a.minutes - b.minutes);
      const current = frontier.shift();
      if (current.minutes > maxMinutes) {
        break;
      }
      const neighbours = this.adjacency.get(current.stop_id) || [];
      neighbours.forEach((edge) => {
        const candidateMinutes = current.minutes + edge.minutes;
        if (candidateMinutes > maxMinutes) {
          return;
        }
        const bestSeen = seen.get(edge.to);
        if (bestSeen == null || candidateMinutes < bestSeen) {
          seen.set(edge.to, candidateMinutes);
          frontier.push({ stop_id: edge.to, minutes: candidateMinutes });
        }
      });
    }

    return seen;
  }

  computeScore(countByCategory, weights) {
    let totalWeight = 0;
    let weightedSum = 0;
    Object.entries(weights).forEach(([category, weight]) => {
      totalWeight += weight;
      const count = countByCategory[category] || 0;
      weightedSum += count * weight;
    });
    if (totalWeight === 0) {
      return 0;
    }
    return weightedSum / totalWeight;
  }

  computeIsochrone({ latitude, longitude, maxMinutes, categories, weights }) {
    const origin = {
      latitude: Number(latitude),
      longitude: Number(longitude),
    };
    const limit = Number(maxMinutes) || 30;
    const categoryFilter = categories && categories.length > 0 ? new Set(categories) : null;
    const reachable = this.runDijkstra(origin, limit);
    const nearestStops = this.getNearestStops(origin.latitude, origin.longitude, 5);

    const reachableStops = [];
    reachable.forEach((minutes, stopId) => {
      const stop = this.dataset.stopsById.get(stopId);
      if (!stop) {
        return;
      }
      reachableStops.push({
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
        latitude: stop.latitude,
        longitude: stop.longitude,
        minutes,
      });
    });

    reachableStops.sort((a, b) => a.minutes - b.minutes);

    const accessiblePois = [];
    const countsByCategory = {};
    this.dataset.pois.forEach((poi) => {
      if (categoryFilter && !categoryFilter.has(poi.category_name)) {
        return;
      }
      const directWalk = walkingMinutes(haversineKm(origin.latitude, origin.longitude, poi.latitude, poi.longitude));
      let bestMinutes = directWalk;
      reachableStops.forEach((stop) => {
        const hopMinutes = walkingMinutes(haversineKm(stop.latitude, stop.longitude, poi.latitude, poi.longitude));
        const total = stop.minutes + hopMinutes;
        if (bestMinutes === 0 || total < bestMinutes) {
          bestMinutes = total;
        }
      });
      if (bestMinutes <= limit) {
        accessiblePois.push({
          ...poi,
          minutes: Number(bestMinutes.toFixed(1)),
        });
        countsByCategory[poi.category_name] = (countsByCategory[poi.category_name] || 0) + 1;
      }
    });

    accessiblePois.sort((a, b) => a.minutes - b.minutes);
    const score = this.computeScore(countsByCategory, weights);

    return {
      origin,
      maxMinutes: limit,
      nearestStops,
      reachableStops,
      accessiblePois,
      countsByCategory,
      score,
      metadata: {
        reachedStopCount: reachableStops.length,
        poiCount: accessiblePois.length,
      },
    };
  }
}

module.exports = IsochroneEngine;
