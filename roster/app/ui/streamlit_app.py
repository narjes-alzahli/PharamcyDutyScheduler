"""Streamlit web interface for staff rostering."""

import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import date, datetime, timedelta
from pathlib import Path
import tempfile
import io
import json
import yaml
import sys

# Add the project root to the path to resolve imports
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from roster.app.model.schema import RosterData, RosterConfig
from roster.app.model.solver import RosterSolver
from roster.app.ui.schedule_display import ScheduleDisplay
from roster.app.ui.data_manager import show_data_manager_page


def save_user_data():
    """Save user data to file for persistence."""
    user_data_file = Path("roster/app/data/user_data.json")
    user_data_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(user_data_file, 'w') as f:
        json.dump(st.session_state.user_data, f, indent=2)


def load_user_data():
    """Load user data from file."""
    user_data_file = Path("roster/app/data/user_data.json")
    
    if user_data_file.exists():
        try:
            with open(user_data_file, 'r') as f:
                content = f.read().strip()
                if content:  # Check if file is not empty
                    return json.loads(content)
        except (json.JSONDecodeError, ValueError):
            # If file is corrupted, delete it and return None
            user_data_file.unlink()
    return None


def save_login_state(username):
    """Save login state to file."""
    login_file = Path("roster/app/data/login_state.json")
    login_file.parent.mkdir(parents=True, exist_ok=True)
    
    login_data = {
        'username': username,
        'timestamp': datetime.now().isoformat()
    }
    
    with open(login_file, 'w') as f:
        json.dump(login_data, f, indent=2)


def load_login_state():
    """Load login state from file."""
    login_file = Path("roster/app/data/login_state.json")
    
    if login_file.exists():
        try:
            with open(login_file, 'r') as f:
                content = f.read().strip()
                if content:  # Check if file is not empty
                    return json.loads(content)
        except (json.JSONDecodeError, ValueError):
            # If file is corrupted, delete it and return None
            login_file.unlink()
    return None


def clear_login_state():
    """Clear login state file."""
    login_file = Path("roster/app/data/login_state.json")
    if login_file.exists():
        login_file.unlink()


def safe_strftime(date_obj, format_str='%Y-%m-%d %H:%M'):
    """Safely format a date object, handling both datetime objects and strings."""
    if hasattr(date_obj, 'strftime'):
        return date_obj.strftime(format_str)
    elif isinstance(date_obj, str):
        # If it's already a string, try to parse and reformat it
        try:
            from datetime import datetime
            parsed = datetime.fromisoformat(date_obj.replace('Z', '+00:00'))
            return parsed.strftime(format_str)
        except:
            return date_obj  # Return as-is if parsing fails
    else:
        return str(date_obj)


def save_staff_requests():
    """Save staff requests to file for persistence."""
    requests_file = Path("roster/app/data/staff_requests.json")
    requests_file.parent.mkdir(parents=True, exist_ok=True)
    
    # Convert datetime objects to strings for JSON serialization
    serializable_requests = {
        'leave_requests': [],
        'shift_requests': []
    }
    
    for req in st.session_state.staff_requests.get('leave_requests', []):
        serializable_req = req.copy()
        serializable_req['submitted_at'] = req['submitted_at'].isoformat() if hasattr(req['submitted_at'], 'isoformat') else req['submitted_at']
        serializable_req['from_date'] = req['from_date'].isoformat() if hasattr(req['from_date'], 'isoformat') else req['from_date']
        serializable_req['to_date'] = req['to_date'].isoformat() if hasattr(req['to_date'], 'isoformat') else req['to_date']
        if 'approved_at' in req:
            serializable_req['approved_at'] = req['approved_at'].isoformat() if hasattr(req['approved_at'], 'isoformat') else req['approved_at']
        serializable_requests['leave_requests'].append(serializable_req)
    
    for req in st.session_state.staff_requests.get('shift_requests', []):
        serializable_req = req.copy()
        serializable_req['submitted_at'] = req['submitted_at'].isoformat() if hasattr(req['submitted_at'], 'isoformat') else req['submitted_at']
        serializable_req['from_date'] = req['from_date'].isoformat() if hasattr(req['from_date'], 'isoformat') else req['from_date']
        serializable_req['to_date'] = req['to_date'].isoformat() if hasattr(req['to_date'], 'isoformat') else req['to_date']
        if 'approved_at' in req:
            serializable_req['approved_at'] = req['approved_at'].isoformat() if hasattr(req['approved_at'], 'isoformat') else req['approved_at']
        serializable_requests['shift_requests'].append(serializable_req)
    
    with open(requests_file, 'w') as f:
        json.dump(serializable_requests, f, indent=2)


