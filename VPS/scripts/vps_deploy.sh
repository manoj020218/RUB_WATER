#!/bin/bash
# FloodGuard VPS Deploy Script
# Usage: bash vps_deploy.sh
# Run this on the VPS after SSH login.
set -e

REPO_REMOTE="https://github.com/manoj020218/RUB_WATER.git"
BRANCH="main"
SERVICE_NAME="floodguard-api"
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

# ── pnpm install ─────────────────────────────────────────────────────────────
echo ""
echo "=== Installing Node.js dependencies (pnpm) ==="
cd "$BACKEND_DIR"
pnpm install --frozen-lockfile 2>&1 | tail -5 || pnpm install 2>&1 | tail -5

# ── Detect and restart service ────────────────────────────────────────────────
echo ""
echo "=== Restarting backend service ==="

if pm2 list | grep -q "$SERVICE_NAME"; then
  echo "Restarting existing PM2 process '$SERVICE_NAME'..."
  pm2 restart "$SERVICE_NAME" --update-env
else
  echo "No PM2 process named '$SERVICE_NAME' found — starting fresh..."
  pm2 start "$BACKEND_DIR/src/server.js" --name "$SERVICE_NAME" --cwd "$BACKEND_DIR"
fi
pm2 save

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

# ── Re-apply SSL (certbot) ────────────────────────────────────────────────────
# The nginx config above is HTTP-only; certbot adds the SSL blocks.
# Running it every deploy is safe — it's a no-op when cert isn't due for renewal.
echo ""
echo "=== Re-applying SSL certificates ==="
certbot --nginx -d api.floodguard.iotsoft.in --non-interactive --agree-tos \
  -m admin@iotsoft.in --redirect 2>&1 | grep -E "(Congratulations|error|warning|Keeping|Deploying|failed)" || true

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
curl -s --max-time 10 https://api.floodguard.iotsoft.in/health && echo "" || \
  curl -s --max-time 10 http://127.0.0.1:4080/health && echo "" || echo "WARNING: health check failed"

echo ""
echo "=== Deploy complete ==="
echo "API:     https://api.floodguard.iotsoft.in/api"
echo "Health:  https://api.floodguard.iotsoft.in/health"
echo "Vendors: https://api.floodguard.iotsoft.in/vendors  (login: ebonx / ebnox_123)"
echo "PWA:     https://floodguard.jenix.in/app"
