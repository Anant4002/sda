const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const SatelliteTleRevision = sequelize.define("SatelliteTleRevision", {
    // Satellite identification (scoped for deduplication)
    noradId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "norad_id"
    },
    satelliteName: {
        type: DataTypes.STRING,
        allowNull: false,
        field: "satellite_name"
    },

    // Raw TLE (exactly as ingested from source)
    line1: {
        type: DataTypes.STRING,
        allowNull: false
    },
    line2: {
        type: DataTypes.STRING,
        allowNull: false
    },

    // Derived orbital elements (parsed from TLE on ingestion)
    inclinationDeg: {
        type: DataTypes.FLOAT,
        allowNull: true,
        field: "inclination_deg"
    },
    eccentricity: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    meanMotionRevPerDay: {
        type: DataTypes.FLOAT,
        allowNull: true,
        field: "mean_motion_rev_per_day"
    },
    raanDeg: {
        type: DataTypes.FLOAT,
        allowNull: true,
        field: "raan_deg"
    },
    argPerigeeDeg: {
        type: DataTypes.FLOAT,
        allowNull: true,
        field: "arg_perigee_deg"
    },
    meanAnomalyDeg: {
        type: DataTypes.FLOAT,
        allowNull: true,
        field: "mean_anomaly_deg"
    },
    semiMajorAxisKm: {
        type: DataTypes.FLOAT,
        allowNull: true,
        field: "semi_major_axis_km"
    },
    apogeeKm: {
        type: DataTypes.FLOAT,
        allowNull: true,
        field: "apogee_km"
    },
    perigeeKm: {
        type: DataTypes.FLOAT,
        allowNull: true,
        field: "perigee_km"
    },

    // TLE epoch (extracted from line1)
    tleEpoch: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "tle_epoch"
    },

    // Source lineage
    sourceName: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "source_name"
    },
    sourceUrl: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "source_url"
    },

    // Catalog version reference (audit trail)
    catalogVersionId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "catalogVersion_id"
    },

    // Deduplication (composite: per-satellite per-TLE state)
    tleChecksum: {
        type: DataTypes.STRING,
        allowNull: false,
        field: "tle_checksum"
    },

    // Audit fields
    isIndian: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        field: "is_indian"
    },
    ingestedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: "ingested_at"
    }
}, {
    tableName: "satellite_tle_revisions",
    timestamps: true,
    createdAt: false,
    updatedAt: false,
    indexes: [
        {
            name: "satellite_tle_revisions_norad_id_ingested_at",
            fields: ["norad_id", "ingested_at"]
        },
        {
            name: "satellite_tle_revisions_tle_checksum",
            fields: ["tle_checksum"]
        },
        {
            name: "satellite_tle_revisions_satellite_name",
            fields: ["satellite_name"]
        },
        {
            name: "satellite_tle_revisions_perigee_km_ingested_at",
            fields: ["perigee_km", "ingested_at"]
        }
    ]
});

module.exports = {
    SatelliteTleRevision
};

