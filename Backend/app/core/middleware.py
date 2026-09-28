"""
Request timing, structured logging, and observability middleware.

Every request logs:
  - method, path, status code
  - total wall-clock time
  - a unique request_id (X-Request-ID header, or auto-generated)

Slow requests (> SLOW_REQUEST_THRESHOLD_MS) are logged at WARNING level
so they stand out in logs without needing a full APM setup.
"""
import logging
import time
import uuid
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

logger = logging.getLogger("app.timing")

SLOW_REQUEST_THRESHOLD_MS = 1000  # warn if any request takes longer than this


class TimingMiddleware(BaseHTTPMiddleware):
    """
    Adds X-Request-ID and X-Process-Time-Ms headers to every response,
    and logs a structured timing line for every request.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Accept or generate a request ID (useful for distributed tracing)
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())[:8]

        # Attach to request state so route handlers can reference it
        request.state.request_id = request_id

        t_start = time.perf_counter()
        response: Response = await call_next(request)
        elapsed_ms = (time.perf_counter() - t_start) * 1000

        response.headers["X-Request-ID"] = request_id
        response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.1f}"

        log_fn = logger.warning if elapsed_ms > SLOW_REQUEST_THRESHOLD_MS else logger.info
        log_fn(
            "[%s] %s %s → %d  %.1f ms",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )

        return response


class DBQueryLoggerMiddleware:
    """
    SQLAlchemy event listener that logs slow individual queries.
    Register via setup_query_logging() at app startup.
    """

    SLOW_QUERY_MS = 500

    @staticmethod
    def setup(engine) -> None:
        from sqlalchemy import event

        @event.listens_for(engine.sync_engine, "before_cursor_execute")
        def before_execute(conn, cursor, statement, parameters, context, executemany):
            conn.info["query_start"] = time.perf_counter()

        @event.listens_for(engine.sync_engine, "after_cursor_execute")
        def after_execute(conn, cursor, statement, parameters, context, executemany):
            start = conn.info.pop("query_start", None)
            if start is None:
                return
            elapsed_ms = (time.perf_counter() - start) * 1000
            if elapsed_ms > DBQueryLoggerMiddleware.SLOW_QUERY_MS:
                logger.warning(
                    "SLOW QUERY %.1f ms: %.120s",
                    elapsed_ms,
                    statement.replace("\n", " "),
                )
            else:
                logger.debug(
                    "query %.1f ms: %.80s",
                    elapsed_ms,
                    statement.replace("\n", " "),
                )
