# Database Setup Guide

This guide explains how to set up and migrate to the database-backed system.

## Prerequisites

1. Install database dependencies:
```bash
pip install -r requirements.txt
```

2. For PostgreSQL (recommended for production):
   - Install PostgreSQL
   - Create a database: `createdb roster_db`
   - Set environment variable: `export DATABASE_URL=postgresql://user:password@localhost/roster_db`

3. For SQLite (default, good for development):
   - No setup needed, will use `roster.db` in the project root

## Initial Setup

1. **Initialize the database** (creates tables and default data):
```bash
python3 -m backend.init_db
```

This will:
- Create all database tables
- Create default admin user (username: `admin`, password: `admin123`)
- Create default leave types (DO, AL, ML, W, UL, APP, STL, L, O)

2. **Run migrations** (if using Alembic):
```bash
# Create initial migration
alembic revision --autogenerate -m "Initial migration"

# Apply migrations
alembic upgrade head
```

## Migrating Existing Data

To migrate existing JSON data to the database:

```bash
python3 -m backend.migrate_from_json
```

This will migrate:
- Users from `roster/app/data/user_data.json`
- Leave requests from `roster/app/data/staff_requests.json`
- Shift requests from `roster/app/data/staff_requests.json`

## Environment Variables

Set `DATABASE_URL` to use a different database:
- SQLite (default): `sqlite:///./roster.db`
- PostgreSQL: `postgresql://user:password@localhost/dbname`
- MySQL: `mysql://user:password@localhost/dbname`

## Production Deployment

1. Use PostgreSQL for production
2. Set strong passwords for database users
3. Use environment variables for `DATABASE_URL` (never commit credentials)
4. Run migrations before starting the application
5. Backup the database regularly

## Notes

- The system currently supports both JSON and database backends
- During migration, both systems can coexist
- Once fully migrated, JSON files can be archived as backups

