/**
 * Migration: Enhance satellite catalog with indigenous data fields
 * Date: 2026-05-15
 */

async function up(sequelize) {
    const queryInterface = sequelize.getQueryInterface();
    const { DataTypes } = sequelize;

    await queryInterface.addColumn("satellites", "catalog_status", {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "CORRELATED"
    });

    await queryInterface.addColumn("satellites", "data_source", {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "CELESTRAK"
    });

    await queryInterface.addColumn("satellites", "int_data", {
        type: DataTypes.JSONB,
        allowNull: true
    });

    await queryInterface.addColumn("satellites", "is_indigenous", {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    });

    await queryInterface.addColumn("satellites", "last_observed_at", {
        type: DataTypes.DATE,
        allowNull: true
    });
}

async function down(sequelize) {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.removeColumn("satellites", "catalog_status");
    await queryInterface.removeColumn("satellites", "data_source");
    await queryInterface.removeColumn("satellites", "int_data");
    await queryInterface.removeColumn("satellites", "is_indigenous");
    await queryInterface.removeColumn("satellites", "last_observed_at");
}

module.exports = { up, down };
