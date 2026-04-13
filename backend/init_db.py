"""Initialize database with default data."""

from backend.database import Base, engine, SessionLocal
from backend.models import User, LeaveType, ShiftType, EmployeeType, RequestStatus, EmployeeSkills
from backend.utils import hash_password
from sqlalchemy.orm import Session
from pathlib import Path
import shutil


def init_db():
    """Initialize database tables and default data."""
    # Create all tables
    Base.metadata.create_all(bind=engine)
    
    # Note: employees.csv is no longer used - data comes from database
    # New developers should run the migration script or add employees via UI

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

        # Create default leave types (with updated colors)
        default_leave_types = [
            LeaveType(
                code="DO",
                description="Day Off",
                color_hex="#70c770",
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
                color_hex="#ec7c13",
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
                color_hex="#ded9d9",
                counts_as_rest=True,
                is_active=True
            ),
            LeaveType(
                code="O",
                description="Off Duty",
                color_hex="#ffffff",
                counts_as_rest=True,
                is_active=True
            ),
        ]

        for leave_type in default_leave_types:
            db.add(leave_type)

        # Create default shift types (with updated colors)
        default_shift_types = [
            ShiftType(
                code="M",
                description="Morning",
                color_hex="#FFFFFF",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="IP",
                description="Inpatient",
                color_hex="#ffffff",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="A",
                description="Afternoon",
                color_hex="#845699",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="N",
                description="Night",
                color_hex="#FFFF00",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="M3",
                description="7am-2pm",
                color_hex="#ecd0d0",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="M4",
                description="12pm-7pm",
                color_hex="#a6cdf7",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="H",
                description="Harat",
                color_hex="#ffcd9e",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="CL",
                description="Clinic",
                color_hex="#ffffff",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="E",
                description="Evening",
                color_hex="#4575d3",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="MS",
                description="Medical Store",
                color_hex="#ffffff",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="C",
                description="Course",
                color_hex="#e66bcf",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="P",
                description="Preparation",
                color_hex="#FFA07A",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="M+P",
                description="Main+Preparation",
                color_hex="#ec7c13",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="IP+P",
                description="Inpatient+Preparation",
                color_hex="#ec7c13",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="AS",
                description="All Shifts",
                color_hex="#c4b5fd",
                is_working_shift=True,
                is_active=True
            ),
            ShiftType(
                code="O",
                description="Off Duty",
                color_hex="#ffffff",
                is_working_shift=False,
                is_active=True
            ),
        ]

        for shift_type in default_shift_types:
            db.add(shift_type)

        # Create default employees (Staff users with skills)
        # These match the employees currently in production database
        default_employees = [
            {"name": "Abdullah", "username": "abdullah", "skill_M": False, "skill_IP": False, "skill_A": False, "skill_N": False, "skill_M3": False, "skill_M4": False, "skill_H": False, "skill_CL": True, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Ameera", "username": "ameera", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Amna", "username": "amna", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Anisa", "username": "anisa", "skill_M": True, "skill_IP": True, "skill_A": False, "skill_N": False, "skill_M3": False, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Aya", "username": "aya", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Faiza", "username": "faiza", "skill_M": False, "skill_IP": True, "skill_A": False, "skill_N": False, "skill_M3": False, "skill_M4": False, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Ghadeer", "username": "ghadeer", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": True, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Hawra", "username": "hawra", "skill_M": False, "skill_IP": False, "skill_A": False, "skill_N": False, "skill_M3": False, "skill_M4": False, "skill_H": False, "skill_CL": True, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Huda", "username": "huda", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Idris", "username": "idris", "skill_M": True, "skill_IP": False, "skill_A": False, "skill_N": False, "skill_M3": False, "skill_M4": False, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Karima H", "username": "karima_h", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Karima W", "username": "karima_w", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Khawla", "username": "khawla", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Lamees", "username": "lamees", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": True, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Marwa J", "username": "marwa_j", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": True, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Muna", "username": "muna", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Nasra", "username": "nasra", "skill_M": True, "skill_IP": False, "skill_A": False, "skill_N": False, "skill_M3": False, "skill_M4": False, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Noor", "username": "noor", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Rahma", "username": "rahma", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Rashida", "username": "rashida", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Saja", "username": "saja", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": True, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Shatha", "username": "shatha", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Sultan", "username": "sultan", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Sumayia", "username": "sumayia", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": True, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
            {"name": "Widad", "username": "widad", "skill_M": True, "skill_IP": True, "skill_A": True, "skill_N": True, "skill_M3": True, "skill_M4": True, "skill_H": False, "skill_CL": False, "min_days_off": 4, "weight": 1.0, "pending_off": 0.0},
        ]

        # Create users and employee skills for each employee
        default_password = "password123"  # Default password for all staff users
        for emp_data in default_employees:
            # Create user account
            user = User(
                username=emp_data["username"],
                password=hash_password(default_password),
                employee_name=emp_data["name"],
                employee_type=EmployeeType.STAFF
            )
            db.add(user)
            db.flush()  # Get the user ID
            
            # Create employee skills linked to the user
            employee_skills = EmployeeSkills(
                name=emp_data["name"],
                user_id=user.id,
                skill_M=emp_data["skill_M"],
                skill_IP=emp_data["skill_IP"],
                skill_A=emp_data["skill_A"],
                skill_N=emp_data["skill_N"],
                skill_M3=emp_data["skill_M3"],
                skill_M4=emp_data["skill_M4"],
                skill_H=emp_data["skill_H"],
                skill_CL=emp_data["skill_CL"],
                min_days_off=emp_data["min_days_off"],
                weight=emp_data["weight"],
                pending_off=emp_data["pending_off"]
            )
            db.add(employee_skills)

        db.commit()
        print("✅ Database initialized successfully!")
        print("   - Default admin user created (username: admin, password: admin123)")
        print(f"   - {len(default_employees)} staff users created (password: password123)")
        print("   - Default leave types created")
        print("   - Default shift types created")
    except Exception as e:
        db.rollback()
        print(f"❌ Error initializing database: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    init_db()

