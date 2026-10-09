<#
.SYNOPSIS
    Automated Google Cloud Run deployment script for InsuriMax (PowerShell).
.DESCRIPTION
    Builds and deploys Backend and Frontend images to Google Cloud Run using Google Cloud Build.
.EXAMPLE
    .\deploy_cloud_run.ps1 -ProjectId "my-gcp-project-123" -Region "us-central1" -DatabaseUrl "postgresql://user:pass@host:5432/db"
#>
param(
    [Parameter(Mandatory=$true, HelpMessage="Your Google Cloud Project ID")]
    [string]$ProjectId,

    [Parameter(Mandatory=$false)]
    [string]$Region = "us-central1",

    [Parameter(Mandatory=$false)]
    [string]$DatabaseUrl = "",

    [Parameter(Mandatory=$false)]
    [string]$SecretKey = "insurimax-production-secret-key-$(Get-Random)"
)

$ErrorActionPreference = "Stop"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  InsuriMax Google Cloud Run Deployment  " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Project ID : $ProjectId"
Write-Host "Region     : $Region"

# 1. Configure Project
Write-Host "`n[1/5] Configuring gcloud project..." -ForegroundColor Yellow
gcloud config set project $ProjectId

# 2. Enable APIs
Write-Host "`n[2/5] Enabling required Google Cloud APIs..." -ForegroundColor Yellow
gcloud services enable `
    run.googleapis.com `
    artifactregistry.googleapis.com `
    cloudbuild.googleapis.com `
    aiplatform.googleapis.com

# 3. Create Artifact Registry repository if not exists
Write-Host "`n[3/5] Checking Artifact Registry repository 'insurimax-repo'..." -ForegroundColor Yellow
$repoExists = gcloud artifacts repositories describe insurimax-repo --location=$Region 2>$null
if (-not $repoExists) {
    Write-Host "Creating repository..."
    gcloud artifacts repositories create insurimax-repo `
        --repository-format=docker `
        --location=$Region `
        --description="InsuriMax Docker repository"
} else {
    Write-Host "Repository 'insurimax-repo' already exists." -ForegroundColor Green
}

$repoPath = "$Region-docker.pkg.dev/$ProjectId/insurimax-repo"

# 4. Build & Deploy Backend
Write-Host "`n[4/5] Building & Deploying Backend to Cloud Run..." -ForegroundColor Yellow
gcloud builds submit ./Backend --tag "$repoPath/backend:latest"

$backendEnvVars = "ENVIRONMENT=production,DEBUG=false,GOOGLE_CLOUD_PROJECT=$ProjectId,GOOGLE_CLOUD_LOCATION=$Region,VERTEX_AI_ENABLED=true,SECRET_KEY=$SecretKey,CORS_ORIGINS=*,DB_SSL=true"
if ($DatabaseUrl) {
    $backendEnvVars += ",DATABASE_URL=$DatabaseUrl"
}

gcloud run deploy insurimax-backend `
    --image "$repoPath/backend:latest" `
    --region $Region `
    --platform managed `
    --allow-unauthenticated `
    --memory 2Gi `
    --cpu 2 `
    --set-env-vars $backendEnvVars

$backendUrl = gcloud run services describe insurimax-backend --region $Region --format="value(status.url)"
Write-Host "`nBackend successfully deployed at: $backendUrl" -ForegroundColor Green

# 5. Build & Deploy Frontend
Write-Host "`n[5/5] Building & Deploying Frontend to Cloud Run..." -ForegroundColor Yellow
gcloud builds submit ./Frontend --tag "$repoPath/frontend:latest"

$frontendApiUrl = "$backendUrl/api/v1"
gcloud run deploy insurimax-frontend `
    --image "$repoPath/frontend:latest" `
    --region $Region `
    --platform managed `
    --allow-unauthenticated `
    --memory 512Mi `
    --cpu 1 `
    --set-env-vars "VITE_API_URL=$frontendApiUrl"

$frontendUrl = gcloud run services describe insurimax-frontend --region $Region --format="value(status.url)"

# 6. Restrict CORS to frontend domain
Write-Host "`nSecuring Backend CORS origins to $frontendUrl..." -ForegroundColor Yellow
gcloud run services update insurimax-backend `
    --region $Region `
    --update-env-vars "CORS_ORIGINS=$frontendUrl"

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host " 🎉 InsuriMax successfully deployed to Google Cloud Run!" -ForegroundColor Green
Write-Host " 🌐 Frontend URL : $frontendUrl" -ForegroundColor Cyan
Write-Host " ⚙️ Backend API  : $backendUrl" -ForegroundColor Cyan
Write-Host " 📖 Swagger Docs : $backendUrl/docs" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Green
