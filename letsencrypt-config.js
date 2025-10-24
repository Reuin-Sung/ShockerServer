const letsencrypt = require('node-letsencrypt');
const path = require('path');
const fs = require('fs');

// Let's Encrypt configuration
const leConfig = {
  // Let's Encrypt server (staging for testing, production for live)
  server: process.env.NODE_ENV === 'production' 
    ? 'https://acme-v02.api.letsencrypt.org/directory'
    : 'https://acme-staging-v02.api.letsencrypt.org/directory',
  
  // Email for Let's Encrypt notifications
  email: process.env.LE_EMAIL || 'resung25@proton.me',
  
  // Agree to Let's Encrypt terms of service
  agreeTos: true,
  
  // Store certificates in ./certs directory
  certDir: path.join(__dirname, 'certs'),
  
  // Domains to secure
  domains: process.env.DOMAINS ? process.env.DOMAINS.split(',') : ['localhost'],
  
  // Certificate renewal settings
  renewWithin: 14 * 24 * 60 * 60 * 1000, // 14 days
  renewBy: 10 * 24 * 60 * 60 * 1000,      // 10 days
};

// Initialize Let's Encrypt
let leInstance = null;

const initializeLetsEncrypt = () => {
  if (!leInstance) {
    try {
      leInstance = letsencrypt.create(leConfig);
      console.log('🔒 Let\'s Encrypt initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Let\'s Encrypt:', error.message);
      throw error;
    }
  }
  return leInstance;
};

// Get certificate for domain
const getCertificate = async (domain) => {
  try {
    const le = initializeLetsEncrypt();
    const cert = await le.get({ servername: domain });
    return cert;
  } catch (error) {
    console.error(`❌ Failed to get certificate for ${domain}:`, error.message);
    throw error;
  }
};

// Request new certificate
const requestCertificate = async (domain) => {
  try {
    const le = initializeLetsEncrypt();
    const cert = await le.register({
      domains: [domain],
      email: leConfig.email,
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
    const le = initializeLetsEncrypt();
    const cert = await le.get({ servername: domain });
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
  leConfig,
  initializeLetsEncrypt,
  getCertificate,
  requestCertificate,
  hasValidCertificate,
  getSSLOptions
};