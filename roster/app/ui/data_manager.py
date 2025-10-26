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
            required_columns = ['employee', 'skill_M', 'skill_IP', 'skill_A', 'skill_N', 'skill_M3', 'skill_M4', 'skill_H', 'skill_CL', 'clinic_only', 'maxN', 'maxA', 'min_days_off', 'weight', 'pending_off']
            for col in required_columns:
                if col not in data['employees'].columns:
                    if col.startswith('skill_'):
                        data['employees'][col] = True  # Default to True for skills
                    elif col in ['clinic_only']:
                        data['employees'][col] = False if col == 'clinic_only' else True  # Default clinic_only=False, others=True
                    elif col in ['maxN', 'maxA']:
                        data['employees'][col] = 3  # Default max shifts
                    elif col == 'min_days_off':
                        data['employees'][col] = 4  # Default min days off
                    elif col == 'weight':
                        data['employees'][col] = 1.0  # Default weight
                    elif col == 'pending_off':
                        data['employees'][col] = 0.0  # Default pending off
        else:
            data['employees'] = self._create_empty_employees_df()
        
        # Load demands
        demands_path = self.data_dir / "demands.csv"
        if demands_path.exists():
            data['demands'] = pd.read_csv(demands_path)
            # Add missing columns with default values
            required_columns = ['date', 'need_M', 'need_IP', 'need_A', 'need_N', 'need_M3', 'need_M4', 'need_H', 'need_CL', 'holiday']
            for col in required_columns:
                if col not in data['demands'].columns:
                    if col.startswith('need_'):
                        data['demands'][col] = 0  # Default to 0 for requirements
                    elif col == 'holiday':
                        data['demands'][col] = None  # Default to None for holiday
                elif col == 'holiday':
                    # Handle nan values in existing holiday column
                    data['demands'][col] = data['demands'][col].fillna(None)
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
            'clinic_only', 'maxN', 'maxA', 'min_days_off', 'weight', 'pending_off'
        ])
    
    def _create_empty_demands_df(self) -> pd.DataFrame:
        """Create empty demands dataframe."""
        return pd.DataFrame(columns=[
            'date', 'need_M', 'need_IP', 'need_A', 'need_N', 'need_M3', 'need_M4', 'need_H', 'need_CL', 'holiday'
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
    st.header("📊 Roster Manager")
    
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
        "👥 Employees", "📋 Staffing Needs", "🏖️ Leave Requests", "🔒 Shift Requests", "⚙️ Generate Schedule", "📅 View Schedule"
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
                'min_days_off': 4
            }
            new_row = pd.DataFrame([new_employee])
            employees_df = pd.concat([employees_df, new_row], ignore_index=True)
            
            # Apply inference logic to the new employee
            employees_df = employees_df.copy()
            last_idx = len(employees_df) - 1
            
            # Infer values for the new employee
            
            # Infer clinic_only
            skill_columns = ['skill_M', 'skill_IP', 'skill_A', 'skill_N', 'skill_M3', 'skill_M4', 'skill_H']
            employees_df.loc[last_idx, 'clinic_only'] = (
                employees_df.loc[last_idx, 'skill_CL'] & 
                ~employees_df.loc[last_idx, skill_columns].any()
            )
            
            # Set maxN and maxA based on skills
            employees_df.loc[last_idx, 'maxN'] = 3 if employees_df.loc[last_idx, 'skill_N'] else 0
            employees_df.loc[last_idx, 'maxA'] = 6 if employees_df.loc[last_idx, 'skill_A'] else 0
            
            # Set default weight
            employees_df.loc[last_idx, 'weight'] = 1.0
            
            st.session_state.roster_data['employees'] = employees_df
            st.rerun()
    
    # Filter columns to show only the ones we want in the UI
    ui_columns = ['employee', 'skill_M', 'skill_IP', 'skill_A', 'skill_N', 'skill_M3', 'skill_M4', 'skill_H', 'skill_CL', 'pending_off']
    employees_df_ui = employees_df[ui_columns].copy()
    
    # Editable dataframe
    edited_employees_ui = st.data_editor(
        employees_df_ui,
        num_rows="dynamic",
        column_config={
            "employee": st.column_config.TextColumn("Employee", width=100),
            "skill_M": st.column_config.CheckboxColumn("Main", width="small"),
            "skill_IP": st.column_config.CheckboxColumn("Inpatient", width=100),
            "skill_A": st.column_config.CheckboxColumn("Afternoon", width=100),
            "skill_N": st.column_config.CheckboxColumn("Night", width="small"),
            "skill_M3": st.column_config.CheckboxColumn("M3", width="small"),
            "skill_M4": st.column_config.CheckboxColumn("M4", width="small"),
            "skill_H": st.column_config.CheckboxColumn("Harat", width="small"),
            "skill_CL": st.column_config.CheckboxColumn("Clinic", width="small"),
            "pending_off": st.column_config.NumberColumn("Pending Off", min_value=0, max_value=50, width=120)
        },
        use_container_width=True
    )
    
    # Update data
    if not edited_employees_ui.equals(employees_df_ui):
        # Merge the edited UI data back with the full dataframe
        edited_employees = employees_df.copy()
        for col in ui_columns:
            edited_employees[col] = edited_employees_ui[col]
        
        # Auto-infer values based on skills
        edited_employees = edited_employees.copy()
        
        
        # Infer clinic_only: True if only Clinic is checked, False otherwise
        skill_columns = ['skill_M', 'skill_IP', 'skill_A', 'skill_N', 'skill_M3', 'skill_M4', 'skill_H']
        edited_employees['clinic_only'] = (
            edited_employees['skill_CL'] & 
            ~edited_employees[skill_columns].any(axis=1)
        )
        
        # Set maxN to 3 if Night skill is checked, otherwise keep existing value
        edited_employees['maxN'] = edited_employees.apply(
            lambda row: 3 if row['skill_N'] else row.get('maxN', 0), axis=1
        )
        
        # Set maxA to 6 if Afternoon skill is checked, otherwise keep existing value
        edited_employees['maxA'] = edited_employees.apply(
            lambda row: 6 if row['skill_A'] else row.get('maxA', 0), axis=1
        )
        
        # Keep weight as default 1.0 (no need to change)
        if 'weight' not in edited_employees.columns:
            edited_employees['weight'] = 1.0
        
        st.session_state.roster_data['employees'] = edited_employees
        st.success("✅ Employee data updated!")
    
    # Summary stats
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("Total Employees", len(edited_employees_ui))
    with col2:
        st.metric("Can Work Nights", edited_employees_ui['skill_N'].sum())
    with col3:
        st.metric("Can Work Afternoons", edited_employees_ui['skill_A'].sum())
    with col4:
        st.metric("Can Work All Shifts", (edited_employees_ui[['skill_M', 'skill_IP', 'skill_A', 'skill_N', 'skill_M3', 'skill_M4', 'skill_H', 'skill_CL']].all(axis=1)).sum())


def show_demands_tab(demands_df: pd.DataFrame, year: int, month: int):
    """Show demands editing tab."""
    st.subheader("📋 Staffing Needs")
    
    if st.button("🔄 Populate Month with Daily Shift Requirements", use_container_width=True):
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
            st.info(f"No demands data for {month:02d}/{year}. Click 'Populate Month with Daily Shift Requirements' to create default demands.")
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
        st.info("No demands data available. Click 'Populate Month with Daily Shift Requirements' to create default demands.")


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
    
    if 'generated_schedule' not in st.session_state:
        st.info("Generate a schedule first using the 'Generate Schedule' tab.")
        return
    
    schedule_df = st.session_state.generated_schedule
    
    # Display options
    show_schedule = st.checkbox("Show Schedule", value=True)
    
    # Use session state to properly manage checkbox states
    if 'show_summary' not in st.session_state:
        st.session_state.show_summary = False
    if 'show_workload' not in st.session_state:
        st.session_state.show_workload = False
    
    
    show_summary = st.checkbox("Show Schedule Summary", value=st.session_state.show_summary)
    st.session_state.show_summary = show_summary
    
    show_workload = st.checkbox("Show Employee Workload", value=st.session_state.show_workload)
    st.session_state.show_workload = show_workload
    
    # Display the schedule
    if show_schedule:
        st.subheader("Schedule Table")
        employee_df = st.session_state.get('employee_df', None)
        st.session_state.data_manager.schedule_display.create_enhanced_schedule_table(schedule_df, month, year, employee_df, show_summary)
    
    # Display schedule summary
    if show_summary:
        st.subheader("Monthly Summary")
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
        
        # Shift distribution
        st.subheader("Shift Distribution")
        shift_counts = schedule_df['shift'].value_counts()
        
        col1, col2 = st.columns(2)
        
        with col1:
            import plotly.express as px
            fig = px.pie(
                values=shift_counts.values,
                names=shift_counts.index,
                title="Shift Distribution"
            )
            st.plotly_chart(fig, use_container_width=True)
        
        with col2:
            fig = px.bar(
                x=shift_counts.index,
                y=shift_counts.values,
                title="Shift Counts"
            )
            fig.update_xaxes(tickangle=45)
            st.plotly_chart(fig, use_container_width=True)
        
        # Solver metrics
        st.subheader("Solver Metrics")
        if 'schedule_metrics' in st.session_state:
            metrics = st.session_state.schedule_metrics
            col1, col2 = st.columns(2)
            with col1:
                st.metric("Solve Time", f"{metrics.get('solve_time', 0):.2f}s")
            with col2:
                st.metric("Status", metrics.get('status', 'Unknown'))
    
    if show_workload:
        st.subheader("Employee Workload Analysis")
        fig = st.session_state.data_manager.schedule_display.create_employee_workload_chart(schedule_df, month, year)
        if fig.data:
            st.plotly_chart(fig, use_container_width=True)
        
        # Display employee report with pending_off
        if 'employee_df' in st.session_state and st.session_state.employee_df is not None:
            st.subheader("Employee Report with Pending Off")
            employee_df = st.session_state.employee_df
            
            # Show key metrics
            col1, col2, col3, col4 = st.columns(4)
            with col1:
                st.metric("Total Employees", len(employee_df))
            with col2:
                avg_pending = employee_df['pending_off'].mean()
                st.metric("Avg Pending Off", f"{avg_pending:.1f}")
            with col3:
                max_pending = employee_df['pending_off'].max()
                st.metric("Max Pending Off", f"{max_pending:.1f}")
            with col4:
                total_nights = employee_df['night_shifts'].sum()
                st.metric("Total Night Shifts", total_nights)
            
            # Display the employee report table
            st.dataframe(employee_df, use_container_width=True)
    
    # Commit button section
    st.markdown("---")
    st.subheader("Commit Schedule")
    st.markdown("Once you're satisfied with the generated schedule, commit it to make it available in the main Schedule View page.")
    
    col1, col2 = st.columns([1, 2])
    with col1:
        if st.button("💾 Commit Schedule", type="primary", use_container_width=True):
            schedule_df = st.session_state.generated_schedule
            coverage_df = st.session_state.coverage_df
            employee_df = st.session_state.employee_df
            metrics = st.session_state.schedule_metrics
            commit_schedule(schedule_df, coverage_df, employee_df, metrics, year, month)


def load_committed_schedules():
    """Load committed schedules from file system."""
    committed_dir = Path(__file__).parent.parent / "data" / "committed_schedules"
    if not committed_dir.exists():
        return []
    
    committed_schedules = []
    for schedule_file in committed_dir.glob("schedule_*_schedule.csv"):
        # Extract year and month from filename
        filename = schedule_file.stem
        parts = filename.split('_')
        if len(parts) >= 3:
            year = int(parts[1])
            month = int(parts[2])
            
            # Load all related files
            prefix = f"schedule_{year}_{month:02d}"
            schedule_df = pd.read_csv(committed_dir / f"{prefix}_schedule.csv")
            coverage_df = pd.read_csv(committed_dir / f"{prefix}_coverage.csv")
            employee_df = pd.read_csv(committed_dir / f"{prefix}_employee.csv")
            
            # Load metrics
            import json
            metrics_file = committed_dir / f"{prefix}_metrics.json"
            if metrics_file.exists():
                with open(metrics_file, 'r') as f:
                    metrics = json.load(f)
            else:
                metrics = {}
            
            committed_schedules.append({
                'year': year,
                'month': month,
                'schedule_df': schedule_df,
                'coverage_df': coverage_df,
                'employee_df': employee_df,
                'metrics': metrics
            })
    
    return committed_schedules


def commit_schedule(schedule_df: pd.DataFrame, coverage_df: pd.DataFrame, 
                   employee_df: pd.DataFrame, metrics: Dict, year: int, month: int):
    """Commit a generated schedule to persistent storage."""
    from datetime import date, datetime
    import json
    
    try:
        # Create committed schedules directory if it doesn't exist
        committed_dir = Path(__file__).parent.parent / "data" / "committed_schedules"
        committed_dir.mkdir(exist_ok=True)
        
        # Create filename with year and month
        filename_prefix = f"schedule_{year}_{month:02d}"
        
        # Save schedule data
        schedule_df.to_csv(committed_dir / f"{filename_prefix}_schedule.csv", index=False)
        coverage_df.to_csv(committed_dir / f"{filename_prefix}_coverage.csv", index=False)
        employee_df.to_csv(committed_dir / f"{filename_prefix}_employee.csv", index=False)
        
        # Save metrics
        # Convert any date objects to strings for JSON serialization
        def convert_dates(obj):
            if isinstance(obj, dict):
                return {str(k) if isinstance(k, (date, datetime)) else k: convert_dates(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_dates(item) for item in obj]
            elif isinstance(obj, (date, datetime)):
                return obj.isoformat()
            else:
                return obj
        
        serializable_metrics = convert_dates(metrics)
        with open(committed_dir / f"{filename_prefix}_metrics.json", 'w') as f:
            json.dump(serializable_metrics, f, indent=2)
        
        # Update session state to mark as committed
        st.session_state.committed_schedule = {
            'schedule_df': schedule_df,
            'coverage_df': coverage_df,
            'employee_df': employee_df,
            'metrics': metrics,
            'year': year,
            'month': month,
            'committed_at': pd.Timestamp.now()
        }
        
        st.success(f"✅ Schedule for {year}-{month:02d} committed successfully!")
        st.info("The committed schedule is now available in Schedule View and Reports pages.")
        
        # Auto-navigate to Schedule View page
        st.markdown("**🎯 Schedule committed!** You can now view it in the Schedule View page.")
        if st.button("📅 Go to Schedule View", type="secondary"):
            st.session_state.navigate_to = "Schedule View"
            st.rerun()
        
    except Exception as e:
        st.error(f"❌ Error committing schedule: {e}")
        import traceback
        st.code(traceback.format_exc())


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
                    
                    # Create additional reports
                    demands = {day: data.get_daily_requirement(day) for day in dates}
                    coverage_df = solver.create_coverage_report(assignments, employees, dates, demands)
                    
                    # Get initial pending_off values from employee data
                    initial_pending_off = {}
                    for emp_data in data.employees:
                        initial_pending_off[emp_data.employee] = emp_data.pending_off
                    
                    employee_df = solver.create_employee_report(assignments, employees, dates, demands, initial_pending_off)
                    
                    # Store results
                    st.session_state.generated_schedule = schedule_df
                    st.session_state.schedule_metrics = metrics
                    st.session_state.coverage_df = coverage_df
                    st.session_state.employee_df = employee_df
                    
                    st.success(f"✅ Schedule generated successfully! Go to the 'View Schedule' tab to review and commit it.")
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
