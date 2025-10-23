"""Streamlit web interface for staff rostering."""

import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import date, datetime, timedelta
from pathlib import Path
import tempfile
import io
import yaml
import sys

# Add the project root to the path to resolve imports
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from roster.app.model.schema import RosterData, RosterConfig
from roster.app.model.solver import RosterSolver
from roster.app.ui.schedule_display import ScheduleDisplay
from roster.app.ui.data_manager import show_data_manager_page


def main():
    """Main Streamlit application."""
    st.set_page_config(
        page_title="Staff Rostering System",
        page_icon="📅",
        layout="wide"
    )
    
    st.title("📅 Staff Rostering System")
    
    # Sidebar for navigation
    page = st.sidebar.selectbox(
        "Navigate",
        ["Data Manager", "Input Data", "Configuration", "Solve & Results", "Schedule View", "Reports"]
    )
    
    if page == "Data Manager":
        show_data_manager_page()
    elif page == "Input Data":
        show_input_page()
    elif page == "Configuration":
        show_config_page()
    elif page == "Solve & Results":
        show_solve_page()
    elif page == "Schedule View":
        show_schedule_page()
    elif page == "Reports":
        show_reports_page()


def show_input_page():
    """Show input data upload and management page."""
    st.header("📊 Input Data")
    
    # File upload section
    st.subheader("Upload CSV Files")
    
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("**Required Files**")
        employees_file = st.file_uploader(
            "Employees CSV",
            type=["csv"],
            help="employee,skill_M,skill_IP,skill_A,skill_N,skill_M3,skill_M4,skill_H,skill_CL,clinic_only,ip_ok,harat_ok,maxN,maxA,min_days_off,weight"
        )
        
        demands_file = st.file_uploader(
            "Daily Requirements CSV", 
            type=["csv"],
            help="date,need_M,need_IP,need_A,need_N,need_M3,need_M4,need_H,need_CL"
        )
    
    with col2:
        st.markdown("**Optional Files**")
        time_off_file = st.file_uploader(
            "Leave CSV",
            type=["csv"],
            help="employee,from_date,to_date,code (or employee,date,code)"
        )
        
        locks_file = st.file_uploader(
            "Special Requirements CSV",
            type=["csv"], 
            help="employee,from_date,to_date,shift,force (or employee,date,shift,force)"
        )
    
    # Process uploaded files
    if employees_file is not None:
        try:
            st.session_state["employees_df"] = pd.read_csv(employees_file)
            st.success("✅ Employees data loaded!")
        except Exception as e:
            st.error(f"Error loading employees file: {e}")
    
    if demands_file is not None:
        try:
            demands_df = pd.read_csv(demands_file)
            demands_df['date'] = pd.to_datetime(demands_df['date']).dt.date
            st.session_state["demands_df"] = demands_df
            st.success("✅ Demands data loaded!")
        except Exception as e:
            st.error(f"Error loading demands file: {e}")
    
    if time_off_file is not None:
        try:
            time_off_df = pd.read_csv(time_off_file)
            # Handle different date column formats
            if 'date' in time_off_df.columns:
                time_off_df['date'] = pd.to_datetime(time_off_df['date']).dt.date
            elif 'from_date' in time_off_df.columns:
                # Convert from_date to date for compatibility
                time_off_df['date'] = pd.to_datetime(time_off_df['from_date']).dt.date
            st.session_state["time_off_df"] = time_off_df
            st.success("✅ Time off data loaded!")
        except Exception as e:
            st.error(f"Error loading time off file: {e}")
    
    if locks_file is not None:
        try:
            locks_df = pd.read_csv(locks_file)
            # Handle different date column formats
            if 'date' in locks_df.columns:
                locks_df['date'] = pd.to_datetime(locks_df['date']).dt.date
            elif 'from_date' in locks_df.columns:
                # Convert from_date to date for compatibility
                locks_df['date'] = pd.to_datetime(locks_df['from_date']).dt.date
            st.session_state["locks_df"] = locks_df
            st.success("✅ Locks data loaded!")
        except Exception as e:
            st.error(f"Error loading locks file: {e}")
    
    # Sample data section
    st.subheader("📋 Sample Data")
    if st.button("Load Sample Data"):
        load_sample_data()
        st.success("Sample data loaded! You can now proceed to Configuration.")
    
    # Data preview
    if st.session_state.get("employees_df") is not None:
        st.subheader("Data Preview")
        
        tab1, tab2, tab3, tab4 = st.tabs(["Employees", "Daily Requirements", "Leave", "Special Requirements"])
        
        with tab1:
            if st.session_state.get("employees_df") is not None:
                st.dataframe(st.session_state["employees_df"])
                
        with tab2:
            if st.session_state.get("demands_df") is not None:
                st.dataframe(st.session_state["demands_df"])
                
        with tab3:
            if st.session_state.get("time_off_df") is not None:
                st.dataframe(st.session_state["time_off_df"])
            else:
                st.info("No time off data loaded")
                
        with tab4:
            if st.session_state.get("locks_df") is not None:
                st.dataframe(st.session_state["locks_df"])
            else:
                st.info("No locks data loaded")


