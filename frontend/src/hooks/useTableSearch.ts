import { useMemo, useState } from 'react';

export const useTableSearch = <T extends Record<string, any>>(
  data: T[],
  searchableKeys?: string[]
) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) {
      return data;
    }

    const term = searchTerm.toLowerCase().trim();
    const keysToSearch = searchableKeys || Object.keys(data[0] || {});

    return data.filter((item) => {
      return keysToSearch.some((key) => {
        const value = item[key];
        if (value == null) return false;
        
        // Convert to string and search
        const stringValue = String(value).toLowerCase();
        return stringValue.includes(term);
      });
    });
  }, [data, searchTerm, searchableKeys]);

  return {
    searchTerm,
    setSearchTerm,
    filteredData,
  };
};

