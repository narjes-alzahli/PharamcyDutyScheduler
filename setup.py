#!/usr/bin/env python3
"""Setup script for the scheduler application."""

from setuptools import setup, find_packages

setup(
    name="scheduler",
    version="1.0.0",
    description="Pharmacy Staff Rostering System",
    packages=find_packages(),
    python_requires=">=3.11",
    install_requires=[
        "streamlit>=1.28.1",
        "pandas>=2.1.4",
        "numpy>=1.24.3",
        "ortools>=9.8.3296",
        "plotly>=5.17.0",
        "pydantic>=2.5.0",
        "pyyaml>=6.0.1",
        "protobuf>=4.25.1",
        "python-dateutil>=2.8.2",
    ],
)
