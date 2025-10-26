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
            'O': '#E6F3FF',      # Light blue - Off (from schedule)
            'IP': '#F0F8FF',     # Very light blue - Inpatient
            'A': '#FFA500',      # Orange - Afternoon (2:30pm - 9:30pm)
            'N': '#FFFF00',      # Yellow - Night (9:30pm - 7am)
            'DO': '#90EE90',     # Light green - Day Off
            'CL': '#FFB6C1',     # Light pink - Clinic
            'ML': '#DDA0DD',     # Plum - Maternity Leave
            'W': '#D8BFD8',      # Thistle - Workshop
            'UL': '#F5F5F5',     # Light gray - Unpaid Leave
            'H': '#FFE4E1',      # Misty rose - Harat Pharmacy
            'STL': '#B0E0E6',    # Powder blue - Study Leave
            'ATT': '#E0E0E0',    # Light gray - Attending
            'APP': '#FF6B6B',    # Light red - Appointment
            'RT': '#87CEEB',     # Sky blue - Return
            'EV': '#DDA0DD',     # Plum - Event
            'P': '#FFA07A',      # Light salmon - Pharmacy
            'M+P': '#FFB6C1',    # Light pink - Main + Pharmacy
            'IP+P': '#FFB6C1',   # Light pink - IP + Pharmacy
            'M3': '#FFFFFF',     # White - M3 (7am-2pm)
            'M4': '#FFFFFF',     # White - M4 (12pm-7pm)
            'M3+P': '#FFB6C1',   # Light pink - M3 + Pharmacy
            'DR+M': '#FFB6C1',   # Light pink - Doctor + Main
            'V+P': '#FF6B6B',    # Light red - V + Pharmacy
            'C': '#F0F8FF',      # Very light blue - Clinic
            'L': '#F5F5F5',      # Light gray - Leave
            '0': '#FFFFFF',      # White - Empty/Default
        }
        
        self.shift_labels = {
            'M': 'Main',
            'O': 'Off', 
            'IP': 'Inpatient',
            'A': 'Afternoon (2:30pm-9:30pm)',
            'N': 'Night (9:30pm-7am)',
            'DO': 'Day Off',
            'CL': 'Clinic',
            'ML': 'Maternity Leave',
            'W': 'Workshop',
            'UL': 'Unpaid Leave',
            'H': 'Harat Pharmacy',
            'STL': 'Study Leave',
            'ATT': 'Attending',
            'APP': 'Appointment',
            'RT': 'Return',
            'EV': 'Event',
            'P': 'Pharmacy',
            'M+P': 'Main + Pharmacy',
            'IP+P': 'IP + Pharmacy',
            'M3': 'M3 (7am-2pm)',
            'M4': 'M4 (12pm-7pm)',
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
            st.warning(f"No schedule data found for {year}-{month:02d}. Please populate the month with daily shift requirements first.")
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
        year: int,
        employee_df: pd.DataFrame = None,
        show_summary: bool = True
    ) -> None:
        """Create an enhanced HTML table with color coding similar to the pharmacy rosters."""
        
        # Filter data for the specific month
        schedule_df['date'] = pd.to_datetime(schedule_df['date'])
        month_data = schedule_df[
            (schedule_df['date'].dt.month == month) & 
            (schedule_df['date'].dt.year == year)
        ].copy()
        
        if month_data.empty:
            st.warning(f"No schedule data found for {year}-{month:02d}. Please populate the month with daily shift requirements first.")
            return
        
        # Create pivot table
        pivot_data = month_data.pivot_table(
            index='employee',
            columns='date',
            values='shift',
            aggfunc='first',
            fill_value=''
        )
        
        # Reorder employees: clinic people at the bottom
        clinic_employees = ['Rasha', 'Hawra', 'Abdullah']  # clinic-only people
        other_employees = [emp for emp in pivot_data.index if emp not in clinic_employees]
        reordered_employees = other_employees + clinic_employees
        pivot_data = pivot_data.reindex(reordered_employees)
        
        # Get all dates in the month
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            end_date = date(year, month + 1, 1) - timedelta(days=1)
        
        all_dates = pd.date_range(start=start_date, end=end_date, freq='D')
        
        # Display color-coded table
        self._display_simple_table(pivot_data, all_dates, year, month, employee_df)
        
        # Add download button
        self._add_download_button(pivot_data, all_dates, year, month, employee_df)
        
        # Add summary statistics
        if show_summary:
            self._display_summary_stats(month_data, all_dates)
    
    def _display_simple_table(self, pivot_data: pd.DataFrame, all_dates: pd.DatetimeIndex, year: int, month: int, employee_df: pd.DataFrame = None):
        """Display a simple color-coded table using HTML."""
        
        month_name = self._get_month_name(month)
        
        # Start building the HTML with simplified styling
        html = f"""
        <style>
        .schedule-table {{
            border-collapse: collapse;
            width: 100%;
            font-size: 14px;
            border: 2px solid #000;
        }}
        .schedule-cell {{
            border: 1px solid #000;
            padding: 6px;
            text-align: center;
            font-weight: bold !important;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
            position: relative;
        }}
        .schedule-cell:hover {{
            transform: scale(1.15);
            filter: brightness(0.9);
            z-index: 10;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }}
        .highlight-row {{
            transform: scale(1.05) !important;
            z-index: 5 !important;
        }}
        .highlight-col {{
            transform: scale(1.05) !important;
            z-index: 5 !important;
        }}
        .highlight-both {{
            transform: scale(1.1) !important;
            z-index: 10 !important;
        }}
        </style>
        
        <script>
        // Simple highlighting system that works with Streamlit
        function initTableHighlights() {{
            const table = document.querySelector('.schedule-table');
            if (!table) {{
                console.log('Table not found, retrying...');
                setTimeout(initTableHighlights, 100);
                return;
            }}
            console.log('Table found, initializing highlights...');
            
            // Add data attributes to cells for easier targeting
            const rows = table.querySelectorAll('tr');
            rows.forEach((row, rowIndex) => {{
                const cells = row.querySelectorAll('td, th');
                cells.forEach((cell, cellIndex) => {{
                    cell.setAttribute('data-row', rowIndex);
                    cell.setAttribute('data-col', cellIndex);
                }});
            }});
            
            // Add hover events
            table.addEventListener('mouseover', function(e) {{
                const cell = e.target.closest('td, th');
                if (!cell) return;
                
                const rowIndex = parseInt(cell.getAttribute('data-row'));
                const colIndex = parseInt(cell.getAttribute('data-col'));
                
                // Clear previous highlights
                table.querySelectorAll('.highlight-row, .highlight-col, .highlight-both').forEach(el => {{
                    el.classList.remove('highlight-row', 'highlight-col', 'highlight-both');
                }});
                
                // Highlight row (employee)
                if (rowIndex > 0) {{
                    const rowCells = rows[rowIndex].querySelectorAll('.schedule-cell');
                    rowCells.forEach(c => c.classList.add('highlight-row'));
                }}
                
                // Highlight column (date)
                if (colIndex > 1) {{
                    rows.forEach((row, idx) => {{
                        if (idx > 0) {{
                            const colCell = row.children[colIndex];
                            if (colCell && colCell.classList.contains('schedule-cell')) {{
                                colCell.classList.add('highlight-col');
                            }}
                        }}
                    }});
                }}
                
                // Highlight intersection
                if (rowIndex > 0 && colIndex > 1) {{
                    const intersectionCell = rows[rowIndex].children[colIndex];
                    if (intersectionCell && intersectionCell.classList.contains('schedule-cell')) {{
                        intersectionCell.classList.remove('highlight-row', 'highlight-col');
                        intersectionCell.classList.add('highlight-both');
                    }}
                }}
            }});
            
            // Clear highlights when mouse leaves table
            table.addEventListener('mouseleave', function() {{
                table.querySelectorAll('.highlight-row, .highlight-col, .highlight-both').forEach(el => {{
                    el.classList.remove('highlight-row', 'highlight-col', 'highlight-both');
                }});
            }});
        }}
        
        // Initialize when DOM is ready
        if (document.readyState === 'loading') {{
            document.addEventListener('DOMContentLoaded', initTableHighlights);
        }} else {{
            initTableHighlights();
        }}
        </script>
        
        <style>
        .header-cell {{
            border: 1px solid #000;
            padding: 8px;
            text-align: center;
            background-color: #f0f0f0;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s ease;
            font-size: 12px;
        }}
        .header-cell:hover {{
            transform: scale(1.15);
            filter: brightness(0.9);
            z-index: 10;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }}
        .staff-number-cell {{
            border: 1px solid #000;
            padding: 8px;
            text-align: center;
            background-color: #f9f9f9;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.2s ease;
            font-size: 12px;
        }}
        .staff-number-cell:hover {{
            transform: scale(1.15);
            filter: brightness(0.9);
            z-index: 10;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }}
        .employee-cell {{
            border: 1px solid #000;
            padding: 8px;
            text-align: left;
            background-color: #f9f9f9;
            font-weight: bold;
            width: 120px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
        }}
        .employee-cell:hover {{
            transform: scale(1.15);
            filter: brightness(0.9);
            z-index: 10;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }}
        .totals-cell {{
            border: 1px solid #000;
            padding: 6px;
            text-align: center;
            background-color: #9CA3AF;
            color: black;
            font-weight: bold !important;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
        }}
        .totals-cell:hover {{
            transform: scale(1.15);
            filter: brightness(0.9);
            z-index: 10;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }}
        .section-border-top {{
            border-top: 2px solid #000 !important;
        }}
        .section-border-bottom {{
            border-bottom: 2px solid #000 !important;
        }}
        .section-border-left {{
            border-left: 2px solid #000 !important;
        }}
        .section-border-right {{
            border-right: 2px solid #000 !important;
        }}
        .staff-section {{
            border-right: 2px solid #000 !important;
        }}
        .employee-cell.pending-off-data {{
            border-left: 1px solid #000 !important;
        }}
        .date-section {{
            border-right: 2px solid #000 !important;
        }}
        .date-row {{
            border-bottom: 2px solid #000 !important;
        }}
        </style>
        
        <div style="font-family: Arial, sans-serif; margin: 20px 0;">
            <table class="schedule-table">
                <thead>
                    <tr style="background-color: #f0f0f0;" class="date-row">
                        <th class="header-cell" style="width: 30px;">#</th>
                        <th class="header-cell" style="width: 100px;">Name</th>
                        <th class="header-cell staff-section" style="width: 40px;">P/O</th>
        """
        
        # Add date headers
        for i, date in enumerate(all_dates):
            day_name = date.strftime('%a').upper()
            if day_name == 'SUN':
                day_name = 'SUN'
            
            # Different background color for weekends (Friday and Saturday)
            if day_name in ['FRI', 'SAT']:
                header_style = "background-color: #D1E7DD; width: 30px; font-size: 12px;"
            else:
                header_style = "width: 30px; font-size: 12px;"
            
            # Add border class to the last date header
            border_class = "date-section" if i == len(all_dates) - 1 else ""
            html += f'<th class="header-cell {border_class}" style="{header_style}">{date.day}<br>{day_name}</th>'
        
        html += "</tr></thead><tbody>"
        
        # Add staff rows
        for i, (employee, row) in enumerate(pivot_data.iterrows(), 1):
            # Get pending off value for this employee
            pending_off_value = 0
            if employee_df is not None and 'pending_off' in employee_df.columns:
                emp_data = employee_df[employee_df['employee'] == employee]
                if not emp_data.empty:
                    pending_off_value = int(emp_data['pending_off'].iloc[0])
            html += f"""
            <tr>
                <td class="staff-number-cell">{i}</td>
                <td class="employee-cell">{employee}</td>
                <td class="employee-cell staff-section pending-off-data" style="text-align: center; font-weight: bold;">{pending_off_value}</td>
            """
            
            # Add shift cells with colors
            for date in all_dates:
                day_name = date.strftime('%a').upper()
                if day_name == 'SUN':
                    day_name = 'SN'
                
                # Check if it's a weekend (Friday and Saturday)
                is_weekend = day_name in ['FRI', 'SAT']
                
                if date in row.index and pd.notna(row[date]) and row[date] != '':
                    shift = row[date]
                    color = self.shift_colors.get(shift, '#FFFFFF')
                    
                    # For weekends, only apply green background to "O" shifts
                    if is_weekend and shift == 'O':
                        # Use weekend tint only for "O" shifts on weekends
                        final_color = '#D1E7DD'  # Weekend green for "O"
                    else:
                        final_color = color  # Normal color for all other shifts
                    
                    html += f'<td class="schedule-cell" style="background-color: {final_color};">{shift}</td>'
                else:
                    # Empty cell - use weekend tint for weekends, white for weekdays
                    empty_color = '#D1E7DD' if is_weekend else '#FFFFFF'
                    html += f'<td class="schedule-cell" style="background-color: {empty_color};">0</td>'
            
            html += "</tr>"
        
        # Add TOTAL MAIN row
        html += "<tr style='background-color: #9CA3AF; font-weight: bold;' class='section-border-top'>"
        html += "<td class='totals-cell' colspan='3'>TOTAL MAIN</td>"
        
        for date in all_dates:
            day_name = date.strftime('%a').upper()
            if day_name == 'SUN':
                day_name = 'SUN'
            
            # Check if it's a weekend (Friday and Saturday)
            is_weekend = day_name in ['FRI', 'SAT']
            
            # Count M shifts only
            main_count = 0
            for _, row in pivot_data.iterrows():
                if date in row.index and pd.notna(row[date]) and row[date] == 'M':
                    main_count += 1
            
            # Use light purple for TOTAL MAIN cells
            html += f'<td class="totals-cell">{main_count}</td>'
        
        html += "</tr>"
        
        # Add TOTAL IP row
        html += "<tr style='background-color: #9CA3AF; font-weight: bold;' class='section-border-bottom'>"
        html += "<td class='totals-cell' colspan='3'>TOTAL IP</td>"
        
        for date in all_dates:
            day_name = date.strftime('%a').upper()
            if day_name == 'SUN':
                day_name = 'SUN'
            
            # Check if it's a weekend (Friday and Saturday)
            is_weekend = day_name in ['FRI', 'SAT']
            
            # Count IP shifts only
            ip_count = 0
            for _, row in pivot_data.iterrows():
                if date in row.index and pd.notna(row[date]) and row[date] == 'IP':
                    ip_count += 1
            
            # Use light purple for TOTAL IP cells
            html += f'<td class="totals-cell">{ip_count}</td>'
        
        html += "</tr></tbody></table></div>"
        
        # Display the table
        st.markdown(html, unsafe_allow_html=True)
    
        
        # Add legend
        self._display_legend()
    
    def _display_legend(self):
        """Display the shift legend with colors and color pickers."""
        st.markdown("### **Shift Legend**")
        
        # Initialize custom colors in session state if not exists
        if 'custom_shift_colors' not in st.session_state:
            st.session_state.custom_shift_colors = self.shift_colors.copy()
        
        # Update shift colors with custom colors
        self.shift_colors.update(st.session_state.custom_shift_colors)
        
        col1, col2, col3 = st.columns(3)
        
        with col1:
            st.markdown("**Main Shifts:**")
            self._legend_item_with_picker("M", "Main", "#FFFFFF")
            self._legend_item_with_picker("IP", "Inpatient", "#F0F8FF")
            self._legend_item_with_picker("M3", "M3 (7am-2pm)", "#FFFFFF")
            self._legend_item_with_picker("M4", "M4 (12pm-7pm)", "#FFFFFF")
            self._legend_item_with_picker("A", "Afternoon (2:30pm-9:30pm)", "#FFA500")
            self._legend_item_with_picker("N", "Night (9:30pm-7am)", "#FFFF00")
        
        with col2:
            st.markdown("**Special Shifts:**")
            self._legend_item_with_picker("H", "Harat Pharmacy", "#FFE4E1")
            self._legend_item_with_picker("CL", "Clinic", "#FFB6C1")
        
        with col3:
            st.markdown("**Leave Types:**")
            self._legend_item_with_picker("DO", "Day Off", "#90EE90")
            self._legend_item_with_picker("ML", "Maternity Leave", "#DDA0DD")
            self._legend_item_with_picker("W", "Workshop", "#D8BFD8")
            self._legend_item_with_picker("UL", "Unpaid Leave", "#F5F5F5")
            self._legend_item_with_picker("APP", "Appointment", "#FF6B6B")
            self._legend_item_with_picker("STL", "Study Leave", "#B0E0E6")
            self._legend_item_with_picker("L", "Leave", "#F5F5F5")
            self._legend_item_with_picker("O", "Off", "#E6F3FF")
    
    def _legend_item_with_picker(self, code: str, description: str, default_color: str):
        """Display a legend item with color picker and immediate refresh."""
        # Get current color from session state or use default
        current_color = st.session_state.custom_shift_colors.get(code, default_color)
        
        # Create less compact layout with smaller color pickers
        col_picker, col_desc = st.columns([1, 4])
        
        with col_picker:
            new_color = st.color_picker(
                "",
                value=current_color,
                key=f"color_picker_{code}",
                label_visibility="collapsed"
            )
            
            # Update session state immediately when color changes
            if new_color != current_color:
                st.session_state.custom_shift_colors[code] = new_color
                # Force immediate update of shift_colors
                self.shift_colors[code] = new_color
                st.rerun()
        
        with col_desc:
            st.markdown(f"<strong>{code}</strong>: {description}", unsafe_allow_html=True)
    
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
                        <th style="border: 1px solid #000; padding: 3px; text-align: center; width: 50px; font-weight: bold;">#</th>
                        <th style="border: 1px solid #000; padding: 3px; text-align: left; width: 100px; font-weight: bold;">Name</th>
                        <th style="border: 1px solid #000; padding: 3px; text-align: center; width: 40px; font-weight: bold;">P/O</th>
        """
        
        # Add date headers
        for date in all_dates:
            day_name = date.strftime('%a').upper()
            if day_name == 'SUN':
                day_name = 'SUN'
            html += f'<th style="border: 1px solid #000; padding: 2px; text-align: center; width: 25px; font-weight: bold;">{date.day}<br>{day_name}</th>'
        
        html += "</tr></thead><tbody>"
        
        # Add staff rows
        for i, (employee, row) in enumerate(pivot_data.iterrows(), 1):
            # Get pending off value for this employee
            pending_off_value = 0
            if employee_df is not None and 'pending_off' in employee_df.columns:
                emp_data = employee_df[employee_df['employee'] == employee]
                if not emp_data.empty:
                    pending_off_value = int(emp_data['pending_off'].iloc[0])
            html += f"""
            <tr>
                <td style="border: 1px solid #000; padding: 3px; text-align: center; background-color: #f9f9f9; font-weight: bold;">
                    {i}
                </td>
                <td style="border: 1px solid #000; padding: 3px; background-color: #f9f9f9; font-weight: bold;">
                    {employee}
                </td>
                <td style="border: 1px solid #000; padding: 3px; text-align: center; background-color: #f9f9f9; font-weight: bold;">
                    {pending_off_value}
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
        """Generate totals rows for the table."""
        
        html = ""
        
        # TOTAL MAIN row
        html += """
        <tr style="background-color: #DDA0DD; font-weight: bold;">
            <td style="border: 1px solid #ccc; padding: 4px; text-align: center; background-color: #DDA0DD !important; color: white; font-weight: bold;" colspan="3">TOTAL MAIN</td>
        """
        
        for date in all_dates:
            # Count M shifts only
            main_count = 0
            for employee, row in pivot_data.iterrows():
                if date in row.index and pd.notna(row[date]):
                    shift = row[date]
                    if shift == 'M':
                        main_count += 1
            
            html += f'<td style="border: 1px solid #ccc; padding: 4px; text-align: center; background-color: #DDA0DD; color: white; font-weight: bold;">{main_count}</td>'
        
        html += "</tr>"
        
        # TOTAL IP row
        html += """
        <tr style="background-color: #9370DB; font-weight: bold;">
            <td style="border: 1px solid #ccc; padding: 4px; text-align: center; background-color: #9370DB !important; color: white; font-weight: bold;" colspan="3">TOTAL IP</td>
        """
        
        for date in all_dates:
            # Count IP shifts only
            ip_count = 0
            for employee, row in pivot_data.iterrows():
                if date in row.index and pd.notna(row[date]):
                    shift = row[date]
                    if shift == 'IP':
                        ip_count += 1
            
            html += f'<td style="border: 1px solid #ccc; padding: 4px; text-align: center; background-color: #9370DB; color: white; font-weight: bold;">{ip_count}</td>'
        
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
    
    def _add_download_button(self, pivot_data: pd.DataFrame, all_dates: pd.DatetimeIndex, year: int, month: int, employee_df: pd.DataFrame = None) -> None:
        """Add a download button for the schedule."""
        import streamlit as st
        import io
        from PIL import Image
        import base64
        
        month_name = self._get_month_name(month)
        
        # Create HTML table as image
        html_content = self._create_html_table(pivot_data, all_dates, year, month, employee_df)
        
        # For now, just show a simple download button that copies the HTML
        st.download_button(
            label="Download Schedule",
            data=html_content,
            file_name=f"pharmacy_schedule_{year}_{month:02d}_{month_name}.html",
            mime="text/html",
            help="Download the current schedule as an HTML file that can be opened in any browser"
        )
    
    def _create_html_table(self, pivot_data: pd.DataFrame, all_dates: pd.DatetimeIndex, year: int, month: int, employee_df: pd.DataFrame = None) -> str:
        """Create HTML table for download."""
        month_name = self._get_month_name(month)
        
        # Use the same HTML generation as the display but as a complete HTML document
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <title>Pharmacy Duty Roster | {month_name} {year} </title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 20px; }}
        .schedule-table {{
            border-collapse: collapse;
            width: 100%;
            font-size: 14px;
            border: 2px solid #000;
        }}
        .schedule-cell {{
            border: 1px solid #000;
            padding: 6px;
            text-align: center;
            font-weight: bold !important;
            font-size: 12px;
            position: relative;
        }}
        .header-cell {{
            border: 1px solid #000;
            padding: 8px;
            text-align: center;
            background-color: #f0f0f0;
            font-weight: bold;
            font-size: 12px;
        }}
        .staff-number-cell {{
            border: 1px solid #000;
            padding: 8px;
            text-align: center;
            background-color: #f9f9f9;
            font-weight: bold;
            font-size: 12px;
        }}
        .employee-cell {{
            border: 1px solid #000;
            padding: 8px;
            text-align: left;
            background-color: #f9f9f9;
            font-weight: bold;
            width: 120px;
            font-size: 12px;
        }}
        .totals-cell {{
            border: 1px solid #000;
            padding: 6px;
            text-align: center;
            background-color: #9CA3AF;
            color: black;
            font-weight: bold !important;
            font-size: 12px;
        }}
        .section-border-top {{
            border-top: 2px solid #000 !important;
        }}
        .section-border-bottom {{
            border-bottom: 2px solid #000 !important;
        }}
        .staff-section {{
            border-right: 2px solid #000 !important;
        }}
        .employee-cell.pending-off-data {{
            border-left: 1px solid #000 !important;
        }}
        .date-section {{
            border-right: 2px solid #000 !important;
        }}
        .date-row {{
            border-bottom: 2px solid #000 !important;
        }}
    </style>
