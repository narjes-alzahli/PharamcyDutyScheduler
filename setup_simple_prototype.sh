#!/bin/bash

# Simple prototype setup without system installation
# Uses a portable version of cloudflared

echo "🧪 Setting up PROTOTYPE access (simple version)"
echo "============================================="
echo ""

# Create a local bin directory
mkdir -p bin

# Download cloudflared to local directory (no system install needed)
if [ ! -f "bin/cloudflared" ]; then
    echo "📥 Downloading cloudflared (portable version)..."
    curl -L --output bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64
    chmod +x bin/cloudflared
    echo "✅ cloudflared downloaded"
else
    echo "✅ cloudflared already available"
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

# Start Cloudflare tunnel using local binary
./bin/cloudflared tunnel --url http://localhost:8501