def load_staff_requests():
    """Load staff requests from file."""
    requests_file = Path("roster/app/data/staff_requests.json")
    
    if requests_file.exists():
        try:
            with open(requests_file, 'r') as f:
                content = f.read().strip()
                if content:
                    data = json.loads(content)
                    # Convert string dates back to date objects
                    leave_requests = []
                    for req in data.get('leave_requests', []):
                        req['submitted_at'] = datetime.fromisoformat(req['submitted_at'])
                        req['from_date'] = date.fromisoformat(req['from_date'])
                        req['to_date'] = date.fromisoformat(req['to_date'])
                        leave_requests.append(req)
                    
                    shift_requests = []
                    for req in data.get('shift_requests', []):
                        req['submitted_at'] = datetime.fromisoformat(req['submitted_at'])
                        req['from_date'] = date.fromisoformat(req['from_date'])
                        req['to_date'] = date.fromisoformat(req['to_date'])
                        shift_requests.append(req)
                    
                    return {
                        'leave_requests': leave_requests,
                        'shift_requests': shift_requests
                    }
        except (json.JSONDecodeError, ValueError):
            requests_file.unlink()
    
    return {'leave_requests': [], 'shift_requests': []}


def check_authentication():
    """Check if user is logged in, if not show login form."""
    # Initialize session state
    if 'user_logged_in' not in st.session_state:
        st.session_state.user_logged_in = False
        st.session_state.current_user = None
    
    # Check for persistent login from file
    if not st.session_state.user_logged_in:
        login_state = load_login_state()
        if login_state:
            # Load user data from file
            saved_user_data = load_user_data()
            if saved_user_data and login_state['username'] in saved_user_data:
                st.session_state.user_logged_in = True
                st.session_state.current_user = saved_user_data[login_state['username']]
                return True
    
    if not st.session_state.user_logged_in:
        show_login_form()
        return False
    return True

