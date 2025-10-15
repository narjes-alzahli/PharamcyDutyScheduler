#!/bin/bash

# Setup script for running Streamlit app on macOS
# This will make the app run in the background permanently using launchd

echo "🚀 Setting up Streamlit app as a macOS service..."

# Get current directory
APP_DIR="/Users/narjes/scheduler"
VENV_DIR="$APP_DIR/scheduler_env"
APP_FILE="$APP_DIR/roster/app/ui/streamlit_app.py"

# Create launchd plist file
cat > ~/Library/LaunchAgents/com.streamlit.scheduler.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.streamlit.scheduler</string>
    <key>ProgramArguments</key>
    <array>
        <string>$VENV_DIR/bin/streamlit</string>
        <string>run</string>
        <string>$APP_FILE</string>
        <string>--server.port=8501</string>
        <string>--server.address=0.0.0.0</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$APP_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/streamlit-scheduler.out</string>
    <key>StandardErrorPath</key>
    <string>/tmp/streamlit-scheduler.err</string>
</dict>
</plist>
EOF

# Load the service
launchctl load ~/Library/LaunchAgents/com.streamlit.scheduler.plist

echo "🎉 Setup complete!"
echo ""
echo "Your Streamlit app is now running as a macOS service:"
echo "  - Service status: launchctl list | grep streamlit"
echo "  - View logs: tail -f /tmp/streamlit-scheduler.out"
echo "  - Restart service: launchctl unload ~/Library/LaunchAgents/com.streamlit.scheduler.plist && launchctl load ~/Library/LaunchAgents/com.streamlit.scheduler.plist"
echo "  - Stop service: launchctl unload ~/Library/LaunchAgents/com.streamlit.scheduler.plist"
echo ""
echo "Access your app at:"
echo "  - Local: http://localhost:8501"
echo "  - Network: http://192.168.10.68:8501"
echo "  - Alternative: http://172.22.0.172:8501"
echo ""
echo "Other devices on your network can access it using the network URLs above."
echo ""
echo "The app will automatically start on system boot and restart if it crashes."
