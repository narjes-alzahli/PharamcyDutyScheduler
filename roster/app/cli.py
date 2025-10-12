"""Command-line interface for staff rostering."""

import argparse
import sys
from pathlib import Path
from typing import Optional

from .model.solver import solve_roster


def main() -> None:
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Staff Rostering Prototype for Pharmacy",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Solve roster for March 2025
  python -m roster.app.cli --input ./app/data --month 2025-03 --out ./out
  
  # Solve with custom config and time limit
  python -m roster.app.cli --input ./app/data --month 2025-03 --out ./out --config config.yaml --time-limit 600
        """
    )
    
    parser.add_argument(
        "--input",
        required=True,
        help="Path to directory containing CSV files (employees.csv, demands.csv, etc.)"
    )
    
    parser.add_argument(
        "--month",
        required=True,
        help="Month to solve in YYYY-MM format (e.g., 2025-03)"
    )
    
    parser.add_argument(
        "--out",
        required=True,
        help="Output directory for results (schedule.csv, coverage_report.csv, etc.)"
    )
    
    parser.add_argument(
        "--config",
        help="Path to configuration YAML file (optional)"
    )
    
    parser.add_argument(
        "--time-limit",
        type=int,
        default=300,
        help="Time limit in seconds (default: 300)"
    )
    
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose output"
    )
    
    args = parser.parse_args()
    
    # Validate inputs
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: Input directory '{args.input}' does not exist")
        sys.exit(1)
        
    # Check for required CSV files
    required_files = ["employees.csv", "demands.csv"]
    missing_files = []
    for file in required_files:
        if not (input_path / file).exists():
            missing_files.append(file)
            
    if missing_files:
        print(f"Error: Missing required files: {', '.join(missing_files)}")
        sys.exit(1)
        
    # Validate month format
    try:
        year, month = args.month.split("-")
        int(year)
        int(month)
        if len(month) != 2 or int(month) < 1 or int(month) > 12:
            raise ValueError("Invalid month")
    except ValueError:
        print(f"Error: Invalid month format '{args.month}'. Use YYYY-MM format.")
        sys.exit(1)
        
    # Validate config file if provided
    if args.config:
        config_path = Path(args.config)
        if not config_path.exists():
            print(f"Error: Config file '{args.config}' does not exist")
            sys.exit(1)
            
    # Validate time limit
    if args.time_limit <= 0:
        print("Error: Time limit must be positive")
        sys.exit(1)
        
    # Print configuration
    if args.verbose:
        print(f"Input directory: {args.input}")
        print(f"Month: {args.month}")
        print(f"Output directory: {args.out}")
        if args.config:
            print(f"Config file: {args.config}")
        print(f"Time limit: {args.time_limit} seconds")
        print()
        
    # Solve roster
    try:
        success = solve_roster(
            data_dir=args.input,
            month=args.month,
            output_dir=args.out,
            config_file=args.config,
            time_limit=args.time_limit
        )
        
        if success:
            print("✅ Roster solved successfully!")
            print(f"Results saved to: {args.out}")
            sys.exit(0)
        else:
            print("❌ Failed to solve roster")
            sys.exit(1)
            
    except Exception as e:
        print(f"❌ Error: {e}")
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
