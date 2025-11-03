// Load environment variables first
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
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

// Serve ACME challenge files for Let's Encrypt
app.use('/.well-known/acme-challenge', express.static(path.join(__dirname, 'public', '.well-known', 'acme-challenge')));

// Test endpoint for domain verification
app.get('/.well-known/acme-challenge/test', (req, res) => {
  res.send('Domain verification test - server is accessible');
});

// In-memory storage for shocker state
let shockerState = {
  isOn: false,
  currentIntensity: 0,
  currentTime: 0,
  lastActivated: null
};

// WebSocket server instances
let wssHttp = null;
let wssHttps = null;
const connectedClients = new Set();
// Map of WebSocket -> {apiKey, shockers: []}
const broadcastSubscribers = new Map();

// WebSocket message types
const WS_MESSAGE_TYPES = {
  STATUS: 'status',
  SHOCK_ACTIVATED: 'shock_activated',
  SHOCK_STOPPED: 'shock_stopped',
  BROADCAST: 'broadcast',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
  SUBSCRIBE_BROADCAST: 'subscribe_broadcast',
  UNSUBSCRIBE_BROADCAST: 'unsubscribe_broadcast',
  SUBSCRIBED: 'subscribed',
  UNSUBSCRIBED: 'unsubscribed'
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

// API Key management
const apiKeys = new Set();
const loadApiKeys = () => {
  try {
    const keysPath = path.join(__dirname, 'api-keys.txt');
    
    if (fs.existsSync(keysPath)) {
      const keysContent = fs.readFileSync(keysPath, 'utf8');
      const keys = keysContent.split('\n')
        .map(key => key.trim())
        .filter(key => key.length > 0);
      
      keys.forEach(key => apiKeys.add(key));
      console.log(`🔑 Loaded ${apiKeys.size} API keys`);
    } else {
      console.log('⚠️  No API keys file found. Creating default keys...');
      generateDefaultKeys();
    }
  } catch (error) {
    console.error('Error loading API keys:', error);
    generateDefaultKeys();
  }
};

const generateDefaultKeys = () => {
  const defaultKeys = [
    crypto.randomBytes(32).toString('hex'),
    crypto.randomBytes(32).toString('hex'),
    crypto.randomBytes(32).toString('hex'),
    crypto.randomBytes(32).toString('hex'),
    crypto.randomBytes(32).toString('hex')
  ];
  
  defaultKeys.forEach(key => apiKeys.add(key));
  
  // Save to file
  const keysPath = path.join(__dirname, 'api-keys.txt');
  fs.writeFileSync(keysPath, defaultKeys.join('\n'));
  console.log(`🔑 Generated and saved ${defaultKeys.length} default API keys to api-keys.txt`);
};

const validateApiKey = (key) => {
  return apiKeys.has(key);
};

// WebSocket utility functions
const broadcastToClients = (message) => {
  const messageStr = JSON.stringify(message);
  connectedClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
};

// Broadcast to subscribers only
const broadcastToSubscribers = (message) => {
  const messageStr = JSON.stringify(message);
  let sentCount = 0;
  broadcastSubscribers.forEach((subscriberData, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(messageStr);
        sentCount++;
      } catch (error) {
        console.error('Error sending to broadcast subscriber:', error);
        // Remove dead connection
        broadcastSubscribers.delete(ws);
      }
    } else {
      // Remove closed connections
      broadcastSubscribers.delete(ws);
    }
  });
  return sentCount;
};

// Collect all shockers from all subscribers
const collectSubscriberShockers = () => {
  const allShockers = new Set();
  broadcastSubscribers.forEach((subscriberData, ws) => {
    if (ws.readyState === WebSocket.OPEN && subscriberData.shockers) {
      subscriberData.shockers.forEach(shockerId => {
        allShockers.add(shockerId);
      });
    }
  });
  return Array.from(allShockers);
};

