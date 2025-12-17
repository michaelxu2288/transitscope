const SCORING_PROFILES = [
  {
    id: 'balanced',
    name: 'Balanced Essentials',
    description: 'Even emphasis on hospitals, libraries, and retail.',
    weights: { Hospital: 0.4, Library: 0.3, Retail: 0.3 },
  },
  {
    id: 'healthcare',
    name: 'Health & Safety',
    description: 'Prioritises quick access to hospitals and urgent care.',
    weights: { Hospital: 0.65, Library: 0.1, Retail: 0.25 },
  },
  {
    id: 'families',
    name: 'Family Friendly',
    description: 'Highlights libraries and daily retail needs.',
    weights: { Hospital: 0.3, Library: 0.45, Retail: 0.25 },
  },
];

function resolveWeights(profileId, customWeights) {
  if (customWeights && Object.keys(customWeights).length > 0) {
    return customWeights;
  }
  const fallback = SCORING_PROFILES.find((profile) => profile.id === profileId);
  if (fallback) {
    return fallback.weights;
  }
  return SCORING_PROFILES[0].weights;
}

module.exports = {
  SCORING_PROFILES,
  resolveWeights,
};
