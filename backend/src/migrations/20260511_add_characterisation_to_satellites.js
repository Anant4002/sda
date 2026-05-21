/**
 * Migration: Add characterisation column to satellites table
 * Date: 2026-05-11
 */

async function up(sequelize) {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.addColumn("satellites", "characterisation", {
        type: sequelize.DataTypes.JSONB,
        allowNull: true
    });
}

async function down(sequelize) {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.removeColumn("satellites", "characterisation");
}

module.exports = { up, down };
