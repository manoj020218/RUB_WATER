#!/bin/bash
# FloodGuard VPS Deploy Script
# Usage: bash vps_deploy.sh
# Run this on the VPS after SSH login.
set -e

REPO_REMOTE="https://github.com/manoj020218/RUB_WATER.git"
BRANCH="main"
SERVICE_NAME="floodguard"
PWA_DIR="/var/www/floodguard-pwa"
VENDOR_DIR_NAME="vendor-mgmt"

# ── Find project root ──────────────────────────────────────────────────────────
find_project_root() {
  for candidate in \
    /root/projects/flood_guard \
    /root/RUB_WATER \
    /root/FloodGuard \
    /root/floodguard \
    /home/ubuntu/RUB_WATER \
    /opt/floodguard \
    /srv/floodguard
  do
    if [ -d "$candidate/.git" ]; then
      echo "$candidate"
      return 0
    fi
  done
  echo ""
}

PROJECT_ROOT=$(find_project_root)

if [ -z "$PROJECT_ROOT" ]; then
  echo "[deploy] Project not found in common locations. Cloning fresh..."
  cd /root
  git clone "$REPO_REMOTE" RUB_WATER
  PROJECT_ROOT="/root/RUB_WATER"
fi

BACKEND_DIR="$PROJECT_ROOT/VPS/backend"
APK_DIR="$PROJECT_ROOT/APK/www"

echo "[deploy] Project root: $PROJECT_ROOT"
echo "[deploy] Backend dir: $BACKEND_DIR"

# ── Git: pull latest, avoid conflicts ────────────────────────────────────────
cd "$PROJECT_ROOT"

echo ""
echo "=== Current git status ==="
git status --short

echo ""
echo "=== Stashing any local VPS changes ==="
# Stash local changes so git pull doesn't conflict
git stash push -m "vps-deploy-$(date +%Y%m%d-%H%M%S)" --include-untracked 2>/dev/null || true

echo ""
echo "=== Pulling latest from GitHub ==="
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo ""
echo "=== Latest commits ==="
git log --oneline -5

# ── Apply VPS-specific config on top ─────────────────────────────────────────
# If VPS_SHIFT_CONFIG.json was stashed with different values, restore it
# (the pulled version already has correct CORS; stash restore is optional)
echo ""
echo "=== Checking stash ==="
STASH_LIST=$(git stash list 2>/dev/null | head -1)
if echo "$STASH_LIST" | grep -q "vps-deploy"; then
  echo "Stash found: $STASH_LIST"
  echo "Restoring stash (VPS-specific configs will be merged)..."
  # Only restore VPS_SHIFT_CONFIG.json from stash if it exists
  git show stash@{0}:VPS/backend/VPS_SHIFT_CONFIG.json > /tmp/vps_shift_stash.json 2>/dev/null && \
    echo "Note: stashed VPS_SHIFT_CONFIG.json preserved. Review if needed." || true
  git stash drop 2>/dev/null || true
fi

# ── npm install (only if package.json changed) ───────────────────────────────
echo ""
echo "=== Installing Node.js dependencies ==="
cd "$BACKEND_DIR"
npm install --no-audit --no-fund 2>&1 | tail -5

# ── Detect and restart service ────────────────────────────────────────────────
echo ""
echo "=== Restarting backend service ==="

