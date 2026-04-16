"""Database configuration and session management."""

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Local dev defaults to PostgreSQL; override with DATABASE_URL in .env (see .env.example).
_DEFAULT_DEV_DATABASE_URL = (
    "postgresql+psycopg2://postgres:postgres@127.0.0.1:5432/pharmacy_scheduler"
)
DATABASE_URL = os.getenv("DATABASE_URL", _DEFAULT_DEV_DATABASE_URL)

# For SQLite, use StaticPool to allow multiple threads
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
else:
    # For PostgreSQL and other databases
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Dependency for getting database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

