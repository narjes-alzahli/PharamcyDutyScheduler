#!/bin/bash

# Script for prototype testing with fake data
# Safe for temporary testing with non-sensitive data

echo "🧪 Setting up PROTOTYPE access for testing"
echo "========================================="
echo ""

echo "⚠️  PROTOTYPE MODE - Using fake/test data only"
echo "   This is safe for testing with non-sensitive information"
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
    echo "🚀 Starting Streamlit prototype..."
    cd /Users/narjes/scheduler
    source scheduler_env/bin/activate
    streamlit run roster/app/ui/streamlit_app.py --server.port=8501 --server.address=0.0.0.0 &
    sleep 5
    echo "✅ Streamlit prototype started"
else
    echo "✅ Streamlit is already running"
fi

echo ""
echo "🧪 PROTOTYPE TESTING SETUP:"
echo "  ✅ Using test/fake data only"
echo "  ✅ Safe for temporary testing"
echo "  ✅ No sensitive information"
echo ""
echo "📋 FOR TESTING:"
echo "  - Share the URL with testers"
echo "  - Let them try the interface"
echo "  - Get feedback on functionality"
echo "  - Close when testing is done"
echo ""
echo "🌍 Creating public tunnel for testing..."
echo "   This will give you a URL to share with testers"
echo ""

# Start Cloudflare tunnel
cloudflared tunnel --url http://localhost:8501
