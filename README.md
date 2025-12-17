<<<<<<< HEAD
# transitscope
transitscope SQL/GCP project, localhost for now
=======
# TransitScope - Stage 4

A transit accessibility visualization tool for NYC that shows what destinations are reachable via public transit within a given time window.

## Prerequisites

Before running this application, ensure you have the following installed:

- **Node.js** (v16 or higher) - [Download](https://nodejs.org/)
- **MySQL** (v8.0 or higher) - [Download](https://dev.mysql.com/downloads/)

## Dependencies

The following npm packages are required (automatically installed via `npm install`):

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^4.19.0 | Web server framework |
| `mysql2` | ^3.9.0 | MySQL database driver |
| `bcrypt` | ^6.0.0 | Password hashing for user authentication |
| `dotenv` | ^17.2.3 | Environment variable management |
| `cors` | ^2.8.5 | Cross-origin resource sharing |
| `node-fetch` | ^2.7.0 | HTTP client for geocoding API |
| `leaflet` | ^1.9.4 | Interactive maps (frontend) |

## Setup Instructions

### 1. Install Node.js Dependencies

```bash
cd transitscope-stage4
npm install
```

### 2. Set Up MySQL Database

Start the MySQL CLI and run the database setup:

```bash
mysql -u root -p
```

Then in MySQL:

```sql
source c:/path/to/transitscope-stage4/sql/transitscope_database.sql
source c:/path/to/transitscope-stage4/sql/load_data.sql
```

Or from command line:

```bash
mysql -u root -p < sql/transitscope_database.sql
mysql -u root -p transitscope < sql/load_data.sql
```

### 3. Configure Environment Variables

Create a `.env` file in the `transitscope-stage4` directory:

```env
DB_HOST=127.0.0.1
DB_USER=root
DB_PASS=your_mysql_password
DB_NAME=transitscope
PORT=3000
```

### 4. Start the Server

```bash
npm start
```

The application will be available at `http://localhost:3000`

## Features

### Core Features
- **Isochrone Visualization**: See areas reachable within 15/30/45/60 minutes via public transit
- **POI Discovery**: View hospitals, libraries, and retail locations within your travel zone
- **Location Comparison**: Compare transit accessibility between two locations
- **Scoring Profiles**: Different weighting systems for POI categories

### User Authentication (New in Stage 4)
- **User Registration**: Create an account with username, email, and password
- **Login/Logout**: Secure session-based authentication
- **Profile Management**: Update username, email, or password
- **Account Deletion**: Remove your account and all saved data
- **Personal Saved Locations**: Each user has their own collection of saved favorites

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create a new user account |
| POST | `/api/auth/login` | Sign in with email/password |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/me` | Get current user info |

### User Management (CRUD)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/:id` | Get user profile |
| PUT | `/api/users/:id` | Update user profile |
| DELETE | `/api/users/:id` | Delete user account |

### Saved Locations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/saved-locations` | List user's saved locations |
| POST | `/api/saved-locations` | Save a new location |
| PUT | `/api/saved-locations/:id` | Update a saved location |
| DELETE | `/api/saved-locations/:id` | Delete a saved location |
| GET | `/api/saved-locations/report` | Get saved location statistics |

### Transit Analysis
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/app-config` | Get app configuration |
| POST | `/api/isochrone` | Compute transit accessibility |
| POST | `/api/compare` | Compare multiple locations |
| GET | `/api/geocode?q=` | Search for addresses |
| GET | `/api/analytics/top-routes` | Get busiest transit routes |

## Project Structure

```
transitscope-stage4/
├── server.js              # Main Express server with API endpoints
├── package.json           # Node.js dependencies
├── .env                   # Environment variables (create this)
├── public/
│   ├── index.html         # Main HTML page
│   ├── css/
│   │   └── styles.css     # Application styles
│   ├── js/
│   │   └── app.js         # Frontend JavaScript
│   └── vendor/            # Third-party libraries (Leaflet)
├── src/
│   ├── data-loader.js     # Database data loading
│   ├── isochrone-engine.js # Transit accessibility calculations
│   ├── scoring.js         # POI scoring profiles
│   └── saved-location-store.js # Saved location helpers
└── sql/
    ├── transitscope_database.sql # Database schema
    └── load_data.sql      # Sample data
```

## Technical Notes

### Session Management
- Sessions are stored in-memory on the server (resets on server restart)
- Session IDs are stored in the browser's `localStorage` for persistence
- Sessions are sent via the `X-Session-ID` HTTP header

### Password Security
- Passwords are hashed using bcrypt with 10 salt rounds
- Plain-text passwords are never stored

### Database Schema
The application uses the following main tables:
- `Users` - User accounts with hashed passwords
- `SavedLocations` - User's saved favorite locations
- `Stops`, `Routes`, `Trip`, `StopTime` - GTFS transit data
- `POIs`, `POICategories` - Points of interest data

## Troubleshooting

### "Access denied for user 'root'@'localhost'"
Your MySQL password is incorrect. Update the `DB_PASS` in your `.env` file.

### "EADDRINUSE: Port 3000 is already in use"
Another application is using port 3000. Either stop it or change `PORT` in `.env`.

### "Cannot find module 'bcrypt'"
Run `npm install` to install all dependencies.

### Session not persisting after page refresh
Make sure your browser allows localStorage. Check browser console for errors.
>>>>>>> cd5043e (added all files)