def show_config_page():
    """Show configuration page."""
    st.header("⚙️ Configuration")
    
    # Initialize default config
    if "config" not in st.session_state:
        st.session_state.config = {
            "weights": {
                "unfilled_coverage": 1000.0,
                "fairness": 5.0,
                "area_switching": 1.0,
                "do_after_n": 1.0
            },
            "rest_codes": ["DO", "ML", "W"],
            "forbidden_adjacencies": [["N", "M"], ["A", "N"]],
            "weekly_rest_minimum": 1
        }
    
    # Objective weights
    st.subheader("Objective Weights")
    col1, col2 = st.columns(2)
    
    with col1:
        st.session_state.config["weights"]["unfilled_coverage"] = st.slider(
            "Unfilled Coverage Penalty",
            min_value=100.0,
            max_value=10000.0,
            value=st.session_state.config["weights"]["unfilled_coverage"],
            step=100.0,
            help="Penalty for not meeting coverage requirements"
        )
        
        st.session_state.config["weights"]["fairness"] = st.slider(
            "Fairness Weight",
            min_value=0.0,
            max_value=50.0,
            value=st.session_state.config["weights"]["fairness"],
            step=0.5,
            help="Weight for fair distribution of shifts"
        )
    
    with col2:
        st.session_state.config["weights"]["area_switching"] = st.slider(
            "Area Switching Penalty",
            min_value=0.0,
            max_value=20.0,
            value=st.session_state.config["weights"]["area_switching"],
            step=0.1,
            help="Penalty for switching between different areas"
        )
        
        st.session_state.config["weights"]["do_after_n"] = st.slider(
            "DO After N Reward",
            min_value=0.0,
            max_value=10.0,
            value=st.session_state.config["weights"]["do_after_n"],
            step=0.1,
            help="Reward for day off after night shift"
        )
    
    # Rest codes
    st.subheader("Rest Codes")
    st.session_state.config["rest_codes"] = st.multiselect(
        "Codes that count as rest days",
        options=["DO", "O", "ML", "W", "UL", "APP", "STL", "L"],
        default=st.session_state.config["rest_codes"],
        help="Select which codes count as rest days for weekly rest constraints"
    )
    
    # Weekly rest minimum
    st.session_state.config["weekly_rest_minimum"] = st.slider(
        "Minimum rest days per week",
        min_value=1,
        max_value=3,
        value=st.session_state.config["weekly_rest_minimum"],
        help="Minimum number of rest days required per 7-day window"
    )
    
    # Forbidden adjacencies
    st.subheader("Forbidden Adjacencies")
    st.markdown("Configure which shift sequences are not allowed")
    
    # Add new adjacency
    col1, col2, col3 = st.columns([2, 2, 1])
    with col1:
        new_from = st.selectbox("From Shift", ["M", "O", "IP", "A", "N", "DO"])
    with col2:
        new_to = st.selectbox("To Shift", ["M", "O", "IP", "A", "N", "DO"])
    with col3:
        if st.button("Add"):
            new_pair = [new_from, new_to]
            if new_pair not in st.session_state.config["forbidden_adjacencies"]:
                st.session_state.config["forbidden_adjacencies"].append(new_pair)
                st.rerun()
    
    # Display current adjacencies
    for i, pair in enumerate(st.session_state.config["forbidden_adjacencies"]):
        col1, col2, col3 = st.columns([2, 2, 1])
        with col1:
            st.write(f"**{pair[0]}**")
        with col2:
            st.write(f"**{pair[1]}**")
        with col3:
            if st.button("Remove", key=f"remove_{i}"):
                st.session_state.config["forbidden_adjacencies"].pop(i)
                st.rerun()
    
    # Save/Load config
    st.subheader("Configuration Management")
    col1, col2 = st.columns(2)
    
    with col1:
        if st.button("Save Configuration"):
            config_yaml = yaml.dump(st.session_state.config)
            st.download_button(
                "Download Config",
                config_yaml,
                "config.yaml",
                "text/yaml"
            )
    
    with col2:
        config_file = st.file_uploader("Load Configuration", type=["yaml", "yml"])
        if config_file:
            try:
                config_data = yaml.safe_load(config_file)
                st.session_state.config.update(config_data)
                st.success("Configuration loaded successfully!")
                st.rerun()
            except Exception as e:
                st.error(f"Error loading configuration: {e}")


