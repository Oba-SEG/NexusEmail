#!/bin/bash
# Deploy NexusEmail staging stack to 192.168.8.4 (seg1-segotech-local) in Docker.
# Usage: ./deploy-staging.sh
set -euo pipefail

STAGING_HOST="192.168.8.4"
STAGING_USER="ob1"
REMOTE_DIR="/home/ob1/NexusEmail"
REPO_DIR="/Users/ob/Desktop/Code Projects/NexusEmail"
SECRETS_DIR="/Users/ob/segkeys/nexusemail"
KEY="$HOME/.ssh/nexus_staging"
SSH_OPTS=(-i "$KEY" -o UserKnownHostsFile="$HOME/.ssh/known_hosts_ob1_192.168.8.4" -o StrictHostKeyChecking=accept-new)
SSH_TARGET="$STAGING_USER@$STAGING_HOST"

sshr() { ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"; }
RSYNC_SSH="ssh -i $KEY -o UserKnownHostsFile=$HOME/.ssh/known_hosts_ob1_192.168.8.4 -o StrictHostKeyChecking=accept-new"

JW=$(cat "$SECRETS_DIR/jwt-secret")
CR=$(cat "$SECRETS_DIR/cron-secret")
PW=$(cat "$SECRETS_DIR/admin-password")

echo "==> Syncing repo to $SSH_TARGET:$REMOTE_DIR"
sshr "mkdir -p $REMOTE_DIR"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude out --exclude .git \
  --exclude '*.log' --exclude data --exclude .env --exclude .env.local \
  -e "$RSYNC_SSH" "$REPO_DIR/" "$SSH_TARGET:$REMOTE_DIR/"

echo "==> Writing .env (chmod 600)"
sshr "umask 077 && cat > $REMOTE_DIR/.env <<'ENVEOF'
JWT_SECRET=$JW
CRON_SECRET=$CR
SEED_ADMIN_EMAIL=admin@segbytes.xyz
SEED_ADMIN_PASSWORD=$PW
ENVEOF"

echo "==> Building and starting stack"
sshr "cd $REMOTE_DIR && docker compose -f docker-compose.staging.yml up -d --build"

echo "==> Health checks"
sleep 5
if curl -fsS --max-time 10 "http://$STAGING_HOST:3001/api/health" >/dev/null; then
  echo "backend health: OK (http://$STAGING_HOST:3001)"
else
  echo "backend health: FAILED — logs: ssh $SSH_TARGET 'cd $REMOTE_DIR && docker compose -f docker-compose.staging.yml logs backend'"
fi
if curl -fsS --max-time 10 -o /dev/null "http://$STAGING_HOST:3000"; then
  echo "frontend: OK (http://$STAGING_HOST:3000)"
else
  echo "frontend: FAILED — logs: ssh $SSH_TARGET 'cd $REMOTE_DIR && docker compose -f docker-compose.staging.yml logs frontend'"
fi
echo "==> Login: admin@segbytes.xyz / (segkeys/nexusemail/admin-password)"
