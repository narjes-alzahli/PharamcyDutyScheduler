"""Data management interface for editing roster data and generating schedules."""

import streamlit as st
import pandas as pd
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Any
import tempfile
from pathlib import Path
import yaml
import sys

# Add the parent directory to the path to resolve imports
sys.path.append(str(Path(__file__).parent.parent.parent))

from roster.app.model.schema import RosterData, RosterConfig
from roster.app.model.solver import RosterSolver
from roster.app.ui.schedule_display import ScheduleDisplay


class DataManager:
    """Manages roster data editing and schedule generation."""
    
    def __init__(self):
        self.data_dir = Path(__file__).parent.parent / "data"
        self.schedule_display = ScheduleDisplay()
        
    def load_initial_data(self) -> Dict[str, pd.DataFrame]:
        """Load initial data from CSV files."""
        data = {}
        
        # Load employees
        employees_path = self.data_dir / "employees.csv"
        if employees_path.exists():
            data['employees'] = pd.read_csv(employees_path)
            # Add missing columns with default values
            required_columns = ['employee', 'skill_M', 'skill_IP', 'skill_A', 'skill_N', 'skill_M3', 'skill_M4', 'skill_H', 'skill_CL', 'clinic_only', 'ip_ok', 'harat_ok', 'maxN', 'maxA', 'min_days_off', 'weight']
            for col in required_columns:
                if col not in data['employees'].columns:
                    if col.startswith('skill_'):
                        data['employees'][col] = True  # Default to True for skills
                    elif col in ['clinic_only', 'ip_ok', 'harat_ok']:
                        data['employees'][col] = False if col == 'clinic_only' else True  # Default clinic_only=False, others=True
                    elif col in ['maxN', 'maxA']:
                        data['employees'][col] = 3  # Default max shifts
                    elif col == 'min_days_off':
                        data['employees'][col] = 4  # Default min days off
                    elif col == 'weight':
                        data['employees'][col] = 1.0  # Default weight
        else:
            data['employees'] = self._create_empty_employees_df()
        
        # Load demands
        demands_path = self.data_dir / "demands.csv"
        if demands_path.exists():
            data['demands'] = pd.read_csv(demands_path)
            # Add missing columns with default values
            required_columns = ['date', 'need_M', 'need_IP', 'need_A', 'need_N', 'need_M3', 'need_M4', 'need_H', 'need_CL']
            for col in required_columns:
                if col not in data['demands'].columns:
                    if col.startswith('need_'):
                        data['demands'][col] = 0  # Default to 0 for requirements
        else:
            data['demands'] = self._create_empty_demands_df()
        
        # Load time off
        time_off_path = self.data_dir / "time_off.csv"
        if time_off_path.exists():
            data['time_off'] = pd.read_csv(time_off_path)
        else:
            data['time_off'] = self._create_empty_time_off_df()
        
        # Load locks
        locks_path = self.data_dir / "locks.csv"
        if locks_path.exists():
            data['locks'] = pd.read_csv(locks_path)
        else:
            data['locks'] = self._create_empty_locks_df()
        
        return data
    
    def _create_empty_employees_df(self) -> pd.DataFrame:
        """Create empty employees dataframe."""
        return pd.DataFrame(columns=[
            'employee', 'skill_M', 'skill_IP', 'skill_A', 'skill_N', 'skill_M3', 'skill_M4', 'skill_H', 'skill_CL',
            'clinic_only', 'ip_ok', 'harat_ok', 'maxN', 'maxA', 'min_days_off', 'weight'
        ])
    
    def _create_empty_demands_df(self) -> pd.DataFrame:
        """Create empty demands dataframe."""
        return pd.DataFrame(columns=[
            'date', 'need_M', 'need_IP', 'need_A', 'need_N', 'need_M3', 'need_M4', 'need_H', 'need_CL'
        ])
    
    def _create_empty_time_off_df(self) -> pd.DataFrame:
        """Create empty time off dataframe."""
        return pd.DataFrame(columns=['employee', 'from_date', 'to_date', 'code'])
    
    def _create_empty_locks_df(self) -> pd.DataFrame:
        """Create empty locks dataframe."""
        return pd.DataFrame(columns=['employee', 'from_date', 'to_date', 'shift', 'force'])
    
    def generate_month_demands(self, year: int, month: int, base_demand: Dict[str, int]) -> pd.DataFrame:
        """Generate demands for a specific month."""
        import random
        import calendar
        
        # Get the number of days in the month
        num_days = calendar.monthrange(year, month)[1]
        
        # Generate all dates in the month
        all_dates = [date(year, month, day) for day in range(1, num_days + 1)]
        
        # Identify weekdays (Monday=0 to Thursday=3, Sunday=6)
        weekdays = [d for d in all_dates if d.weekday() not in [4, 5]]  # Exclude Friday=4, Saturday=5
        
        # Randomly select 3-5 weekdays for H shifts
        num_h_shifts = random.randint(3, 5)
        h_dates = random.sample(weekdays, min(num_h_shifts, len(weekdays)))
        
        demands = []
        for current_date in all_dates:
            # Check if it's a weekend (Friday=4, Saturday=5)
            is_weekend = current_date.weekday() in [4, 5]  # Friday=4, Saturday=5
            
            if is_weekend:
                # Weekend staffing: 1 A, 1 N, 1 M3, 0 CL
                demands.append({
                    'date': current_date.strftime('%Y-%m-%d'),
                    'need_M': 0,
                    'need_IP': 0,
                    'need_A': 1,
                    'need_N': 1,
                    'need_M3': 1,
                    'need_M4': 0,
                    'need_H': 0,
                    'need_CL': 0
                })
            else:
                # Weekday staffing: normal requirements
                h_value = 1 if current_date in h_dates else 0
                demands.append({
                    'date': current_date.strftime('%Y-%m-%d'),
                    'need_M': base_demand.get('M', 6),
                    'need_IP': base_demand.get('IP', 3),
                    'need_A': base_demand.get('A', 1),
                    'need_N': base_demand.get('N', 1),
                    'need_M3': base_demand.get('M3', 1),
                    'need_M4': base_demand.get('M4', 1),
                    'need_H': h_value,  # Randomly distributed H shifts
                    'need_CL': base_demand.get('CL', 3)
                })
        
        return pd.DataFrame(demands)


