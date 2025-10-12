#!/bin/bash
# Pharmacy Staff Rostering System - Environment Activation Script

echo "🏥 Activating Pharmacy Staff Rostering Environment..."
echo "=================================================="

# Activate the virtual environment
source scheduler_env/bin/activate

echo "✅ Virtual environment activated!"
echo "🐍 Python path: $(which python)"
echo "📦 Installed packages:"
echo "   - OR-Tools 9.8.3296 (optimization engine)"
echo "   - Streamlit 1.28.1 (web interface)"
echo "   - Pandas 2.1.4 (data handling)"
echo "   - Pydantic 2.5.0 (data validation)"
echo "   - Plotly 5.17.0 (visualization)"
echo "   - Protobuf 4.25.1 (compatible version)"
echo ""
echo "🚀 Ready to run the system!"
echo ""
echo "To start the application:"
echo "   python run_streamlit.py"
echo ""
echo "To deactivate:"
echo "   deactivate"
echo "=================================================="
