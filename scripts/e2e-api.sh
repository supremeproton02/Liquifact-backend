#!/bin/bash

# Liquifact Backend E2E Smoke Test Orchestrator
# Requirements: docker, docker-compose, node, npm

set -e

# Configuration
COMPOSE_FILE="docker-compose.e2e.yml"
API_HEALTH_URL="http://localhost:3001/health"
MAX_WAIT_SECONDS=60

# Cleanup function to be called on script exit
cleanup() {
  echo "Cleaning up containers..."
  docker compose -f $COMPOSE_FILE down -v
}

# Register the cleanup function
trap cleanup EXIT

echo "🚀 Starting E2E environment..."
docker compose -f $COMPOSE_FILE up -d --build

echo "⏳ Waiting for API to be healthy..."
START_TIME=$(date +%s)
until $(curl --output /dev/null --silent --head --fail $API_HEALTH_URL); do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    
    if [ $ELAPSED -gt $MAX_WAIT_SECONDS ]; then
      echo "❌ Timeout waiting for API to become healthy after ${MAX_WAIT_SECONDS}s"
      docker compose -f $COMPOSE_FILE logs api
      exit 1
    fi
    
    printf "."
    sleep 2
done
echo " ✅ API is healthy!"

echo "🧪 Running E2E smoke tests..."
# Pass the JWT secret to the tests so they can generate valid tokens
export JWT_SECRET="supersecret-test-token-key-32-chars-long"
npm run test:e2e

echo "🎉 E2E Smoke Tests Passed Successfully!"