def show_data_manager_page():
    """Show the main data management page."""
    st.header("📊 Data Manager & Schedule Generator")
    
    # Initialize data manager
    if 'data_manager' not in st.session_state:
        st.session_state.data_manager = DataManager()
    
    data_manager = st.session_state.data_manager
    
    # Load initial data
    if 'roster_data' not in st.session_state:
        st.session_state.roster_data = data_manager.load_initial_data()
    
    roster_data = st.session_state.roster_data
    
    # Sidebar for month/year selection
    st.sidebar.header("📅 Month Selection")
    
    col1, col2 = st.sidebar.columns(2)
    with col1:
        selected_year = st.selectbox("Year", [2025, 2026, 2027], index=0)
    with col2:
        selected_month = st.selectbox("Month", [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ], index=2)
    
    month_num = ["January", "February", "March", "April", "May", "June",
                 "July", "August", "September", "October", "November", "December"].index(selected_month) + 1
    
    # Main content tabs
    tab1, tab2, tab3, tab4, tab5, tab6 = st.tabs([
        "👥 Employees", "📋 Daily Requirements", "🏖️ Leave", "🔒 Special Requirements", "⚙️ Generate", "📅 View Schedule"
    ])
    
    with tab1:
        show_employees_tab(roster_data['employees'])
    
    with tab2:
        show_demands_tab(roster_data['demands'], selected_year, month_num)
    
    with tab3:
        show_time_off_tab(roster_data['time_off'], selected_year, month_num)
    
    with tab4:
        show_locks_tab(roster_data['locks'], selected_year, month_num)
    
    with tab5:
        show_generate_tab(roster_data, selected_year, month_num)
    
    with tab6:
        show_schedule_view_tab(selected_year, month_num)


