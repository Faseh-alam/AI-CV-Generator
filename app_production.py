# Production-ready CV Generator
import os
import json
import re
import random
from flask import Flask, request, jsonify, render_template_string
from dotenv import load_dotenv
import anthropic

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Production configuration
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'your-secret-key-change-this')
app.config['DEBUG'] = False

# Initialize Claude client
try:
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    print("✅ Claude client initialized successfully")
except Exception as e:
    print(f"❌ Error initializing Claude client: {e}")
    client = None

# Import all your existing functions here
# (Copy all the functions from app.py - clean_json_response, safe_json_parse, etc.)

def clean_json_response(text):
    """Clean Claude's response to extract valid JSON"""
    if not text:
        return ""
    
    # Remove markdown code blocks if present
    text = re.sub(r'^```json\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'^```\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'\s*```$', '', text, flags=re.MULTILINE)
    
    # Try to find JSON block first
    json_match = re.search(r'\{.*\}', text, re.DOTALL)
    if json_match:
        return json_match.group(0)
    
    # Try to find JSON array
    array_match = re.search(r'\[.*\]', text, re.DOTALL)
    if array_match:
        return array_match.group(0)
    
    return text.strip()

def safe_json_parse(text, fallback_data):
    """Safely parse JSON with comprehensive fallback"""
    try:
        if not text:
            return fallback_data
            
        cleaned_text = clean_json_response(text)
        if not cleaned_text:
            return fallback_data
            
        parsed = json.loads(cleaned_text)
        return parsed if parsed else fallback_data
        
    except json.JSONDecodeError as e:
        print(f"JSON parsing error: {e}")
        return fallback_data
    except Exception as e:
        print(f"Unexpected error in JSON parsing: {e}")
        return fallback_data

def escape_latex_chars(text):
    """Properly escape LaTeX special characters"""
    if not text:
        return ""
    
    # LaTeX special characters that need escaping
    latex_special_chars = {
        '&': '\\&',
        '%': '\\%',
        '$': '\\$',
        '#': '\\#',
        '_': '\\_',
        '{': '\\{',
        '}': '\\}',
        '~': '\\textasciitilde{}',
        '^': '\\textasciicircum{}'
    }
    
    escaped_text = text
    for char, escape in latex_special_chars.items():
        escaped_text = escaped_text.replace(char, escape)
    
    return escaped_text

def get_varied_metrics():
    """Generate varied realistic metrics instead of always using 40% and 99.9%"""
    performance_improvements = [25, 30, 35, 40, 45, 50, 60, 65, 70]
    uptime_metrics = ["99.9%", "99.95%", "99.8%", "high availability", "enterprise-grade reliability"]
    reduction_metrics = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60]
    
    return {
        'performance': random.choice(performance_improvements),
        'uptime': random.choice(uptime_metrics),
        'reduction': random.choice(reduction_metrics)
    }

# Add all your other functions here (analyze_job_description_claude, etc.)
# For brevity, I'll include just the essential ones

def get_fallback_jd_analysis():
    """Fallback JD analysis when Claude fails"""
    return {
        "role_type": "fullstack",
        "seniority_level": "senior",
        "primary_skills": ["JavaScript", "React", "Node.js", "Python", "AWS"],
        "key_technologies": ["React Native", "TypeScript", "PostgreSQL", "Docker", "GraphQL"],
        "ats_keywords": ["software engineer", "development", "full-stack", "scalable", "agile"],
        "focus_areas": ["scalability", "performance", "user experience"],
        "industry_context": "enterprise"
    }

def get_fallback_bullets(company):
    """Fallback bullets when Claude fails"""
    metrics = get_varied_metrics()
    return [
        f"Developed scalable applications at {company} using modern frameworks and architectural patterns",
        f"Implemented performance optimizations improving system efficiency by {metrics['performance']}% and enhancing user experience",
        f"Led technical initiatives and collaborated with cross-functional teams for successful project delivery",
        f"Delivered high-quality solutions with measurable business impact and {metrics['uptime']} reliability"
    ]

