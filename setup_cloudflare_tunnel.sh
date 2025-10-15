#!/bin/bash

# Alternative: Use Cloudflare Tunnel (free, no signup required)
# This creates a public URL that anyone can access

echo "☁️  Setting up public access with Cloudflare Tunnel"
echo "================================================="
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "📥 Installing cloudflared..."
    
    # Download and install cloudflared for macOS
    curl -L --output cloudflared.pkg https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.pkg
    
    echo "Installing cloudflared..."
    sudo installer -pkg cloudflared.pkg -target /
    
    # Clean up
    rm cloudflared.pkg
    
    echo "✅ cloudflared installed"
else
    echo "✅ cloudflared is already installed"
fi

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
echo "🌍 Creating public tunnel with Cloudflare..."
echo "   This will give you a public URL that anyone can access"
echo "   The URL will be something like: https://random-words-1234.trycloudflare.com"
echo ""

# Start Cloudflare tunnel
cloudflared tunnel --url http://localhost:8501