def show_employees_tab(employees_df: pd.DataFrame):
    """Show employees editing tab."""
    st.subheader("👥 Employee Management")
    
    col1, col2 = st.columns([3, 1])
    
    with col1:
        st.markdown("**Edit employee information**")
    
    with col2:
        if st.button("➕ Add Employee", type="primary"):
            new_employee = {
                'employee': f'Employee_{len(employees_df) + 1}',
                'skill_M': True,
                'skill_IP': True,
                'skill_A': True,
                'skill_N': True,
                'skill_M3': True,
                'skill_M4': True,
                'skill_H': True,
                'skill_CL': True,
                'clinic_only': False,
                'ip_ok': True,
                'harat_ok': True,
                'maxN': 3,
                'maxA': 6,
                'min_days_off': 4,
                'weight': 1.0
            }
            new_row = pd.DataFrame([new_employee])
            employees_df = pd.concat([employees_df, new_row], ignore_index=True)
            st.session_state.roster_data['employees'] = employees_df
            st.rerun()
    
    # Editable dataframe
    edited_employees = st.data_editor(
        employees_df,
        num_rows="dynamic",
        column_config={
            "employee": st.column_config.TextColumn("Employee Name", width="medium"),
            "skill_M": st.column_config.CheckboxColumn("Main Shift", width="small"),
            "skill_IP": st.column_config.CheckboxColumn("Inpatient", width="small"),
            "skill_A": st.column_config.CheckboxColumn("Afternoon", width="small"),
            "skill_N": st.column_config.CheckboxColumn("Night", width="small"),
            "skill_M3": st.column_config.CheckboxColumn("M3 (7am-2pm)", width="small"),
            "skill_M4": st.column_config.CheckboxColumn("M4 (12pm-7pm)", width="small"),
            "skill_H": st.column_config.CheckboxColumn("Harat Pharmacy", width="small"),
            "skill_CL": st.column_config.CheckboxColumn("Clinic", width="small"),
            "clinic_only": st.column_config.CheckboxColumn("Clinic Only", width="small"),
            "ip_ok": st.column_config.CheckboxColumn("IP Capable", width="small"),
            "harat_ok": st.column_config.CheckboxColumn("Harat Eligible", width="small"),
            "maxN": st.column_config.NumberColumn("Max Nights", min_value=0, max_value=10, width="small"),
            "maxA": st.column_config.NumberColumn("Max Afternoons", min_value=0, max_value=10, width="small"),
            "min_days_off": st.column_config.NumberColumn("Min Days Off", min_value=1, max_value=10, width="small"),
            "weight": st.column_config.NumberColumn("Weight", min_value=0.1, max_value=10.0, step=0.1, width="small")
        },
        use_container_width=True
    )
    
    # Update data
    if not edited_employees.equals(employees_df):
        st.session_state.roster_data['employees'] = edited_employees
        st.success("✅ Employee data updated!")
    
    # Summary stats
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("Total Employees", len(edited_employees))
    with col2:
        st.metric("Can Work Nights", edited_employees['skill_N'].sum())
    with col3:
        st.metric("Can Work Afternoons", edited_employees['skill_A'].sum())
    with col4:
        st.metric("Can Work All Shifts", (edited_employees[['skill_M', 'skill_IP', 'skill_A', 'skill_N', 'skill_M3', 'skill_M4', 'skill_H', 'skill_CL']].all(axis=1)).sum())


