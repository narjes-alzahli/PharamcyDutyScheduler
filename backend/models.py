"""SQLAlchemy database models."""

from sqlalchemy import Column, Integer, String, Boolean, Date, DateTime, ForeignKey, Text, Enum as SQLEnum, JSON, Float, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database import Base
import enum


class RequestStatus(str, enum.Enum):
    """Status enum for leave and shift requests."""
    PENDING = "Pending"
    APPROVED = "Approved"
    REJECTED = "Rejected"


class EmployeeType(str, enum.Enum):
    """Employee type enum."""
    MANAGER = "Manager"
    STAFF = "Staff"


class User(Base):
    """User account model for authentication."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)  # In production, use hashed passwords
    employee_name = Column(String, nullable=False)
    employee_type = Column(SQLEnum(EmployeeType), nullable=False, default=EmployeeType.STAFF)
    staff_no = Column(String(32), nullable=True, unique=True, index=True)  # Official staff number (e.g. 58812); Admin often 00000
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    leave_requests = relationship("LeaveRequest", back_populates="user", cascade="all, delete-orphan")
    shift_requests = relationship("ShiftRequest", back_populates="user", cascade="all, delete-orphan")


class LeaveType(Base):
    """Leave type model - managed by admins."""
    __tablename__ = "leave_types"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)  # e.g., "AL", "ML", "DO"
    description = Column(String, nullable=False)  # Combined display name and description (e.g., "Annual Leave")
    color_hex = Column(String, default="#F5F5F5")  # Color for UI display
    counts_as_rest = Column(Boolean, default=True)  # Whether this counts as a rest day
    is_active = Column(Boolean, default=True)  # Can be disabled without deleting
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    leave_requests = relationship("LeaveRequest", back_populates="leave_type")


class LeaveRequest(Base):
    """Leave request model."""
    __tablename__ = "leave_requests"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    leave_type_id = Column(Integer, ForeignKey("leave_types.id"), nullable=False)
    from_date = Column(Date, nullable=False)
    to_date = Column(Date, nullable=False)
    reason = Column(Text, nullable=True)
    status = Column(SQLEnum(RequestStatus), nullable=False, default=RequestStatus.PENDING)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    approved_by = Column(String, nullable=True)  # Username of approver
    approved_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", back_populates="leave_requests")
    leave_type = relationship("LeaveType", back_populates="leave_requests")


class ShiftType(Base):
    """Shift type model - managed by admins (e.g., M, IP, A, N)."""
    __tablename__ = "shift_types"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)  # e.g., "M", "IP", "A", "N"
    description = Column(String, nullable=False)  # Combined display name and description (e.g., "Morning")
    color_hex = Column(String, default="#E5E7EB")  # Color for UI display
    is_working_shift = Column(Boolean, default=True)  # True = working shift, False = rest/leave
    is_active = Column(Boolean, default=True)  # Can be disabled without deleting
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    shift_requests = relationship("ShiftRequest", back_populates="shift_type")


class ShiftRequest(Base):
    """Shift request model."""
    __tablename__ = "shift_requests"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    shift_type_id = Column(Integer, ForeignKey("shift_types.id"), nullable=False)  # Changed from shift string
    from_date = Column(Date, nullable=False)
    to_date = Column(Date, nullable=False)
    force = Column(Boolean, nullable=False, default=True)  # True = Must, False = Cannot
    reason = Column(Text, nullable=True)
    status = Column(SQLEnum(RequestStatus), nullable=False, default=RequestStatus.PENDING)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    approved_by = Column(String, nullable=True)  # Username of approver
    approved_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", back_populates="shift_requests")
    shift_type = relationship("ShiftType", back_populates="shift_requests")


class EmployeeSkills(Base):
    """Employee skills model - skills, constraints, and preferences for staff users.
    
    Each staff user has employee skills linked via user_id.
    """
    __tablename__ = "employee_skills"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, unique=True, index=True)  # Link to user account
    skill_M = Column(Boolean, default=True)
    skill_IP = Column(Boolean, default=True)
    skill_A = Column(Boolean, default=True)
    skill_N = Column(Boolean, default=True)
    skill_M3 = Column(Boolean, default=True)
    skill_M4 = Column(Boolean, default=True)
    skill_H = Column(Boolean, default=False)
    skill_CL = Column(Boolean, default=True)
    skill_E = Column(Boolean, default=True)
    skill_IP_P = Column(Boolean, default=True)
    skill_P = Column(Boolean, default=True)
    skill_M_P = Column(Boolean, default=True)
    min_days_off = Column(Integer, default=4)  # Minimum days off per period
    weight = Column(Float, default=1.0)  # Fairness weight
    pending_off = Column(Float, default=0.0)  # Pending off balance
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationship to User (for authentication)
    user = relationship("User", backref="employee_skills")


class Demand(Base):
    """Demand model - staffing requirements per date."""
    __tablename__ = "demands"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False, index=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    need_M = Column(Integer, default=0)
    need_IP = Column(Integer, default=0)
    need_A = Column(Integer, default=0)
    need_N = Column(Integer, default=0)
    need_M3 = Column(Integer, default=0)
    need_M4 = Column(Integer, default=0)
    need_H = Column(Integer, default=0)
    need_CL = Column(Integer, default=0)
    need_E = Column(Integer, default=0)
    need_IP_P = Column(Integer, default=0)
    need_P = Column(Integer, default=0)
    need_M_P = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Unique constraint: one demand record per date
    __table_args__ = (UniqueConstraint('date', name='uq_demand_date'),)


class CommittedSchedule(Base):
    """Committed schedule model - final schedules that have been committed."""
    __tablename__ = "committed_schedules"

    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    employee_name = Column(String, nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    shift = Column(String, nullable=False)  # Shift code (M, IP, A, N, etc.)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Unique constraint: one schedule entry per employee-date combination
    __table_args__ = (UniqueConstraint('year', 'month', 'employee_name', 'date', name='uq_schedule_entry'),)


class ScheduleMetrics(Base):
    """Schedule metrics model - analytics and metrics for committed schedules."""
    __tablename__ = "schedule_metrics"

    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    metrics = Column(JSON, nullable=False)  # Store all metrics as JSON
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Unique constraint: one metrics record per year-month
    __table_args__ = (UniqueConstraint('year', 'month', name='uq_schedule_metrics'),)


class Holiday(Base):
    """Holiday model - holidays per date."""
    __tablename__ = "holidays"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False, unique=True, index=True)
    year = Column(Integer, nullable=False, index=True)
    month = Column(Integer, nullable=False, index=True)
    name = Column(String, nullable=False)  # Holiday name
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

