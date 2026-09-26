"""
Declarative base shared by all models.
Import this in model files. Import `base_all` (below) only in Alembic env.py
so all models are registered for autogenerate — never in application code.
"""
from sqlalchemy.orm import DeclarativeBase, declared_attr
import re


class Base(DeclarativeBase):
    @declared_attr.directive
    def __tablename__(cls) -> str:  # noqa: N805
        name = re.sub(r"(?<!^)(?=[A-Z])", "_", cls.__name__).lower()
        return name + "s"
