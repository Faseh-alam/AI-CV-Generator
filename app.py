# Enhanced CV Generator with Claude API - Generic for All Job Types
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

# Initialize Claude client
try:
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    print("✅ Claude client initialized successfully")
except Exception as e:
    print(f"❌ Error initializing Claude client: {e}")
    client = None

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

# Enhanced JD Analysis Function
def analyze_job_description_claude(job_description):
    """Extract comprehensive requirements using Claude with better categorization"""
    
    if not client:
        print("❌ Claude client not available, using fallback")
        return get_fallback_jd_analysis()
    
    system_message = """You are an expert ATS analyst. Extract job requirements and respond with ONLY valid JSON. Analyze the role type carefully."""
    
    prompt = f"""
Analyze this job description and return ONLY a JSON object:

{job_description[:2500]}

Required JSON format:
{{
    "role_type": "frontend/backend/fullstack/mobile/ai-ml/data-engineer/devops/cloud/qa/product/blockchain",
    "seniority_level": "junior/mid/senior/lead/principal/staff/director",
    "primary_skills": ["skill1", "skill2", "skill3", "skill4", "skill5"],
    "key_technologies": ["tech1", "tech2", "tech3", "tech4", "tech5"],
    "ats_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
    "focus_areas": ["area1", "area2", "area3"],
    "industry_context": "healthcare/fintech/ecommerce/enterprise/startup/government/education/gaming/social"
}}

Guidelines:
- role_type: Be specific (mobile for React Native/iOS/Android, ai-ml for ML/AI roles, etc.)
- Extract 5 skills and technologies each for better matching
- Include industry-specific keywords if mentioned
- Consider remote/onsite preferences if specified

Return ONLY the JSON object.
"""
    
    try:
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=1200,
            temperature=0.2,
            system=system_message,
            messages=[{"role": "user", "content": prompt}]
        )
        
        response_text = response.content[0].text.strip()
        result = safe_json_parse(response_text, get_fallback_jd_analysis())
        
        # Validate result structure
        if not isinstance(result, dict) or 'role_type' not in result:
            return get_fallback_jd_analysis()
            
        return result
        
    except Exception as e:
        print(f"Error in JD analysis: {e}")
        return get_fallback_jd_analysis()

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

def select_relevant_experiences(all_experiences, jd_analysis, max_experiences=4):
    """Select most relevant experiences based on job analysis"""
    
    role_type = jd_analysis.get('role_type', '')
    key_technologies = [tech.lower() for tech in jd_analysis.get('key_technologies', [])]
    primary_skills = [skill.lower() for skill in jd_analysis.get('primary_skills', [])]
    
    # Score experiences based on relevance
    scored_experiences = []
    
    for exp in all_experiences:
        score = 0
        description_lower = exp.get('description', '').lower()
        
        # Score based on technologies mentioned
        for tech in key_technologies:
            if tech in description_lower:
                score += 2
        
        # Score based on skills mentioned
        for skill in primary_skills:
            if skill in description_lower:
                score += 1
        
        # Boost score for recent experiences
        if 'present' in exp.get('duration', '').lower():
            score += 3
        elif any(year in exp.get('duration', '') for year in ['2023', '2024', '2025']):
            score += 2
        elif any(year in exp.get('duration', '') for year in ['2020', '2021', '2022']):
            score += 1
        
        # Role type specific scoring
        if role_type == 'mobile' and any(keyword in description_lower for keyword in ['react native', 'ios', 'android', 'mobile']):
            score += 3
        elif role_type == 'ai-ml' and any(keyword in description_lower for keyword in ['ai', 'ml', 'machine learning', 'nlp', 'tensorflow']):
            score += 3
        elif role_type == 'backend' and any(keyword in description_lower for keyword in ['node.js', 'python', 'api', 'database', 'server']):
            score += 3
        elif role_type == 'frontend' and any(keyword in description_lower for keyword in ['react', 'vue', 'angular', 'frontend', 'ui']):
            score += 3
        
        scored_experiences.append((exp, score))
    
    # Sort by score and return top experiences
    scored_experiences.sort(key=lambda x: x[1], reverse=True)
    return [exp for exp, score in scored_experiences[:max_experiences]]

def select_relevant_projects(all_projects, jd_analysis, max_projects=5):
    """Select most relevant projects based on job analysis"""
    
    role_type = jd_analysis.get('role_type', '')
    key_technologies = [tech.lower() for tech in jd_analysis.get('key_technologies', [])]
    primary_skills = [skill.lower() for skill in jd_analysis.get('primary_skills', [])]
    industry_context = jd_analysis.get('industry_context', '')
    
    # Score projects based on relevance
    scored_projects = []
    
    for proj in all_projects:
        score = 0
        description_lower = proj.get('description', '').lower()
        name_lower = proj.get('name', '').lower()
        
        # Score based on technologies mentioned
        for tech in key_technologies:
            if tech in description_lower:
                score += 2
        
        # Score based on skills mentioned
        for skill in primary_skills:
            if skill in description_lower:
                score += 1
        
        # Industry context scoring
        if industry_context == 'healthcare' and any(keyword in description_lower for keyword in ['health', 'medical', 'hipaa', 'patient']):
            score += 3
        elif industry_context == 'fintech' and any(keyword in description_lower for keyword in ['payment', 'financial', 'stripe', 'blockchain']):
            score += 3
        elif industry_context == 'ecommerce' and any(keyword in description_lower for keyword in ['ecommerce', 'shopping', 'marketplace', 'retail']):
            score += 3
        
        # Role type specific scoring
        if role_type == 'mobile' and any(keyword in description_lower for keyword in ['react native', 'ios', 'android', 'mobile app']):
            score += 4
        elif role_type == 'ai-ml' and any(keyword in description_lower for keyword in ['ai', 'ml', 'machine learning', 'nlp', 'openai', 'llm']):
            score += 4
        elif role_type == 'blockchain' and any(keyword in description_lower for keyword in ['blockchain', 'web3', 'ethereum', 'smart contract']):
            score += 4
        elif role_type == 'backend' and any(keyword in description_lower for keyword in ['api', 'database', 'server', 'microservices']):
            score += 3
        elif role_type == 'frontend' and any(keyword in description_lower for keyword in ['react', 'vue', 'angular', 'frontend', 'ui/ux']):
            score += 3
        
        scored_projects.append((proj, score))
    
    # Sort by score and return top projects
    scored_projects.sort(key=lambda x: x[1], reverse=True)
    return [proj for proj, score in scored_projects[:max_projects]]

