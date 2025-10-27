#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Generate API keys
const generateApiKeys = (count = 10) => {
  const keys = [];
  for (let i = 0; i < count; i++) {
    keys.push(crypto.randomBytes(32).toString('hex'));
  }
  return keys;
};

// Create API keys file
const createApiKeysFile = () => {
  const keys = generateApiKeys(10);
  const keysPath = path.join(__dirname, 'api-keys.txt');
  
  // Write keys to file
  fs.writeFileSync(keysPath, keys.join('\n'));
  
  console.log('🔑 Generated API keys file: api-keys.txt');
  console.log(`📊 Generated ${keys.length} API keys`);
  console.log('\n📋 API Keys:');
  console.log('='.repeat(80));
  
  keys.forEach((key, index) => {
    console.log(`${(index + 1).toString().padStart(2, ' ')}. ${key}`);
  });
  
  console.log('='.repeat(80));
  console.log('\n💡 Usage:');
  console.log('Include the apiKey in your POST request to /broadcast:');
  console.log('curl -X POST http://localhost:80/broadcast \\');
  console.log('  -H "Content-Type: application/json" \\');
  console.log('  -d \'{"intensity": 50, "duration": 1000, "type": "shock", "apiKey": "YOUR_KEY_HERE"}\'');
  
  return keys;
};

// Run if called directly
if (require.main === module) {
  createApiKeysFile();
}

module.exports = { generateApiKeys, createApiKeysFile };