def show_demands_tab(demands_df: pd.DataFrame, year: int, month: int):
    """Show demands editing tab."""
    st.subheader("📋 Daily Requirements")
    
    col1, col2 = st.columns([3, 1])
    
    with col1:
        st.markdown(f"**Set daily staffing requirements for {month:02d}/{year}**")
    
    with col2:
        if st.button("🔄 Generate Month"):
            base_demand = {
                'M': 6, 'IP': 3, 'A': 1, 'N': 1, 'M3': 1, 'M4': 1, 'H': 0, 'CL': 3
            }
            new_demands = st.session_state.data_manager.generate_month_demands(year, month, base_demand)
            st.session_state.roster_data['demands'] = new_demands
            st.rerun()
    
    # Filter demands for selected month
    if not demands_df.empty:
        demands_df['date'] = pd.to_datetime(demands_df['date'])
        month_demands = demands_df[
            (demands_df['date'].dt.year == year) & 
            (demands_df['date'].dt.month == month)
        ].copy()
        
        if month_demands.empty:
            st.info(f"No demands data for {month:02d}/{year}. Click 'Generate Month' to create default demands.")
        else:
            month_demands['date'] = month_demands['date'].dt.strftime('%Y-%m-%d')
            
            # Editable dataframe
            edited_demands = st.data_editor(
                month_demands,
                num_rows="dynamic",
                column_config={
                    "date": st.column_config.TextColumn("Date", width="medium"),
                    "need_M": st.column_config.NumberColumn("Main", min_value=0, max_value=20, width="small"),
                    "need_IP": st.column_config.NumberColumn("Inpatient", min_value=0, max_value=20, width="small"),
                    "need_A": st.column_config.NumberColumn("Afternoon", min_value=0, max_value=20, width="small"),
                    "need_N": st.column_config.NumberColumn("Night", min_value=0, max_value=20, width="small"),
                    "need_M3": st.column_config.NumberColumn("M3 (7am-2pm)", min_value=0, max_value=20, width="small"),
                    "need_M4": st.column_config.NumberColumn("M4 (12pm-7pm)", min_value=0, max_value=20, width="small"),
                    "need_H": st.column_config.NumberColumn("Harat Pharmacy", min_value=0, max_value=20, width="small"),
                    "need_CL": st.column_config.NumberColumn("Clinic", min_value=0, max_value=20, width="small")
                },
                use_container_width=True
            )
            
            # Update data
            if not edited_demands.equals(month_demands):
                # Convert back to datetime for storage
                edited_demands['date'] = pd.to_datetime(edited_demands['date'])
                
                # Update the full demands dataframe
                full_demands = demands_df[~((demands_df['date'].dt.year == year) & (demands_df['date'].dt.month == month))]
                updated_demands = pd.concat([full_demands, edited_demands], ignore_index=True)
                st.session_state.roster_data['demands'] = updated_demands
                st.success("✅ Daily requirements data updated!")
    else:
        st.info("No demands data available. Click 'Generate Month' to create default demands.")


