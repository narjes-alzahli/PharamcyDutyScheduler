from datetime import date, timedelta
from typing import Dict, Optional, Tuple
from sqlalchemy.orm import Session

from backend.models import RamadanDate

RamadanPeriodId = str

def _first_day_of_month(dt: date) -> date:
    return dt.replace(day=1)


def _last_day_of_month(dt: date) -> date:
    if dt.month == 12:
        return date(dt.year, 12, 31)
    return date(dt.year, dt.month + 1, 1) - timedelta(days=1)


def _load_override_from_db(year: int, db: Optional[Session]) -> Optional[Tuple[date, date]]:
    if db is None:
        return None
    row = db.query(RamadanDate).filter(RamadanDate.year == int(year)).first()
    if row is None:
        return None
    return row.start_date, row.end_date


def get_ramadan_range(year: int, db: Optional[Session] = None) -> Optional[Tuple[date, date]]:
    return _load_override_from_db(year, db)


def get_ramadan_period_windows(year: int, db: Optional[Session] = None) -> Optional[Dict[RamadanPeriodId, Tuple[date, date]]]:
    rng = get_ramadan_range(year, db)
    if rng is None:
        return None
    start, end = rng
    return {
        "pre-ramadan": (_first_day_of_month(start), start - timedelta(days=1)),
        "ramadan": (start, end),
        "post-ramadan": (end + timedelta(days=1), _last_day_of_month(end)),
    }


def get_ramadan_period_window(
    year: Optional[int], month: Optional[int], selected_period: Optional[str], db: Optional[Session] = None
) -> Optional[Tuple[date, date]]:
    if year is None or month is None or not selected_period:
        return None
    windows = get_ramadan_period_windows(year, db)
    if windows is None:
        return None
    window = windows.get(selected_period)
    if window is None:
        return None
    start_d, end_d = window
    if month not in (start_d.month, end_d.month):
        return None
    return window


def detect_periods_for_dates(year: int, month: int, dates: list[date], db: Optional[Session] = None) -> list[str]:
    if not dates:
        return []
    windows = get_ramadan_period_windows(year, db)
    if windows is None:
        return []
    detected: list[str] = []
    for period in ("pre-ramadan", "ramadan", "post-ramadan"):
        start_d, end_d = windows[period]
        if month not in (start_d.month, end_d.month):
            continue
        if any(start_d <= d <= end_d for d in dates):
            detected.append(period)
    return detected

