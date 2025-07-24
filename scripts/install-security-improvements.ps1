# Security Improvements Installation Script for Windows
# This script installs and configures the security and performance improvements

param(
    [switch]$SkipSystemDeps = $false
)

# Colors for output
$Green = "Green"
$Yellow = "Yellow"
$Red = "Red"

function Write-Status {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor $Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor $Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor $Red
}

function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Install-SystemDependencies {
    Write-Status "Installing system dependencies for Windows..."
    
    # Check if Chocolatey is installed
    if (!(Get-Command choco -ErrorAction SilentlyContinue)) {
        Write-Warning "Chocolatey not found. Installing Chocolatey..."
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    }
    
    # Install Redis
    Write-Status "Installing Redis..."
    try {
        choco install redis-64 -y
        Write-Status "Redis installed successfully"
    } catch {
        Write-Warning "Failed to install Redis via Chocolatey. Please install manually."
    }
    
    # Note about ClamAV on Windows
    Write-Warning "ClamAV installation on Windows requires manual setup."
    Write-Status "Please download ClamAV from: https://www.clamav.net/downloads"
    Write-Status "Or use Windows Defender API as an alternative."
}

function Install-NodeDependencies {
    Write-Status "Installing Node.js dependencies..."
    
    # Check if package.json exists
    if (!(Test-Path "package.json")) {
        Write-Error "package.json not found. Please run this script from the project root."
        exit 1
    }
    
    # Install new dependencies
    $dependencies = @(
        "opossum",
        "file-type",
        "clamscan",
        "cls-hooked",
        "lru-cache",
        "rate-limiter-flexible",
        "compromise",
        "winston-elasticsearch",
        "ioredis"
    )
    
    foreach ($dep in $dependencies) {
        Write-Status "Installing $dep..."
        npm install $dep
    }
    
    Write-Status "Node.js dependencies installed successfully"
}

function Create-Directories {
    Write-Status "Creating necessary directories..."
    
    $directories = @("logs", "uploads", "tmp", "src\utils\workers")
    
    foreach ($dir in $directories) {
        if (!(Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Write-Status "Created directory: $dir"
        }
    }
    
    Write-Status "Directories created successfully"
}

function Setup-EnvironmentTemplate {
    Write-Status "Setting up environment variables template..."
    
    if (!(Test-Path ".env.example")) {
        $envContent = @"
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
"@
        
        $envContent | Out-File -FilePath ".env.example" -Encoding UTF8
        Write-Status "Environment template created at .env.example"
    } else {
        Write-Status "Environment template already exists"
    }
}

function Test-Services {
    Write-Status "Testing installed services..."
    
    # Test Redis
    try {
        $redisTest = redis-cli ping 2>$null
        if ($redisTest -eq "PONG") {
            Write-Status "✅ Redis is running"
        } else {
            Write-Warning "❌ Redis is not responding"
        }
    } catch {
        Write-Warning "❌ Redis is not installed or not running"
    }
    
    # Test Node.js dependencies
    try {
        node -e "require('opossum')" 2>$null
        Write-Status "✅ Node.js dependencies are installed"
    } catch {
        Write-Error "❌ Node.js dependencies are missing"
    }
}

function Generate-SecurityKeys {
    Write-Status "Generating security keys..."
    
    if (Test-Path "scripts\generate-keys.js") {
        node scripts\generate-keys.js
        Write-Status "Security keys generated"
    } else {
        Write-Warning "Key generation script not found. Skipping..."
    }
}

function Main {
    Write-Status "Starting Security & Performance Improvements Installation"
    Write-Status "=================================================="
    
    # Check if running as administrator for system operations
    if (-not (Test-Administrator) -and -not $SkipSystemDeps) {
        Write-Warning "Not running as Administrator. Some system operations may fail."
        Write-Status "Consider running PowerShell as Administrator or use -SkipSystemDeps flag"
    }
    
    # Install system dependencies
    if (-not $SkipSystemDeps) {
        $response = Read-Host "Install system dependencies (Redis via Chocolatey)? [y/N]"
        if ($response -match "^[Yy]$") {
            Install-SystemDependencies
        } else {
            Write-Warning "Skipping system dependencies. Make sure Redis is installed manually."
        }
    }
    
    # Install Node.js dependencies
    Install-NodeDependencies
    
    # Create directories
    Create-Directories
    
    # Setup environment template
    Setup-EnvironmentTemplate
    
    # Generate security keys
    Generate-SecurityKeys
    
    # Test services
    Test-Services
    
    Write-Status "=================================================="
    Write-Status "✅ Installation completed successfully!"
    Write-Status ""
    Write-Status "Next steps:"
    Write-Status "1. Copy .env.example to .env and configure your settings"
    Write-Status "2. Install Redis manually if not done via Chocolatey"
    Write-Status "3. Set up AWS KMS for API key encryption (production)"
    Write-Status "4. Configure Elasticsearch for logging (production)"
    Write-Status "5. Run 'npm test' to verify everything works"
    Write-Status "6. Start the application with 'npm start'"
    Write-Status ""
    Write-Status "For detailed configuration, see SECURITY_IMPROVEMENTS.md"
    Write-Status ""
    Write-Status "Windows-specific notes:"
    Write-Status "- ClamAV requires manual installation on Windows"
    Write-Status "- Consider using Windows Defender API as alternative"
    Write-Status "- Redis can be installed via Chocolatey or manually"
}

# Run main function
Main