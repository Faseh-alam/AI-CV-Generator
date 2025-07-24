#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const TokenService = require('../src/services/tokenService');

console.log('🔐 Generating RSA key pair for JWT tokens...\n');

try {
  // Create keys directory if it doesn't exist
  const keysDir = path.join(__dirname, '..', 'keys');
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
    console.log('📁 Created keys directory');
  }

  // Generate key pair
  const { publicKey, privateKey } = TokenService.generateKeyPair();

  // Write keys to files
  fs.writeFileSync(path.join(keysDir, 'private.key'), privateKey);
  fs.writeFileSync(path.join(keysDir, 'public.key'), publicKey);

  // Set appropriate permissions (Unix systems only)
  if (process.platform !== 'win32') {
    fs.chmodSync(path.join(keysDir, 'private.key'), 0o600); // Read/write for owner only
    fs.chmodSync(path.join(keysDir, 'public.key'), 0o644);  // Read for all, write for owner
  }

  console.log('✅ RSA key pair generated successfully!');
  console.log('📄 Private key: keys/private.key');
  console.log('📄 Public key: keys/public.key');
  console.log('\n⚠️  Important:');
  console.log('   - Keep private.key secure and never commit to version control');
  console.log('   - Add keys/ directory to .gitignore');
  console.log('   - In production, store keys securely (e.g., AWS Secrets Manager)');

} catch (error) {
  console.error('❌ Error generating keys:', error.message);
  process.exit(1);
}