def show_solve_page():
    """Show solve and results page."""
    st.header("🔧 Solve & Results")
    
    # Check if data is loaded
    if st.session_state.get("employees_df") is None:
        st.warning("Please load input data first in the Input Data page.")
        return
    
    # Solve parameters
    st.subheader("Solve Parameters")
    col1, col2 = st.columns(2)
    
    with col1:
        time_limit = st.slider(
            "Time Limit (seconds)",
            min_value=30,
            max_value=1800,
            value=300,
            step=30,
            help="Maximum time to spend solving"
        )
    
    with col2:
        if st.button("🚀 Solve Roster", type="primary"):
            solve_roster_ui(time_limit)
    
    # Results display
    if st.session_state.get("solution_success"):
        st.success("✅ Roster solved successfully!")
        
        # Solution metrics
        metrics = st.session_state.get("solution_metrics", {})
        col1, col2, col3, col4 = st.columns(4)
        
        with col1:
            st.metric("Solve Time", f"{metrics.get('solve_time', 0):.2f}s")
        with col2:
            st.metric("Status", metrics.get('status', 'Unknown'))
        with col3:
            st.metric("Night Variance", f"{metrics.get('fairness', {}).get('night_variance', 0):.2f}")
        with col4:
            st.metric("Evening Variance", f"{metrics.get('fairness', {}).get('evening_variance', 0):.2f}")
        
        # Download buttons
        st.subheader("📥 Download Results")
        col1, col2, col3, col4 = st.columns(4)
        
        with col1:
            schedule_csv = st.session_state.get("schedule_df").to_csv(index=False)
            st.download_button(
                "Download Schedule",
                schedule_csv,
                "schedule.csv",
                "text/csv"
            )
        
        with col2:
            coverage_csv = st.session_state.get("coverage_df").to_csv(index=False)
            st.download_button(
                "Download Coverage Report",
                coverage_csv,
                "coverage_report.csv",
                "text/csv"
            )
        
        with col3:
            employee_csv = st.session_state.get("employee_df").to_csv(index=False)
            st.download_button(
                "Download Employee Report",
                employee_csv,
                "per_employee_report.csv",
                "text/csv"
            )
        
        with col4:
            metrics_csv = pd.DataFrame([metrics]).to_csv(index=False)
            st.download_button(
                "Download Metrics",
                metrics_csv,
                "metrics.csv",
                "text/csv"
            )
    
    elif st.session_state.get("solution_success") is False:
        st.error("❌ Failed to solve roster. Check constraints and try again.")


def show_schedule_page():
    """Show schedule visualization page."""
    st.header("📅 Schedule View")
    
    if not st.session_state.get("solution_success"):
        st.warning("Please solve a roster first to view the schedule.")
        return
    
    schedule_df = st.session_state.get("schedule_df")
    if schedule_df is None:
        st.error("No schedule data available.")
        return
    
    # Initialize schedule display
    schedule_display = ScheduleDisplay()
    
    # Month and year selection
    col1, col2 = st.columns(2)
    
    with col1:
        # Extract available months and years from the data
        schedule_df['date'] = pd.to_datetime(schedule_df['date'])
        available_months = sorted(schedule_df['date'].dt.month.unique())
        available_years = sorted(schedule_df['date'].dt.year.unique())
        
        selected_year = st.selectbox(
            "Select Year",
            available_years,
            index=len(available_years) - 1  # Default to latest year
        )
    
    with col2:
        month_names = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ]
        
        # Filter months available for selected year
        year_data = schedule_df[schedule_df['date'].dt.year == selected_year]
        available_months_for_year = sorted(year_data['date'].dt.month.unique())
        
        month_options = [month_names[m-1] for m in available_months_for_year]
        selected_month_name = st.selectbox(
            "Select Month",
            month_options,
            index=len(month_options) - 1  # Default to latest month
        )
        
        selected_month = available_months_for_year[month_options.index(selected_month_name)]
    
    # Display options
    st.subheader("Display Options")
    
    col1, col2 = st.columns(2)
    
    with col1:
        show_table = st.checkbox("Show Color-Coded Table", value=True)
    
    with col2:
        show_workload = st.checkbox("Show Employee Workload", value=False)
    
    # Display the schedule
    if show_table:
        st.subheader("📋 Detailed Schedule Table")
        schedule_display.create_enhanced_schedule_table(schedule_df, selected_month, selected_year)
    
    if show_workload:
        st.subheader("👥 Employee Workload Analysis")
        fig = schedule_display.create_employee_workload_chart(schedule_df, selected_month, selected_year)
        if fig.data:
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.warning(f"No workload data available for {selected_month_name} {selected_year}")
    
    # Additional controls
    st.subheader("🔧 Additional Controls")
    
    col1, col2 = st.columns(2)
    
    with col1:
        if st.button("🔄 Refresh Display"):
            st.rerun()
    
    with col2:
        # Export options
        if st.button("📥 Export Schedule"):
            # Create a filtered dataframe for the selected month
            month_data = schedule_df[
                (schedule_df['date'].dt.month == selected_month) & 
                (schedule_df['date'].dt.year == selected_year)
            ]
            
            csv = month_data.to_csv(index=False)
            st.download_button(
                "Download CSV",
                csv,
                f"schedule_{selected_year}_{selected_month:02d}.csv",
                "text/csv"
            )


