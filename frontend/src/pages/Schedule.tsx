import React, { useState, useEffect, useRef } from 'react';
import { schedulesAPI, Schedule } from '../services/api';
import { ScheduleTable } from '../components/ScheduleTable';
import * as htmlToImage from 'html-to-image';
import { useAuth } from '../contexts/AuthContext';
import { useDate } from '../contexts/DateContext';
import { DatePicker } from '../components/DatePicker';

export const SchedulePage: React.FC = () => {
  const { selectedYear, selectedMonth, setSelectedYear, setSelectedMonth } = useDate();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [currentSchedule, setCurrentSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const scheduleCardRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const isManager = user?.employee_type === 'Manager';

  useEffect(() => {
    loadSchedules();
  }, []);

  useEffect(() => {
    if (selectedYear && selectedMonth) {
      loadSchedule(selectedYear, selectedMonth);
    }
  }, [selectedYear, selectedMonth]);

  const loadSchedules = async () => {
    try {
      setLoading(true);
      const data = await schedulesAPI.getCommittedSchedules();
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
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load schedules');
    } finally {
      setLoading(false);
    }
  };

  const loadSchedule = async (year: number, month: number) => {
    try {
      setLoading(true);
      const schedule = await schedulesAPI.getSchedule(year, month);
      setCurrentSchedule(schedule);
      setHasUnsavedChanges(false);
      setSaveSuccess(false);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load schedule');
      setCurrentSchedule(null);
    } finally {
      setLoading(false);
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

  if (loading && !currentSchedule) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-3xl font-bold text-gray-900 mb-6">Monthly Roster</h2>

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

          {selectedYear && selectedMonth && currentSchedule && (
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

          {selectedYear && selectedMonth && !currentSchedule && !loading && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
              No schedule data available for {monthNames[selectedMonth - 1]} {selectedYear}
            </div>
          )}
        </>
      )}
    </div>
  );
};

