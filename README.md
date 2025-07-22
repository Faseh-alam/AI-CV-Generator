# ATS Resume Optimizer

An AI-powered web application that automatically optimizes resumes for specific job descriptions using Claude AI. The system analyzes job postings, extracts keywords, and intelligently tailors resume content while maintaining authenticity and ATS compatibility.

## 🚀 Features

- **AI-Powered Optimization**: Uses Claude AI to intelligently optimize resumes
- **ATS Compatibility**: Generates ATS-friendly PDFs with proper formatting
- **Job Analysis**: Extracts keywords and requirements from job descriptions
- **Match Score Calculation**: Analyzes resume-job compatibility with detailed breakdown
- **Application Tracking**: Track job applications and success metrics
- **Multiple File Formats**: Supports PDF, DOCX, DOC, and TXT resume uploads
- **Subscription Management**: Tiered pricing with Stripe integration
- **Analytics Dashboard**: Comprehensive usage and performance analytics

## 🛠 Technology Stack

### Backend
- **Node.js** with Express.js
- **PostgreSQL** for primary database
- **Redis** for caching and sessions
- **Claude AI API** for resume optimization
- **JWT** for authentication
- **Stripe** for payment processing
- **AWS S3** for file storage

### Key Libraries
- `pdf-parse` - PDF text extraction
- `mammoth` - DOCX file parsing
- `pdfkit` - PDF generation
- `bcryptjs` - Password hashing
- `joi` - Input validation
- `winston` - Logging

## 📋 Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- Redis 7+
- Claude AI API key (Anthropic)
- AWS S3 bucket (optional, falls back to local storage)
- Stripe account (for payments)

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd ats-resume-optimizer
npm install
```

### 2. Environment Setup

Copy the example environment file and configure:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ats_resume_db
REDIS_URL=redis://localhost:6379

# Claude AI
ANTHROPIC_API_KEY=your_claude_api_key_here

# JWT
JWT_SECRET=your_super_secret_jwt_key_here

# AWS S3 (optional)
AWS_S3_BUCKET=your-bucket-name
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# Stripe
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
```

### 3. Database Setup

Create the database and run the schema:

```bash
# Create database
createdb ats_resume_db

# Run schema
psql -d ats_resume_db -f database/schema.sql
```

### 4. Start the Application

```bash
# Development mode
npm run dev

# Production mode
npm start
```

The API will be available at `http://localhost:3000`

## 📚 API Documentation

### Authentication

All API endpoints (except auth) require a JWT token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

### Core Endpoints

#### Authentication
- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/login` - User login
- `GET /api/v1/auth/me` - Get current user

#### Resume Management
- `POST /api/v1/resumes` - Upload and parse resume
- `GET /api/v1/resumes` - List user resumes
- `GET /api/v1/resumes/:id` - Get resume details
- `PUT /api/v1/resumes/:id` - Update resume
- `POST /api/v1/resumes/:id/generate-pdf` - Generate ATS-compatible PDF

#### Job Analysis
- `POST /api/v1/jobs` - Analyze job description
- `GET /api/v1/jobs` - List job analyses
- `GET /api/v1/jobs/:id` - Get job analysis details
- `GET /api/v1/jobs/:id/keywords` - Get extracted keywords

#### Optimization
- `POST /api/v1/optimizations` - Create optimization
- `GET /api/v1/optimizations` - List optimizations
- `GET /api/v1/optimizations/:id` - Get optimization details
- `POST /api/v1/optimizations/match-score` - Calculate match score

#### Analytics
- `GET /api/v1/analytics/dashboard` - User dashboard data
- `GET /api/v1/analytics/usage` - Usage statistics
- `POST /api/v1/analytics/applications` - Track job applications

## 🔧 Configuration

### Subscription Tiers

The application supports three subscription tiers:

```javascript
const PRICING_TIERS = {
  free: {
    optimizations: 3,
    resumes: 2,
    features: ['basic_optimization']
  },
  basic: {
    price: 19,
    optimizations: 50,
    resumes: 5,
    features: ['basic_optimization', 'match_score', 'analytics']
  },
  premium: {
    price: 49,
    optimizations: 'unlimited',
    resumes: 20,
    features: ['all_features', 'priority_support', 'bulk_processing']
  }
};
```

### Rate Limiting

- General API: 100 requests per 15 minutes
- Authentication: 5 requests per 15 minutes
- File uploads: 10 uploads per hour
- AI optimization: 20 optimizations per hour

## 📊 Database Schema

The application uses PostgreSQL with the following main tables:

- `users` - User accounts and subscription info
- `resumes` - Resume files and parsed data
- `job_descriptions` - Job postings and extracted keywords
- `optimizations` - AI optimization results
- `applications` - Job application tracking
- `usage_tracking` - User activity analytics

## 🧪 Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage
```

## 🚀 Deployment

### Docker Deployment

```bash
# Build image
docker build -t ats-resume-optimizer .

# Run with docker-compose
docker-compose up -d
```

### Environment Variables for Production

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
ANTHROPIC_API_KEY=...
JWT_SECRET=...
```

## 📈 Monitoring

The application includes comprehensive logging and monitoring:

- **Winston** for structured logging
- **Health check** endpoint at `/health`
- **Usage tracking** for analytics
- **Error handling** with detailed error codes

## 🔒 Security Features

- Password hashing with bcrypt
- JWT token authentication
- Rate limiting
- Input validation with Joi
- SQL injection prevention
- CORS configuration
- Helmet security headers

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support and questions:

1. Check the documentation
2. Review the API examples
3. Check the logs for error details
4. Open an issue on GitHub

## 🔄 Version History

- **v1.0.0** - Initial release with core features
  - Resume parsing and optimization
  - Job analysis with Claude AI
  - Match score calculation
  - Basic analytics dashboard

---

**Note**: This application requires valid API keys for Claude AI and other external services. Make sure to configure all required environment variables before running.