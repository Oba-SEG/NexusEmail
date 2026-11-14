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
PGPW=$(cat "$SECRETS_DIR/postgres-password")
EK=$(cat "$SECRETS_DIR/encryption-key" 2>/dev/null || true)
if [ -z "$EK" ]; then
  # A fresh key here would leave existing encrypted settings undecryptable.
  # Recover the deployed key from staging .env first; only generate when the
  # remote has none.
  REMOTE_EK=$(sshr "grep -E '^NEXUSEMAIL_ENCRYPTION_KEY=' $REMOTE_DIR/.env 2>/dev/null | cut -d= -f2-" 2>/dev/null | tr -d '\n\r') || REMOTE_EK=""
  if [ -n "$REMOTE_EK" ]; then
    EK="$REMOTE_EK"
    umask 077 && touch "$SECRETS_DIR/encryption-key" && chmod 600 "$SECRETS_DIR/encryption-key" && printf '%s' "$EK" > "$SECRETS_DIR/encryption-key"
    echo "==> Recovered NEXUSEMAIL_ENCRYPTION_KEY from staging .env into $SECRETS_DIR/encryption-key"
  else
    EK=$(openssl rand -hex 32)
    umask 077 && touch "$SECRETS_DIR/encryption-key" && chmod 600 "$SECRETS_DIR/encryption-key" && printf '%s' "$EK" > "$SECRETS_DIR/encryption-key"
  fi
fi

echo "==> Syncing repo to $SSH_TARGET:$REMOTE_DIR"
sshr "mkdir -p $REMOTE_DIR"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude out --exclude .git \
  --exclude '*.log' --exclude data --exclude .env --exclude .env.local \
  -e "$RSYNC_SSH" "$REPO_DIR/" "$SSH_TARGET:$REMOTE_DIR/"

echo "==> Writing .env (chmod 600, secrets sent via SSH stdin, not argv)"
{
  printf 'JWT_SECRET=%s\n' "$JW"
  printf 'CRON_SECRET=%s\n' "$CR"
  printf 'SEED_ADMIN_EMAIL=admin@segbytes.xyz\n'
  printf 'SEED_ADMIN_PASSWORD=%s\n' "$PW"
  printf 'POSTGRES_PASSWORD=%s\n' "$PGPW"
  printf 'NEXUSEMAIL_ENCRYPTION_KEY=%s\n' "$EK"
} | sshr "umask 077 && cat > $REMOTE_DIR/.env && chmod 600 $REMOTE_DIR/.env"

echo "==> Building and starting stack"
sshr "cd $REMOTE_DIR && docker compose -f docker-compose.staging.yml up -d --build"

echo "==> Health checks"
sleep 5
health_failed=0
if curl -fsS --max-time 10 "http://$STAGING_HOST:4100/api/health" >/dev/null; then
  echo "backend health: OK (http://$STAGING_HOST:4100)"
else
  health_failed=1
  echo "backend health: FAILED — logs: ssh $SSH_TARGET 'cd $REMOTE_DIR && docker compose -f docker-compose.staging.yml logs backend'"
fi
if curl -fsS --max-time 10 -o /dev/null "http://$STAGING_HOST:4102"; then
  echo "frontend: OK (http://$STAGING_HOST:4102)"
else
  health_failed=1
  echo "frontend: FAILED — logs: ssh $SSH_TARGET 'cd $REMOTE_DIR && docker compose -f docker-compose.staging.yml logs frontend'"
fi
if [ "$health_failed" -ne 0 ]; then
  echo "==> Deployment unhealthy — exiting nonzero"
  exit 1
fi
echo "==> Login: admin@segbytes.xyz / (segkeys/nexusemail/admin-password)"
