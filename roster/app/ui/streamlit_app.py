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
    
    # Handle navigation from other pages
    default_index = 0
    if st.session_state.get("navigate_to"):
        navigate_to = st.session_state.navigate_to
        del st.session_state.navigate_to
        if navigate_to == "Schedule View":
            default_index = 3
        elif navigate_to == "Reports":
            default_index = 4
        elif navigate_to == "User Management":
            default_index = 1
        elif navigate_to == "Roster Configuration":
            default_index = 2
    
    # Sidebar for navigation
    page = st.sidebar.selectbox(
        "Navigate",
        ["Roster Manager", "User Management", "Roster Configuration", "Schedule View", "Reports"],
        index=default_index
    )
    
    if page == "Roster Manager":
        show_data_manager_page()
    elif page == "User Management":
        show_user_management_page()
    elif page == "Roster Configuration":
        show_config_page()
    elif page == "Schedule View":
        show_schedule_page()
    elif page == "Reports":
        show_reports_page()



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
    
    # Save configuration
    st.subheader("Save Configuration")
    if st.button("Save Configuration"):
        config_yaml = yaml.dump(st.session_state.config)
        st.download_button(
            "Download Config",
            config_yaml,
            "config.yaml",
            "text/yaml"
        )


def show_schedule_page():
    """Show schedule visualization page."""
    st.header("📅 Schedule View")

    from roster.app.ui.data_manager import load_committed_schedules
    committed_schedules = load_committed_schedules()

    # Check if there are any committed schedules
    if not committed_schedules:
        st.warning("No committed schedules available. Please generate and commit a schedule in the Roster Manager first.")
        return

    # Use the most recent committed schedule by default
    committed_schedule = committed_schedules[-1]  # Get the last (most recent) schedule
    schedule_df = committed_schedule['schedule_df']
    
    # Month and year selection
    col1, col2 = st.columns(2)
    with col1:
        schedule_df['date'] = pd.to_datetime(schedule_df['date'])
        available_years = sorted(schedule_df['date'].dt.year.unique())
        selected_year = st.selectbox("Select Year", available_years, index=len(available_years) - 1)
    
    with col2:
        month_names = ["January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"]
        year_data = schedule_df[schedule_df['date'].dt.year == selected_year]
        available_months_for_year = sorted(year_data['date'].dt.month.unique())
        month_options = [month_names[m-1] for m in available_months_for_year]
        selected_month_name = st.selectbox("Select Month", month_options, index=len(month_options) - 1)
        selected_month = available_months_for_year[month_options.index(selected_month_name)]

    # Check if there's data for the selected year/month combination
    month_data = schedule_df[
        (schedule_df['date'].dt.month == selected_month) &
        (schedule_df['date'].dt.year == selected_year)
    ]
    
    if month_data.empty:
        st.warning(f"No schedule data available for {selected_month_name} {selected_year}")
        return

    # Display the schedule (simple - just the table with legend and download)
    schedule_display = ScheduleDisplay()
    schedule_display.create_enhanced_schedule_table(schedule_df, selected_month, selected_year, show_summary=False)


