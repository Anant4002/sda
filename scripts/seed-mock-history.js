const path = require("path");
const { SatelliteTleRevision } = require(path.join(process.cwd(), "backend/src/models/satelliteTleRevision"));
const { Satellite } = require(path.join(process.cwd(), "backend/src/models/satellite"));
const { parseOrbitalMetricsFromTle, tleChecksum } = require(path.join(process.cwd(), "backend/src/services/tleRevisionHistoryService"));

async function generateMockHistory() {
    console.log("Generating mock TLE history for ALL satellites...");
    
    // Clear existing to avoid duplicate checksums or mixed data
    await SatelliteTleRevision.destroy({ where: {} });

    const allSatellites = await Satellite.findAll();
    console.log(`Processing ${allSatellites.length} satellites...`);
    
    const now = new Date();
    const CHUNK_SIZE = 500; // Process 500 satellites at a time
    let totalSeeded = 0;

    for (let i = 0; i < allSatellites.length; i += CHUNK_SIZE) {
        const chunk = allSatellites.slice(i, i + CHUNK_SIZE);
        const records = [];

        for (const sat of chunk) {
            if (!sat.line1 || !sat.line2) continue;

            for (let j = 0; j < 10; j++) {
                const date = new Date(now.getTime() - j * 24 * 60 * 60 * 1000);
                
                // j=0 is 'now', j=9 is '9 days ago'
                // We base the mock TLE on the ACTUAL live TLE of the satellite
                // and inject subtle SMA drift backwards in time
                const actualMetrics = parseOrbitalMetricsFromTle(sat.line1, sat.line2);
                if (!actualMetrics) continue;

                const baseSma = actualMetrics.semiMajorAxisKm;
                const decayRate = 0.2; // km per day
                const mockSma = baseSma + (j * decayRate); 
                
                const GM = 398600.4418;
                const mmRadSec = Math.sqrt(GM / Math.pow(mockSma, 3));
                const mmRevDay = (mmRadSec * 24 * 3600) / (2 * Math.PI);
                
                // Construct a mock TLE that is close to the original but slightly shifted
                const line1 = sat.line1; // Keep metadata (NORAD ID, etc)
                // Update Line 2 with the slightly modified mean motion
                let line2 = sat.line2.substring(0, 52) + mmRevDay.toFixed(8).toString().padEnd(11, '0') + sat.line2.substring(63);

                const metrics = parseOrbitalMetricsFromTle(line1, line2);

                records.push({
                    noradId: sat.noradId,
                    satelliteName: sat.name,
                    line1,
                    line2,
                    inclinationDeg: metrics.inclinationDeg,
                    eccentricity: metrics.eccentricity,
                    meanMotionRevPerDay: metrics.meanMotionRevPerDay,
                    raanDeg: metrics.raanDeg,
                    argPerigeeDeg: metrics.argPerigeeDeg,
                    meanAnomalyDeg: metrics.meanAnomalyDeg,
                    semiMajorAxisKm: metrics.semiMajorAxisKm,
                    perigeeKm: metrics.perigeeKm,
                    apogeeKm: metrics.apogeeKm,
                    tleEpoch: date,
                    tleChecksum: tleChecksum(line1, line2),
                    ingestedAt: date,
                    isIndian: sat.isIndian || (sat.characterisation && sat.characterisation.ownership === "Indian"),
                    sourceName: "Global Mock History Generator"
                });
            }
        }

        await SatelliteTleRevision.bulkCreate(records);
        totalSeeded += records.length;
        console.log(`Seeded ${totalSeeded} records...`);
        
        // Yield to allow event loop processing
        await new Promise(resolve => setImmediate(resolve));
    }

    console.log(`Successfully generated ${totalSeeded} mock revisions for ${allSatellites.length} satellites.`);
}

generateMockHistory().catch(console.error);
