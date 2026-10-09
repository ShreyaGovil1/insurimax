"""
OpenTelemetry setup for Insurimax.

Instruments:
  - FastAPI   → HTTP server spans (method, route, status, latency)
  - SQLAlchemy → DB spans (query text, latency per statement)
  - httpx      → outbound HTTP spans (GCS, Gemini REST calls)
  - Logging    → injects trace_id / span_id into every log record

Exporters (controlled by settings.OTEL_EXPORTER):
  "gcp"     → Google Cloud Trace  (production on Cloud Run)
  "otlp"    → Any OTLP receiver   (Grafana Cloud, Jaeger, Honeycomb, etc.)
  "console" → Pretty-print to stdout (local dev / debugging)
  "none"    → Disabled

Usage:
    from app.core.telemetry import setup_telemetry, get_tracer
    setup_telemetry(app)          # call once in main.py lifespan
    tracer = get_tracer(__name__) # get a tracer in any module
"""
import logging
from typing import TYPE_CHECKING

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource, SERVICE_NAME, SERVICE_VERSION
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    ConsoleSpanExporter,
    SimpleSpanProcessor,
)
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased, ParentBased

if TYPE_CHECKING:
    from fastapi import FastAPI

logger = logging.getLogger(__name__)


def setup_telemetry(app: "FastAPI") -> TracerProvider | None:
    """
    Initialise OpenTelemetry and auto-instrument FastAPI, SQLAlchemy, httpx.
    Call once during app lifespan startup. Returns the TracerProvider (or None
    if OTEL_EXPORTER=none).
    """
    from app.core.config import settings

    if settings.OTEL_EXPORTER == "none":
        logger.info("Telemetry disabled (OTEL_EXPORTER=none)")
        return None

    # ── Resource (service metadata shown in Cloud Trace / Grafana) ────────────
    resource = Resource.create({
        SERVICE_NAME: settings.OTEL_SERVICE_NAME,
        SERVICE_VERSION: settings.OTEL_SERVICE_VERSION,
        "deployment.environment": settings.ENVIRONMENT,
        "service.namespace": "insurimax",
    })

    # ── Sampler ───────────────────────────────────────────────────────────────
    # ParentBased: respect upstream sampling decisions (important for Cloud Run)
    sampler = ParentBased(root=TraceIdRatioBased(settings.OTEL_SAMPLE_RATE))

    # ── Provider ──────────────────────────────────────────────────────────────
    provider = TracerProvider(resource=resource, sampler=sampler)

    # ── Exporter ──────────────────────────────────────────────────────────────
    exporter_name = settings.OTEL_EXPORTER.lower()

    if exporter_name == "gcp":
        _add_gcp_exporter(provider)
    elif exporter_name == "otlp":
        _add_otlp_exporter(provider, settings.OTEL_EXPORTER_OTLP_ENDPOINT)
    elif exporter_name == "console":
        _add_console_exporter(provider)
    else:
        logger.warning("Unknown OTEL_EXPORTER=%s, falling back to console", exporter_name)
        _add_console_exporter(provider)

    # ── Register as global provider ───────────────────────────────────────────
    trace.set_tracer_provider(provider)

    # ── Auto-instrument libraries ─────────────────────────────────────────────
    _instrument_fastapi(app)
    _instrument_sqlalchemy()
    _instrument_httpx()
    _instrument_logging()

    logger.info(
        "OpenTelemetry configured — exporter=%s service=%s sample_rate=%.0f%%",
        exporter_name,
        settings.OTEL_SERVICE_NAME,
        settings.OTEL_SAMPLE_RATE * 100,
    )
    return provider


# ── Exporter helpers ──────────────────────────────────────────────────────────

def _add_gcp_exporter(provider: TracerProvider) -> None:
    """Google Cloud Trace exporter — uses ADC (Application Default Credentials)."""
    try:
        from opentelemetry.exporter.gcp.trace import CloudTraceSpanExporter  # type: ignore
        exporter = CloudTraceSpanExporter()
        provider.add_span_processor(BatchSpanProcessor(exporter))
        logger.info("Telemetry: Google Cloud Trace exporter registered")
    except ImportError:
        logger.warning(
            "opentelemetry-exporter-gcp-trace not installed — falling back to console"
        )
        _add_console_exporter(provider)
    except Exception as exc:
        logger.warning("GCP trace exporter failed (%s) — falling back to console", exc)
        _add_console_exporter(provider)


