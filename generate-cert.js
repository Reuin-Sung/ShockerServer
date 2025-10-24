const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Create certs directory if it doesn't exist
const certsDir = path.join(__dirname, 'certs');
if (!fs.existsSync(certsDir)) {
  fs.mkdirSync(certsDir);
}

console.log('Generating SSL certificates...');

try {
  // Generate private key
  execSync('openssl genrsa -out certs/private-key.pem 2048', { stdio: 'inherit' });
  
  // Generate certificate signing request
  execSync('openssl req -new -key certs/private-key.pem -out certs/certificate.csr -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"', { stdio: 'inherit' });
  
  // Generate self-signed certificate
  execSync('openssl x509 -req -days 365 -in certs/certificate.csr -signkey certs/private-key.pem -out certs/certificate.pem', { stdio: 'inherit' });
  
  console.log('✅ SSL certificates generated successfully!');
  console.log('📁 Certificates saved in ./certs/ directory');
  console.log('🔐 Private key: certs/private-key.pem');
  console.log('📜 Certificate: certs/certificate.pem');
  
} catch (error) {
  console.error('❌ Error generating certificates:', error.message);
  console.log('\n📝 Manual certificate generation:');
  console.log('1. Install OpenSSL if not already installed');
  console.log('2. Run the following commands:');
  console.log('   mkdir certs');
  console.log('   openssl genrsa -out certs/private-key.pem 2048');
  console.log('   openssl req -new -key certs/private-key.pem -out certs/certificate.csr');
  console.log('   openssl x509 -req -days 365 -in certs/certificate.csr -signkey certs/private-key.pem -out certs/certificate.pem');
}
