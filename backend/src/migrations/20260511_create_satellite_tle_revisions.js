/**
 * Migration: Create satellite_tle_revisions table
 * Date: 2026-05-11
 *
 * Creates immutable append-only table for TLE revision history.
 * This table preserves complete orbital history without data loss.
 */

async function up(sequelize) {
    const queryInterface = sequelize.getQueryInterface();

    // Create table
    await queryInterface.createTable("satellite_tle_revisions", {
        id: {
            type: sequelize.DataTypes.BIGINT,
            primaryKey: true,
            autoIncrement: true
        },

        // Satellite identification
        norad_id: {
            type: sequelize.DataTypes.INTEGER,
            allowNull: true
        },
        satellite_name: {
            type: sequelize.DataTypes.STRING,
            allowNull: false
        },

        // Raw TLE (exactly as ingested)
        line1: {
            type: sequelize.DataTypes.STRING,
            allowNull: false
        },
        line2: {
            type: sequelize.DataTypes.STRING,
            allowNull: false
        },

        // Derived orbital elements
        inclination_deg: {
            type: sequelize.DataTypes.FLOAT,
            allowNull: true
        },
        eccentricity: {
            type: sequelize.DataTypes.FLOAT,
            allowNull: true
        },
        mean_motion_rev_per_day: {
            type: sequelize.DataTypes.FLOAT,
            allowNull: true
        },
        raan_deg: {
            type: sequelize.DataTypes.FLOAT,
            allowNull: true
        },
        arg_perigee_deg: {
            type: sequelize.DataTypes.FLOAT,
            allowNull: true
        },
        mean_anomaly_deg: {
            type: sequelize.DataTypes.FLOAT,
            allowNull: true
        },
        semi_major_axis_km: {
            type: sequelize.DataTypes.FLOAT,
            allowNull: true
        },
        apogee_km: {
            type: sequelize.DataTypes.FLOAT,
            allowNull: true
        },
        perigee_km: {
            type: sequelize.DataTypes.FLOAT,
            allowNull: true
        },

        // TLE epoch
        tle_epoch: {
            type: sequelize.DataTypes.DATE,
            allowNull: true
        },

        // Source lineage
        source_name: {
            type: sequelize.DataTypes.STRING,
            allowNull: true
        },
        source_url: {
            type: sequelize.DataTypes.STRING,
            allowNull: true
        },

        // Catalog version reference
        catalogVersion_id: {
            type: sequelize.DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: "satellite_catalog_versions",
                key: "id"
            }
        },

        // Deduplication checksum
        tle_checksum: {
            type: sequelize.DataTypes.STRING,
            allowNull: false
        },

        // Audit
        is_indian: {
            type: sequelize.DataTypes.BOOLEAN,
            defaultValue: false
        },
        ingested_at: {
            type: sequelize.DataTypes.DATE,
            allowNull: false,
            defaultValue: sequelize.DataTypes.NOW
        },
        created_at: {
            type: sequelize.DataTypes.DATE,
            allowNull: false,
            defaultValue: sequelize.DataTypes.NOW
        }
    });

    // Create composite uniqueness constraint for deduplication
    // Prevents same TLE for same satellite from being ingested twice
    await queryInterface.addConstraint("satellite_tle_revisions", {
        fields: ["norad_id", "satellite_name", "tle_checksum"],
        type: "unique",
        name: "uq_tle_revision_dedup"
    });

    // Create indexes for efficient queries
    await queryInterface.addIndex("satellite_tle_revisions", ["norad_id"], {
        name: "idx_satellite_tle_revisions_norad_id"
    });

    await queryInterface.addIndex("satellite_tle_revisions", ["satellite_name"], {
        name: "idx_satellite_tle_revisions_name"
    });

    await queryInterface.addIndex("satellite_tle_revisions", ["ingested_at"], {
        name: "idx_satellite_tle_revisions_ingested_at",
        order: "DESC"
    });

    await queryInterface.addIndex("satellite_tle_revisions", ["tle_checksum"], {
        name: "idx_satellite_tle_revisions_tle_checksum"
    });

    await queryInterface.addIndex("satellite_tle_revisions", ["catalogVersion_id"], {
        name: "idx_satellite_tle_revisions_catalogVersion_id"
    });

    // Composite indexes for common queries
    await queryInterface.addIndex(
        "satellite_tle_revisions",
        ["norad_id", "ingested_at"],
        {
            name: "idx_satellite_tle_revisions_norad_ingested"
        }
    );

    await queryInterface.addIndex(
        "satellite_tle_revisions",
        ["satellite_name", "ingested_at"],
        {
            name: "idx_satellite_tle_revisions_name_ingested"
        }
    );
}

async function down(sequelize) {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.dropTable("satellite_tle_revisions");
}

module.exports = { up, down };

