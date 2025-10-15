#!/bin/bash

# Script to make Streamlit app accessible from anywhere on the internet
# This uses ngrok to create a public tunnel

echo "🌐 Setting up public access to your Streamlit app"
echo "==============================================="
echo ""

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed"
    echo ""
    echo "📥 Install ngrok:"
    echo "  1. Go to: https://ngrok.com/download"
    echo "  2. Download and install ngrok"
    echo "  3. Sign up for a free account"
    echo "  4. Get your auth token from: https://dashboard.ngrok.com/get-started/your-authtoken"
    echo ""
    echo "Then run this script again"
    exit 1
fi

# Check if ngrok is authenticated
if ! ngrok config check &> /dev/null; then
    echo "🔑 ngrok needs to be authenticated"
    echo ""
    echo "Run this command with your auth token:"
    echo "  ngrok config add-authtoken YOUR_AUTH_TOKEN"
    echo ""
    echo "Get your token from: https://dashboard.ngrok.com/get-started/your-authtoken"
    exit 1
fi

echo "✅ ngrok is ready"
echo ""

# Start Streamlit in background if not running
if ! pgrep -f "streamlit run" > /dev/null; then
    echo "🚀 Starting Streamlit app..."
    cd /Users/narjes/scheduler
    source scheduler_env/bin/activate
    streamlit run roster/app/ui/streamlit_app.py --server.port=8501 --server.address=0.0.0.0 &
    sleep 5
    echo "✅ Streamlit started"
else
    echo "✅ Streamlit is already running"
fi

echo ""
echo "🌍 Creating public tunnel with ngrok..."
echo "   This will give you a public URL that anyone can access"
echo ""

# Start ngrok tunnel
ngrok http 8501 --log=stdout