def show_login_form():
    """Show login form."""
    st.title("🏥 Staff Rostering System")
    st.markdown("---")
    
    col1, col2, col3 = st.columns([1, 2, 1])
    
    with col2:
        st.subheader("🔐 Login")
        
        with st.form("login_form"):
            username = st.text_input("Username")
            password = st.text_input("Password", type="password")
            remember_me = st.checkbox("Remember Me", help="Keep me logged in when I refresh the page")
            submitted = st.form_submit_button("Login", type="primary")
            
            if submitted:
                # Load user data
                from roster.app.ui.data_manager import DataManager
                if 'data_manager' not in st.session_state:
                    st.session_state.data_manager = DataManager()
                
                data_manager = st.session_state.data_manager
                if 'roster_data' not in st.session_state:
                    st.session_state.roster_data = data_manager.load_initial_data()
                
                employees_df = st.session_state.roster_data['employees']
                
                # Load or initialize user data
                saved_user_data = load_user_data()
                if saved_user_data:
                    st.session_state.user_data = saved_user_data
                else:
                    # Initialize user data if not exists
                    st.session_state.user_data = {
                        'admin': {
                            'username': 'admin',
                            'password': 'admin123',
                            'employee_type': 'Manager',
                            'employee_name': 'Admin'
                        }
                    }
                    
                    # Auto-create accounts for all employees
                    for _, employee in employees_df.iterrows():
                        username_emp = employee['employee'].lower().replace(' ', '_')
                        if username_emp not in st.session_state.user_data:
                            # Make first letter lowercase for password
                            employee_name = employee['employee']
                            employee_password = f"{employee_name[0].lower()}{employee_name[1:]}123"
                            st.session_state.user_data[username_emp] = {
                                'username': username_emp,
                                'password': employee_password,
                                'employee_type': 'Staff',
                                'employee_name': employee['employee']
                            }
                    
                    # Save initial user data
                    save_user_data()
                
                # Check credentials
                if username in st.session_state.user_data:
                    user_data = st.session_state.user_data[username]
                    if user_data['password'] == password:
                        st.session_state.user_logged_in = True
                        st.session_state.current_user = user_data
                        
                        # Clear page selection when user logs in to prevent cross-user page persistence
                        if 'current_page' in st.session_state:
                            del st.session_state.current_page
                        
                        # Save login state if "Remember Me" is checked
                        if remember_me:
                            save_login_state(username)
                        
                        st.success(f"Welcome, {user_data['employee_name']}!")
                        st.rerun()
                    else:
                        st.error("Invalid password")
                else:
                    st.error("Invalid username")

def get_navigation_options():
    """Get navigation options based on user role."""
    if st.session_state.current_user['employee_type'] == 'Manager':
        return ["Roster Generator", "Monthly Roster", "Reports & Visualization", "User Management"]  # "Roster Configuration" hidden for now
    else:  # Staff
        return ["Roster Requests", "Monthly Roster", "Reports & Visualization"]


