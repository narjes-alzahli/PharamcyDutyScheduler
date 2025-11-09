# Staff Rostering System - React + Tailwind Frontend

This is the new React + Tailwind CSS frontend for the Staff Rostering System, running alongside a FastAPI backend.

## Project Structure

```
scheduler/
├── backend/              # FastAPI backend API
│   ├── main.py          # FastAPI app entry point
│   └── routers/         # API route handlers
│       ├── auth.py      # Authentication endpoints
│       ├── data.py      # Data management endpoints
│       ├── solver.py    # Solver endpoints
│       └── schedules.py # Schedule endpoints
├── frontend/            # React + TypeScript frontend
│   └── src/
│       ├── components/  # React components
│       ├── pages/       # Page components
│       ├── services/    # API service layer
│       └── contexts/    # React contexts (Auth, etc.)
└── roster/              # Original Python backend logic
```

## Setup Instructions

### 1. Install Backend Dependencies

```bash
# Activate your virtual environment
source scheduler_env/bin/activate  # or activate_env.sh

# Install new dependencies
pip install -r requirements.txt
```

### 2. Install Frontend Dependencies

```bash
cd frontend
npm install
```

**Note:** The `.env` file is already created with the default API URL. If you need to change it, edit `frontend/.env`.

### 3. Run the Backend

In one terminal:

```bash
# Activate virtual environment
source scheduler_env/bin/activate

# Run FastAPI server
python run_backend.py
```

The backend will run on `http://localhost:8000`

### 4. Run the Frontend

In another terminal:

```bash
cd frontend
npm start
```

The frontend will run on `http://localhost:3000`

## API Documentation

Once the backend is running, visit:
- API Docs: `http://localhost:8000/docs` (Swagger UI)
- ReDoc: `http://localhost:8000/redoc`

## Features Implemented

✅ **Backend API**
- Authentication (login/logout)
- User management
- Data endpoints (employees, demands)
- Solver endpoints (async job processing)
- Schedule endpoints

✅ **Frontend**
- React + TypeScript setup
- Tailwind CSS styling
- Authentication flow (login/logout)
- Protected routes
- Layout with sidebar navigation
- API service layer

## Next Steps

- [ ] Migrate schedule display with Plotly
- [ ] Implement roster generator page
- [ ] Add reports & visualization
- [ ] Implement user management
- [ ] Add roster requests for staff

## Development Notes

- The backend uses the existing Python solver logic from `roster/app/model/`
- Authentication uses simple token-based auth (can be upgraded to JWT)
- CORS is configured for local development
- The frontend uses React Router for navigation
- Tailwind CSS is configured with a custom primary color scheme

## Troubleshooting

**Backend won't start:**
- Make sure all dependencies are installed: `pip install -r requirements.txt`
- Check that port 8000 is not in use

**Frontend won't start:**
- Make sure Node.js is installed: `node --version`
- Run `npm install` in the frontend directory
- Check that port 3000 is not in use

**API calls failing:**
- Make sure the backend is running on port 8000
- Check browser console for CORS errors
- Verify the API URL in `frontend/src/services/api.ts`