def show_reports_page():
    """Show reports and visualization page."""
    st.header("📈 Reports & Visualization")
    
    from roster.app.ui.data_manager import load_committed_schedules
    committed_schedules = load_committed_schedules()

    # Check if there are any committed schedules
    if not committed_schedules:
        st.warning("No committed schedules available. Please generate and commit a schedule in the Roster Manager first.")
        return

    # Use the most recent committed schedule by default
    committed_schedule = committed_schedules[-1]  # Get the last (most recent) schedule
    coverage_df = committed_schedule['coverage_df']
    employee_df = committed_schedule['employee_df']
    
    # Month and year selection
    col1, col2 = st.columns(2)
    with col1:
        coverage_df['date'] = pd.to_datetime(coverage_df['date'])
        available_years = sorted(coverage_df['date'].dt.year.unique())
        selected_year = st.selectbox("Select Year", available_years, index=len(available_years) - 1)
    
    with col2:
        month_names = ["January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"]
        year_data = coverage_df[coverage_df['date'].dt.year == selected_year]
        available_months_for_year = sorted(year_data['date'].dt.month.unique())
        month_options = [month_names[m-1] for m in available_months_for_year]
        selected_month_name = st.selectbox("Select Month", month_options, index=len(month_options) - 1)
        selected_month = available_months_for_year[month_options.index(selected_month_name)]

    # Filter data for selected year/month
    month_coverage = coverage_df[
        (coverage_df['date'].dt.month == selected_month) &
        (coverage_df['date'].dt.year == selected_year)
    ]
    
    if month_coverage.empty:
        st.warning(f"No report data available for {selected_month_name} {selected_year}")
        return

    # Coverage analysis
    st.subheader("Coverage Analysis")
    # Coverage by shift type - create summary from individual shift columns
    shift_types = ["M", "IP", "A", "N", "M3", "M4", "H", "CL"]
    shift_summary = []
    
    for shift in shift_types:
        assigned_col = f"{shift}_assigned"
        required_col = f"{shift}_required"
        shortfall_col = f"{shift}_shortfall"
        
        if assigned_col in month_coverage.columns:
            total_assigned = month_coverage[assigned_col].sum()
            total_required = month_coverage[required_col].sum()
            total_shortfall = month_coverage[shortfall_col].sum()
            
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
            barmode="group",
            color_discrete_sequence=['#2E8B57', '#FF6B6B', '#4ECDC4']
        )
        fig.update_layout(
            plot_bgcolor='rgba(0,0,0,0)',
            paper_bgcolor='rgba(0,0,0,0)',
            font=dict(size=12),
            title_font_size=16,
            xaxis_title="Shift Type",
            yaxis_title="Number of Shifts"
        )
        st.plotly_chart(fig, use_container_width=True)
    
    # Daily coverage trends - sum all shortfalls per day
    if not month_coverage.empty:
        daily_shortfall = []
        for _, row in month_coverage.iterrows():
            total_shortfall = sum(
                row.get(f"{shift}_shortfall", 0) 
                for shift in shift_types 
                if f"{shift}_shortfall" in month_coverage.columns
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
                title="Daily Coverage Shortfall",
                color_discrete_sequence=['#FF6B6B']
            )
            fig.update_layout(
                plot_bgcolor='rgba(0,0,0,0)',
                paper_bgcolor='rgba(0,0,0,0)',
                font=dict(size=12),
                title_font_size=16,
                xaxis_title="Date",
                yaxis_title="Shortfall"
            )
            fig.update_traces(line=dict(width=3))
            st.plotly_chart(fig, use_container_width=True)

    # Employee workload analysis
    st.subheader("Employee Workload Analysis")
    if employee_df is not None:
        # Night shift distribution
        fig = px.histogram(
            employee_df,
            x="night_shifts",
            title="Distribution of Night Shifts",
            nbins=10,
            color_discrete_sequence=['#4ECDC4']
        )
        fig.update_layout(
            plot_bgcolor='rgba(0,0,0,0)',
            paper_bgcolor='rgba(0,0,0,0)',
            font=dict(size=12),
            title_font_size=16,
            xaxis_title="Number of Night Shifts",
            yaxis_title="Number of Employees"
        )
        st.plotly_chart(fig, use_container_width=True)
        
        # Afternoon shift distribution
        fig = px.histogram(
            employee_df,
            x="afternoon_shifts", 
            title="Distribution of Afternoon Shifts",
            nbins=10,
            color_discrete_sequence=['#2E8B57']
        )
        fig.update_layout(
            plot_bgcolor='rgba(0,0,0,0)',
            paper_bgcolor='rgba(0,0,0,0)',
            font=dict(size=12),
            title_font_size=16,
            xaxis_title="Number of Afternoon Shifts",
            yaxis_title="Number of Employees"
        )
        st.plotly_chart(fig, use_container_width=True)
        
        # Employee workload table
        st.write("**Employee Workload Details**")
        st.dataframe(employee_df)


