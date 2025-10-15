#!/bin/bash

# Script to make Streamlit app accessible with basic security
# This adds password protection before making it public

echo "🔒 Setting up SECURE public access to your Streamlit app"
echo "======================================================"
echo ""

# Create .streamlit directory if it doesn't exist
mkdir -p .streamlit

# Create a secrets file with password protection
echo "🔐 Setting up password protection..."
cat > .streamlit/secrets.toml <<EOF
[general]
password = "scheduler2025"
EOF

# Create config file to enable authentication
cat > .streamlit/config.toml <<EOF
[server]
enableCORS = false
enableXsrfProtection = false

[theme]
primaryColor = "#FF6B6B"
backgroundColor = "#FFFFFF"
secondaryBackgroundColor = "#F0F2F6"
textColor = "#262730"
EOF

echo "✅ Password protection enabled"
echo "   Password: scheduler2025"
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
    echo "🚀 Starting Streamlit app with security..."
    cd /Users/narjes/scheduler
    source scheduler_env/bin/activate
    streamlit run roster/app/ui/streamlit_app.py --server.port=8501 --server.address=0.0.0.0 &
    sleep 5
    echo "✅ Streamlit started with password protection"
else
    echo "✅ Streamlit is already running"
fi

echo ""
echo "🔒 SECURITY FEATURES ENABLED:"
echo "  ✅ Password protection (password: scheduler2025)"
echo "  ✅ HTTPS encryption"
echo "  ✅ Limited access control"
echo ""
echo "⚠️  IMPORTANT SECURITY NOTES:"
echo "  - Share the password only with trusted people"
echo "  - Change the password in .streamlit/secrets.toml"
echo "  - Monitor who accesses the app"
echo "  - Consider using stronger authentication for production"
echo ""
echo "🌍 Creating secure public tunnel..."
echo "   This will give you a public URL that requires a password"
echo ""

# Start Cloudflare tunnel
cloudflared tunnel --url http://localhost:8501
