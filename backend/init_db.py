"""Initialize database with default data."""

from backend.database import Base, engine, SessionLocal
from backend.models import User, LeaveType, EmployeeType, RequestStatus
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

        # Create default admin user
        admin_user = User(
            username="admin",
            password="admin123",  # In production, hash this!
            employee_name="Admin",
            employee_type=EmployeeType.MANAGER
        )
        db.add(admin_user)

        # Create default leave types
        default_leave_types = [
            LeaveType(
                code="DO",
                display_name="Day Off",
                description="Regular day off",
                color_hex="#90EE90",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="AL",
                display_name="Annual Leave",
                description="Annual vacation leave",
                color_hex="#FFD27F",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="ML",
                display_name="Maternity Leave",
                description="Maternity leave",
                color_hex="#DDA0DD",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="W",
                display_name="Workshop",
                description="Workshop or training",
                color_hex="#D8BFD8",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="UL",
                display_name="Unpaid Leave",
                description="Unpaid leave",
                color_hex="#F5F5F5",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="APP",
                display_name="Appointment",
                description="Medical or other appointment",
                color_hex="#FF6B6B",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="STL",
                display_name="Study Leave",
                description="Educational leave",
                color_hex="#B0E0E6",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="L",
                display_name="Leave",
                description="General leave",
                color_hex="#F5F5F5",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="O",
                display_name="Off",
                description="Off duty",
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

