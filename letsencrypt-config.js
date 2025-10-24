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
    
    // Create order
    const order = await client.createOrder({
      identifiers: [{ type: 'dns', value: domain }]
    });
    
    // Get authorization
    const authz = await client.getAuthorization(order.authorizations[0]);
    
    // Create HTTP-01 challenge
    const challenge = authz.challenges.find(c => c.type === 'http-01');
    const keyAuthorization = await client.getChallengeKeyAuthorization(challenge);
    
    // Serve challenge file
    const challengePath = path.join(__dirname, 'public', '.well-known', 'acme-challenge', challenge.token);
    fs.mkdirSync(path.dirname(challengePath), { recursive: true });
    fs.writeFileSync(challengePath, keyAuthorization);
    
    // Verify challenge
    await client.verifyChallenge(authz, challenge);
    await client.completeChallenge(challenge);
    await client.waitForValidStatus(challenge);
    
    // Create certificate
    const [key, csr] = await acme.forge.createCsr({
      commonName: domain,
      key: certKey
    });
    
    const cert = await client.getCertificate(order);
    
    // Save certificate
    const certPath = path.join(acmeConfig.certDir, `${domain}-cert.pem`);
    fs.writeFileSync(certPath, cert);
    
    console.log(`✅ Certificate created for ${domain}`);
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
    
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
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