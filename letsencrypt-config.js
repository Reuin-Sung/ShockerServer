// Load environment variables first
require('dotenv').config();

const acme = require('acme-client');
const fs = require('fs');
const path = require('path');

// Let's Encrypt configuration
const acmeConfig = {
  // Let's Encrypt server (staging for testing, production for live)
  directoryUrl: process.env.NODE_ENV === 'production' 
    ? 'https://acme-v02.api.letsencrypt.org/directory'
    : 'https://acme-staging-v02.api.letsencrypt.org/directory',
  
  // Email for Let's Encrypt notifications
  email: process.env.LE_EMAIL || 'resung25@proton.me',
  
  // Store certificates in ./certs directory
  certDir: path.join(__dirname, 'certs'),
  
  // Domains to secure
  domains: process.env.DOMAINS ? process.env.DOMAINS.split(',') : ['localhost'],
};

// Initialize ACME client
let acmeClient = null;

const initializeACME = async () => {
  if (!acmeClient) {
    try {
      acmeClient = new acme.Client({
        directoryUrl: acmeConfig.directoryUrl,
        accountKey: await getOrCreateAccountKey()
      });
      console.log('🔒 ACME client initialized');
    } catch (error) {
      console.error('❌ Failed to initialize ACME client:', error.message);
      throw error;
    }
  }
  return acmeClient;
};

// Get or create account key
const getOrCreateAccountKey = async () => {
  const keyPath = path.join(acmeConfig.certDir, 'account-key.pem');
  
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath);
  }
  
  // Create new account key
  const accountKey = await acme.forge.createPrivateKey();
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, accountKey);
  return accountKey;
};

// Get or create certificate key
const getOrCreateCertKey = async (domain) => {
  const keyPath = path.join(acmeConfig.certDir, `${domain}-key.pem`);
  
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath);
  }
  
  // Create new certificate key
  const certKey = await acme.forge.createPrivateKey();
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, certKey);
  return certKey;
};

// Check if certificate exists and is valid
const hasValidCertificate = async (domain) => {
  try {
    const certPath = path.join(acmeConfig.certDir, `${domain}-cert.pem`);
    const keyPath = path.join(acmeConfig.certDir, `${domain}-key.pem`);
    
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      return false;
    }
    
    // Check if certificate is expired (basic check)
    const cert = fs.readFileSync(certPath, 'utf8');
    const notAfterMatch = cert.match(/Not After : (.+)/);
    
    if (notAfterMatch) {
      const expiryDate = new Date(notAfterMatch[1]);
      const now = new Date();
      return expiryDate > now;
    }
    
    return true;
  } catch (error) {
    return false;
  }
};

// Request new certificate
const requestCertificate = async (domain) => {
  try {
    const client = await initializeACME();
    const certKey = await getOrCreateCertKey(domain);
    
    // Create account if needed
    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${acmeConfig.email}`]
    });
    
    // Create CSR
    const [key, csr] = await acme.forge.createCsr({
      commonName: domain,
      key: certKey
    });
    
    console.log(`🌐 Testing domain accessibility...`);
    console.log(`📡 Domain: ${domain}`);
    console.log(`🔗 Test URL: http://${domain}/.well-known/acme-challenge/test`);
    
    // Use the auto method which handles everything
    const cert = await Promise.race([
      client.auto({
        csr,
        email: acmeConfig.email,
        termsOfServiceAgreed: true,
        challengeCreateFn: async (authz, challenge, keyAuthorization) => {
          // Serve challenge file
          const challengePath = path.join(__dirname, 'public', '.well-known', 'acme-challenge', challenge.token);
          fs.mkdirSync(path.dirname(challengePath), { recursive: true });
          fs.writeFileSync(challengePath, keyAuthorization);
          console.log(`📁 Challenge file created: ${challengePath}`);
          console.log(`🔗 Challenge URL: http://${domain}/.well-known/acme-challenge/${challenge.token}`);
          console.log(`📄 Challenge content: ${keyAuthorization}`);
          console.log(`⏳ Waiting for Let's Encrypt to verify challenge...`);
        },
        challengeRemoveFn: async (authz, challenge) => {
          // Remove challenge file
          const challengePath = path.join(__dirname, 'public', '.well-known', 'acme-challenge', challenge.token);
          if (fs.existsSync(challengePath)) {
            fs.unlinkSync(challengePath);
            console.log(`🗑️ Challenge file removed: ${challengePath}`);
          }
        }
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Certificate request timeout after 1 minute')), 1 * 60 * 1000)
      )
    ]);
    
    // Save certificate and key
    const certPath = path.join(acmeConfig.certDir, `${domain}-cert.pem`);
    const keyPath = path.join(acmeConfig.certDir, `${domain}-key.pem`);
    fs.writeFileSync(certPath, cert);
    fs.writeFileSync(keyPath, certKey);
    
    console.log(`✅ Certificate created for ${domain}`);
    console.log(`📁 Certificate saved: ${certPath}`);
    console.log(`🔑 Key saved: ${keyPath}`);
    return { key: certKey, cert };
    
  } catch (error) {
    console.error(`❌ Failed to request certificate for ${domain}:`, error.message);
    throw error;
  }
};

// Get certificate for domain
const getCertificate = async (domain) => {
  try {
    const certPath = path.join(acmeConfig.certDir, `${domain}-cert.pem`);
    const keyPath = path.join(acmeConfig.certDir, `${domain}-key.pem`);
    
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      throw new Error(`Certificate not found for ${domain}`);
    }
    
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    
    console.log(`📜 Loading certificate for ${domain}`);
    console.log(`🔑 Key size: ${key.length} bytes`);
    console.log(`📄 Cert size: ${cert.length} bytes`);
    
    return { key, cert };
  } catch (error) {
    console.error(`❌ Failed to get certificate for ${domain}:`, error.message);
    throw error;
  }
};

// Get SSL options for HTTPS server
const getSSLOptions = async (domain) => {
  try {
    const cert = await getCertificate(domain);
    return {
      key: cert.key,
      cert: cert.cert
    };
  } catch (error) {
    console.error('❌ Failed to get SSL options:', error.message);
    throw error;
  }
};

module.exports = {
  acmeConfig,
  initializeACME,
  getCertificate,
  requestCertificate,
  hasValidCertificate,
  getSSLOptions
};