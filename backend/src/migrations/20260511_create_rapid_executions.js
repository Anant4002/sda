/**
 * Migration: Create rapid_executions table
 * Date: 2026-05-11
 *
 * Tracks the execution of the Rapid Processing Pipeline (POC).
 */

async function up(sequelize) {
    const queryInterface = sequelize.getQueryInterface();

    await queryInterface.createTable("rapid_executions", {
        id: {
            type: sequelize.DataTypes.BIGINT,
            primaryKey: true,
            autoIncrement: true
        },
        status: {
            type: sequelize.DataTypes.STRING,
            allowNull: false,
            defaultValue: "pending" // pending, running, completed, failed
        },
        start_time: {
            type: sequelize.DataTypes.DATE,
            allowNull: false,
            defaultValue: sequelize.DataTypes.NOW
        },
        end_time: {
            type: sequelize.DataTypes.DATE,
            allowNull: true
        },
        summary: {
            type: sequelize.DataTypes.JSONB,
            allowNull: true
        },
        error_message: {
            type: sequelize.DataTypes.TEXT,
            allowNull: true
        },
        created_at: {
            type: sequelize.DataTypes.DATE,
            allowNull: false,
            defaultValue: sequelize.DataTypes.NOW
        },
        updated_at: {
            type: sequelize.DataTypes.DATE,
            allowNull: false,
            defaultValue: sequelize.DataTypes.NOW
        }
    });

    await queryInterface.addIndex("rapid_executions", ["status"], {
        name: "idx_rapid_executions_status"
    });

    await queryInterface.addIndex("rapid_executions", ["start_time"], {
        name: "idx_rapid_executions_start_time"
    });
}

async function down(sequelize) {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.dropTable("rapid_executions");
}

module.exports = { up, down };
