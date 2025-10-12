"""Schedule display component for visual roster representation."""

import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import plotly.express as px
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple
import numpy as np


class ScheduleDisplay:
    """Component for displaying schedule in a visual roster format."""
    
    def __init__(self):
        self.shift_colors = {
            'M': '#FFFFFF',      # White - Main shift
            'O': '#E6F3FF',      # Light blue - Outpatient  
            'IP': '#F0F8FF',     # Very light blue - Inpatient
            'A': '#FFA500',      # Orange - Evening (2:30 PM - 9:30 PM)
            'N': '#FFFF00',      # Yellow - Night (9:30 PM - 7 AM)
            'DO': '#90EE90',     # Light green - Day Off
            'CL': '#FFB6C1',     # Light pink - Casual Leave
            'ML': '#DDA0DD',     # Plum - Maternity Leave
            'W': '#D8BFD8',      # Thistle - Workshop
            'UL': '#F5F5F5',     # Light gray - Unpaid Leave
            'H': '#FFE4E1',      # Misty rose - Holiday
            'STL': '#B0E0E6',    # Powder blue - Study Leave
            'ATT': '#E0E0E0',    # Light gray - Attending
            'APP': '#FF6B6B',    # Light red - Approved
            'RT': '#87CEEB',     # Sky blue - Return
            'EV': '#DDA0DD',     # Plum - Event
            'P': '#FFA07A',      # Light salmon - Pharmacy
            'M+P': '#FFB6C1',    # Light pink - Main + Pharmacy
            'IP+P': '#FFB6C1',   # Light pink - IP + Pharmacy
            'M3': '#FFFFFF',     # White - M3 shift
            'M4': '#FFFFFF',     # White - M4 shift
            'M3+P': '#FFB6C1',   # Light pink - M3 + Pharmacy
            'DR+M': '#FFB6C1',   # Light pink - Doctor + Main
            'V+P': '#FF6B6B',    # Light red - V + Pharmacy
            'C': '#F0F8FF',      # Very light blue - Clinic
            'L': '#F5F5F5',      # Light gray - Leave
            '0': '#FFFFFF',      # White - Empty/Default
        }
        
        self.shift_labels = {
            'M': 'Main',
            'O': 'Outpatient', 
            'IP': 'Inpatient',
            'A': 'Evening (2:30-9:30 PM)',
            'N': 'Night (9:30 PM-7 AM)',
            'DO': 'Day Off',
            'CL': 'Casual Leave',
            'ML': 'Maternity Leave',
            'W': 'Workshop',
            'UL': 'Unpaid Leave',
            'H': 'Holiday',
            'STL': 'Study Leave',
            'ATT': 'Attending',
            'APP': 'Approved',
            'RT': 'Return',
            'EV': 'Event',
            'P': 'Pharmacy',
            'M+P': 'Main + Pharmacy',
            'IP+P': 'IP + Pharmacy',
            'M3': 'M3 Shift',
            'M4': 'M4 Shift',
            'M3+P': 'M3 + Pharmacy',
            'DR+M': 'Doctor + Main',
            'V+P': 'V + Pharmacy',
            'C': 'Clinic',
            'L': 'Leave',
            '0': 'Empty'
        }
    
    def create_schedule_heatmap(
        self, 
        schedule_df: pd.DataFrame, 
        month: int, 
        year: int,
        show_legend: bool = True
    ) -> go.Figure:
        """Create a heatmap visualization of the schedule."""
        
        # Filter data for the specific month
        schedule_df['date'] = pd.to_datetime(schedule_df['date'])
        month_data = schedule_df[
            (schedule_df['date'].dt.month == month) & 
            (schedule_df['date'].dt.year == year)
        ].copy()
        
        if month_data.empty:
            st.warning(f"No data found for {year}-{month:02d}")
            return go.Figure()
        
        # Create pivot table
        pivot_data = month_data.pivot_table(
            index='employee',
            columns='date',
            values='shift',
            aggfunc='first',
            fill_value=''
        )
        
        # Get all unique shifts for color mapping
        all_shifts = set(month_data['shift'].unique())
        all_shifts.discard('')  # Remove empty strings
        
        # Create color scale
        colors = []
        for shift in all_shifts:
            if shift in self.shift_colors:
                colors.append(self.shift_colors[shift])
            else:
                colors.append('#FFFFFF')  # Default white
        
        # Create the heatmap
        fig = go.Figure(data=go.Heatmap(
            z=[[1 if cell != '' else 0 for cell in row] for row in pivot_data.values],
            x=[d.strftime('%d') for d in pivot_data.columns],
            y=pivot_data.index,
            text=pivot_data.values,
            texttemplate="%{text}",
            textfont={"size": 10},
            colorscale=[[0, '#FFFFFF'], [1, '#E0E0E0']],  # Simple binary scale
            showscale=False,
            hoverongaps=False,
            hovertemplate="<b>%{y}</b><br>Date: %{x}<br>Shift: %{text}<extra></extra>"
        ))
        
        # Update layout
        fig.update_layout(
            title=f"Pharmacy Department Duty Roster {year} - {self._get_month_name(month)}",
            xaxis_title="Date",
            yaxis_title="Staff",
            height=max(400, len(pivot_data) * 25 + 100),
            width=max(800, len(pivot_data.columns) * 25 + 200),
            font=dict(size=10)
        )
        
        # Rotate x-axis labels
        fig.update_xaxes(tickangle=0)
        
        return fig
    
    def create_enhanced_schedule_table(
        self, 
        schedule_df: pd.DataFrame, 
        month: int, 
        year: int
    ) -> None:
        """Create an enhanced HTML table with color coding similar to the pharmacy rosters."""
        
        # Filter data for the specific month
        schedule_df['date'] = pd.to_datetime(schedule_df['date'])
        month_data = schedule_df[
            (schedule_df['date'].dt.month == month) & 
            (schedule_df['date'].dt.year == year)
        ].copy()
        
        if month_data.empty:
            st.warning(f"No data found for {year}-{month:02d}")
            return
        
        # Create pivot table
        pivot_data = month_data.pivot_table(
            index='employee',
            columns='date',
            values='shift',
            aggfunc='first',
            fill_value=''
        )
        
        # Get all dates in the month
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            end_date = date(year, month + 1, 1) - timedelta(days=1)
        
        all_dates = pd.date_range(start=start_date, end=end_date, freq='D')
        
        # Display color-coded table
        self._display_simple_table(pivot_data, all_dates, year, month)
        
        # Add summary statistics
        self._display_summary_stats(month_data, all_dates)
    
    def _display_simple_table(self, pivot_data: pd.DataFrame, all_dates: pd.DatetimeIndex, year: int, month: int):
        """Display a simple color-coded table using HTML."""
        
        month_name = self._get_month_name(month)
        
        # Start building the HTML
        html = f"""
        <div style="font-family: Arial, sans-serif; margin: 20px 0;">
            <h3 style="text-align: center; margin-bottom: 15px;">PHARMACY DEPARTMENT DUTY ROSTER {year} - {month_name.upper()}</h3>
            <table style="border-collapse: collapse; width: 100%; font-size: 12px; border: 2px solid #000;">
                <thead>
                    <tr style="background-color: #f0f0f0;">
                        <th style="border: 1px solid #000; padding: 5px; text-align: center; width: 60px;">STAFF No</th>
                        <th style="border: 1px solid #000; padding: 5px; text-align: left; width: 120px;">Name</th>
        """
        
        # Add date headers
        for date in all_dates:
            day_name = date.strftime('%a').upper()
            if day_name == 'SUN':
                day_name = 'SN'
            html += f'<th style="border: 1px solid #000; padding: 3px; text-align: center; width: 30px; font-size: 10px;">{date.day}<br>{day_name}</th>'
        
        html += "</tr></thead><tbody>"
        
        # Add staff rows
        for i, (employee, row) in enumerate(pivot_data.iterrows(), 1):
            html += f"""
            <tr>
                <td style="border: 1px solid #000; padding: 5px; text-align: center; background-color: #f9f9f9; font-weight: bold;">{i}</td>
                <td style="border: 1px solid #000; padding: 5px; background-color: #f9f9f9; font-weight: bold;">{employee}</td>
            """
            
            # Add shift cells with colors
            for date in all_dates:
                if date in row.index and pd.notna(row[date]) and row[date] != '':
                    shift = row[date]
                    color = self.shift_colors.get(shift, '#FFFFFF')
                    html += f'<td style="border: 1px solid #000; padding: 3px; text-align: center; background-color: {color}; font-weight: bold; font-size: 10px;">{shift}</td>'
                else:
                    html += '<td style="border: 1px solid #000; padding: 3px; text-align: center; background-color: #FFFFFF; font-weight: bold; font-size: 10px;">0</td>'
            
            html += "</tr>"
        
        # Add totals row
        html += "<tr style='background-color: #f0f0f0; font-weight: bold;'>"
        html += "<td style='border: 1px solid #000; padding: 5px; text-align: center;'>TOTAL</td>"
        html += "<td style='border: 1px solid #000; padding: 5px;'></td>"
        
        for date in all_dates:
            count = 0
            for _, row in pivot_data.iterrows():
                if date in row.index and pd.notna(row[date]) and row[date] != '' and row[date] != '0':
                    count += 1
            
            # Color code totals
            if count >= 4:
                color = "#90EE90"  # Green
            elif count >= 2:
                color = "#FFFFE0"  # Yellow
            else:
                color = "#FFB6C1"  # Pink
                
            html += f'<td style="border: 1px solid #000; padding: 3px; text-align: center; background-color: {color}; font-weight: bold;">{count}</td>'
        
        html += "</tr></tbody></table></div>"
        
        # Display the table
        st.markdown(html, unsafe_allow_html=True)
        
        # Add legend
        self._display_legend()
    
    def _display_legend(self):
        """Display the shift legend with colors."""
        st.markdown("**📋 Shift Legend:**")
        
        col1, col2, col3 = st.columns(3)
        
        with col1:
            st.markdown("**Main Shifts:**")
            self._legend_item("M", "Main", "#FFFFFF")
            self._legend_item("O", "Outpatient", "#E6F3FF")
            self._legend_item("IP", "Inpatient", "#F0F8FF")
        
        with col2:
            st.markdown("**Time-based Shifts:**")
            self._legend_item("A", "Evening (2:30-9:30 PM)", "#FFA500")
            self._legend_item("N", "Night (9:30 PM-7 AM)", "#FFFF00")
        
        with col3:
            st.markdown("**Leave Types:**")
            self._legend_item("DO", "Day Off", "#90EE90")
            self._legend_item("CL", "Casual Leave", "#FFB6C1")
            self._legend_item("ML", "Maternity Leave", "#DDA0DD")
            self._legend_item("W", "Workshop", "#D8BFD8")
    
    def _legend_item(self, code: str, description: str, color: str):
        """Display a legend item with color swatch."""
        st.markdown(f"""
        <div style="display: flex; align-items: center; margin: 2px 0;">
            <div style="width: 20px; height: 20px; background-color: {color}; border: 1px solid #000; margin-right: 8px; display: inline-block;"></div>
            <span><strong>{code}</strong>: {description}</span>
        </div>
        """, unsafe_allow_html=True)
    
    def _generate_html_table(
        self, 
        pivot_data: pd.DataFrame, 
        all_dates: pd.DatetimeIndex, 
        year: int, 
        month: int
    ) -> str:
        """Generate HTML table with color coding matching pharmacy roster format."""
        
        month_name = self._get_month_name(month)
        
        # Calculate working days
        working_days = len([d for d in all_dates if d.weekday() < 5])
        
        html = f"""
        <div style="font-family: Arial, sans-serif; margin: 20px 0; background-color: white;">
            <div style="text-align: center; margin-bottom: 15px;">
                <h1 style="margin: 0; font-size: 18px; color: #000; font-weight: bold;">
                    PHARMACY DEPARTMENT DUTY ROSTER {year}
                </h1>
                <h2 style="margin: 5px 0; font-size: 16px; color: #000; font-weight: bold;">
                    {month_name.upper()}
                </h2>
            </div>
            
            <div style="display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 12px; font-weight: bold;">
                <span>TOTAL DUTY:</span>
                <span>HOURS: 161</span>
                <span>DAYS: {working_days}</span>
            </div>
            
            <table style="border-collapse: collapse; width: 100%; font-size: 10px; border: 2px solid #000;">
                <thead>
                    <tr style="background-color: #f0f0f0;">
                        <th style="border: 1px solid #000; padding: 3px; text-align: center; width: 50px; font-weight: bold;">STAFF No</th>
                        <th style="border: 1px solid #000; padding: 3px; text-align: left; width: 100px; font-weight: bold;">Name</th>
        """
        
        # Add date headers
        for date in all_dates:
            day_name = date.strftime('%a').upper()
            if day_name == 'SUN':
                day_name = 'SN'
            html += f'<th style="border: 1px solid #000; padding: 2px; text-align: center; width: 25px; font-weight: bold;">{date.day}<br>{day_name}</th>'
        
        html += "</tr></thead><tbody>"
        
        # Add staff rows
        for i, (employee, row) in enumerate(pivot_data.iterrows(), 1):
            html += f"""
            <tr>
                <td style="border: 1px solid #000; padding: 3px; text-align: center; background-color: #f9f9f9; font-weight: bold;">
                    {i}
                </td>
                <td style="border: 1px solid #000; padding: 3px; background-color: #f9f9f9; font-weight: bold;">
                    {employee}
                </td>
            """
            
            # Add shift cells for each date
            for date in all_dates:
                if date in row.index and pd.notna(row[date]) and row[date] != '':
                    shift = row[date]
                    color = self.shift_colors.get(shift, '#FFFFFF')
                    html += f'<td style="border: 1px solid #000; padding: 2px; text-align: center; background-color: {color}; font-weight: bold; font-size: 9px;">{shift}</td>'
                else:
                    html += '<td style="border: 1px solid #000; padding: 2px; text-align: center; background-color: #FFFFFF; font-weight: bold; font-size: 9px;">0</td>'
            
            html += "</tr>"
        
        # Add totals row
        html += self._generate_totals_row(all_dates, pivot_data)
        
        html += "</tbody></table>"
        
        # Add legend
        html += self._generate_legend()
        
        html += "</div>"
        
        return html
    
    def _generate_totals_row(self, all_dates: pd.DatetimeIndex, pivot_data: pd.DataFrame) -> str:
        """Generate totals row for the table."""
        
        html = """
        <tr style="background-color: #e0e0e0; font-weight: bold;">
            <td style="border: 1px solid #ccc; padding: 4px; text-align: center;" colspan="2">TOTAL</td>
        """
        
        for date in all_dates:
            # Count main shifts (M, M3, M4, M+P, etc.)
            main_count = 0
            for employee, row in pivot_data.iterrows():
                if date in row.index and pd.notna(row[date]):
                    shift = row[date]
                    if shift and ('M' in shift or shift in ['M', 'M3', 'M4']):
                        main_count += 1
            
            html += f'<td style="border: 1px solid #ccc; padding: 4px; text-align: center;">{main_count}</td>'
        
        html += "</tr>"
        return html
    
    def _generate_legend(self) -> str:
        """Generate color legend for the shifts."""
        
        html = """
        <div style="margin-top: 20px;">
            <h4 style="margin-bottom: 10px;">Shift Legend:</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 5px; font-size: 11px;">
        """
        
        # Group shifts by category
        main_shifts = ['M', 'O', 'IP', 'M3', 'M4']
        time_shifts = ['A', 'N']
        leave_shifts = ['DO', 'CL', 'ML', 'UL', 'H', 'STL']
        special_shifts = ['W', 'ATT', 'APP', 'RT', 'EV', 'P', 'M+P', 'IP+P', 'M3+P', 'DR+M', 'V+P', 'C', 'L']
        
        categories = [
            ("Main Shifts", main_shifts),
            ("Time-based Shifts", time_shifts), 
            ("Leave Types", leave_shifts),
            ("Special Assignments", special_shifts)
        ]
        
        for category_name, shifts in categories:
            html += f'<div style="margin-bottom: 10px;"><strong>{category_name}:</strong><br>'
            for shift in shifts:
                if shift in self.shift_colors and shift in self.shift_labels:
                    color = self.shift_colors[shift]
                    label = self.shift_labels[shift]
                    html += f'<span style="display: inline-block; width: 20px; height: 15px; background-color: {color}; border: 1px solid #ccc; margin-right: 5px; vertical-align: middle;"></span>{shift}: {label}<br>'
            html += '</div>'
        
        html += """
            </div>
        </div>
        """
        
        return html
    
    def _display_summary_stats(self, month_data: pd.DataFrame, all_dates: pd.DatetimeIndex) -> None:
        """Display summary statistics."""
        
        st.subheader("📊 Monthly Summary")
        
        col1, col2, col3, col4 = st.columns(4)
        
        with col1:
            total_assignments = len(month_data)
            st.metric("Total Assignments", total_assignments)
        
        with col2:
            unique_employees = month_data['employee'].nunique()
            st.metric("Staff Members", unique_employees)
        
        with col3:
            working_days = len([d for d in all_dates if d.weekday() < 5])  # Monday-Friday
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
    
    def _get_month_name(self, month: int) -> str:
        """Get month name from month number."""
        months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ]
        return months[month - 1]
    
    def create_employee_workload_chart(self, schedule_df: pd.DataFrame, month: int, year: int) -> go.Figure:
        """Create a chart showing employee workload distribution."""
        
        # Filter data for the specific month
        schedule_df['date'] = pd.to_datetime(schedule_df['date'])
        month_data = schedule_df[
            (schedule_df['date'].dt.month == month) & 
            (schedule_df['date'].dt.year == year)
        ].copy()
        
        if month_data.empty:
            return go.Figure()
        
        # Count only actual working shifts (exclude empty, day off, and leave shifts)
        working_shifts = ['M', 'O', 'IP', 'A', 'N', 'M3', 'M4', 'M+P', 'IP+P', 'M3+P', 'DR+M', 'V+P', 'C']
        
        # Filter to only working shifts
        working_data = month_data[month_data['shift'].isin(working_shifts)]
        
        if working_data.empty:
            st.info("No working shifts found for this month.")
            return go.Figure()
        
        # Count working shifts per employee
        employee_workload = working_data.groupby('employee')['shift'].count().reset_index()
        employee_workload = employee_workload.sort_values('shift', ascending=True)
        
        # Add employees with zero workload
        all_employees = month_data['employee'].unique()
        for emp in all_employees:
            if emp not in employee_workload['employee'].values:
                employee_workload = pd.concat([
                    employee_workload,
                    pd.DataFrame([{'employee': emp, 'shift': 0}])
                ], ignore_index=True)
        
        fig = go.Figure(data=go.Bar(
            x=employee_workload['shift'],
            y=employee_workload['employee'],
            orientation='h',
            text=employee_workload['shift'],
            textposition='auto',
            marker_color='lightblue'
        ))
        
        fig.update_layout(
            title=f"Employee Workload - {self._get_month_name(month)} {year}",
            xaxis_title="Number of Working Shifts",
            yaxis_title="Employee",
            height=max(400, len(employee_workload) * 25 + 100)
        )
        
        return fig
