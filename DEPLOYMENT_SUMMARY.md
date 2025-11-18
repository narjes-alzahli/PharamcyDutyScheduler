# 🚀 Deployment Summary - Quick Reference

## External Access Links

### Production (Built/Static)
- **External (from anywhere):** `http://185.226.124.30:8502/`
- **Internal (same network):** `http://172.27.224.38:8502/`
- Uses: Nginx serving built React app + proxying `/api/` to backend

### Development (Live reload, no rebuild)
- **SSH Tunnel Command:**
  ```bash
  ssh -p 33240 root@185.226.124.30 -L 4000:127.0.0.1:3333 -L 8001:127.0.0.1:8000
  ```
- **Access:** `http://localhost:4000`
- Requires: React dev server running on server (port 3333)

---

## Server Setup

### Ports
- **8502:** Nginx (production frontend + API proxy)
- **8000:** FastAPI backend (internal)
- **3333:** React dev server (when running)

### Services Running
- **Backend:** `uvicorn backend.main:app --host 0.0.0.0 --port 8000`
- **Frontend (prod):** Nginx serves `frontend/build/` directory
- **Frontend (dev):** `npm start` in `frontend/` directory (port 3333)

---

## IP Addresses

### Server IPs
- **Internal:** `172.27.224.38` (private network)
- **External:** `185.226.124.30` (public, assigned by hosting provider)
- **Hostname:** `server1.i3tamid.om`
- **Provider:** The Cloud Data Center LLC (Muscat, Oman)

### Note on 192.168.10.95
- This is NOT the server's IP
- Likely a router/gateway IP that may forward traffic

---

## Configuration Files

### Frontend `.env` (for dev server)
```
PORT=3333
REACT_APP_API_URL=http://localhost:8001
```

### Nginx Config
- Location: `/etc/nginx/sites-available/pharmacy-duty`
- Serves: `/opt/apps/PharamcyDutyScheduler_tailwind/frontend/build`
- Proxies: `/api/` → `http://127.0.0.1:8000`

---

## Common Commands

### Build Production Frontend
```bash
cd frontend
npm run build
sudo systemctl reload nginx
```

### Start Dev Server
```bash
cd frontend
npm start
```

### Start Backend
```bash
source scheduler_env/bin/activate
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### Check Services
```bash
# Check ports
netstat -tlnp | grep -E ":(8502|8000|3333)"

# Check processes
ps aux | grep uvicorn
ps aux | grep "react-scripts"
```

---

## Key Learnings

1. **External IP works from anywhere** - `185.226.124.30:8502` is accessible globally
2. **Only one external port needed** - Port 8502 serves everything via Nginx
3. **Backend is internal only** - Port 8000 not exposed, only accessible via Nginx proxy
4. **Dev vs Prod** - Use SSH tunnel for dev (no rebuild), external IP for production
5. **Frontend uses relative URLs** - Empty `REACT_APP_API_URL` in production build
6. **Firewall** - Port 8502 is open (UFW configured)

---

## Troubleshooting

- **Page keeps loading:** Check if backend is running (`curl http://localhost:8000/api/health`)
- **Port conflict:** Use different local port in SSH tunnel (e.g., 8001 instead of 8000)
- **Dev server not working:** Check if `npm start` is running and port 3333 is listening