def show_user_management_page():
    """Show user management page."""
    st.header("👤 User Management")
    
    # Load employee data
    from roster.app.ui.data_manager import DataManager
    if 'data_manager' not in st.session_state:
        st.session_state.data_manager = DataManager()
    
    data_manager = st.session_state.data_manager
    if 'roster_data' not in st.session_state:
        st.session_state.roster_data = data_manager.load_initial_data()
    
    employees_df = st.session_state.roster_data['employees']
    
    # Initialize user data in session state if not exists
    if 'user_data' not in st.session_state:
        st.session_state.user_data = {
            'admin': {
                'username': 'admin',
                'password': 'admin123',
                'employee_type': 'Administrator',
                'employee_name': 'System Administrator'
            }
        }
        
        # Auto-create accounts for all employees
        for _, employee in employees_df.iterrows():
            username = employee['employee'].lower().replace(' ', '_')
            if username not in st.session_state.user_data:
                employee_password = f"{employee['employee']}123"  # Name + 123
                st.session_state.user_data[username] = {
                    'username': username,
                    'password': employee_password,
                    'employee_type': 'Staff',  # Default type
                    'employee_name': employee['employee']
                }
    
    st.subheader("Employee User Accounts")
    
    # Display current users
    if st.session_state.user_data:
        user_df_data = []
        for username, user_info in st.session_state.user_data.items():
            user_df_data.append({
                'Username': username,
                'Employee Name': user_info['employee_name'],
                'Employee Type': user_info['employee_type'],
                'Password': '*' * len(user_info['password'])  # Hide password
            })
        
        if user_df_data:
            user_df = pd.DataFrame(user_df_data)
            st.dataframe(user_df, use_container_width=True)
    
    st.subheader("Edit User Account")
    
    # Form to edit existing user
    with st.form("edit_user_form"):
        col1, col2 = st.columns(2)
        
        with col1:
            employee_name = st.selectbox(
                "Select Employee",
                employees_df['employee'].tolist(),
                help="Choose an employee to edit their user account"
            )
            
            username = employee_name.lower().replace(' ', '_')
            st.text_input("Username", value=username, disabled=True, help="Username cannot be changed")
        
        with col2:
            password = st.text_input(
                "New Password",
                type="password",
                help="Enter new password for this user"
            )
            
            employee_type = st.selectbox(
                "Employee Type",
                ["Staff", "Administrator"],
                help="Role/level of the employee"
            )
        
        submitted = st.form_submit_button("Update User Account", type="primary")
        
        if submitted:
            if username in st.session_state.user_data:
                # Update existing user
                if password:
                    st.session_state.user_data[username]['password'] = password
                st.session_state.user_data[username]['employee_type'] = employee_type
                st.success(f"✅ User account updated for {employee_name}!")
                st.rerun()
            else:
                st.error(f"User account for {employee_name} not found.")
    
    st.subheader("Admin Account")
    st.info("**Default Admin Account:**\n- Username: `admin`\n- Password: `admin123`\n- Type: Administrator")
    
    # Option to change admin password
    with st.expander("Change Admin Password"):
        with st.form("change_admin_password"):
            new_password = st.text_input("New Admin Password", type="password")
            confirm_password = st.text_input("Confirm New Password", type="password")
            
            if st.form_submit_button("Update Admin Password"):
                if new_password and new_password == confirm_password:
                    st.session_state.user_data['admin']['password'] = new_password
                    st.success("✅ Admin password updated successfully!")
                elif new_password != confirm_password:
                    st.error("Passwords do not match.")
                else:
                    st.error("Please enter a new password.")


if __name__ == "__main__":
    main()