restart_service() {
  # Try PM2
  if command -v pm2 >/dev/null 2>&1; then
    if pm2 list | grep -q "$SERVICE_NAME"; then
      echo "Restarting via PM2..."
      pm2 restart "$SERVICE_NAME"
      pm2 save
      return 0
    else
      # Start with PM2 if not running
      echo "Starting via PM2 (not currently managed)..."
      pm2 start "$BACKEND_DIR/src/server.js" --name "$SERVICE_NAME" --cwd "$BACKEND_DIR"
      pm2 save
      pm2 startup systemd -u root --hp /root 2>/dev/null || true
      return 0
    fi
  fi

  # Try systemctl
  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo "Restarting via systemctl..."
    systemctl restart "$SERVICE_NAME"
    return 0
  fi

  # Fallback: check if running as a raw node process and kill+restart
  echo "PM2 and systemctl not found. Attempting raw node restart..."
  OLD_PID=$(pgrep -f "node.*server.js" 2>/dev/null | head -1 || true)
  if [ -n "$OLD_PID" ]; then
    echo "Killing old node process PID $OLD_PID..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
  mkdir -p "$BACKEND_DIR/logs"
  nohup node "$BACKEND_DIR/src/server.js" \
    > "$BACKEND_DIR/logs/backend.stdout.log" \
    2>"$BACKEND_DIR/logs/backend.stderr.log" &
  echo "Started as background process PID $!"
}

restart_service

# ── Deploy PWA files ───────────────────────────────────────────────────────────
echo ""
echo "=== Deploying PWA files to $PWA_DIR ==="
mkdir -p "$PWA_DIR"
cp -r "$APK_DIR"/. "$PWA_DIR/"
echo "PWA files copied."

# ── Configure Nginx for /vendors ──────────────────────────────────────────────
echo ""
echo "=== Configuring Nginx ==="

NGINX_API_CONF="/etc/nginx/sites-available/floodguard-api"
NGINX_JENIX_CONF="/etc/nginx/sites-available/floodguard.jenix.in"

# Update API nginx config to add /vendors static route
cat > "$NGINX_API_CONF" <<'NGINXCONF'
server {
    listen 80;
    server_name api.floodguard.iotsoft.in 154.61.69.200;

    # Vendor management standalone UI
    location /vendors {
        alias /root/RUB_WATER/VPS/backend/vendor-mgmt;
        index index.html;
        try_files $uri $uri/ /vendors/index.html;
    }

    # Backend API
    location / {
        proxy_pass         http://127.0.0.1:4080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_read_timeout    60s;
    }
}
NGINXCONF

# Fix vendor-mgmt path to actual project root
sed -i "s|/root/RUB_WATER/VPS/backend/vendor-mgmt|$PROJECT_ROOT/VPS/backend/vendor-mgmt|g" "$NGINX_API_CONF"

# Link if not linked
ln -sf "$NGINX_API_CONF" /etc/nginx/sites-enabled/floodguard-api 2>/dev/null || true

# floodguard.jenix.in PWA config
cp "$PROJECT_ROOT/VPS/infra/nginx-floodguard-jenix.conf" "$NGINX_JENIX_CONF"
ln -sf "$NGINX_JENIX_CONF" /etc/nginx/sites-enabled/floodguard.jenix.in 2>/dev/null || true

# Test and reload nginx
echo "Testing nginx config..."
if nginx -t 2>&1; then
  echo "Nginx config OK. Reloading..."
  systemctl reload nginx
  echo "Nginx reloaded."
else
  echo "WARNING: Nginx config test failed. Check manually."
fi

# ── Health check ──────────────────────────────────────────────────────────────
echo ""
echo "=== Health check (waiting 3s for service start) ==="
sleep 3
curl -s --max-time 10 http://127.0.0.1:4080/health && echo "" || echo "WARNING: health check failed"

echo ""
echo "=== Deploy complete ==="
echo "API:     http://154.61.69.200/api"
echo "Health:  http://154.61.69.200/health"
echo "Vendors: http://154.61.69.200/vendors  (login: ebonx / ebnox_123)"
echo ""
echo "For HTTPS vendor management:"
echo "  certbot --nginx -d api.floodguard.iotsoft.in --non-interactive --agree-tos -m admin@iotsoft.in --redirect || true"
echo ""
echo "For floodguard.jenix.in PWA (only if DNS points to this server):"
echo "  ln -sf $NGINX_JENIX_CONF /etc/nginx/sites-enabled/floodguard.jenix.in"
echo "  certbot --nginx -d floodguard.jenix.in --non-interactive --agree-tos -m admin@jenix.in --redirect"
echo "  nginx -t && systemctl reload nginx"
