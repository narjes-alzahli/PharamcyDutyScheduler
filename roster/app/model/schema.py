"""Data schemas and validation for staff rostering."""

from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Dict, List, Set, Tuple, Optional, Any
import pandas as pd
from pydantic import BaseModel, Field, field_validator, ConfigDict, validator
import yaml


class Employee(BaseModel):
    """Employee data model."""
    employee: str
    staff_no: Optional[str] = Field(default=None, alias="staff_no")
    skill_M: bool = Field(alias="skill_M")
    skill_IP: bool = Field(alias="skill_IP")
    skill_A: bool = Field(alias="skill_A")
    skill_N: bool = Field(alias="skill_N")
    skill_M3: bool = Field(alias="skill_M3")
    skill_M4: bool = Field(alias="skill_M4")
    skill_H: bool = Field(alias="skill_H")
    skill_CL: bool = Field(alias="skill_CL")
    skill_E: bool = Field(alias="skill_E")
    skill_IP_P: bool = Field(alias="skill_IP_P")
    skill_P: bool = Field(alias="skill_P")
    skill_M_P: bool = Field(alias="skill_M_P")
    min_days_off: int = Field(ge=1, alias="min_days_off")
    weight: float = Field(ge=0.0, alias="weight")
    pending_off: float = Field(default=0.0, alias="pending_off")

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    @field_validator("staff_no", mode="before")
    @classmethod
    def empty_staff_no(cls, v: Any) -> Optional[str]:
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return None
        s = str(v).strip()
        return s if s else None


class DailyRequirement(BaseModel):
    """Daily requirement data model."""
    date: date
    need_M: int = Field(ge=0, alias="need_M")
    need_IP: int = Field(ge=0, alias="need_IP")
    need_A: int = Field(ge=0, alias="need_A")
    need_N: int = Field(ge=0, alias="need_N")
    need_M3: int = Field(ge=0, alias="need_M3")
    need_M4: int = Field(ge=0, alias="need_M4")
    need_H: int = Field(ge=0, alias="need_H")
    need_CL: int = Field(ge=0, alias="need_CL")
    need_E: int = Field(ge=0, alias="need_E", default=0)
    need_IP_P: int = Field(ge=0, alias="need_IP_P", default=0)
    need_P: int = Field(ge=0, alias="need_P", default=0)
    need_M_P: int = Field(ge=0, alias="need_M_P", default=0)
    holiday: Optional[str] = Field(default=None, alias="holiday")

    @validator('holiday', pre=True)
    def handle_nan_holiday(cls, v):
        """Handle nan values from pandas."""
        if pd.isna(v) or v is None:
            return None
        # Convert empty string to None for consistency
        if isinstance(v, str) and v.strip() == '':
            return None
        return str(v)

    class Config:
        populate_by_name = True


class Leave(BaseModel):
    """Leave data model."""
    employee: str
    from_date: date = Field(alias="from_date")
    to_date: date = Field(alias="to_date")
    code: str  # Leave codes are now managed dynamically in the database
    
    class Config:
        populate_by_name = True


class SpecialRequirement(BaseModel):
    """Special requirement data model."""
    employee: str
    from_date: date = Field(alias="from_date")
    to_date: date = Field(alias="to_date")
    shift: str
    force: bool
    
    class Config:
        populate_by_name = True


class ASPreference(BaseModel):
    """Adaptive-shift preference request (preference only, not lock/time off)."""
    employee: str
    from_date: date = Field(alias="from_date")
    to_date: date = Field(alias="to_date")

    class Config:
        populate_by_name = True


def canonicalize_schedule_code(raw: Any, allowed: Optional[Set[str]]) -> str:
    """Map a raw code to canonical spelling: strip whitespace, then case-insensitive match to ``allowed``.

    If ``allowed`` is None or empty, returns stripped ``raw`` (no validation).
    Raises ``ValueError`` if the code cannot be matched.
    """
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        raise ValueError("Schedule code is empty")
    s = str(raw).strip()
    if not s:
        raise ValueError("Schedule code is empty")
    if not allowed:
        return s
    if s in allowed:
        return s
    lower_to_canon: Dict[str, str] = {}
    for a in allowed:
        k = a.lower()
        if k in lower_to_canon and lower_to_canon[k] != a:
            raise ValueError(
                f"Ambiguous case-insensitive schedule code {raw!r}: "
                f"{lower_to_canon[k]!r} vs {a!r}"
            )
        lower_to_canon[k] = a
    lk = s.lower()
    if lk in lower_to_canon:
        return lower_to_canon[lk]
    preview = sorted(allowed)[:30]
    raise ValueError(
        f"Unknown schedule code {raw!r}. Known codes (sample): {preview}"
    )