# Enhanced Experience Bullets Generation
def generate_experience_bullets_claude(job_description, jd_analysis, experience):
    """Generate bullet points for experience with varied metrics"""
    
    if not client:
        print("❌ Claude client not available, using fallback")
        return get_fallback_bullets(experience['company'])
    
    metrics = get_varied_metrics()
    
    system_message = """You are a professional CV writer. Create 3-4 compelling bullet points that align with the job requirements. Respond with ONLY a JSON array of strings."""
    
    prompt = f"""
Create 3-4 professional bullet points for this experience. Return ONLY a JSON array:

Company: {experience['company']}
Role: {experience['role']}
Description: {experience['description']}

Job Requirements:
- Role type: {jd_analysis.get('role_type', 'software engineer')}
- Seniority: {jd_analysis.get('seniority_level', 'senior')}
- Key skills: {', '.join(jd_analysis.get('primary_skills', [])[:4])}
- Technologies: {', '.join(jd_analysis.get('key_technologies', [])[:4])}
- Focus areas: {', '.join(jd_analysis.get('focus_areas', []))}
- Industry: {jd_analysis.get('industry_context', 'technology')}

Instructions:
1. Extract and emphasize technologies from description that match job requirements
2. Use strong action verbs (architected, engineered, implemented, optimized, led)
3. Include quantifiable achievements with varied metrics (not always 40% or 99.9%)
4. Incorporate ATS keywords naturally from the job requirements
5. Focus on impact and technical depth appropriate for the role type
6. Vary the metrics: use {metrics['performance']}%, {metrics['uptime']}, {metrics['reduction']}% where appropriate

Format: ["bullet 1", "bullet 2", "bullet 3", "bullet 4"]
Maximum 4 bullets, minimum 3.
"""
    
    try:
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=800,
            temperature=0.4,
            system=system_message,
            messages=[{"role": "user", "content": prompt}]
        )
        
        response_text = response.content[0].text.strip()
        result = safe_json_parse(response_text, get_fallback_bullets(experience['company']))
        
        # Ensure we have 3-4 bullets
        if isinstance(result, list) and len(result) >= 3:
            return result[:4]  # Take up to 4 bullets
        elif isinstance(result, list) and len(result) > 0:
            fallback = get_fallback_bullets(experience['company'])
            return result + fallback[len(result):3]  # Ensure at least 3 bullets
        else:
            return get_fallback_bullets(experience['company'])
        
    except Exception as e:
        print(f"Error in bullet generation: {e}")
        return get_fallback_bullets(experience['company'])

def get_fallback_bullets(company):
    """Fallback bullets when Claude fails"""
    metrics = get_varied_metrics()
    return [
        f"Developed scalable applications at {company} using modern frameworks and architectural patterns",
        f"Implemented performance optimizations improving system efficiency by {metrics['performance']}% and enhancing user experience",
        f"Led technical initiatives and collaborated with cross-functional teams for successful project delivery",
        f"Delivered high-quality solutions with measurable business impact and {metrics['uptime']} reliability"
    ]

# Enhanced Project Bullets Generation  
def generate_project_bullets_claude(job_description, jd_analysis, project):
    """Generate bullet points for project with better targeting"""
    
    if not client:
        print("❌ Claude client not available, using fallback")
        return get_fallback_project_bullets(project['name'])
    
    metrics = get_varied_metrics()
    
    system_message = """You are a CV expert. Create 2 impactful project bullet points. Respond with ONLY a JSON array."""
    
    prompt = f"""
Create 2 bullet points for this project. Return ONLY a JSON array:

Project: {project['name']}
Description: {project['description']}

Job Requirements:
- Role type: {jd_analysis.get('role_type', 'software engineer')}
- Technologies: {', '.join(jd_analysis.get('key_technologies', [])[:4])}
- Focus areas: {', '.join(jd_analysis.get('focus_areas', []))}
- Industry: {jd_analysis.get('industry_context', 'technology')}

Instructions:
1. Extract and emphasize tech stack from description that matches job requirements
2. Highlight technical achievements and business impact
3. Use metrics like {metrics['performance']}%, {metrics['uptime']}, or {metrics['reduction']}% where relevant
4. Make it ATS-friendly with job-relevant keywords
5. Focus on complexity and scale appropriate for the role

Format: ["bullet 1", "bullet 2"]
"""
    
    try:
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=500,
            temperature=0.4,
            system=system_message,
            messages=[{"role": "user", "content": prompt}]
        )
        
        response_text = response.content[0].text.strip()
        result = safe_json_parse(response_text, get_fallback_project_bullets(project['name']))
        
        if isinstance(result, list) and len(result) >= 2:
            return result[:2]
        else:
            return get_fallback_project_bullets(project['name'])
        
    except Exception as e:
        print(f"Error in project enhancement: {e}")
        return get_fallback_project_bullets(project['name'])

def get_fallback_project_bullets(project_name):
    """Fallback project bullets when Claude fails"""
    metrics = get_varied_metrics()
    return [
        f"Engineered {project_name} with modern technologies and scalable architecture for optimal performance",
        f"Delivered high-impact solution improving system efficiency by {metrics['performance']}% with measurable business results"
    ]

# Enhanced Tech Stack Extraction
def extract_tech_stack_claude(description, project_name, jd_analysis):
    """Extract tech stack from project description with job alignment"""
    
    if not client:
        return get_fallback_tech_stack(jd_analysis.get('role_type', 'fullstack'))
    
    system_message = """Extract the main technologies from the description. Return ONLY a pipe-separated list of 3-4 technologies that are most relevant."""
    
    prompt = f"""
From this description, extract 3-4 main technologies prioritizing those relevant to {jd_analysis.get('role_type', 'software development')}:

{description[:400]}

Job Role: {jd_analysis.get('role_type', 'software engineer')}
Preferred Technologies: {', '.join(jd_analysis.get('key_technologies', [])[:5])}

Return format: Tech1 | Tech2 | Tech3 | Tech4
Example: React Native | Node.js | PostgreSQL | AWS
"""
    
    try:
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=120,
            temperature=0.2,
            system=system_message,
            messages=[{"role": "user", "content": prompt}]
        )
        
        tech_stack = response.content[0].text.strip()
        
        # Basic validation
        if '|' in tech_stack and len(tech_stack) < 120:
            return tech_stack
        else:
            return get_fallback_tech_stack(jd_analysis.get('role_type', 'fullstack'))
        
    except Exception as e:
        print(f"Error extracting tech stack: {e}")
        return get_fallback_tech_stack(jd_analysis.get('role_type', 'fullstack'))

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

