#!/bin/bash

# Security Improvements Installation Script
# This script installs and configures the security and performance improvements

set -e

echo "🔒 Installing Security & Performance Improvements..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root for system packages
check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_warning "Running as root. This is not recommended for npm operations."
    fi
}

# Install system dependencies
install_system_deps() {
    print_status "Installing system dependencies..."
    
    # Detect OS
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command -v apt-get &> /dev/null; then
            # Debian/Ubuntu
            print_status "Detected Debian/Ubuntu system"
            sudo apt-get update
            sudo apt-get install -y clamav clamav-daemon redis-server
            
            # Start services
            sudo systemctl start clamav-daemon
            sudo systemctl enable clamav-daemon
            sudo systemctl start redis-server
            sudo systemctl enable redis-server
            
            # Update ClamAV virus definitions
            print_status "Updating ClamAV virus definitions..."
            sudo freshclam
            
        elif command -v yum &> /dev/null; then
            # RHEL/CentOS
            print_status "Detected RHEL/CentOS system"
            sudo yum install -y epel-release
            sudo yum install -y clamav clamav-update redis
            
            # Start services
            sudo systemctl start clamd
            sudo systemctl enable clamd
            sudo systemctl start redis
            sudo systemctl enable redis
            
            # Update ClamAV virus definitions
            sudo freshclam
        fi
        
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        print_status "Detected macOS system"
        if command -v brew &> /dev/null; then
            brew install clamav redis
            brew services start redis
            
            # Update ClamAV virus definitions
            freshclam
        else
            print_error "Homebrew not found. Please install Homebrew first."
            exit 1
        fi
    else
        print_warning "Unsupported OS. Please install ClamAV and Redis manually."
    fi
}

# Install Node.js dependencies
install_node_deps() {
    print_status "Installing Node.js dependencies..."
    
    # Check if package.json exists
    if [[ ! -f "package.json" ]]; then
        print_error "package.json not found. Please run this script from the project root."
        exit 1
    fi
    
    # Install new dependencies
    npm install opossum file-type clamscan cls-hooked lru-cache rate-limiter-flexible compromise winston-elasticsearch ioredis
    
    print_status "Node.js dependencies installed successfully"
}

# Create necessary directories
create_directories() {
    print_status "Creating necessary directories..."
    
    mkdir -p logs
    mkdir -p uploads
    mkdir -p tmp
    mkdir -p src/utils/workers
    
    print_status "Directories created successfully"
}

# Set up environment variables template
setup_env_template() {
    print_status "Setting up environment variables template..."
    
    if [[ ! -f ".env.example" ]]; then
        cat > .env.example << EOF
# Server Configuration
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://username:password@localhost:5432/resume_optimizer

# Redis & Queue
REDIS_URL=redis://localhost:6379

# AWS Configuration (Enhanced)
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name

# Secure Claude AI
ENCRYPTED_CLAUDE_API_KEY=base64_kms_encrypted_key
ANTHROPIC_API_KEY=your_fallback_plain_key
ANTHROPIC_BASE_URL=https://api.anthropic.com

# Security
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=24h

# File Processing Security
MAX_FILE_SIZE=10485760
CLAMAV_HOST=localhost
CLAMAV_PORT=3310

# Monitoring (Production)
ELASTICSEARCH_URL=https://your-elasticsearch-cluster
ELASTICSEARCH_USER=username
ELASTICSEARCH_PASS=password
LOG_LEVEL=info

# Performance
WORKER_THREADS=4
CACHE_TTL=3600
EOF
        print_status "Environment template created at .env.example"
    else
        print_status "Environment template already exists"
    fi
}

# Test services
test_services() {
    print_status "Testing installed services..."
    
    # Test Redis
    if redis-cli ping > /dev/null 2>&1; then
        print_status "✅ Redis is running"
    else
        print_error "❌ Redis is not running"
    fi
    
    # Test ClamAV
    if clamdscan --version > /dev/null 2>&1; then
        print_status "✅ ClamAV is installed"
    else
        print_error "❌ ClamAV is not properly installed"
    fi
    
    # Test Node.js dependencies
    if node -e "require('opossum')" > /dev/null 2>&1; then
        print_status "✅ Node.js dependencies are installed"
    else
        print_error "❌ Node.js dependencies are missing"
    fi
}

# Generate security keys
generate_keys() {
    print_status "Generating security keys..."
    
    if [[ -f "scripts/generate-keys.js" ]]; then
        node scripts/generate-keys.js
        print_status "Security keys generated"
    else
        print_warning "Key generation script not found. Skipping..."
    fi
}

# Main installation process
main() {
    print_status "Starting Security & Performance Improvements Installation"
    print_status "=================================================="
    
    check_root
    
    # Install system dependencies
    read -p "Install system dependencies (ClamAV, Redis)? [y/N]: " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        install_system_deps
    else
        print_warning "Skipping system dependencies. Make sure ClamAV and Redis are installed manually."
    fi
    
    # Install Node.js dependencies
    install_node_deps
    
    # Create directories
    create_directories
    
    # Setup environment template
    setup_env_template
    
    # Generate security keys
    generate_keys
    
    # Test services
    test_services
    
    print_status "=================================================="
    print_status "✅ Installation completed successfully!"
    print_status ""
    print_status "Next steps:"
    print_status "1. Copy .env.example to .env and configure your settings"
    print_status "2. Set up AWS KMS for API key encryption (production)"
    print_status "3. Configure Elasticsearch for logging (production)"
    print_status "4. Run 'npm test' to verify everything works"
    print_status "5. Start the application with 'npm start'"
    print_status ""
    print_status "For detailed configuration, see SECURITY_IMPROVEMENTS.md"
}

# Run main function
main "$@"