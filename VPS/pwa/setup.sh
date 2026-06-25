#!/bin/bash
# PWA setup script for app.floodguard.jenix.in
# Run once on the VPS (103.118.183.243) after DNS A record is propagated.
# Usage: bash /root/projects/floodguard/repo/VPS/pwa/setup.sh

set -e

CONF_SRC="/root/projects/floodguard/repo/VPS/pwa/nginx-app.conf"
CONF_DEST="/etc/nginx/conf.d/app-floodguard.conf"

echo "==> Creating PWA web root..."
mkdir -p /var/www/floodguard-pwa
cp -r /root/projects/floodguard/repo/APK/www/. /var/www/floodguard-pwa/

echo "==> Copying nginx config..."
cp "$CONF_SRC" "$CONF_DEST"

echo "==> Testing nginx config..."
nginx -t

echo "==> Reloading nginx..."
systemctl reload nginx

echo "==> Nginx reloaded. HTTP serving app.floodguard.jenix.in"
echo ""
echo "Next step: obtain SSL certificate (run after DNS propagates):"
echo "  certbot --nginx -d app.floodguard.jenix.in"
echo ""
echo "After certbot, restart PM2 to apply CORS changes:"
echo "  pm2 restart floodguard-api"