# Enhanced Professional Summary
def generate_professional_summary_claude(job_description, jd_analysis):
    """Generate role-specific summary"""
    
    if not client:
        print("❌ Claude client not available, using fallback")
        return get_fallback_summary(jd_analysis.get('role_type', 'Software Engineer'))
    
    system_message = """You are a CV writer. Create a compelling 2-3 line professional summary. Respond with ONLY the summary text (no JSON)."""
    
    role_type = jd_analysis.get('role_type', 'Software Engineer')
    key_skills = jd_analysis.get('primary_skills', [])[:4]
    seniority = jd_analysis.get('seniority_level', 'Senior')
    industry = jd_analysis.get('industry_context', 'technology')
    
    prompt = f"""
Create a professional summary for:
Role: {seniority} {role_type}
Key skills: {', '.join(key_skills)}
Industry: {industry}
Background: 10+ years at Microsoft and Facebook
Current: Leading AI/full-stack development projects

Make it specific to {role_type} role and {industry} industry.
Return ONLY the summary text (no quotes, no JSON).
"""
    
    try:
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=180,
            temperature=0.3,
            system=system_message,
            messages=[{"role": "user", "content": prompt}]
        )
        
        summary = response.content[0].text.strip()
        
        # Remove quotes if present
        summary = summary.strip('"').strip("'")
        
        if summary and len(summary) > 30:
            return summary
        else:
            return get_fallback_summary(role_type)
        
    except Exception as e:
        print(f"Error in summary generation: {e}")
        return get_fallback_summary(role_type)

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

# Enhanced Skills Section
def generate_skills_section_claude(job_description, jd_analysis, all_experiences, all_projects):
    """Generate role-specific skills section"""
    
    if not client:
        return get_fallback_skills(jd_analysis.get('role_type', 'fullstack'))
    
    system_message = """Extract and categorize skills based on job requirements. Return ONLY a JSON object with skill categories."""
    
    # Combine all descriptions
    all_descriptions = []
    for exp in all_experiences:
        all_descriptions.append(exp.get('description', ''))
    for proj in all_projects:
        all_descriptions.append(proj.get('description', ''))
    
    combined_text = ' '.join(all_descriptions)[:2000]
    
    prompt = f"""
Based on the job requirements and experience, create a skills section. Return ONLY JSON:

Job Requirements:
- Role type: {jd_analysis.get('role_type', 'software engineer')}
- Primary skills: {', '.join(jd_analysis.get('primary_skills', []))}
- Technologies: {', '.join(jd_analysis.get('key_technologies', []))}
- Industry: {jd_analysis.get('industry_context', 'technology')}

Experience descriptions:
{combined_text}

Return format appropriate for {jd_analysis.get('role_type', 'software engineer')} role:
{{
    "languages": ["lang1", "lang2", "lang3", "lang4"],
    "frameworks": ["framework1", "framework2", "framework3", "framework4"],
    "tools": ["tool1", "tool2", "tool3", "tool4"],
    "cloud": ["cloud1", "cloud2", "cloud3"],
    "other": ["skill1", "skill2", "skill3", "skill4"]
}}

PRIORITIZE skills mentioned in job requirements. Adapt categories to role type.
"""
    
    try:
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=600,
            temperature=0.3,
            system=system_message,
            messages=[{"role": "user", "content": prompt}]
        )
        
        response_text = response.content[0].text.strip()
        result = safe_json_parse(response_text, get_fallback_skills(jd_analysis.get('role_type', 'fullstack')))
        
        if isinstance(result, dict):
            return result
        else:
            return get_fallback_skills(jd_analysis.get('role_type', 'fullstack'))
        
    except Exception as e:
        print(f"Error in skills generation: {e}")
        return get_fallback_skills(jd_analysis.get('role_type', 'fullstack'))

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

