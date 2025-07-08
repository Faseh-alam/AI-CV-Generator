# 🚀 CV Generator Deployment Guide

Your CV Generator is now ready for 24/7 deployment! Here are the best options:

## 🎯 Recommended: Railway (Easiest & Most Reliable)

**Why Railway?**
- ✅ Free tier with 500 hours/month
- ✅ Automatic deployments from GitHub
- ✅ Built-in environment variable management
- ✅ No credit card required
- ✅ Excellent uptime

### Steps:
1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push origin main
   ```

2. **Deploy on Railway**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Add environment variable: `ANTHROPIC_API_KEY` = your API key
   - Deploy!

3. **Get Your URL**
   - Railway will give you a URL like: `https://your-app-name.railway.app`
   - Your app is now live 24/7! 🎉

---

## 🌟 Alternative: Render (Also Excellent)

**Why Render?**
- ✅ Free tier with 750 hours/month
- ✅ Automatic deployments
- ✅ Custom domains
- ✅ Great performance

### Steps:
1. **Push to GitHub** (same as above)

2. **Deploy on Render**
   - Go to [render.com](https://render.com)
   - Sign up with GitHub
   - Click "New" → "Web Service"
   - Connect your GitHub repo
   - Set build command: `pip install -r requirements.txt`
   - Set start command: `python app.py`
   - Add environment variable: `ANTHROPIC_API_KEY`
   - Deploy!

---

## 🏢 Enterprise: Heroku (Classic Choice)

**Why Heroku?**
- ✅ Proven reliability
- ✅ Excellent scaling
- ✅ Rich ecosystem

### Steps:
1. **Install Heroku CLI**
   ```bash
   # macOS
   brew install heroku/brew/heroku
   
   # Or download from heroku.com
   ```

2. **Deploy**
   ```bash
   heroku login
   heroku create your-cv-generator
   heroku config:set ANTHROPIC_API_KEY=your_api_key
   git push heroku main
   ```

3. **Open**
   ```bash
   heroku open
   ```

---

## ☁️ Cloud: DigitalOcean App Platform

**Why DigitalOcean?**
- ✅ Predictable pricing
- ✅ Excellent performance
- ✅ Global CDN

### Steps:
1. **Push to GitHub**

2. **Deploy on DigitalOcean**
   - Go to [digitalocean.com](https://digitalocean.com)
   - Create account
   - Go to "Apps" → "Create App"
   - Connect GitHub repo
   - Set build command: `pip install -r requirements.txt`
   - Set run command: `python app.py`
   - Add environment variable: `ANTHROPIC_API_KEY`
   - Deploy!

---

## 🐳 Docker Deployment (Advanced)

If you want to deploy anywhere with Docker:

### Create Dockerfile:
```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

EXPOSE 5000

CMD ["python", "app.py"]
```

### Deploy with Docker:
```bash
# Build image
docker build -t cv-generator .

# Run container
docker run -p 5000:5000 -e ANTHROPIC_API_KEY=your_key cv-generator
```

---

## 🔧 Environment Variables

All platforms need this environment variable:

```
ANTHROPIC_API_KEY=your_actual_api_key_here
```

**How to get your API key:**
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up/login
3. Go to "API Keys"
4. Create new key
5. Copy and use in deployment

---

## 📊 Monitoring Your Deployment

### Health Check
Your app includes a health check endpoint:
- `https://your-app.com/health`
- Returns: `{"status": "healthy", "service": "cv-generator"}`

### Logs
- **Railway**: View logs in dashboard
- **Render**: View logs in dashboard  
- **Heroku**: `heroku logs --tail`
- **DigitalOcean**: View logs in dashboard

---

## 🚨 Troubleshooting

### Common Issues:

1. **App won't start**
   - Check if `ANTHROPIC_API_KEY` is set
   - Verify `requirements.txt` is in root directory
   - Check logs for Python errors

2. **Port issues**
   - Make sure app uses `os.environ.get('PORT', 5000)`
   - Railway/Render set PORT automatically

3. **Import errors**
   - All dependencies must be in `requirements.txt`
   - Check Python version compatibility

### Debug Commands:
```bash
# Test locally
python app.py

# Check requirements
pip list

# Test API key
python -c "import anthropic; print('API key works')"
```

---

## 🎉 Success!

Once deployed, your CV Generator will be available 24/7 at your platform's URL. Users can:

- ✅ Access the web interface
- ✅ Generate tailored CVs
- ✅ Get LaTeX code instantly
- ✅ Use Claude AI for intelligent analysis

**Your app is now production-ready! 🚀** 