def show_reports_page():
    """Show reports and visualization page."""
    st.header("📈 Reports & Visualization")
    
    if not st.session_state.get("solution_success"):
        st.warning("Please solve a roster first to view reports.")
        return
    
    # Coverage analysis
    st.subheader("📊 Coverage Analysis")
    coverage_df = st.session_state.get("coverage_df")
    if coverage_df is not None:
        # Coverage by shift type - create summary from individual shift columns
        shift_types = ["M", "IP", "A", "N", "M3", "M4", "H", "CL"]
        shift_summary = []
        
        for shift in shift_types:
            assigned_col = f"{shift}_assigned"
            required_col = f"{shift}_required"
            shortfall_col = f"{shift}_shortfall"
            
            if assigned_col in coverage_df.columns:
                total_assigned = coverage_df[assigned_col].sum()
                total_required = coverage_df[required_col].sum()
                total_shortfall = coverage_df[shortfall_col].sum()
                
                shift_summary.append({
                    "shift": shift,
                    "assigned": total_assigned,
                    "required": total_required,
                    "shortfall": total_shortfall
                })
        
        if shift_summary:
            shift_coverage = pd.DataFrame(shift_summary)
            
            fig = px.bar(
                shift_coverage,
                x="shift",
                y=["required", "assigned", "shortfall"],
                title="Coverage by Shift Type",
                barmode="group"
            )
            st.plotly_chart(fig, use_container_width=True)
        
        # Daily coverage trends - sum all shortfalls per day
        if coverage_df is not None and not coverage_df.empty:
            daily_shortfall = []
            for _, row in coverage_df.iterrows():
                total_shortfall = sum(
                    row.get(f"{shift}_shortfall", 0) 
                    for shift in shift_types 
                    if f"{shift}_shortfall" in coverage_df.columns
                )
                daily_shortfall.append({
                    "date": row["date"],
                    "shortfall": total_shortfall
                })
            
            if daily_shortfall:
                daily_coverage = pd.DataFrame(daily_shortfall)
                
                fig = px.line(
                    daily_coverage,
                    x="date",
                    y="shortfall",
                    title="Daily Coverage Shortfall"
                )
                st.plotly_chart(fig, use_container_width=True)
    
    # Employee workload analysis
    st.subheader("👥 Employee Workload Analysis")
    employee_df = st.session_state.get("employee_df")
    if employee_df is not None:
        # Night shift distribution
        fig = px.histogram(
            employee_df,
            x="night_shifts",
            title="Distribution of Night Shifts",
            nbins=10
        )
        st.plotly_chart(fig, use_container_width=True)
        
        # Afternoon shift distribution
        fig = px.histogram(
            employee_df,
            x="afternoon_shifts", 
            title="Distribution of Afternoon Shifts",
            nbins=10
        )
        st.plotly_chart(fig, use_container_width=True)
        
        # Employee workload table
        st.dataframe(employee_df)