# Build LaTeX CV (same as before but with dynamic skills labels)
def build_cv_latex(summary, experiences, projects, skills, jd_analysis):
    """Build complete LaTeX CV with role-appropriate formatting"""
    
    try:
        # Escape the summary
        escaped_summary = escape_latex_chars(summary)
        
        latex_template = r"""\documentclass[letterpaper,11pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\usepackage{fontawesome5}
\usepackage{multicol}
\setlength{\multicolsep}{-3.0pt}
\setlength{\columnsep}{-1pt}
\input{glyphtounicode}
\usepackage[margin=1.4cm]{geometry}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.15in}
\addtolength{\textwidth}{0.3in}

\urlstyle{same}

\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{
  \vspace{-4pt}\scshape\raggedright\large\bfseries
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

\pdfgentounicode=1

\newcommand{\resumeItem}[1]{
  \item\small{
    {#1 \vspace{0pt}}
  }
}

\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
      \textbf{#1} & \textbf{\small #2} \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{1.001\textwidth}{l@{\extracolsep{\fill}}r}
      \small#1 & \textbf{\small #2}\\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-4pt}}

\renewcommand\labelitemi{$\vcenter{\hbox{\tiny$\bullet$}}$}
\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.0in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}\vspace{0pt}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}

\begin{document}

\begin{center}
    {\Large \scshape Hakeem Abbas} \\[2mm]
    \footnotesize \raisebox{-0.1\height}
    \faPhone\ {+1 (650) 526-8926} ~ 
    {\faEnvelope\  {sydhakeemabbas@gmail.com}} ~ 
    {\faLinkedin\ \underline{\href{https://www.linkedin.com/in/hakeemsyd/}{linkedin.com/in/hakeemsyd}}  ~
    {\faGithub\ \underline{\href{https://github.com/hakeemsyd}{github.com/hakeemsyd}} ~
    {\faMapMarker\ {San Ramon, CA}}
    \vspace{-8pt}
\end{center}

\section{Professional Summary}
\small{
    """ + escaped_summary + r"""
}
\vspace{-8pt}

\section{Work Experience}
    \resumeSubHeadingListStart"""
        
        # Add experiences
        for exp in experiences:
            exp_company = escape_latex_chars(exp.get('company', ''))
            exp_role = escape_latex_chars(exp.get('role', ''))
            exp_duration = escape_latex_chars(exp.get('duration', ''))
            exp_type = escape_latex_chars(exp.get('job_type', 'Remote'))
            
            latex_template += f"""
        \\resumeSubheading
        {{{exp_company}}}{{{exp_duration}}}
        {{{exp_role}}}{{{exp_type}}}
        \\resumeItemListStart
"""
            
            for bullet in exp.get('bullets', []):
                escaped_bullet = escape_latex_chars(bullet)
                latex_template += f"            \\resumeItem{{{escaped_bullet}}}\n"
            
            latex_template += "        \\resumeItemListEnd\n"
        
        latex_template += r"""    \resumeSubHeadingListEnd

\section{Projects} 
    \vspace{-5pt}
    \resumeSubHeadingListStart"""
        
        # Add projects
        for proj in projects:
            proj_name = escape_latex_chars(proj.get('name', ''))
            tech_stack = escape_latex_chars(proj.get('tech_stack', 'Full-Stack Development'))
            
            latex_template += f"""
        \\resumeProjectHeading
        {{\\textbf{{{proj_name}}} $|$ \\emph{{{tech_stack}}}}}{{}}
        \\resumeItemListStart
"""
            
            for bullet in proj.get('bullets', []):
                escaped_bullet = escape_latex_chars(bullet)
                latex_template += f"            \\resumeItem{{{escaped_bullet}}}\n"
            
            latex_template += "        \\resumeItemListEnd\n"
        
        latex_template += r"""    \resumeSubHeadingListEnd

\section{Technical Skills}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
"""
        
        # Add skills with role-appropriate labels
        if isinstance(skills, dict):
            # Define skill labels based on role type
            role_type = jd_analysis.get('role_type', 'fullstack')
            
            if role_type == 'mobile':
                skill_labels = {
                    'languages': 'Languages',
                    'frameworks': 'Mobile Frameworks',
                    'tools': 'Development Tools',
                    'cloud': 'Cloud & Backend',
                    'other': 'Mobile Technologies'
                }
            elif role_type == 'ai-ml':
                skill_labels = {
                    'languages': 'Programming Languages',
                    'frameworks': 'ML/AI Frameworks',
                    'tools': 'Data Science Tools',
                    'cloud': 'Cloud Platforms',
                    'other': 'Specializations'
                }
            elif role_type == 'frontend':
                skill_labels = {
                    'languages': 'Languages',
                    'frameworks': 'Frontend Frameworks',
                    'tools': 'Development Tools',
                    'cloud': 'Deployment & Cloud',
                    'other': 'UI/UX & Design'
                }
            elif role_type == 'backend':
                skill_labels = {
                    'languages': 'Programming Languages',
                    'frameworks': 'Backend Frameworks',
                    'tools': 'Databases & Tools',
                    'cloud': 'Cloud & Infrastructure',
                    'other': 'Architecture & APIs'
                }
            else:
                skill_labels = {
                    'languages': 'Languages',
                    'frameworks': 'Frameworks',
                    'tools': 'Tools & Databases',
                    'cloud': 'Cloud & DevOps',
                    'other': 'Technologies'
                }
            
            for category, skill_list in skills.items():
                if skill_list and category in skill_labels:
                    category_name = skill_labels[category]
                    skills_text = ", ".join(skill_list[:6])
                    escaped_skills = escape_latex_chars(skills_text)
                    latex_template += f"        \\textbf{{{category_name}:}} {escaped_skills} \\\\\n"
        
        latex_template += r"""    }}
 \end{itemize}

\end{document}"""
        
        return latex_template
        
    except Exception as e:
        print(f"Error in building CV: {e}")
        raise

# Enhanced Main CV Generation Function
def generate_cv(job_description, experience_data):
    """Main CV generation function with intelligent filtering"""
    
    try:
        print("Step 1: Analyzing job description...")
        jd_analysis = analyze_job_description_claude(job_description)
        print(f"Role type: {jd_analysis.get('role_type')}")
        print(f"Industry: {jd_analysis.get('industry_context')}")
        
        print("Step 2: Selecting relevant experiences...")
        relevant_experiences = select_relevant_experiences(
            experience_data.get("experiences", []), 
            jd_analysis, 
            max_experiences=4
        )
        print(f"Selected {len(relevant_experiences)} most relevant experiences")
        
        print("Step 3: Selecting relevant projects...")
        relevant_projects = select_relevant_projects(
            experience_data.get("projects", []), 
            jd_analysis, 
            max_projects=5
        )
        print(f"Selected {len(relevant_projects)} most relevant projects")
        
        print("Step 4: Generating professional summary...")
        summary = generate_professional_summary_claude(job_description, jd_analysis)
        
        print("Step 5: Processing experiences...")
        tailored_experiences = []
        for exp in relevant_experiences:
            print(f"  Processing {exp['company']}...")
            bullets = generate_experience_bullets_claude(job_description, jd_analysis, exp)
            tailored_experiences.append({
                "company": exp["company"],
                "role": exp["role"],
                "duration": exp["duration"],
                "job_type": exp.get("job_type", "Remote"),
                "bullets": bullets
            })
        
        print("Step 6: Processing projects...")
        tailored_projects = []
        for proj in relevant_projects:
            print(f"  Processing {proj['name']}...")
            bullets = generate_project_bullets_claude(job_description, jd_analysis, proj)
            tech_stack = extract_tech_stack_claude(proj['description'], proj['name'], jd_analysis)
            tailored_projects.append({
                "name": proj["name"],
                "tech_stack": tech_stack,
                "bullets": bullets
            })
        
        print("Step 7: Generating skills section...")
        skills = generate_skills_section_claude(
            job_description, 
            jd_analysis, 
            experience_data.get("experiences", []),
            experience_data.get("projects", [])
        )
        
        print("Step 8: Building LaTeX CV...")
        latex_cv = build_cv_latex(summary, tailored_experiences, tailored_projects, skills, jd_analysis)
        
        print("✅ CV generation completed successfully")
        
        return {
            'latex': latex_cv,
            'summary': summary,
            'experiences': tailored_experiences,
            'projects': tailored_projects,
            'jd_analysis': jd_analysis,
            'skills': skills,
            'message': 'CV generated successfully',
            'selection_info': {
                'total_experiences': len(experience_data.get("experiences", [])),
                'selected_experiences': len(relevant_experiences),
                'total_projects': len(experience_data.get("projects", [])),
                'selected_projects': len(relevant_projects)
            }
        }
        
    except Exception as e:
        print(f"❌ Error in CV generation: {e}")
        raise

# Flask routes (same as before)
@app.route('/generate', methods=['POST'])
def generate_cv_endpoint():
    try:
        job_description = request.form.get('job_description', '')
        
        if not job_description:
            return jsonify({'error': 'Job description is required'}), 400
        
        # Generate CV
        result = generate_cv(job_description, EXPERIENCE_DATA)
        
        return jsonify(result)
    
    except Exception as e:
        print(f"Error in endpoint: {str(e)}")
        return jsonify({'error': str(e)}), 500

