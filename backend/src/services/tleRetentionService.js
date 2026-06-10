/**
 * TLE Retention Service
 *
 * Implements a database retention policy for the satellite_tle_revisions table.
 * Without periodic purging, this table grows indefinitely (one row per TLE per
 * hourly sync = ~10,000 rows/hour = ~240,000 rows/day), eventually degrading
 * query performance.
 *
 * Policy:
 *   - Keep all revisions ingested within the last TLE_RETENTION_DAYS (default 90).
 *   - Regardless of age, always retain the 2 most recent revisions per satellite
 *     so that manoeuvre detection always has at least two data points.
 *
 * Safe to run concurrently with normal operations — uses DELETE + subquery only.
 */

'use strict';

const { Op, QueryTypes } = require('sequelize');
const { SatelliteTleRevision } = require('../models/satelliteTleRevision');
const { sequelize } = require('../db');
const { logger } = require('../utils/logger');

const CONTEXT = 'TleRetention';

/**
 * Purge stale TLE revision records according to the retention policy.
 *
 * @param {number} retentionDays - Number of days to retain (default: TLE_RETENTION_DAYS env or 90)
 * @returns {{ deleted: number, retentionDays: number, cutoffDate: string }}
 */
async function purgeStaleTleRevisions(retentionDays) {
    const days = retentionDays ?? (Number(process.env.TLE_RETENTION_DAYS) || 90);
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    logger.info(CONTEXT, `Starting TLE revision purge`, {
        retentionDays: days,
        cutoffDate: cutoffDate.toISOString()
    });

    try {
        // Step 1: Find the IDs of the 2 most recent revisions per NORAD ID.
        // These are always protected regardless of age.
        const protectedRows = await sequelize.query(
            `SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (PARTITION BY norad_id ORDER BY ingested_at DESC) AS rn
                FROM satellite_tle_revisions
                WHERE norad_id IS NOT NULL
            ) ranked
            WHERE rn <= 2`,
            { type: QueryTypes.SELECT }
        );

        const protectedIds = protectedRows.map(r => r.id);

        // Step 2: Delete rows older than the cutoff that are NOT in the protected set.
        const whereClause = {
            ingestedAt: { [Op.lt]: cutoffDate }
        };

        if (protectedIds.length > 0) {
            whereClause.id = { [Op.notIn]: protectedIds };
        }

        const deleted = await SatelliteTleRevision.destroy({ where: whereClause });

        logger.info(CONTEXT, `TLE revision purge complete`, {
            deleted,
            protectedFromPurge: protectedIds.length,
            retentionDays: days,
            cutoffDate: cutoffDate.toISOString()
        });

        return {
            deleted,
            protectedFromPurge: protectedIds.length,
            retentionDays: days,
            cutoffDate: cutoffDate.toISOString()
        };
    } catch (error) {
        logger.error(CONTEXT, 'TLE revision purge failed', error);
        throw error;
    }
}

module.exports = { purgeStaleTleRevisions };
