import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';

interface DateContextType {
  selectedYear: number | null;
  selectedMonth: number | null;
  setSelectedYear: (year: number | null) => void;
  setSelectedMonth: (month: number | null) => void;
  setDate: (year: number | null, month: number | null) => void;
}

const DateContext = createContext<DateContextType | undefined>(undefined);

export const useDate = () => {
  const context = useContext(DateContext);
  if (!context) {
    throw new Error('useDate must be used within a DateProvider');
  }
  return context;
};

interface DateProviderProps {
  children: ReactNode;
}

export const DateProvider: React.FC<DateProviderProps> = ({ children }) => {
  // Always start with null (empty selection) on each login session
  const [selectedYear, setSelectedYearState] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonthState] = useState<number | null>(null);
  const { isAuthenticated } = useAuth();

  // Clear date selection when user logs out
  useEffect(() => {
    if (!isAuthenticated) {
      setSelectedYearState(null);
      setSelectedMonthState(null);
    }
  }, [isAuthenticated]);

  const setSelectedYear = (year: number | null) => {
    setSelectedYearState(year);
    if (!year) {
      setSelectedMonthState(null);
    }
  };

  const setSelectedMonth = (month: number | null) => {
    setSelectedMonthState(month);
  };

  const setDate = (year: number | null, month: number | null) => {
    setSelectedYearState(year);
    setSelectedMonthState(month);
  };

  return (
    <DateContext.Provider
      value={{
        selectedYear,
        selectedMonth,
        setSelectedYear,
        setSelectedMonth,
        setDate,
      }}
    >
      {children}
    </DateContext.Provider>
  );
};

