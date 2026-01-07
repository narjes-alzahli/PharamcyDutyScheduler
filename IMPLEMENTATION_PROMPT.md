# Implementation Prompt: Pharmacy Duty Scheduler UI/UX Improvements

## Overview
Implement comprehensive UI/UX improvements to a Pharmacy Duty Scheduler application. The application has a React frontend and FastAPI backend. All changes should maintain existing functionality while improving user experience and consistency.

---

## 1. Roster Generator - Combined Requests Schedule View

### Requirements:
- **Combine Leave and Shift Requests Tabs**: Merge the separate "Leave Requests" and "Shift Requests" tabs into a single "Requests" tab that displays both types in a unified schedule view (similar to the main roster schedule).
- **Backend Separation Maintained**: While displayed together, maintain backend separation:
  - Leave requests and non-standard shift requests → `time_off` matrix
  - Standard shift requests → `locks` matrix
- **Clickable Cells**: All cells (including empty ones) should be clickable to assign or change shift types.
- **Empty Cell Assignment**: When clicking an empty cell and assigning a shift, route it to the correct backend matrix based on shift type:
  - Leave types → `time_off`
  - Non-standard shifts → `time_off` 
  - Standard shifts → `locks`
- **Delete on Empty**: When selecting "Empty" in the dropdown for an approved request (one with a `request_id`), delete the request from the database using the appropriate API (`deleteLeaveRequest` or `deleteShiftRequest` based on request_id prefix: `LR_` or `SR_`).

### Dropdown Improvements:
- **Shift Code Only**: Display only the shift code (e.g., "M", "DO", "AL") without the full name in the dropdown.
- **Organized by Type**: Group options in the dropdown:
  1. Empty
  2. Leave Types
  3. Non-Standard Shifts
  4. Standard Shifts
- **Search Input**: Add a small search input field within the dropdown to filter options.

### Visual Improvements:
- **Icons Instead of Text**: 
  - Use 📌 (pin emoji) for "Force" (must have this shift)
  - Use ✗ for "Forbid" (cannot have this shift)
- **Compact Schedule**: Make all schedule views more compact:
  - Reduce padding (e.g., `px-2 py-2` → `px-1 py-1` or `px-0.5 py-0.5`)
  - Decrease font sizes (e.g., `text-xs` → `text-[10px]`)
  - Narrow column widths (e.g., `min-w-[40px]` → `min-w-[28px]`)
  - Show only first letter of day names (e.g., "Sun" → "S")

---

## 2. User Management - Requests Tab

### Requirements:
- **Schedule View Instead of Calendar**: Replace the calendar view with a schedule view (similar to Roster Generator) that shows requests in a grid format.
- **Combined Page**: Display everything on one page with:
  - A filter dropdown: "All Requests", "Leave Requests", "Shift Requests"
  - Two separate tables below the schedule: one for leave requests, one for shift requests
- **Default Table State**: Both tables should be collapsed by default (closed), with expand/collapse toggle buttons (chevron icons) next to the table titles.
- **Empty State Messages**: "No requests found" messages should only appear when the table is expanded AND there are no filtered requests.

### Interactive Schedule Features:
- **Clickable Cells**: Cells in the schedule should be clickable to select requests.
- **Range Highlighting**: When a request spans multiple days, clicking any cell in that range should highlight ALL cells in the range with a blue outline (similar to other schedules in Roster Generator).
- **Hover Effects**: 
  - Cells should have interactive hover effects (scale up slightly, e.g., `hover:scale-110`)
  - When hovering over a cell that's part of a multi-day request, ALL cells in that request range should have the hover effect applied.
- **Status Colors**:
  - Approved: Light green (`#4ADE80` - green-400)
  - Rejected: Red (`#FCA5A5` - red-300)
  - Pending: Yellow (`#FEF08A` - yellow-300)

### Action Popup:
- **Positioning**: When clicking a request, show a popup with Approve/Reject/Delete buttons:
  - Popup should be small and positioned at the corner of the selected cell
  - Popup corner should touch the cell corner without overlapping/hiding the cell
  - Position popup on the opposite side of the cell relative to viewport center
  - For cells on the far right, position popup flexibly on the left to prevent overflow
  - Popup should never spill outside the schedule range
  - Position near edge cells of multi-day ranges
- **Actions**: 
  - Approve (green checkmark icon)
  - Reject (red X icon)
  - Delete (gray trash icon)

---

## 3. User Management - User Accounts Tab

