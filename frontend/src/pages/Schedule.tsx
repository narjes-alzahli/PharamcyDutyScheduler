import React, { useState, useEffect, useRef, useCallback } from 'react';
import { schedulesAPI, Schedule } from '../services/api';
import { ScheduleTable } from '../components/ScheduleTable';
import * as htmlToImage from 'html-to-image';
import { useAuth } from '../contexts/AuthContext';
import { useAuthGuard } from '../hooks/useAuthGuard';
import { useDate } from '../contexts/DateContext';
import { DatePicker } from '../components/DatePicker';
import { isTokenExpired } from '../utils/tokenUtils';

export const SchedulePage: React.FC = () => {
  const { selectedYear, selectedMonth, setSelectedYear, setSelectedMonth } = useDate();
  // FIX: Use auth guard to prevent API calls until auth is confirmed
  const { isReady: authReady } = useAuthGuard(false); // Requires auth but not manager
  const { user, loading: authLoading } = useAuth(); // Keep for isManager check
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [schedulesLoaded, setSchedulesLoaded] = useState(false); // Track if schedules list is loaded
  const [currentSchedule, setCurrentSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSchedule, setLoadingSchedule] = useState(false); // Separate loading state for individual schedule
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const scheduleCardRef = useRef<HTMLDivElement>(null);
  const isManager = user?.employee_type === 'Manager';

  const loadSchedules = useCallback(async (signal?: AbortSignal) => {
    // FIX: Double-check token is still valid right before making the call
    // This prevents race conditions where token expires between guard check and API call
    const token = localStorage.getItem('access_token');
    if (!token || isTokenExpired(token)) {
      // Token expired between guard check and API call - skip request
      console.warn('⚠️ Token expired between guard check and API call - skipping request');
      setSchedules([]);
      setSchedulesLoaded(true);
      setLoading(false);
      setError('Authentication expired. Please refresh the page.');
      return;
    }

    // FIX: Check if request was cancelled before making API call
    if (signal?.aborted) {
      return;
    }

    try {
      setLoading(true);
      setSchedulesLoaded(false);
      // FIX: Pass abort signal to axios request (axios supports AbortSignal)
      const data = await schedulesAPI.getCommittedSchedules(signal);
      
      // FIX: Check if request was cancelled after API call
      if (signal?.aborted) {
        return;
      }
      
      setSchedules(data);

      if (data.length === 0) {
        setSelectedYear(null);
        setSelectedMonth(null);
        setCurrentSchedule(null);
      } else if (
        selectedYear &&
        selectedMonth &&
        !data.some((s) => s.year === selectedYear && s.month === selectedMonth)
      ) {
        // Previously selected schedule no longer exists
        setCurrentSchedule(null);
        setSelectedMonth(null);
      }
      setSchedulesLoaded(true); // Mark schedules as loaded
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load schedules');
      setSchedulesLoaded(true); // Still mark as loaded so UI can show error state
    } finally {
      setLoading(false);
    }
  }, []);

  // FIX: Load schedules list ONLY after auth guard confirms we're ready
  // This ensures user is authenticated AND token is valid before making API calls
  // FIX: Add request cancellation on unmount to prevent memory leaks
  useEffect(() => {
    const abortController = new AbortController();
    
    if (authReady) {
      loadSchedules(abortController.signal);
    } else {
      // Auth not ready - clear schedules and show loading
      setSchedules([]);
      setSchedulesLoaded(false);
      setLoading(true);
      setError(null);
    }
    
    // FIX: Cancel request on unmount or when authReady changes
    return () => {
      abortController.abort();
    };
  }, [authReady, loadSchedules]);

  // Load specific schedule ONLY after schedules list is loaded
  useEffect(() => {
    if (!schedulesLoaded) return; // Wait for schedules list to be loaded first
    
    if (selectedYear && selectedMonth) {
      // Verify the schedule exists in the list before trying to load it
      const scheduleExists = schedules.some(
        (s) => s.year === selectedYear && s.month === selectedMonth
      );
      if (scheduleExists) {
        loadSchedule(selectedYear, selectedMonth);
      } else {
        // Selected schedule doesn't exist, clear selection
        setCurrentSchedule(null);
      }
    }
  }, [selectedYear, selectedMonth, schedulesLoaded, schedules]);

  const loadSchedule = async (year: number, month: number) => {
    try {
      setLoadingSchedule(true);
      const schedule = await schedulesAPI.getSchedule(year, month);
      setCurrentSchedule(schedule);
      setHasUnsavedChanges(false);
      setSaveSuccess(false);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load schedule');
      setCurrentSchedule(null);
    } finally {
      setLoadingSchedule(false);
    }
  };

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Get available years and months
  const availableYears = Array.from(new Set(schedules.map(s => s.year))).sort();
  // Get all available year-month combinations for the combined picker
  const availableYearMonthCombos = schedules.map(s => ({
    year: s.year,
    month: s.month,
    value: `${s.year}-${s.month}`,
    label: `${monthNames[s.month - 1]} ${s.year}`
  })).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });

  const handleDownloadImage = async () => {
    if (!scheduleCardRef.current || !selectedYear || !selectedMonth) {
      return;
    }

    try {
      setDownloading(true);
      setDownloadError(null);

      const dataUrl = await htmlToImage.toPng(scheduleCardRef.current, {
        cacheBust: true,
        pixelRatio: Math.min(3, (window.devicePixelRatio || 2) + 0.5),
        backgroundColor: '#ffffff',
        width: scheduleCardRef.current.scrollWidth + 80,
        height: scheduleCardRef.current.scrollHeight + 80,
        style: {
          padding: '40px',
        },
      });

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `schedule_${selectedYear}_${selectedMonth.toString().padStart(2, '0')}.png`;
      link.click();
    } catch (err) {
      console.error('Failed to download schedule image', err);
      setDownloadError('Failed to download schedule image. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const handleScheduleChange = (updatedSchedule: any[]) => {
    if (currentSchedule) {
      setCurrentSchedule({
        ...currentSchedule,
        schedule: updatedSchedule
      });
      setHasUnsavedChanges(true);
      setSaveSuccess(false);
    }
  };

  const handleSaveSchedule = async () => {
    if (!currentSchedule || !selectedYear || !selectedMonth) {
      alert('No schedule to save');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSaveSuccess(false);
      
      // Normalize all dates to ISO format (YYYY-MM-DDTHH:MM:SS) before sending
      const normalizedSchedule = currentSchedule.schedule.map(entry => ({
        ...entry,
        date: entry.date.includes('T') ? entry.date : `${entry.date.split('T')[0]}T00:00:00`
      }));
      
      await schedulesAPI.updateSchedule(
        selectedYear,
        selectedMonth,
        normalizedSchedule,
        currentSchedule.employees
      );
      
      // Reload the schedule to get the updated version
      await loadSchedule(selectedYear, selectedMonth);
      
      setHasUnsavedChanges(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 5000);
    } catch (err: any) {
      const errorMessage = err.response?.data?.detail || err.message || 'Failed to save schedule changes';
      setError(errorMessage);
      alert(`Failed to save: ${errorMessage}`);
      console.error('Save error:', err);
    } finally {
      setSaving(false);
    }
  };

  // Show loading spinner while auth is loading or initial schedules list is loading
  // FIX: Show loading while auth is being verified
  // This prevents components from making API calls before auth is ready
  if (authLoading || !authReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        <span className="ml-3 text-gray-600">Loading schedules...</span>
      </div>
    );
  }

  // Show loading spinner while initial schedules list is loading
  if (loading && !schedulesLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        <span className="ml-3 text-gray-600">Loading schedules...</span>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Monthly Roster</h2>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {schedules.length === 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
          No committed schedules available
          {isManager ? '. Generate a new roster from the Roster Generator when you are ready.' : '.'}
        </div>
      ) : (
        <>
          {/* Year and Month Selection */}
          <DatePicker 
            className="mb-6"
            combined={true}
            availableYearMonthCombos={availableYearMonthCombos}
          />

          {selectedYear && selectedMonth && loadingSchedule && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              <span className="ml-3 text-gray-600">Loading schedule...</span>
            </div>
          )}

          {selectedYear && selectedMonth && currentSchedule && !loadingSchedule && (
            <>

              {/* Schedule Table */}
              <div
                ref={scheduleCardRef}
                className="bg-white rounded-lg shadow p-6 mb-6"
                style={{ overflow: 'visible' }}
              >
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold text-gray-900">
                  {monthNames[selectedMonth - 1]} {selectedYear} Schedule
                </h3>
                  {isManager && !hasUnsavedChanges && (
                    <span className="text-sm text-gray-500 italic">Click any cell to edit</span>
                  )}
                </div>
                <ScheduleTable
                  schedule={currentSchedule.schedule}
                  year={selectedYear}
                  month={selectedMonth}
                  employees={currentSchedule.employees}
                  editable={isManager}
                  onScheduleChange={handleScheduleChange}
                />
              </div>

              {/* Action Buttons */}
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
                  {isManager && hasUnsavedChanges && (
                    <div className="flex items-center space-x-3">
                      <span className="text-sm text-amber-600 font-medium">Unsaved changes</span>
                      <button
                        onClick={handleSaveSchedule}
                        disabled={saving}
                        className={`px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors ${
                          saving ? 'opacity-70 cursor-not-allowed' : 'hover:bg-blue-700'
                        }`}
                      >
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  )}
                  
                  {isManager && saveSuccess && (
                    <span className="text-sm text-green-600 font-medium">Changes saved successfully</span>
                  )}
                  
                <button
                  onClick={handleDownloadImage}
                  disabled={downloading}
                    className={`px-6 py-3 bg-red-600 text-white font-bold rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors ${
                    downloading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-red-700'
                  }`}
                >
                  {downloading ? 'Preparing Image...' : 'Download Schedule'}
                </button>
                </div>
                {downloadError && (
                  <p className="mt-3 text-sm text-red-600">{downloadError}</p>
                )}
              </div>
            </>
          )}

          {selectedYear && selectedMonth && !currentSchedule && !loading && !loadingSchedule && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
              No schedule data available for {monthNames[selectedMonth - 1]} {selectedYear}
            </div>
          )}
        </>
      )}
    </div>
  );
};

