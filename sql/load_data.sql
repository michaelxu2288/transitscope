SET FOREIGN_KEY_CHECKS=0;
TRUNCATE TABLE StopTime;
TRUNCATE TABLE Trip;
TRUNCATE TABLE Routes;
TRUNCATE TABLE Stops;
TRUNCATE TABLE ProfileWeights;
TRUNCATE TABLE SavedLocations;
TRUNCATE TABLE ScoringProfiles;
TRUNCATE TABLE Users;
TRUNCATE TABLE POIs;
TRUNCATE TABLE POICategories;
SET FOREIGN_KEY_CHECKS=1;

LOAD DATA INFILE 'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Uploads\\POICategories.csv'
INTO TABLE POICategories
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY '"'
LINES TERMINATED BY '\n'
(@category_name)
SET category_name = TRIM(BOTH '\r' FROM @category_name);

LOAD DATA INFILE 'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Uploads\\POIs.csv'
INTO TABLE POIs
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY '"'
LINES TERMINATED BY '\n'
(@poi_id, @name, @category_name, @latitude, @longitude)
SET poi_id = TRIM(BOTH '\r' FROM @poi_id),
    name = TRIM(BOTH '\r' FROM @name),
    category_name = TRIM(BOTH '\r' FROM @category_name),
    latitude = TRIM(BOTH '\r' FROM @latitude),
    longitude = TRIM(BOTH '\r' FROM @longitude);

LOAD DATA INFILE 'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Uploads\\Users.csv'
INTO TABLE Users
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY '"'
LINES TERMINATED BY '\n'
(@user_id, @username, @email, @password_hash)
SET user_id = TRIM(BOTH '\r' FROM @user_id),
    username = TRIM(BOTH '\r' FROM @username),
    email = TRIM(BOTH '\r' FROM @email),
    password_hash = TRIM(BOTH '\r' FROM @password_hash);

LOAD DATA INFILE 'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Uploads\\ScoringProfiles.csv'
INTO TABLE ScoringProfiles
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY '"'
LINES TERMINATED BY '\n'
(@profile_id, @user_id, @profile_name)
SET profile_id = TRIM(BOTH '\r' FROM @profile_id),
    user_id = TRIM(BOTH '\r' FROM @user_id),
    profile_name = TRIM(BOTH '\r' FROM @profile_name);

LOAD DATA INFILE 'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Uploads\\ProfileWeights.csv'
INTO TABLE ProfileWeights
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY '"'
LINES TERMINATED BY '\n'
(@profile_id, @category_name, @weight)
SET profile_id = TRIM(BOTH '\r' FROM @profile_id),
    category_name = TRIM(BOTH '\r' FROM @category_name),
    weight = TRIM(BOTH '\r' FROM @weight);

LOAD DATA INFILE 'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Uploads\\Routes.csv'
INTO TABLE Routes
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY '"'
LINES TERMINATED BY '\n'
(@route_id, @route_short_name, @route_long_name)
SET route_id = TRIM(BOTH '\r' FROM @route_id),
    route_short_name = TRIM(BOTH '\r' FROM @route_short_name),
    route_long_name = TRIM(BOTH '\r' FROM @route_long_name);

LOAD DATA INFILE 'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Uploads\\Stops.csv'
INTO TABLE Stops
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY '"'
LINES TERMINATED BY '\n'
(@stop_id, @stop_name, @stop_lat, @stop_lon)
SET stop_id = TRIM(BOTH '\r' FROM @stop_id),
    stop_name = TRIM(BOTH '\r' FROM @stop_name),
    stop_lat = TRIM(BOTH '\r' FROM @stop_lat),
    stop_lon = TRIM(BOTH '\r' FROM @stop_lon);

LOAD DATA INFILE 'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Uploads\\Trip.csv'
INTO TABLE Trip
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY '"'
LINES TERMINATED BY '\n'
(@trip_id, @route_id)
SET trip_id = TRIM(BOTH '\r' FROM @trip_id),
    route_id = TRIM(BOTH '\r' FROM @route_id);

LOAD DATA INFILE 'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Uploads\\StopTime.csv'
INTO TABLE StopTime
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY '"'
LINES TERMINATED BY '\n'
(@trip_id, @stop_sequence, @arrival_time, @departure_time, @stop_id)
SET trip_id = TRIM(BOTH '\r' FROM @trip_id),
    stop_sequence = TRIM(BOTH '\r' FROM @stop_sequence),
    arrival_time = TRIM(BOTH '\r' FROM @arrival_time),
    departure_time = TRIM(BOTH '\r' FROM @departure_time),
    stop_id = TRIM(BOTH '\r' FROM @stop_id);

LOAD DATA INFILE 'C:\\ProgramData\\MySQL\\MySQL Server 8.0\\Uploads\\SavedLocations.csv'
INTO TABLE SavedLocations
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY '"'
LINES TERMINATED BY '\n'
(@location_id, @user_id, @name, @address, @latitude, @longitude)
SET location_id = TRIM(BOTH '\r' FROM @location_id),
    user_id = TRIM(BOTH '\r' FROM @user_id),
    name = TRIM(BOTH '\r' FROM @name),
    address = TRIM(BOTH '\r' FROM @address),
    latitude = TRIM(BOTH '\r' FROM @latitude),
    longitude = TRIM(BOTH '\r' FROM @longitude);
