// ============================================================
// components/TripForm.jsx — Trip Input Form
// ============================================================
// WHAT: The form the user fills in before the plan is generated.
//       Collects: destination, departure city, dates, travelers,
//       budget, and interests.
//
// PATTERN: Controlled form component.
//   Each input is "controlled" — its value is stored in React state
//   and React re-renders on every keystroke. This is the standard
//   React pattern for forms.
//
// WHY THIS IS A SEPARATE COMPONENT:
//   Keeps App.jsx clean. App.jsx manages phases and streaming;
//   TripForm manages form state. Single responsibility.
//
// HOW DATA FLOWS:
//   User types → local formData state updates (controlled inputs)
//   User submits → onSubmit(formData) called → App.jsx takes over
// ============================================================

import { useState } from 'react';

// Default dates: 3 months from now, 7 days long
// WHY: Gives users a sensible starting point rather than blank fields
function getDefaultDates() {
  const start = new Date();
  start.setMonth(start.getMonth() + 3);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

const defaults = getDefaultDates();

export default function TripForm({ onSubmit }) {
  // [WORKFLOW] Controlled form state — one object for all fields
  const [formData, setFormData] = useState({
    destination: '',
    departureCity: '',
    startDate: defaults.startDate,
    endDate: defaults.endDate,
    travelers: 2,
    budget: 3000,
    interests: '',
  });

  const [loading, setLoading] = useState(false);

  // [WORKFLOW] Single change handler for all inputs
  // WHY: Rather than a separate handler per field, we use the input's
  // name attribute to know which field to update. Keeps the code DRY.
  function handleChange(e) {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      // number inputs need parseInt; text inputs use value directly
      [name]: type === 'number' ? parseInt(value, 10) || 0 : value,
    }));
  }

  function handleSubmit(e) {
    e.preventDefault(); // prevent browser's default form submission (page reload)
    if (loading) return;

    // Basic validation — all fields required
    if (!formData.destination.trim() || !formData.departureCity.trim() || !formData.interests.trim()) {
      alert('Please fill in destination, departure city, and interests.');
      return;
    }
    if (formData.budget < 100) {
      alert('Budget must be at least $100.');
      return;
    }

    setLoading(true);
    // Pass form data up to App.jsx — it handles the API call
    onSubmit(formData);
  }

  return (
    <div className="form-container">
      <div className="form-card">
        <h2>Plan Your Trip</h2>
        <p className="form-subtitle">
          Fill in your trip details and 8 AI agents will build your complete travel plan.
        </p>

        <form onSubmit={handleSubmit} className="trip-form">

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="destination">Destination</label>
              <input
                id="destination"
                name="destination"
                type="text"
                placeholder="e.g. Paris, France"
                value={formData.destination}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="departureCity">Departure City</label>
              <input
                id="departureCity"
                name="departureCity"
                type="text"
                placeholder="e.g. Mumbai, India"
                value={formData.departureCity}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="startDate">Departure Date</label>
              <input
                id="startDate"
                name="startDate"
                type="date"
                value={formData.startDate}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="endDate">Return Date</label>
              <input
                id="endDate"
                name="endDate"
                type="date"
                value={formData.endDate}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="travelers">Number of Travelers</label>
              <input
                id="travelers"
                name="travelers"
                type="number"
                min="1"
                max="20"
                value={formData.travelers}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="budget">Total Budget (USD)</label>
              <input
                id="budget"
                name="budget"
                type="number"
                min="100"
                step="100"
                placeholder="e.g. 3000"
                value={formData.budget}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <div className="form-group full-width">
            <label htmlFor="interests">Interests & Preferences</label>
            <input
              id="interests"
              name="interests"
              type="text"
              placeholder="e.g. art, food, history, hiking, beaches, nightlife"
              value={formData.interests}
              onChange={handleChange}
              required
            />
            <span className="form-hint">Separate with commas — the agents will tailor the plan to these</span>
          </div>

          <button
            type="submit"
            className={`submit-btn ${loading ? 'loading' : ''}`}
            disabled={loading}
          >
            {loading ? 'Starting agents...' : 'Build My Trip Plan'}
          </button>
        </form>
      </div>
    </div>
  );
}
