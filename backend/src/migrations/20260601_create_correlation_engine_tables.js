/**
 * Additive migration for the unified threat correlation layer.
 */

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable("correlation_rules", {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            rule_key: {
                type: Sequelize.STRING,
                allowNull: false,
                unique: true
            },
            rule_type: {
                type: Sequelize.STRING,
                allowNull: false
            },
            category: {
                type: Sequelize.STRING,
                allowNull: true
            },
            enabled: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: true
            },
            weight: {
                type: Sequelize.FLOAT,
                allowNull: false,
                defaultValue: 0
            },
            min_score: {
                type: Sequelize.INTEGER,
                allowNull: true
            },
            max_score: {
                type: Sequelize.INTEGER,
                allowNull: true
            },
            priority: {
                type: Sequelize.STRING,
                allowNull: true
            },
            recommendation_text: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            description: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            required_categories: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            required_classifications: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            window_minutes: {
                type: Sequelize.INTEGER,
                allowNull: true
            },
            config: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        await queryInterface.createTable("incident_groups", {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            incident_uid: {
                type: Sequelize.STRING,
                allowNull: false,
                unique: true
            },
            incident_key: {
                type: Sequelize.STRING,
                allowNull: false
            },
            title: {
                type: Sequelize.STRING,
                allowNull: false
            },
            summary: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            recommendation: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            priority: {
                type: Sequelize.STRING,
                allowNull: false,
                defaultValue: "LOW"
            },
            status: {
                type: Sequelize.STRING,
                allowNull: false,
                defaultValue: "open"
            },
            asset_classification: {
                type: Sequelize.STRING,
                allowNull: false,
                defaultValue: "UNKNOWN"
            },
            threat_category: {
                type: Sequelize.STRING,
                allowNull: false,
                defaultValue: "general"
            },
            primary_satellite_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: {
                    model: "satellites",
                    key: "id"
                },
                onDelete: "SET NULL",
                onUpdate: "CASCADE"
            },
            secondary_satellite_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: {
                    model: "satellites",
                    key: "id"
                },
                onDelete: "SET NULL",
                onUpdate: "CASCADE"
            },
            training_session_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: {
                    model: "training_sessions",
                    key: "id"
                },
                onDelete: "SET NULL",
                onUpdate: "CASCADE"
            },
            primary_object_name: {
                type: Sequelize.STRING,
                allowNull: true
            },
            secondary_object_name: {
                type: Sequelize.STRING,
                allowNull: true
            },
            region_name: {
                type: Sequelize.STRING,
                allowNull: true
            },
            region_hash: {
                type: Sequelize.STRING,
                allowNull: true
            },
            first_detected_at: {
                type: Sequelize.DATE,
                allowNull: false
            },
            last_detected_at: {
                type: Sequelize.DATE,
                allowNull: false
            },
            last_correlation_at: {
                type: Sequelize.DATE,
                allowNull: false
            },
            event_count: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0
            },
            link_count: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0
            },
            confidence: {
                type: Sequelize.FLOAT,
                allowNull: true
            },
            threat_score: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0
            },
            category_summary: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            source_types: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            metadata: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        await queryInterface.addIndex("incident_groups", ["incident_key"], {
            name: "idx_incident_groups_incident_key"
        });
        await queryInterface.addIndex("incident_groups", ["priority"], {
            name: "idx_incident_groups_priority"
        });
        await queryInterface.addIndex("incident_groups", ["asset_classification"], {
            name: "idx_incident_groups_asset_classification"
        });
        await queryInterface.addIndex("incident_groups", ["last_detected_at"], {
            name: "idx_incident_groups_last_detected_at"
        });
        await queryInterface.addIndex("incident_groups", ["training_session_id"], {
            name: "idx_incident_groups_training_session_id"
        });

        await queryInterface.createTable("alert_correlations", {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            correlation_key: {
                type: Sequelize.STRING,
                allowNull: false,
                unique: true
            },
            incident_group_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: {
                    model: "incident_groups",
                    key: "id"
                },
                onDelete: "CASCADE",
                onUpdate: "CASCADE"
            },
            alert_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                unique: true,
                references: {
                    model: "operational_alerts",
                    key: "id"
                },
                onDelete: "CASCADE",
                onUpdate: "CASCADE"
            },
            correlation_type: {
                type: Sequelize.STRING,
                allowNull: false
            },
            source_type: {
                type: Sequelize.STRING,
                allowNull: true
            },
            source_module: {
                type: Sequelize.STRING,
                allowNull: true
            },
            primary_object_name: {
                type: Sequelize.STRING,
                allowNull: true
            },
            secondary_object_name: {
                type: Sequelize.STRING,
                allowNull: true
            },
            region_hash: {
                type: Sequelize.STRING,
                allowNull: true
            },
            matched_categories: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            match_score: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0
            },
            confidence: {
                type: Sequelize.FLOAT,
                allowNull: true
            },
            rationale: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            summary: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            decision: {
                type: Sequelize.STRING,
                allowNull: false,
                defaultValue: "merged"
            },
            window_start: {
                type: Sequelize.DATE,
                allowNull: true
            },
            window_end: {
                type: Sequelize.DATE,
                allowNull: true
            },
            algorithm_version: {
                type: Sequelize.STRING,
                allowNull: false
            },
            metadata: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        await queryInterface.addIndex("alert_correlations", ["incident_group_id"], {
            name: "idx_alert_correlations_incident_group_id"
        });
        await queryInterface.addIndex("alert_correlations", ["source_type"], {
            name: "idx_alert_correlations_source_type"
        });
        await queryInterface.addIndex("alert_correlations", ["window_start"], {
            name: "idx_alert_correlations_window_start"
        });
        await queryInterface.addIndex("alert_correlations", ["window_end"], {
            name: "idx_alert_correlations_window_end"
        });

        await queryInterface.createTable("incident_event_links", {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            incident_group_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: {
                    model: "incident_groups",
                    key: "id"
                },
                onDelete: "CASCADE",
                onUpdate: "CASCADE"
            },
            alert_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: {
                    model: "operational_alerts",
                    key: "id"
                },
                onDelete: "CASCADE",
                onUpdate: "CASCADE"
            },
            alert_correlation_id: {
                type: Sequelize.INTEGER,
                allowNull: true,
                references: {
                    model: "alert_correlations",
                    key: "id"
                },
                onDelete: "SET NULL",
                onUpdate: "CASCADE"
            },
            event_key: {
                type: Sequelize.STRING,
                allowNull: false
            },
            relation_type: {
                type: Sequelize.STRING,
                allowNull: false,
                defaultValue: "member"
            },
            link_role: {
                type: Sequelize.STRING,
                allowNull: false,
                defaultValue: "supporting"
            },
            source_type: {
                type: Sequelize.STRING,
                allowNull: true
            },
            module_name: {
                type: Sequelize.STRING,
                allowNull: true
            },
            linked_at: {
                type: Sequelize.DATE,
                allowNull: false
            },
            metadata: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        await queryInterface.addIndex("incident_event_links", ["incident_group_id"], {
            name: "idx_incident_event_links_incident_group_id"
        });
        await queryInterface.addIndex("incident_event_links", ["alert_id"], {
            name: "idx_incident_event_links_alert_id"
        });
        await queryInterface.addIndex("incident_event_links", ["event_key"], {
            name: "idx_incident_event_links_event_key"
        });
        await queryInterface.addConstraint("incident_event_links", {
            fields: ["incident_group_id", "alert_id"],
            type: "unique",
            name: "uq_incident_event_links_incident_alert"
        });

        await queryInterface.createTable("threat_scores", {
            id: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: Sequelize.INTEGER
            },
            incident_group_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: {
                    model: "incident_groups",
                    key: "id"
                },
                onDelete: "CASCADE",
                onUpdate: "CASCADE"
            },
            score: {
                type: Sequelize.INTEGER,
                allowNull: false
            },
            priority: {
                type: Sequelize.STRING,
                allowNull: false
            },
            level: {
                type: Sequelize.STRING,
                allowNull: false
            },
            breakdown: {
                type: Sequelize.JSONB,
                allowNull: false
            },
            weighted_categories: {
                type: Sequelize.JSONB,
                allowNull: true
            },
            source_count: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0
            },
            confidence: {
                type: Sequelize.FLOAT,
                allowNull: true
            },
            recommended_action: {
                type: Sequelize.TEXT,
                allowNull: true
            },
            algorithm_version: {
                type: Sequelize.STRING,
                allowNull: false
            },
            model_version: {
                type: Sequelize.STRING,
                allowNull: true
            },
            computed_at: {
                type: Sequelize.DATE,
                allowNull: false
            },
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        await queryInterface.addIndex("threat_scores", ["incident_group_id"], {
            name: "idx_threat_scores_incident_group_id"
        });
        await queryInterface.addIndex("threat_scores", ["score"], {
            name: "idx_threat_scores_score"
        });
        await queryInterface.addIndex("threat_scores", ["priority"], {
            name: "idx_threat_scores_priority"
        });
        await queryInterface.addIndex("threat_scores", ["computed_at"], {
            name: "idx_threat_scores_computed_at"
        });

        const now = new Date();
        await queryInterface.bulkInsert("correlation_rules", [
            {
                rule_key: "engine_config",
                rule_type: "config",
                enabled: true,
                weight: 0,
                description: "Default correlation windows and score thresholds.",
                config: JSON.stringify({
                    incidentWindowMinutes: 360,
                    sameObjectWindowMinutes: 720,
                    sameRegionWindowMinutes: 240,
                    lowMax: 24,
                    mediumMax: 49,
                    highMax: 79,
                    scoreCap: 100
                }),
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "weight_conjunction",
                rule_type: "weight",
                category: "conjunction",
                enabled: true,
                weight: 25,
                description: "Base conjunction risk weight.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "weight_collision_risk",
                rule_type: "weight",
                category: "collision_risk",
                enabled: true,
                weight: 40,
                description: "Collision probability and critical miss-distance weight.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "weight_manoeuvre",
                rule_type: "weight",
                category: "manoeuvre",
                enabled: true,
                weight: 30,
                description: "Manoeuvre detection weight.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "weight_blind_spot",
                rule_type: "weight",
                category: "blind_spot",
                enabled: true,
                weight: 25,
                description: "Blind spot coverage gap weight.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "weight_neighbourhood_watch",
                rule_type: "weight",
                category: "neighbourhood_watch",
                enabled: true,
                weight: 20,
                description: "Neighbourhood watch proximity weight.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "weight_reentry",
                rule_type: "weight",
                category: "reentry",
                enabled: true,
                weight: 10,
                description: "Re-entry analysis weight.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "weight_rapid_threat",
                rule_type: "weight",
                category: "rapid_threat",
                enabled: true,
                weight: 50,
                description: "Rapid threat processing weight.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "combo_conjunction_collision",
                rule_type: "combination",
                enabled: true,
                required_categories: ["conjunction", "collision_risk"],
                weight: 20,
                priority: "HIGH",
                recommendation_text: "Immediate Monitoring",
                description: "Escalate when conjunction and collision-risk signals appear together.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "combo_manoeuvre_neighbourhood",
                rule_type: "combination",
                enabled: true,
                required_categories: ["manoeuvre", "neighbourhood_watch"],
                weight: 15,
                priority: "HIGH",
                recommendation_text: "Suspicious Behaviour",
                description: "Escalate when a manoeuvre is followed by proximity activity.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "combo_blindspot_adversary",
                rule_type: "combination",
                enabled: true,
                required_categories: ["blind_spot", "adversary"],
                weight: 15,
                priority: "HIGH",
                recommendation_text: "Surveillance Opportunity",
                description: "Escalate blind spots over adversary-linked activity.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "combo_rapid_reentry",
                rule_type: "combination",
                enabled: true,
                required_categories: ["rapid_threat", "reentry"],
                weight: 30,
                priority: "CRITICAL",
                recommendation_text: "Critical Event",
                description: "Escalate when rapid threat detection overlaps with re-entry risk.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "threshold_low",
                rule_type: "threshold",
                enabled: true,
                min_score: 0,
                max_score: 24,
                priority: "LOW",
                description: "Low threat band.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "threshold_medium",
                rule_type: "threshold",
                enabled: true,
                min_score: 25,
                max_score: 49,
                priority: "MEDIUM",
                description: "Medium threat band.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "threshold_high",
                rule_type: "threshold",
                enabled: true,
                min_score: 50,
                max_score: 79,
                priority: "HIGH",
                description: "High threat band.",
                createdAt: now,
                updatedAt: now
            },
            {
                rule_key: "threshold_critical",
                rule_type: "threshold",
                enabled: true,
                min_score: 80,
                max_score: 100,
                priority: "CRITICAL",
                description: "Critical threat band.",
                createdAt: now,
                updatedAt: now
            }
        ]);
    },

    async down(queryInterface) {
        await queryInterface.dropTable("threat_scores");
        await queryInterface.dropTable("incident_event_links");
        await queryInterface.dropTable("alert_correlations");
        await queryInterface.dropTable("incident_groups");
        await queryInterface.dropTable("correlation_rules");
    }
};