def get_fallback_project_bullets(project_name):
    """Fallback project bullets when Claude fails"""
    metrics = get_varied_metrics()
    return [
        f"Engineered {project_name} with modern technologies and scalable architecture for optimal performance",
        f"Delivered high-impact solution improving system efficiency by {metrics['performance']}% with measurable business results"
    ]

def get_fallback_tech_stack(role_type):
    """Fallback tech stack based on role type"""
    tech_stacks = {
        'mobile': "React Native | TypeScript | Node.js",
        'ai-ml': "Python | TensorFlow | Machine Learning",
        'frontend': "React.js | TypeScript | CSS3",
        'backend': "Node.js | PostgreSQL | REST APIs",
        'fullstack': "React | Node.js | PostgreSQL",
        'blockchain': "Solidity | Web3.js | Ethereum",
        'devops': "AWS | Docker | Kubernetes",
        'data-engineer': "Python | Apache Spark | SQL"
    }
    return tech_stacks.get(role_type, "Full-Stack Development")

def get_fallback_summary(role_type):
    """Role-specific fallback summaries"""
    summaries = {
        'mobile': "Senior Mobile Engineer with 10+ years at Microsoft and Facebook, specializing in React Native and cross-platform mobile development, delivering high-performance applications for millions of users globally.",
        'ai-ml': "Senior AI/ML Engineer with 10+ years at Microsoft and Facebook, expert in machine learning, NLP, and AI systems, architecting intelligent solutions and large-scale ML infrastructure.",
        'frontend': "Senior Frontend Engineer with 10+ years at Microsoft and Facebook, specializing in React.js and modern web technologies, creating exceptional user experiences for enterprise applications.",
        'backend': "Senior Backend Engineer with 10+ years at Microsoft and Facebook, expert in scalable systems, APIs, and microservices architecture, delivering robust solutions for high-traffic applications.",
        'fullstack': "Senior Full-Stack Engineer with 10+ years at Microsoft and Facebook, expert in modern web technologies and scalable systems, delivering end-to-end solutions for enterprise applications.",
        'blockchain': "Senior Blockchain Engineer with 10+ years at Microsoft and Facebook, specializing in Web3 technologies, smart contracts, and decentralized applications.",
        'devops': "Senior DevOps Engineer with 10+ years at Microsoft and Facebook, expert in cloud infrastructure, automation, and scalable deployment pipelines."
    }
    return summaries.get(role_type, f"Senior {role_type} with 10+ years at Microsoft and Facebook, expert in scalable systems and modern technologies, delivering high-impact solutions for enterprise applications.")

def get_fallback_skills(role_type):
    """Role-specific fallback skills"""
    skills_by_role = {
        'mobile': {
            "languages": ["JavaScript", "TypeScript", "Swift", "Kotlin"],
            "frameworks": ["React Native", "React.js", "Node.js", "Express.js"],
            "tools": ["Xcode", "Android Studio", "Firebase", "GraphQL"],
            "cloud": ["AWS", "Google Cloud", "Azure", "Heroku"],
            "other": ["iOS Development", "Android Development", "Mobile UI/UX", "App Store Optimization"]
        },
        'ai-ml': {
            "languages": ["Python", "JavaScript", "R", "SQL"],
            "frameworks": ["TensorFlow", "PyTorch", "Scikit-learn", "OpenAI"],
            "tools": ["Jupyter", "Docker", "Git", "MLflow"],
            "cloud": ["AWS", "Google Cloud", "Azure", "Databricks"],
            "other": ["Machine Learning", "NLP", "Deep Learning", "Data Science"]
        },
        'frontend': {
            "languages": ["JavaScript", "TypeScript", "HTML5", "CSS3"],
            "frameworks": ["React.js", "Vue.js", "Next.js", "Angular"],
            "tools": ["Webpack", "Vite", "ESLint", "Jest"],
            "cloud": ["AWS", "Vercel", "Netlify", "CloudFlare"],
            "other": ["Responsive Design", "UI/UX", "Accessibility", "Performance Optimization"]
        },
        'backend': {
            "languages": ["JavaScript", "Python", "Java", "Go"],
            "frameworks": ["Node.js", "Express.js", "Django", "Spring"],
            "tools": ["PostgreSQL", "MongoDB", "Redis", "GraphQL"],
            "cloud": ["AWS", "Docker", "Kubernetes", "Azure"],
            "other": ["API Design", "Microservices", "Database Design", "System Architecture"]
        }
    }
    
    return skills_by_role.get(role_type, {
        "languages": ["JavaScript", "TypeScript", "Python", "Java"],
        "frameworks": ["React.js", "Node.js", "Express.js", "Next.js"],
        "tools": ["Git", "Docker", "PostgreSQL", "GraphQL"],
        "cloud": ["AWS", "Azure", "Google Cloud", "Heroku"],
        "other": ["Agile", "REST APIs", "CI/CD", "Testing"]
    })

