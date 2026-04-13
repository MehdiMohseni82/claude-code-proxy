#!/bin/bash
# Initial Let's Encrypt certificate provisioning
# Run this once before starting the full stack

set -e

if [ -z "$1" ]; then
  echo "Usage: ./init-letsencrypt.sh <domain> [email]"
  echo "  domain: Your domain name (e.g., api.example.com)"
  echo "  email:  Email for Let's Encrypt notifications (optional)"
  exit 1
fi

DOMAIN=$1
EMAIL=${2:-""}
RSA_KEY_SIZE=4096
DATA_PATH="./certbot"

echo "### Requesting Let's Encrypt certificate for $DOMAIN ..."

# Create required directories
mkdir -p "$DATA_PATH/conf/live/$DOMAIN"
mkdir -p "$DATA_PATH/www"

# Generate dummy certificate so nginx can start
echo "### Creating dummy certificate ..."
docker compose run --rm --entrypoint "\
  openssl req -x509 -nodes -newkey rsa:$RSA_KEY_SIZE -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
    -subj '/CN=localhost'" certbot

echo "### Starting nginx ..."
docker compose up -d nginx

echo "### Deleting dummy certificate ..."
docker compose run --rm --entrypoint "\
  rm -rf /etc/letsencrypt/live/$DOMAIN && \
  rm -rf /etc/letsencrypt/archive/$DOMAIN && \
  rm -rf /etc/letsencrypt/renewal/$DOMAIN.conf" certbot

echo "### Requesting real certificate ..."
EMAIL_ARG=""
if [ -n "$EMAIL" ]; then
  EMAIL_ARG="--email $EMAIL"
else
  EMAIL_ARG="--register-unsafely-without-email"
fi

docker compose run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $EMAIL_ARG \
    -d $DOMAIN \
    --rsa-key-size $RSA_KEY_SIZE \
    --agree-tos \
    --force-renewal" certbot

echo "### Reloading nginx ..."
docker compose exec nginx nginx -s reload

echo "### Done! Certificate provisioned for $DOMAIN"
echo "You can now run: docker compose up -d"
