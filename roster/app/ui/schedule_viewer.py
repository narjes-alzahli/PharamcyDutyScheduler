"""Standalone schedule viewer for displaying monthly rosters."""

import streamlit as st
import pandas as pd
import plotly.express as px
from datetime import date, datetime
from pathlib import Path
import sys

# Add the parent directory to the path to import our modules
sys.path.append(str(Path(__file__).parent.parent.parent))

from roster.app.ui.schedule_display import ScheduleDisplay


def main():
    """Main schedule viewer application."""
    st.set_page_config(
        page_title="Pharmacy Schedule Viewer",
        page_icon="📅",
        layout="wide"
    )
    
    st.title("📅 Pharmacy Schedule Viewer")
    st.markdown("View and analyze monthly duty rosters with color-coded displays")
    
    # File upload section
    st.sidebar.header("📁 Load Schedule Data")
    
    uploaded_file = st.sidebar.file_uploader(
        "Upload Schedule CSV",
        type=["csv"],
        help="Upload a schedule CSV file with columns: date, employee, shift"
    )
    
    # Or load from sample data
    if st.sidebar.button("Load Sample Data"):
        sample_path = Path(__file__).parent.parent / "data" / "schedule.csv"
        if sample_path.exists():
            st.session_state.schedule_df = pd.read_csv(sample_path)
            st.success("Sample data loaded!")
        else:
            st.error("Sample data not found. Please upload a CSV file.")
    
    # Check if we have data
    if 'schedule_df' not in st.session_state:
        st.info("👆 Please upload a schedule CSV file or load sample data to get started.")
        st.markdown("""
        ### Expected CSV Format:
        ```
        date,employee,shift
        2025-03-01,Idris,M
        2025-03-01,Karima,IP
        2025-03-01,Rahma,N
        ...
        ```
        """)
        return
    
    schedule_df = st.session_state.schedule_df
    
    # Initialize schedule display
    schedule_display = ScheduleDisplay()
    
    # Sidebar controls
    st.sidebar.header("🎛️ Display Controls")
    
    # Month and year selection
    schedule_df['date'] = pd.to_datetime(schedule_df['date'])
    available_years = sorted(schedule_df['date'].dt.year.unique())
    available_months = sorted(schedule_df['date'].dt.month.unique())
    
    # Initialize year selection in session state
    if 'viewer_year' not in st.session_state:
        st.session_state.viewer_year = None
    
    year_labels = ["Select Year..."] + [str(year) for year in available_years]
    
    selected_year_idx = st.sidebar.selectbox("Select Year", year_labels, index=0)
    
    if selected_year_idx == "Select Year...":
        selected_year = None
        st.session_state.viewer_year = None
    else:
        selected_year = int(selected_year_idx)
        st.session_state.viewer_year = selected_year
    
    # Filter months for selected year
    if selected_year is not None:
        year_data = schedule_df[schedule_df['date'].dt.year == selected_year]
        available_months_for_year = sorted(year_data['date'].dt.month.unique())
    else:
        available_months_for_year = []
    
    month_names = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ]
    
    month_options = [month_names[m-1] for m in available_months_for_year]
    
    # Initialize month selection in session state
    if 'viewer_month' not in st.session_state:
        st.session_state.viewer_month = None
    
    month_labels = ["Select Month..."] + month_options
    
    selected_month_idx = st.sidebar.selectbox("Select Month", month_labels, index=0)
    
    if selected_month_idx == "Select Month..." or selected_year is None:
        selected_month_name = None
        selected_month = None
        st.session_state.viewer_month = None
    else:
        selected_month_name = selected_month_idx
        selected_month = available_months_for_year[month_options.index(selected_month_name)]
        st.session_state.viewer_month = selected_month
    
    # Check if both year and month are selected
    if selected_year is None or selected_month is None:
        st.info("👆 Please select both a year and month to view the schedule.")
        return
    
    # Display options
    st.sidebar.subheader("Display Options")
    
    show_heatmap = st.sidebar.checkbox("Show Heatmap", value=True)
    show_table = st.sidebar.checkbox("Show Schedule Table", value=True)
    show_workload = st.sidebar.checkbox("Show Employee Workload", value=False)
    show_stats = st.sidebar.checkbox("Show Statistics", value=True)
    
    # Main content area
    st.header(f"📅 {selected_month_name} {selected_year} Schedule")
    
    # Display the schedule
    if show_heatmap:
        st.subheader("📊 Schedule Heatmap")
        fig = schedule_display.create_schedule_heatmap(schedule_df, selected_month, selected_year)
        if fig.data:
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.warning(f"No data available for {selected_month_name} {selected_year}")
    
    if show_table:
        st.subheader("📋 Detailed Schedule Table")
        schedule_display.create_enhanced_schedule_table(schedule_df, selected_month, selected_year, None, show_summary=True)
    
    if show_workload:
        st.subheader("👥 Employee Workload Analysis")
        
        # Show the new fairness charts
        schedule_display.create_fairness_charts(schedule_df, selected_month, selected_year)
    
    if show_stats:
        st.subheader("📊 Monthly Statistics")
        
        # Filter data for selected month
        month_data = schedule_df[
            (schedule_df['date'].dt.month == selected_month) & 
            (schedule_df['date'].dt.year == selected_year)
        ]
        
        if not month_data.empty:
            col1, col2, col3, col4 = st.columns(4)
            
            with col1:
                total_assignments = len(month_data)
                st.metric("Total Assignments", total_assignments)
            
            with col2:
                unique_employees = month_data['employee'].nunique()
                st.metric("Staff Members", unique_employees)
            
            with col3:
                working_days = len(month_data['date'].dt.date.unique())
                st.metric("Working Days", working_days)
            
            with col4:
                shift_counts = month_data['shift'].value_counts()
                main_shifts = shift_counts.get('M', 0) + shift_counts.get('M3', 0) + shift_counts.get('M4', 0)
                st.metric("Main Shifts", main_shifts)
            
            # Shift distribution
            st.subheader("📈 Shift Distribution")
            shift_counts = month_data['shift'].value_counts()
            
            col1, col2 = st.columns(2)
            
            with col1:
                fig = px.pie(
                    values=shift_counts.values,
                    names=shift_counts.index,
                    title="Shift Distribution",
                    labels={'names': 'Employee', 'values': 'Shifts'}
                )
                st.plotly_chart(fig, use_container_width=True)
            
            with col2:
                fig = px.bar(
                    x=shift_counts.index,
                    y=shift_counts.values,
                    title="Shift Counts",
                    labels={'x': 'Shift', 'y': 'Count'}
                )
                fig.update_xaxes(tickangle=45)
                st.plotly_chart(fig, use_container_width=True)
    
    # Export section
    st.subheader("📥 Export Options")
    
    col1, col2, col3 = st.columns(3)
    
    with col1:
        if st.button("📊 Export Current Month"):
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
    
    with col2:
        if st.button("📋 Export All Data"):
            csv = schedule_df.to_csv(index=False)
            st.download_button(
                "Download Full CSV",
                csv,
                "complete_schedule.csv",
                "text/csv"
            )
    
    with col3:
        if st.button("🔄 Refresh Display"):
            st.rerun()


if __name__ == "__main__":
    main()
