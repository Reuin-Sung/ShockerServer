# Shocker Server

A Node.js server that provides API endpoints for controlling a shock device with intensity and timing controls. Supports both HTTP and HTTPS with automatic Let's Encrypt SSL certificate management.

## Features

- **Intensity Control**: Set shock intensity from 0-100%
- **Timing Control**: Set shock duration from 300-30000 milliseconds
- **Status Monitoring**: Check if the shocker is currently active
- **Real-time State**: Track current intensity, time, and activation status
- **Dual Protocol**: HTTP (port 80) and HTTPS (port 443) support
- **Let's Encrypt SSL**: Automatic certificate generation and renewal
- **Domain Support**: Multi-domain SSL certificate management
- **Security**: CORS-enabled with proper error handling

## Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cp env.example .env
# Edit .env with your domain and email
```

3. Install the new dependencies:
```bash
npm install
```

4. Start the server:
```bash
npm start
```

For Let's Encrypt SSL certificates:
```bash
npm run letsencrypt
```

For production with Let's Encrypt:
```bash
npm run production
```

For development with auto-restart:
```bash
npm run dev
```

## Let's Encrypt Setup

### Environment Variables

Create a `.env` file with your configuration:

```bash
# Domain configuration
DOMAIN=yourdomain.com
DOMAINS=yourdomain.com,www.yourdomain.com

# Let's Encrypt email (required)
LE_EMAIL=admin@yourdomain.com

# Server ports
HTTP_PORT=80
HTTPS_PORT=443

# Environment
NODE_ENV=production
```

### Domain Requirements

- **Public Domain**: Your domain must be publicly accessible
- **DNS Resolution**: Domain must point to your server's IP
- **Port Access**: Ports 80 and 443 must be open
- **Email**: Valid email for Let's Encrypt notifications

### Certificate Management

The server automatically:
- ✅ **Requests certificates** for your domain
- ✅ **Renews certificates** before expiration
- ✅ **Handles ACME challenges** automatically
- ✅ **Falls back** to self-signed certificates if Let's Encrypt fails

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

### Check Status (HTTP)
```bash
curl http://localhost:80/shocker/status
```

### Check Status (HTTPS)
```bash
curl -k https://localhost:443/shocker/status
```

### Activate Shocker (HTTP)
```bash
curl -X POST http://localhost:80/shocker/activate \
  -H "Content-Type: application/json" \
  -d '{"intensity": 75, "time": 2000}'
```

### Activate Shocker (HTTPS)
```bash
curl -k -X POST https://localhost:443/shocker/activate \
  -H "Content-Type: application/json" \
  -d '{"intensity": 75, "time": 2000}'
```

### Stop Shocker
```bash
curl -X POST http://localhost:80/shocker/stop
curl -k -X POST https://localhost:443/shocker/stop
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

- **HTTP Port**: Default 80 (set via `HTTP_PORT` environment variable)
- **HTTPS Port**: Default 443 (set via `HTTPS_PORT` environment variable)
- **CORS**: Enabled for cross-origin requests
- **JSON**: Automatic request/response parsing
- **SSL**: Self-signed certificates with auto-renewal

## SSL Certificate Management

The server includes automatic SSL certificate management with Let's Encrypt:

- **Let's Encrypt Integration**: Automatic certificate requests and renewal
- **Multi-domain Support**: Single certificate for multiple domains
- **ACME Challenge Handling**: Automatic domain validation
- **Fallback Support**: Falls back to self-signed certificates if Let's Encrypt fails
- **Auto-renewal**: Certificates are renewed automatically before expiration

### Certificate Storage
- `certs/` - Let's Encrypt certificate storage
- `certs/private-key.pem` - Private key (fallback)
- `certs/certificate.pem` - SSL certificate (fallback)

### Let's Encrypt vs Self-signed

**Let's Encrypt (Production):**
- ✅ Trusted by browsers
- ✅ Automatic renewal
- ✅ Free certificates
- ✅ Multi-domain support

**Self-signed (Development):**
- ⚠️ Browser warnings
- ⚠️ Manual renewal
- ✅ No internet required
- ✅ Local development

## Development

The server includes:
- Input validation for intensity (0-100) and time (300-30000ms)
- In-memory state management
- Automatic shocker timeout based on specified duration
- Comprehensive error handling
- CORS support for web applications
- Dual protocol support (HTTP/HTTPS)
- Automatic SSL certificate management
- Graceful shutdown handling

## Production Deployment

For production deployment with Let's Encrypt:

1. **Configure domain**: Set `DOMAIN` and `LE_EMAIL` environment variables
2. **DNS setup**: Point your domain to your server's IP address
3. **Firewall**: Ensure ports 80 and 443 are open
4. **Start server**: Run `npm run production` for Let's Encrypt certificates
5. **Monitor**: Check certificate renewal logs

### Quick Production Setup

```bash
# 1. Set environment variables
export DOMAIN=yourdomain.com
export LE_EMAIL=admin@yourdomain.com
export NODE_ENV=production

# 2. Start with Let's Encrypt
npm run production
```

### Troubleshooting

**Certificate Issues:**
- Check domain DNS resolution
- Verify ports 80/443 are open
- Check Let's Encrypt rate limits
- Review server logs for ACME challenge errors

**Fallback to Self-signed:**
- Server automatically falls back if Let's Encrypt fails
- Run `npm run generate-cert` for manual self-signed certificates
- Use `npm start` for self-signed certificate mode
