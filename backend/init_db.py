"""Initialize database with default data."""

from backend.database import Base, engine, SessionLocal
from backend.models import User, LeaveType, EmployeeType, RequestStatus
from backend.utils import hash_password
from sqlalchemy.orm import Session


def init_db():
    """Initialize database tables and default data."""
    # Create all tables
    Base.metadata.create_all(bind=engine)

    db: Session = SessionLocal()
    try:
        # Check if database is already initialized
        if db.query(User).first() is not None:
            print("Database already initialized. Skipping...")
            return

        # Create default admin user (password is hashed)
        admin_password = "admin123"
        admin_user = User(
            username="admin",
            password=hash_password(admin_password),
            employee_name="Admin",
            employee_type=EmployeeType.MANAGER
        )
        db.add(admin_user)

        # Create default leave types
        default_leave_types = [
            LeaveType(
                code="DO",
                description="Day Off",
                color_hex="#90EE90",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="AL",
                description="Annual Leave",
                color_hex="#FFD27F",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="ML",
                description="Maternity Leave",
                color_hex="#DDA0DD",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="W",
                description="Workshop",
                color_hex="#D8BFD8",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="UL",
                description="Unpaid Leave",
                color_hex="#F5F5F5",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="APP",
                description="Appointment",
                color_hex="#FF6B6B",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="STL",
                description="Study Leave",
                color_hex="#B0E0E6",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="L",
                description="Leave",
                color_hex="#F5F5F5",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="O",
                description="Off Duty",
                color_hex="#E6F3FF",
                counts_as_rest=True,
                is_active=True
            ),
        ]

        for leave_type in default_leave_types:
            db.add(leave_type)

        db.commit()
        print("✅ Database initialized successfully!")
        print("   - Default admin user created (username: admin, password: admin123)")
        print("   - Default leave types created")
    except Exception as e:
        db.rollback()
        print(f"❌ Error initializing database: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    init_db()