def main():
    """Main Streamlit application."""
    st.set_page_config(
        page_title="Staff Rostering System",
        page_icon="📅",
        layout="wide"
    )
    
    # Check authentication first
    if not check_authentication():
        return
    
    st.title("📅 Staff Rostering System")
    
    # Handle navigation from other pages
    default_index = 0
    if st.session_state.get("navigate_to"):
        navigate_to = st.session_state.navigate_to
        del st.session_state.navigate_to
        
        nav_options = get_navigation_options()
        if navigate_to in nav_options:
            default_index = nav_options.index(navigate_to)
    
    # Sidebar for navigation with vertical buttons
    st.sidebar.header("Navigate")
    nav_options = get_navigation_options()
    
    # Initialize current page in session state
    if 'current_page' not in st.session_state:
        st.session_state.current_page = nav_options[default_index]
    
    # Create vertical navigation buttons
    page = None
    for nav_option in nav_options:
        if st.sidebar.button(nav_option, key=f"nav_{nav_option}", use_container_width=True):
            page = nav_option
            st.session_state.current_page = nav_option
    
    # If no button clicked, use current page
    if page is None:
        page = st.session_state.current_page
    
    if page == "Roster Generator":
        show_data_manager_page()
    # elif page == "Roster Configuration":  # Hidden for now
    #     show_config_page()
    elif page == "Roster Requests":
        show_roster_requests_page()
    elif page == "Monthly Roster":
        show_schedule_page()
    elif page == "Reports & Visualization":
        show_reports_page()
    elif page == "User Management":
        show_user_management_page()

    # Minimal logout button in sidebar
    st.sidebar.markdown("---")
    
    col1, col2 = st.sidebar.columns(2)
    with col1:
        if st.button("Change Password"):
            st.session_state.show_password_form = True
    
    with col2:
        if st.button("Logout"):
            st.session_state.user_logged_in = False
            st.session_state.current_user = None
            clear_login_state()
            st.rerun()
    
    # Show password change form if requested
    if st.session_state.get('show_password_form', False):
        st.sidebar.markdown("---")
        with st.sidebar.expander("🔒 Change Password", expanded=True):
            with st.form("change_password_form"):
                current_password = st.text_input("Current Password", type="password")
                new_password = st.text_input("New Password", type="password")
                confirm_password = st.text_input("Confirm New Password", type="password")
                
                col1, col2 = st.columns(2)
                with col1:
                    submit = st.form_submit_button("Update", type="primary")
                with col2:
                    cancel = st.form_submit_button("Cancel")
                
                if submit:
                    # Validate password change
                    username = st.session_state.current_user['employee_name'].lower().replace(' ', '_')
                    if username == 'admin':
                        username = 'admin'
                    
                    if current_password == st.session_state.user_data[username]['password']:
                        if new_password == confirm_password and new_password:
                            st.session_state.user_data[username]['password'] = new_password
                            save_user_data()  # Save to file
                            st.success("✅ Password updated successfully!")
                            st.session_state.show_password_form = False
                            st.rerun()
                        else:
                            st.error("New passwords don't match or are empty.")
                    else:
                        st.error("Current password is incorrect.")
                
                if cancel:
                    st.session_state.show_password_form = False
                    st.rerun()



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
    st.header("Monthly Roster")
    
    from roster.app.ui.data_manager import load_committed_schedules
    committed_schedules = load_committed_schedules()

    # Check if there are any committed schedules
    if not committed_schedules:
        st.warning("No committed schedules available. Please generate and commit a schedule in the Roster Generator first.")
        return
    
    # Use the most recent committed schedule by default
    committed_schedule = committed_schedules[-1]  # Get the last (most recent) schedule
    schedule_df = committed_schedule['schedule_df']
    employee_df = committed_schedule['employee_df']
    
    # Month and year selection
    col1, col2 = st.columns(2)
    with col1:
        schedule_df['date'] = pd.to_datetime(schedule_df['date'])
        available_years = sorted(schedule_df['date'].dt.year.unique())
        
        # Initialize year selection in session state
        if 'monthly_roster_year' not in st.session_state:
            st.session_state.monthly_roster_year = None
        
        year_labels = ["Select Year..."] + [str(year) for year in available_years]
        
        selected_year_idx = st.selectbox("Select Year", year_labels, index=0)
        
        if selected_year_idx == "Select Year...":
            selected_year = None
            st.session_state.monthly_roster_year = None
        else:
            selected_year = int(selected_year_idx)
            st.session_state.monthly_roster_year = selected_year
    
    with col2:
        month_names = ["January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"]
        
        if selected_year is not None:
            year_data = schedule_df[schedule_df['date'].dt.year == selected_year]
            available_months_for_year = sorted(year_data['date'].dt.month.unique())
            month_options = [month_names[m-1] for m in available_months_for_year]
        else:
            month_options = []
        
        # Initialize month selection in session state
        if 'monthly_roster_month' not in st.session_state:
            st.session_state.monthly_roster_month = None
        
        month_labels = ["Select Month..."] + month_options
        
        selected_month_idx = st.selectbox("Select Month", month_labels, index=0)
        
        if selected_month_idx == "Select Month..." or selected_year is None:
            selected_month_name = None
            selected_month = None
            st.session_state.monthly_roster_month = None
        else:
            selected_month_name = selected_month_idx
            selected_month = available_months_for_year[month_options.index(selected_month_name)]
            st.session_state.monthly_roster_month = selected_month
    
    # Check if there's data for the selected year/month combination
    if selected_year is None or selected_month is None:
        st.info("Please select both a year and month to view the roster.")
        return
    
    month_data = schedule_df[
        (schedule_df['date'].dt.month == selected_month) & 
        (schedule_df['date'].dt.year == selected_year)
    ]
            
    if month_data.empty:
        st.warning(f"No schedule data available for {selected_month_name} {selected_year}")
        return

    # Display the schedule (simple - just the table with legend and download)
    schedule_display = ScheduleDisplay()
    schedule_display.create_enhanced_schedule_table(schedule_df, selected_month, selected_year, employee_df, show_summary=False)
    
    # Add big red download button
    st.markdown("---")
    col1, col2 = st.columns([2, 1])
    with col1:
        csv = month_data.to_csv(index=False)
        st.download_button(
            "Download Schedule",
            csv,
            f"schedule_{selected_year}_{selected_month:02d}.csv",
            "text/csv",
            help="Download the current month's schedule as CSV",
            use_container_width=True
        )
    
    # Add custom CSS for red button matching app style
    st.markdown("""
    <style>
    div[data-testid="stDownloadButton"] button {
        background-color: #ff4b4b !important;
        color: white !important;
        font-size: 16px !important;
        font-weight: bold !important;
        padding: 0.5rem 1rem !important;
        border-radius: 0.25rem !important;
        border: none !important;
        width: 100% !important;
    }
    div[data-testid="stDownloadButton"] button:hover {
        background-color: #ff3333 !important;
        border-color: #ff3333 !important;
    }
    </style>
    """, unsafe_allow_html=True)