def show_time_off_tab(time_off_df: pd.DataFrame, year: int, month: int):
    """Show time off editing tab."""
    st.subheader("🏖️ Leave & Time Off")
    
    col1, col2 = st.columns([3, 1])
    
    with col1:
        st.markdown(f"**Manage time off and leave for {month:02d}/{year}**")
    
    with col2:
        if st.button("➕ Add Leave"):
            st.session_state.show_add_time_off = True
    
    # Add time off form
    if st.session_state.get('show_add_time_off', False):
        with st.form("add_time_off"):
            col1, col2, col3, col4 = st.columns(4)
            
            with col1:
                employee = st.selectbox("Employee", st.session_state.roster_data['employees']['employee'].tolist())
            
            with col2:
                from_date = st.date_input("From Date", value=date(year, month, 1))
            
            with col3:
                to_date = st.date_input("To Date", value=date(year, month, 1))
            
            with col4:
                code = st.selectbox("Code", ["DO", "ML", "W", "UL", "APP", "STL", "L", "O"])
            
            if st.form_submit_button("Add"):
                new_time_off = pd.DataFrame([{
                    'employee': employee,
                    'from_date': from_date.strftime('%Y-%m-%d'),
                    'to_date': to_date.strftime('%Y-%m-%d'),
                    'code': code
                }])
                updated_time_off = pd.concat([time_off_df, new_time_off], ignore_index=True)
                st.session_state.roster_data['time_off'] = updated_time_off
                st.session_state.show_add_time_off = False
                st.rerun()
    
    # Filter time off for selected month (show ranges that overlap with the month)
    if not time_off_df.empty:
        time_off_df['from_date'] = pd.to_datetime(time_off_df['from_date'])
        time_off_df['to_date'] = pd.to_datetime(time_off_df['to_date'])
        
        # Show ranges that overlap with the selected month
        month_start = pd.Timestamp(year, month, 1)
        if month == 12:
            month_end = pd.Timestamp(year + 1, 1, 1) - pd.Timedelta(days=1)
        else:
            month_end = pd.Timestamp(year, month + 1, 1) - pd.Timedelta(days=1)
        
        month_time_off = time_off_df[
            (time_off_df['from_date'] <= month_end) & 
            (time_off_df['to_date'] >= month_start)
        ].copy()
        
        if not month_time_off.empty:
            month_time_off['from_date'] = month_time_off['from_date'].dt.strftime('%Y-%m-%d')
            month_time_off['to_date'] = month_time_off['to_date'].dt.strftime('%Y-%m-%d')
            
            # Editable dataframe
            edited_time_off = st.data_editor(
                month_time_off,
                num_rows="dynamic",
                column_config={
                    "employee": st.column_config.SelectboxColumn("Employee", options=st.session_state.roster_data['employees']['employee'].tolist()),
                    "from_date": st.column_config.TextColumn("From Date", width="medium"),
                    "to_date": st.column_config.TextColumn("To Date", width="medium"),
                    "code": st.column_config.SelectboxColumn("Code", options=["DO", "ML", "W", "UL", "APP", "STL", "L", "O"])
                },
                use_container_width=True
            )
            
            # Update data
            if not edited_time_off.equals(month_time_off):
                edited_time_off['from_date'] = pd.to_datetime(edited_time_off['from_date'])
                edited_time_off['to_date'] = pd.to_datetime(edited_time_off['to_date'])
                
                # Update the full time off dataframe
                full_time_off = time_off_df[~((time_off_df['from_date'] <= month_end) & (time_off_df['to_date'] >= month_start))]
                updated_time_off = pd.concat([full_time_off, edited_time_off], ignore_index=True)
                st.session_state.roster_data['time_off'] = updated_time_off
                st.success("✅ Time off data updated!")
        else:
            st.info(f"No time off data for {month:02d}/{year}")
    else:
        st.info("No time off data available")


