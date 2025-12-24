# Staff Scheduling Rules & Constraints

## Hard Rules (Must Be Followed)

### 1. One Shift Per Day
Each staff member is assigned exactly one shift per day (either a working shift or time off).

### 2. Qualifications
Staff can only be assigned to shifts they are qualified for:
- Each staff member has specific skills (Main, Inpatient, Afternoon, Night, M3, M4, Harat, Clinic)
- Clinic-only staff can only work Clinic shifts
- Staff must have special qualifications for Inpatient (IP) and Harat (H) shifts

### 3. Coverage Requirements
The schedule strives to meet the minimum staffing requirements for each shift type every day. However, if not enough qualified staff are available (due to time off, skill constraints, or other rules), the system will assign as many as possible rather than failing to generate a schedule. The system will always prefer to meet full requirements when possible.

### 4. Time Off Requests
When staff request approved time off, they are automatically assigned that leave type (e.g., Annual Leave, Day Off, etc.).

### 5. Shift Requests
When staff request specific shifts (approved), the system will:
- **Force** them to work that shift if requested
- **Prevent** them from working that shift if they requested not to

### 6. Shift Limits
Staff have maximum limits on certain shifts:
- Maximum number of Night shifts per month
- Maximum number of Afternoon shifts per month

### 7. Minimum Rest Days
Each staff member must have a minimum number of rest days per month (using approved leave codes or Off Duty).

### 8. Weekly Rest
Every staff member must have at least 1 rest day per week (7-day period).

### 9. Forbidden Shift Sequences
Staff cannot work these shift combinations on consecutive days:
- **Night → Main**: Cannot work Main shift the day after Night shift
- **Afternoon → Night**: Cannot work Night shift the day after Afternoon shift
- **Night → Night**: Cannot work Night shifts on consecutive days

### 10. Required Rest After Shifts
After working certain shifts, staff must have rest days:
- **After Night shift**: Must have 2 rest days (Off Duty) on the next two days
- **After M4 shift**: Must have 1 rest day (Off Duty) the next day
- **After Afternoon shift**: Must have 1 rest day (Off Duty) the next day

### 11. Single-Skill Staff
Staff who are only qualified for one type of shift:
- Work that shift Sunday through Thursday
- Rest on Friday and Saturday
- *Exceptions: Can be overridden by approved time off or shift requests*

### 12. Clinic Availability
At most 1 Clinic staff member can be on leave at any given time (ensures clinic coverage).

---

## Optimization Goals (Preferences)

The system tries to make the schedule as fair as possible by:

1. **Meeting Coverage**: Prioritizes meeting all staffing requirements (highest priority). If full coverage isn't possible due to constraints, assigns as many staff as available rather than failing.

2. **Fair Distribution**: Distributes shifts fairly among staff:
   - Equal distribution of Night shifts
   - Equal distribution of Afternoon shifts
   - Equal total working days
   - Equal weekend shifts

3. **Avoiding Over-staffing**: Prefers assigning exactly the required number of staff (not more)

4. **Minimizing Area Switching**: Prefers keeping staff in the same work area when possible (currently disabled)

---

## Rest Days That Count

The following leave types count as rest days for weekly and monthly rest requirements:
- Day Off (DO)
- Annual Leave (AL)
- Maternity Leave (ML)
- Workshop (W)
- Unpaid Leave (UL)
- Appointment (APP)
- Study Leave (STL)
- Leave (L)
- Off Duty (O)

---

## Notes

- All hard rules must be satisfied for a schedule to be valid
- **Coverage is flexible**: If not enough staff are available to meet full requirements, the system will assign as many as possible rather than failing. For example, if 6 staff are needed but only 4 are available, it will assign 4 (with a penalty) rather than failing to generate a schedule.
- If the system cannot find a solution, it means the rules are too restrictive (e.g., too many time off requests, insufficient qualified staff, conflicting shift requests)
- Optimization goals are preferences - the system will try to achieve them but will prioritize satisfying all hard rules first

