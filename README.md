# Staff Rostering Prototype (Pharmacy)

A comprehensive staff rostering system for pharmacy operations that generates optimal monthly duty rosters using constraint programming and optimization.

## Features

- **Coverage Requirements**: Meet daily staffing targets for different shift types
- **Skill Matching**: Assign staff only to shifts they're qualified for
- **Rest Rules**: Enforce weekly rest requirements and forbidden shift sequences
- **Fairness**: Distribute night and evening shifts fairly among staff
- **Flexibility**: Support for time off, lock assignments, and configurable rules
- **Multiple Interfaces**: CLI for batch processing and Streamlit web UI for interactive use

## Quick Start

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd scheduler

# Install dependencies
pip install -e .

# Install development dependencies (optional)
pip install -e ".[dev]"
```

### Using the CLI

```bash
# Solve roster for March 2025 using sample data
python -m roster.app.cli --input ./roster/app/data --month 2025-03 --out ./output

# Solve with custom configuration
python -m roster.app.cli --input ./data --month 2025-03 --out ./output --config config.yaml --time-limit 600
```

### Using the Web Interface

```bash
# Launch main Streamlit web interface
streamlit run roster/app/ui/streamlit_app.py

# Or use the convenience script
python run_streamlit.py

# Launch standalone schedule viewer
python run_schedule_viewer.py
```

## Data Format

### Required Files

#### employees.csv
```csv
employee,skill_M,skill_O,skill_IP,skill_A,skill_N,maxN,maxA,min_days_off,weight
Idris,1,1,0,1,0,0,6,4,1.0
Karima,1,1,1,1,1,3,6,4,1.0
```

- `employee`: Employee name
- `skill_*`: Boolean (1/0) indicating if employee can work this shift type
- `maxN`: Maximum night shifts per month
- `maxA`: Maximum evening shifts per month  
- `min_days_off`: Minimum days off per month
- `weight`: Employee weight for fairness calculations

#### demands.csv
```csv
date,need_M,need_O,need_IP,need_A,need_N
2025-03-01,6,6,6,3,3
2025-03-02,6,6,6,3,3
```

- `date`: Date in YYYY-MM-DD format
- `need_*`: Required number of staff for each shift type

### Optional Files

#### time_off.csv
```csv
employee,date,code
Rasha,2025-03-05,CL
Ameera,2025-03-10,W
```

- `code`: Time off type (DO, CL, ML, W, UL)

#### locks.csv
```csv
employee,date,shift,force
Ameera,2025-03-12,APP,1
Shatha,2025-03-14,N,0
```

- `shift`: Shift type to lock
- `force`: 1 to require, 0 to forbid

## Configuration

Create a `config.yaml` file to customize optimization parameters:

```yaml
# Objective weights
weights:
  unfilled_coverage: 1000.0  # High penalty for not meeting coverage
  fairness: 5.0             # Weight for fair distribution
  area_switching: 1.0       # Penalty for switching areas
  do_after_n: 1.0          # Reward for day off after night

# Rest codes that count as rest days
rest_codes:
  - "DO"  # Day off
  - "CL"  # Casual leave
  - "ML"  # Medical leave
  - "W"   # Weekend

# Forbidden shift sequences
forbidden_adjacencies:
  - ["N", "M"]  # No main shift after night
  - ["A", "N"]  # No night shift after evening