// Send control command to OpenShock API
const sendOpenShockControl = (shockers, intensity, duration, type) => {
  return new Promise((resolve, reject) => {
    const apiToken = process.env.OPENSHOCK_API_TOKEN;
    const openshockShockers = process.env.OPENSHOCK_SHOCKER_IDS;
    
    // Check if OpenShock integration is enabled
    if (!apiToken || !openshockShockers) {
      resolve({ enabled: false, message: 'OpenShock API not configured' });
      return;
    }
    
    // Parse shocker IDs (comma-separated list from env)
    let shockerList;
    try {
      shockerList = openshockShockers.split(',').map(id => id.trim()).filter(id => id.length > 0);
    } catch (error) {
      reject(new Error(`Failed to parse OpenShock shocker IDs: ${error.message}`));
      return;
    }
    
    // If specific shockers are provided, use them; otherwise use env list
    const shockerIds = shockers && shockers.length > 0 ? shockers : shockerList;
    
    if (shockerIds.length === 0) {
      resolve({ enabled: false, message: 'No shockers specified' });
      return;
    }
    
    // OpenShock API expects duration in milliseconds (based on API docs)
    // Convert type to match OpenShock API format
    const openshockType = type === 'vibrate' ? 'vibrate' : 'shock';
    
    const payload = JSON.stringify({
      shockers: shockerIds,
      intensity: parseInt(intensity),
      duration: parseInt(duration),
      type: openshockType
    });
    
    const options = {
      hostname: 'api.openshock.app',
      path: '/2/shockers/control',
      method: 'POST',
      headers: {
        'Open-Shock-Token': apiToken,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const response = data ? JSON.parse(data) : {};
            resolve({
              enabled: true,
              success: true,
              statusCode: res.statusCode,
              data: response,
              shockers: shockerIds
            });
          } else {
            const errorResponse = data ? JSON.parse(data) : { message: 'Unknown error' };
            resolve({
              enabled: true,
              success: false,
              statusCode: res.statusCode,
              error: errorResponse
            });
          }
        } catch (error) {
          reject(new Error(`Failed to parse OpenShock API response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`OpenShock API request failed: ${error.message}`));
    });
    
    req.write(payload);
    req.end();
  });
};

// Broadcast a message with intensity, duration, and type to all connected clients
const broadcastMessage = async (intensity, duration, type) => {
  // Validate type
  const validTypes = ['shock', 'vibrate'];
  if (!validTypes.includes(type)) {
    console.error('Invalid broadcast type:', type);
    return false;
  }

  // Validate intensity (0-100)
  if (!validateIntensity(intensity)) {
    console.error('Invalid intensity for broadcast:', intensity);
    return false;
  }

  // Validate duration (300-30000ms)
  if (!validateTime(duration)) {
    console.error('Invalid duration for broadcast:', duration);
    return false;
  }

  const message = {
    type: WS_MESSAGE_TYPES.BROADCAST,
    data: {
      intensity: parseInt(intensity),
      duration: parseInt(duration),
      type: type,
      timestamp: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  };

  const subscriberCount = broadcastSubscribers.size;
  console.log(`📡 Broadcasting ${type} message: ${intensity}% intensity for ${duration}ms to ${subscriberCount} broadcast subscriber(s)`);
  
  // Broadcast to broadcast subscribers only
  const sentCount = broadcastToSubscribers(message);
  if (sentCount > 0) {
    console.log(`   ✅ Sent to ${sentCount} subscriber(s)`);
  }
  
  // Collect all shockers from subscribed clients
  const allShockers = collectSubscriberShockers();
  
  // Send to OpenShock API if there are any shockers from subscribers
  if (allShockers.length > 0) {
    try {
      const openshockResult = await sendOpenShockControl(allShockers, intensity, duration, type);
      if (openshockResult.enabled) {
        if (openshockResult.success) {
          console.log(`✅ OpenShock API: Control sent to ${openshockResult.shockers.length} shocker(s) from subscribers`);
        } else {
          const errorMsg = (openshockResult.error && openshockResult.error.message) ? openshockResult.error.message : 'Unknown error';
          console.error(`❌ OpenShock API: Control failed - ${errorMsg}`);
        }
      }
    } catch (error) {
      console.error(`❌ OpenShock API error: ${error.message}`);
    }
  }
  
  return true;
};

// Execute broadcast function (extracted from POST endpoint for reuse)
// This function performs validation and executes the broadcast
// Note: shockers are collected from subscribed clients, not passed as parameter
const executeBroadcast = async (intensity, duration, type) => {
  // Validate input
  if (!intensity || !duration || !type) {
    return {
      success: false,
      error: 'Missing required parameters',
      message: 'intensity, duration, and type are required'
    };
  }

  // Validate type
  const validTypes = ['shock', 'vibrate'];
  if (!validTypes.includes(type)) {
    return {
      success: false,
      error: 'Invalid type',
      message: 'Type must be either "shock" or "vibrate"'
    };
  }

  if (!validateIntensity(intensity)) {
    return {
      success: false,
      error: 'Invalid intensity',
      message: 'Intensity must be a number between 0 and 100'
    };
  }

  if (!validateTime(duration)) {
    return {
      success: false,
      error: 'Invalid duration',
      message: 'Duration must be a number between 300 and 30000 milliseconds'
    };
  }

  // Execute the broadcast (now async)
  // Note: shockers are collected from subscribed clients, not passed here
  const success = await broadcastMessage(intensity, duration, type);
  
  if (success) {
      return {
      success: true,
      message: 'Broadcast sent to all broadcast subscribers',
      broadcast: {
        intensity: parseInt(intensity),
        duration: parseInt(duration),
        type: type,
        subscribers: broadcastSubscribers.size
      }
    };
  } else {
    return {
      success: false,
      error: 'Broadcast failed',
      message: 'Failed to send broadcast message'
    };
  }
};

const createWebSocketServer = (server, port) => {
  const wss = new WebSocket.Server({ 
    server,
    path: '/ws'
  });

  wss.on('connection', (ws, req) => {
    const clientAddress = req.socket.remoteAddress;
    console.log(`🔌 New WebSocket connection from ${clientAddress} on port ${port}`);
    connectedClients.add(ws);

    // Handle incoming messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        switch (data.type) {
          case WS_MESSAGE_TYPES.PING:
            ws.send(JSON.stringify({
              type: WS_MESSAGE_TYPES.PONG,
              timestamp: new Date().toISOString()
            }));
            break;
          case WS_MESSAGE_TYPES.STATUS:
            ws.send(JSON.stringify({
              type: WS_MESSAGE_TYPES.STATUS,
              data: shockerState,
              timestamp: new Date().toISOString()
            }));
            break;
          case WS_MESSAGE_TYPES.SUBSCRIBE_BROADCAST:
            // Parse shockers (can be array or comma-separated string)
            let shockerList = [];
            if (data.shockers) {
              if (Array.isArray(data.shockers)) {
                shockerList = data.shockers.map(id => String(id).trim()).filter(id => id.length > 0);
              } else if (typeof data.shockers === 'string') {
                shockerList = data.shockers.split(',').map(id => id.trim()).filter(id => id.length > 0);
              }
            }
            
            // If no shockers provided, use default from environment
            if (shockerList.length === 0) {
              const defaultShockers = process.env.OPENSHOCK_SHOCKER_IDS;
              if (defaultShockers) {
                shockerList = defaultShockers.split(',').map(id => id.trim()).filter(id => id.length > 0);
              }
            }
            
            // Store subscription with API key and shockers
            broadcastSubscribers.set(ws, {
              apiKey: data.apiKey,
              shockers: shockerList
            });
            
            console.log(`📡 Client ${clientAddress} subscribed to broadcasts with ${shockerList.length} shocker(s) (${broadcastSubscribers.size} total)`);
            ws.send(JSON.stringify({
              type: WS_MESSAGE_TYPES.SUBSCRIBED,
              message: 'Successfully subscribed to broadcasts',
              shockers: shockerList,
              timestamp: new Date().toISOString()
            }));
            break;
          case WS_MESSAGE_TYPES.UNSUBSCRIBE_BROADCAST:
            if (broadcastSubscribers.has(ws)) {
              broadcastSubscribers.delete(ws);
              console.log(`📡 Client ${clientAddress} unsubscribed from broadcasts (${broadcastSubscribers.size} remaining)`);
              ws.send(JSON.stringify({
                type: WS_MESSAGE_TYPES.UNSUBSCRIBED,
                message: 'Successfully unsubscribed from broadcasts',
                timestamp: new Date().toISOString()
              }));
            } else {
              ws.send(JSON.stringify({
                type: WS_MESSAGE_TYPES.UNSUBSCRIBED,
                message: 'Not subscribed to broadcasts',
                timestamp: new Date().toISOString()
              }));
            }
            break;
          default:
            console.log('Unknown message type:', data.type);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
        ws.send(JSON.stringify({
          type: WS_MESSAGE_TYPES.ERROR,
          message: 'Invalid message format',
          timestamp: new Date().toISOString()
        }));
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      console.log(`🔌 WebSocket connection closed from ${clientAddress} on port ${port}`);
      connectedClients.delete(ws);
      // Remove from broadcast subscribers if subscribed
      if (broadcastSubscribers.has(ws)) {
        const subscriberData = broadcastSubscribers.get(ws);
        broadcastSubscribers.delete(ws);
        console.log(`   📡 Removed from broadcast subscribers (${broadcastSubscribers.size} remaining)`);
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`WebSocket error from ${clientAddress}:`, error);
      connectedClients.delete(ws);
      // Remove from broadcast subscribers if subscribed
      if (broadcastSubscribers.has(ws)) {
        broadcastSubscribers.delete(ws);
        console.log(`   📡 Removed from broadcast subscribers (${broadcastSubscribers.size} remaining)`);
      }
    });
  });

  return wss;
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

  // Broadcast shock activation to all connected clients
  broadcastToClients({
    type: WS_MESSAGE_TYPES.SHOCK_ACTIVATED,
    data: {
      isOn: shockerState.isOn,
      intensity: shockerState.currentIntensity,
      time: shockerState.currentTime,
      activatedAt: shockerState.lastActivated
    },
    timestamp: new Date().toISOString()
  });

  // Simulate shock duration (in a real implementation, this would control actual hardware)
  setTimeout(() => {
    shockerState.isOn = false;
    console.log(`Shock completed: ${intensity}% intensity for ${time}ms`);
    
    // Broadcast shock completion to all connected clients
    broadcastToClients({
      type: WS_MESSAGE_TYPES.STATUS,
      data: shockerState,
      timestamp: new Date().toISOString()
    });
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

  // Broadcast shock stop to all connected clients
  broadcastToClients({
    type: WS_MESSAGE_TYPES.SHOCK_STOPPED,
    data: {
      isOn: shockerState.isOn,
      intensity: shockerState.currentIntensity,
      time: shockerState.currentTime
    },
    timestamp: new Date().toISOString()
  });

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

// Broadcast message to all WebSocket clients
app.post('/broadcast', async (req, res) => {
  const { intensity, duration, type, apiKey } = req.body;

  // Validate API key
  if (!apiKey || !validateApiKey(apiKey)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid API key is required'
    });
  }

  // Use the extracted executeBroadcast function (now async)
  // Note: shockers are automatically collected from subscribed clients via subscribe_broadcast
  const result = await executeBroadcast(intensity, duration, type);
  
  if (result.success) {
    res.json(result);
  } else {
    const statusCode = result.error === 'Missing required parameters' || 
                       result.error === 'Invalid type' || 
                       result.error === 'Invalid intensity' || 
                       result.error === 'Invalid duration' ? 400 : 500;
    res.status(statusCode).json(result);
  }
});

// List API keys (admin endpoint)
app.get('/admin/keys', (req, res) => {
  const { apiKey } = req.query;
  
  // Validate API key
  if (!apiKey || !validateApiKey(apiKey)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid API key is required'
    });
  }
  
  const keysArray = Array.from(apiKeys);
  res.json({
    success: true,
    count: keysArray.length,
    keys: keysArray.map((key, index) => ({
      id: index + 1,
      key: key,
      preview: key.substring(0, 8) + '...' + key.substring(key.length - 8)
    }))
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

// YouTube subscriber count functionality
const getYouTubeSubscriberCount = () => {
  return new Promise((resolve, reject) => {
    const youtubeApiKey = process.env.YOUTUBE_API_KEY;
    const youtubeChannelId = process.env.YOUTUBE_CHANNEL_ID;
    
    if (!youtubeApiKey || !youtubeChannelId) {
      reject(new Error('YouTube API key or Channel ID not configured. Set YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID in .env'));
      return;
    }
    
    const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id=${encodeURIComponent(youtubeChannelId)}&key=${encodeURIComponent(youtubeApiKey)}`;
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          if (response.error) {
            reject(new Error(`YouTube API Error: ${response.error.message || 'Unknown error'}`));
            return;
          }
          
          if (!response.items || response.items.length === 0) {
            reject(new Error('Channel not found'));
            return;
          }
          
          const channel = response.items[0];
          const subscriberCount = parseInt(channel.statistics.subscriberCount);
          const channelName = channel.snippet.title;
          
          resolve({
            subscriberCount,
            channelName,
            viewCount: parseInt(channel.statistics.viewCount),
            videoCount: parseInt(channel.statistics.videoCount)
          });
        } catch (error) {
          reject(new Error(`Failed to parse YouTube API response: ${error.message}`));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`Failed to fetch YouTube data: ${error.message}`));
    });
  });
};