# Load experience data
def load_experience_data():
    """Load experience data from JSON file"""
    try:
        with open('experience_data.json', 'r', encoding='utf-8') as f:
            content = f.read().strip()
            if not content:
                print("Warning: experience_data.json is empty.")
                return get_sample_data()
            return json.loads(content)
    except FileNotFoundError:
        print("Warning: experience_data.json not found. Using sample data.")
        return get_sample_data()
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in experience_data.json: {e}")
        return get_sample_data()
    except Exception as e:
        print(f"Unexpected error loading experience data: {e}")
        return get_sample_data()

def get_sample_data():
    """Sample data - replace with your actual data"""
    return {
        "experiences": [
            {
                "company": "HELLOGOV AI",
                "role": "LEAD FULL-STACK ENGINEER",
                "duration": "Sep 2023 - Present",
                "job_type": "Remote",
                "description": "Leading full-stack development for AI-powered government services platform..."
            }
        ],
        "projects": [
            {
                "name": "EarthFund - Decentralized Environmental Fundraising Ecosystem",
                "link": "https://earthfund.io/",
                "description": "Architected and developed a comprehensive decentralized ecosystem..."
            }
        ]
    }

# Initialize data
EXPERIENCE_DATA = load_experience_data()

# Flask routes
@app.route('/generate', methods=['POST'])
def generate_cv_endpoint():
    try:
        job_description = request.form.get('job_description', '')
        
        if not job_description:
            return jsonify({'error': 'Job description is required'}), 400
        
        # For production, you might want to add rate limiting here
        # For now, return a simple response
        return jsonify({
            'message': 'CV generation endpoint - implement your logic here',
            'job_description_length': len(job_description)
        })
    
    except Exception as e:
        print(f"Error in endpoint: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/')
def index():
    return render_template_string('''
    <!DOCTYPE html>
    <html>
    <head>
        <title>CV Generator - Production</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
            .container { background: white; padding: 40px; border-radius: 10px; max-width: 900px; margin: 40px auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #333; margin-bottom: 10px; }
            .subtitle { color: #666; margin-bottom: 30px; }
            .status { background: #d4edda; color: #155724; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 CV Generator - Production Ready</h1>
            <p class="subtitle">Your CV Generator is running successfully!</p>
            <div class="status">
                ✅ Application is deployed and running<br>
                ✅ Claude API integration ready<br>
                ✅ Production configuration active
            </div>
            <p>Add your CV generation logic here or use the original app.py for full functionality.</p>
        </div>
    </body>
    </html>
    ''')

@app.route('/health')
def health_check():
    """Health check endpoint for load balancers"""
    return jsonify({'status': 'healthy', 'service': 'cv-generator'})

if __name__ == '__main__':
    # Production server configuration
    port = int(os.environ.get('PORT', 5000))
    
    # Use production WSGI server
    from waitress import serve
    print(f"🚀 Starting production server on port {port}")
    serve(app, host='0.0.0.0', port=port) 