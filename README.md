# Okee Tracker 2026 - Festival Companion

A comprehensive, real-time companion app for Okeechobee Music & Arts Festival, designed to help friends stay connected, navigate the grounds, and manage their festival experience.

## Key Features

### 📍 Dual-Scene Interactive Mapping
- **The Campground (Leaflet):** High-precision satellite imagery with live GPS tracking.
- **The Grove (The Venue):** Custom-engineered high-resolution map with affine transformation engine for accurate GPS placement on artistic festival maps.
- **Zone Awareness:** Automatically detects if a user is in the Venue, Campground, or Out of Bounds.

### 🛡️ Granular Privacy Controls
- **Crew System:** Add friends by User ID to see their real-time location.
- **Privacy Toggles:** Control exactly what each friend sees:
    - **In-Venue GPS:** Share location only when inside the festival gates.
    - **Campground GPS:** Share location while in the camping area.
    - **Campsite Pin:** Allow specific friends to see your fixed campsite location.
    - **Schedule Sharing:** Let friends see which artists you've saved.

### 🎵 Festival Hub & Schedule
- **Interactive Timeline:** Scrollable grid view of the entire festival lineup across all stages.
- **Spotify Integration:** Preview artists directly in the app using the integrated Spotify player.
- **Personal Schedule:** Save your favorite artists to create a personalized festival itinerary.

### 🆘 Safety & Community
- **SOS Alert System:** Broadcast an emergency alert to all nearby users or just your crew with a single tap.
- **Public Events:** Discover and post community events (e.g., "Frisbee at Aquachobee").
- **Compass:** Real-time directional arrow pointing to your campsite or selected friends.
- **Map Correction:** Submit bug reports or map corrections directly from your location.

## Technical Stack

- **Frontend:** Vanilla JavaScript, Leaflet.js, CSS3 (Mobile-first PWA).
- **Backend:** AWS SAM (Serverless Application Model).
- **Database:** Amazon DynamoDB (NoSQL).
- **Authentication:** AWS Cognito (User Pools & Identity Provider).
- **Hosting:** AWS S3 & CloudFront.
- **Integrations:** Spotify Web API for artist metadata and previews.

## Setup & Deployment

1. **Backend:**
    - Navigate to `okee-backend/`.
    - `sam build`
    - `sam deploy`
2. **Frontend:**
    - Update `API_BASE_URL` and `COGNITO_DOMAIN` in `app.js`.
    - Sync to S3: `aws s3 sync okee-frontend/ s3://your-bucket-name/`

---
*Created for the Okeechobee 2026 Season.*
