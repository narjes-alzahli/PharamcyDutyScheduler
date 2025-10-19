#!/bin/bash
# Setup Cloudflare tunnel for external access to the scheduler app

echo "☁️ Setting up Cloudflare tunnel for external access..."
echo "====================================================="

# Add Homebrew to PATH
export PATH="/opt/homebrew/bin:$PATH"

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared is not installed!"
    echo ""
    echo "📥 To install cloudflared:"
    echo "1. Visit: https://github.com/cloudflare/cloudflared/releases"
    echo "2. Download the macOS version"
    echo "3. Extract and move to /usr/local/bin/"
    echo "4. Or install via Homebrew: brew install cloudflared"
    echo ""
    echo "🔑 After installation, you'll need to:"
    echo "1. Sign up at https://dash.cloudflare.com"
    echo "2. Go to Zero Trust > Access > Tunnels"
    echo "3. Create a new tunnel and get your token"
    echo ""
    exit 1
fi

echo "✅ cloudflared is installed!"
echo ""

# Function to start the app and tunnel
start_with_tunnel() {
    echo "🚀 Starting Streamlit app with Cloudflare tunnel..."
    echo ""
    
    # Start Streamlit in background
    echo "📱 Starting Streamlit app..."
    python -m streamlit run roster/app/ui/streamlit_app.py --server.address 127.0.0.1 --server.port 8501 &
    STREAMLIT_PID=$!
    
    # Wait a moment for Streamlit to start
    sleep 3
    
    # Start Cloudflare tunnel
    echo "☁️ Starting Cloudflare tunnel..."
    echo "   This will create a public URL for your app"
    echo ""
    
    # Use quick tunnel (no account required)
    cloudflared tunnel --url http://localhost:8501 &
    TUNNEL_PID=$!
    
    # Wait a moment for tunnel to establish
    sleep 5
    
    echo ""
    echo "✅ Your app should now be accessible via a public URL!"
    echo "   Check the output above for the tunnel URL (usually starts with https://)"
    echo "   🏠 Local URL: http://localhost:8501"
    echo ""
    echo "🛑 To stop the app and tunnel, press Ctrl+C"
    echo "====================================================="
    
    # Wait for user to stop
    wait $STREAMLIT_PID $TUNNEL_PID
}

# Check if virtual environment exists
if [ ! -d "scheduler_env" ]; then
    echo "❌ Virtual environment not found!"
    echo "Please run: ./activate_env.sh first"
    exit 1
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source scheduler_env/bin/activate

echo "✅ Environment activated!"
echo ""

# Start the app with tunnel
start_with_tunnel
