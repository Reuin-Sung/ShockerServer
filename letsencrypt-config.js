const greenlock = require('greenlock');
const path = require('path');

// Let's Encrypt configuration
const greenlockConfig = {
  // Let's Encrypt v2 staging server (for testing)
  // Change to 'https://acme-v02.api.letsencrypt.org/directory' for production
  server: process.env.NODE_ENV === 'production' 
    ? 'https://acme-v02.api.letsencrypt.org/directory'
    : 'https://acme-staging-v02.api.letsencrypt.org/directory',
  
  // Email for Let's Encrypt notifications
  email: process.env.LE_EMAIL || 'admin@example.com',
  
  // Agree to Let's Encrypt terms of service
  agreeTos: true,
  
  // Store certificates in ./certs directory
  configDir: path.join(__dirname, 'certs'),
  
  // Domains to secure
  domains: process.env.DOMAINS ? process.env.DOMAINS.split(',') : ['localhost'],
  
  // Certificate renewal settings
  renewWithin: 14 * 24 * 60 * 60 * 1000, // 14 days
  renewBy: 10 * 24 * 60 * 60 * 1000,      // 10 days
  
  // Security settings
  securityUpdates: true,
  
  // Logging
  logLevel: 'info',
  
  // ACME challenge handling
  challenges: {
    'http-01': {
      module: 'acme-http-01-standalone',
      webroot: path.join(__dirname, 'public')
    }
  }
};

// Initialize Greenlock
let greenlockInstance = null;

const initializeGreenlock = () => {
  if (!greenlockInstance) {
    try {
      greenlockInstance = greenlock.create(greenlockConfig);
      console.log('🔒 Let\'s Encrypt Greenlock initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Greenlock:', error.message);
      throw error;
    }
  }
  return greenlockInstance;
};

// Get certificate for domain
const getCertificate = async (domain) => {
  try {
    const gl = initializeGreenlock();
    const cert = await gl.get({ servername: domain });
    return cert;
  } catch (error) {
    console.error(`❌ Failed to get certificate for ${domain}:`, error.message);
    throw error;
  }
};

// Request new certificate
const requestCertificate = async (domain) => {
  try {
    const gl = initializeGreenlock();
    const cert = await gl.register({
      domains: [domain],
      email: greenlockConfig.email,
      agreeTos: true
    });
    console.log(`✅ Certificate requested for ${domain}`);
    return cert;
  } catch (error) {
    console.error(`❌ Failed to request certificate for ${domain}:`, error.message);
    throw error;
  }
};

// Check if certificate exists and is valid
const hasValidCertificate = async (domain) => {
  try {
    const gl = initializeGreenlock();
    const cert = await gl.get({ servername: domain });
    return cert && cert.privkey && cert.cert;
  } catch (error) {
    return false;
  }
};

// Get SSL options for HTTPS server
const getSSLOptions = async (domain) => {
  try {
    const cert = await getCertificate(domain);
    return {
      key: cert.privkey,
      cert: cert.cert
    };
  } catch (error) {
    console.error('❌ Failed to get SSL options:', error.message);
    throw error;
  }
};

module.exports = {
  greenlockConfig,
  initializeGreenlock,
  getCertificate,
  requestCertificate,
  hasValidCertificate,
  getSSLOptions
};
