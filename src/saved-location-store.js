class SavedLocationStore {
  constructor(pool, userId) {
    this.pool = pool;
    this.userId = userId;
  }

  async getAll() {
    const [rows] = await this.pool.query(
      `
        SELECT location_id, name, address, latitude, longitude
        FROM SavedLocations
        WHERE user_id = ?
        ORDER BY location_id DESC
      `,
      [this.userId],
    );
    return rows;
  }

  async create({ name, address, latitude, longitude }) {
    const [result] = await this.pool.query(
      `
        INSERT INTO SavedLocations (user_id, name, address, latitude, longitude)
        VALUES (?, ?, ?, ?, ?)
      `,
      [this.userId, name, address || null, latitude, longitude],
    );
    return {
      location_id: result.insertId,
      user_id: this.userId,
      name,
      address: address || null,
      latitude,
      longitude,
    };
  }

  async delete(id) {
    const [result] = await this.pool.query(
      `
        DELETE FROM SavedLocations
        WHERE location_id = ? AND user_id = ?
      `,
      [id, this.userId],
    );
    return result.affectedRows > 0;
  }
}

async function createSavedLocationStore(pool, userId) {
  if (!pool) {
    throw new Error('Database pool is not available for saved locations');
  }
  return new SavedLocationStore(pool, userId);
}

module.exports = {
  SavedLocationStore,
  createSavedLocationStore,
};
