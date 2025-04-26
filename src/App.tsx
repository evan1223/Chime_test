// src/App.tsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ChimeDemo from './ChimeDemo';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="*" element={<ChimeDemo />} />
      </Routes>
    </Router>
  );
}

export default App;

