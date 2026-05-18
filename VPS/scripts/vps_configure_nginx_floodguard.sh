#!/bin/sh
set -e

cat >/etc/nginx/sites-available/floodguard-api <<'CONF'
server {
    listen 80;
    server_name api.floodguard.iotsoft.in;

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
CONF

ln -sf /etc/nginx/sites-available/floodguard-api /etc/nginx/sites-enabled/floodguard-api
nginx -t
systemctl reload nginx

# Best effort HTTPS enablement (will be skipped if challenge fails)
if command -v certbot >/dev/null 2>&1; then
  certbot --nginx -d api.floodguard.iotsoft.in --non-interactive --agree-tos -m admin@iotsoft.in --redirect || true
  nginx -t
  systemctl reload nginx
fi
