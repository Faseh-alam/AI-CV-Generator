#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Setting up ATS Resume Optimizer...\n');

// Create necessary directories
const directories = [
  'logs',
  'uploads',
  'temp'
];

console.log('📁 Creating directories...');
directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`   ✓ Created ${dir}/`);
  } else {
    console.log(`   ✓ ${dir}/ already exists`);
  }
});

// Check if .env file exists
console.log('\n🔧 Checking environment configuration...');
if (!fs.existsSync('.env')) {
  console.log('   ⚠️  .env file not found');
  console.log('   📋 Please copy .env.example to .env and configure your settings');
  console.log('   💡 Run: cp .env.example .env');
} else {
  console.log('   ✓ .env file found');
}

// Check Node.js version
console.log('\n🔍 Checking Node.js version...');
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

if (majorVersion >= 18) {
  console.log(`   ✓ Node.js ${nodeVersion} (compatible)`);
} else {
  console.log(`   ❌ Node.js ${nodeVersion} (requires 18+)`);
  console.log('   Please upgrade Node.js to version 18 or higher');
  process.exit(1);
}

// Check if package.json exists and install dependencies
console.log('\n📦 Installing dependencies...');
if (fs.existsSync('package.json')) {
  try {
    execSync('npm install', { stdio: 'inherit' });
    console.log('   ✓ Dependencies installed successfully');
  } catch (error) {
    console.log('   ❌ Failed to install dependencies');
    console.log('   Please run: npm install');
  }
} else {
  console.log('   ❌ package.json not found');
}

// Check database connection (if configured)
console.log('\n🗄️  Database setup...');
console.log('   📋 Make sure to:');
console.log('   1. Install PostgreSQL 14+');
console.log('   2. Create database: createdb ats_resume_db');
console.log('   3. Run schema: psql -d ats_resume_db -f database/schema.sql');
console.log('   4. Install Redis 7+');

// Check required environment variables
console.log('\n🔑 Required environment variables:');
const requiredEnvVars = [
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
  'JWT_SECRET'
];

const optionalEnvVars = [
  'REDIS_URL',
  'AWS_S3_BUCKET',
  'STRIPE_SECRET_KEY'
];

if (fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  
  requiredEnvVars.forEach(varName => {
    if (envContent.includes(`${varName}=`) && !envContent.includes(`${varName}=your_`)) {
      console.log(`   ✓ ${varName} configured`);
    } else {
      console.log(`   ❌ ${varName} not configured`);
    }
  });
  
  console.log('\n🔧 Optional environment variables:');
  optionalEnvVars.forEach(varName => {
    if (envContent.includes(`${varName}=`) && !envContent.includes(`${varName}=your_`)) {
      console.log(`   ✓ ${varName} configured`);
    } else {
      console.log(`   ⚠️  ${varName} not configured (optional)`);
    }
  });
}

// Create a simple test script
console.log('\n🧪 Creating test script...');
const testScript = `#!/usr/bin/env node

const axios = require('axios');

async function testAPI() {
  try {
    const response = await axios.get('http://localhost:3000/health');
    console.log('✓ API is running:', response.data);
  } catch (error) {
    console.log('❌ API test failed:', error.message);
  }
}

if (require.main === module) {
  testAPI();
}

module.exports = { testAPI };
`;

fs.writeFileSync('scripts/test-api.js', testScript);
console.log('   ✓ Created scripts/test-api.js');

// Final instructions
console.log('\n🎉 Setup complete!\n');
console.log('📋 Next steps:');
console.log('   1. Configure your .env file with API keys');
console.log('   2. Set up PostgreSQL and Redis');
console.log('   3. Run database schema: psql -d ats_resume_db -f database/schema.sql');
console.log('   4. Start the application: npm run dev');
console.log('   5. Test the API: node scripts/test-api.js');
console.log('\n📚 Documentation: Check README.md for detailed instructions');
console.log('🆘 Support: Open an issue on GitHub if you need help');

console.log('\n🚀 Ready to optimize resumes with AI!');