def show_reports_page():
    """Show reports and visualization page."""
    st.header("Reports & Visualization")
    
    from roster.app.ui.data_manager import load_committed_schedules
    committed_schedules = load_committed_schedules()

    # Check if there are any committed schedules
    if not committed_schedules:
        st.warning("No committed schedules available. Please generate and commit a schedule in the Roster Generator first.")
        return

    # Use the most recent committed schedule by default
    committed_schedule = committed_schedules[-1]  # Get the last (most recent) schedule
    schedule_df = committed_schedule['schedule_df']
    employee_df = committed_schedule['employee_df']
    metrics = committed_schedule['metrics']
    
    # Month and year selection
    col1, col2 = st.columns(2)
    with col1:
        schedule_df['date'] = pd.to_datetime(schedule_df['date'])
        available_years = sorted(schedule_df['date'].dt.year.unique())
        
        # Initialize year selection in session state
        if 'reports_year' not in st.session_state:
            st.session_state.reports_year = None
        
        year_labels = ["Select Year..."] + [str(year) for year in available_years]
        
        selected_year_idx = st.selectbox("Select Year", year_labels, index=0)
        
        if selected_year_idx == "Select Year...":
            selected_year = None
            st.session_state.reports_year = None
        else:
            selected_year = int(selected_year_idx)
            st.session_state.reports_year = selected_year
    
    with col2:
        month_names = ["January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"]
        if selected_year is not None:
            year_data = schedule_df[schedule_df['date'].dt.year == selected_year]
            available_months_for_year = sorted(year_data['date'].dt.month.unique())
            month_options = [month_names[m-1] for m in available_months_for_year]
        else:
            month_options = []
        
        # Initialize month selection in session state
        if 'reports_month' not in st.session_state:
            st.session_state.reports_month = None
        
        month_labels = ["Select Month..."] + month_options
        
        selected_month_idx = st.selectbox("Select Month", month_labels, index=0)
        
        if selected_month_idx == "Select Month..." or selected_year is None:
            selected_month_name = None
            selected_month = None
            st.session_state.reports_month = None
        else:
            selected_month_name = selected_month_idx
            selected_month = available_months_for_year[month_options.index(selected_month_name)]
            st.session_state.reports_month = selected_month
    
    # Check if there's data for the selected year/month combination
    if selected_year is None or selected_month is None:
        st.info("Please select both a year and month to view reports.")
        return

    # Filter data for selected year/month
    month_schedule = schedule_df[
        (schedule_df['date'].dt.month == selected_month) &
        (schedule_df['date'].dt.year == selected_year)
    ]
    
    if month_schedule.empty:
        st.warning(f"No report data available for {selected_month_name} {selected_year}")
        return

    # Display analysis content from View Schedule tab
    
    # Custom CSS for bold and bigger tab names
    st.markdown("""
    <style>
    .stTabs [data-baseweb="tab-list"] button [data-testid="stMarkdownContainer"] p {
        font-size: 18px !important;
        font-weight: bold !important;
    }
    </style>
    """, unsafe_allow_html=True)
    
    # Create tabs for better organization
    tab1, tab2, tab3, tab4 = st.tabs([
        "📊 Overview", "📈 Fairness Analysis", "Employee Pending Off", "⚙️ Solver Metrics"
    ])
    
    with tab1:
        # 1. Monthly Summary
        st.subheader("📊 Monthly Overview")
        col1, col2, col3, col4 = st.columns(4)
        with col1:
            st.metric("Total Assignments", len(month_schedule))
        with col2:
            st.metric("Employees", month_schedule['employee'].nunique())
        with col3:
            st.metric("Days", month_schedule['date'].nunique())
        with col4:
            main_shifts = len(month_schedule[month_schedule['shift'].isin(['M', 'M3', 'M4'])])
            st.metric("Main Shifts", main_shifts)
        
        
    
    with tab2:
        st.subheader("📈 Fairness Analysis")
        from roster.app.ui.data_manager import DataManager
        if 'data_manager' not in st.session_state:
            st.session_state.data_manager = DataManager()
        
        st.session_state.data_manager.schedule_display.create_fairness_charts(month_schedule, selected_month, selected_year)
    
    with tab3:
        st.subheader("👥 Employee Pending Off")
        
        # Employee Pending Off Analysis
        if employee_df is not None:
            # Show key metrics
            col1, col2, col3 = st.columns(3)
            with col1:
                st.metric("Total Employees", len(employee_df))
            with col2:
                avg_pending = employee_df['pending_off'].mean()
                st.metric("Avg Pending Off", f"{avg_pending:.1f}")
            with col3:
                max_pending = employee_df['pending_off'].max()
                st.metric("Max Pending Off", f"{max_pending:.1f}")
            
            # Create pending off chart
            import plotly.graph_objects as go
            
            # Sort by pending off for better visualization
            sorted_df = employee_df.sort_values('pending_off', ascending=True)
            
            fig = go.Figure(data=go.Bar(
                x=sorted_df['employee'],
                y=sorted_df['pending_off'],
                text=sorted_df['pending_off'],
                textposition='auto',
                marker_color='#4ECDC4'
            ))
            
            fig.update_layout(
                xaxis_title="Employee",
                yaxis_title="Pending Off Days",
                height=300
            )
            
            st.plotly_chart(fig, use_container_width=True)
    
    with tab4:
        st.subheader("⚙️ Solver Metrics")
        if metrics:
            col1, col2 = st.columns(2)
            with col1:
                st.metric("Solve Time", f"{metrics.get('solve_time', 0):.2f}s")
            with col2:
                st.metric("Status", metrics.get('status', 'Unknown'))
    


