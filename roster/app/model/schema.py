"""Data schemas and validation for staff rostering."""

from datetime import date, datetime
from pathlib import Path
from typing import Dict, List, Set, Tuple, Optional, Any
import pandas as pd
from pydantic import BaseModel, Field, validator
import yaml


class Employee(BaseModel):
    """Employee data model."""
    employee: str
    skill_M: bool = Field(alias="skill_M")
    skill_O: bool = Field(alias="skill_O") 
    skill_IP: bool = Field(alias="skill_IP")
    skill_A: bool = Field(alias="skill_A")
    skill_N: bool = Field(alias="skill_N")
    maxN: int = Field(ge=0, alias="maxN")
    maxA: int = Field(ge=0, alias="maxA")
    min_days_off: int = Field(ge=1, alias="min_days_off")
    weight: float = Field(ge=0.0, alias="weight")

    class Config:
        populate_by_name = True


class DailyRequirement(BaseModel):
    """Daily requirement data model."""
    date: date
    need_M: int = Field(ge=0, alias="need_M")
    need_O: int = Field(ge=0, alias="need_O")
    need_IP: int = Field(ge=0, alias="need_IP")
    need_A: int = Field(ge=0, alias="need_A")
    need_N: int = Field(ge=0, alias="need_N")

    class Config:
        populate_by_name = True


class Leave(BaseModel):
    """Leave data model."""
    employee: str
    date: date
    code: str = Field(pattern="^(DO|CL|ML|W|UL)$")


class SpecialRequirement(BaseModel):
    """Special requirement data model."""
    employee: str
    date: date
    shift: str
    force: bool


class RosterData:
    """Main data container for roster inputs."""
    
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.employees: List[Employee] = []
        self.daily_requirements: List[DailyRequirement] = []
        self.leave: List[Leave] = []
        self.special_requirements: List[SpecialRequirement] = []
        self.employees_dict: Dict[str, Employee] = {}
        self.daily_requirements_dict: Dict[date, DailyRequirement] = {}
        self.leave_dict: Dict[Tuple[str, date], str] = {}
        self.special_requirements_dict: Dict[Tuple[str, date, str], bool] = {}
        
    def load_data(self) -> None:
        """Load all data from CSV files."""
        self._load_employees()
        self._load_daily_requirements()
        self._load_leave()
        self._load_special_requirements()
        self._build_dictionaries()
        
    def _load_employees(self) -> None:
        """Load employees from CSV."""
        df = pd.read_csv(self.data_dir / "employees.csv")
        self.employees = [Employee(**row) for row in df.to_dict("records")]
        
    def _load_daily_requirements(self) -> None:
        """Load daily requirements from CSV."""
        df = pd.read_csv(self.data_dir / "demands.csv")
        df["date"] = pd.to_datetime(df["date"]).dt.date
        self.daily_requirements = [DailyRequirement(**row) for row in df.to_dict("records")]
        
    def _load_leave(self) -> None:
        """Load leave from CSV."""
        if (self.data_dir / "time_off.csv").exists():
            df = pd.read_csv(self.data_dir / "time_off.csv")
            df["date"] = pd.to_datetime(df["date"]).dt.date
            self.leave = [Leave(**row) for row in df.to_dict("records")]
            
    def _load_special_requirements(self) -> None:
        """Load special requirements from CSV."""
        if (self.data_dir / "locks.csv").exists():
            df = pd.read_csv(self.data_dir / "locks.csv")
            df["date"] = pd.to_datetime(df["date"]).dt.date
            self.special_requirements = [SpecialRequirement(**row) for row in df.to_dict("records")]
            
    def _build_dictionaries(self) -> None:
        """Build lookup dictionaries for efficient access."""
        self.employees_dict = {emp.employee: emp for emp in self.employees}
        self.daily_requirements_dict = {dr.date: dr for dr in self.daily_requirements}
        self.leave_dict = {(leave.employee, leave.date): leave.code for leave in self.leave}
        self.special_requirements_dict = {(sr.employee, sr.date, sr.shift): sr.force for sr in self.special_requirements}
        
    def get_employee_skills(self, employee: str) -> Dict[str, bool]:
        """Get skills for an employee."""
        emp = self.employees_dict.get(employee)
        if not emp:
            return {}
        return {
            "M": emp.skill_M,
            "O": emp.skill_O,
            "IP": emp.skill_IP,
            "A": emp.skill_A,
            "N": emp.skill_N
        }
        
    def get_daily_requirement(self, date: date) -> Dict[str, int]:
        """Get daily requirement for a date."""
        dr = self.daily_requirements_dict.get(date)
        if not dr:
            return {"M": 0, "O": 0, "IP": 0, "A": 0, "N": 0}
        return {
            "M": dr.need_M,
            "O": dr.need_O,
            "IP": dr.need_IP,
            "A": dr.need_A,
            "N": dr.need_N
        }
        
    def get_leave_code(self, employee: str, date: date) -> Optional[str]:
        """Get leave code for employee on date."""
        return self.leave_dict.get((employee, date))
        
    def get_special_requirement_force(self, employee: str, date: date, shift: str) -> Optional[bool]:
        """Get special requirement force for employee/date/shift."""
        return self.special_requirements_dict.get((employee, date, shift))
        
    def get_date_range(self) -> Tuple[date, date]:
        """Get the date range from daily requirements."""
        if not self.daily_requirements:
            raise ValueError("No daily requirements loaded")
        dates = [dr.date for dr in self.daily_requirements]
        return min(dates), max(dates)
        
    def get_all_dates(self) -> List[date]:
        """Get all dates in the roster period."""
        if not self.daily_requirements:
            return []
        return sorted([dr.date for dr in self.daily_requirements])
        
    def get_employee_names(self) -> List[str]:
        """Get all employee names."""
        return [emp.employee for emp in self.employees]
        
    def get_shifts(self) -> List[str]:
        """Get all possible shifts."""
        return ["M", "O", "IP", "A", "N", "DO", "CL", "ML", "W", "UL"]


class RosterConfig:
    """Configuration for roster optimization."""
    
    def __init__(self, config_file: Optional[Path] = None):
        self.weights = {
            "unfilled_coverage": 1000.0,
            "fairness": 5.0,
            "area_switching": 1.0,
            "do_after_n": 1.0
        }
        self.rest_codes = {"DO", "CL", "ML", "W"}
        self.forbidden_adjacencies = [("N", "M"), ("A", "N")]
        self.weekly_rest_minimum = 1
        
        if config_file and config_file.exists():
            self.load_from_file(config_file)
            
    def load_from_file(self, config_file: Path) -> None:
        """Load configuration from YAML file."""
        with open(config_file, 'r') as f:
            config = yaml.safe_load(f)
            
        if "weights" in config:
            self.weights.update(config["weights"])
        if "rest_codes" in config:
            self.rest_codes = set(config["rest_codes"])
        if "forbidden_adjacencies" in config:
            self.forbidden_adjacencies = config["forbidden_adjacencies"]
        if "weekly_rest_minimum" in config:
            self.weekly_rest_minimum = config["weekly_rest_minimum"]
