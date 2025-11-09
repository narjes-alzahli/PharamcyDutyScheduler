import React, { useState, useEffect, useCallback } from 'react';
import { EditableTable } from './EditableTable';
import api from '../services/api';

interface DemandsTabProps {
  selectedYear: number | null;
  selectedMonth: number | null;
  monthNames: string[];
}

export const DemandsTab: React.FC<DemandsTabProps> = ({ selectedYear, selectedMonth, monthNames }) => {
  const [monthDemands, setMonthDemands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekdayConfig, setWeekdayConfig] = useState([
    { Shift: 'M', Count: 6 },
    { Shift: 'IP', Count: 3 },
    { Shift: 'A', Count: 1 },
    { Shift: 'N', Count: 1 },
    { Shift: 'M3', Count: 1 },
    { Shift: 'M4', Count: 1 },
    { Shift: 'CL', Count: 2 },
  ]);
  const [weekendConfig, setWeekendConfig] = useState([
    { Shift: 'A', Count: 1 },
    { Shift: 'N', Count: 1 },
    { Shift: 'M3', Count: 1 },
  ]);
  const [haratConfig, setHaratConfig] = useState([
    { Shift: 'H', Count: 3 },
  ]);
  const [regenerating, setRegenerating] = useState(false);

  const generateDefaults = useCallback(async (year: number, month: number) => {
    const base_demand = {
      'M': 6, 'IP': 3, 'A': 1, 'N': 1, 'M3': 1, 'M4': 1, 'H': 3, 'CL': 2
    };
    const weekend_demand = {
      'M': 0, 'IP': 0, 'A': 1, 'N': 1, 'M3': 1, 'M4': 0, 'H': 0, 'CL': 0
    };
    
    try {
      const response = await api.post('/api/data/demands/generate', {
        year,
        month,
        base_demand,
        weekend_demand,
      });
      setMonthDemands(response.data.demands);
    } catch (error) {
      console.error('Failed to generate defaults:', error);
    }
  }, []);

  useEffect(() => {
    if (!selectedYear || !selectedMonth) {
      setLoading(false);
      return;
    }
    
    const loadMonthDemands = async () => {
      try {
        setLoading(true);
        const response = await api.get(`/api/data/demands/month/${selectedYear}/${selectedMonth}`);
        const demands = response.data;
        
        if (demands.length === 0) {
          // Auto-generate if empty
          await generateDefaults(selectedYear, selectedMonth);
        } else {
          setMonthDemands(demands);
        }
      } catch (error) {
        console.error('Failed to load demands:', error);
        // Try to generate defaults
        await generateDefaults(selectedYear, selectedMonth);
      } finally {
        setLoading(false);
      }
    };
    
    loadMonthDemands();
  }, [selectedYear, selectedMonth, generateDefaults]);

  const handleResetDefaults = async () => {
    if (!selectedYear || !selectedMonth) return;
    setLoading(true);
    // Reset weekday config table to defaults
    setWeekdayConfig([
      { Shift: 'M', Count: 6 },
      { Shift: 'IP', Count: 3 },
      { Shift: 'A', Count: 1 },
      { Shift: 'N', Count: 1 },
      { Shift: 'M3', Count: 1 },
      { Shift: 'M4', Count: 1 },
      { Shift: 'CL', Count: 2 },
    ]);
    await generateDefaults(selectedYear, selectedMonth);
    setLoading(false);
  };

  const handleDemandsChange = async (newData: any[]) => {
    if (!selectedYear || !selectedMonth) return;
    
    try {
      await api.post(`/api/data/demands/month/${selectedYear}/${selectedMonth}`, newData);
      setMonthDemands(newData);
    } catch (error) {
      console.error('Failed to save demands:', error);
      alert('Failed to save demands');
    }
  };

  const handleRegenerate = async () => {
    if (!selectedYear || !selectedMonth) return;
    
    setRegenerating(true);
    try {
      const base_demand: any = {
        'M': 0, 'IP': 0, 'A': 0, 'N': 0, 'M3': 0, 'M4': 0, 'H': 0, 'CL': 0
      };
      const weekend_demand: any = {
        'M': 0, 'IP': 0, 'A': 0, 'N': 0, 'M3': 0, 'M4': 0, 'H': 0, 'CL': 0
      };
      
      // Extract values from configs
      weekdayConfig.forEach(item => {
        if (item.Shift !== 'H') {
          base_demand[item.Shift] = item.Count;
        }
      });
      base_demand['H'] = haratConfig[0]?.Count || 0;
      
      weekendConfig.forEach(item => {
        weekend_demand[item.Shift] = item.Count;
      });
      
      const response = await api.post('/api/data/demands/generate', {
        year: selectedYear,
        month: selectedMonth,
        base_demand,
        weekend_demand,
      });
      
      setMonthDemands(response.data.demands);
      alert('✅ Month regenerated with custom settings!');
    } catch (error) {
      console.error('Failed to regenerate:', error);
      alert('Failed to regenerate month');
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!selectedYear || !selectedMonth) {
    return (
      <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded">
        Please select both a year and month first.
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-xl font-bold text-gray-900">📋 Staffing Needs</h3>
          <p className="text-gray-600">Set how many staff members are needed for each shift type on each day</p>
        </div>
        <button
          onClick={handleResetDefaults}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
        >
          🔄 Reset to Defaults
        </button>
      </div>

      {monthDemands.length > 0 ? (
        <>
          <EditableTable
            data={monthDemands}
            columns={[
              { key: 'date', label: 'Date', type: 'text' },
              { key: 'holiday', label: 'Holiday', type: 'text' },
              { key: 'need_M', label: 'Main', type: 'number', min: 0, max: 20 },
              { key: 'need_IP', label: 'Inpatient', type: 'number', min: 0, max: 20 },
              { key: 'need_A', label: 'Afternoon', type: 'number', min: 0, max: 20 },
              { key: 'need_N', label: 'Night', type: 'number', min: 0, max: 20 },
              { key: 'need_M3', label: 'M3 (7am-2pm)', type: 'number', min: 0, max: 20 },
              { key: 'need_M4', label: 'M4 (12pm-7pm)', type: 'number', min: 0, max: 20 },
              { key: 'need_H', label: 'Harat Pharmacy', type: 'number', min: 0, max: 20 },
              { key: 'need_CL', label: 'Clinic', type: 'number', min: 0, max: 20 },
            ]}
            onDataChange={handleDemandsChange}
          />

          {/* Configuration Tables */}
          <div className="mt-8 border-t border-gray-200 pt-6">
            <h4 className="text-lg font-bold text-gray-900 mb-4">Shift Requirements</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              {/* Each Weekday */}
              <div>
                <h5 className="font-semibold text-gray-700 mb-2">Each Weekday</h5>
                <EditableTable
                  data={weekdayConfig}
                  columns={[
                    { key: 'Shift', label: 'Shift', type: 'text' },
                    { key: 'Count', label: 'Count', type: 'number', min: 0, max: 20 },
                  ]}
                  onDataChange={setWeekdayConfig}
                />
              </div>

              {/* Each Weekend Day */}
              <div>
                <h5 className="font-semibold text-gray-700 mb-2">Each Weekend Day</h5>
                <EditableTable
                  data={weekendConfig}
                  columns={[
                    { key: 'Shift', label: 'Shift', type: 'text' },
                    { key: 'Count', label: 'Count', type: 'number', min: 0, max: 20 },
                  ]}
                  onDataChange={setWeekendConfig}
                />
              </div>

              {/* Each Week (Harat) */}
              <div>
                <h5 className="font-semibold text-gray-700 mb-2">Each Week</h5>
                <p className="text-xs text-gray-500 mb-2">
                  Number of H shifts per week on weekdays (randomly distributed)
                </p>
                <EditableTable
                  data={haratConfig}
                  columns={[
                    { key: 'Shift', label: 'Shift', type: 'text' },
                    { key: 'Count', label: 'Count', type: 'number', min: 0, max: 10 },
                  ]}
                  onDataChange={setHaratConfig}
                />
              </div>
            </div>

            {/* Regenerate Button */}
            <div className="flex justify-start">
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="px-6 py-3 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {regenerating ? 'Regenerating...' : 'Regenerate Month'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded">
          No demands data available for {monthNames[selectedMonth - 1]} {selectedYear}. Generating defaults...
        </div>
      )}
    </div>
  );
};