def show_locks_tab(locks_df: pd.DataFrame, year: int, month: int):
    """Show locks editing tab."""
    st.subheader("🔒 Special Requirements")
    
    col1, col2 = st.columns([3, 1])
    
    with col1:
        st.markdown(f"**Force or forbid specific assignments for {month:02d}/{year}**")
    
    with col2:
        if st.button("➕ Add Lock"):
            st.session_state.show_add_lock = True
    
    # Add lock form
    if st.session_state.get('show_add_lock', False):
        with st.form("add_lock"):
            col1, col2, col3, col4, col5 = st.columns(5)
            
            with col1:
                employee = st.selectbox("Employee", st.session_state.roster_data['employees']['employee'].tolist())
            
            with col2:
                from_date = st.date_input("From Date", value=date(year, month, 1))
            
            with col3:
                to_date = st.date_input("To Date", value=date(year, month, 1))
            
            with col4:
                shift = st.selectbox("Shift", ["M", "IP", "A", "N", "M3", "M4", "H", "CL"])
            
            with col5:
                force = st.selectbox("Action", ["Force (Must)", "Forbid (Cannot)"])
            
            if st.form_submit_button("Add"):
                new_lock = pd.DataFrame([{
                    'employee': employee,
                    'from_date': from_date.strftime('%Y-%m-%d'),
                    'to_date': to_date.strftime('%Y-%m-%d'),
                    'shift': shift,
                    'force': force == "Force (Must)"
                }])
                updated_locks = pd.concat([locks_df, new_lock], ignore_index=True)
                st.session_state.roster_data['locks'] = updated_locks
                st.session_state.show_add_lock = False
                st.rerun()
    
    # Filter locks for selected month (show ranges that overlap with the month)
    if not locks_df.empty:
        locks_df['from_date'] = pd.to_datetime(locks_df['from_date'])
        locks_df['to_date'] = pd.to_datetime(locks_df['to_date'])
        
        # Show ranges that overlap with the selected month
        month_start = pd.Timestamp(year, month, 1)
        if month == 12:
            month_end = pd.Timestamp(year + 1, 1, 1) - pd.Timedelta(days=1)
        else:
            month_end = pd.Timestamp(year, month + 1, 1) - pd.Timedelta(days=1)
        
        month_locks = locks_df[
            (locks_df['from_date'] <= month_end) & 
            (locks_df['to_date'] >= month_start)
        ].copy()
        
        if not month_locks.empty:
            month_locks['from_date'] = month_locks['from_date'].dt.strftime('%Y-%m-%d')
            month_locks['to_date'] = month_locks['to_date'].dt.strftime('%Y-%m-%d')
            month_locks['force'] = month_locks['force'].map({True: "Force (Must)", False: "Forbid (Cannot)"})
            
            # Editable dataframe
            edited_locks = st.data_editor(
                month_locks,
                num_rows="dynamic",
                column_config={
                    "employee": st.column_config.SelectboxColumn("Employee", options=st.session_state.roster_data['employees']['employee'].tolist()),
                    "from_date": st.column_config.TextColumn("From Date", width="medium"),
                    "to_date": st.column_config.TextColumn("To Date", width="medium"),
                    "shift": st.column_config.SelectboxColumn("Shift", options=["M", "IP", "A", "N", "M3", "M4", "H", "CL"]),
                    "force": st.column_config.SelectboxColumn("Action", options=["Force (Must)", "Forbid (Cannot)"])
                },
                use_container_width=True
            )
            
            # Update data
            if not edited_locks.equals(month_locks):
                edited_locks['from_date'] = pd.to_datetime(edited_locks['from_date'])
                edited_locks['to_date'] = pd.to_datetime(edited_locks['to_date'])
                edited_locks['force'] = edited_locks['force'] == "Force (Must)"
                
                # Update the full locks dataframe
                full_locks = locks_df[~((locks_df['from_date'] <= month_end) & (locks_df['to_date'] >= month_start))]
                updated_locks = pd.concat([full_locks, edited_locks], ignore_index=True)
                st.session_state.roster_data['locks'] = updated_locks
                st.success("✅ Special requirements data updated!")
        else:
            st.info(f"No locks data for {month:02d}/{year}")
    else:
        st.info("No locks data available")


def show_generate_tab(roster_data: Dict[str, pd.DataFrame], year: int, month: int):
    """Show schedule generation tab."""
    st.subheader("⚙️ Generate Schedule")
    
    # Configuration
    st.markdown("**Optimization Settings**")
    
    col1, col2 = st.columns(2)
    
    with col1:
        time_limit = st.slider("Time Limit (seconds)", 30, 600, 120)
        unfilled_penalty = st.slider("Unfilled Coverage Penalty", 100, 10000, 1000, 100)
    
    with col2:
        fairness_weight = st.slider("Fairness Weight", 0.0, 50.0, 5.0, 0.5)
        switching_penalty = st.slider("Area Switching Penalty", 0.0, 20.0, 1.0, 0.1)
    
    # Generate button
    if st.button("🚀 Generate Schedule", type="primary", use_container_width=True):
        generate_schedule(roster_data, year, month, time_limit, unfilled_penalty, fairness_weight, switching_penalty)


