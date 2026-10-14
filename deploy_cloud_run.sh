#!/usr/bin/env bash
set -euo pipefail

# InsuriMax Google Cloud Run Deployment Script
# Usage: ./deploy_cloud_run.sh [PROJECT_ID] [REGION] [DATABASE_URL]

PROJECT_ID="${1:-insurimax-511211}"
REGION="${2:-asia-south1}"
DATABASE_URL="${3:-}"

# Load defaults from Backend/.env if available
ENV_FILE="$(dirname "$0")/Backend/.env"
GCS_BUCKET_NAME="insurimax-data-01"
GOOGLE_API_KEY=""
GEMINI_MODEL="gemini-2.5-flash"
GEMINI_FLASH_MODEL="gemini-2.5-flash"

if [[ -f "$ENV_FILE" ]]; then
  echo "Reading defaults from Backend/.env..."
  while IFS='=' read -r key val || [[ -n "$key" ]]; do
    key=$(echo "$key" | tr -d '[:space:]')
    val=$(echo "$val" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
    [[ "$key" =~ ^#.* ]] && continue
    [[ -z "$key" ]] && continue
    if [[ "$key" == "DATABASE_URL" && -z "$DATABASE_URL" ]]; then DATABASE_URL="$val"; fi
    if [[ "$key" == "GCS_BUCKET_NAME" ]]; then GCS_BUCKET_NAME="$val"; fi
    if [[ "$key" == "GOOGLE_API_KEY" ]]; then GOOGLE_API_KEY="$val"; fi
  done < "$ENV_FILE"
fi

echo "========================================="
echo "  InsuriMax Google Cloud Run Deployment  "
echo "========================================="
echo "Project ID  : $PROJECT_ID"
echo "Region      : $REGION"
echo "GCS Bucket  : $GCS_BUCKET_NAME"

# 1. Set Project
echo -e "\n[1/5] Configuring gcloud project..."
gcloud config set project "$PROJECT_ID"

# 2. Enable APIs
echo -e "\n[2/5] Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  aiplatform.googleapis.com

# 3. Create Artifact Registry repository if missing
echo -e "\n[3/5] Setting up Artifact Registry repository 'insurimax-repo'..."
if ! gcloud artifacts repositories list --location="$REGION" --format="value(name)" --filter="name:insurimax-repo" | grep -q "insurimax-repo"; then
  gcloud artifacts repositories create insurimax-repo \
    --repository-format=docker \
    --location="$REGION" \
    --description="InsuriMax Docker repository"
fi

REPO_PATH="$REGION-docker.pkg.dev/$PROJECT_ID/insurimax-repo"

# 4. Build & Deploy Backend
echo -e "\n[4/5] Building & Deploying Backend..."
gcloud builds submit ./Backend --tag "$REPO_PATH/backend:latest"

if [[ -f "$(dirname "$0")/Backend/env.cloudrun.yaml" ]]; then
  gcloud run deploy insurimax-backend \
    --image "$REPO_PATH/backend:latest" \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --memory 2Gi \
    --cpu 2 \
    --timeout 300 \
    --env-vars-file "$(dirname "$0")/Backend/env.cloudrun.yaml"
else
  BACKEND_ENV="ENVIRONMENT=production,DEBUG=false,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=$REGION,VERTEX_AI_ENABLED=true,SECRET_KEY=prod-secret-$(date +%s),CORS_ORIGINS=*,DB_SSL=false,GCS_BUCKET_NAME=$GCS_BUCKET_NAME,GEMINI_MODEL=$GEMINI_MODEL,GEMINI_FLASH_MODEL=$GEMINI_FLASH_MODEL"
  if [[ -n "$DATABASE_URL" ]]; then
    BACKEND_ENV="$BACKEND_ENV,DATABASE_URL=$DATABASE_URL"
  fi
  if [[ -n "$GOOGLE_API_KEY" ]]; then
    BACKEND_ENV="$BACKEND_ENV,GOOGLE_API_KEY=$GOOGLE_API_KEY"
  fi

  gcloud run deploy insurimax-backend \
    --image "$REPO_PATH/backend:latest" \
    --region "$REGION" \
    --platform managed \
    --allow-unauthenticated \
    --memory 2Gi \
    --cpu 2 \
    --timeout 300 \
    --set-env-vars "$BACKEND_ENV"
fi

BACKEND_URL="$(gcloud run services describe insurimax-backend --region "$REGION" --format="value(status.url)")"
echo "Backend deployed at: $BACKEND_URL"

# 5. Build & Deploy Frontend
echo -e "\n[5/5] Building & Deploying Frontend..."
gcloud builds submit ./Frontend --tag "$REPO_PATH/frontend:latest"

gcloud run deploy insurimax-frontend \
  --image "$REPO_PATH/frontend:latest" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --set-env-vars "VITE_API_URL=$BACKEND_URL/api/v1"

FRONTEND_URL="$(gcloud run services describe insurimax-frontend --region "$REGION" --format="value(status.url)")"

# 6. Secure CORS
echo -e "\nRestricting Backend CORS to $FRONTEND_URL..."
gcloud run services update insurimax-backend \
  --region "$REGION" \
  --update-env-vars "CORS_ORIGINS=$FRONTEND_URL,http://localhost:5173,http://localhost:3000"

echo -e "\n========================================================"
echo " 🎉 Deployment Complete!"
echo " 🌐 Frontend URL : $FRONTEND_URL"
echo " ⚙️ Backend API  : $BACKEND_URL"
echo " 📖 Swagger Docs : $BACKEND_URL/docs"
echo "========================================================"
