import React from 'react';
import { useAuth } from '../contexts/AuthContext';

export const Dashboard: React.FC = () => {
  const { user } = useAuth();

  if (user?.employee_type === 'Manager') {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Roster Generator</h2>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-gray-600 mb-4">
            Welcome to the Roster Generator. This page will allow you to:
          </p>
          <ul className="list-disc list-inside space-y-2 text-gray-700">
            <li>Manage employee data</li>
            <li>Set daily shift requirements</li>
            <li>Generate optimized schedules</li>
            <li>View and commit schedules</li>
          </ul>
          <div className="mt-6">
            <p className="text-sm text-gray-500">
              Full functionality coming soon...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Roster Requests</h2>
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600 mb-4">
          Submit leave requests and shift preferences here.
        </p>
        <div className="mt-6">
          <p className="text-sm text-gray-500">
            Full functionality coming soon...
          </p>
        </div>
      </div>
    </div>
  );
};

