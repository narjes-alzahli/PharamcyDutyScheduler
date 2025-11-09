import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const HomeRedirect: React.FC = () => {
  const { user } = useAuth();
  
  if (user?.employee_type === 'Manager') {
    return <Navigate to="/generator" replace />;
  } else {
    return <Navigate to="/requests" replace />;
  }
};