def show_user_management_page():
    """Show user management page."""
    st.header("User Management")
    
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
    
    


def show_roster_requests_page():
    """Show roster requests page for staff members."""
    st.header("Roster Requests")
    
    # Load requests data from file
    if 'staff_requests' not in st.session_state:
        st.session_state.staff_requests = load_staff_requests()
    
    # Create tabs
    tab1, tab2 = st.tabs(["🏖️ Leave Requests", "🔒 Shift Requests"])
    
    with tab1:
        st.subheader("Request Leave")
        st.write("Submit a request for time off or leave.")
        
        with st.form("leave_request_form"):
            col1, col2 = st.columns(2)
            
            with col1:
                from_date = st.date_input("From Date", value=date.today())
                leave_type = st.selectbox(
                    "Leave Type",
                    ["DO", "CL", "ML", "W", "UL", "STL"],
                    help="DO: Day Off, ML: Maternity Leave, W: Workshop, UL: Unpaid Leave, STL: Study Leave"
                )
            
            with col2:
                to_date = st.date_input("To Date", value=date.today())
                reason = st.text_area("Reason (Optional)", height=100)
            
            submitted = st.form_submit_button("Submit Leave Request", type="primary")
            
            if submitted:
                if from_date > to_date:
                    st.error("From date cannot be after to date.")
                else:
                    request = {
                        'employee': st.session_state.current_user['employee_name'],
                        'from_date': from_date,
                        'to_date': to_date,
                        'leave_type': leave_type,
                        'reason': reason,
                        'status': 'Pending',
                        'submitted_at': datetime.now().isoformat(),
                        'request_id': f"LR_{len(st.session_state.staff_requests['leave_requests']) + 1}"
                    }
                    st.session_state.staff_requests['leave_requests'].append(request)
                    save_staff_requests()  # Save to file
                    st.success("✅ Leave request submitted successfully!")
                    st.rerun()
        
        # Show submitted requests
        if st.session_state.staff_requests.get('leave_requests', []):
            st.subheader("Your Leave Requests")
            leave_df_data = []
            for req in st.session_state.staff_requests.get('leave_requests', []):
                if req.get('employee') == st.session_state.current_user['employee_name']:
                    leave_df_data.append({
                        'From Date': req['from_date'],
                        'To Date': req['to_date'],
                        'Type': req['leave_type'],
                        'Reason': req['reason'],
                        'Status': req['status'],
                        'Submitted': safe_strftime(req['submitted_at'])
                    })
            
            if leave_df_data:
                leave_df = pd.DataFrame(leave_df_data)
                st.dataframe(leave_df, use_container_width=True)
    
    with tab2:
        st.subheader("Request Special Shift")
        st.write("Submit a request for a specific shift assignment.")
        
        with st.form("shift_request_form"):
            col1, col2 = st.columns(2)
            
            with col1:
                request_date = st.date_input("Date", value=date.today())
                shift_type = st.selectbox(
                    "Shift Type",
                    ["M", "IP", "A", "N", "M3", "M4", "H", "CL"],
                    help="M: Main, IP: Inpatient, A: Afternoon, N: Night, M3: M3, M4: M4, H: Harat, CL: Clinic"
                )
            
            with col2:
                request_type = st.selectbox(
                    "Request Type",
                    ["Force (Must)", "Forbid (Cannot)"],
                    help="Force: I must work this shift, Forbid: I cannot work this shift"
                )
                reason = st.text_area("Reason (Optional)", height=100)
            
            submitted = st.form_submit_button("Submit Shift Request", type="primary")
            
            if submitted:
                force = request_type == "Force (Must)"
                request = {
                    'employee': st.session_state.current_user['employee_name'],
                    'from_date': request_date,
                    'to_date': request_date,
                    'shift': shift_type,
                    'force': force,
                    'reason': reason,
                    'status': 'Pending',
                    'submitted_at': datetime.now().isoformat(),
                    'request_id': f"SR_{len(st.session_state.staff_requests['shift_requests']) + 1}"
                }
                st.session_state.staff_requests['shift_requests'].append(request)
                save_staff_requests()  # Save to file
                st.success("✅ Shift request submitted successfully!")
                st.rerun()
        
        # Show submitted requests
        if st.session_state.staff_requests.get('shift_requests', []):
            st.subheader("Your Shift Requests")
            shift_df_data = []
            for req in st.session_state.staff_requests.get('shift_requests', []):
                if req.get('employee') == st.session_state.current_user['employee_name']:
                    shift_df_data.append({
                        'Date': req['from_date'],
                        'Shift': req['shift'],
                        'Type': 'Force' if req['force'] else 'Forbid',
                        'Reason': req['reason'],
                        'Status': req['status'],
                        'Submitted': safe_strftime(req['submitted_at'])
                    })
            
            if shift_df_data:
                shift_df = pd.DataFrame(shift_df_data)
                st.dataframe(shift_df, use_container_width=True)


if __name__ == "__main__":
    main()
