# 🏥 Pharmacy Staff Scheduler

**A simple web app that creates fair monthly work schedules for hospital pharmacy staff.**

No more manual scheduling headaches! This app automatically creates optimal schedules that:
- ✅ Meet all staffing requirements
- ✅ Give everyone fair night shifts
- ✅ Respect time off requests
- ✅ Follow hospital rules

## 🚀 Quick Start

### 1. Get the Code
```bash
git clone git@github.com:narjes-alzahli/PharamcyDutyScheduler.git
cd PharamcyDutyScheduler
```

### 2. Set Up Environment
```bash
# This creates a virtual environment and installs everything
./activate_env.sh
```

### 3. Launch the App
```bash
# One-click launch
./launch_app.py
```

**That's it!** Open your browser to `http://localhost:8501` and start scheduling! 🎉

## 📱 How to Use

1. **Upload your data** (or use the sample data to try it out)
2. **Pick a month** you want to schedule
3. **Click "Generate Schedule"**
4. **Download your beautiful color-coded roster!**

The app handles all the complex math to make sure everyone gets a fair schedule.

## 📊 What You Need

The app needs 4 simple CSV files:

### 1. **employees.csv** - Your Staff List
```csv
employee,skill_M,skill_O,skill_IP,skill_A,skill_N,maxN,maxA,min_days_off,weight
Ahmed,1,1,1,1,1,3,6,4,1.0
Sara,1,1,0,1,0,0,6,4,1.0
```
- List all your staff
- Mark what shifts they can work (1=yes, 0=no)
- Set limits (max night shifts, max evening shifts, etc.)

### 2. **demands.csv** - Daily Requirements
```csv
date,need_M,need_O,need_IP,need_A,need_N
2025-03-01,6,6,6,3,3
2025-03-02,6,6,6,3,3
```
- How many people you need each day for each shift

### 3. **time_off.csv** - Leave Requests (Optional)
```csv
employee,date,code
Ahmed,2025-03-05,CL
Sara,2025-03-10,W
```
- Who's taking time off and when

### 4. **locks.csv** - Special Requirements (Optional)
```csv
employee,date,shift,force
Ahmed,2025-03-12,M,1
Sara,2025-03-14,N,0
```
- Force someone to work a shift (1) or forbid them (0)

## 🎨 Shift Types

- **M** = Main shift (regular day shift)
- **O** = Outpatient shift  
- **IP** = Inpatient shift
- **A** = Evening shift (2:30 PM - 9:30 PM)
- **N** = Night shift (9:30 PM - 7:00 AM)
- **DO** = Day off
- **CL** = Clinic
- **ML** = Medical leave
- **W** = Weekend
- **UL** = Unpaid leave

## 🎯 What the App Does

The app automatically creates schedules that:

✅ **Meet all requirements** - Every shift gets the right number of people  
✅ **Are fair** - Everyone gets roughly the same number of night shifts  
✅ **Respect time off** - No one works when they're on leave  
✅ **Follow rules** - No one works back-to-back night and day shifts  
✅ **Look professional** - Color-coded roster ready to print  

## 🔧 Environment Setup

The app uses a virtual environment to keep dependencies organized:

### What `./activate_env.sh` does:
1. Creates a virtual environment called `scheduler_env`
2. Installs all required packages (OR-Tools, Streamlit, etc.)
3. Pins exact versions to avoid conflicts

### Manual setup (if needed):
```bash
# Create virtual environment
python -m venv scheduler_env

# Activate it
source scheduler_env/bin/activate  # On Mac/Linux
# or
scheduler_env\Scripts\activate     # On Windows

# Install requirements
pip install -r requirements.txt
```

### To update dependencies:
```bash
# Activate environment first
source scheduler_env/bin/activate

# Update specific package
pip install --upgrade streamlit

# Update requirements file
pip freeze > requirements.txt
```

## 🚨 Troubleshooting

**App won't start?**
- Make sure you ran `./activate_env.sh` first
- Check that port 8501 isn't being used by another app

**Schedule looks wrong?**
- Check your CSV files for typos
- Make sure you have enough staff for the requirements
- Try reducing the time limit if it's taking too long

**Need help?**
- Check the sample data in `roster/app/data/` for examples
- Open an issue on GitHub

## 📁 Project Structure

```
PharamcyDutyScheduler/
├── launch_app.py          # 🚀 One-click launcher
├── activate_env.sh        # 🔧 Environment setup
├── requirements.txt       # 📦 Dependencies
├── roster/
│   └── app/
│       ├── ui/            # 🌐 Web interface
│       ├── model/         # 🧠 Scheduling logic
│       └── data/          # 📊 Sample data
└── README.md             # 📖 This file
```

---

**Made with ❤️ for hospital pharmacy teams**
