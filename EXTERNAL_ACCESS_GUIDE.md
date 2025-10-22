# 🌐 External Access Guide for Staff Rostering System

This guide explains how to make your Staff Rostering System accessible to people outside your WiFi network.

## 🚀 Internet Access Solution

### Cloudflare Tunnel (Recommended)
**Use when:** You need internet access for people not on your network

```bash
./setup_cloudflare_tunnel.sh
```

- ✅ **Pros:** Free, reliable, works through firewalls, HTTPS, accessible from anywhere
- ❌ **Cons:** Requires installing cloudflared
- 🔗 **Access:** Public HTTPS URL (shown when you run the script)

## 📋 Detailed Setup Instructions

### Cloudflare Tunnel Setup

1. **Install cloudflared:**
   ```bash
   # Option 1: Homebrew (recommended)
   brew install cloudflared
   
   # Option 2: Manual download
   # Visit: https://github.com/cloudflare/cloudflared/releases
   # Download macOS version and move to /usr/local/bin/
   ```

2. **Run the tunnel script:**
   ```bash
   ./setup_cloudflare_tunnel.sh
   ```

3. **Get your public URL:**
   The script will output a public URL like:
   ```
   ✅ Your app should now be accessible via a public URL!
   https://random-words-1234.trycloudflare.com
   ```

4. **Share the public URL:**
   Anyone with this URL can access your app from anywhere on the internet

## 🔒 Security Considerations

### Cloudflare Tunnel
- ✅ **Secure:** Uses HTTPS encryption
- ⏰ **Temporary:** URLs expire after some time (usually hours)
- 🔄 **Regenerate:** Run the script again to get a new URL
- 🌍 **Public:** Anyone with the URL can access your app

## 🛠️ Troubleshooting

### "Connection Refused" Error
- **Cause:** Firewall blocking the connection
- **Solution:** Allow Python/Streamlit through your firewall
- **macOS:** System Preferences > Security & Privacy > Firewall > Allow Python

### "Port Already in Use" Error
- **Cause:** Another app is using port 8501
- **Solution:** Kill the process or use a different port
- **Find process:** `lsof -i :8501`
- **Kill process:** `kill -9 PID_NUMBER`

### Cloudflare Tunnel Not Working
- **Check:** Is cloudflared installed? Run `cloudflared --version`
- **Check:** Is your internet connection working?
- **Try:** Restart the script, sometimes it takes a moment to establish

### App Not Loading for External Users
- **Cloudflare:** Make sure you shared the correct URL
- **Check:** Is the tunnel still running? (URLs can expire)

## 📱 Mobile Access

The Cloudflare tunnel works on any device:
- **Any device:** Use the public HTTPS URL on phones, tablets, computers
- **Any location:** Works from anywhere with internet access

## 🔄 Switching Between Methods

You can use different methods at different times:

1. **Local development:** `./start_app.sh` (localhost only)
2. **Internet sharing:** `./setup_cloudflare_tunnel.sh` (anywhere)

## 📞 Getting Help

If you encounter issues:

1. **Check the error messages** in the terminal
2. **Verify your internet connection**
3. **Try restarting the script**
4. **Make sure the virtual environment is activated**
5. **Check if cloudflared is properly installed**

## 🎯 Recommended Workflow

1. **For testing:** Use `./start_app.sh` (localhost only)
2. **For sharing with people outside your network:** Use `./setup_cloudflare_tunnel.sh` (internet access)

Remember: Always stop the previous method before starting a new one (Ctrl+C to stop).