def parse_employees_dataframe(df: pd.DataFrame) -> List[Employee]:
    """Parse employees.csv-equivalent data (same rules as RosterData._load_employees)."""
    if df is None or df.empty:
        return []
    return [Employee(**row) for row in df.to_dict("records")]


def parse_demands_dataframe(df: pd.DataFrame) -> List[DailyRequirement]:
    """Parse demands.csv-equivalent data (same rules as RosterData._load_daily_requirements)."""
    if df is None or df.empty:
        return []
    df = df.copy()
    df = df.dropna(subset=["date"])
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.date
    df = df.dropna(subset=["date"])
    if "holiday" in df.columns:
        df = df.drop(columns=["holiday"])
    records = df.to_dict("records")
    for record in records:
        record["holiday"] = None
    return [DailyRequirement(**row) for row in records]


def parse_leave_dataframe(df: Optional[pd.DataFrame]) -> List[Leave]:
    """Parse time_off.csv-equivalent data (same rules as RosterData._load_leave)."""
    if df is None or df.empty:
        return []
    df = df.copy()
    df = df.dropna(subset=["from_date", "to_date"])
    df["from_date"] = pd.to_datetime(df["from_date"], errors="coerce").dt.date
    df["to_date"] = pd.to_datetime(df["to_date"], errors="coerce").dt.date
    df = df.dropna(subset=["from_date", "to_date"])
    return [Leave(**row) for row in df.to_dict("records")]


def parse_locks_dataframe(df: Optional[pd.DataFrame]) -> List[SpecialRequirement]:
    """Parse locks.csv-equivalent data (same rules as RosterData._load_special_requirements)."""
    if df is None or df.empty:
        return []
    df = df.copy()
    df = df.dropna(subset=["from_date", "to_date"])
    df["from_date"] = pd.to_datetime(df["from_date"], errors="coerce").dt.date
    df["to_date"] = pd.to_datetime(df["to_date"], errors="coerce").dt.date
    df = df.dropna(subset=["from_date", "to_date"])
    cols = [c for c in ("employee", "from_date", "to_date", "shift", "force") if c in df.columns]
    df = df[cols]
    return [SpecialRequirement(**row) for row in df.to_dict("records")]


def parse_holidays_dataframe(df: Optional[pd.DataFrame]) -> Dict[date, str]:
    """Parse holidays.csv into the holidays_dict shape (same rules as RosterData._load_holidays)."""
    if df is None or df.empty:
        return {}
    df = df.copy()
    df = df.dropna(subset=["date"])
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.date
    df = df.dropna(subset=["date", "holiday"])
    out: Dict[date, str] = {}
    for _, row in df.iterrows():
        date_val = row["date"]
        holiday_name = str(row["holiday"]).strip()
        if date_val and holiday_name:
            out[date_val] = holiday_name
    return out


def parse_as_preferences(raw: Optional[List[Dict[str, Any]]]) -> List[ASPreference]:
    """Parse AS preference entries from backend payload."""
    if not raw:
        return []
    return [ASPreference(**row) for row in raw]


