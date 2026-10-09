"""
Central v1 API router — assembles all route modules.
"""
from fastapi import APIRouter

from app.api.v1.routes import (
    admin,
    adjudication,
    analytics,
    auth,
    claims,
    documents,
    hospital,
    patient,
    policies,
    queries,
)

api_router = APIRouter(prefix="/api/v1")

# Auth & Users
api_router.include_router(auth.router)
api_router.include_router(auth.users_router)

# Admin panel
api_router.include_router(admin.router)

# Core claim workflow
api_router.include_router(claims.router)
api_router.include_router(documents.router)
api_router.include_router(adjudication.router)

# Policy library
api_router.include_router(policies.router)

# Workflow support
api_router.include_router(queries.router)

# Hospital & patient portals
api_router.include_router(hospital.router)
api_router.include_router(patient.router)

# Analytics, compliance, admin, webhooks
api_router.include_router(analytics.router)