### Requirements:
- **In-Table Edit Action**: Add an "Edit" icon button to each user row in the actions column.
- **Remove Separate Edit Form**: Remove the standalone "Edit User Account" form/section.
- **Edit Modal**: When clicking "Edit", show a modal popup (similar to editing an employee) with fields:
  - Username (editable)
  - Employee Name (editable)
  - Password (optional - leave empty to keep current password)
  - Employee Type (dropdown: Staff/Manager)
- **Backend Support**: Ensure the backend `update_user` endpoint accepts:
  - `original_username` (to identify the user)
  - `username` (new username if changed)
  - `employee_name`
  - `password` (optional)
  - `employee_type`

---

## 4. Rules Management - Leave Types and Shift Types Tables

### Requirements:
- **Icon Actions**: Replace "Edit" and "Delete" text buttons with icon buttons:
  - Edit: Pencil icon (blue)
  - Delete: Trash icon (red)
- **Popup Modals for Add/Edit**:
  - When clicking "Add Leave Type" or "Add Shift Type", show a popup modal
  - When clicking "Edit" icon, show the same popup modal pre-filled with the type's data
  - Remove inline add/edit forms
- **Color Input**: 
  - Remove the hex code text input field
  - Show only the color picker (color wheel)
  - Remove hex code display from table rows (show only the color swatch)
- **Hidden Options**:
  - For Shift Types: Remove the "Working shift (not rest/leave)" checkbox (default to `true` internally)
  - For Leave Types: Remove the "Counts as rest day" checkbox (default to `true` internally)
  - These should still be saved to the database with default values, just not shown in the UI

### Scheduling Rules Text:
- Update the "Scheduling Rules & Constraints" section text to be:
  - Very clear and consistent
  - Easy to understand by anyone
  - Well-structured with numbered sections
  - Include enhanced explanations and edge cases

---

## 5. Data Validation - Overlapping Requests

### Requirements:
- **Backend Validation**: Add validation in `backend/routers/requests.py`:
  - Before creating a new leave or shift request, check if the employee has any existing requests (leave OR shift) that overlap with the requested date range
  - Only check non-rejected requests (exclude rejected ones)
  - If overlap is found, return a detailed error message listing:
    - The type of conflicting request (Leave or Shift)
    - The shift/leave code
    - The overlapping date range (from_date to to_date)
- **Frontend Display**: In `frontend/src/pages/RosterRequests.tsx`, display the detailed overlap error message from the backend when a user tries to submit a conflicting request.

---

## 6. General UI Consistency

### Requirements:
- **Filter Wording**: Change "both" to "All Requests" in the request filter dropdown in User Management.
- **Pin Icon**: Use 📌 (pin emoji) for "Force" indicators throughout the application (not SVG icons).
- **Schedule Compactness**: Apply compact styling to all schedule views consistently.

---

## Technical Notes

### File Structure:
- Frontend components: `frontend/src/components/`
- Frontend pages: `frontend/src/pages/`
- Backend routers: `backend/routers/`
- API services: `frontend/src/services/api.ts`

### Key Components to Modify:
- `RequestsScheduleView.tsx` - Combined requests schedule in Roster Generator
- `RequestsScheduleDisplay.tsx` - Requests schedule in User Management
- `UserManagement.tsx` - User accounts and requests management
- `RulesManagement.tsx` - Leave and shift types management
- `RosterGenerator.tsx` - Main roster generator page
- `ScheduleTable.tsx` - Base schedule table component
- `backend/routers/requests.py` - Request validation
- `backend/routers/users.py` - User management endpoints

### Important Considerations:
- Maintain TypeScript type safety
- Preserve existing API contracts
- Ensure all changes are backward compatible
- Test that empty cells are properly clickable
- Verify that multi-day requests are handled correctly
- Ensure popups don't overflow viewport or schedule boundaries
- Keep color coding consistent across all views

---

## Testing Checklist

- [ ] Combined requests schedule displays both leave and shift requests correctly
- [ ] Empty cells are clickable and assign shifts to correct backend matrix
- [ ] Selecting "Empty" deletes approved requests from database
- [ ] Dropdown shows codes only, organized by type, with search
- [ ] Pin emoji (📌) appears for force indicators
- [ ] Schedules are compact and consistent
- [ ] User Management requests tab shows schedule view with filter
- [ ] Tables are collapsed by default with toggle buttons
- [ ] Range highlighting works for multi-day requests
- [ ] Hover effects apply to all cells in a range
- [ ] Action popup positions correctly without overflow
- [ ] User edit modal works with all fields
- [ ] Rules Management uses icon buttons and popup modals
- [ ] Color picker only (no hex text input)
- [ ] Overlapping request validation works with detailed error messages
- [ ] All UI text is clear and consistent

