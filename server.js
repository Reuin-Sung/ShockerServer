const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { 
  acmeConfig, 
  initializeACME, 
  hasValidCertificate, 
  getSSLOptions,
  requestCertificate 
} = require('./letsencrypt-config');

const app = express();
const HTTP_PORT = process.env.HTTP_PORT || 80;
const HTTPS_PORT = process.env.HTTPS_PORT || 443;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage for shocker state
let shockerState = {
  isOn: false,
  currentIntensity: 0,
  currentTime: 0,
  lastActivated: null
};

// Validation functions
const validateIntensity = (intensity) => {
  const num = parseInt(intensity);
  return !isNaN(num) && num >= 0 && num <= 100;
};

const validateTime = (time) => {
  const num = parseInt(time);
  return !isNaN(num) && num >= 300 && num <= 30000;
};

// Routes

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    shocker: {
      isOn: shockerState.isOn,
      currentIntensity: shockerState.currentIntensity,
      currentTime: shockerState.currentTime
    }
  });
});

// Get shocker status
app.get('/shocker/status', (req, res) => {
  res.json({
    isOn: shockerState.isOn,
    currentIntensity: shockerState.currentIntensity,
    currentTime: shockerState.currentTime,
    lastActivated: shockerState.lastActivated
  });
});

// Activate shocker
app.post('/shocker/activate', (req, res) => {
  const { intensity, time } = req.body;

  // Validate input
  if (!intensity || !time) {
    return res.status(400).json({
      error: 'Missing required parameters',
      message: 'Both intensity and time are required'
    });
  }

  if (!validateIntensity(intensity)) {
    return res.status(400).json({
      error: 'Invalid intensity',
      message: 'Intensity must be a number between 0 and 100'
    });
  }

  if (!validateTime(time)) {
    return res.status(400).json({
      error: 'Invalid time',
      message: 'Time must be a number between 300 and 30000 milliseconds'
    });
  }

  // Update shocker state
  shockerState.isOn = true;
  shockerState.currentIntensity = parseInt(intensity);
  shockerState.currentTime = parseInt(time);
  shockerState.lastActivated = new Date().toISOString();

  // Simulate shock duration (in a real implementation, this would control actual hardware)
  setTimeout(() => {
    shockerState.isOn = false;
    console.log(`Shock completed: ${intensity}% intensity for ${time}ms`);
  }, parseInt(time));

  res.json({
    success: true,
    message: 'Shocker activated',
    shocker: {
      isOn: shockerState.isOn,
      intensity: shockerState.currentIntensity,
      time: shockerState.currentTime,
      activatedAt: shockerState.lastActivated
    }
  });
});

// Stop shocker
app.post('/shocker/stop', (req, res) => {
  shockerState.isOn = false;
  shockerState.currentIntensity = 0;
  shockerState.currentTime = 0;

  res.json({
    success: true,
    message: 'Shocker stopped',
    shocker: {
      isOn: shockerState.isOn,
      intensity: shockerState.currentIntensity,
      time: shockerState.currentTime
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: 'Something went wrong!'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested endpoint does not exist'
  });
});

// Initialize Let's Encrypt
let sslOptions = null;
const domain = process.env.DOMAIN || 'localhost';

// Function to setup SSL certificates
const setupSSL = async () => {
  try {
    console.log('🔒 Setting up Let\'s Encrypt SSL certificates...');
    
    // Initialize ACME client
    await initializeACME();
    
    // Check if we have a valid certificate
    const hasCert = await hasValidCertificate(domain);
    
    if (!hasCert) {
      console.log(`📜 Requesting new certificate for ${domain}...`);
      await requestCertificate(domain);
    }
    
    // Get SSL options
    sslOptions = await getSSLOptions(domain);
    console.log('✅ SSL certificates ready');
    
  } catch (error) {
    console.error('❌ Failed to setup SSL certificates:', error.message);
    console.log('🔄 Falling back to self-signed certificates...');
    
    // Fallback to self-signed certificates
    try {
      sslOptions = {
        key: fs.readFileSync(path.join(__dirname, 'certs', 'private-key.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'certs', 'certificate.pem'))
      };
    } catch (fallbackError) {
      console.error('❌ No SSL certificates available. Please run: npm run generate-cert');
      process.exit(1);
    }
  }
};

// Start servers
const startServers = async () => {
  // Setup SSL certificates first
  await setupSSL();
  
  // Start HTTP server
  const httpServer = http.createServer(app);
  httpServer.listen(HTTP_PORT, () => {
    console.log(`🌐 HTTP server running on port ${HTTP_PORT}`);
    console.log(`   Health check: http://${domain}:${HTTP_PORT}/health`);
    console.log(`   Shocker status: http://${domain}:${HTTP_PORT}/shocker/status`);
  });

  // Start HTTPS server
  const httpsServer = https.createServer(sslOptions, app);
  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`🔒 HTTPS server running on port ${HTTPS_PORT}`);
    console.log(`   Health check: https://${domain}:${HTTPS_PORT}/health`);
    console.log(`   Shocker status: https://${domain}:${HTTPS_PORT}/shocker/status`);
  });
  
  return { httpServer, httpsServer };
};

// Start the servers
startServers().then(servers => {
  httpServer = servers.httpServer;
  httpsServer = servers.httpsServer;
}).catch(error => {
  console.error('❌ Failed to start servers:', error.message);
  process.exit(1);
});

// Graceful shutdown
let httpServer, httpsServer;

process.on('SIGTERM', () => {
  console.log('🛑 Shutting down servers...');
  if (httpServer) {
    httpServer.close(() => {
      console.log('✅ HTTP server closed');
    });
  }
  if (httpsServer) {
    httpsServer.close(() => {
      console.log('✅ HTTPS server closed');
      process.exit(0);
    });
  }
});

process.on('SIGINT', () => {
  console.log('🛑 Shutting down servers...');
  if (httpServer) {
    httpServer.close(() => {
      console.log('✅ HTTP server closed');
    });
  }
  if (httpsServer) {
    httpsServer.close(() => {
      console.log('✅ HTTPS server closed');
      process.exit(0);
    });
  }
});