</head>
<body>
    <h2 style="text-align: center; font-size: 18px; font-weight: normal; margin-bottom: 20px;">Pharmacy Schedule | {month_name} {year}</h2>
"""
        
        # Add the table HTML (reuse the existing table generation logic)
        html_content += self._generate_table_html(pivot_data, all_dates, year, month, employee_df)
        
        html_content += """
</body>
</html>
"""
        return html_content
    
    def _generate_table_html(self, pivot_data: pd.DataFrame, all_dates: pd.DatetimeIndex, year: int, month: int, employee_df: pd.DataFrame = None) -> str:
        """Generate the table HTML for download."""
        month_name = self._get_month_name(month)
        
        html = f"""
        <table class="schedule-table">
            <thead>
                <tr style="background-color: #f0f0f0;" class="date-row">
                    <th class="header-cell" style="width: 45px;">#</th>
                    <th class="header-cell staff-section" style="width: 120px;">Name</th>
                    <th class="header-cell staff-section" style="width: 40px;">P/O</th>
        """
        
        # Add date headers
        for i, date in enumerate(all_dates):
            day_name = date.strftime('%a').upper()
            if day_name == 'SUN':
                day_name = 'SUN'
            
            # Different background color for weekends (Friday and Saturday)
            if day_name in ['FRI', 'SAT']:
                header_style = "background-color: #D1E7DD; width: 30px; font-size: 12px;"
            else:
                header_style = "width: 30px; font-size: 12px;"
            
            # Add border class to the last date header
            border_class = "date-section" if i == len(all_dates) - 1 else ""
            html += f'<th class="header-cell {border_class}" style="{header_style}">{date.day}<br>{day_name}</th>'
        
        html += "</tr></thead><tbody>"
        
        # Add staff rows
        for i, (employee, row) in enumerate(pivot_data.iterrows(), 1):
            # Get pending off value for this employee
            pending_off_value = 0
            if employee_df is not None and 'pending_off' in employee_df.columns:
                emp_data = employee_df[employee_df['employee'] == employee]
                if not emp_data.empty:
                    pending_off_value = int(emp_data['pending_off'].iloc[0])
            html += f"""
            <tr>
                <td class="staff-number-cell">{i}</td>
                <td class="employee-cell">{employee}</td>
                <td class="employee-cell staff-section pending-off-data" style="text-align: center; font-weight: bold;">{pending_off_value}</td>
            """
            
            # Add shift cells with colors
            for date in all_dates:
                day_name = date.strftime('%a').upper()
                if day_name == 'SUN':
                    day_name = 'SN'
                
                # Check if it's a weekend (Friday and Saturday)
                is_weekend = day_name in ['FRI', 'SAT']
                
                if date in row.index and pd.notna(row[date]) and row[date] != '':
                    shift = row[date]
                    color = self.shift_colors.get(shift, '#FFFFFF')
                    
                    # For weekends, only apply green background to "O" shifts
                    if is_weekend and shift == 'O':
                        # Use weekend tint only for "O" shifts on weekends
                        final_color = '#D1E7DD'  # Weekend green for "O"
                    else:
                        final_color = color  # Normal color for all other shifts
                    
                    html += f'<td class="schedule-cell" style="background-color: {final_color};">{shift}</td>'
                else:
                    # Empty cell - use weekend tint for weekends, white for weekdays
                    empty_color = '#D1E7DD' if is_weekend else '#FFFFFF'
                    html += f'<td class="schedule-cell" style="background-color: {empty_color};">0</td>'
            
            html += "</tr>"
        
        # Add TOTAL MAIN row
        html += "<tr style='background-color: #9CA3AF; font-weight: bold;' class='section-border-top'>"
        html += "<td class='totals-cell' colspan='3'>TOTAL MAIN</td>"
        
        for date in all_dates:
            # Count M shifts only
            main_count = 0
            for _, row in pivot_data.iterrows():
                if date in row.index and pd.notna(row[date]) and row[date] == 'M':
                    main_count += 1
            
            # Use light purple for TOTAL MAIN cells
            html += f'<td class="totals-cell">{main_count}</td>'
        
        html += "</tr>"
        
        # Add TOTAL IP row
        html += "<tr style='background-color: #9CA3AF; font-weight: bold;' class='section-border-bottom'>"
        html += "<td class='totals-cell' colspan='3'>TOTAL IP</td>"
        
        for date in all_dates:
            # Count IP shifts only
            ip_count = 0
            for _, row in pivot_data.iterrows():
                if date in row.index and pd.notna(row[date]) and row[date] == 'IP':
                    ip_count += 1
            
            # Use light purple for TOTAL IP cells
            html += f'<td class="totals-cell">{ip_count}</td>'
        
        html += "</tr></tbody></table>"
        
        return html
    
    def _create_csv_data(self, pivot_data: pd.DataFrame, all_dates: pd.DatetimeIndex, year: int, month: int) -> str:
        """Create CSV data from the schedule."""
        import io
        
        # Create a new DataFrame for CSV export
        csv_df = pivot_data.copy()
        
        # Add staff numbers as first column
        csv_df.insert(0, 'Staff_No', range(1, len(csv_df) + 1))
        
        # Add totals rows
        totals_main = ['TOTAL_MAIN', ''] + [self._count_shifts(pivot_data, date, 'M') for date in all_dates]
        totals_ip = ['TOTAL_IP', ''] + [self._count_shifts(pivot_data, date, 'IP') for date in all_dates]
        
        # Create totals DataFrame with matching columns
        totals_df = pd.DataFrame([totals_main, totals_ip], columns=csv_df.columns)
        
        # Combine data
        final_df = pd.concat([csv_df, totals_df], ignore_index=True)
        
        # Convert to CSV string
        csv_buffer = io.StringIO()
        final_df.to_csv(csv_buffer, index=False)
        return csv_buffer.getvalue()
    
    def _count_shifts(self, pivot_data: pd.DataFrame, date: pd.Timestamp, shift_type: str) -> int:
        """Count specific shift type for a given date."""
        count = 0
        for _, row in pivot_data.iterrows():
            if date in row.index and pd.notna(row[date]) and row[date] == shift_type:
                count += 1
        return count
    
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
                title="Shift Distribution",
                labels={'names': 'Shift', 'values': 'Total'}
            )
            st.plotly_chart(fig, use_container_width=True)
        
        with col2:
            fig = px.bar(
                x=shift_counts.index,
                y=shift_counts.values,
                title="Shift Counts",
                labels={'x': 'Shift', 'y': 'Total'},
                color_discrete_sequence=['#6B7280']  # Professional grey
            )
            fig.update_xaxes(title="Shift", tickangle=45)
            fig.update_yaxes(title="Total")
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
        working_shifts = ['M', 'IP', 'A', 'N', 'M3', 'M4', 'H', 'CL']
        
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
            xaxis_title="Number of Working Shifts",
            yaxis_title="Employee",
            height=max(400, len(employee_workload) * 25 + 100)
        )
        
        return fig
