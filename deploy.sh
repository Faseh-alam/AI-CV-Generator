#!/bin/bash

# 🚀 CV Generator Deployment Script
echo "🚀 Starting CV Generator Deployment..."

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "📁 Initializing git repository..."
    git init
    git add .
    git commit -m "Initial commit - CV Generator"
fi

# Check if remote exists
if ! git remote get-url origin > /dev/null 2>&1; then
    echo "🔗 Please add your GitHub repository as origin:"
    echo "   git remote add origin https://github.com/yourusername/your-repo.git"
    echo "   Then run this script again."
    exit 1
fi

# Push to GitHub
echo "📤 Pushing to GitHub..."
git add .
git commit -m "Deploy CV Generator - $(date)"
git push origin main

echo ""
echo "✅ Code pushed to GitHub!"
echo ""
echo "🎯 Next steps:"
echo "1. Go to https://railway.app"
echo "2. Sign up with GitHub"
echo "3. Click 'New Project' → 'Deploy from GitHub repo'"
echo "4. Select your repository"
echo "5. Add environment variable: ANTHROPIC_API_KEY = your_api_key"
echo "6. Deploy!"
echo ""
echo "🌟 Alternative: Use Render.com (same steps, different platform)"
echo ""
echo "🔑 Get your API key from: https://console.anthropic.com"
echo ""
echo "🎉 Your CV Generator will be live 24/7!" 