# Enhanced HTML Template
HTML_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head>
    <title>Enhanced Claude CV Generator</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
        .container { background: white; padding: 40px; border-radius: 10px; max-width: 900px; margin: 40px auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; margin-bottom: 10px; }
        .subtitle { color: #666; margin-bottom: 30px; }
        .features { background: #e8f5e8; padding: 15px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #28a745; }
        .instructions { background: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 30px; font-size: 14px; line-height: 1.6; }
        textarea { width: 100%; height: 300px; margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px; font-family: monospace; resize: vertical; box-sizing: border-box; }
        #output { width: 100%; height: 600px; font-family: 'Courier New', monospace; font-size: 12px; background: #f8f8f8; border: 1px solid #ddd; border-radius: 5px; padding: 15px; white-space: pre-wrap; overflow-x: auto; resize: vertical; box-sizing: border-box; }
        button { background: #007bff; color: white; padding: 12px 30px; border: none; cursor: pointer; border-radius: 5px; font-size: 16px; font-weight: 500; margin-right: 10px; transition: background 0.3s; }
        button:hover { background: #0056b3; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        .loading { display: none; color: #007bff; margin-left: 15px; }
        #result { margin-top: 30px; display: none; }
        .error { background: #fee; color: #c33; padding: 15px; border-radius: 5px; margin-bottom: 15px; }
        .success { color: #28a745; background: #d4edda; padding: 15px; border-radius: 5px; margin-bottom: 15px; }
        .copy-button { background: #28a745; }
        .copy-button:hover { background: #218838; }
        .analysis-preview { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 10px 0; font-size: 12px; white-space: pre-wrap; }
        .json-format { background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; font-family: monospace; font-size: 13px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Enhanced Claude CV Generator</h1>
        <p class="subtitle">Intelligent CV Generation for All Job Types</p>
        
        <div class="features">
            <strong>✨ Enhanced Features:</strong><br>
            • <strong>Intelligent Job Analysis:</strong> Detects role type (Mobile, AI/ML, Frontend, Backend, etc.)<br>
            • <strong>Smart Experience Selection:</strong> Automatically picks most relevant experiences<br>
            • <strong>Dynamic Project Filtering:</strong> Selects best projects based on job requirements<br>
            • <strong>Varied Metrics:</strong> Uses realistic, varied performance numbers (not always 40%)<br>
            • <strong>Role-Specific Skills:</strong> Adapts technical skills section to job type<br>
            • <strong>Industry Context:</strong> Tailors content for healthcare, fintech, enterprise, etc.
        </div>
        
        <div class="instructions">
            <strong>📝 How It Works:</strong><br>
            • Paste any job description (Mobile Dev, AI Engineer, Backend, etc.)<br>
            • Claude analyzes role type, seniority, and required skills<br>
            • Automatically selects your most relevant experiences and projects<br>
            • Generates targeted bullet points with appropriate metrics<br>
            • Creates role-specific professional summary and skills section<br><br>
            
            <strong>🎯 Supported Role Types:</strong><br>
            Mobile, AI/ML, Frontend, Backend, Full-Stack, DevOps, Data Engineer, Blockchain, Product, QA
        </div>
        
        <form id="cvForm">
            <label for="job_description">Paste Job Description:</label>
            <textarea id="job_description" name="job_description" placeholder="Paste the complete job description here..." required></textarea>
            <button type="submit">Generate Intelligent CV</button>
            <span class="loading">🧠 Claude is analyzing job requirements and crafting your perfect CV...</span>
        </form>
        
        <div id="result">
            <div id="message"></div>
            <div id="analysis-preview" class="analysis-preview" style="display:none;"></div>
            <button class="copy-button" onclick="copyToClipboard()" style="display:none;">Copy LaTeX Code</button>
            <textarea id="output" readonly placeholder="Your intelligent, tailored LaTeX code will appear here..."></textarea>
        </div>
    </div>
    
    <script>
        function copyToClipboard() {
            const output = document.getElementById('output');
            output.select();
            output.setSelectionRange(0, 99999);
            document.execCommand('copy');
            alert('LaTeX code copied to clipboard!');
        }
        
        document.getElementById('cvForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const button = e.target.querySelector('button[type="submit"]');
            const loading = document.querySelector('.loading');
            const result = document.getElementById('result');
            const message = document.getElementById('message');
            const output = document.getElementById('output');
            const copyButton = document.querySelector('.copy-button');
            const analysisPreview = document.getElementById('analysis-preview');
            
            // Reset UI
            button.disabled = true;
            loading.style.display = 'inline';
            result.style.display = 'none';
            output.value = '';
            analysisPreview.style.display = 'none';
            
            try {
                const formData = new FormData(e.target);
                const response = await fetch('/generate', { 
                    method: 'POST', 
                    body: formData 
                });
                
                const data = await response.json();
                
                if (response.ok && data.latex) {
                    message.innerHTML = '<div class="success">✅ Intelligent CV Generated! Claude analyzed the job and created a perfectly tailored CV.</div>';
                    output.value = data.latex;
                    copyButton.style.display = 'inline-block';
                    
                    // Show enhanced analysis preview
                    if (data.jd_analysis && data.selection_info) {
                        const preview = `🎯 Job Analysis:
• Role Type: ${data.jd_analysis.role_type || 'N/A'}
• Seniority Level: ${data.jd_analysis.seniority_level || 'N/A'}
• Industry Context: ${data.jd_analysis.industry_context || 'N/A'}
• Primary Skills: ${(data.jd_analysis.primary_skills || []).join(', ')}
• Key Technologies: ${(data.jd_analysis.key_technologies || []).join(', ')}

🔍 Smart Selection:
• Experiences: Selected ${data.selection_info.selected_experiences}/${data.selection_info.total_experiences} most relevant
• Projects: Selected ${data.selection_info.selected_projects}/${data.selection_info.total_projects} most relevant

📄 Generated Content:
• ✅ Role-specific Professional Summary
• ✅ ${data.experiences?.length || 0} Tailored Experience Sections
• ✅ ${data.projects?.length || 0} Targeted Project Descriptions
• ✅ Adaptive Technical Skills Section
• ✅ Varied Performance Metrics (no repetitive numbers)`;
                        
                        analysisPreview.textContent = preview;
                        analysisPreview.style.display = 'block';
                    }
                } else {
                    message.innerHTML = `<div class="error">❌ Error: ${data.error || 'Unknown error occurred'}</div>`;
                    copyButton.style.display = 'none';
                }
                
                result.style.display = 'block';
                
            } catch (error) {
                message.innerHTML = `<div class="error">❌ Network Error: ${error.message}</div>`;
                result.style.display = 'block';
                copyButton.style.display = 'none';
            } finally {
                button.disabled = false;
                loading.style.display = 'none';
            }
        });
    </script>
</body>
</html>
'''

@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)

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
    """Enhanced sample data with all your projects and experiences"""
    return {
        "experiences": [
            {
                "company": "HELLOGOV AI",
                "role": "LEAD FULL-STACK ENGINEER",
                "duration": "Sep 2023 - Present",
                "job_type": "Remote",
                "description": "Leading full-stack development for AI-powered government services platform, architecting and developing multiple high-impact applications driving significant business growth. Built comprehensive marketing website generating hundreds of thousands of dollars in daily revenue through strategic SEO optimization and Google Ads integration, creating conversion-optimized landing pages and user funnels. Developed server-side rendered Next.js website with advanced performance optimization, achieving superior Core Web Vitals scores and search engine rankings that drive organic traffic and customer acquisition. Architected and built end-to-end customer portal for US passport application services, enabling streamlined new passport applications and renewal processes with AI-powered assistance features. Developed intelligent document validation system using machine learning algorithms to verify passport application documents before submission, reducing processing errors and improving approval rates. Created AI-powered conversational interface and chatbot using natural language processing to guide customers through complex passport application requirements, providing real-time assistance and ensuring accurate information submission. Technologies used: Next.js, React.js, TypeScript, Node.js, PostgreSQL, AI/ML integration, natural language processing, document validation algorithms, styled-components, Google Tag Manager, Google Ads API, SEO optimization, server-side rendering, responsive design, government API integration, PDF generation, data scraping, security compliance, and modern DevOps practices."
            },
            {
                "company": "CODING CRAFTS",
                "role": "CHIEF EXECUTIVE OFFICER & LEAD ENGINEER",
                "duration": "Mar 2020 - Sep 2023",
                "job_type": "Remote",
                "description": "Led comprehensive technology company delivering cutting-edge software solutions for startups and enterprises, driving early-stage growth through strategic technical leadership and hands-on development across multiple technology stacks and industry verticals. Spearheaded end-to-end development of web and mobile applications using React.js, React Native, Node.js, TypeScript, and MongoDB, delivering tailored solutions for diverse clients across healthcare, fitness, blockchain, and e-commerce industries. Architected and developed advanced AI and Machine Learning solutions focusing on Natural Language Processing (NLP), Deep Learning, and Large Language Model (LLM) integration, creating intelligent systems including conversational AI platforms, AI-powered search engines, and automated response optimization frameworks. Built sophisticated mobile applications for iOS and Android using React Native, implementing critical features including push notifications, offline capabilities, real-time data synchronization, location-based services, and secure payment processing through Firebase, Google Maps API, and Stripe integrations. Developed complex Web3 and blockchain solutions utilizing Ethereum, smart contracts, decentralized applications (dApps), and cryptocurrency integration, creating platforms for environmental crowdfunding, NFT marketplaces, and blockchain-based data analytics systems. Technologies used: React.js, React Native, Node.js, TypeScript, Python, MongoDB, PostgreSQL, AWS cloud services, AI/ML frameworks, blockchain technologies, WebRTC, 3D graphics, payment processing, healthcare compliance, real-time systems, microservices architecture, and modern DevOps practices."
            },
            {
                "company": "FACEBOOK",
                "role": "SOFTWARE ENGINEER",
                "duration": "Aug 2017 - Mar 2020",
                "job_type": "Onsite",
                "description": "Developed high-impact applications and infrastructure solutions at Facebook, serving 2.8+ billion users globally through innovative VR technology, News Feed optimization, and scalable backend systems. Built comprehensive Oculus VR ecosystem including React Native companion app for iOS and Android with advanced features such as live streaming, screen mirroring from Oculus Quest/Go to Facebook platform, mixed reality capture capabilities, and abuse reporting systems for VR social experiences. Implemented sophisticated WebRTC-based streaming infrastructure enabling seamless real-time video transmission from Oculus headsets to React Native mobile applications and Chromecast/TV devices, creating cross-platform VR content sharing experiences. Developed critical Facebook News Feed backend services using advanced data processing algorithms, building scalable content delivery systems that optimize feed ranking, personalization, and real-time content distribution for billions of daily active users. Architected and implemented GraphQL live queries and subscription systems migrating legacy data fetching infrastructure to real-time updates, improving content loading performance by 35% and enabling instant feed updates without page refreshes. Built comprehensive C++ client applications for Facebook data centers performing end-to-end testing and optimization of News Feed services, ensuring system reliability, performance benchmarking, and quality assurance for mission-critical infrastructure serving global user base. Technologies used: React.js, React Native, Node.js, GraphQL, Redux, C++, WebRTC, Android development, iOS development, TypeScript, real-time systems, data center infrastructure, A/B testing platforms, RESTful APIs, performance optimization, cross-platform development, VR/AR technologies, and large-scale distributed systems."
            },
            {
                "company": "MICROSOFT",
                "role": "SOFTWARE ENGINEER II",
                "duration": "Oct 2012 - Jun 2017",
                "job_type": "Onsite",
                "description": "Developed enterprise-scale communication applications at Microsoft serving 300+ million Skype users globally, building cross-platform solutions across multiple product teams including Skype Consumer, Remote Desktop, and Microsoft Mediaroom. Led comprehensive Android application development for Remote Desktop Client using Android SDK, implementing custom UI widgets, designing MVP architecture patterns, and creating Material Design-compliant interfaces optimized for enterprise remote access scenarios. Architected and implemented sophisticated JNI C++/Java integration layers using Android NDK, enabling seamless cross-platform communication between native C++ libraries and Java applications, reducing Remote Desktop connection failures by 10% through optimized host machine discovery protocols. Built advanced SQLite database implementations with intelligent caching strategies for offline data storage, message synchronization, and user presence management ensuring reliable Skype functionality even during network interruptions. Developed comprehensive telemetry and analytics systems for A/B testing, quality improvement, and crash collection across Android applications, implementing automated bug reporting workflows and user feedback mechanisms that improved application stability and user satisfaction metrics. Technologies used: Android SDK, Java, C++, JNI/NDK integration, SQLite, RxJava, MVP architecture, Material Design, React.js, TypeScript, Node.js, Azure cloud services, Remote Desktop Protocol (RDP), telemetry systems, automated testing, CI/CD pipelines, cross-platform development, and enterprise application architecture."
            }
        ],
        "projects": [
            {
                "name": "EarthFund - Decentralized Environmental Fundraising Ecosystem",
                "link": "https://earthfund.io/",
                "description": "Architected and developed a comprehensive decentralized ecosystem for environmental fundraising, comprising three interconnected platforms: EarthFund crowdfunding platform, 1Earth cryptocurrency marketplace, and EarthFund Foundation DAO governance system. Built groundbreaking blockchain-based fundraising platform enabling global community participation in planet-saving and world-changing environmental projects through cutting-edge Web3 technology and decentralized governance mechanisms. Developed full-stack decentralized application (dApp) using Next.js frontend with seamless Web3 wallet integration supporting MetaMask, WalletConnect, and other major crypto wallets for frictionless user onboarding and transaction management. Implemented sophisticated smart contract integration using Web3.js and useDApp hooks for real-time blockchain interactions, enabling secure decentralized transactions, automated fund distribution, and transparent project funding mechanisms. Technologies used: Next.js, React.js, Web3.js, useDApp, TypeScript, Node.js, TypeORM, PostgreSQL, AWS Lambda, DynamoDB, AWS Serverless, smart contracts, blockchain integration, cryptocurrency trading, DAO governance, DeFi protocols, MetaMask integration, real-time staking, tokenomics, environmental impact tracking, and decentralized application architecture."
            },
            {
                "name": "YogaJoint - Multi-Location Fitness Studio Platform & SHIFT Mobile App",
                "link": "https://www.yogajoint.com/",
                "description": "Architected and developed a comprehensive multi-location fitness platform for YogaJoint, a distinguished Florida-based yoga studio chain operating across nine locations, delivering transformative digital solutions through strategic technology integration. Built full-stack fitness ecosystem including SEO-optimized marketing website, advanced class booking system, and innovative SHIFT mobile application with cutting-edge social discovery features. Developed scalable multi-tenant architecture supporting centralized database management for all studio locations while enabling location-specific class scheduling, instructor management, and real-time availability tracking across downtown, Hollywood, and Miami studios. Implemented sophisticated class booking system with visual mat selection interface allowing users to view studio layouts, see occupied mats, and book specific positions for enhanced user experience and social interaction during yoga sessions. Technologies used: React.js, React Native, TypeScript, Node.js, PostgreSQL, AWS Lambda, AWS serverless architecture, Stripe API, video streaming infrastructure, real-time notifications, social features, multi-tenant architecture, payment processing, analytics dashboard, SEO optimization, mobile-first design, cross-platform development, and scalable cloud infrastructure."
            },
            {
                "name": "BicycleHealth - Telemedicine App for Opioid Use Disorder Treatment",
                "link": "https://play.google.com/store/apps/details?id=com.bicyclehealth.patient.app",
                "description": "Developed comprehensive React Native telemedicine application for BicycleHealth, revolutionizing opioid use disorder treatment by improving healthcare accessibility by 60% through innovative mobile-first addiction recovery platform. Built HIPAA-compliant healthcare application using TypeScript and React Native, serving thousands of patients struggling with opioid addiction while connecting them with specialized healthcare providers through secure telemedicine infrastructure. Architected custom Zoom SDK integration with React Native wrapper, enabling seamless video and audio consultations directly within the mobile app, eliminating external platform dependencies and creating unified patient experience for medical appointments. Implemented comprehensive appointment scheduling system allowing patients to book, reschedule, and join virtual appointments with addiction specialists, primary care physicians, and mental health counselors through integrated Zoom meeting functionality. Technologies used: React Native, TypeScript, Redux, Firebase, GraphQL APIs, Zoom SDK integration, Face ID authentication, Stripe payment processing, HIPAA compliance, telemedicine infrastructure, healthcare workflows, prescription management, real-time chat, push notifications, biometric security, and mobile healthcare platforms."
            },
            {
                "name": "WikiSearch - AI-Powered Vector Search Engine",
                "link": "https://www.wikisearch.dev/",
                "description": "Engineered a large-scale AI-powered search engine by vectorizing the entire Wikipedia dataset (6+ million articles) using OpenAI's embedding models and storing in Apache Cassandra database for distributed, high-performance vector storage. Built sophisticated semantic search platform enabling context-aware queries that understand user intent beyond keyword matching, delivering more relevant and intelligent search results. Developed full-stack application with modern frontend interface allowing users to perform natural language queries and receive semantically similar content through advanced vector similarity algorithms. Implemented robust ETL pipeline to process, chunk, and embed millions of Wikipedia articles, managing data preprocessing, text normalization, and vector generation at scale. Technologies used: Python, OpenAI Embeddings API, Apache Cassandra, vector databases, semantic search, natural language processing (NLP), machine learning, ETL pipelines, distributed systems, React.js frontend, vector similarity algorithms, text preprocessing, data engineering, and scalable cloud infrastructure."
            },
            {
                "name": "Wikichat - Conversational AI for Wikipedia",
                "link": "https://www.wikich.at/",
                "description": "Created conversational AI for Wikipedia using Langchain, Amazon Bedrock, OpenAI APIs, and Astra DB for vector storage. Implemented RAG (Retrieval Augmented Generation) system to retrieve and store Wikipedia vectors for real-time AI-powered responses. Built with Python backend and React frontend, utilizing advanced NLP techniques and semantic search capabilities."
            },
            {
                "name": "Astra Block - Ethereum Blockchain Explorer",
                "link": "",
                "description": "Built a comprehensive Ethereum blockchain explorer (Etherscan clone) with real-time data extraction, transformation, and loading capabilities for crypto and NFT marketplace analytics. Developed full-stack application using React.js with TypeScript frontend, Node.js backend, and GraphQL API for seamless client-server communication. Implemented advanced blockchain data processing to decode smart contract events, maintain complete blockchain transaction history, and track assets across wallet addresses. Technologies used: React.js, TypeScript, Node.js, GraphQL, DataStax, Ethereum Web3 APIs, real-time data streaming, blockchain analytics, smart contract interaction, and modern frontend/backend development practices."
            },
            {
                "name": "DataStax Marketing Website",
                "link": "https://www.datastax.com/",
                "description": "Architected and developed a high-performance, server-side rendered marketing website for DataStax using Next.js, achieving optimal SEO performance and enhanced user experience. Built enterprise-grade marketing platform with seamless integrations including Marketo for marketing automation, ZoomInfo for lead intelligence, and ABTasty for A/B testing and conversion optimization. Implemented Sanity CMS as headless content management system, enabling non-technical content editors to manage website content independently through intuitive live editing capabilities. Technologies used: Next.js, React.js, TypeScript, Sanity CMS, Marketo API, ZoomInfo integration, ABTasty SDK, server-side rendering (SSR), static site generation (SSG), responsive web design, SEO optimization, marketing automation, lead generation, and modern JAMstack architecture."
            },
            {
                "name": "Loadsrunner Fleet Management Solution",
                "link": "https://app.loadsrunner.com/",
                "description": "Developed comprehensive B2B logistics platform serving small, medium, and large trucking fleets with real-time load booking and fleet management capabilities. Built scalable web application using Next.js and React Context for state management, serving thousands of active fleet managers and dispatch houses across the transportation industry. Architected live loadboard system enabling real-time load discovery, bidding, and booking functionality with dynamic pricing and availability updates using SWR hooks for optimal data fetching and caching. Technologies used: Next.js, React.js, React Context API, SWR hooks, Material-UI (MUI), TypeScript, Stripe Payment API, real-time data synchronization, WebSocket integration, geolocation services, route optimization algorithms, multi-tenant architecture, role-based access control, B2B payment processing, logistics APIs, fleet tracking systems, and responsive web design."
            },
            {
                "name": "Midato Health - HIPAA-Compliant Consent Management Platform",
                "link": "",
                "description": "Developed enterprise-grade consent management platform for Washington State healthcare system, enabling secure patient consent collection and medical record release authorization across state healthcare networks. Built HIPAA-compliant web application using React.js frontend and Node.js backend, serving thousands of healthcare providers and patients throughout Washington State's medical infrastructure. Architected robust serverless backend infrastructure using AWS Lambda functions for scalable, secure processing of sensitive medical consent data while maintaining strict healthcare compliance and data protection standards. Technologies used: React.js, Node.js, AWS Lambda, AWS serverless architecture, HIPAA compliance, digital signatures, identity verification, healthcare APIs, EHR integration, audit logging, data encryption, multi-factor authentication, role-based access control, regulatory compliance, healthcare workflow automation, and secure cloud infrastructure."
            },
            {
                "name": "Eternally - Next-Generation Social Media Platform",
                "link": "https://apps.apple.com/us/app/eternally/id1625353940",
                "description": "Architected and developed Eternally, a revolutionary social media platform designed to redefine online user experiences through innovative features and seamless cross-platform functionality. Built comprehensive social networking ecosystem using React Native for mobile applications (iOS and Android) and React.js for web platform, ensuring consistent user experience across all devices with shared component architecture. Developed advanced posting and timeline system with real-time content synchronization, intelligent feed algorithms, and dynamic content rendering supporting multimedia posts, stories, and user-generated content with optimized performance for high-volume social interactions. Technologies used: React Native, React.js, TypeScript, PostgreSQL, AWS cloud infrastructure, Stripe payment processing, real-time messaging, video streaming, push notifications, content delivery networks (CDN), cross-platform development, social media algorithms, multimedia processing, secure authentication, and scalable social networking architecture."
            },
            {
                "name": "LuxPark - Truck Parking Marketplace Platform",
                "link": "https://luxpark.com",
                "description": "Developed LuxPark, a comprehensive B2B marketplace platform revolutionizing the trucking industry by connecting parking space owners with truck drivers through an innovative 'Airbnb for truck parking' model. Built full-stack marketplace ecosystem using React.js frontend, Node.js backend, and GraphQL API architecture, serving thousands of truck drivers and parking facility owners across major transportation corridors. Architected sophisticated two-sided marketplace with dual user interfaces: property owner dashboard for listing and managing parking spaces, and driver mobile application for discovering, booking, and paying for secure truck parking spots in real-time. Technologies used: React.js, Node.js, Redux, GraphQL, PostgreSQL, SQL optimization, Stripe payment processing, geolocation APIs, real-time notifications, marketplace architecture, two-sided platform development, mobile-responsive design, machine learning recommendations, fraud prevention, and scalable cloud infrastructure."
            },
            {
                "name": "Roomie - 3D Room Planning & Shared Living Platform",
                "link": "https://app.roomie.com/login",
                "description": "Architected and developed Roomie, a groundbreaking 3D room planning platform revolutionizing shared living experiences for university students, city apartment residents, and property management companies through innovative spatial visualization and collaborative design tools. Built comprehensive full-stack application using Next.js and React.js frontend with Spring Hibernate backend, serving thousands of students, property managers, and educational institutions seeking efficient dormitory and apartment management solutions. Developed sophisticated 3D modeling engine enabling residents to visualize, plan, and customize their living spaces with photorealistic furniture placement, room measurements, and spatial optimization tools that streamline move-in processes and reduce roommate conflicts. Technologies used: Next.js, React.js, Spring Framework, Hibernate ORM, PostgreSQL, 3D graphics rendering, WebGL, real-time collaboration, spatial algorithms, multi-tenant architecture, role-based access control, responsive design, property management systems, educational technology, and collaborative planning platforms."
            }
        ]
    }

# Initialize data
EXPERIENCE_DATA = load_experience_data()

if __name__ == '__main__':
    print("🚀 Starting Enhanced Claude CV Generator...")
    print("\n✨ Enhanced Features:")
    print("- Intelligent role type detection (Mobile, AI/ML, Frontend, Backend, etc.)")
    print("- Smart experience and project selection based on relevance")
    print("- Varied realistic metrics (no more repetitive 40% and 99.9%)")
    print("- Role-specific professional summaries and skills sections")
    print("- Industry context awareness (healthcare, fintech, enterprise, etc.)")
    print("- Adaptive content filtering for maximum relevance")
    
    print("\n🎯 Supported Job Types:")
    print("- Mobile Developer (React Native, iOS, Android)")
    print("- AI/ML Engineer (Machine Learning, NLP, Data Science)")
    print("- Frontend Developer (React, Vue, Angular)")
    print("- Backend Developer (Node.js, Python, Java)")
    print("- Full-Stack Developer")
    print("- DevOps Engineer")
    print("- Blockchain Developer")
    print("- Data Engineer")
    print("- And more...")
    
    print("\n⚙️  Requirements:")
    print("1. Set ANTHROPIC_API_KEY environment variable")
    print("2. Create experience_data.json with your data")
    print("3. pip install anthropic flask python-dotenv")
    
    print(f"\n✅ Access app at: http://localhost:5000")
    
    if not client:
        print("\n⚠️  WARNING: Claude client not initialized. Check ANTHROPIC_API_KEY.")
    
    app.run(debug=True, port=5000)