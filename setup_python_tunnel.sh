#!/bin/bash
# Setup Python-based tunnel for external access to the scheduler app

echo "🐍 Setting up Python tunnel for external access..."
echo "=================================================="

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

# Install required packages
echo "📦 Installing tunnel dependencies..."
pip install pyngrok

echo "✅ Dependencies installed!"
echo ""

# Function to start the app and tunnel
start_with_tunnel() {
    echo "🚀 Starting Streamlit app with Python tunnel..."
    echo ""
    
    # Start Streamlit in background
    echo "📱 Starting Streamlit app..."
    python -m streamlit run roster/app/ui/streamlit_app.py --server.address 127.0.0.1 --server.port 8501 &
    STREAMLIT_PID=$!
    
    # Wait a moment for Streamlit to start
    sleep 3
    
    # Start Python tunnel
    echo "🌐 Starting Python tunnel..."
    echo "   This will create a public URL for your app"
    echo ""
    
    # Create a simple tunnel script
    cat > tunnel_script.py << 'EOF'
import pyngrok
from pyngrok import ngrok
import time
import sys

try:
    # Create tunnel
    public_url = ngrok.connect(8501)
    print(f"✅ Your app is now accessible at:")
    print(f"   🌍 Public URL: {public_url}")
    print(f"   🏠 Local URL: http://localhost:8501")
    print("")
    print("📋 Share this URL with anyone who needs access:")
    print(f"   {public_url}")
    print("")
    print("🛑 To stop the tunnel, press Ctrl+C")
    print("=" * 50)
    
    # Keep the tunnel alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 Stopping tunnel...")
        ngrok.disconnect(public_url)
        ngrok.kill()
        print("✅ Tunnel stopped.")
        
except Exception as e:
    print(f"❌ Error creating tunnel: {e}")
    print("💡 Make sure you have an internet connection")
    sys.exit(1)
EOF
    
    # Run the tunnel script
    python tunnel_script.py &
    TUNNEL_PID=$!
    
    # Wait for user to stop
    wait $STREAMLIT_PID $TUNNEL_PID
}

# Start the app with tunnel
start_with_tunnel