class RosterData:
    """Main data container for roster inputs."""
    
    def __init__(self, data_dir: Path, config: Optional['RosterConfig'] = None):
        self.data_dir = Path(data_dir)
        self.config = config  # Store config reference for accessing leave_codes
        self.employees: List[Employee] = []
        self.daily_requirements: List[DailyRequirement] = []
        self.leave: List[Leave] = []
        self.special_requirements: List[SpecialRequirement] = []
        self.employees_dict: Dict[str, Employee] = {}
        self.daily_requirements_dict: Dict[date, DailyRequirement] = {}
        self.leave_dict: Dict[Tuple[str, date], str] = {}
        self.special_requirements_dict: Dict[Tuple[str, date, str], bool] = {}
        self.holidays_dict: Dict[date, str] = {}  # Separate holidays dict for pending_off calculation
        self.as_preferences: List[ASPreference] = []
        # [HISTORY_AWARE_FAIRNESS] Assignment history for fairness calculations
        self.history_counts: Dict[str, Dict[str, int]] = None
        # Previous committed-period shifts for boundary carry-over rules
        self.previous_period_shifts: Dict[Tuple[str, date], str] = {}

    @classmethod
    def from_dataframes(
        cls,
        config: "RosterConfig",
        *,
        employees: pd.DataFrame,
        demands: pd.DataFrame,
        time_off: Optional[pd.DataFrame] = None,
        locks: Optional[pd.DataFrame] = None,
        holidays_dict: Optional[Dict[date, str]] = None,
        as_preferences: Optional[List[Dict[str, Any]]] = None,
        data_dir: Optional[Path] = None,
    ) -> "RosterData":
        """Build RosterData from in-memory frames (same parsing as CSV load_data)."""
        inst = cls(data_dir or Path("."), config)
        inst.employees = parse_employees_dataframe(employees)
        inst.daily_requirements = parse_demands_dataframe(demands)
        inst.leave = parse_leave_dataframe(time_off)
        inst.special_requirements = parse_locks_dataframe(locks)
        inst.holidays_dict = dict(holidays_dict) if holidays_dict else {}
        inst.as_preferences = parse_as_preferences(as_preferences)
        inst._build_dictionaries()
        return inst
        
    def load_data(self) -> None:
        """Load all data from CSV files."""
        self._load_employees()
        self._load_daily_requirements()
        self._load_leave()
        self._load_special_requirements()
        self._load_holidays()  # Load holidays separately
        self._build_dictionaries()
        
    def _load_employees(self) -> None:
        """Load employees from CSV."""
        df = pd.read_csv(self.data_dir / "employees.csv")
        self.employees = parse_employees_dataframe(df)
        
    def _load_daily_requirements(self) -> None:
        """Load daily requirements from CSV (holiday column is NOT in demands.csv anymore)."""
        df = pd.read_csv(self.data_dir / "demands.csv", keep_default_na=False, na_values=[])
        self.daily_requirements = parse_demands_dataframe(df)
        
    def _load_leave(self) -> None:
        """Load leave from CSV (if file exists)."""
        if (self.data_dir / "time_off.csv").exists():
            df = pd.read_csv(self.data_dir / "time_off.csv")
            self.leave = parse_leave_dataframe(df)
        else:
            self.leave = []
            
    def _load_special_requirements(self) -> None:
        """Load special requirements from CSV (if file exists)."""
        if (self.data_dir / "locks.csv").exists():
            df = pd.read_csv(self.data_dir / "locks.csv")
            self.special_requirements = parse_locks_dataframe(df)
        else:
            self.special_requirements = []
    
    def _load_holidays(self) -> None:
        """Load holidays from separate CSV file (for pending_off calculation only)."""
        holidays_file = self.data_dir / "holidays.csv"
        if holidays_file.exists():
            df = pd.read_csv(holidays_file, keep_default_na=False, na_values=[])
            self.holidays_dict = parse_holidays_dataframe(df)
            
    def _canonicalization_codes(self) -> Optional[Set[str]]:
        """Union of config shift/leave codes for normalizing strings (solver/DB spelling)."""
        cfg = getattr(self, "config", None)
        if cfg is None:
            return None
        codes: Set[str] = set()
        codes.update(getattr(cfg, "all_shift_codes", None) or [])
        codes.update(getattr(cfg, "leave_codes", None) or [])
        return codes if codes else None

    def _build_dictionaries(self) -> None:
        """Build lookup dictionaries for efficient access."""
        self.employees_dict = {emp.employee: emp for emp in self.employees}
        self.daily_requirements_dict = {dr.date: dr for dr in self.daily_requirements}
        allowed = self._canonicalization_codes()

        # Build leave dictionary with date ranges (fail on conflicting codes same day)
        self.leave_dict = {}
        for leave in self.leave:
            code = (
                canonicalize_schedule_code(leave.code, allowed)
                if allowed
                else str(leave.code).strip()
            )
            current_date = leave.from_date
            while current_date <= leave.to_date:
                key = (leave.employee, current_date)
                existing = self.leave_dict.get(key)
                if existing is not None and existing != code:
                    raise ValueError(
                        f"Overlapping leave for {leave.employee!r} on {current_date}: "
                        f"{existing!r} vs {code!r} (only one leave code per person per day)."
                    )
                self.leave_dict[key] = code
                current_date = current_date + timedelta(days=1)

        # Build special requirements dictionary (fail on conflicting force for same emp/day/shift)
        self.special_requirements_dict = {}
        for sr in self.special_requirements:
            shift = (
                canonicalize_schedule_code(sr.shift, allowed)
                if allowed
                else str(sr.shift).strip()
            )
            current_date = sr.from_date
            while current_date <= sr.to_date:
                key = (sr.employee, current_date, shift)
                existing_force = self.special_requirements_dict.get(key)
                if existing_force is not None and existing_force != sr.force:
                    raise ValueError(
                        f"Conflicting lock/special requirement for {sr.employee!r} on "
                        f"{current_date} shift {shift!r}: force={existing_force!r} vs "
                        f"force={sr.force!r}."
                    )
                self.special_requirements_dict[key] = sr.force
                current_date = current_date + timedelta(days=1)

        
    def get_employee_skills(self, employee: str) -> Dict[str, bool]:
        """Get skills for an employee."""
        emp = self.employees_dict.get(employee)
        if not emp:
            return {}
        return {
            "M": emp.skill_M,
            "IP": emp.skill_IP,
            "A": emp.skill_A,
            "N": emp.skill_N,
            "M3": emp.skill_M3,
            "M4": emp.skill_M4,
            "H": emp.skill_H,
            "CL": emp.skill_CL,
            "E": emp.skill_E,
            "IP+P": emp.skill_IP_P,
            "P": emp.skill_P,
            "M+P": emp.skill_M_P
        }
        
    def get_daily_requirement(self, date: date) -> Dict[str, int]:
        """Get daily requirement for a date (only need_* fields, no holiday)."""
        dr = self.daily_requirements_dict.get(date)
        if not dr:
            return {"M": 0, "IP": 0, "A": 0, "N": 0, "M3": 0, "M4": 0, "H": 0, "CL": 0, "E": 0, "IP+P": 0, "P": 0, "M+P": 0}
        return {
            "M": dr.need_M,
            "IP": dr.need_IP,
            "A": dr.need_A,
            "N": dr.need_N,
            "M3": dr.need_M3,
            "M4": dr.need_M4,
            "H": dr.need_H,
            "CL": dr.need_CL,
            "E": dr.need_E,
            "IP+P": dr.need_IP_P,
            "P": dr.need_P,
            "M+P": dr.need_M_P
        }
    
    def get_holiday(self, date: date) -> Optional[str]:
        """Get holiday name for a date (if any) from separate holidays dict."""
        return self.holidays_dict.get(date)
        
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
        """Get all possible shifts (working shifts + leave types + requested non-standard shifts)."""
        cfg = getattr(self, "config", None)
        if cfg is None or not getattr(cfg, "all_shift_codes", None):
            raise RuntimeError(
                "RosterData.config.all_shift_codes is missing or empty. "
                "The solver must load shift types from the database (or a complete YAML config). "
                "Silent defaults were removed to avoid wrong or incomplete shift domains."
            )

        all_shifts = set(cfg.all_shift_codes)

        leave_codes = getattr(cfg, "leave_codes", None) or []
        for code in leave_codes:
            if code not in all_shifts:
                all_shifts.add(code)

        # Non-standard shifts requested in time_off (e.g. MS) must appear in the domain
        if hasattr(self, "leave_dict") and self.leave_dict:
            for (_emp, _day), code in self.leave_dict.items():
                if code not in all_shifts:
                    all_shifts.add(code)

        return sorted(all_shifts)


