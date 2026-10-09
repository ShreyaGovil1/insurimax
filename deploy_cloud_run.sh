#!/usr/bin/env bash
set -euo pipefail

# InsuriMax Google Cloud Run Deployment Script
# Usage: ./deploy_cloud_run.sh <PROJECT_ID> [REGION] [DATABASE_URL]

PROJECT_ID="${1:-}"
REGION="${2:-us-central1}"
DATABASE_URL="${3:-}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: ./deploy_cloud_run.sh <GCP_PROJECT_ID> [REGION] [DATABASE_URL]"
  exit 1
fi

echo "========================================="
echo "  InsuriMax Google Cloud Run Deployment  "
echo "========================================="
echo "Project ID : $PROJECT_ID"
echo "Region     : $REGION"

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
if ! gcloud artifacts repositories describe insurimax-repo --location="$REGION" &>/dev/null; then
  gcloud artifacts repositories create insurimax-repo \
    --repository-format=docker \
    --location="$REGION" \
    --description="InsuriMax Docker repository"
fi

REPO_PATH="$REGION-docker.pkg.dev/$PROJECT_ID/insurimax-repo"

# 4. Build & Deploy Backend
echo -e "\n[4/5] Building & Deploying Backend..."
gcloud builds submit ./Backend --tag "$REPO_PATH/backend:latest"

BACKEND_ENV="ENVIRONMENT=production,DEBUG=false,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=$REGION,VERTEX_AI_ENABLED=true,SECRET_KEY=prod-secret-$(date +%s),CORS_ORIGINS=*,DB_SSL=true"
if [[ -n "$DATABASE_URL" ]]; then
  BACKEND_ENV="$BACKEND_ENV,DATABASE_URL=$DATABASE_URL"
fi

gcloud run deploy insurimax-backend \
  --image "$REPO_PATH/backend:latest" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --set-env-vars "$BACKEND_ENV"

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
  --update-env-vars "CORS_ORIGINS=$FRONTEND_URL"

echo -e "\n========================================================"
echo " 🎉 Deployment Complete!"
echo " 🌐 Frontend URL : $FRONTEND_URL"
echo " ⚙️ Backend API  : $BACKEND_URL"
echo " 📖 Swagger Docs : $BACKEND_URL/docs"
echo "========================================================"
