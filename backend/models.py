"""SQLAlchemy database models."""

from sqlalchemy import Column, Integer, String, Boolean, Date, DateTime, ForeignKey, Text, Enum as SQLEnum
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
    display_name = Column(String, nullable=False)  # e.g., "Annual Leave", "Maternity Leave"
    description = Column(Text, nullable=True)
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


class ShiftRequest(Base):
    """Shift request model."""
    __tablename__ = "shift_requests"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    shift = Column(String, nullable=False)  # e.g., "M", "N", "A"
    from_date = Column(Date, nullable=False)
    to_date = Column(Date, nullable=False)
    force = Column(Boolean, nullable=False, default=True)  # True = Force (Must), False = Forbid (Cannot)
    reason = Column(Text, nullable=True)
    status = Column(SQLEnum(RequestStatus), nullable=False, default=RequestStatus.PENDING)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    approved_by = Column(String, nullable=True)  # Username of approver
    approved_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", back_populates="shift_requests")

