# 🚀 InsuriMax Google Cloud Run Deployment Guide

This guide contains complete, step-by-step instructions to deploy both the **Backend (FastAPI)** and **Frontend (React + Vite + Nginx)** container images to **Google Cloud Run**.

---

## 📋 Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Step 1: Set Up GCP Project & Enable APIs](#step-1-set-up-gcp-project--enable-apis)
3. [Step 2: Create Artifact Registry Repository](#step-2-create-artifact-registry-repository)
4. [Step 3: Deploy the Backend Service](#step-3-deploy-the-backend-service)
5. [Step 4: Deploy the Frontend Service](#step-4-deploy-the-frontend-service)
6. [Step 5: Configure Production CORS](#step-5-configure-production-cors)
7. [Step 6: Running Database Migrations / Seeding](#step-6-running-database-migrations--seeding)
8. [Useful Troubleshooting & Monitoring Commands](#useful-troubleshooting--monitoring-commands)
9. [Deploying with GitHub Actions](#deploying-with-github-actions)

---

## 1. Prerequisites

1. **Google Cloud Account**: A GCP account with billing enabled.
2. **Google Cloud CLI (`gcloud`)**: Installed and initialized on your computer.
   - [Download gcloud CLI](https://cloud.google.com/sdk/docs/install)
3. **Database**: A PostgreSQL database accessible from Cloud Run (e.g. Supabase, Neon, or Google Cloud SQL).

---

## Step 1: Set Up GCP Project & Enable APIs

Open your terminal or PowerShell and authenticate:

```bash
# 1. Log in to your Google Cloud account
gcloud auth login

# 2. Set your Google Cloud Project ID and Region
export GCP_PROJECT_ID="insurimax-511211"
export REGION="asia-south1"

gcloud config set project $GCP_PROJECT_ID

# 3. Enable required Google Cloud service APIs
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  aiplatform.googleapis.com \
  secretmanager.googleapis.com
```

*For Windows PowerShell:*
```powershell
$env:GCP_PROJECT_ID = "insurimax-511211"
$env:REGION = "asia-south1"
gcloud config set project $env:GCP_PROJECT_ID

gcloud services enable `
  run.googleapis.com `
  artifactregistry.googleapis.com `
  cloudbuild.googleapis.com `
  aiplatform.googleapis.com `
  secretmanager.googleapis.com
```

---

## Step 2: Create Artifact Registry Repository

Create a Docker repository in Google Artifact Registry to store your container images:

```bash
gcloud artifacts repositories create insurimax-repo \
  --repository-format=docker \
  --location=$REGION \
  --description="InsuriMax Docker Container Repository"
```

*For Windows PowerShell:*
```powershell
gcloud artifacts repositories create insurimax-repo `
  --repository-format=docker `
  --location=$env:REGION `
  --description="InsuriMax Docker Container Repository"
```

---

## Step 3: Deploy the Backend Service

### A. Build and Push the Backend Image
You can build the image directly in the cloud with **Google Cloud Build** (no local Docker required):

```bash
# Run from repository root
gcloud builds submit ./Backend \
  --tag $REGION-docker.pkg.dev/$GCP_PROJECT_ID/insurimax-repo/backend:latest
```

*For Windows PowerShell:*
```powershell
gcloud builds submit ./Backend `
  --tag "$($env:REGION)-docker.pkg.dev/$($env:GCP_PROJECT_ID)/insurimax-repo/backend:latest"
```

### B. Deploy Backend to Cloud Run
You can use `--env-vars-file Backend/env.cloudrun.yaml` which automatically loads all required variables from your `.env`:

```bash
gcloud run deploy insurimax-backend \
  --image $REGION-docker.pkg.dev/$GCP_PROJECT_ID/insurimax-repo/backend:latest \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --set-env-vars "\
ENVIRONMENT=production,\
DEBUG=false,\
GOOGLE_CLOUD_PROJECT=$GCP_PROJECT_ID,\
GOOGLE_CLOUD_LOCATION=$REGION,\
VERTEX_AI_ENABLED=true,\
SECRET_KEY=$(openssl rand -hex 32),\
DATABASE_URL=postgresql://user:password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres,\
DB_SSL=true,\
CORS_ORIGINS=*"
```

*For Windows PowerShell:*
```powershell
# Random 32-byte JWT signing key (hex)
$keyBytes = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($keyBytes)
$secretKey = -join ($keyBytes | ForEach-Object { $_.ToString("x2") })

gcloud run deploy insurimax-backend `
  --image "$($env:REGION)-docker.pkg.dev/$($env:GCP_PROJECT_ID)/insurimax-repo/backend:latest" `
  --region $env:REGION `
  --platform managed `
  --allow-unauthenticated `
  --memory 2Gi `
  --cpu 2 `
  --timeout 300 `
  --set-env-vars "ENVIRONMENT=production,DEBUG=false,GOOGLE_CLOUD_PROJECT=$env:GCP_PROJECT_ID,GOOGLE_CLOUD_LOCATION=$env:REGION,VERTEX_AI_ENABLED=true,SECRET_KEY=change-to-a-secure-random-32-char-string,DATABASE_URL=postgresql://user:password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres,DB_SSL=true,CORS_ORIGINS=*"
```

> **Note:** Once deployed, Google Cloud Run will output your Backend URL, for example:
> `Service URL: https://insurimax-backend-xxxxxxxx-uc.a.run.app`
> **Copy this URL** for the next step!

---

## Step 4: Deploy the Frontend Service

### A. Build and Push the Frontend Image

```bash
# Run from repository root
gcloud builds submit ./Frontend \
  --tag $REGION-docker.pkg.dev/$GCP_PROJECT_ID/insurimax-repo/frontend:latest
```

*For Windows PowerShell:*
```powershell
gcloud builds submit ./Frontend `
  --tag "$($env:REGION)-docker.pkg.dev/$($env:GCP_PROJECT_ID)/insurimax-repo/frontend:latest"
```

### B. Deploy Frontend to Cloud Run
Inject the Backend URL using the `VITE_API_URL` environment variable:

```bash
# Set your Backend Cloud Run URL (with /api/v1 appended)
export BACKEND_API_URL="https://insurimax-backend-xxxxxxxx-uc.a.run.app/api/v1"

gcloud run deploy insurimax-frontend \
  --image $REGION-docker.pkg.dev/$GCP_PROJECT_ID/insurimax-repo/frontend:latest \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --set-env-vars "VITE_API_URL=$BACKEND_API_URL"
```

*For Windows PowerShell:*
```powershell
$env:BACKEND_API_URL = "https://insurimax-backend-xxxxxxxx-uc.a.run.app/api/v1"

gcloud run deploy insurimax-frontend `
  --image "$($env:REGION)-docker.pkg.dev/$($env:GCP_PROJECT_ID)/insurimax-repo/frontend:latest" `
  --region $env:REGION `
  --platform managed `
  --allow-unauthenticated `
  --memory 512Mi `
  --cpu 1 `
  --set-env-vars "VITE_API_URL=$env:BACKEND_API_URL"
```

> **Note:** Once deployed, Cloud Run will output your Frontend URL, for example:
> `Service URL: https://insurimax-frontend-xxxxxxxx-uc.a.run.app`

---

## Step 5: Configure Production CORS

For production security, restrict backend CORS to only allow your frontend domain:

```bash
export FRONTEND_URL="https://insurimax-frontend-xxxxxxxx-uc.a.run.app"

gcloud run services update insurimax-backend \
  --region $REGION \
  --update-env-vars "CORS_ORIGINS=$FRONTEND_URL"
```

*For Windows PowerShell:*
```powershell
$env:FRONTEND_URL = "https://insurimax-frontend-xxxxxxxx-uc.a.run.app"

gcloud run services update insurimax-backend `
  --region $env:REGION `
  --update-env-vars "CORS_ORIGINS=$env:FRONTEND_URL"
```

---

## Step 6: Running Database Migrations / Seeding

You can execute database migrations or seed demo data in one of two ways:

### Option A: From your local machine (recommended)
Make sure your local `.env` has the production `DATABASE_URL`, then run:
```bash
cd Backend
uv run alembic upgrade head
uv run python seed_db.py
```

### Option B: Cloud Run Job
Execute as a one-off Cloud Run job:
```bash
gcloud run jobs create insurimax-migrate \
  --image $REGION-docker.pkg.dev/$GCP_PROJECT_ID/insurimax-repo/backend:latest \
  --region $REGION \
  --command alembic \
  --args "upgrade","head" \
  --set-env-vars "DATABASE_URL=postgresql://user:password@host:5432/postgres,DB_SSL=true"

gcloud run jobs execute insurimax-migrate --region $REGION --wait
```

---

## Useful Troubleshooting & Monitoring Commands

### 1. View Live Container Logs
```bash
# View Backend logs
gcloud run services logs tail insurimax-backend --region us-central1

# View Frontend logs
gcloud run services logs tail insurimax-frontend --region us-central1
```

### 2. Check Service Details & URL
```bash
gcloud run services describe insurimax-backend --region us-central1 --format="value(status.url)"
gcloud run services describe insurimax-frontend --region us-central1 --format="value(status.url)"
```

### 3. Update Environment Variables without Rebuilding
```bash
# Update backend secret or model
gcloud run services update insurimax-backend \
  --region us-central1 \
  --update-env-vars "GEMINI_MODEL=gemini-1.5-pro-002"

# Update frontend target API URL
gcloud run services update insurimax-frontend \
  --region us-central1 \
  --update-env-vars "VITE_API_URL=https://new-backend-url.a.run.app/api/v1"
```

---

## 🐳 Optional: Local Testing with Docker Compose
To test the complete containerized stack locally before deploying to GCP:
```bash
docker compose up --build
```
- **Frontend**: http://localhost:8080
- **Backend API**: http://localhost:8000
- **GCS Emulator**: http://localhost:4443

---

## Deploying with GitHub Actions

`.github/workflows/deploy-gcp.yml` deploys on every push to `main` (or manually from **Actions → Deploy to Google Cloud → Run workflow**). It runs the frontend tests and a backend startup check, builds both images, pushes them to Artifact Registry tagged with the commit SHA, runs `alembic upgrade head`, deploys the backend and the frontend, then restricts the backend's CORS to the frontend URL.

GitHub signs in to Google Cloud with **Workload Identity Federation**, so no service-account key is stored in GitHub. Do the one-time setup below once per project.

### 1. Store the backend secrets in Secret Manager

```bash
export PROJECT_ID="insurimax-511211"
export REGION="asia-south1"
export REPO="siddharth329/insurimax"   # GitHub owner/repo

gcloud services enable secretmanager.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

# JWT signing key: random, 32+ bytes (the backend refuses to start with a weak key)
python3 -c 'import secrets; print(secrets.token_urlsafe(64), end="")' | \
  gcloud secrets create insurimax-secret-key --data-file=-

# Database connection string
printf '%s' 'postgresql+asyncpg://USER:PASSWORD@HOST:5432/DBNAME' | \
  gcloud secrets create insurimax-database-url --data-file=-
```

### 2. Create the service accounts

```bash
# Used by GitHub Actions to build and deploy
gcloud iam service-accounts create github-deployer --display-name="GitHub Actions deployer"
DEPLOYER="github-deployer@$PROJECT_ID.iam.gserviceaccount.com"
for role in roles/run.admin roles/artifactregistry.admin roles/iam.serviceAccountUser roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOYER" --role="$role"
done

# Used by the backend at runtime (Vertex AI, document storage, secrets)
gcloud iam service-accounts create insurimax-backend --display-name="InsuriMax backend runtime"
RUNTIME="insurimax-backend@$PROJECT_ID.iam.gserviceaccount.com"
for role in roles/aiplatform.user roles/storage.objectAdmin roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUNTIME" --role="$role"
done
```

### 3. Let the GitHub repository impersonate the deployer

```bash
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers create-oidc github \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '$REPO'"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

echo "GCP_WIF_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github"
```

### 4. Add the repository variables in GitHub

In **Settings → Secrets and variables → Actions → Variables**, add:

| Variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | `insurimax-511211` |
| `GCP_REGION` | `asia-south1` (optional; this is the default) |
| `GCP_WIF_PROVIDER` | the value printed at the end of step 3 |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `github-deployer@insurimax-511211.iam.gserviceaccount.com` |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | `insurimax-backend@insurimax-511211.iam.gserviceaccount.com` |
| `GCS_BUCKET_NAME` | `insurimax-data-01` |
| `DB_SSL` | `true` (optional; this is the default) |

The workflow uses a GitHub **environment** named `production`. Create it under **Settings → Environments** if you want to require an approval before each deploy.

> The deploy never sets `VITE_DEMO_PERSONAS`, so the demo sign-in buttons stay out of the public frontend.
