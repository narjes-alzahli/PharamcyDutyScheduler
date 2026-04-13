# Staff Scheduling Rules & Constraints

## Roster generation (summary)

Generation uses a **constraint solver** (Google OR-Tools CP-SAT). It uses the same data you manage in the app: who can cover which shift types, how many people you need each day, approved leave and locked shifts, and rules like rest after certain shifts.

A **sanity check** runs first to catch obvious problems. Then the solver builds a model where **hard** rules must be satisfied (for example: one assignment per person per day, skills match shifts, coverage targets for non-soft shifts) and **soft** goals are minimized as much as possible (for example: fairness, unfilled demand penalties for shifts that allow it).

Implementation is split across modules such as `solver.py` (orchestration), `constraints.py` (rules in the model), and `scoring.py` (objective / penalties). The sections below list each rule in detail.

---

## Hard Rules (Must Be Followed)

### 1. One Shift Per Day
Each staff member is assigned exactly one shift per day (either a working shift or time off).

### 2. Qualifications
Staff can only be assigned to shifts they are qualified for:
- Each staff member has specific skills (Main, Inpatient, Afternoon, Night, M3, M4, Harat, Clinic)
- Staff who have only the Clinic (CL) skill can only work Clinic shifts
- Staff must have the corresponding skill flag enabled to work a shift (e.g., skill_IP=True for IP shifts, skill_H=True for H shifts)

### 3. Coverage Requirements
- **Hard coverage** (must be met exactly): All shift types **except M and IP** (e.g. A, N, M3, M4, H, CL, E, etc.). Demand must be satisfied every day or the solver will not find a solution.
- **Soft coverage** (M and IP only): The schedule strives to meet M and IP staffing requirements. If not enough qualified staff are available, the system will assign as many as possible and penalize shortfalls rather than failing.

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

*Note: These rules can be overridden by approved employee shift requests (force=True). If an employee requests both shifts in a forbidden pair, the constraint will be skipped to honor their request.*

### 10. Required Rest After Shifts (high-priority soft rule)
The solver tries to satisfy rest after these shifts as much as possible (strong penalty if violated):
- **After Night shift**: Prefer 2 rest days (Off Duty) on the next two days
- **After M4 shift**: Prefer 1 rest day (Off Duty) the next day
- **After Afternoon shift**: Prefer 1 rest day (Off Duty) the next day

If the solver cannot satisfy rest (e.g. coverage or other constraints), it may assign work and incur a penalty rather than failing. Exceptions (no penalty when rest is skipped):
- If staff have approved leave (e.g., DO, AL, etc.) on the rest day, leave counts as rest
- If staff **requested** the shift AND **requested** another shift on the rest day(s), their request is respected

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

1. **Meeting Coverage**: For M and IP, prioritizes meeting staffing requirements (soft; shortfalls are penalized). For all other shifts, coverage is hard (must be met exactly).

2. **Fair Distribution**: Distributes shifts fairly among staff:
   - Equal distribution of Night shifts (among those with skill_N)
   - Equal distribution of Afternoon shifts (among those with skill_A)
   - Equal distribution of M4 shifts (among those with skill_M4)
   - Equal distribution of Thursday shifts (excluding M and M3, among multi-skill employees)
   - Equal weekend shifts (among multi-skill employees)
   - Equal total working days (among multi-skill employees only; single-skill employees have fixed schedules)

3. **Avoiding Over-staffing**: Prefers assigning exactly the required number of staff (not more)

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
- **Coverage**: Only M and IP allow under-staffing (with a penalty). All other shifts must meet demand exactly.
- **Rest after N/M4/A** is a high-priority soft rule (penalty weight 4000): the solver satisfies it as much as possible but can violate it if necessary; only a few exceptions when needed.
- If the system cannot find a solution, hard rules cannot be satisfied (e.g. coverage for non-M/IP shifts, time off, qualifications).
- Optimization goals are preferences - the system will try to achieve them but will prioritize satisfying all hard rules first

