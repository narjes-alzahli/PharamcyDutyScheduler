#!/bin/bash
# Monitoring script for Pharmacy Scheduler Service

echo "🏥 Pharmacy Scheduler Service Monitor"
echo "====================================="

# Check service status
echo "📊 Service Status:"
systemctl status pharmacy-scheduler --no-pager -l

echo ""
echo "🌐 Nginx Status:"
systemctl status nginx --no-pager -l

echo ""
echo "🔍 Port Status:"
netstat -tlnp | grep :8501 || echo "Port 8501 not listening"

echo ""
echo "📈 Recent Logs (last 10 lines):"
journalctl -u pharmacy-scheduler -n 10 --no-pager

echo ""
echo "🌍 Application Health Check:"
curl -s http://localhost:8501/_stcore/health && echo " ✅ Healthy" || echo " ❌ Unhealthy"

echo ""
echo "🔗 Access URLs:"
echo "   Local: http://localhost:8501"
echo "   Internal: http://$(hostname -I | awk '{print $1}'):8501"
echo "   External: http://$(curl -s ifconfig.me):8501"