def _add_otlp_exporter(provider: TracerProvider, endpoint: str) -> None:
    """OTLP/gRPC exporter — works with Grafana Cloud, Jaeger, Honeycomb, etc."""
    try:
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (  # type: ignore
            OTLPSpanExporter,
        )
        exporter = OTLPSpanExporter(endpoint=endpoint, insecure=endpoint.startswith("http://"))
        provider.add_span_processor(BatchSpanProcessor(exporter))
        logger.info("Telemetry: OTLP exporter → %s", endpoint)
    except ImportError:
        logger.warning("opentelemetry-exporter-otlp-proto-grpc not installed")
        _add_console_exporter(provider)


def _add_console_exporter(provider: TracerProvider) -> None:
    """Pretty-print spans to stdout — useful for local debugging."""
    exporter = ConsoleSpanExporter()
    # SimpleSpanProcessor for console (synchronous, fine for dev)
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    logger.info("Telemetry: Console exporter registered (local dev mode)")


# ── Instrumentation helpers ───────────────────────────────────────────────────

def _instrument_fastapi(app: "FastAPI") -> None:
    """Instrument FastAPI — creates a span per request with route, method, status."""
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor  # type: ignore
        FastAPIInstrumentor.instrument_app(
            app,
            excluded_urls="health,ready,docs,redoc,openapi.json",
            http_capture_headers_server_request=["x-request-id"],
            http_capture_headers_server_response=["x-process-time-ms", "x-request-id"],
        )
        logger.debug("OTEL: FastAPI instrumented")
    except Exception as exc:
        logger.warning("FastAPI OTEL instrumentation failed: %s", exc)


def _instrument_sqlalchemy() -> None:
    """Instrument SQLAlchemy — creates a child span per DB statement."""
    try:
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor  # type: ignore
        from app.db.session import engine
        SQLAlchemyInstrumentor().instrument(
            engine=engine.sync_engine,
            # Capture query params in span attributes (disable in production for PII)
            enable_commenter=True,
        )
        logger.debug("OTEL: SQLAlchemy instrumented")
    except Exception as exc:
        logger.warning("SQLAlchemy OTEL instrumentation failed: %s", exc)


def _instrument_httpx() -> None:
    """Instrument outbound httpx calls — traces GCS/Gemini HTTP requests."""
    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor  # type: ignore
        HTTPXClientInstrumentor().instrument()
        logger.debug("OTEL: httpx instrumented")
    except Exception as exc:
        logger.warning("httpx OTEL instrumentation failed: %s", exc)


def _instrument_logging() -> None:
    """Inject trace_id and span_id into every Python log record."""
    try:
        from opentelemetry.instrumentation.logging import LoggingInstrumentor  # type: ignore
        LoggingInstrumentor().instrument(set_logging_format=True)
        logger.debug("OTEL: logging instrumented")
    except Exception as exc:
        logger.warning("Logging OTEL instrumentation failed: %s", exc)


# ── Manual span helpers ───────────────────────────────────────────────────────

def get_tracer(name: str) -> trace.Tracer:
    """
    Get a tracer for manual instrumentation in service/route code.

    Usage:
        tracer = get_tracer(__name__)

        async def run_adjudication(...):
            with tracer.start_as_current_span("adjudication.gemini_call") as span:
                span.set_attribute("claim.id", str(claim_id))
                span.set_attribute("model", settings.GEMINI_MODEL)
                result = await generate_json(prompt)
                span.set_attribute("tokens.prompt", result[1])
    """
    return trace.get_tracer(name)


def add_span_attributes(**attrs: str | int | float | bool) -> None:
    """
    Convenience: add attributes to the current active span from anywhere.

    Usage:
        add_span_attributes(claim_id=str(claim_id), user_role=user.role.value)
    """
    span = trace.get_current_span()
    if span and span.is_recording():
        for key, value in attrs.items():
            span.set_attribute(key, value)


def record_exception(exc: Exception, reraise: bool = True) -> None:
    """Record an exception on the current span, then optionally re-raise."""
    span = trace.get_current_span()
    if span and span.is_recording():
        span.record_exception(exc)
        from opentelemetry.trace import StatusCode
        span.set_status(StatusCode.ERROR, str(exc))
    if reraise:
        raise exc
