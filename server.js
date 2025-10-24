const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Start server
app.listen(PORT, () => {
  console.log(`Shocker server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Shocker status: http://localhost:${PORT}/shocker/status`);
});
