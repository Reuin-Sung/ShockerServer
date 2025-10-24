# Shocker Server

A Node.js server that provides API endpoints for controlling a shock device with intensity and timing controls.

## Features

- **Intensity Control**: Set shock intensity from 0-100%
- **Timing Control**: Set shock duration from 300-30000 milliseconds
- **Status Monitoring**: Check if the shocker is currently active
- **Real-time State**: Track current intensity, time, and activation status

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

## API Endpoints

### Health Check
- **GET** `/health`
- Returns server status and current shocker state

### Shocker Status
- **GET** `/shocker/status`
- Returns current shocker state (on/off, intensity, time, last activated)

### Activate Shocker
- **POST** `/shocker/activate`
- **Body**: `{ "intensity": 50, "time": 1000 }`
- **Validation**:
  - `intensity`: 0-100 (required)
  - `time`: 300-30000 milliseconds (required)

### Stop Shocker
- **POST** `/shocker/stop`
- Immediately stops the shocker and resets state

## Example Usage

### Check Status
```bash
curl http://localhost:3000/shocker/status
```

### Activate Shocker
```bash
curl -X POST http://localhost:3000/shocker/activate \
  -H "Content-Type: application/json" \
  -d '{"intensity": 75, "time": 2000}'
```

### Stop Shocker
```bash
curl -X POST http://localhost:3000/shocker/stop
```

## Response Examples

### Status Response
```json
{
  "isOn": true,
  "currentIntensity": 75,
  "currentTime": 2000,
  "lastActivated": "2024-01-15T10:30:00.000Z"
}
```

### Activation Response
```json
{
  "success": true,
  "message": "Shocker activated",
  "shocker": {
    "isOn": true,
    "intensity": 75,
    "time": 2000,
    "activatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

## Error Handling

The server validates all inputs and returns appropriate error messages:

- **400 Bad Request**: Missing or invalid parameters
- **404 Not Found**: Invalid endpoint
- **500 Internal Server Error**: Server-side errors

## Configuration

- **Port**: Default 3000 (set via `PORT` environment variable)
- **CORS**: Enabled for cross-origin requests
- **JSON**: Automatic request/response parsing

## Development

The server includes:
- Input validation for intensity (0-100) and time (300-30000ms)
- In-memory state management
- Automatic shocker timeout based on specified duration
- Comprehensive error handling
- CORS support for web applications