def load_sample_data():
    """Load sample data for demonstration."""
    # Sample employees
    employees_data = {
        "employee": ["Idris", "Karima", "Rahma", "Noor", "Ameera", "Shatha", "Rasha", "Layla"],
        "skill_M": [1, 1, 1, 1, 1, 1, 1, 1],
        "skill_M3": [1, 1, 1, 1, 1, 1, 1, 1],
        "skill_M4": [1, 1, 1, 1, 1, 1, 1, 1],
        "skill_H": [1, 1, 1, 1, 1, 1, 1, 1],
        "skill_CL": [1, 1, 1, 1, 1, 1, 1, 1],
        "skill_IP": [0, 1, 1, 1, 1, 1, 1, 1],
        "skill_A": [1, 1, 0, 1, 1, 1, 1, 1],
        "skill_N": [0, 1, 1, 1, 1, 1, 1, 1],
        "clinic_only": [0, 0, 0, 0, 0, 0, 0, 0],
        "ip_ok": [1, 1, 1, 1, 1, 1, 1, 1],
        "harat_ok": [1, 1, 1, 1, 1, 1, 1, 1],
        "maxN": [0, 3, 3, 3, 3, 3, 3, 3],
        "maxA": [6, 6, 5, 6, 6, 6, 6, 6],
        "min_days_off": [4, 4, 4, 4, 4, 4, 4, 4],
        "weight": [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]
    }
    st.session_state["employees_df"] = pd.DataFrame(employees_data)
    
    # Sample demands (one week)
    start_date = date(2025, 3, 1)
    end_date = date(2025, 3, 7)
    demands_data = []
    for i in range(7):
        current_date = start_date + timedelta(days=i)
        demands_data.append({
            "date": current_date,
            "from_date": start_date,
            "to_date": end_date,
            "need_M": 2,
            "need_IP": 2,
            "need_A": 1,
            "need_N": 1,
            "need_M3": 2,
            "need_M4": 2,
            "need_H": 1,
            "need_CL": 0
        })
    st.session_state["demands_df"] = pd.DataFrame(demands_data)
    
    # Sample time off
    time_off_data = [
        {"employee": "Rasha", "from_date": date(2025, 3, 5), "to_date": date(2025, 3, 5), "code": "CL"},
        {"employee": "Ameera", "from_date": date(2025, 3, 10), "to_date": date(2025, 3, 10), "code": "W"}
    ]
    st.session_state["time_off_df"] = pd.DataFrame(time_off_data)
    
    # Sample locks
    locks_data = [
        {"employee": "Ameera", "from_date": date(2025, 3, 12), "to_date": date(2025, 3, 12), "shift": "APP", "force": 1},
        {"employee": "Shatha", "from_date": date(2025, 3, 14), "to_date": date(2025, 3, 14), "shift": "N", "force": 0}
    ]
    st.session_state["locks_df"] = pd.DataFrame(locks_data)


def solve_roster_ui(time_limit: int):
    """Solve roster using the UI data."""
    try:
        # Create temporary directory for data
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # Save dataframes to CSV files
            st.session_state["employees_df"].to_csv(temp_path / "employees.csv", index=False)
            st.session_state["demands_df"].to_csv(temp_path / "demands.csv", index=False)
            
            if st.session_state.get("time_off_df") is not None:
                st.session_state["time_off_df"].to_csv(temp_path / "time_off.csv", index=False)
            
            if st.session_state.get("locks_df") is not None:
                st.session_state["locks_df"].to_csv(temp_path / "locks.csv", index=False)
            
            # Create config file
            config_path = temp_path / "config.yaml"
            with open(config_path, 'w') as f:
                yaml.dump(st.session_state.get("config", {}), f)
            
            # Load data
            data = RosterData(temp_path)
            data.load_data()
            
            # Create config
            config = RosterConfig(config_path)
            
            # Create solver
            solver = RosterSolver(config)
            
            # Solve
            with st.spinner("Solving roster..."):
                success, assignments, metrics = solver.solve(data, time_limit)
            
            if success:
                st.session_state["solution_success"] = True
                st.session_state["solution_metrics"] = metrics
                
                # Create result dataframes
                employees = data.get_employee_names()
                dates = data.get_all_dates()
                
                st.session_state["schedule_df"] = solver.create_schedule_dataframe(
                    assignments, employees, dates
                )
                
                demands = {day: data.get_daily_requirement(day) for day in dates}
                st.session_state["coverage_df"] = solver.create_coverage_report(
                    assignments, employees, dates, demands
                )
                
                st.session_state["employee_df"] = solver.create_employee_report(
                    assignments, employees, dates
                )
                
            else:
                st.session_state["solution_success"] = False
                
    except Exception as e:
        st.error(f"Error solving roster: {e}")
        st.session_state["solution_success"] = False


if __name__ == "__main__":
    main()
