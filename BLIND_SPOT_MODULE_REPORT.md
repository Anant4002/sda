# Blind Spot Detection Module Report

## 1. Overview
The **Blind Spot Detection** module is a critical operational tool designed to identify gaps in satellite coverage over specific geographic regions. It allows operators to determine windows of time (blind spots) where no satellites from selected constellations (e.g., adversary recon, commercial, or allied assets) are visible from a target area.

This module is essential for strategic planning, ensuring that activities requiring concealment are timed during blind spots, or conversely, ensuring that critical areas have persistent surveillance coverage.

---

## 2. Key Concepts
- **Blind Spot:** A time interval during which no satellite from the selected filter group meets the visibility criteria for a specific region.
- **Elevation Threshold (Sensor Cone Angle):** The minimum angle above the horizon at which a satellite is considered "visible." A lower angle (e.g., 5°) means more coverage; a higher angle (e.g., 45°) is more restrictive.
- **Horizon Window:** The total timeframe for analysis, typically 24 hours.
- **Strategic Sites:** Pre-defined points of interest (e.g., Pokhran, Siachen) for quick monitoring.
- **Traced Region:** A custom polygon area defined by the operator on the map.

---

## 3. Architecture

### A. Frontend (`js/modules/definitions/blindSpotDetection.js`)
The frontend is the primary interface for real-time analysis and visualization.

- **Controls:**
    - **Strategic Region Search:** Quick selection of pre-defined sites or searching by country/region.
    - **Manual Region Selection:** Integration with the `regionTrace` module to define custom polygons.
    - **Operational Parameters:** Sliders for Sensor Cone Angle and buttons for Analysis Timeframe (1h to 24h).
    - **Coverage Filters:** Checkboxes to select satellite groups (e.g., Adversary, Indian, US, Commercial).
- **Algorithm:**
    1. **Sampling:** The module steps through the selected timeframe (usually in 5-minute increments).
    2. **Visibility Calculation:** At each step, it propagates all selected satellites to find their position relative to the target.
    3. **Coverage Check:** 
        - For **Points**: Returns "Covered" if any satellite elevation > threshold.
        - For **Polygons**: Samples a grid of points within the polygon. A region is considered "Covered" if a high percentage of grid points are visible to at least one satellite.
    4. **Schedule Generation:** Contiguous "Dark" steps are aggregated into discrete "Blind Windows" with start/end times and durations.
- **Visualization:**
    - **Cesium Integration:** Dynamically colors sites and regions (Green = Covered, Red = Blind) based on the current playback time.
    - **Timeline Overlay:** An interactive scrubber and playback control (Live, Fast-forward, Pause) to visualize coverage dynamics.

### B. Backend (`backend/src/services/regionAnalysisService.js`)
The backend provides a robust implementation for automated alerts and background processing.

- **`analyzeBlindSpotFromRecords`**: A high-performance implementation that checks if a region has *any* coverage during a specified window.
- **Alert Generation:** If a region is found to be completely dark for the analysis window, an `operationalAlert` is generated.
- **Persistence:** Results can be saved to the database for historical auditing and cross-analysis with other modules.

---

## 4. Technical Details

### Satellite Propagation
The module uses **SGP4 (Simplified General Perturbations 4)** via the `satellite.js` library to predict satellite positions from TLE (Two-Line Element) data.

### Coordinate Transformations
1. **ECI to ECF:** Converts Earth-Centered Inertial coordinates to Earth-Centered Fixed (rotating with the Earth).
2. **ECF to Look Angles:** Converts the satellite's position relative to the observer's Latitude, Longitude, and Altitude into **Azimuth**, **Elevation**, and **Range**.

### Region Grid Sampling
For polygon areas, the module doesn't just check the centroid. It:
1. Calculates the bounding box of the polygon.
2. Generates a grid of points (e.g., 100 points).
3. Filters the grid to only include points inside the polygon boundaries.
4. Checks coverage for each grid point to determine overall regional visibility.

---

## 5. Usage Instructions

1.  **Select a Module:** Open the "Blind Spot Detection" module from the dashboard.
2.  **Choose a Region:** 
    - Click a **Strategic Site** button in the sidebar.
    - OR use the **Search** bar to find a country or region.
    - OR use the **Trace** tool to draw a polygon on the map.
3.  **Set Filters:** Select the satellite families you are concerned about (e.g., check "Adversary (Recon/LEO)").
4.  **Adjust Parameters:** Set the timeframe and the required sensor cone angle.
5.  **Compute:** Click **Update Analysis**.
6.  **Review Schedule:** The "Blind Spot Schedule" will populate with a list of windows in IST.
7.  **Visualize:** Use the **Timeline Scrubber** at the bottom to see the coverage change on the map in real-time.
8.  **Export:** Use the **Export CSV** or **Export JSON** buttons to save the report for offline use.

---

## 6. Developer Notes

### Performance
- The frontend uses a 5-minute sampling step to maintain UI responsiveness. For higher precision, this can be adjusted in `generateSchedule`, but may impact performance with large satellite counts.
- Backend analysis is bounded by an `analysisBudget` to prevent long-running propagations from blocking the event loop.

### Timezones
- The system internally operates in **UTC** but reports all results to the operator in **IST (UTC+5.5)** to align with local operational standards.

### Data Sources
- Satellite orbits are derived from the latest TLEs available in the `appState`. Ensure the satellite synchronization service is running to have accurate predictions.

---
*Generated on: 22 May 2026*