def show_schedule_view_tab(year: int, month: int):
    """Show schedule view tab."""
    st.subheader("📅 Schedule View")
    
    if 'generated_schedule' not in st.session_state:
        st.info("Generate a schedule first using the 'Generate' tab.")
        return
    
    schedule_df = st.session_state.generated_schedule
    
    # Display options
    col1, col2 = st.columns(2)
    
    with col1:
        show_table = st.checkbox("Show Color-Coded Table", value=True)
    with col2:
        show_workload = st.checkbox("Show Employee Workload", value=False)
    
    # Display the schedule
    if show_table:
        st.subheader("📋 Detailed Schedule Table")
        st.session_state.data_manager.schedule_display.create_enhanced_schedule_table(schedule_df, month, year)
    
    if show_workload:
        st.subheader("👥 Employee Workload Analysis")
        fig = st.session_state.data_manager.schedule_display.create_employee_workload_chart(schedule_df, month, year)
        if fig.data:
            st.plotly_chart(fig, use_container_width=True)


def generate_schedule(roster_data: Dict[str, pd.DataFrame], year: int, month: int, 
                     time_limit: int, unfilled_penalty: float, fairness_weight: float, 
                     switching_penalty: float):
    """Generate schedule based on current data."""
    
    with st.spinner("Generating schedule..."):
        try:
            # Create temporary directory for data
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                
                # Save current data to CSV files
                roster_data['employees'].to_csv(temp_path / "employees.csv", index=False)
                roster_data['demands'].to_csv(temp_path / "demands.csv", index=False)
                roster_data['time_off'].to_csv(temp_path / "time_off.csv", index=False)
                roster_data['locks'].to_csv(temp_path / "locks.csv", index=False)
                
                # Create config
                config_data = {
                    "weights": {
                        "unfilled_coverage": unfilled_penalty,
                        "fairness": fairness_weight,
                        "area_switching": switching_penalty,
                        "do_after_n": 1.0
                    },
                    "rest_codes": ["DO", "ML", "W", "UL", "APP", "STL", "L", "O"],
                    "forbidden_adjacencies": [["N", "M"], ["A", "N"]],
                    "weekly_rest_minimum": 1
                }
                
                config_path = temp_path / "config.yaml"
                with open(config_path, 'w') as f:
                    yaml.dump(config_data, f)
                
                # Load data and solve
                data = RosterData(temp_path)
                data.load_data()
                
                config = RosterConfig(config_path)
                solver = RosterSolver(config)
                
                success, assignments, metrics = solver.solve(data, time_limit)
                
                if success:
                    # Create schedule dataframe
                    employees = data.get_employee_names()
                    dates = data.get_all_dates()
                    schedule_df = solver.create_schedule_dataframe(assignments, employees, dates)
                    
                    # Store results
                    st.session_state.generated_schedule = schedule_df
                    st.session_state.schedule_metrics = metrics
                    
                    st.success(f"✅ Schedule generated successfully!")
                    st.metric("Solve Time", f"{metrics.get('solve_time', 0):.2f}s")
                    st.metric("Status", metrics.get('status', 'Unknown'))
                    
                    # Show summary
                    col1, col2, col3, col4 = st.columns(4)
                    with col1:
                        st.metric("Total Assignments", len(schedule_df))
                    with col2:
                        st.metric("Employees", schedule_df['employee'].nunique())
                    with col3:
                        st.metric("Days", schedule_df['date'].nunique())
                    with col4:
                        main_shifts = len(schedule_df[schedule_df['shift'].isin(['M', 'M3', 'M4'])])
                        st.metric("Main Shifts", main_shifts)
                    
                else:
                    st.error("❌ Failed to generate schedule. Check constraints and try again.")
                    if 'metrics' in locals():
                        st.write(f"Status: {metrics.get('status', 'Unknown')}")
        
        except Exception as e:
            st.error(f"❌ Error generating schedule: {e}")
            import traceback
            st.code(traceback.format_exc())
