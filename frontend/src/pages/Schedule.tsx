import React, { useState, useEffect, useRef } from 'react';
import { schedulesAPI, Schedule } from '../services/api';
import { ScheduleTable } from '../components/ScheduleTable';
import * as htmlToImage from 'html-to-image';
import { useAuth } from '../contexts/AuthContext';

export const SchedulePage: React.FC = () => {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [currentSchedule, setCurrentSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
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
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load schedule');
      setCurrentSchedule(null);
    } finally {
      setLoading(false);
    }
  };

  // Get available years and months
  const availableYears = Array.from(new Set(schedules.map(s => s.year))).sort();
  const availableMonths = selectedYear
    ? Array.from(
        new Set(
          schedules
            .filter(s => s.year === selectedYear)
            .map(s => s.month)
        )
      ).sort()
    : [];

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

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
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Year
                </label>
                <select
                  value={selectedYear || ''}
                  onChange={(e) => {
                    setSelectedYear(e.target.value ? parseInt(e.target.value) : null);
                    setSelectedMonth(null);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">Select Year...</option>
                  {availableYears.map(year => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Month
                </label>
                <select
                  value={selectedMonth || ''}
                  onChange={(e) => setSelectedMonth(e.target.value ? parseInt(e.target.value) : null)}
                  disabled={!selectedYear}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                >
                  <option value="">Select Month...</option>
                  {availableMonths.map(month => (
                    <option key={month} value={month}>
                      {monthNames[month - 1]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {(!selectedYear || !selectedMonth) && (
              <div className="mt-4 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded">
                Please select both a year and month to view the schedule.
              </div>
            )}
          </div>

          {selectedYear && selectedMonth && currentSchedule && (
            <>
              {/* Schedule Table */}
              <div
                ref={scheduleCardRef}
                className="bg-white rounded-lg shadow p-6 mb-6"
                style={{ overflow: 'visible' }}
              >
                <h3 className="text-xl font-bold text-gray-900 mb-4">
                  {monthNames[selectedMonth - 1]} {selectedYear} Schedule
                </h3>
                <ScheduleTable
                  schedule={currentSchedule.schedule}
                  year={selectedYear}
                  month={selectedMonth}
                  employees={currentSchedule.employees}
                />
              </div>

              {/* Download Button */}
              <div className="bg-white rounded-lg shadow p-6">
                <button
                  onClick={handleDownloadImage}
                  disabled={downloading}
                  className={`w-full md:w-auto px-6 py-3 bg-red-600 text-white font-bold rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors ${
                    downloading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-red-700'
                  }`}
                >
                  {downloading ? 'Preparing Image...' : 'Download Schedule'}
                </button>
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