# Minimum rest days per 7-day window
weekly_rest_minimum: 1
```

## Shift Types

- **M**: Main shift
- **O**: Outpatient shift
- **IP**: Inpatient shift
- **A**: Evening shift (14:30-21:30)
- **N**: Night shift (21:30-07:00)
- **DO**: Day off
- **CL**: Casual leave
- **ML**: Medical leave
- **W**: Weekend
- **UL**: Unpaid leave

## Constraints

### Hard Constraints (Must be satisfied)

1. **One assignment per day**: Each employee works exactly one shift per day
2. **Coverage requirements**: Meet daily staffing targets for each shift type
3. **Skill matching**: Employees can only work shifts they're qualified for
4. **Time off**: Respect scheduled time off and leave
5. **Lock assignments**: Honor forced assignments and restrictions
6. **Cap limits**: Respect maximum night/evening shifts per employee per month
7. **Weekly rest**: Each employee must have at least 1 rest day per 7-day window
8. **Adjacency rules**: Prevent forbidden shift sequences (e.g., no M after N)

### Soft Constraints (Optimized for)

1. **Fairness**: Minimize variance in night/evening shift distribution
2. **Area stability**: Minimize switching between different work areas
3. **Preference**: Reward day off after night shifts

## Output Files

The system generates several output files:

### schedule.csv
```csv
date,employee,shift
2025-03-01,Idris,M
2025-03-01,Karima,IP
2025-03-01,Rahma,N
```

### coverage_report.csv
```csv
date,shift,needed,assigned,shortfall,met
2025-03-01,M,6,6,0,True
2025-03-01,O,6,6,0,True
```

### per_employee_report.csv
```csv
employee,nights,evenings,days_off,main_shifts,outpatient_shifts,inpatient_shifts,total_working_days
Idris,0,3,4,8,5,0,16
Karima,3,2,4,6,4,6,21
```

### metrics.csv
```csv
metric,value,unit
solve_time,15.23,seconds
status,OPTIMAL,text
night_variance,2.1,variance
evening_variance,1.8,variance
```

## Web Interface

The Streamlit web interface provides:

- **Data Manager**: Comprehensive data editing and schedule generation
- **Input Data**: Upload CSV files or use sample data
- **Configuration**: Adjust optimization parameters
- **Solve & Results**: Run optimization and view results
- **Schedule View**: Visual schedule display with color coding
- **Reports**: Interactive visualizations and heatmaps

### Data Manager Features

- **Employee Management**: Edit skills, constraints, and preferences for each staff member
- **Demand Configuration**: Set daily staffing requirements for any month
- **Time Off Management**: Schedule leave, workshops, and other time off
- **Assignment Locks**: Force or forbid specific assignments
- **Month Selection**: Choose any month/year to customize and generate
- **Real-time Editing**: Inline editing with immediate validation
- **Schedule Generation**: Generate optimized schedules with custom parameters
- **Visual Display**: View generated schedules with color-coded formatting

### Schedule View Features

- **Color-Coded Display**: Matches pharmacy roster format with proper color coding
- **Monthly View**: Select specific months and years to view
- **Multiple Display Options**: Heatmap, detailed table, and workload analysis
- **Interactive Controls**: Toggle different views and export options
- **Professional Layout**: Similar to traditional pharmacy duty rosters

#### Color Coding System

The schedule display uses a comprehensive color coding system:

- **Main Shifts**: White background (M, O, IP, M3, M4)
- **Time-based Shifts**: 
  - Evening (A): Light orange (2:30 PM - 9:30 PM)
  - Night (N): Light yellow (9:30 PM - 7 AM)
- **Leave Types**: 
  - Day Off (DO): Light green
  - Casual Leave (CL): Light pink
  - Maternity Leave (ML): Plum
  - Unpaid Leave (UL): Light gray
- **Special Assignments**: Various colors for workshops, approvals, etc.

### Features

- File upload with validation
- Interactive configuration sliders
- Real-time optimization progress
- Schedule heatmap visualization
- Coverage analysis charts
- Employee workload distribution
- CSV download for all results

## Development

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=roster

# Run specific test file
pytest tests/test_constraints.py
```

### Code Quality

```bash
# Format code
ruff format .

# Lint code
ruff check .

# Type checking
mypy roster/
```

## Architecture

```
roster/
├── app/
│   ├── data/           # Sample data files
│   ├── model/          # Core optimization logic
│   │   ├── schema.py   # Data models and validation
│   │   ├── constraints.py  # Constraint functions
│   │   ├── scoring.py     # Objective function
│   │   └── solver.py      # Main solver
│   ├── ui/             # User interfaces
│   │   └── streamlit_app.py
│   └── cli.py          # Command-line interface
├── tests/              # Test suite
└── pyproject.toml      # Project configuration
```

## Performance

- Solves 30-day roster with 25-30 staff in < 20 seconds
- Zero unfilled coverage for default requirements
- Handles complex constraint combinations efficiently
- Scales to larger staff sizes and longer periods

## Examples

### Data Manager Usage

The Data Manager provides a comprehensive interface for managing roster data:

1. **Navigate to Data Manager**: Select "Data Manager" from the main navigation
2. **Select Month/Year**: Choose the month and year you want to work with
3. **Edit Employees**: Modify skills, constraints, and preferences
4. **Set Demands**: Configure daily staffing requirements
5. **Manage Time Off**: Add leave requests and workshops
6. **Set Locks**: Force or forbid specific assignments
7. **Generate Schedule**: Create optimized roster with custom parameters
8. **View Results**: See color-coded schedule display

### Basic Usage

```python
from roster.app.model.schema import RosterData, RosterConfig
from roster.app.model.solver import RosterSolver

# Load data
data = RosterData(Path("./data"))
data.load_data()

# Create solver
config = RosterConfig()
solver = RosterSolver(config)

# Solve
success, assignments, metrics = solver.solve(data)

if success:
    # Create output dataframes
    schedule_df = solver.create_schedule_dataframe(assignments, employees, dates)
    coverage_df = solver.create_coverage_report(assignments, employees, dates, demands)
    employee_df = solver.create_employee_report(assignments, employees, dates)
```

### Custom Configuration

```python
# Create custom configuration
config = RosterConfig()
config.weights["fairness"] = 10.0  # Increase fairness weight
config.rest_codes.add("UL")        # Add unpaid leave as rest
config.forbidden_adjacencies.append(["A", "M"])  # Add new forbidden sequence

solver = RosterSolver(config)
```

## Troubleshooting

### Common Issues

1. **Infeasible solution**: Check if constraints are too restrictive
2. **Long solve times**: Reduce time limit or simplify constraints
3. **Poor coverage**: Increase staff availability or reduce demand
4. **Unfair distribution**: Adjust fairness weights in configuration

### Debug Mode

```bash
# Run with verbose output
python -m roster.app.cli --input ./data --month 2025-03 --out ./output --verbose
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Run quality checks
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For questions and support, please open an issue in the repository or contact the development team.
