const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class CertificateManager {
  constructor() {
    this.certsDir = path.join(__dirname, 'certs');
    this.privateKeyPath = path.join(this.certsDir, 'private-key.pem');
    this.certPath = path.join(this.certsDir, 'certificate.pem');
    this.csrPath = path.join(this.certsDir, 'certificate.csr');
  }

  // Check if certificates exist
  certificatesExist() {
    return fs.existsSync(this.privateKeyPath) && fs.existsSync(this.certPath);
  }

  // Check certificate expiration
  isCertificateExpired() {
    try {
      const result = execSync(`openssl x509 -in ${this.certPath} -noout -dates`, { encoding: 'utf8' });
      const notAfterMatch = result.match(/notAfter=(.+)/);
      if (notAfterMatch) {
        const expiryDate = new Date(notAfterMatch[1]);
        const now = new Date();
        const daysUntilExpiry = (expiryDate - now) / (1000 * 60 * 60 * 24);
        return daysUntilExpiry < 30; // Consider expired if less than 30 days
      }
    } catch (error) {
      console.warn('Could not check certificate expiry:', error.message);
    }
    return false;
  }

  // Generate new certificates
  generateCertificates() {
    console.log('🔐 Generating new SSL certificates...');
    
    try {
      // Create certs directory if it doesn't exist
      if (!fs.existsSync(this.certsDir)) {
        fs.mkdirSync(this.certsDir, { recursive: true });
      }

      // Generate private key
      execSync(`openssl genrsa -out ${this.privateKeyPath} 2048`, { stdio: 'inherit' });
      
      // Generate certificate signing request
      execSync(`openssl req -new -key ${this.privateKeyPath} -out ${this.csrPath} -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"`, { stdio: 'inherit' });
      
      // Generate self-signed certificate
      execSync(`openssl x509 -req -days 365 -in ${this.csrPath} -signkey ${this.privateKeyPath} -out ${this.certPath}`, { stdio: 'inherit' });
      
      console.log('✅ SSL certificates generated successfully!');
      return true;
    } catch (error) {
      console.error('❌ Error generating certificates:', error.message);
      return false;
    }
  }

  // Auto-renewal check
  checkAndRenew() {
    if (!this.certificatesExist()) {
      console.log('📜 No certificates found, generating new ones...');
      return this.generateCertificates();
    }

    if (this.isCertificateExpired()) {
      console.log('⚠️  Certificate is expiring soon, renewing...');
      return this.generateCertificates();
    }

    console.log('✅ Certificates are valid');
    return true;
  }

  // Get certificate info
  getCertificateInfo() {
    if (!this.certificatesExist()) {
      return { exists: false };
    }

    try {
      const result = execSync(`openssl x509 -in ${this.certPath} -noout -text`, { encoding: 'utf8' });
      const subjectMatch = result.match(/Subject: (.+)/);
      const issuerMatch = result.match(/Issuer: (.+)/);
      const notBeforeMatch = result.match(/Not Before: (.+)/);
      const notAfterMatch = result.match(/Not After: (.+)/);

      return {
        exists: true,
        subject: subjectMatch ? subjectMatch[1] : 'Unknown',
        issuer: issuerMatch ? issuerMatch[1] : 'Unknown',
        notBefore: notBeforeMatch ? notBeforeMatch[1] : 'Unknown',
        notAfter: notAfterMatch ? notAfterMatch[1] : 'Unknown'
      };
    } catch (error) {
      return { exists: true, error: error.message };
    }
  }
}

module.exports = CertificateManager;