// Function to format subscriber count (e.g., 1234567 -> "1.23M")
const formatSubscriberCount = (count) => {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(2) + 'M';
  } else if (count >= 1000) {
    return (count / 1000).toFixed(2) + 'K';
  }
  return count.toString();
};

// Track previous subscriber count for change detection
let previousSubscriberCount = null;

// Start periodic YouTube subscriber count checking
const startYouTubeSubscriberMonitoring = () => {
  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  const youtubeChannelId = process.env.YOUTUBE_CHANNEL_ID;
  
  // Broadcast configuration when subscriber count changes
  const broadcastOnSubscriberChange = process.env.YOUTUBE_BROADCAST_ON_CHANGE === 'true';
  const broadcastIntensity = parseInt(process.env.YOUTUBE_BROADCAST_INTENSITY || '50');
  const broadcastDuration = parseInt(process.env.YOUTUBE_BROADCAST_DURATION || '1000');
  const broadcastType = process.env.YOUTUBE_BROADCAST_TYPE || 'vibrate';
  
  if (!youtubeApiKey || !youtubeChannelId) {
    console.log('⚠️  YouTube monitoring not started: YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID not set in environment');
    return;
  }
  
  console.log('📺 Starting YouTube subscriber count monitoring...');
  console.log(`   Channel ID: ${youtubeChannelId}`);
  console.log(`   Checking every 60 seconds`);
  if (broadcastOnSubscriberChange) {
    console.log(`   📡 Broadcast on subscriber change: ${broadcastType} ${broadcastIntensity}% for ${broadcastDuration}ms`);
  }
  
  // Function to handle subscriber count updates
  const handleSubscriberUpdate = (data) => {
    const currentCount = data.subscriberCount;
    const formattedCount = formatSubscriberCount(currentCount);
    const countString = `${formattedCount} (${currentCount.toLocaleString()})`;
    
    // Check if subscriber count changed
    if (previousSubscriberCount !== null && previousSubscriberCount !== currentCount) {
      const change = currentCount - previousSubscriberCount;
      const changeSign = change > 0 ? '+' : '';
      console.log(`📊 YouTube Subscribers: ${countString} | Channel: ${data.channelName} | Change: ${changeSign}${change.toLocaleString()}`);
      
      // Execute broadcast if enabled
      if (broadcastOnSubscriberChange) {
        console.log(`🎉 Subscriber count changed! Triggering broadcast...`);
        executeBroadcast(broadcastIntensity, broadcastDuration, broadcastType)
          .then((result) => {
            if (result.success) {
              console.log(`✅ Broadcast sent: ${broadcastType} ${broadcastIntensity}% for ${broadcastDuration}ms`);
            } else {
              console.error(`❌ Broadcast failed: ${result.message}`);
            }
          })
          .catch((error) => {
            console.error(`❌ Broadcast error: ${error.message}`);
          });
      }
    } else {
      console.log(`📊 YouTube Subscribers: ${countString} | Channel: ${data.channelName}`);
    }
    
    // Update previous count
    previousSubscriberCount = currentCount;
  };
  
  // Fetch immediately
  getYouTubeSubscriberCount()
    .then(handleSubscriberUpdate)
    .catch((error) => {
      console.error(`❌ Error fetching YouTube subscriber count: ${error.message}`);
    });
  
  // Then fetch every 60 seconds
  setInterval(() => {
    getYouTubeSubscriberCount()
      .then(handleSubscriberUpdate)
      .catch((error) => {
        console.error(`❌ Error fetching YouTube subscriber count: ${error.message}`);
      });
  }, 60000); // 60 seconds = 60000 milliseconds
};

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
  // Load API keys
  loadApiKeys();
  
  // Start HTTP server first (needed for Let's Encrypt challenges)
  const httpServer = http.createServer(app);
  httpServer.listen(HTTP_PORT, () => {
    console.log(`🌐 HTTP server running on port ${HTTP_PORT}`);
    console.log(`   Health check: http://${domain}:${HTTP_PORT}/health`);
    console.log(`   Shocker status: http://${domain}:${HTTP_PORT}/shocker/status`);
    console.log(`   Broadcast: http://${domain}:${HTTP_PORT}/broadcast`);
    console.log(`   Admin keys: http://${domain}:${HTTP_PORT}/admin/keys`);
    console.log(`   WebSocket: ws://${domain}:${HTTP_PORT}/ws`);
  });

  // Create WebSocket server for HTTP
  wssHttp = createWebSocketServer(httpServer, HTTP_PORT);

  // Wait a moment for HTTP server to be ready
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Setup SSL certificates after HTTP server is running
  await setupSSL();
  
  // Start HTTPS server
  const httpsServer = https.createServer(sslOptions, app);
  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`🔒 HTTPS server running on port ${HTTPS_PORT}`);
    console.log(`   Health check: https://${domain}:${HTTPS_PORT}/health`);
    console.log(`   Shocker status: https://${domain}:${HTTPS_PORT}/shocker/status`);
    console.log(`   Broadcast: https://${domain}:${HTTPS_PORT}/broadcast`);
    console.log(`   Admin keys: https://${domain}:${HTTPS_PORT}/admin/keys`);
    console.log(`   WebSocket: wss://${domain}:${HTTPS_PORT}/ws`);
  });

  // Create WebSocket server for HTTPS
  wssHttps = createWebSocketServer(httpsServer, HTTPS_PORT);
  
  return { httpServer, httpsServer };
};

// Start the servers
startServers().then(servers => {
  httpServer = servers.httpServer;
  httpsServer = servers.httpsServer;
  
  // Start YouTube subscriber monitoring after servers are up
  startYouTubeSubscriberMonitoring();
}).catch(error => {
  console.error('❌ Failed to start servers:', error.message);
  process.exit(1);
});

// Graceful shutdown
let httpServer, httpsServer;

process.on('SIGTERM', () => {
  console.log('🛑 Shutting down servers...');
  
  // Close WebSocket connections
  if (wssHttp) {
    wssHttp.close(() => {
      console.log('✅ HTTP WebSocket server closed');
    });
  }
  if (wssHttps) {
    wssHttps.close(() => {
      console.log('✅ HTTPS WebSocket server closed');
    });
  }
  
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
  
  // Close WebSocket connections
  if (wssHttp) {
    wssHttp.close(() => {
      console.log('✅ HTTP WebSocket server closed');
    });
  }
  if (wssHttps) {
    wssHttps.close(() => {
      console.log('✅ HTTPS WebSocket server closed');
    });
  }
  
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