class RosterConfig:
    """Configuration for roster optimization."""
    
    def __init__(self, config_file: Optional[Path] = None):
        self.weights = {
            "unfilled_coverage": 1000.0,
            "overstaffing": 10.0,
            "fairness": 5.0,
            "rest_after_shift": 4000.0,  # for non A/N/M4 rest rules only
            "sequence_preference_miss": 1500.0,  # A/N/M4 preferred follow-up not used
            "sequence_fallback_miss": 4000.0,  # A/N/M4 acceptable fallback also not met
            "do_after_n": 1.0,
            "a_to_n_penalty": 5.0,
            "as_preference": 1000.0,
        }
        self.rest_codes = {"O"}  # DO is a leave type, not a rest code
        self.leave_codes = []  # Will be populated from config file (includes DO from leave_types table)
        self.working_shift_codes = []  # Will be populated from config file (working shifts from database)
        self.all_shift_codes = []  # All shifts (working + rest like O, plus leave types like DO from database)
        self.forbidden_adjacencies = [
            ("N", "M"), ("N", "IP"), ("N", "M3"),
            ("E", "M"), ("E", "IP"), ("E", "M3"),
            ("N", "APP"),
        ]
        self.weekly_rest_minimum = 1
        self.required_rest_after_shifts = [
            {"shift": "N", "rest_days": 2, "rest_code": "O"},
            {"shift": "M4", "rest_days": 1, "rest_code": "O"},
            {"shift": "A", "rest_days": 1, "rest_code": "O"}
        ]
        
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
        if "leave_codes" in config:
            self.leave_codes = config["leave_codes"]
        if "working_shift_codes" in config:
            self.working_shift_codes = config["working_shift_codes"]
        if "all_shift_codes" in config:
            self.all_shift_codes = config["all_shift_codes"]
        if "forbidden_adjacencies" in config:
            self.forbidden_adjacencies = config["forbidden_adjacencies"]
        if "weekly_rest_minimum" in config:
            self.weekly_rest_minimum = config["weekly_rest_minimum"]
        if "required_rest_after_shifts" in config:
            self.required_rest_after_shifts = config["required_rest_after_shifts"]
