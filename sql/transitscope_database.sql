CREATE DATABASE IF NOT EXISTS transitscope
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE transitscope;


SET NAMES utf8mb4;

DROP TABLE IF EXISTS StopTime;
DROP TABLE IF EXISTS Stops;
DROP TABLE IF EXISTS Trip;
DROP TABLE IF EXISTS Routes;
DROP TABLE IF EXISTS ProfileWeights;
DROP TABLE IF EXISTS POIs;
DROP TABLE IF EXISTS POICategories;
DROP TABLE IF EXISTS ScoringProfiles;
DROP TABLE IF EXISTS SavedLocations;
DROP TABLE IF EXISTS Users;

CREATE TABLE Users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  last_saved_at DATETIME NULL,
  CHECK (CHAR_LENGTH(username) >= 3)
);

CREATE TABLE SavedLocations (
  location_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  address VARCHAR(255) NULL,
  latitude DECIMAL(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),   
  longitude DECIMAL(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_savedlocations_user
  FOREIGN KEY (user_id) REFERENCES Users(user_id)
  ON UPDATE RESTRICT ON DELETE CASCADE,
  INDEX idx_savedlocations_user (user_id)
);

CREATE TABLE ScoringProfiles (
  profile_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  profile_name VARCHAR(100) NOT NULL,
  CONSTRAINT fk_scoringprofiles_user
  FOREIGN KEY (user_id) REFERENCES Users(user_id)
  ON UPDATE RESTRICT ON DELETE CASCADE,
  INDEX idx_scoringprofiles_user (user_id)
);

CREATE TABLE POICategories (
  category_name VARCHAR(64) PRIMARY KEY
); 

CREATE TABLE POIs (
  poi_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category_name VARCHAR(64) NOT NULL,
  latitude DECIMAL(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DECIMAL(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT fk_pois_category
  FOREIGN KEY (category_name) REFERENCES POICategories(category_name)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
  INDEX idx_pois_category (category_name)
); 

CREATE TABLE ProfileWeights (
  profile_id INT NOT NULL,
  category_name VARCHAR(64) NOT NULL,
  weight DECIMAL(5,2) NOT NULL CHECK (weight BETWEEN 0 AND 1),
  PRIMARY KEY (profile_id, category_name),
  CONSTRAINT fk_pw_profile
  FOREIGN KEY (profile_id) REFERENCES ScoringProfiles(profile_id)
  ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_pw_category
  FOREIGN KEY (category_name) REFERENCES POICategories(category_name)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
  INDEX idx_pw_category (category_name)
); 

CREATE TABLE Routes (
  route_id VARCHAR(128) PRIMARY KEY,
  route_short_name VARCHAR(32),
  route_long_name VARCHAR(255)
);

CREATE TABLE Trip (
  trip_id VARCHAR(128) PRIMARY KEY,
  route_id VARCHAR(128) NOT NULL,
  CONSTRAINT fk_trip_route
  FOREIGN KEY (route_id) REFERENCES Routes(route_id)
  ON UPDATE RESTRICT ON DELETE CASCADE,
  INDEX idx_trip_route (route_id)
); 

CREATE TABLE Stops (
  stop_id VARCHAR(128) PRIMARY KEY,
  stop_name VARCHAR(128) NOT NULL,
  stop_lat DECIMAL(9,6) NOT NULL CHECK (stop_lat BETWEEN -90 AND 90),
  stop_lon DECIMAL(9,6) NOT NULL CHECK (stop_lon BETWEEN -180 AND 180)
); 

CREATE TABLE StopTime (
  trip_id VARCHAR(128) NOT NULL,
  stop_sequence INT NOT NULL,
  arrival_time TIME NOT NULL,
  departure_time TIME NOT NULL,
  stop_id VARCHAR(128) NOT NULL,
  PRIMARY KEY (trip_id, stop_sequence),
  CONSTRAINT fk_stoptime_trip
  FOREIGN KEY (trip_id) REFERENCES Trip(trip_id)
  ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_stoptime_stop
  FOREIGN KEY (stop_id) REFERENCES Stops(stop_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT,
  INDEX idx_stoptime_stop (stop_id),
  INDEX idx_stoptime_arrival (arrival_time),
  INDEX idx_stoptime_departure (departure_time)
); 

DELIMITER $$

CREATE TRIGGER trg_savedlocations_after_insert
AFTER INSERT ON SavedLocations
FOR EACH ROW
BEGIN
  UPDATE Users
  SET last_saved_at = CURRENT_TIMESTAMP
  WHERE user_id = NEW.user_id;
END$$

CREATE TRIGGER trg_profileweights_validate
BEFORE INSERT ON ProfileWeights
FOR EACH ROW
BEGIN
  IF NEW.weight < 0 OR NEW.weight > 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Profile weight must be between 0 and 1';
  END IF;
END$$

CREATE PROCEDURE sp_top_routes(IN route_limit INT)
BEGIN
  DECLARE effective_limit INT;
  SET effective_limit = IF(route_limit IS NULL OR route_limit < 1, 5, route_limit);

  SELECT r.route_id,
         r.route_short_name,
         r.route_long_name,
         COUNT(DISTINCT st.stop_id) AS stop_count,
         COUNT(DISTINCT t.trip_id) AS trip_count
  FROM Routes r
    JOIN Trip t ON t.route_id = r.route_id
    JOIN StopTime st ON st.trip_id = t.trip_id
  GROUP BY r.route_id, r.route_short_name, r.route_long_name
  ORDER BY stop_count DESC, trip_count DESC
  LIMIT effective_limit;
END$$

CREATE PROCEDURE sp_saved_location_report(IN p_user_id INT)
BEGIN
  DECLARE total_locations INT DEFAULT 0;
  DECLARE recent_date DATETIME;

  SELECT COUNT(*), MAX(created_at)
    INTO total_locations, recent_date
  FROM SavedLocations
  WHERE user_id = p_user_id;

  SELECT u.user_id,
         u.username,
         total_locations AS location_count,
         COALESCE(recent_date, u.last_saved_at) AS last_saved_at
  FROM Users u
  WHERE u.user_id = p_user_id;

  SELECT DATE(created_at) AS saved_date,
         COUNT(*) AS saves_on_day
  FROM SavedLocations
  WHERE user_id = p_user_id
  GROUP BY DATE(created_at)
  ORDER BY saved_date DESC;
END$$

DELIMITER ;
